//! Runner headless do benchmark de seleção (#57).
//!
//! Usa exclusivamente o núcleo (`clipes_core`), o despacho compartilhado (`dispatch`), o Motor
//! local em GPU e o adaptador HTTP do Groq dentro de um `CLIPES_DATA_DIR` isolado. Não grava
//! dados no repositório e nunca imprime chaves de API, trechos de Transcrição ou IDs de vídeo
//! nos resultados exportados.
use clipes_core::{
    chat, dispatch, projects,
    selection::benchmark::{
        aggregate_metrics, evaluate_source, grid_search_chat, wilson_ci95, CandidateSpan,
        ChatCalibrationParams, CostCounts, GroundTruthClip, ProviderCostTiming, RecallMetrics,
        SentenceSpan,
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
    let project_path = PathBuf::from(
        call("projects.current", json!({}))?["path"]
            .as_str()
            .ok_or("projeto sem caminho")?,
    );

    let lives = load_lives(&manifest_path)?;
    let mut stats = Vec::with_capacity(lives.len());

    let auto_worker = args[3] == "auto" && args[4] == "auto";
    if auto_worker {
        let ws = call("components.worker.status", json!({}))?;
        if ws["installed"] != true {
            println!("[prepare] Instalando worker de ML isolado em CLIPES_DATA_DIR...");
            call("components.worker.install", json!({"confirmed": true}))?;
        }
        let models = call("components.models.manifest", json!({}))?;
        let turbo_installed = models
            .as_array()
            .and_then(|a| a.iter().find(|m| m["id"] == "whisper-turbo"))
            .is_some_and(|m| m["installed"] == true);
        if !turbo_installed {
            println!("[prepare] Baixando modelo whisper-turbo...");
            call(
                "components.models.download",
                json!({"id": "whisper-turbo", "confirmed": true}),
            )?;
        }
        if device == "cuda" {
            call(
                "transcription.hardware.choose",
                json!({"model": "whisper-turbo", "device": "cuda", "compute_type": "int8_float16"}),
            )?;
        }
    }

    let mut manual_engine = if auto_worker {
        None
    } else {
        let client = start_real_worker(&python)?;
        Some(LocalEngine::with_worker(
            client,
            json!({"id":"real","dir":model_dir,"device":device,"compute_type":compute_type}),
            batch,
        ))
    };

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
            if existing.is_none() && !auto_worker {
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
            println!(
                "[prepare] Transcrevendo source_{idx} ({:.2}h, lang={}) na GPU...",
                duration_us as f64 / 3_600_000_000.0,
                item.language()
            );
            let started = Instant::now();
            if let Some(engine) = manual_engine.as_mut() {
                let job = projects::with_writer(|c| {
                    c.execute(
                        "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcribe-manual','local','running',?1)",
                        [source_id],
                    )?;
                    Ok(c.last_insert_rowid())
                })
                .map_err(|e| format!("{}: {}", e.code, e.message))?;
                run_with(
                    engine,
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
            } else {
                call(
                    "transcription.start",
                    json!({"project": project_path, "source_id": source_id}),
                )?;
                wait_for_job("transcription", source_id, Duration::from_secs(18_000))?;
            }
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
            energy_high: energy_after["marks"]["high"].as_u64().unwrap_or(0) as usize,
            energy_peak: energy_after["marks"]["peak"].as_u64().unwrap_or(0) as usize,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlannedWindowInfo {
    source_index: usize,
    window_index: usize,
    language: String,
    has_chat: bool,
    first_id: i64,
    last_id: i64,
    start_us: i64,
    end_us: i64,
    duration_us: i64,
    sentence_count: usize,
    transcript_chars: usize,
    est_input_tokens: u64,
    est_request_ceiling_tokens: u64,
    overlaps_human_clip: bool,
    overlapping_clip_indices: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SamplePlanFile {
    seed: u64,
    total_windows: usize,
    sample_windows_target: usize,
    over8k_analysis: Value,
    energy_and_chat_counts: Vec<Value>,
    strata: Vec<Value>,
    sampled_windows: Vec<PlannedWindowInfo>,
    sampled_clips_by_source: Vec<usize>,
    sampled_clips_total: usize,
}

struct SplitMix64(u64);
impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn shuffle<T>(&mut self, slice: &mut [T]) {
        for i in (1..slice.len()).rev() {
            let j = (self.next_u64() as usize) % (i + 1);
            slice.swap(i, j);
        }
    }
}

fn percentile_u64(sorted: &[u64], num: usize, den: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() - 1) * num) / den;
    sorted[idx]
}

fn pause_selection_task(pause: bool) -> Result<(), String> {
    projects::with_writer(|c| {
        if pause {
            c.execute(
                "INSERT OR IGNORE INTO ai_pauses(scope,key,reason) VALUES ('task','selection','user')",
                [],
            )?;
        } else {
            c.execute(
                "DELETE FROM ai_pauses WHERE scope='task' AND key='selection'",
                [],
            )?;
        }
        Ok(())
    })
    .map_err(|e| format!("{}: {}", e.code, e.message))
}

fn create_cancelled_selection_run(source_id: i64) -> Result<(i64, String), String> {
    pause_selection_task(true)?;
    let start_res = call(
        "selection.start",
        json!({"source_id": source_id, "confirmed": true}),
    );
    let (run, batch) = match start_res {
        Ok(v) => (
            v["run"].as_i64().ok_or_else(|| "run inválido".to_owned())?,
            v["batch"].as_str().unwrap_or("").to_owned(),
        ),
        Err(e) => {
            let _ = pause_selection_task(false);
            return Err(e);
        }
    };
    let cancel_res = call("selection.cancel", json!({"run": run}));
    let unpause_res = pause_selection_task(false);
    cancel_res?;
    unpause_res?;
    Ok((run, batch))
}

struct GroqProfileArgs<'a> {
    profile_id: &'a str,
    model: &'a str,
    api_key: &'a str,
    tpr: Option<u64>,
    tpm: Option<u64>,
    tpd: Option<u64>,
    prices: Option<(f64, f64)>,
}

fn configure_groq_profile(cfg: GroqProfileArgs<'_>) -> Result<(), String> {
    let mut profile = json!({
        "profileId": cfg.profile_id,
        "kind": "openai",
        "endpoint": "https://api.groq.com/openai/v1",
        "model": cfg.model,
        "nativeSchema": true,
        "ownKey": true,
        "context": 131072,
        "maxOutput": 2000,
        "timeoutSecs": 120
    });
    if let Some(v) = cfg.tpr {
        profile["tokensPerRequest"] = json!(v);
    }
    if let Some(v) = cfg.tpm {
        profile["tokensPerMinute"] = json!(v);
    }
    if let Some(v) = cfg.tpd {
        profile["tokensPerDay"] = json!(v);
    }
    call("provider.configure", profile)?;
    call(
        "provider.confirm",
        json!({"profileId": cfg.profile_id, "endpoint": "https://api.groq.com/openai/v1", "confirmed": true}),
    )?;
    call(
        "provider.key.set",
        json!({"profileId": cfg.profile_id, "key": cfg.api_key}),
    )?;
    if let Some((in_price, out_price)) = cfg.prices {
        // `catalog_provider("openai", "https://api.groq.com/openai/v1")` resolve para "groq"
        // e herda tokensPerRequest/Minute/Day do catálogo embutido (#269).
        call(
            "provider.prices.set",
            json!({
                "provider": "groq",
                "model": cfg.model,
                "inputPerMillion": in_price,
                "outputPerMillion": out_price,
                "contextWindow": 131072,
                "maxOutput": 65536
            }),
        )?;
    }
    call(
        "assistant.task.set",
        json!({"task": "selection", "choice": format!("profile:{}", cfg.profile_id)}),
    )?;
    Ok(())
}

fn cmd_plan_sample(args: &[String]) -> Result<(), String> {
    if args.len() < 2 {
        return Err(
            "Uso: plan-sample <manifest.json> <bench-dir> [out.json] [--tpr <n>] [--tpm <n>]"
                .into(),
        );
    }
    let manifest_path = PathBuf::from(&args[0]);
    let bench_dir = PathBuf::from(&args[1]);
    let out_path = args
        .get(2)
        .filter(|a| !a.starts_with("--"))
        .map(PathBuf::from)
        .unwrap_or_else(|| bench_dir.join("sample_plan.json"));
    let tpr: Option<u64> = flag_value_opt(args, "--tpr")
        .map(|s| s.parse().map_err(|_| "tpr inválido"))
        .transpose()?;
    let tpm: Option<u64> = flag_value_opt(args, "--tpm")
        .map(|s| s.parse().map_err(|_| "tpm inválido"))
        .transpose()?;

    let data_dir = bench_dir.join("data-plan");
    setup_env(&data_dir, None)?;
    let work_project = bench_dir.join("work-plan.clipes");
    if work_project.exists() {
        fs::remove_dir_all(&work_project).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&bench_dir.join("bench.clipes"), &work_project)
        .map_err(|e| format!("falha ao copiar projeto: {e}"))?;

    let profile_id = "bench-plan-offline".to_owned();
    let _cleanup = KeyCleanup {
        profile_id: profile_id.clone(),
    };
    configure_groq_profile(GroqProfileArgs {
        profile_id: &profile_id,
        model: "openai/gpt-oss-120b",
        api_key: "offline-estimation-only",
        tpr,
        tpm,
        tpd: None,
        prices: None,
    })?;

    call("projects.open", json!({"path": work_project}))?;
    let lives = load_lives(&manifest_path)?;
    let mut all_windows: Vec<PlannedWindowInfo> = Vec::new();
    let mut per_source_over8k = Vec::new();
    let mut energy_and_chat_counts = Vec::new();

    for (idx, item) in lives.iter().enumerate() {
        let source_id = (idx + 1) as i64;
        let gt = item.ground_truth();
        let est_src = call("selection.estimate", json!({"source_id": source_id}))?;
        let has_chat = est_src["chat"]["available"].as_bool().unwrap_or(false);
        energy_and_chat_counts.push(json!({
            "sourceIndex": idx,
            "language": item.language(),
            "energy": est_src["energy"],
            "chat": est_src["chat"],
        }));

        let (run, _) = create_cancelled_selection_run(source_id)?;
        let win_list = est_src["plan"]["windows"]
            .as_array()
            .ok_or("plan.windows ausente")?;

        let mut src_inputs: Vec<u64> = Vec::with_capacity(win_list.len());
        let mut src_ceilings: Vec<u64> = Vec::with_capacity(win_list.len());
        let mut over_8k_input_only = Vec::new();
        let mut over_8k_with_output = Vec::new();

        for w in win_list {
            let w_idx = w["index"].as_u64().unwrap_or(0) as usize;
            let first_id = w["firstId"].as_i64().unwrap_or(0);
            let last_id = w["lastId"].as_i64().unwrap_or(0);
            let start_us = w["startUs"].as_i64().unwrap_or(0);
            let end_us = w["endUs"].as_i64().unwrap_or(0);

            let est_win = call(
                "selection.estimate",
                json!({"run": run, "windows": [w_idx]}),
            )?;
            let est_input = est_win["estimate"]["inputTokens"].as_u64().unwrap_or(0);
            let est_ceiling = est_input.saturating_add(2000);

            let (sent_count, char_count): (usize, usize) = projects::with_reader(|c| {
                c.query_row(
                    "SELECT count(*), COALESCE(sum(length(text)), 0) FROM sentences WHERE transcript_id=(SELECT transcript_id FROM selection_runs WHERE id=?1) AND id BETWEEN ?2 AND ?3",
                    (run, first_id, last_id),
                    |r| Ok((r.get::<_, i64>(0)? as usize, r.get::<_, i64>(1)? as usize)),
                )
            })
            .map_err(|e| format!("{}: {}", e.code, e.message))?;

            let overlapping_clips: Vec<usize> = gt
                .iter()
                .enumerate()
                .filter_map(|(ci, c)| {
                    let ov = c.end_us.min(end_us) - c.start_us.max(start_us);
                    (ov > 0).then_some(ci)
                })
                .collect();

            src_inputs.push(est_input);
            src_ceilings.push(est_ceiling);
            if est_input > 8000 {
                over_8k_input_only.push(json!({
                    "windowIndex": w_idx,
                    "estInputTokens": est_input,
                    "estRequestCeilingTokens": est_ceiling,
                    "transcriptChars": char_count,
                    "sentenceCount": sent_count,
                }));
            }
            if est_ceiling > 8000 {
                over_8k_with_output.push(json!({
                    "windowIndex": w_idx,
                    "estInputTokens": est_input,
                    "estRequestCeilingTokens": est_ceiling,
                    "transcriptChars": char_count,
                    "sentenceCount": sent_count,
                }));
            }

            all_windows.push(PlannedWindowInfo {
                source_index: idx,
                window_index: w_idx,
                language: item.language().to_owned(),
                has_chat,
                first_id,
                last_id,
                start_us,
                end_us,
                duration_us: end_us - start_us,
                sentence_count: sent_count,
                transcript_chars: char_count,
                est_input_tokens: est_input,
                est_request_ceiling_tokens: est_ceiling,
                overlaps_human_clip: !overlapping_clips.is_empty(),
                overlapping_clip_indices: overlapping_clips,
            });
        }

        let mut sorted_in = src_inputs.clone();
        sorted_in.sort_unstable();
        let mut sorted_ceil = src_ceilings.clone();
        sorted_ceil.sort_unstable();
        per_source_over8k.push(json!({
            "sourceIndex": idx,
            "language": item.language(),
            "hasChat": has_chat,
            "windowsTotal": win_list.len(),
            "minEstInputTokens": sorted_in.first().copied().unwrap_or(0),
            "medianEstInputTokens": percentile_u64(&sorted_in, 1, 2),
            "p95EstInputTokens": percentile_u64(&sorted_in, 95, 100),
            "maxEstInputTokens": sorted_in.last().copied().unwrap_or(0),
            "minEstCeilingWith2k": sorted_ceil.first().copied().unwrap_or(0),
            "medianEstCeilingWith2k": percentile_u64(&sorted_ceil, 1, 2),
            "maxEstCeilingWith2k": sorted_ceil.last().copied().unwrap_or(0),
            "inputOver8000Count": over_8k_input_only.len(),
            "ceilingWith2kOver8000Count": over_8k_with_output.len(),
            "inputOver8000Windows": over_8k_input_only,
            "ceilingWith2kOver8000Windows": over_8k_with_output,
        }));
    }

    // Amostra estratificada fixa (seed=57): 25 janelas proporcionais às 3 lives (4, 10, 11),
    // garantindo janelas com Cortes humanos e janelas de controle sem Corte em cada live.
    const SEED: u64 = 57;
    let mut rng = SplitMix64(SEED);
    let targets: [(usize, usize, usize); 3] = [
        (0, 3, 1), // source_0 (16 janelas): 4 = 3 com Corte + 1 controle sem Corte
        (1, 7, 3), // source_1 (48 janelas): 10 = 7 com Corte + 3 controle sem Corte
        (2, 8, 3), // source_2 (48 janelas): 11 = 8 com Corte + 3 controle sem Corte
    ];
    let mut sampled_windows = Vec::new();
    let mut strata = Vec::new();
    let mut sampled_clips_by_source = Vec::new();

    for &(src_idx, pos_target, neg_target) in &targets {
        let mut pos: Vec<PlannedWindowInfo> = all_windows
            .iter()
            .filter(|w| w.source_index == src_idx && w.overlaps_human_clip)
            .cloned()
            .collect();
        let mut neg: Vec<PlannedWindowInfo> = all_windows
            .iter()
            .filter(|w| w.source_index == src_idx && !w.overlaps_human_clip)
            .cloned()
            .collect();
        let pos_total = pos.len();
        let neg_total = neg.len();
        rng.shuffle(&mut pos);
        rng.shuffle(&mut neg);

        let take_pos = pos_target.min(pos.len());
        let take_neg = neg_target.min(neg.len());
        let mut picked: Vec<PlannedWindowInfo> = Vec::new();
        picked.extend(pos.into_iter().take(take_pos));
        picked.extend(neg.into_iter().take(take_neg));
        picked.sort_by_key(|w| w.window_index);

        let mut covered_clips: Vec<usize> = picked
            .iter()
            .flat_map(|w| w.overlapping_clip_indices.iter().copied())
            .collect();
        covered_clips.sort_unstable();
        covered_clips.dedup();
        sampled_clips_by_source.push(covered_clips.len());

        strata.push(json!({
            "sourceIndex": src_idx,
            "totalWindows": pos_total + neg_total,
            "clipWindowsAvailable": pos_total,
            "nonClipWindowsAvailable": neg_total,
            "sampledClipWindows": take_pos,
            "sampledNonClipWindows": take_neg,
            "sampledTotal": take_pos + take_neg,
            "sampledHumanClipsCovered": covered_clips.len(),
        }));
        sampled_windows.extend(picked);
    }
    sampled_windows.sort_by_key(|w| (w.source_index, w.window_index));

    let total_over_input: usize = all_windows
        .iter()
        .filter(|w| w.est_input_tokens > 8000)
        .count();
    let total_over_ceil: usize = all_windows
        .iter()
        .filter(|w| w.est_request_ceiling_tokens > 8000)
        .count();
    let sample_over_input: usize = sampled_windows
        .iter()
        .filter(|w| w.est_input_tokens > 8000)
        .count();
    let sample_over_ceil: usize = sampled_windows
        .iter()
        .filter(|w| w.est_request_ceiling_tokens > 8000)
        .count();
    let sampled_clips_total: usize = sampled_clips_by_source.iter().sum();

    let plan_file = SamplePlanFile {
        seed: SEED,
        total_windows: all_windows.len(),
        sample_windows_target: sampled_windows.len(),
        over8k_analysis: json!({
            "windowsTotal": all_windows.len(),
            "inputOver8000Total": total_over_input,
            "ceilingWith2kOver8000Total": total_over_ceil,
            "sampleInputOver8000Total": sample_over_input,
            "sampleCeilingWith2kOver8000Total": sample_over_ceil,
            "perSource": per_source_over8k,
        }),
        energy_and_chat_counts,
        strata,
        sampled_windows,
        sampled_clips_by_source,
        sampled_clips_total,
    };

    fs::write(&out_path, serde_json::to_vec_pretty(&plan_file).unwrap())
        .map_err(|e| e.to_string())?;
    println!(
        "Plano de amostra salvo em {} (janelas={}, sample={}, clips_cobertos={}, over8k_input={}, over8k_ceil={})",
        out_path.display(),
        plan_file.total_windows,
        plan_file.sample_windows_target,
        plan_file.sampled_clips_total,
        total_over_input,
        total_over_ceil
    );
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
struct WindowEvalRecord {
    window_index: usize,
    overlaps_human_clip: bool,
    est_input_tokens: u64,
    est_request_ceiling_tokens: u64,
    state: String,
    code: Option<String>,
    calls: u64,
    input_tokens: u64,
    output_tokens: u64,
    cost_micro_usd: u64,
    duration_ms: u64,
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
    sampled_mode: bool,
    sampled_windows_target: usize,
    sampled_windows_attempted: usize,
    sampled_duration_us: i64,
    active_call_ms: u64,
    active_secs_per_hour: f64,
    sampled_usd_per_hour: f64,
    stopped_early_reason: Option<String>,
    windows_failed_codes: Vec<String>,
    window_records: Vec<WindowEvalRecord>,
}

fn flag_value<'a>(args: &'a [String], key: &str) -> Result<&'a str, String> {
    args.windows(2)
        .find(|w| w[0] == key)
        .map(|w| w[1].as_str())
        .ok_or_else(|| format!("parâmetro obrigatório ausente: {key}"))
}

fn flag_value_opt<'a>(args: &'a [String], key: &str) -> Option<&'a str> {
    args.windows(2).find(|w| w[0] == key).map(|w| w[1].as_str())
}

fn union_duration_us(spans: &[(i64, i64)]) -> i64 {
    if spans.is_empty() {
        return 0;
    }
    let mut s = spans.to_vec();
    s.sort_unstable();
    let mut total = 0_i64;
    let (mut cur_a, mut cur_b) = s[0];
    for &(a, b) in &s[1..] {
        if a <= cur_b {
            cur_b = cur_b.max(b);
        } else {
            total += (cur_b - cur_a).max(0);
            cur_a = a;
            cur_b = b;
        }
    }
    total + (cur_b - cur_a).max(0)
}

fn pace_tpm(recent: &mut Vec<(Instant, u64)>, next_tokens: u64, tpm_limit: u64) {
    if tpm_limit == 0 {
        return;
    }
    let window = Duration::from_secs(64);
    let safe_cap = tpm_limit.saturating_sub(400).max(1);
    loop {
        let now = Instant::now();
        recent.retain(|(t, _)| now.duration_since(*t) < window);
        let used: u64 = recent.iter().map(|(_, tok)| *tok).sum();
        if used == 0 || used.saturating_add(next_tokens) <= safe_cap {
            return;
        }
        if let Some((oldest, _)) = recent.first() {
            let wait = window
                .saturating_sub(now.duration_since(*oldest))
                .saturating_add(Duration::from_millis(500));
            println!(
                "  [TPM pace] usados={used}t nos últimos 64s + prox~={next_tokens}t > {safe_cap}; aguardando {}s...",
                wait.as_secs()
            );
            std::thread::sleep(wait);
        } else {
            return;
        }
    }
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
        return Err("Uso: run-selection <manifest.json> <bench-dir> --model <id> --in-price <usd> --out-price <usd> --chat <on|off> --max-budget-usd <usd> --out <json> [--sample <sample_plan.json>] [--pace-tpm <0>] [--max-tpd <190000>] [--tpr <n>] [--tpm <n>] [--tpd <n>]".into());
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
    let sample_plan: Option<SamplePlanFile> = match flag_value_opt(args, "--sample") {
        Some(p) => {
            let raw = fs::read(p).map_err(|e| format!("falha ao ler --sample: {e}"))?;
            Some(serde_json::from_slice(&raw).map_err(|e| format!("--sample inválido: {e}"))?)
        }
        None => None,
    };
    let pace_tpm_limit: u64 = flag_value_opt(args, "--pace-tpm")
        .map(|s| s.parse().map_err(|_| "pace-tpm inválido"))
        .transpose()?
        .unwrap_or(0);
    let max_tpd_tokens: u64 = flag_value_opt(args, "--max-tpd")
        .map(|s| s.parse().map_err(|_| "max-tpd inválido"))
        .transpose()?
        .unwrap_or(190_000);
    let tpr: Option<u64> = flag_value_opt(args, "--tpr")
        .map(|s| s.parse().map_err(|_| "tpr inválido"))
        .transpose()?;
    let tpm: Option<u64> = flag_value_opt(args, "--tpm")
        .map(|s| s.parse().map_err(|_| "tpm inválido"))
        .transpose()?;
    let tpd: Option<u64> = flag_value_opt(args, "--tpd")
        .map(|s| s.parse().map_err(|_| "tpd inválido"))
        .transpose()?;

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

    configure_groq_profile(GroqProfileArgs {
        profile_id: &profile_id,
        model,
        api_key: &api_key,
        tpr,
        tpm,
        tpd,
        prices: Some((in_price, out_price)),
    })?;
    drop(api_key);

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
    let mut daily_tokens_used: u64 = 0;
    let mut recent_calls: Vec<(Instant, u64)> = Vec::new();
    let mut source_results = Vec::new();
    let mut stopped_globally: Option<String> = None;

    for (idx, item) in lives.iter().enumerate() {
        let source_id = (idx + 1) as i64;
        let has_chat_orig = orig_chat[idx];
        if !with_chat && !has_chat_orig {
            // Live sem replay de chat: não muda no experimento com/sem chat.
            continue;
        }
        let sampled_for_src: Vec<PlannedWindowInfo> = sample_plan
            .as_ref()
            .map(|p| {
                p.sampled_windows
                    .iter()
                    .filter(|w| w.source_index == idx)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if sample_plan.is_some() && sampled_for_src.is_empty() {
            continue;
        }

        let started = Instant::now();
        let mut window_records = Vec::new();
        let mut attempted_windows: Vec<PlannedWindowInfo> = Vec::new();
        let mut stopped_early_reason = stopped_globally.clone();

        let (run, batch, details) = if let Some(_plan) = &sample_plan {
            let (run, batch) = create_cancelled_selection_run(source_id)?;

            let mut prev_cost_len = 0_usize;
            for w in &sampled_for_src {
                if stopped_globally.is_some() {
                    break;
                }
                let est_w = call(
                    "selection.estimate",
                    json!({"run": run, "windows": [w.window_index]}),
                )?;
                let est_max = est_w["estimate"]["maxMicroUsd"].as_u64().unwrap_or(0);
                if spent_micro.saturating_add(est_max) > max_budget_micro {
                    let msg = format!(
                        "budget_cap_reached: gasto={spent_micro} µUS$, prox_max={est_max} µUS$, teto={max_budget_micro} µUS$"
                    );
                    stopped_early_reason = Some(msg.clone());
                    stopped_globally = Some(msg);
                    break;
                }
                let est_tokens = w.est_request_ceiling_tokens;
                if daily_tokens_used.saturating_add(est_tokens) > max_tpd_tokens {
                    let msg = format!(
                        "tpd_cap_reached: usados={daily_tokens_used} + prox~={est_tokens} > max_tpd={max_tpd_tokens}"
                    );
                    stopped_early_reason = Some(msg.clone());
                    stopped_globally = Some(msg);
                    break;
                }

                pace_tpm(&mut recent_calls, est_tokens, pace_tpm_limit);
                attempted_windows.push(w.clone());

                let mut window_retries = 0_u8;
                let (w_state, w_code, w_reset_ms) = loop {
                    call(
                        "selection.redo",
                        json!({"run": run, "windows": [w.window_index], "confirmed": true}),
                    )?;
                    let g = loop {
                        let d = call("selection.get", json!({"run": run}))?;
                        if d["run"]["state"].as_str() == Some("running") {
                            std::thread::sleep(Duration::from_millis(350));
                            continue;
                        }
                        break d;
                    };
                    let win_obj = g["windows"]
                        .as_array()
                        .and_then(|arr| {
                            arr.iter()
                                .find(|x| x["index"].as_u64() == Some(w.window_index as u64))
                        })
                        .cloned()
                        .unwrap_or(Value::Null);
                    let st = win_obj["state"].as_str().unwrap_or("").to_owned();
                    let cd = win_obj["code"].as_str().map(str::to_owned);
                    if cd.as_deref() == Some("rate_limit") && window_retries == 0 {
                        window_retries += 1;
                        println!(
                            "  [{model}] rate_limit residual em source_{idx} w={} (resetAtMs={:?}); aguardando 65s uma única vez...",
                            w.window_index,
                            win_obj["resetAtMs"].as_u64()
                        );
                        recent_calls.push((Instant::now(), est_tokens));
                        std::thread::sleep(Duration::from_secs(65));
                        continue;
                    }
                    break (st, cd, win_obj["resetAtMs"].as_u64());
                };

                let all_costs = call("provider.cost.list", json!({"batch": batch}))?
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let new_rows = if all_costs.len() > prev_cost_len {
                    &all_costs[prev_cost_len..]
                } else {
                    &[]
                };
                prev_cost_len = all_costs.len();

                let mut w_calls = 0_u64;
                let mut w_in = 0_u64;
                let mut w_out = 0_u64;
                let mut w_micro = 0_u64;
                let mut w_dur = 0_u64;
                for r in new_rows {
                    w_calls += r["calls"].as_u64().unwrap_or(1);
                    w_in += r["inputTokens"].as_u64().unwrap_or(0);
                    w_out += r["outputTokens"].as_u64().unwrap_or(0);
                    w_micro += r["microUsd"].as_u64().unwrap_or(0);
                    w_dur += r["durationMs"].as_u64().unwrap_or(0);
                }
                spent_micro = spent_micro.saturating_add(w_micro);
                let actual_toks = w_in.saturating_add(w_out);
                let accounted_toks = if actual_toks > 0 {
                    actual_toks
                } else if matches!(
                    w_code.as_deref(),
                    Some("provider_http" | "request_too_large")
                ) {
                    // HTTP 413 / 400 pode consumir parte ou nada do TPD; conserva contagem prudente.
                    w.est_input_tokens
                } else {
                    0
                };
                daily_tokens_used = daily_tokens_used.saturating_add(accounted_toks);
                recent_calls.push((
                    Instant::now(),
                    if actual_toks > 0 {
                        actual_toks
                    } else {
                        est_tokens
                    },
                ));

                println!(
                    "  [{model} chat={with_chat}] src={idx} w={} est_in={} state={w_state} code={:?} in={} out={} dur={}ms daily_tok~={}",
                    w.window_index,
                    w.est_input_tokens,
                    w_code,
                    w_in,
                    w_out,
                    w_dur,
                    daily_tokens_used
                );

                window_records.push(WindowEvalRecord {
                    window_index: w.window_index,
                    overlaps_human_clip: w.overlaps_human_clip,
                    est_input_tokens: w.est_input_tokens,
                    est_request_ceiling_tokens: w.est_request_ceiling_tokens,
                    state: w_state,
                    code: w_code.clone(),
                    calls: w_calls,
                    input_tokens: w_in,
                    output_tokens: w_out,
                    cost_micro_usd: w_micro,
                    duration_ms: w_dur,
                });

                if matches!(
                    w_code.as_deref(),
                    Some("provider_daily_limit" | "rate_limit")
                ) {
                    let msg = format!(
                        "{}: source_{idx} w={} (resetAtMs={:?})",
                        w_code.as_deref().unwrap_or("rate_limit"),
                        w.window_index,
                        w_reset_ms
                    );
                    stopped_early_reason = Some(msg.clone());
                    stopped_globally = Some(msg);
                    break;
                }
            }

            let details = call("selection.get", json!({"run": run}))?;
            (run, batch, details)
        } else {
            let est = call("selection.estimate", json!({"source_id": source_id}))?;
            let est_max = est["estimate"]["maxMicroUsd"].as_u64().unwrap_or(0);
            if spent_micro.saturating_add(est_max) > max_budget_micro {
                return Err(format!(
                    "teto de orçamento (US$ {max_budget_usd:.2}) seria excedido antes de source_{idx}: gasto={spent_micro} µUS$, est_max={est_max} µUS$"
                ));
            }
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
                let hit_daily = failed_windows
                    .iter()
                    .any(|w| w["code"].as_str() == Some("provider_daily_limit"));
                if hit_daily {
                    stopped_early_reason = Some(format!("provider_daily_limit em source_{idx}"));
                    stopped_globally = stopped_early_reason.clone();
                    break g;
                }
                let has_rate_limit = failed_windows
                    .iter()
                    .any(|w| w["code"].as_str() == Some("rate_limit"));
                if state == "partial" && has_rate_limit && retries < 2 {
                    retries += 1;
                    println!("[{model}] rate_limit residual em source_{idx}; aguardando 65s para retomar ({retries}/2)...");
                    std::thread::sleep(Duration::from_secs(65));
                    call("selection.resume", json!({"run": run, "confirmed": true}))?;
                    continue;
                }
                break g;
            };
            (run, batch, details)
        };
        let _ = run;
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

        let all_gt = item.ground_truth();
        let eval_gt: Vec<GroundTruthClip> = if sample_plan.is_some() {
            let mut covered_idx: Vec<usize> = attempted_windows
                .iter()
                .flat_map(|w| w.overlapping_clip_indices.iter().copied())
                .collect();
            covered_idx.sort_unstable();
            covered_idx.dedup();
            covered_idx.into_iter().map(|ci| all_gt[ci]).collect()
        } else {
            all_gt
        };

        let metrics = evaluate_source(&eval_gt, &candidates, &sentences);

        let cost_rows = call("provider.cost.list", json!({"batch": batch}))?;
        let rows = cost_rows.as_array().cloned().unwrap_or_default();
        let mut calls_total = 0_u64;
        let mut repairs = 0_u64;
        let mut input_tokens = 0_u64;
        let mut output_tokens = 0_u64;
        let mut cost_micro = 0_u64;
        let mut active_call_ms = 0_u64;
        for r in &rows {
            calls_total += r["calls"].as_u64().unwrap_or(1);
            if r["attempt"].as_i64().unwrap_or(0) > 0 {
                repairs += 1;
            }
            input_tokens += r["inputTokens"].as_u64().unwrap_or(0);
            output_tokens += r["outputTokens"].as_u64().unwrap_or(0);
            cost_micro += r["microUsd"].as_u64().unwrap_or(0);
            active_call_ms += r["durationMs"].as_u64().unwrap_or(0);
        }
        if sample_plan.is_none() {
            spent_micro = spent_micro.saturating_add(cost_micro);
        }

        let (windows_total, windows_completed, windows_failed, failed_codes) =
            if sample_plan.is_some() {
                let comp = window_records
                    .iter()
                    .filter(|w| w.state == "completed")
                    .count();
                let codes: Vec<String> = window_records
                    .iter()
                    .filter_map(|w| w.code.clone())
                    .collect();
                (
                    window_records.len(),
                    comp,
                    window_records.len().saturating_sub(comp),
                    codes,
                )
            } else {
                let wt = details["run"]["counts"]["windows"].as_u64().unwrap_or(0) as usize;
                let wc = details["run"]["counts"]["completed"].as_u64().unwrap_or(0) as usize;
                let wf = details["run"]["counts"]["failed"].as_u64().unwrap_or(0) as usize;
                let codes: Vec<String> = details["windows"]
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|w| w["code"].as_str().map(str::to_owned))
                    .collect();
                (wt, wc, wf, codes)
            };

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

        let sampled_duration_us = if sample_plan.is_some() {
            let spans: Vec<(i64, i64)> = attempted_windows
                .iter()
                .map(|w| (w.start_us, w.end_us))
                .collect();
            union_duration_us(&spans)
        } else {
            item.duration_seconds * 1_000_000
        };
        let sampled_hours = sampled_duration_us.max(0) as f64 / 3_600_000_000.0;
        let active_secs_per_hour = if sampled_hours > 0.0 {
            (active_call_ms as f64 / 1000.0) / sampled_hours
        } else {
            0.0
        };
        let sampled_usd_per_hour = if sampled_hours > 0.0 {
            (cost_micro as f64 / 1_000_000.0) / sampled_hours
        } else {
            0.0
        };

        println!(
            "[{model} chat={with_chat}] source_{idx} ({}): win={windows_completed}/{windows_total} recall_min50={:.1}% iou30={:.1}% mid_sent={:.1}% cost=${:.4} active={}s wall={}s",
            item.language(),
            metrics.recall_min_50 * 100.0,
            metrics.recall_iou_30 * 100.0,
            metrics.mid_sentence_boundary_rate * 100.0,
            cost_micro as f64 / 1_000_000.0,
            active_call_ms / 1000,
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
            sampled_mode: sample_plan.is_some(),
            sampled_windows_target: sampled_for_src.len(),
            sampled_windows_attempted: window_records.len(),
            sampled_duration_us,
            active_call_ms,
            active_secs_per_hour,
            sampled_usd_per_hour,
            stopped_early_reason,
            windows_failed_codes: failed_codes,
            window_records,
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
    let total_sampled_dur_us: i64 = source_results.iter().map(|s| s.sampled_duration_us).sum();
    let total_wall_ms: u64 = source_results.iter().map(|s| s.timing.wall_ms).sum();
    let total_active_ms: u64 = source_results.iter().map(|s| s.active_call_ms).sum();
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
    let sampled_hours_total = total_sampled_dur_us.max(0) as f64 / 3_600_000_000.0;
    let active_secs_per_hour = if sampled_hours_total > 0.0 {
        (total_active_ms as f64 / 1000.0) / sampled_hours_total
    } else {
        0.0
    };
    let sampled_usd_per_hour = if sampled_hours_total > 0.0 {
        (agg_timing.cost_micro_usd as f64 / 1_000_000.0) / sampled_hours_total
    } else {
        0.0
    };
    let ci_min50 = wilson_ci95(agg_metrics.recalled_min_50, agg_metrics.total_clips);
    let ci_iou30 = wilson_ci95(agg_metrics.recalled_iou_30, agg_metrics.total_clips);
    let ci_scenes_min50 = wilson_ci95(agg_metrics.recalled_scenes_min_50, agg_metrics.total_scenes);

    let out = json!({
        "model": model,
        "withChat": with_chat,
        "sampledMode": sample_plan.is_some(),
        "sampleSeed": sample_plan.as_ref().map(|p| p.seed),
        "dailyTokensAccounted": daily_tokens_used,
        "stoppedEarlyReason": stopped_globally,
        "sampledAudioHours": sampled_hours_total,
        "activeCallMs": total_active_ms,
        "activeSecsPerHour": active_secs_per_hour,
        "sampledUsdPerHour": sampled_usd_per_hour,
        "wilsonCi95": {
            "recallMin50": {"low": ci_min50.0, "high": ci_min50.1, "n": agg_metrics.total_clips},
            "recallIou30": {"low": ci_iou30.0, "high": ci_iou30.1, "n": agg_metrics.total_clips},
            "recallScenesMin50": {"low": ci_scenes_min50.0, "high": ci_scenes_min50.1, "n": agg_metrics.total_scenes},
        },
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
        Some("plan-sample") => cmd_plan_sample(&args[1..]),
        Some("run-selection") => cmd_run_selection(&args[1..]),
        _ => Err("Subcomandos: prepare | calibrate-chat | plan-sample | run-selection".into()),
    };
    res.map_err(|e| io::Error::other(e).into())
}
