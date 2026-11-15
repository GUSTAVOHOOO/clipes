//! Transcrição local em blocos com checkpoint (#48).
//!
//! A Transcrição de uma Fonte roda como job da fila do Projeto (`kind = 'transcription'`,
//! safety local). O núcleo corta o áudio da faixa escolhida na Fonte em blocos (10 min),
//! pede cada bloco ao Motor e grava palavras, silêncios e o ponto de retomada numa única
//! transação: matar o processo no meio retoma do último bloco concluído, sem duplicar
//! palavras. O worker nunca abre o banco; só o núcleo grava (ADR-0004, ADR-0005).
//!
//! O Motor é uma interface trocável ([`TranscriptionEngine`]); o Motor local fala com o
//! worker Python (faster-whisper). Um Motor remoto implementaria a mesma interface.

use crate::{
    components::{models, worker::start_worker},
    jobs::{self, preview},
    projects,
    worker::{WorkerClient, WorkerEvent},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

// Uma linha por palavra, com índices por ordem (chave primária) e por tempo; silêncios são
// segmentos explícitos (`kind = 'silence'`); `speaker` fica reservado, sempre nulo (diarização
// fora da v1). Tempos em µs inteiros.
inventory::submit! { projects::Migration { id: "0048_001_transcripts", sql: "CREATE TABLE transcripts (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id), audio_track INTEGER NOT NULL, engine TEXT NOT NULL, model TEXT NOT NULL, revision TEXT NOT NULL, compute_type TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','complete')), resume_us INTEGER NOT NULL DEFAULT 0, duration_us INTEGER NOT NULL, UNIQUE(source_id, audio_track)); CREATE TABLE transcript_words (transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE, position INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('word','silence')), text TEXT NOT NULL DEFAULT '', start_us INTEGER NOT NULL, end_us INTEGER NOT NULL, language TEXT, speaker TEXT, PRIMARY KEY (transcript_id, position)) WITHOUT ROWID; CREATE INDEX transcript_words_by_time ON transcript_words(transcript_id, start_us);" } }

// Dispositivo e precisão de cada bloco (#50): podem mudar entre blocos (queda da cadeia, nova
// sonda); o modelo da Transcrição não.
inventory::submit! { projects::Migration { id: "0050_001_transcription_block_config", sql: "CREATE TABLE transcription_block_config (transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE, start_us INTEGER NOT NULL, device TEXT NOT NULL, compute_type TEXT NOT NULL, PRIMARY KEY(transcript_id,start_us)) WITHOUT ROWID;" } }

/// Duração de cada bloco de áudio. `CLIPES_TRANSCRIBE_BLOCK_SECONDS` existe só para os testes.
const BLOCK_US: i64 = 600_000_000;
fn block_us() -> i64 {
    std::env::var("CLIPES_TRANSCRIBE_BLOCK_SECONDS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|s| *s > 0)
        .map_or(BLOCK_US, |s| s * 1_000_000)
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
fn audio_failed() -> CoreError {
    error(
        "transcribe_audio",
        "Não foi possível extrair o áudio da Fonte.",
    )
}
fn bad_result() -> CoreError {
    error(
        "worker_protocol",
        "O worker enviou uma mensagem fora do protocolo.",
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Word {
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
    pub language: Option<String>,
}

/// Um bloco já traduzido para tempos relativos ao início do bloco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockResult {
    /// Até onde o bloco foi coberto (µs desde o início do bloco). Menor que a duração
    /// quando a última fala encosta no fim e fica para o bloco seguinte.
    pub covered_us: i64,
    pub words: Vec<Word>,
    pub silences: Vec<(i64, i64)>,
}

pub struct BlockRequest<'a> {
    /// WAV 16 kHz mono do bloco.
    pub audio: &'a Path,
    /// Último bloco da Fonte: não há bloco seguinte para receber uma fala cortada.
    pub final_block: bool,
}

/// O que produz a Transcrição (GLOSSARY: Motor de transcrição). Trocável: o local usa o
/// worker; um remoto implementaria a mesma interface.
pub trait TranscriptionEngine {
    /// Contexto do checkpoint; não é enviado ao serviço remoto.
    fn prepare(&mut self, _job: i64, _transcript: i64, _resume_us: i64) {}
    /// Dispositivo e precisão usados no último bloco (dado técnico gravado por bloco; só o Motor local informa).
    fn block_config(&self) -> Option<(String, String)> {
        None
    }
    fn transcribe_block(
        &mut self,
        request: &BlockRequest<'_>,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(u8),
    ) -> Result<BlockResult, CoreError>;
}

/// Motor local: faster-whisper no worker de ML, com o modelo que o hardware pede.
pub struct LocalEngine {
    client: WorkerClient,
    model: Value,
    batch_size: u32,
    /// O modelo da Transcrição: nunca muda; a precisão e o dispositivo podem mudar entre blocos.
    model_id: String,
}

impl LocalEngine {
    /// Monta o Motor com um worker já iniciado e o modelo dado (`id`, `dir`, `device`,
    /// `compute_type`); usado pelo teste real manual, que não passa pela instalação.
    pub fn with_worker(client: WorkerClient, model: Value, batch_size: u32) -> Self {
        LocalEngine {
            client,
            model_id: model["id"].as_str().unwrap_or_default().to_owned(),
            model,
            batch_size,
        }
    }

    /// Inicia o Motor para o `model_id` já gravado na Transcrição.
    pub fn start_for(model_id: &str) -> Result<Self, CoreError> {
        let selection = models::selection_for(model_id)?;
        let client = start_worker()?;
        Ok(LocalEngine {
            client,
            model: json!({
                "id": selection.spec.id,
                "dir": selection.dir,
                "device": selection.config.device,
                "compute_type": selection.config.compute_type,
            }),
            batch_size: selection.config.batch_size(),
            model_id: model_id.to_owned(),
        })
    }
}

impl TranscriptionEngine for LocalEngine {
    fn block_config(&self) -> Option<(String, String)> {
        Some((
            self.model["device"].as_str()?.to_owned(),
            self.model["compute_type"].as_str()?.to_owned(),
        ))
    }
    fn transcribe_block(
        &mut self,
        request: &BlockRequest<'_>,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(u8),
    ) -> Result<BlockResult, CoreError> {
        // A precisão e o dispositivo valem para este bloco: uma nova sonda ou escolha manual entra aqui.
        if let Ok(selection) = models::selection_for(&self.model_id) {
            self.model = json!({"id": selection.spec.id, "dir": selection.dir, "device": selection.config.device, "compute_type": selection.config.compute_type});
            self.batch_size = selection.config.batch_size();
        }
        let params = json!({
            "audio": request.audio,
            "final": request.final_block,
            "batch_size": self.batch_size,
            "model": self.model,
        });
        let data = self
            .client
            .run("transcribe", params, cancel, &mut |event| {
                if let WorkerEvent::Progress { percentage, .. } = event {
                    progress(percentage);
                }
            })?;
        parse_block(&data)
    }
}

fn micros(value: &Value) -> Result<i64, CoreError> {
    value.as_i64().filter(|n| *n >= 0).ok_or_else(bad_result)
}

fn parse_block(data: &Value) -> Result<BlockResult, CoreError> {
    let words = data["words"]
        .as_array()
        .ok_or_else(bad_result)?
        .iter()
        .map(|w| {
            let start_us = micros(&w["start_us"])?;
            Ok(Word {
                text: w["text"].as_str().ok_or_else(bad_result)?.to_owned(),
                start_us,
                end_us: micros(&w["end_us"])?.max(start_us),
                language: w["language"].as_str().map(str::to_owned),
            })
        })
        .collect::<Result<Vec<_>, CoreError>>()?;
    let silences = data["silences"]
        .as_array()
        .ok_or_else(bad_result)?
        .iter()
        .map(|s| Ok((micros(&s["start_us"])?, micros(&s["end_us"])?)))
        .collect::<Result<Vec<_>, CoreError>>()?;
    Ok(BlockResult {
        covered_us: micros(&data["covered_us"])?,
        words,
        silences,
    })
}

fn is_cancelled(id: i64) -> bool {
    preview::is_cancelled(id)
}

/// Corta `len_us` de áudio da faixa escolhida da Fonte, a partir de `start_us`, em WAV
/// 16 kHz mono. O `ffmpeg` roda sem shell e é encerrado se o job for cancelado ou interrompido.
struct Slice<'a> {
    source: &'a Path,
    track: i64,
    start_us: i64,
    len_us: i64,
}

fn extract(
    ffmpeg: &Path,
    slice: &Slice<'_>,
    output: &Path,
    id: i64,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    extract_checked(ffmpeg, slice, output, &|| preview::check(id, stop))
}

fn extract_checked(
    ffmpeg: &Path,
    slice: &Slice<'_>,
    output: &Path,
    check: &dyn Fn() -> Result<(), CoreError>,
) -> Result<(), CoreError> {
    let Slice {
        source,
        track,
        start_us,
        len_us,
    } = *slice;
    let seconds = |us: i64| format!("{:.6}", us as f64 / 1_000_000.0);
    let args: Vec<std::ffi::OsString> = vec![
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-ss".into(),
        seconds(start_us).into(),
        "-t".into(),
        seconds(len_us).into(),
        "-i".into(),
        source.as_os_str().to_owned(),
        "-map".into(),
        format!("0:{track}").into(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
        "-c:a".into(),
        if output.extension().is_some_and(|s| s == "flac") {
            "flac"
        } else {
            "pcm_s16le"
        }
        .into(),
        "-f".into(),
        if output.extension().is_some_and(|s| s == "flac") {
            "flac"
        } else {
            "wav"
        }
        .into(),
        output.as_os_str().to_owned(),
    ];
    let (mut child, group) =
        crate::process::spawn_managed(ffmpeg, args).map_err(|_| audio_failed())?;
    let drains: Vec<_> = [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|mut stream| {
        std::thread::spawn(move || drop(std::io::copy(&mut stream, &mut std::io::sink())))
    })
    .collect();
    let result = loop {
        if let Err(e) = check() {
            group.terminate();
            let _ = child.wait();
            break Err(e);
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(_)) | Err(_) => break Err(audio_failed()),
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    for drain in drains {
        let _ = drain.join();
    }
    if result.is_err() {
        let _ = fs::remove_file(output);
    }
    result
}

/// Executa o job de Transcrição da fila com o Motor local.
pub(crate) fn run(
    id: i64,
    source_id: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    preview::check(id, stop)?;
    let (engine, model) = projects::with_reader(|c| {
        c.query_row(
        "SELECT t.engine,t.model FROM transcripts t JOIN sources s ON t.source_id=s.id AND t.audio_track=s.audio_track WHERE s.id=?1",[source_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))
    })?;
    if engine == "groq" {
        let mut engine = groq::GroqEngine::start()?;
        run_with(&mut engine, id, source_id, project, stop)
    } else if engine == "local" {
        let mut engine = LocalEngine::start_for(&model)?;
        run_with(&mut engine, id, source_id, project, stop)
    } else {
        Err(error("invalid_engine", "Motor de transcrição inválido."))
    }
}

pub fn run_with(
    engine: &mut dyn TranscriptionEngine,
    id: i64,
    source_id: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    preview::check(id, stop)?;
    let (source, _, track, duration, _) = preview::source(source_id, project)?;
    let (cache, _, ffmpeg) = crate::components::cache_settings()?;
    let ffmpeg =
        ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let work = cache.join("transcribe");
    fs::create_dir_all(&work).map_err(|_| audio_failed())?;
    let (transcript, duration_us) = projects::with_reader(|c| {
        c.query_row(
            "SELECT id, duration_us FROM transcripts WHERE source_id=?1 AND audio_track=?2",
            (source_id, track),
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .optional()
    })?
    .ok_or_else(|| error("transcript_missing", "Transcrição não encontrada."))?;
    if duration_us != duration {
        // A Fonte foi verificada de novo com outra duração desde que a Transcrição começou.
        return Err(error(
            "source_changed",
            "A Fonte está indisponível ou foi alterada.",
        ));
    }
    let wav = work.join(format!("job-{id}.wav"));
    let mut last_percentage = u8::MAX;
    loop {
        preview::check(id, stop)?;
        let resume = projects::with_reader(|c| {
            c.query_row(
                "SELECT resume_us FROM transcripts WHERE id=?1",
                [transcript],
                |r| r.get::<_, i64>(0),
            )
        })?;
        if resume >= duration_us {
            break;
        }
        let len = block_us().min(BLOCK_US).min(duration_us - resume);
        let final_block = resume + len >= duration_us;
        extract(
            &ffmpeg,
            &Slice {
                source: &source,
                track,
                start_us: resume,
                len_us: len,
            },
            &wav,
            id,
            stop,
        )?;
        engine.prepare(id, transcript, resume);
        let flag = AtomicBool::new(false);
        let finished = AtomicBool::new(false);
        let outcome = std::thread::scope(|scope| {
            scope.spawn(|| {
                while !finished.load(Ordering::SeqCst) {
                    if stop.load(Ordering::SeqCst) || is_cancelled(id) {
                        flag.store(true, Ordering::SeqCst);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            });
            let outcome = engine.transcribe_block(
                &BlockRequest {
                    audio: &wav,
                    final_block,
                },
                &flag,
                &mut |percent| {
                    let done = resume + len * i64::from(percent.min(100)) / 100;
                    let overall = (done * 100 / duration_us.max(1)).clamp(0, 99) as u8;
                    if overall != last_percentage {
                        last_percentage = overall;
                        let _ = jobs::progress(id, "transcribing", overall, "Transcrevendo");
                    }
                },
            );
            finished.store(true, Ordering::SeqCst);
            outcome
        });
        let _ = fs::remove_file(&wav);
        let block = match outcome {
            Err(e) if e.code == "cancelled" => {
                return Err(preview::check(id, stop).err().unwrap_or(e));
            }
            other => other?,
        };
        let config = engine.block_config();
        let step = Step {
            resume,
            len,
            final_block,
        };
        commit(id, transcript, step, duration_us, block, config)?;
    }
    crate::sentences::segment_transcript(transcript)?;
    // A energia do áudio (#54) é medida sozinha; falhar em enfileirar não afeta a Transcrição.
    crate::energy::enqueue_after_transcription(source_id);
    Ok(())
}

/// Grava as linhas do bloco, o novo ponto de retomada e o checkpoint do job numa só
/// transação: ou o bloco inteiro vale, ou nada vale.
/// Onde o bloco começa, quanto mede e se é o último da Fonte.
struct Step {
    resume: i64,
    len: i64,
    final_block: bool,
}

fn commit(
    job: i64,
    transcript: i64,
    step: Step,
    duration_us: i64,
    block: BlockResult,
    config: Option<(String, String)>,
) -> Result<(), CoreError> {
    let Step {
        resume,
        len,
        final_block,
    } = step;
    if block.covered_us == 0 && !final_block {
        return Err(bad_result());
    }
    let covered = if final_block {
        len
    } else {
        block.covered_us.min(len)
    };
    let next = resume + covered;
    // (ordem no mesmo instante, tipo, texto, início, fim, idioma)
    type Row<'a> = (i64, &'a str, &'a str, i64, i64, Option<&'a str>);
    let mut rows: Vec<Row<'_>> = Vec::new();
    for (start, end) in &block.silences {
        let (start, end) = (resume + start, resume + (*end).max(*start));
        if end > start {
            rows.push((0, "silence", "", start, end, None));
        }
    }
    for w in &block.words {
        rows.push((
            1,
            "word",
            &w.text,
            resume + w.start_us,
            resume + w.end_us,
            w.language.as_deref(),
        ));
    }
    rows.sort_by_key(|r| (r.3, r.0));
    let complete = next >= duration_us;
    projects::with_writer(|conn| {
        let tx = conn.transaction()?;
        tx.execute("INSERT OR REPLACE INTO transcription_blocks(transcript_id,start_us,end_us) VALUES (?1,?2,?3)",(transcript,resume,next))?;
        if let Some((device, compute_type)) = &config {
            tx.execute("INSERT OR REPLACE INTO transcription_block_config(transcript_id,start_us,device,compute_type) VALUES (?1,?2,?3,?4)", (transcript, resume, device, compute_type))?;
        }
        tx.execute("UPDATE transcription_calls SET state='completed' WHERE transcript_id=?1 AND job_id=?2 AND start_us=?3 AND state='pending'",(transcript,job,resume))?;
        let mut position: i64 = tx.query_row(
            "SELECT COALESCE(MAX(position)+1, 0) FROM transcript_words WHERE transcript_id=?1",
            [transcript],
            |r| r.get(0),
        )?;
        let mut tail: Option<(i64, String, i64)> = tx
            .query_row(
                "SELECT position, kind, end_us FROM transcript_words WHERE transcript_id=?1 ORDER BY position DESC LIMIT 1",
                [transcript],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        for (_, kind, text, start, end, language) in rows {
            if kind == "silence" {
                if let Some((last, last_kind, last_end)) = &tail {
                    if last_kind == "silence" && *last_end == start {
                        tx.execute(
                            "UPDATE transcript_words SET end_us=?3 WHERE transcript_id=?1 AND position=?2",
                            (transcript, last, end),
                        )?;
                        tail = Some((*last, "silence".into(), end));
                        continue;
                    }
                }
            }
            tx.execute(
                "INSERT INTO transcript_words(transcript_id, position, kind, text, start_us, end_us, language, speaker) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL)",
                (transcript, position, kind, text, start, end, language),
            )?;
            tail = Some((position, kind.into(), end));
            position += 1;
        }
        tx.execute(
            "UPDATE transcripts SET resume_us=?2, state=?3 WHERE id=?1",
            (
                transcript,
                next,
                if complete { "complete" } else { "running" },
            ),
        )?;
        tx.execute(
            "UPDATE jobs SET checkpoint=?2, progress=?3 WHERE id=?1 AND state='running'",
            (
                job,
                match &config {
                    Some((device, compute_type)) => {
                        json!({"resume_us": next, "device": device, "compute_type": compute_type})
                    }
                    None => json!({"resume_us": next}),
                }
                .to_string(),
                (next * 100 / duration_us.max(1)).clamp(0, 99),
            ),
        )?;
        tx.commit()
    })
}

fn project_job(v: &Value) -> Result<projects::ProjectJob, CoreError> {
    let job = projects::start_job()?;
    let requested = v["project"]
        .as_str()
        .ok_or_else(|| error("invalid_project", "Projeto obrigatório"))?;
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    if current["path"].as_str() != Some(requested) {
        return Err(error("invalid_project", "O Projeto não está aberto"));
    }
    Ok(job)
}

fn source_id(v: &Value) -> Result<i64, CoreError> {
    v["source_id"]
        .as_i64()
        .ok_or_else(|| error("source_missing", "Fonte não encontrada"))
}

/// `transcription.start`: enfileira (ou retoma) a Transcrição da Fonte, na faixa de
/// microfone que a Fonte guarda. Idempotente: com uma Transcrição completa, devolve-a;
/// com uma parcial (cancelada, falha, app fechado), um novo job continua do último bloco.
fn start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _job = project_job(&v)?;
    let source = source_id(&v)?;
    let (_, _, track, duration, _) =
        preview::source(source, Path::new(v["project"].as_str().unwrap_or_default()))?;
    let existing = projects::with_reader(|c| {
        c.query_row(
            "SELECT id,state,engine,model FROM transcripts WHERE source_id=?1 AND audio_track=?2",
            (source, track),
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
    })?;
    let engine = match v.get("engine") {
        None | Some(Value::Null) => existing.as_ref().map_or("local", |t| t.2.as_str()),
        Some(Value::String(e)) if e == "local" || e == "groq" => e.as_str(),
        _ => return Err(error("invalid_engine", "Motor de transcrição inválido.")),
    };
    if !matches!(engine, "local" | "groq") {
        return Err(error("invalid_engine", "Motor de transcrição inválido."));
    }
    let batch = match v.get("batch") {
        None | Some(Value::Null) => None,
        Some(Value::String(b)) if !b.is_empty() && b.len() <= 80 => Some(b.clone()),
        _ => return Err(error("invalid_batch", "Lote inválido.")),
    };
    let engine_switch = existing.as_ref().is_some_and(|t| t.2 != engine);
    // Escolha manual de outro modelo (#50): o modelo da Transcrição nunca muda sozinho; só a
    // troca manual de uma parcial, com confirmação, recomeça do zero. Numa completa a troca
    // vale só para uma retranscrição futura e não mexe na atual.
    let model_switch = engine == "local"
        && existing.as_ref().is_some_and(|t| t.2 == "local")
        && crate::components::hardware::manual_model()
            .is_some_and(|m| existing.as_ref().is_some_and(|t| t.3 != m));
    let switching = engine_switch || model_switch;
    if engine_switch && existing.as_ref().is_some_and(|t| t.1 == "complete") {
        return Err(error(
            "transcript_complete",
            "Uma Transcrição completa não permite trocar o Motor.",
        ));
    }
    if existing.as_ref().is_some_and(|t| t.1 == "complete") {
        return Ok(
            json!({"transcript_id":existing.as_ref().unwrap().0,"state":"complete","job_id":null}),
        );
    }
    if engine == "groq" && projects::project_local_only()? {
        return Err(crate::provider::local_only_violation());
    }
    let active: Option<(i64, String)> = projects::with_reader(|c| {
        c.query_row(
        "SELECT id,state FROM jobs WHERE kind='transcription' AND source_id=?1 AND state IN ('queued','running','uncertain') ORDER BY id DESC LIMIT 1",[source],|r|Ok((r.get(0)?,r.get(1)?))).optional()
    })?;
    if switching && active.is_some() {
        return Err(error(
            "transcription_busy",
            "Encerre a tarefa antes de trocar o Motor.",
        ));
    }
    if active.as_ref().is_some_and(|j| j.1 == "uncertain") {
        return Err(error(
            "transcription_uncertain",
            "Confirme a repetição da chamada incerta na fila de tarefas.",
        ));
    }
    if switching && v["replace_confirmed"] != true {
        let mut e = error(
            "engine_change_confirmation",
            "Trocar o Motor ou o modelo apaga a Transcrição parcial.",
        );
        e.usage = Some(loss(existing.as_ref().unwrap().0)?);
        return Err(e);
    }
    if let Some((transcript, _, _, _)) = existing
        .as_ref()
        .filter(|_| !switching && active.is_none() && v["retry_confirmed"] != true)
    {
        let duration = projects::with_reader(|c| {
            c.query_row(
                "SELECT end_us-start_us FROM transcription_calls WHERE transcript_id=?1 AND start_us=(SELECT resume_us FROM transcripts WHERE id=?1) AND state IN ('pending','uncertain') ORDER BY id DESC LIMIT 1",
                [transcript], |r|r.get::<_,i64>(0)).optional()
        })?;
        if let Some(duration) = duration {
            let mut e = error(
                "transcription_retry_confirmation",
                "O resultado da chamada é incerto. Repetir pode gerar nova cobrança.",
            );
            e.usage = Some(json!({"estimate":groq::estimate_cost(groq::MODEL,duration)}));
            return Err(e);
        }
    }
    if engine == "groq" {
        remote::guard()?;
        if groq::get_key()?.is_none() {
            return Err(error("groq_key_missing", "Configure a chave do Groq."));
        }
    }
    let (cache, _, ffmpeg) = crate::components::cache_settings()?;
    if ffmpeg.is_none() || cache.as_os_str().is_empty() {
        return Err(error("component_missing", "Instale o Componente FFmpeg."));
    }
    let selection = if engine == "local" && (existing.is_none() || switching) {
        Some(models::selection()?)
    } else {
        None
    };
    let (model, revision, compute) = if let Some(selection) = &selection {
        (
            selection.spec.id,
            selection.spec.revision,
            selection.config.compute_type.as_str(),
        )
    } else {
        (groq::MODEL, "", "remote")
    };
    let (transcript, state, job) = projects::with_writer(|conn| {
        let tx = conn.transaction()?;
        if switching {
            tx.execute(
                "DELETE FROM transcripts WHERE id=?1",
                [existing.as_ref().unwrap().0],
            )?;
        }
        tx.execute(
            "INSERT OR IGNORE INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,duration_us) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            (source,track,engine,model,revision,compute,duration),
        )?;
        let (transcript, state): (i64, String) = tx.query_row(
            "SELECT id,state FROM transcripts WHERE source_id=?1 AND audio_track=?2",
            (source, track),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut job = active.as_ref().map(|j| j.0);
        if job.is_none() {
            tx.execute("INSERT INTO jobs(kind,safety,state,source_id,batch) VALUES ('transcription',?1,'queued',?2,?3)",(if engine == "groq" {"paid"} else {"local"},source,batch.as_deref()))?;
            job = Some(tx.last_insert_rowid());
        } else if let Some(batch) = batch.as_deref() {
            // Um lote de Fontes (#56) adota o job ativo: a pausa do lote vale para ele também.
            tx.execute(
                "UPDATE jobs SET batch=?2 WHERE id=?1 AND batch IS NULL",
                (job, batch),
            )?;
        }
        tx.commit()?;
        Ok((transcript, state, job))
    })?;
    let warnings = if engine == "local" {
        crate::components::hardware::current_start_warnings()
    } else {
        Vec::new()
    };
    Ok(json!({"transcript_id": transcript, "state": state, "job_id": job, "warnings": warnings}))
}

/// Custo máximo estimado (µUS$) do áudio que falta transcrever da Fonte no Groq; `None` se o
/// preço é desconhecido. O lote de Fontes (#56) o confere contra o teto antes de começar.
pub(crate) fn paid_audio_estimate_micro(source_id: i64) -> Option<i64> {
    let remaining = projects::with_reader(|c| {
        c.query_row(
            "SELECT COALESCE((SELECT t.duration_us-t.resume_us FROM transcripts t WHERE t.source_id=s.id AND t.audio_track=s.audio_track),s.duration_us) FROM sources s WHERE s.id=?1",
            [source_id],
            |r| r.get::<_, i64>(0),
        )
    })
    .ok()?;
    groq::estimate_cost(groq::MODEL, remaining.max(0))["maxMicroUsd"].as_i64()
}

fn loss(transcript: i64) -> Result<Value, CoreError> {
    projects::with_reader(|c| {
        c.query_row("SELECT CASE WHEN resume_us>0 AND NOT EXISTS (SELECT 1 FROM transcription_blocks WHERE transcript_id=?1) THEN NULL ELSE (SELECT COUNT(*) FROM transcription_blocks WHERE transcript_id=?1) END,COALESCE((SELECT SUM(end_us-start_us) FROM transcription_calls WHERE transcript_id=?1 AND state IN ('pending','completed','uncertain')),0),COALESCE((SELECT SUM(estimated_usd) FROM transcription_calls WHERE transcript_id=?1 AND state IN ('pending','completed','uncertain')),0) FROM transcripts WHERE id=?1",[transcript],|r|Ok(json!({"blocks":r.get::<_,Option<i64>>(0)?,"paid_audio_us":r.get::<_,i64>(1)?,"paid_usd":r.get::<_,f64>(2)?})))
    })
}

/// `transcription.status`: estado da Transcrição da Fonte e do job mais recente.
fn status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = source_id(&v)?;
    projects::with_reader(|c| {
        let transcript = c
            .query_row(
                "SELECT t.id, t.state, t.resume_us, t.duration_us, t.model, t.engine, (SELECT COUNT(*) FROM transcript_words w WHERE w.transcript_id=t.id AND w.kind='word') FROM transcripts t WHERE t.source_id=?1 ORDER BY t.id LIMIT 1",
                [source],
                |r| {
                    Ok(json!({"id": r.get::<_, i64>(0)?, "state": r.get::<_, String>(1)?, "resume_us": r.get::<_, i64>(2)?, "duration_us": r.get::<_, i64>(3)?, "model": r.get::<_, String>(4)?, "engine": r.get::<_, String>(5)?, "words": r.get::<_, i64>(6)?}))
                },
            )
            .optional()?;
        let job = c
            .query_row(
                "SELECT id, state, progress FROM jobs WHERE kind='transcription' AND source_id=?1 ORDER BY id DESC LIMIT 1",
                [source],
                |r| Ok(json!({"id": r.get::<_, i64>(0)?, "state": r.get::<_, String>(1)?, "progress": r.get::<_, i64>(2)?})),
            )
            .optional()?;
        Ok(json!({"transcript": transcript, "job": job}))
    })
}

/// `transcription.blocks`: dispositivo e precisão de cada bloco concluído, para o diagnóstico
/// explicar diferenças entre blocos. Dado técnico, sem texto.
fn blocks(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = source_id(&v)?;
    projects::with_reader(|c| {
        let mut q = c.prepare("SELECT b.start_us,b.end_us,k.device,k.compute_type FROM transcription_blocks b JOIN transcripts t ON t.id=b.transcript_id LEFT JOIN transcription_block_config k ON k.transcript_id=b.transcript_id AND k.start_us=b.start_us WHERE t.source_id=?1 ORDER BY b.start_us")?;
        let rows = q.query_map([source], |r| {
            Ok(json!({"start_us": r.get::<_, i64>(0)?, "end_us": r.get::<_, i64>(1)?, "device": r.get::<_, Option<String>>(2)?, "compute_type": r.get::<_, Option<String>>(3)?}))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .map(Value::from)
}

/// `transcription.words`: linhas (palavras e silêncios) da Fonte que tocam o intervalo.
fn words(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = source_id(&v)?;
    let from = v["from_us"].as_i64().unwrap_or(0);
    let to = v["to_us"].as_i64().unwrap_or(i64::MAX);
    let limit = v["limit"].as_i64().unwrap_or(10_000).clamp(1, 100_000);
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT w.position, w.kind, COALESCE(w.corrected_text, w.text), w.start_us, w.end_us, w.language, w.speaker, w.text, w.corrected_text IS NOT NULL FROM transcript_words w JOIN transcripts t ON t.id=w.transcript_id WHERE t.source_id=?1 AND w.end_us>=?2 AND w.start_us<=?3 ORDER BY w.position LIMIT ?4",
        )?;
        let rows = q.query_map((source, from, to, limit), |r| {
            Ok(json!({"position": r.get::<_, i64>(0)?, "kind": r.get::<_, String>(1)?, "text": r.get::<_, String>(2)?, "start_us": r.get::<_, i64>(3)?, "end_us": r.get::<_, i64>(4)?, "language": r.get::<_, Option<String>>(5)?, "speaker": r.get::<_, Option<String>>(6)?, "original_text": r.get::<_, String>(7)?, "corrected": r.get::<_, bool>(8)?}))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .map(Value::from)
}

inventory::submit! { CommandRegistration { name: "transcription.start", execute: start } }
inventory::submit! { CommandRegistration { name: "transcription.status", execute: status } }
inventory::submit! { CommandRegistration { name: "transcription.words", execute: words } }
inventory::submit! { CommandRegistration { name: "transcription.blocks", execute: blocks } }

#[cfg(test)]
mod groq_tests;

mod estimate;
mod groq;
pub use groq::GroqEngine;

mod remote;
pub(crate) use remote::job_estimate;
