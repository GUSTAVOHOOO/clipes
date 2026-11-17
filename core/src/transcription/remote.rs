//! Consentimento por endpoint e checkpoints das chamadas pagas do Motor.
use super::*;
use std::path::PathBuf;

inventory::submit! { projects::Migration { id: "0051_001_transcription_calls", sql: "CREATE TABLE transcription_calls (id INTEGER PRIMARY KEY, transcript_id INTEGER REFERENCES transcripts(id) ON DELETE SET NULL, job_id INTEGER NOT NULL REFERENCES jobs(id), start_us INTEGER NOT NULL, end_us INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','completed','failed','uncertain')), estimated_usd REAL); CREATE TABLE transcription_blocks (transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE, start_us INTEGER NOT NULL, end_us INTEGER NOT NULL, PRIMARY KEY(transcript_id,start_us));" } }

fn consent_path() -> Result<PathBuf, CoreError> {
    crate::paths::config_file("transcription-consent.json")
        .map_err(|_| error("settings", "Configurações indisponíveis."))
}

fn consents() -> Result<Value, CoreError> {
    match fs::read(consent_path()?) {
        Ok(bytes) => serde_json::from_slice::<std::collections::BTreeMap<String, bool>>(&bytes)
            .map(|value| json!(value))
            .map_err(|_| error("settings", "Não foi possível ler o consentimento.")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(_) => Err(error("settings", "Não foi possível ler o consentimento.")),
    }
}

pub(super) fn guard() -> Result<(), CoreError> {
    if projects::project_local_only()? {
        return Err(crate::provider::local_only_violation());
    }
    if consents()?[groq::ENDPOINT] != true {
        return Err(error(
            "confirmation_required",
            "Confirme o envio do áudio ao Groq.",
        ));
    }
    Ok(())
}

fn confirm(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    if projects::project_local_only()? {
        return Err(crate::provider::local_only_violation());
    }
    if v["endpoint"] != groq::ENDPOINT || v["confirmed"] != true {
        return Err(error(
            "confirmation_required",
            "Confirme o envio do áudio ao Groq.",
        ));
    }
    let mut consent = consents()?;
    consent[groq::ENDPOINT] = json!(true);
    let path = consent_path()?;
    fs::create_dir_all(path.parent().unwrap())
        .and_then(|_| fs::write(path, consent.to_string()))
        .map_err(|_| error("settings", "Não foi possível salvar o consentimento."))?;
    Ok(json!({"confirmed":true}))
}

fn info(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!({"endpoint":groq::ENDPOINT,"model":groq::MODEL,
        "confirmed":consents()?[groq::ENDPOINT] == true,
        "configured":groq::get_key()?.is_some(),
        "local_only":projects::project_local_only()?,
        "prices":serde_json::from_str::<Value>(include_str!("groq-prices.json")).map_err(|_| bad_result())?}))
}

pub(super) fn begin(
    job: i64,
    transcript: i64,
    start: i64,
    duration: i64,
    endpoint: &str,
    audio: &[u8],
    language: Option<&str>,
) -> Result<i64, CoreError> {
    guard()?;
    let estimate = groq::estimate_cost(groq::MODEL, duration);
    let batch: Option<String> = projects::with_reader(|c| {
        c.query_row("SELECT batch FROM jobs WHERE id=?1", [job], |r| r.get(0))
    })?;
    if let Some(batch) = batch {
        let next = estimate["maxMicroUsd"].as_i64().ok_or_else(bad_result)?;
        if let Some(code) = jobs::audio_precheck(&batch, next)? {
            jobs::pause_scope("batch", &batch, code);
            return Err(error(code, "O teto de custo do lote foi atingido."));
        }
    }
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute("INSERT INTO transcription_calls(transcript_id,job_id,start_us,end_us,state,estimated_usd,created_at) VALUES (?1,?2,?3,?4,'pending',?5,?6)",
            (transcript, job, start, start + duration, estimate["usd"].as_f64(), crate::provider::cost::now_micros()))?;
        let call = tx.last_insert_rowid();
        // Trilha de auditoria (#125), na mesma transação da chamada: só hashes e metadados.
        tx.execute(
            "INSERT INTO call_audit(transcription_call_id,provider_kind,host,model,input_sha256,sent_bytes) VALUES (?1,'transcription',?2,?3,?4,?5)",
            (
                call,
                groq::host_of(endpoint),
                groq::MODEL,
                crate::provider::cost::sha256_hex(audio),
                (groq::multipart_body(&[], language).len() + audio.len()) as i64,
            ),
        )?;
        tx.execute(
            "UPDATE jobs SET checkpoint=?2 WHERE id=?1 AND state='running'",
            (
                job,
                json!({"resume_us":start,"call_id":call,"audio_us":duration,"estimate":estimate})
                    .to_string(),
            ),
        )?;
        tx.commit()?;
        Ok(call)
    })
}

/// Guarda o hash do corpo da resposta recebida na linha de auditoria da chamada.
pub(super) fn audit_response(call: i64, response_sha256: Option<String>) {
    if let Some(hash) = response_sha256 {
        let _ = projects::with_writer(|c| {
            c.execute(
                "UPDATE call_audit SET response_sha256=?2 WHERE transcription_call_id=?1",
                (call, hash),
            )?;
            Ok(())
        });
    }
}

pub(super) fn failed(call: i64, uncertain: bool) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        c.execute(
            "UPDATE transcription_calls SET state=?2 WHERE id=?1",
            (call, if uncertain { "uncertain" } else { "failed" }),
        )?;
        Ok(())
    })
}

pub(crate) fn job_estimate(id: i64) -> Option<Value> {
    projects::with_reader(|c| {
        c.query_row("SELECT end_us-start_us FROM transcription_calls WHERE job_id=?1 AND state IN ('pending','uncertain') ORDER BY id DESC LIMIT 1",[id],|r|r.get::<_,i64>(0))
    }).ok().map(|duration| groq::estimate_cost(groq::MODEL,duration))
}

fn estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = source_id(&v)?;
    let (duration, resume) = projects::with_reader(|c| {
        c.query_row("SELECT s.duration_us,COALESCE((SELECT t.resume_us FROM transcripts t WHERE t.source_id=s.id AND t.audio_track=s.audio_track),0) FROM sources s WHERE id=?1",[source],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?)))
    })?;
    Ok(groq::estimate_cost(groq::MODEL, (duration - resume).max(0)))
}
inventory::submit! { CommandRegistration { name: "transcription.groq.confirm", execute: confirm } }
inventory::submit! { CommandRegistration { name: "transcription.groq.info", execute: info } }
inventory::submit! { CommandRegistration { name: "transcription.groq.estimate", execute: estimate } }
