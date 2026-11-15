//! Energia do áudio (#54): os picos de volume da Fonte (gritos, risadas) viram uma marca
//! discreta por Frase no texto enviado ao Provedor e alimentam o eixo Emoção/energia (#19).
//!
//! **Medida.** O job `energy` (local, na fila do Projeto, cancelável, com progresso) pede ao
//! FFmpeg só a decodificação da faixa de microfone da Fonte (mono, 16 kHz, PCM de 16 bits, por
//! `pipe:1`, como a onda do #43). O núcleo mede a loudness em blocos de 100 ms e, por Frase, usa
//! o **maior momentâneo** (janela de 400 ms, como o `M` do EBU R128) que toca a Frase: um grito
//! ou uma risada são curtos, e a média da Frase os diluiria. Sem ponderação K (o sinal é só
//! relativo à própria Fonte, então a curva absoluta não importa). O valor guardado é dBFS em
//! centésimos. O áudio nunca sai da máquina e só o número por Frase fica no Projeto.
//!
//! **Marca.** O rótulo é função pura da distribuição da própria Fonte ([`levels`]), sempre
//! calculado na leitura a partir dos números gravados; mudar uma constante não exige remedir.
//! Só `high` e `peak` aparecem no texto ([`mark`]); os demais níveis são "normal".
//!
//! A seleção não espera este job: sem medida, roda sem marcas e o resumo da execução diz isso.

use crate::{
    jobs::{self, preview},
    projects, CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path, sync::atomic::AtomicBool};

/// Tipo do job na fila.
pub const JOB_KIND: &str = "energy";
/// Versão do método de medida; uma medida de outra versão é refeita.
pub const METHOD: i64 = 1;

/// Taxa de amostragem pedida ao FFmpeg (mono, `s16le`).
pub const SAMPLE_RATE: u32 = 16_000;
/// Duração de um bloco de medida.
pub const BLOCK_US: i64 = 100_000;
/// Blocos de um instante "momentâneo" (400 ms).
pub const MOMENTARY_BLOCKS: usize = 4;
/// Piso da medida: bloco mudo e Frase sem áudio.
pub const SILENCE_FLOOR_CENTI: i64 = -12_000;

/// Menos Frases medidas que isto: percentis não significam nada e ninguém recebe marca.
pub const MIN_LABELED_SENTENCES: usize = 8;
/// `high` precisa passar do percentil 80 da Fonte (estritamente)...
pub const HIGH_PERCENTILE: usize = 80;
/// ... e ficar pelo menos 3 dB acima da mediana (centésimos de dB).
pub const HIGH_MIN_RISE_CENTI: i64 = 300;
/// `peak` precisa passar do percentil 95 da Fonte (estritamente)...
pub const PEAK_PERCENTILE: usize = 95;
/// ... e ficar pelo menos 6 dB acima da mediana.
pub const PEAK_MIN_RISE_CENTI: i64 = 600;
/// `low` fica abaixo do percentil 20 e pelo menos 3 dB abaixo da mediana.
pub const LOW_PERCENTILE: usize = 20;
pub const LOW_MIN_DROP_CENTI: i64 = 300;

/// Nível de energia de uma Frase, relativo à própria Fonte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EnergyLevel {
    Low,
    Mid,
    High,
    Peak,
}

impl EnergyLevel {
    pub fn label(self) -> &'static str {
        match self {
            EnergyLevel::Low => "low",
            EnergyLevel::Mid => "mid",
            EnergyLevel::High => "high",
            EnergyLevel::Peak => "peak",
        }
    }
}

/// Marcas por ID de Frase. Só `High` e `Peak` entram (Frase sem marca é normal).
pub type EnergyMarks = BTreeMap<i64, EnergyLevel>;

/// **A marca do texto enviado ao Provedor**, num lugar só: o serializador compacto (#140) e o
/// chat futuro (#151) a reaproveitam. ASCII, sem número de loudness e sem tempo. Devolve `None`
/// para a Frase normal.
pub fn mark(level: EnergyLevel) -> Option<&'static str> {
    match level {
        EnergyLevel::High => Some("[energia alta]"),
        EnergyLevel::Peak => Some("[energia pico]"),
        EnergyLevel::Low | EnergyLevel::Mid => None,
    }
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn energy_failed() -> CoreError {
    error(
        "energy_failed",
        "Não foi possível medir a energia do áudio da Fonte.",
    )
}

inventory::submit! { projects::Migration { id: "0054_001_sentence_energy", sql: "
CREATE TABLE energy_measurements (
  transcript_id INTEGER PRIMARY KEY REFERENCES transcripts(id) ON DELETE CASCADE,
  method INTEGER NOT NULL,
  sentences INTEGER NOT NULL,
  measured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sentence_energy (
  transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  sentence_id INTEGER NOT NULL,
  loudness_centi INTEGER NOT NULL,
  PRIMARY KEY (transcript_id, sentence_id)
) WITHOUT ROWID;
ALTER TABLE selection_runs ADD COLUMN energy_marks INTEGER NOT NULL DEFAULT 0;
" } }

// ---------------------------------------------------------------- medida (pura)

/// Acumula PCM `s16le` mono em blocos de [`BLOCK_US`] e guarda a energia média (amostra²) de cada um.
pub struct BlockMeter {
    block_samples: usize,
    pending: Option<u8>,
    sum: f64,
    count: usize,
    blocks: Vec<f64>,
}

impl Default for BlockMeter {
    fn default() -> Self {
        Self::new(SAMPLE_RATE)
    }
}

impl BlockMeter {
    pub fn new(sample_rate: u32) -> Self {
        BlockMeter {
            block_samples: (i64::from(sample_rate) * BLOCK_US / 1_000_000).max(1) as usize,
            pending: None,
            sum: 0.0,
            count: 0,
            blocks: Vec::new(),
        }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        for &b in bytes {
            let Some(first) = self.pending.take() else {
                self.pending = Some(b);
                continue;
            };
            let sample = f64::from(i16::from_le_bytes([first, b]));
            self.sum += sample * sample;
            self.count += 1;
            if self.count == self.block_samples {
                self.close_block();
            }
        }
    }

    fn close_block(&mut self) {
        self.blocks.push(self.sum / self.count as f64);
        self.sum = 0.0;
        self.count = 0;
    }

    /// Fecha o bloco parcial final e devolve a energia média de cada bloco.
    pub fn finish(mut self) -> Vec<f64> {
        if self.count > 0 {
            self.close_block();
        }
        self.blocks
    }
}

/// dBFS em centésimos de uma energia média de amostra² (16 bits), limitada pelo piso.
fn centi_db(mean_square: f64) -> i64 {
    if !(mean_square.is_finite() && mean_square > 0.0) {
        return SILENCE_FLOOR_CENTI;
    }
    let full_scale = 32768.0_f64 * 32768.0;
    ((1000.0 * (mean_square / full_scale).log10()).round() as i64).max(SILENCE_FLOOR_CENTI)
}

/// Loudness da Frase: o maior momentâneo (400 ms) entre os blocos que ela toca. Frase mais curta
/// que a janela usa a média dos blocos que tem. `None` quando não há áudio medido na faixa dela.
pub fn sentence_loudness(blocks: &[f64], start_us: i64, end_us: i64) -> Option<i64> {
    let first = (start_us.max(0) / BLOCK_US) as usize;
    let last = (end_us.max(start_us.max(0) + 1) as u64).div_ceil(BLOCK_US as u64) as usize;
    let last = last.min(blocks.len());
    if first >= last {
        return None;
    }
    let span = &blocks[first..last];
    let mean = |w: &[f64]| w.iter().sum::<f64>() / w.len() as f64;
    let loudest = if span.len() <= MOMENTARY_BLOCKS {
        mean(span)
    } else {
        span.windows(MOMENTARY_BLOCKS)
            .map(mean)
            .fold(0.0_f64, f64::max)
    };
    Some(centi_db(loudest))
}

fn percentile(sorted: &[i64], percent: usize) -> i64 {
    sorted[(sorted.len() - 1) * percent / 100]
}

/// Níveis das Frases a partir da loudness de cada uma (`None`: sem medida). **Relativo à
/// própria Fonte**: as constantes acima são os únicos limiares. Frase sem medida ou muda
/// (piso) fica `Mid` e não entra nas estatísticas. Com menos de [`MIN_LABELED_SENTENCES`]
/// Frases medidas, todas ficam `Mid`. As comparações são estritas e exigem uma distância
/// mínima da mediana, para uma Fonte sem variação nunca ter `peak`.
pub fn levels(loudness: &[Option<i64>]) -> Vec<EnergyLevel> {
    let mut sorted: Vec<i64> = loudness
        .iter()
        .flatten()
        .copied()
        .filter(|v| *v > SILENCE_FLOOR_CENTI)
        .collect();
    if sorted.len() < MIN_LABELED_SENTENCES {
        return vec![EnergyLevel::Mid; loudness.len()];
    }
    sorted.sort_unstable();
    let median = percentile(&sorted, 50);
    let (low, high, peak) = (
        percentile(&sorted, LOW_PERCENTILE),
        percentile(&sorted, HIGH_PERCENTILE),
        percentile(&sorted, PEAK_PERCENTILE),
    );
    loudness
        .iter()
        .map(|v| match v {
            Some(v) if *v > SILENCE_FLOOR_CENTI => {
                if *v > peak && *v - median >= PEAK_MIN_RISE_CENTI {
                    EnergyLevel::Peak
                } else if *v > high && *v - median >= HIGH_MIN_RISE_CENTI {
                    EnergyLevel::High
                } else if *v < low && median - *v >= LOW_MIN_DROP_CENTI {
                    EnergyLevel::Low
                } else {
                    EnergyLevel::Mid
                }
            }
            _ => EnergyLevel::Mid,
        })
        .collect()
}

// ---------------------------------------------------------------- persistência

struct Target {
    transcript: i64,
    complete: bool,
}

fn target_of(source: i64) -> Result<Target, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT t.id, t.state='complete' FROM transcripts t JOIN sources s ON t.source_id=s.id AND t.audio_track=s.audio_track WHERE s.id=?1",
            [source],
            |r| Ok(Target { transcript: r.get(0)?, complete: r.get(1)? }),
        )
        .optional()
    })?
    .ok_or_else(|| error("transcript_missing", "Transcrição não encontrada."))
}

fn is_measured(transcript: i64) -> Result<bool, CoreError> {
    Ok(projects::with_reader(|c| {
        c.query_row(
            "SELECT method FROM energy_measurements WHERE transcript_id=?1",
            [transcript],
            |r| r.get::<_, i64>(0),
        )
        .optional()
    })? == Some(METHOD))
}

/// Marcas da Transcrição, ou `None` se a energia ainda não foi medida (a seleção então roda
/// sem marcas e diz isso no resumo).
pub(crate) fn load_marks(transcript: i64) -> Result<Option<EnergyMarks>, CoreError> {
    if !is_measured(transcript)? {
        return Ok(None);
    }
    let rows: Vec<(i64, i64)> = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT sentence_id, loudness_centi FROM sentence_energy WHERE transcript_id=?1 ORDER BY sentence_id",
        )?;
        let rows = q.query_map([transcript], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    let values: Vec<Option<i64>> = rows.iter().map(|r| Some(r.1)).collect();
    Ok(Some(
        rows.iter()
            .zip(levels(&values))
            .filter(|(_, level)| mark(*level).is_some())
            .map(|(row, level)| (row.0, level))
            .collect(),
    ))
}

/// Enfileira o job de energia da Fonte, sem duplicar: se já está medida, na fila ou rodando,
/// devolve o estado. Exige Transcrição completa.
pub(crate) fn enqueue(source: i64) -> Result<(&'static str, Option<i64>), CoreError> {
    let target = target_of(source)?;
    if !target.complete {
        return Err(error(
            "transcript_incomplete",
            "A Transcrição ainda não está completa.",
        ));
    }
    if is_measured(target.transcript)? {
        return Ok(("measured", None));
    }
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM jobs WHERE kind='energy' AND source_id=?1 AND state IN ('queued','running') ORDER BY id LIMIT 1",
                [source],
                |r| r.get(0),
            )
            .optional()?;
        let out = if let Some(id) = existing {
            ("queued", Some(id))
        } else {
            tx.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('energy','local','queued',?1)",
                [source],
            )?;
            ("queued", Some(tx.last_insert_rowid()))
        };
        tx.commit()?;
        Ok(out)
    })
}

/// Chamado ao fim da Transcrição: um erro aqui nunca derruba a Transcrição.
pub(crate) fn enqueue_after_transcription(source: i64) {
    let _ = enqueue(source);
}

// ---------------------------------------------------------------- o job

fn bytes_per_second() -> u64 {
    u64::from(SAMPLE_RATE) * 2
}

/// Executa o job: decodifica a faixa, mede, grava as séries numa só transação. Idempotente.
pub(crate) fn run(
    id: i64,
    source_id: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    preview::check(id, stop)?;
    let target = target_of(source_id)?;
    if !target.complete {
        return Err(error(
            "transcript_incomplete",
            "A Transcrição ainda não está completa.",
        ));
    }
    if is_measured(target.transcript)? {
        return Ok(());
    }
    let (source, hash, audio, duration, _) = preview::source(source_id, project)?;
    let (_, _, ffmpeg) = crate::components::cache_settings()?;
    let ffmpeg =
        ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let args = vec![
        "-v".into(),
        "error".into(),
        "-i".into(),
        source.as_os_str().to_owned(),
        "-map".into(),
        format!("0:{audio}").into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        SAMPLE_RATE.to_string().into(),
        "-f".into(),
        "s16le".into(),
        "pipe:1".into(),
    ];
    let mut meter = BlockMeter::default();
    let total = (duration.max(1) as u64).saturating_mul(bytes_per_second()) / 1_000_000;
    let (mut seen, mut last) = (0_u64, u8::MAX);
    jobs::progress(id, "energy", 0, "Medindo a energia do áudio")?;
    preview::run_process_as(&ffmpeg, args, id, stop, energy_failed, |bytes| {
        meter.push(bytes);
        seen += bytes.len() as u64;
        let pct = (seen.saturating_mul(98) / total.max(1)).min(98) as u8;
        if pct != last {
            last = pct;
            let _ = jobs::progress(id, "energy", pct, "Medindo a energia do áudio");
        }
    })?;
    preview::check(id, stop)?;
    let blocks = meter.finish();
    let (current_hash, current_audio) = {
        let (_, h, a, _, _) = preview::source(source_id, project)?;
        (h, a)
    };
    if current_hash != hash || current_audio != audio {
        return Err(error(
            "source_changed",
            "A Fonte está indisponível ou foi alterada.",
        ));
    }
    store(target.transcript, &blocks)
}

/// Mede cada Frase da Transcrição sobre os blocos e grava tudo numa só transação.
pub(crate) fn store(transcript: i64, blocks: &[f64]) -> Result<(), CoreError> {
    let frases = crate::sentences::load_for(transcript)?;
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "DELETE FROM sentence_energy WHERE transcript_id=?1",
            [transcript],
        )?;
        let mut insert = tx.prepare(
            "INSERT INTO sentence_energy(transcript_id,sentence_id,loudness_centi) VALUES (?1,?2,?3)",
        )?;
        for s in &frases {
            let loudness =
                sentence_loudness(blocks, s.start_us, s.end_us).unwrap_or(SILENCE_FLOOR_CENTI);
            insert.execute((transcript, s.id, loudness))?;
        }
        drop(insert);
        tx.execute(
            "INSERT INTO energy_measurements(transcript_id,method,sentences) VALUES (?1,?2,?3) ON CONFLICT(transcript_id) DO UPDATE SET method=excluded.method, sentences=excluded.sentences, measured_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            (transcript, METHOD, frases.len() as i64),
        )?;
        tx.commit()?;
        Ok(())
    })
}

// ---------------------------------------------------------------- comandos

fn source_of(v: &Value) -> Result<i64, CoreError> {
    v["source_id"]
        .as_i64()
        .ok_or_else(|| error("source_missing", "Fonte não encontrada"))
}

/// `energy.start {source_id}`: enfileira a medida da energia do áudio (idempotente). O job
/// também é enfileirado sozinho quando a Transcrição fica completa.
fn start_command(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let (state, job) = enqueue(source_of(&v)?)?;
    Ok(json!({"state": state, "job": job}))
}

/// `energy.status {source_id}`: `measured`, contagem de marcas por nível e o job em andamento.
fn status_command(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = source_of(&v)?;
    let target = target_of(source)?;
    let marks = load_marks(target.transcript)?;
    let count = |level| {
        marks
            .as_ref()
            .map_or(0, |m| m.values().filter(|l| **l == level).count())
    };
    let job: Option<Value> = projects::with_reader(|c| {
        c.query_row(
            "SELECT id,state,progress FROM jobs WHERE kind='energy' AND source_id=?1 ORDER BY id DESC LIMIT 1",
            [source],
            |r| Ok(json!({"id": r.get::<_, i64>(0)?, "state": r.get::<_, String>(1)?, "progress": r.get::<_, i64>(2)?})),
        )
        .optional()
    })?;
    Ok(json!({
        "measured": marks.is_some(),
        "marks": {"high": count(EnergyLevel::High), "peak": count(EnergyLevel::Peak)},
        "job": job,
    }))
}

inventory::submit! { CommandRegistration { name: "energy.start", execute: start_command } }
inventory::submit! { CommandRegistration { name: "energy.status", execute: status_command } }

#[cfg(test)]
mod tests;
