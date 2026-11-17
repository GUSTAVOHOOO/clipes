//! Runner headless do benchmark de seleção (#57).
//!
//! Usa exclusivamente o núcleo (`clipes_core`), o despacho compartilhado (`dispatch`), o Motor
//! local em GPU e o adaptador HTTP do Groq dentro de um `CLIPES_DATA_DIR` isolado. Não grava
//! dados no repositório e nunca imprime chaves de API, trechos de Transcrição ou IDs de vídeo
//! nos resultados exportados.
use clipes_core::{
    chat, dispatch, projects,
    selection::benchmark::{
        aggregate_metrics, evaluate_source, grid_search_chat, CandidateSpan, ChatCalibrationParams,
        CostCounts, GroundTruthClip, ProviderCostTiming, RecallMetrics, SentenceSpan,
    },
    transcription::{run_with, LocalEngine},
    worker::WorkerClient,
    CoreError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::AtomicBool,
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Result<Value, String> {
    dispatch(name, args, &mut |_| {}).map_err(|e: CoreError| format!("{}: {}", e.code, e.message))
}

#[derive(Deserialize)]
struct Manifest {
    items: Vec<ManifestItem>,
}

#[derive(Deserialize)]
struct ManifestItem {
    url: String,
    duration_seconds: i64,
    file: String,
    #[serde(default)]
    idiomas_provisorios: Vec<String>,
    #[serde(default)]
    clips: Vec<ManifestClip>,
}

#[derive(Deserialize)]
struct ManifestClip {
    start: f64,
    end: f64,
}

impl ManifestItem {
    fn language(&self) -> &str {
        self.idiomas_provisorios
            .first()
            .map(String::as_str)
            .unwrap_or("en")
    }
    fn ground_truth(&self) -> Vec<GroundTruthClip> {
        self.clips
            .iter()
            .map(|c| GroundTruthClip {
                start_us: (c.start * 1_000_000.0).round() as i64,
                end_us: (c.end * 1_000_000.0).round() as i64,
            })
            .collect()
    }
}

fn load_lives(manifest_path: &Path) -> Result<Vec<ManifestItem>, String> {
    let raw = fs::read(manifest_path).map_err(|e| format!("manifesto ilegível: {e}"))?;
    let m: Manifest =
        serde_json::from_slice(&raw).map_err(|e| format!("manifesto inválido: {e}"))?;
    Ok(m.items
        .into_iter()
        .filter(|i| !i.clips.is_empty())
        .collect())
}

fn setup_env(data_dir: &Path, ffmpeg: Option<&Path>) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|e| format!("falha ao criar data_dir: {e}"))?;
    std::env::set_var("CLIPES_DATA_DIR", data_dir);
    if let Some(ffmpeg) = ffmpeg {
        let ffprobe = ffmpeg.with_file_name(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        });
        std::env::set_var("CLIPES_FFPROBE", &ffprobe);
        call(
            "components.settings.set",
            json!({
                "data_dir": data_dir,
                "cache_dir": data_dir.join("cache"),
                "cache_limit_bytes": 4_000_000_000_i64,
                "ffmpeg_path": ffmpeg,
            }),
        )?;
    }
    Ok(())
}

fn start_real_worker(python: &Path) -> Result<WorkerClient, String> {
    let venv = python
        .parent()
        .and_then(|p| p.parent())
        .ok_or("caminho inválido para python do worker")?
        .to_owned();
    let worker_src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../worker/src");
    WorkerClient::start(python, ["-m", "clipes_worker"], |c: &mut Command| {
        for key in ["PYTHONHOME", "VIRTUAL_ENV", "CONDA_PREFIX"] {
            c.env_remove(key);
        }
        c.env("PYTHONPATH", &worker_src)
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONUTF8", "1")
            .env("PYTHONUNBUFFERED", "1");
        let nvidia: Vec<PathBuf> = ["cublas", "cudnn"]
            .iter()
            .map(|lib| venv.join("Lib/site-packages/nvidia").join(lib).join("bin"))
            .filter(|p| p.is_dir())
            .collect();
        if !nvidia.is_empty() {
            let mut paths = nvidia;
            paths.extend(std::env::split_paths(
                &std::env::var_os("PATH").unwrap_or_default(),
            ));
            if let Ok(joined) = std::env::join_paths(paths) {
                c.env("PATH", joined);
            }
        }
    })
    .map_err(|e| format!("worker falhou: {}: {}", e.code, e.message))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourcePrepStat {
    source_index: usize,
    source_id: i64,
    language: String,
    duration_us: i64,
    has_chat: bool,
    transcribe_ms: u64,
    rtf: f64,
    sentence_count: usize,
    energy_ms: u64,
    energy_high: usize,
    energy_peak: usize,
    chat_ms: u64,
    chat_peaks: usize,
}

fn wait_for_job(kind: &str, source_id: i64, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        let list = call("jobs.list", json!({}))?;
        let jobs = list.as_array().ok_or("jobs.list inválido")?;
        let found = projects::with_reader(|c| {
            c.query_row(
                "SELECT state FROM jobs WHERE kind=?1 AND source_id=?2 ORDER BY id DESC LIMIT 1",
                (kind, source_id),
                |r| r.get::<_, String>(0),
            )
        });
        let _ = jobs;
        match found {
            Ok(ref s) if s == "completed" => return Ok(()),
            Ok(ref s) if s == "failed" || s == "cancelled" || s == "uncertain" => {
                return Err(format!(
                    "job {kind} para source {source_id} terminou em {s}"
                ));
            }
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "timeout esperando job {kind} da source {source_id}"
            ));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn cmd_prepare(args: &[String]) -> Result<(), String> {
    if !(6..=7).contains(&args.len()) {
        return Err("Uso: prepare <manifest.json> <media-dir> <bench-dir> <python> <model-dir> <ffmpeg> [device]".into());
    }
    let manifest_path = PathBuf::from(&args[0]);
    let media_dir = PathBuf::from(&args[1])
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let bench_dir = PathBuf::from(&args[2]);
    let python = PathBuf::from(&args[3]);
    let model_dir = PathBuf::from(&args[4]);
    let ffmpeg = PathBuf::from(&args[5]);
    let device = args.get(6).map(String::as_str).unwrap_or("cuda");
    let (compute_type, batch) = if device == "cuda" {
        ("int8_float16", 1)
    } else {
        ("int8", 8)
    };

    fs::create_dir_all(&bench_dir).map_err(|e| e.to_string())?;
    let data_dir = bench_dir.join("data-prep");
    setup_env(&data_dir, Some(&ffmpeg))?;

    let project_path = bench_dir.join("bench.clipes");
    if project_path.exists() {
        call("projects.open", json!({"path": project_path}))?;
    } else {
        call(
            "projects.create",
            json!({"parent": bench_dir, "name": "bench"}),
        )?;
    }

    let lives = load_lives(&manifest_path)?;
    let mut stats = Vec::with_capacity(lives.len());

    let client = start_real_worker(&python)?;
    let mut engine = LocalEngine::with_worker(
        client,
        json!({"id":"real","dir":model_dir,"device":device,"compute_type":compute_type}),
        batch,
    );

    for (idx, item) in lives.iter().enumerate() {
        let media = media_dir
            .join(&item.file)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let media_str = media.to_string_lossy().to_string();
        let existing: Option<i64> = projects::with_reader(|c| {
            c.query_row(
                "SELECT id FROM sources WHERE path=?1 LIMIT 1",
                [&media_str],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
        })
        .map_err(|e| format!("{}: {}", e.code, e.message))?;

        let has_chat_file = chat::replay_path(&media).is_file();
        let source_id = if let Some(id) = existing {
            id
        } else {
            let inspected = call("sources.inspect", json!({"path": media}))?;
            let track = inspected["streams"]
                .as_array()
                .and_then(|s| s.iter().find(|st| st["codec_type"] == "audio"))
                .and_then(|st| st["index"].as_i64())
                .ok_or("faixa de áudio ausente")?;
            let mut import_args = json!({
                "project": project_path,
                "path": media,
                "permission": {"status": "none"},
                "audio_track": track,
                "language": item.language(),
            });
            if has_chat_file {
                import_args["origin_url"] = json!(item.url);
            }
            call("sources.import", import_args)?["id"]
                .as_i64()
                .ok_or("id da fonte inválido")?
        };

        let (t_state, duration_us) = projects::with_writer(|c| {
            let (track, duration): (i64, i64) = c.query_row(
                "SELECT audio_track, duration_us FROM sources WHERE id=?1",
                [source_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let existing: Option<String> = c
                .query_row(
                    "SELECT state FROM transcripts WHERE source_id=?1 AND audio_track=?2",
                    (source_id, track),
                    |r| r.get(0),
                )
                .map(Some)
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(other),
                })?;
            if existing.is_none() {
                c.execute(
                    "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,duration_us) VALUES (?1,?2,'local','whisper-turbo','0a363e91',?3,?4)",
                    (source_id, track, compute_type, duration),
                )?;
            }
            Ok((existing, duration))
        })
        .map_err(|e| format!("{}: {}", e.code, e.message))?;

        let mut transcribe_ms = 0_u64;
        if t_state.as_deref() != Some("complete") {
            let job = projects::with_writer(|c| {
                c.execute(
                    "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcribe-manual','local','running',?1)",
                    [source_id],
                )?;
                Ok(c.last_insert_rowid())
            })
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
            println!(
                "[prepare] Transcrevendo source_{idx} ({:.2}h, lang={}) na GPU...",
                duration_us as f64 / 3_600_000_000.0,
                item.language()
            );
            let started = Instant::now();
            run_with(
                &mut engine,
                job,
                source_id,
                &project_path,
                &AtomicBool::new(false),
            )
            .map_err(|e| format!("transcribe falhou: {}: {}", e.code, e.message))?;
            projects::with_writer(|c| {
                c.execute(
                    "UPDATE jobs SET state='completed', progress=100 WHERE id=?1",
                    [job],
                )?;
                Ok(())
            })
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
            transcribe_ms = started.elapsed().as_millis() as u64;
        }

        let seg = call("transcription.segment", json!({"source_id": source_id}))?;
        let sentence_count = seg["sentences"].as_u64().unwrap_or(0) as usize;

        let energy_started = Instant::now();
        let energy_status = call("energy.status", json!({"source_id": source_id}))?;
        if energy_status["measured"] != true {
            call("energy.start", json!({"source_id": source_id}))?;
            wait_for_job("energy", source_id, Duration::from_secs(1800))?;
        }
        let energy_ms = energy_started.elapsed().as_millis() as u64;
        let energy_after = call("energy.status", json!({"source_id": source_id}))?;

        let mut chat_ms = 0_u64;
        let mut chat_peaks = 0_usize;
        if has_chat_file {
            let chat_started = Instant::now();
            let cs = call("chat.status", json!({"source_id": source_id}))?;
            if cs["state"] == "none" {
                call("chat.fetch", json!({"source_id": source_id}))?;
            }
            if cs["state"] != "available" {
                wait_for_job("chat", source_id, Duration::from_secs(1800))?;
            }
            chat_ms = chat_started.elapsed().as_millis() as u64;
            let cs_after = call("chat.status", json!({"source_id": source_id}))?;
            chat_peaks = cs_after["peaks"].as_u64().unwrap_or(0) as usize;
        }

        let rtf = if duration_us > 0 && transcribe_ms > 0 {
            (transcribe_ms as f64 / 1000.0) / (duration_us as f64 / 1_000_000.0)
        } else {
            0.0
        };
        println!(
            "[prepare] source_{idx} pronto: sentences={sentence_count}, rtf={rtf:.3}, energy_ms={energy_ms}, chat_peaks={chat_peaks}"
        );
        stats.push(SourcePrepStat {
            source_index: idx,
            source_id,
            language: item.language().to_owned(),
            duration_us,
            has_chat: has_chat_file,
            transcribe_ms,
            rtf,
            sentence_count,
            energy_ms,
            energy_high: energy_after["high"].as_u64().unwrap_or(0) as usize,
            energy_peak: energy_after["peak"].as_u64().unwrap_or(0) as usize,
            chat_ms,
            chat_peaks,
        });
    }

    call("projects.close", json!({}))?;
    fs::write(
        bench_dir.join("prepare_stats.json"),
        serde_json::to_vec_pretty(&stats).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn cmd_calibrate_chat(args: &[String]) -> Result<(), String> {
    if !(2..=3).contains(&args.len()) {
        return Err("Uso: calibrate-chat <manifest.json> <bench-dir> [out.json]".into());
    }
    let manifest_path = PathBuf::from(&args[0]);
    let bench_dir = PathBuf::from(&args[1]);
    let out_path = args
        .get(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| bench_dir.join("chat_calibration.json"));

    setup_env(&bench_dir.join("data-cal"), None)?;
    call(
        "projects.open",
        json!({"path": bench_dir.join("bench.clipes")}),
    )?;

    let lives = load_lives(&manifest_path)?;
    let mut series_data: Vec<(Vec<chat::Interval>, Vec<GroundTruthClip>)> = Vec::new();
    for (idx, item) in lives.iter().enumerate() {
        let source_id = (idx + 1) as i64;
        if let Some(stored) =
            chat::load(source_id).map_err(|e| format!("{}: {}", e.code, e.message))?
        {
            series_data.push((stored.series, item.ground_truth()));
        }
    }
    call("projects.close", json!({}))?;

    if series_data.is_empty() {
        return Err("Nenhuma fonte com replay de chat disponível".into());
    }

    let mut grid = Vec::new();
    for &delay_s in &[0_i64, 5, 10, 15, 20, 30] {
        for &ratio in &[1.5_f64, 1.75, 2.0, 2.25, 2.5, 3.0] {
            for &window_s in &[300_i64, 600, 900, 1200] {
                for &min_people in &[4_u32, 6, 8, 12] {
                    grid.push(ChatCalibrationParams {
                        interval_us: chat::INTERVAL_US,
                        median_window_us: window_s * 1_000_000,
                        peak_ratio: ratio,
                        baseline_floor: chat::BASELINE_FLOOR,
                        min_peak_people: min_people,
                        reaction_delay_us: delay_s * 1_000_000,
                    });
                }
            }
        }
    }

    let refs: Vec<(&[chat::Interval], &[GroundTruthClip])> = series_data
        .iter()
        .map(|(s, c)| (s.as_slice(), c.as_slice()))
        .collect();
    let exact = grid_search_chat(&refs, &grid, 0);
    let tol_10s = grid_search_chat(&refs, &grid, 10_000_000);

    let default_params = ChatCalibrationParams::default();
    let default_exact = exact
        .iter()
        .find(|r| r.aggregate.params == default_params)
        .cloned();
    let default_tol = tol_10s
        .iter()
        .find(|r| r.aggregate.params == default_params)
        .cloned();

    let mut sorted_exact = exact.clone();
    sorted_exact.sort_by(|a, b| {
        b.aggregate
            .f1
            .total_cmp(&a.aggregate.f1)
            .then(b.aggregate.recall.total_cmp(&a.aggregate.recall))
    });
    let mut sorted_tol = tol_10s.clone();
    sorted_tol.sort_by(|a, b| {
        b.aggregate
            .f1
            .total_cmp(&a.aggregate.f1)
            .then(b.aggregate.recall.total_cmp(&a.aggregate.recall))
    });

    let report = json!({
        "chatSources": series_data.len(),
        "totalHumanClips": series_data.iter().map(|(_, c)| c.len()).sum::<usize>(),
        "defaultExact": default_exact,
        "defaultTol10s": default_tol,
        "topExactByF1": sorted_exact.iter().take(15).collect::<Vec<_>>(),
        "topTol10sByF1": sorted_tol.iter().take(15).collect::<Vec<_>>(),
        "delaySweepDefaultRatioWindowExact": exact.iter().filter(|r|
            (r.aggregate.params.peak_ratio - 2.0).abs() < 1e-9
            && r.aggregate.params.median_window_us == 600_000_000
            && r.aggregate.params.min_peak_people == 4
        ).collect::<Vec<_>>(),
        "ratioSweepDefaultDelayWindowExact": exact.iter().filter(|r|
            r.aggregate.params.reaction_delay_us == 10_000_000
            && r.aggregate.params.median_window_us == 600_000_000
            && r.aggregate.params.min_peak_people == 4
        ).collect::<Vec<_>>(),
        "windowSweepDefaultDelayRatioExact": exact.iter().filter(|r|
            r.aggregate.params.reaction_delay_us == 10_000_000
            && (r.aggregate.params.peak_ratio - 2.0).abs() < 1e-9
            && r.aggregate.params.min_peak_people == 4
        ).collect::<Vec<_>>(),
    });
    fs::write(&out_path, serde_json::to_vec_pretty(&report).unwrap()).map_err(|e| e.to_string())?;
    println!("Calibração salva em {}", out_path.display());
    Ok(())
}

struct KeyCleanup {
    profile_id: String,
}
impl Drop for KeyCleanup {
    fn drop(&mut self) {
        let _ = call("provider.key.remove", json!({"profileId": self.profile_id}));
        let _ = call("projects.close", json!({}));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceRunResult {
    source_index: usize,
    language: String,
    has_chat: bool,
    task_version: i64,
    prompt_sha256: String,
    metrics: RecallMetrics,
    timing: ProviderCostTiming,
    windows_failed_codes: Vec<String>,
}

fn flag_value<'a>(args: &'a [String], key: &str) -> Result<&'a str, String> {
    args.windows(2)
        .find(|w| w[0] == key)
        .map(|w| w[1].as_str())
        .ok_or_else(|| format!("parâmetro obrigatório ausente: {key}"))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

fn cmd_run_selection(args: &[String]) -> Result<(), String> {
    if args.len() < 4 {
        return Err("Uso: run-selection <manifest.json> <bench-dir> --model <id> --in-price <usd> --out-price <usd> --chat <on|off> --max-budget-usd <usd> --out <json>".into());
    }
    let manifest_path = PathBuf::from(&args[0]);
    let bench_dir = PathBuf::from(&args[1]);
    let model = flag_value(args, "--model")?;
    let in_price: f64 = flag_value(args, "--in-price")?
        .parse()
        .map_err(|_| "in-price inválido")?;
    let out_price: f64 = flag_value(args, "--out-price")?
        .parse()
        .map_err(|_| "out-price inválido")?;
    let with_chat = match flag_value(args, "--chat")? {
        "on" => true,
        "off" => false,
        _ => return Err("--chat deve ser on ou off".into()),
    };
    let max_budget_usd: f64 = flag_value(args, "--max-budget-usd")?
        .parse()
        .map_err(|_| "max-budget-usd inválido")?;
    let out_path = PathBuf::from(flag_value(args, "--out")?);

    let key_file = std::env::var("CLIPES_GROQ_KEY_FILE")
        .map_err(|_| "defina CLIPES_GROQ_KEY_FILE apontando para o arquivo da chave Groq")?;
    let api_key = fs::read_to_string(&key_file)
        .map_err(|e| format!("falha ao ler CLIPES_GROQ_KEY_FILE: {e}"))?
        .trim()
        .to_owned();
    if api_key.is_empty() {
        return Err("arquivo de chave vazio".into());
    }

    let tag = format!(
        "{}-{}",
        model.replace(['/', ':', '.'], "_"),
        if with_chat { "chat" } else { "nochat" }
    );
    let data_dir = bench_dir.join(format!("data-{tag}"));
    setup_env(&data_dir, None)?;

    let work_project = bench_dir.join(format!("work-{tag}.clipes"));
    if work_project.exists() {
        fs::remove_dir_all(&work_project).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&bench_dir.join("bench.clipes"), &work_project)
        .map_err(|e| format!("falha ao copiar projeto: {e}"))?;

    let profile_id = format!("bench-{tag}");
    let _cleanup = KeyCleanup {
        profile_id: profile_id.clone(),
    };

    call(
        "provider.configure",
        json!({
            "profileId": profile_id,
            "kind": "openai",
            "endpoint": "https://api.groq.com/openai/v1",
            "model": model,
            "nativeSchema": true,
            "ownKey": true,
            "context": 131072,
            "maxOutput": 2000,
            "timeoutSecs": 120
        }),
    )?;
    call(
        "provider.confirm",
        json!({"profileId": profile_id, "endpoint": "https://api.groq.com/openai/v1", "confirmed": true}),
    )?;
    call(
        "provider.key.set",
        json!({"profileId": profile_id, "key": api_key}),
    )?;
    drop(api_key);
    call(
        "provider.prices.set",
        json!({
            "provider": "openai",
            "model": model,
            "inputPerMillion": in_price,
            "outputPerMillion": out_price,
            "contextWindow": 131072,
            "maxOutput": 65536
        }),
    )?;
    call(
        "assistant.task.set",
        json!({"task": "selection", "choice": format!("profile:{profile_id}")}),
    )?;

    call("projects.open", json!({"path": work_project}))?;
    let lives = load_lives(&manifest_path)?;
    let orig_chat: Vec<bool> = (0..lives.len())
        .map(|idx| chat::load((idx + 1) as i64).ok().flatten().is_some())
        .collect();
    if !with_chat {
        projects::with_writer(|c| {
            c.execute("DELETE FROM chat_replays", [])?;
            c.execute("DELETE FROM chat_series", [])?;
            Ok(())
        })
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
    }

    let max_budget_micro = (max_budget_usd * 1_000_000.0).round() as u64;
    let mut spent_micro: u64 = 0;
    let mut source_results = Vec::new();

    for (idx, item) in lives.iter().enumerate() {
        let source_id = (idx + 1) as i64;
        let has_chat_orig = orig_chat[idx];
        if !with_chat && !has_chat_orig {
            // Live sem replay de chat: não muda no experimento com/sem chat.
            continue;
        }
        let est = call("selection.estimate", json!({"source_id": source_id}))?;
        let est_max = est["estimate"]["maxMicroUsd"].as_u64().unwrap_or(0);
        if spent_micro.saturating_add(est_max) > max_budget_micro {
            return Err(format!(
                "teto de orçamento (US$ {max_budget_usd:.2}) seria excedido antes de source_{idx}: gasto={spent_micro} µUS$, est_max={est_max} µUS$"
            ));
        }

        let started = Instant::now();
        let start_res = call(
            "selection.start",
            json!({"source_id": source_id, "confirmed": true}),
        )?;
        let run = start_res["run"].as_i64().ok_or("run inválido")?;
        let batch = start_res["batch"].as_str().unwrap_or("").to_owned();

        let mut retries = 0;
        let details = loop {
            let g = call("selection.get", json!({"run": run}))?;
            let state = g["run"]["state"].as_str().unwrap_or("");
            if state == "running" {
                std::thread::sleep(Duration::from_millis(400));
                continue;
            }
            let failed_windows: Vec<Value> = g["windows"]
                .as_array()
                .map(|w| w.iter().filter(|x| !x["code"].is_null()).cloned().collect())
                .unwrap_or_default();
            let has_rate_limit = failed_windows
                .iter()
                .any(|w| w["code"].as_str() == Some("rate_limit"));
            if state == "partial" && has_rate_limit && retries < 5 {
                retries += 1;
                println!("[{model}] rate_limit em source_{idx}; aguardando 25s para retomar ({retries}/5)...");
                std::thread::sleep(Duration::from_secs(25));
                call("selection.resume", json!({"run": run, "confirmed": true}))?;
                continue;
            }
            break g;
        };
        let wall_ms = started.elapsed().as_millis() as u64;

        let sentences: Vec<SentenceSpan> = {
            let mut all = Vec::new();
            let mut after = 0_i64;
            loop {
                let page = call(
                    "transcription.sentences",
                    json!({"source_id": source_id, "after_id": after, "limit": 5000}),
                )?;
                let rows = page.as_array().ok_or("sentences inválido")?;
                if rows.is_empty() {
                    break;
                }
                for r in rows {
                    let id = r["id"].as_i64().unwrap();
                    after = id;
                    all.push(SentenceSpan {
                        id,
                        start_us: r["start_us"].as_i64().unwrap(),
                        end_us: r["end_us"].as_i64().unwrap(),
                    });
                }
            }
            all
        };

        let candidates: Vec<CandidateSpan> = details["candidates"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .map(|c| CandidateSpan {
                start_id: c["startId"].as_i64().unwrap_or(0),
                end_id: c["endId"].as_i64().unwrap_or(0),
                start_us: c["startUs"].as_i64().unwrap_or(0),
                end_us: c["endUs"].as_i64().unwrap_or(0),
            })
            .collect();

        let metrics = evaluate_source(&item.ground_truth(), &candidates, &sentences);

        let cost_rows = call("provider.cost.list", json!({"batch": batch}))?;
        let rows = cost_rows.as_array().cloned().unwrap_or_default();
        let mut calls_total = 0_u64;
        let mut repairs = 0_u64;
        let mut input_tokens = 0_u64;
        let mut output_tokens = 0_u64;
        let mut cost_micro = 0_u64;
        for r in &rows {
            calls_total += r["calls"].as_u64().unwrap_or(1);
            if r["attempt"].as_i64().unwrap_or(0) > 0 {
                repairs += 1;
            }
            input_tokens += r["inputTokens"].as_u64().unwrap_or(0);
            output_tokens += r["outputTokens"].as_u64().unwrap_or(0);
            cost_micro += r["microUsd"].as_u64().unwrap_or(0);
        }
        spent_micro = spent_micro.saturating_add(cost_micro);

        let windows_total = details["run"]["counts"]["windows"].as_u64().unwrap_or(0) as usize;
        let windows_completed =
            details["run"]["counts"]["completed"].as_u64().unwrap_or(0) as usize;
        let windows_failed = details["run"]["counts"]["failed"].as_u64().unwrap_or(0) as usize;
        let failed_codes: Vec<String> = details["windows"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|w| w["code"].as_str().map(str::to_owned))
            .collect();

        let timing = ProviderCostTiming::from_counts(CostCounts {
            source_duration_us: item.duration_seconds * 1_000_000,
            wall_ms,
            windows_total,
            windows_completed,
            windows_failed,
            calls: calls_total,
            repairs,
            input_tokens,
            output_tokens,
            cost_micro_usd: cost_micro,
        });

        println!(
            "[{model} chat={with_chat}] source_{idx} ({}): recall_min50={:.1}% iou30={:.1}% mid_sent={:.1}% cost=${:.4} wall={}s",
            item.language(),
            metrics.recall_min_50 * 100.0,
            metrics.recall_iou_30 * 100.0,
            metrics.mid_sentence_boundary_rate * 100.0,
            cost_micro as f64 / 1_000_000.0,
            wall_ms / 1000
        );

        source_results.push(SourceRunResult {
            source_index: idx,
            language: item.language().to_owned(),
            has_chat: with_chat && has_chat_orig,
            task_version: details["run"]["taskVersion"].as_i64().unwrap_or(0),
            prompt_sha256: details["run"]["promptSha256"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
            metrics,
            timing,
            windows_failed_codes: failed_codes,
        });
    }

    let all_metrics: Vec<RecallMetrics> = source_results.iter().map(|s| s.metrics).collect();
    let agg_metrics = aggregate_metrics(&all_metrics);
    let mut by_lang: HashMap<String, Vec<RecallMetrics>> = HashMap::new();
    for s in &source_results {
        by_lang
            .entry(s.language.clone())
            .or_default()
            .push(s.metrics);
    }
    let agg_by_lang: HashMap<String, RecallMetrics> = by_lang
        .into_iter()
        .map(|(k, v)| (k, aggregate_metrics(&v)))
        .collect();
    let chat_only: Vec<RecallMetrics> = source_results
        .iter()
        .filter(|s| s.source_index != 0)
        .map(|s| s.metrics)
        .collect();
    let agg_chat_pair = aggregate_metrics(&chat_only);

    let total_dur_us: i64 = source_results
        .iter()
        .map(|s| s.timing.source_duration_us)
        .sum();
    let total_wall_ms: u64 = source_results.iter().map(|s| s.timing.wall_ms).sum();
    let agg_timing = ProviderCostTiming::from_counts(CostCounts {
        source_duration_us: total_dur_us,
        wall_ms: total_wall_ms,
        windows_total: source_results.iter().map(|s| s.timing.windows_total).sum(),
        windows_completed: source_results
            .iter()
            .map(|s| s.timing.windows_completed)
            .sum(),
        windows_failed: source_results.iter().map(|s| s.timing.windows_failed).sum(),
        calls: source_results.iter().map(|s| s.timing.calls).sum(),
        repairs: source_results.iter().map(|s| s.timing.repairs).sum(),
        input_tokens: source_results.iter().map(|s| s.timing.input_tokens).sum(),
        output_tokens: source_results.iter().map(|s| s.timing.output_tokens).sum(),
        cost_micro_usd: source_results.iter().map(|s| s.timing.cost_micro_usd).sum(),
    });

    let out = json!({
        "model": model,
        "withChat": with_chat,
        "aggregate": agg_metrics,
        "aggregateChatLivesPair": agg_chat_pair,
        "aggregateByLanguage": agg_by_lang,
        "timingAndCost": agg_timing,
        "sources": source_results,
    });
    fs::write(&out_path, serde_json::to_vec_pretty(&out).unwrap()).map_err(|e| e.to_string())?;
    println!("Resultados salvos em {}", out_path.display());
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let res = match args.first().map(String::as_str) {
        Some("prepare") => cmd_prepare(&args[1..]),
        Some("calibrate-chat") => cmd_calibrate_chat(&args[1..]),
        Some("run-selection") => cmd_run_selection(&args[1..]),
        _ => Err("Subcomandos: prepare | calibrate-chat | run-selection".into()),
    };
    res.map_err(|e| io::Error::other(e).into())
}
