//! Sonda de hardware e escolha de precisão da Transcrição local (#50).
//!
//! A sonda mede a VRAM livre (`nvidia-smi`, a mesma interface NVML, sem dependência nova),
//! pergunta ao worker a versão do CTranslate2 e roda um teste curto real com o clipe PT/EN
//! embutido (`word_timestamps`) na cadeia `int8_float16` → `float16` → `int8` → CPU. Cada
//! tentativa roda num processo de worker próprio, encerrado se passar de [`PROBE_TIMEOUT`].
//! Depois mede o lote seguro da GPU (1 → 2 → 4 → 8, parando no primeiro que falhar), só como
//! MEDIÇÃO de diagnóstico: o Motor local continua com lote 1 na GPU (o faster-whisper 1.2.1
//! cria um `audio_chunk` por chamada e o Motor envia um trecho de VAD por chamada; agrupar
//! trechos é o ticket #162).
//!
//! A ordem da cadeia vem do benchmark #32 (docs/research/2026-11-14-benchmark-transcricao.md):
//! `int8_float16` venceu em WER e RTF e usou menos VRAM, então vem antes de `float16`,
//! diferente da ordem escrita no ticket.
//!
//! GPU AMD ou Intel não é usada pelo CTranslate2: sem NVIDIA e CUDA, a escolha é CPU.
//!
//! Resultado, escolha manual e taxas medidas ficam em `transcription-hardware.json` nos
//! dados do app (`CLIPES_DATA_DIR`), nunca no Projeto.

use super::models::{ModelSpec, SMALL, TURBO};
use super::*;
use crate::worker::WorkerEvent;
use std::time::{Duration, Instant, SystemTime};

/// Tempo máximo de cada tentativa da sonda. `CLIPES_PROBE_TIMEOUT_SECONDS` existe só para os testes.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(300);
/// Palavras mínimas por idioma do clipe para a tentativa contar como bem-sucedida.
pub(crate) const MIN_CLIP_WORDS: u64 = 5;
/// Escada de lotes medida na GPU.
pub(crate) const BATCH_LADDER: [u32; 4] = [1, 2, 4, 8];
/// Precisões da GPU, da preferida à última.
pub(crate) const GPU_PRECISIONS: [&str; 3] = ["int8_float16", "float16", "int8"];
/// Abaixo desta RAM física total, o turbo em CPU fica desabilitado.
pub(crate) const TURBO_CPU_MIN_TOTAL_RAM: u64 = 8 * 1024 * 1024 * 1024;
/// Abaixo desta RAM disponível ao iniciar, o turbo em CPU mostra um aviso (não bloqueia).
pub(crate) const TURBO_CPU_MIN_AVAILABLE_RAM: u64 = 3 * 1024 * 1024 * 1024;
const STORE: &str = "transcription-hardware.json";
const MAX_RECORDS: usize = 16;
pub(crate) const PROBE_JOB: &str = "hardware-probe";

fn probe_timeout() -> Duration {
    std::env::var("CLIPES_PROBE_TIMEOUT_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|s| *s > 0)
        .map_or(PROBE_TIMEOUT, Duration::from_secs)
}

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

// ---------------------------------------------------------------- hardware

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Gpu {
    pub name: String,
    pub driver: String,
    pub total_mib: u64,
    pub free_mib: u64,
}

pub(crate) fn parse_gpu(csv: &str) -> Option<Gpu> {
    let line = csv.lines().map(str::trim).find(|l| !l.is_empty())?;
    let fields: Vec<&str> = line.split(',').map(str::trim).collect();
    if fields.len() != 4 || fields[0].is_empty() {
        return None;
    }
    Some(Gpu {
        name: fields[0].into(),
        driver: fields[1].into(),
        total_mib: fields[2].parse().ok()?,
        free_mib: fields[3].parse().ok()?,
    })
}

/// Primeira GPU NVIDIA e sua VRAM livre; `None` sem driver NVIDIA (inclui AMD e Intel).
/// `CLIPES_NVIDIA_SMI` troca o executável, só nos testes.
pub(crate) fn detect_gpu() -> Option<Gpu> {
    let program = std::env::var_os("CLIPES_NVIDIA_SMI").unwrap_or_else(|| "nvidia-smi".into());
    let output = crate::process::spawn(
        program,
        [
            "--query-gpu=name,driver_version,memory.total,memory.free",
            "--format=csv,noheader,nounits",
        ],
        None,
    )
    .and_then(|child| child.wait_with_output())
    .ok()
    .filter(|o| o.status.success())?;
    parse_gpu(&String::from_utf8_lossy(&output.stdout))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Ram {
    pub total: u64,
    pub available: u64,
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn parse_meminfo(text: &str) -> Option<Ram> {
    let kib = |key: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(key))
            .and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
            .map(|v| v * 1024)
    };
    Some(Ram {
        total: kib("MemTotal:")?,
        available: kib("MemAvailable:")?,
    })
}

#[cfg(windows)]
fn system_ram() -> Option<Ram> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: estrutura inicializada com o tamanho exigido pela API.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        (GlobalMemoryStatusEx(&mut status) != 0).then_some(Ram {
            total: status.ullTotalPhys,
            available: status.ullAvailPhys,
        })
    }
}
#[cfg(target_os = "linux")]
fn system_ram() -> Option<Ram> {
    parse_meminfo(&fs::read_to_string("/proc/meminfo").ok()?)
}
#[cfg(not(any(windows, target_os = "linux")))]
fn system_ram() -> Option<Ram> {
    None
}

/// RAM física; `None` se a sonda falhar. `CLIPES_FAKE_RAM=total,disponível` (bytes) só nos testes,
/// e `CLIPES_FAKE_RAM=fail` simula a falha.
pub(crate) fn detect_ram() -> Option<Ram> {
    if let Ok(fake) = std::env::var("CLIPES_FAKE_RAM") {
        let (total, available) = fake.split_once(',')?;
        return Some(Ram {
            total: total.parse().ok()?,
            available: available.parse().ok()?,
        });
    }
    system_ram()
}

// ---------------------------------------------------------------- escolha

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Config {
    pub model: String,
    pub device: String,
    pub compute_type: String,
}

impl Config {
    fn new(spec: &ModelSpec, device: &str, compute_type: &str) -> Config {
        Config {
            model: spec.id.into(),
            device: device.into(),
            compute_type: compute_type.into(),
        }
    }
    pub(crate) fn spec(&self) -> Option<&'static ModelSpec> {
        super::models::MODELS
            .into_iter()
            .find(|m| m.id == self.model)
    }
    pub(crate) fn is_turbo_cpu(&self) -> bool {
        self.model == TURBO.id && self.device == "cpu"
    }
    /// O Motor local usa lote 1 na GPU e até 8 em CPU, como no benchmark #32.
    pub(crate) fn batch_size(&self) -> u32 {
        if self.device == "cpu" {
            8
        } else {
            1
        }
    }
}

/// A configuração de fábrica: turbo `int8_float16` com o worker CUDA, `small` INT8 em CPU.
fn default_config(settings: &Settings) -> Config {
    if super::worker::cuda_installed(settings) {
        Config::new(&TURBO, "cuda", "int8_float16")
    } else {
        Config::new(&SMALL, "cpu", "int8")
    }
}

#[derive(Serialize)]
pub(crate) struct Candidate {
    #[serde(flatten)]
    pub config: Config,
    pub enabled: bool,
    pub reason: Option<&'static str>,
    pub installed: bool,
}

pub(crate) fn candidates(settings: &Settings, ram: Option<Ram>) -> Vec<Candidate> {
    let cuda = super::worker::cuda_installed(settings);
    let mut all = Vec::new();
    for precision in GPU_PRECISIONS {
        all.push((
            Config::new(&TURBO, "cuda", precision),
            (!cuda).then_some("no_cuda"),
        ));
    }
    all.push((
        Config::new(&TURBO, "cpu", "int8"),
        ram.filter(|r| r.total < TURBO_CPU_MIN_TOTAL_RAM)
            .map(|_| "ram_insufficient"),
    ));
    all.push((Config::new(&SMALL, "cpu", "int8"), None));
    all.into_iter()
        .map(|(config, reason)| Candidate {
            installed: config.spec().is_some_and(|s| s.installed(settings)),
            enabled: reason.is_none(),
            reason,
            config,
        })
        .collect()
}

/// A configuração em uso: a escolha manual, senão a da última sonda deste hardware, senão
/// a de fábrica.
pub(crate) fn effective(settings: &Settings) -> Config {
    let store = read_store(settings);
    let usable = |config: &Config| {
        candidates(settings, detect_ram())
            .iter()
            .any(|c| c.enabled && c.config == *config)
    };
    if let Some(manual) = store.manual.filter(&usable) {
        return manual;
    }
    let gpu = detect_gpu();
    store
        .probes
        .iter()
        .rev()
        .find(|p| {
            p.key.gpu == gpu_label(&gpu)
                && p.key.driver == gpu_driver(&gpu)
                && p.key.app_version == env!("CARGO_PKG_VERSION")
                && usable(&p.chosen)
        })
        .map_or_else(|| default_config(settings), |p| p.chosen.clone())
}

fn gpu_label(gpu: &Option<Gpu>) -> String {
    gpu.as_ref().map_or("cpu".into(), |g| g.name.clone())
}
fn gpu_driver(gpu: &Option<Gpu>) -> String {
    gpu.as_ref().map_or(String::new(), |g| g.driver.clone())
}

/// Avisos não bloqueantes ao iniciar uma Transcrição com esta configuração.
pub(crate) fn start_warnings(config: &Config) -> Vec<&'static str> {
    if !config.is_turbo_cpu() {
        return Vec::new();
    }
    match detect_ram() {
        None => vec!["ram_unknown"],
        Some(ram) if ram.available < TURBO_CPU_MIN_AVAILABLE_RAM => vec!["low_ram"],
        Some(_) => Vec::new(),
    }
}

/// Avisos de RAM da configuração em uso, para o início da Transcrição local.
pub(crate) fn current_start_warnings() -> Vec<&'static str> {
    load_settings().map_or_else(|_| Vec::new(), |s| start_warnings(&effective(&s)))
}

// ---------------------------------------------------------------- armazenamento

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ProbeKey {
    pub gpu: String,
    pub driver: String,
    pub ct2_version: String,
    pub model: String,
    pub app_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Attempt {
    pub device: String,
    pub compute_type: String,
    pub batch_size: u32,
    pub ok: bool,
    pub error: Option<String>,
    pub load_s: Option<f64>,
    pub run_s: Option<f64>,
    pub audio_s: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct BatchMeasure {
    pub compute_type: String,
    pub tested: Vec<(u32, bool)>,
    pub max_safe: Option<u32>,
    /// Origem da medição: a sonda, com o clipe embutido e `clip_timestamps`.
    pub origin: String,
    pub measured_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ProbeRecord {
    pub key: ProbeKey,
    pub chosen: Config,
    /// `false` quando o modelo da CPU não estava instalado e a escolha não foi testada.
    pub verified: bool,
    pub attempts: Vec<Attempt>,
    pub batch: Option<BatchMeasure>,
    pub vram_free_mib: Option<u64>,
    pub measured_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct RateRecord {
    pub gpu: String,
    pub driver: String,
    pub config: Config,
    pub load_s: f64,
    /// Segundos de processamento por segundo de áudio.
    pub rate: f64,
    pub measured_at: u64,
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Store {
    #[serde(default)]
    pub manual: Option<Config>,
    #[serde(default)]
    pub probes: Vec<ProbeRecord>,
    #[serde(default)]
    pub rates: Vec<RateRecord>,
}

fn store_path(settings: &Settings) -> PathBuf {
    settings.data_dir.join(STORE)
}

pub(crate) fn read_store(settings: &Settings) -> Store {
    fs::read(store_path(settings))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn write_store(settings: &Settings, store: &mut Store) -> Result<(), CoreError> {
    let keep = |len: usize| len.saturating_sub(MAX_RECORDS);
    store.probes.drain(..keep(store.probes.len()));
    store.rates.drain(..keep(store.rates.len()));
    let failed = || {
        error(
            "hardware_store",
            "Não foi possível gravar as configurações de hardware.",
        )
    };
    fs::create_dir_all(&settings.data_dir).map_err(|_| failed())?;
    let target = store_path(settings);
    let temp = target.with_extension("json.part");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(store).map_err(|_| failed())?,
    )
    .map_err(|_| failed())?;
    fs::rename(&temp, &target).map_err(|_| failed())
}

// ---------------------------------------------------------------- tentativas isoladas

/// Executa uma tarefa `probe` num worker novo, com tempo limite, e o encerra em seguida.
/// `Err("probe_timeout")` se passar do limite; `Err("cancelled")` se o usuário cancelar.
pub(crate) fn run_probe_task(
    params: Value,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(u8),
) -> Result<Value, CoreError> {
    let mut client = super::worker::start_worker()?;
    let local = AtomicBool::new(false);
    let timed_out = AtomicBool::new(false);
    let finished = AtomicBool::new(false);
    let limit = probe_timeout();
    let outcome = std::thread::scope(|scope| {
        scope.spawn(|| {
            let started = Instant::now();
            while !finished.load(Ordering::SeqCst) {
                if cancel.load(Ordering::SeqCst) {
                    local.store(true, Ordering::SeqCst);
                    break;
                }
                if started.elapsed() >= limit {
                    timed_out.store(true, Ordering::SeqCst);
                    local.store(true, Ordering::SeqCst);
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        });
        let outcome = client.run("probe", params, &local, &mut |event| {
            if let WorkerEvent::Progress { percentage, .. } = event {
                on_progress(percentage);
            }
        });
        finished.store(true, Ordering::SeqCst);
        outcome
    });
    drop(client);
    match outcome {
        Err(e) if e.code == "cancelled" && timed_out.load(Ordering::SeqCst) => Err(error(
            "probe_timeout",
            "A tentativa passou do tempo limite da sonda de hardware.",
        )),
        other => other,
    }
}

fn model_params(spec: &ModelSpec, settings: &Settings, device: &str, compute: &str) -> Value {
    json!({"id": spec.id, "dir": spec.dir(settings), "device": device, "compute_type": compute})
}

fn clip_attempt(
    spec: &ModelSpec,
    settings: &Settings,
    device: &str,
    compute: &str,
    batch: u32,
    cancel: &AtomicBool,
) -> Result<Attempt, CoreError> {
    let result = run_probe_task(
        json!({"mode": "clip", "batch_size": batch, "model": model_params(spec, settings, device, compute)}),
        cancel,
        &mut |_| {},
    );
    let base = |ok: bool, error: Option<String>, data: &Value| Attempt {
        device: device.into(),
        compute_type: compute.into(),
        batch_size: batch,
        ok,
        error,
        load_s: data["load_s"].as_f64(),
        run_s: data["run_s"].as_f64(),
        audio_s: data["audio_s"].as_f64(),
    };
    match result {
        Ok(data) => {
            let words = |lang: &str| data["words"][lang].as_u64().unwrap_or(0);
            let ok = if batch == 1 {
                words("pt") >= MIN_CLIP_WORDS && words("en") >= MIN_CLIP_WORDS
            } else {
                words("pt") >= MIN_CLIP_WORDS
            };
            Ok(base(ok, (!ok).then(|| "clip_words".to_string()), &data))
        }
        Err(e) if e.code == "cancelled" => Err(e),
        Err(e) if e.code == "worker_missing" => Err(e),
        Err(e) => Ok(base(false, Some(e.code), &Value::Null)),
    }
}

/// Registra `id` em `components.cancel` enquanto `work` roda; só uma execução por id.
pub(crate) fn with_cancel<T>(
    id: &str,
    work: impl FnOnce(&AtomicBool) -> Result<T, CoreError>,
) -> Result<T, CoreError> {
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(id) {
            return Err(error(
                "already_running",
                "Esta medição já está em andamento.",
            ));
        }
        map.insert(id.into(), flag.clone());
    }
    let result = work(&flag);
    jobs().lock().unwrap().remove(id);
    result
}

/// A configuração em uso e o hardware que a produziu, para a estimativa de tempo.
pub(crate) struct Context {
    settings: Settings,
    pub config: Config,
    pub gpu: Option<Gpu>,
    pub spec: &'static ModelSpec,
}

pub(crate) fn context() -> Result<Context, CoreError> {
    let settings = load_settings()?;
    let config = effective(&settings);
    let spec = config.spec().unwrap_or(&SMALL);
    Ok(Context {
        gpu: detect_gpu(),
        spec,
        config,
        settings,
    })
}

impl Context {
    pub(crate) fn model_ready(&self) -> bool {
        self.spec.installed(&self.settings)
    }
    pub(crate) fn model_params(&self) -> Value {
        model_params(
            self.spec,
            &self.settings,
            &self.config.device,
            &self.config.compute_type,
        )
    }
    /// A taxa guardada para (hardware detectado, modelo, precisão), se houver.
    pub(crate) fn rate(&self) -> Option<RateRecord> {
        read_store(&self.settings)
            .rates
            .into_iter()
            .rev()
            .find(|r| {
                r.gpu == gpu_label(&self.gpu)
                    && r.driver == gpu_driver(&self.gpu)
                    && r.config == self.config
            })
    }
    pub(crate) fn save_rate(&self, load_s: f64, rate: f64) -> Result<(), CoreError> {
        let mut store = read_store(&self.settings);
        store.rates.retain(|r| {
            !(r.gpu == gpu_label(&self.gpu)
                && r.driver == gpu_driver(&self.gpu)
                && r.config == self.config)
        });
        store.rates.push(RateRecord {
            gpu: gpu_label(&self.gpu),
            driver: gpu_driver(&self.gpu),
            config: self.config.clone(),
            load_s,
            rate,
            measured_at: now(),
        });
        write_store(&self.settings, &mut store)
    }
}

// ---------------------------------------------------------------- sonda

fn step(events: &mut EventSink<'_>, percentage: u8, message: &str) {
    events(ProgressEvent {
        project: None,
        job: PROBE_JOB.into(),
        stage: "probe".into(),
        percentage,
        message: message.into(),
        error: None,
    });
}

fn probe(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    if !super::worker::installed(&settings) {
        return Err(error(
            "worker_missing",
            "Instale o worker de ML antes de medir o hardware.",
        ));
    }
    let _ = v;
    with_cancel(PROBE_JOB, |flag| run_chain(&settings, flag, events))
}

fn run_chain(
    settings: &Settings,
    cancel: &AtomicBool,
    events: &mut EventSink<'_>,
) -> CommandResult {
    step(events, 0, "Verificando o CTranslate2");
    let info = run_probe_task(json!({"mode": "info"}), cancel, &mut |_| {})?;
    let ct2_version = info["ct2_version"].as_str().unwrap_or("").to_owned();
    let cuda_types: Vec<String> = info["cuda_compute_types"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|t| t.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let gpu = detect_gpu();
    let use_gpu =
        gpu.is_some() && super::worker::cuda_installed(settings) && !cuda_types.is_empty();
    let mut attempts = Vec::new();
    let mut chosen: Option<(Config, bool)> = None;
    let mut batch = None;
    let mut model = SMALL.id;
    if use_gpu {
        model = TURBO.id;
        if !TURBO.installed(settings) {
            return Err(error(
                "model_missing",
                "O modelo de transcrição não está instalado; baixe-o em Componentes.",
            ));
        }
        let total = GPU_PRECISIONS.len() as u8 + 3;
        for (index, precision) in GPU_PRECISIONS.iter().enumerate() {
            if !cuda_types.iter().any(|t| t == precision) {
                continue;
            }
            step(
                events,
                (10 + index as u8 * 80 / total).min(90),
                &format!("Testando {precision} na GPU"),
            );
            let attempt = clip_attempt(&TURBO, settings, "cuda", precision, 1, cancel)?;
            let ok = attempt.ok;
            attempts.push(attempt);
            if ok {
                chosen = Some((Config::new(&TURBO, "cuda", precision), true));
                break;
            }
        }
        if let Some((config, _)) = &chosen {
            let mut tested = Vec::new();
            let mut max_safe = None;
            for size in BATCH_LADDER {
                step(events, 70, &format!("Medindo o lote seguro ({size})"));
                let attempt =
                    clip_attempt(&TURBO, settings, "cuda", &config.compute_type, size, cancel)?;
                let ok = attempt.ok;
                attempts.push(attempt);
                tested.push((size, ok));
                if !ok {
                    break;
                }
                max_safe = Some(size);
            }
            batch = Some(BatchMeasure {
                compute_type: config.compute_type.clone(),
                tested,
                max_safe,
                origin: "probe".into(),
                measured_at: now(),
            });
        }
    }
    if chosen.is_none() {
        model = SMALL.id;
        let config = Config::new(&SMALL, "cpu", "int8");
        if SMALL.installed(settings) {
            step(events, 80, "Testando a CPU");
            let attempt = clip_attempt(&SMALL, settings, "cpu", "int8", 1, cancel)?;
            let ok = attempt.ok;
            attempts.push(attempt);
            chosen = Some((config, ok));
        } else {
            chosen = Some((config, false));
        }
    }
    let (config, verified) = chosen.unwrap();
    let record = ProbeRecord {
        key: ProbeKey {
            gpu: gpu_label(&gpu),
            driver: gpu_driver(&gpu),
            ct2_version,
            model: model.into(),
            app_version: env!("CARGO_PKG_VERSION").into(),
        },
        chosen: config,
        verified,
        attempts,
        batch,
        vram_free_mib: gpu.as_ref().map(|g| g.free_mib),
        measured_at: now(),
    };
    let mut store = read_store(settings);
    store.probes.retain(|p| {
        !(p.key.gpu == record.key.gpu
            && p.key.driver == record.key.driver
            && p.key.ct2_version == record.key.ct2_version
            && p.key.model == record.key.model
            && p.key.app_version == record.key.app_version)
    });
    store.probes.push(record.clone());
    write_store(settings, &mut store)?;
    step(events, 100, "Sonda concluída");
    Ok(summary(&record))
}

fn summary(record: &ProbeRecord) -> Value {
    json!({
        "chosen": record.chosen,
        "verified": record.verified,
        "measured_at": record.measured_at,
        "attempts": record.attempts.iter().filter(|a| a.batch_size == 1).map(|a| json!({"device": a.device, "compute_type": a.compute_type, "ok": a.ok})).collect::<Vec<_>>(),
    })
}

// ---------------------------------------------------------------- comandos

fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    let gpu = detect_gpu();
    let ram = detect_ram();
    let store = read_store(&settings);
    let config = effective(&settings);
    let manual = store.manual.as_ref() == Some(&config);
    let probe = store
        .probes
        .iter()
        .rev()
        .find(|p| {
            p.key.gpu == gpu_label(&gpu)
                && p.key.driver == gpu_driver(&gpu)
                && p.key.app_version == env!("CARGO_PKG_VERSION")
        })
        .map(summary);
    let cuda = super::worker::cuda_installed(&settings) && gpu.is_some();
    Ok(json!({
        "gpu": gpu,
        "ram": ram,
        "cuda": cuda,
        "no_compatible_gpu": !cuda || config.device == "cpu",
        "effective": config,
        "manual": manual,
        "probe": probe,
        "options": candidates(&settings, ram),
        "worker_installed": super::worker::installed(&settings),
    }))
}

/// `{model, device, compute_type}` fixa a escolha manual; `{reset: true}` volta ao automático.
fn choose(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    let mut store = read_store(&settings);
    if v["reset"] == true {
        store.manual = None;
    } else {
        let wanted = Config {
            model: v["model"].as_str().unwrap_or("").into(),
            device: v["device"].as_str().unwrap_or("").into(),
            compute_type: v["compute_type"].as_str().unwrap_or("").into(),
        };
        let candidate = candidates(&settings, detect_ram())
            .into_iter()
            .find(|c| c.config == wanted)
            .ok_or_else(|| error("invalid_choice", "Configuração de transcrição inválida."))?;
        match candidate.reason {
            Some("ram_insufficient") => {
                return Err(error(
                    "ram_insufficient",
                    "Este computador não tem RAM suficiente para o modelo maior na CPU.",
                ))
            }
            Some(_) => {
                return Err(error(
                    "gpu_unavailable",
                    "A GPU não está disponível para o Motor local.",
                ))
            }
            None => {}
        }
        store.manual = Some(wanted);
    }
    write_store(&settings, &mut store)?;
    status(Value::Null, &mut |_| {})
}

/// Dados completos da sonda (inclui o lote medido), só para o diagnóstico: a UI não os mostra.
fn diagnostic_record(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    Ok(json!(read_store(&settings).probes.last()))
}

fn diagnostic_text() -> String {
    let Ok(settings) = load_settings() else {
        return "indisponível".into();
    };
    let store = read_store(&settings);
    let gpu = detect_gpu();
    let vram = gpu.map_or("sem GPU NVIDIA".to_string(), |g| {
        format!("{} MiB livres de {} MiB", g.free_mib, g.total_mib)
    });
    let batch = store.probes.last().and_then(|p| p.batch.as_ref()).map_or(
        "lote não medido".to_string(),
        |b| {
            format!(
                "lote seguro medido {} ({}, origem {})",
                b.max_safe.map_or("nenhum".to_string(), |n| n.to_string()),
                b.compute_type,
                b.origin
            )
        },
    );
    format!("{vram}; {batch}")
}

inventory::submit! { CommandRegistration { name: "transcription.hardware.status", execute: status } }
inventory::submit! { CommandRegistration { name: "transcription.hardware.probe", execute: probe } }
inventory::submit! { CommandRegistration { name: "transcription.hardware.choose", execute: choose } }
inventory::submit! { CommandRegistration { name: "transcription.hardware.diagnostic", execute: diagnostic_record } }
inventory::submit! { crate::diagnostic::DiagnosticField { kind: crate::diagnostic::DiagnosticKind::GpuVram, value: diagnostic_text } }

/// O modelo da escolha manual, se houver e ainda for válida; o resto do tempo `None`.
pub(crate) fn manual_model() -> Option<String> {
    let settings = load_settings().ok()?;
    let manual = read_store(&settings).manual?;
    candidates(&settings, detect_ram())
        .iter()
        .any(|c| c.enabled && c.config == manual)
        .then_some(manual.model)
}

/// A configuração para um modelo já fixado numa Transcrição: a em uso, se for do mesmo modelo;
/// senão a primeira opção habilitada desse modelo. Nunca troca de modelo.
pub(crate) fn config_for_model(settings: &Settings, model: &str) -> Option<Config> {
    let current = effective(settings);
    if current.model == model {
        return Some(current);
    }
    candidates(settings, detect_ram())
        .into_iter()
        .find(|c| c.enabled && c.config.model == model)
        .map(|c| c.config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_first_nvidia_gpu_and_rejects_garbage() {
        let gpu = parse_gpu("NVIDIA GeForce RTX 3050 Laptop GPU, 616.92, 4096, 3962\n").unwrap();
        assert_eq!(
            (gpu.driver.as_str(), gpu.total_mib, gpu.free_mib),
            ("616.92", 4096, 3962)
        );
        assert!(parse_gpu("").is_none());
        assert!(parse_gpu("falhou").is_none());
        assert!(parse_gpu("GPU, 1, nao, 3").is_none());
    }

    #[test]
    fn parses_proc_meminfo() {
        let ram =
            parse_meminfo("MemTotal:       16384 kB\nMemFree: 1 kB\nMemAvailable:    4096 kB\n")
                .unwrap();
        assert_eq!((ram.total, ram.available), (16384 * 1024, 4096 * 1024));
        assert!(parse_meminfo("MemTotal: 1 kB").is_none());
    }

    #[test]
    fn precision_chain_prefers_int8_float16_per_benchmark_32() {
        assert_eq!(GPU_PRECISIONS, ["int8_float16", "float16", "int8"]);
        assert_eq!(BATCH_LADDER, [1, 2, 4, 8]);
    }

    #[test]
    fn real_batch_is_one_on_gpu_and_up_to_eight_on_cpu() {
        assert_eq!(Config::new(&TURBO, "cuda", "int8").batch_size(), 1);
        assert_eq!(Config::new(&SMALL, "cpu", "int8").batch_size(), 8);
    }
}
