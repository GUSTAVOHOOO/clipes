//! Encoder H.264 do export (#62, ADR-0004): detecção com export curto real, cache fora do
//! Projeto, troca manual e fallback para x264. Só processos gerenciados, sem shell, sem rede.
//! Motivos de falha são identificadores fixos; stderr do FFmpeg nunca é guardado (ADR-0006).
use super::{
    error, failed,
    render::{self, RenderInput},
};
use crate::{provider::CancelToken, CommandRegistration, CommandResult, CoreError, EventSink};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

pub const X264: &str = "libx264";
/// Ordem de preferência do ADR-0004. O x264 vem depois e é o fallback garantido.
pub const HARDWARE: [&str; 4] = ["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"];
/// Motivo fixo registrado quando o encoder escolhido falha num export.
pub const REASON_ENCODER_FAILED: &str = "encoder_failed";

/// Tempo máximo de cada processo de detecção (listagem, versão, export curto e ffprobe).
pub const DETECT_TIMEOUT: Duration = Duration::from_secs(30);
/// Export curto do teste: 1 s de `testsrc2` no canvas final do export, a 30 fps.
const PROBE_SOURCE: &str = "testsrc2=size=1080x1920:rate=30:duration=1";

// Qualidade equivalente entre encoders. Cada perfil mira o mesmo ponto do x264 (CRF 20,
// preset fast): imagem visualmente próxima, a taxa de bits variando com o conteúdo. Os
// valores de QSV, AMF e VideoToolbox seguem os guias de cada fabricante; o NVENC foi
// calibrado com VMAF/SSIM/PSNR em mídia real (#232, docs/research/2026-11-16-calibracao-nvenc-cq.md).

/// x264: o que o #59 já usa, mantido sem alterações.
pub(crate) const X264_ARGS: &[&str] = &["-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p"];
/// CQ padrão do NVENC calibrado contra x264 CRF 20 `fast` em RTX 3050 (#232).
pub const NVENC_CQ: &str = "25";
/// NVENC: `p5` é o preset de qualidade intermediário, `hq` o ajuste de qualidade e
/// `-cq 25` o alvo constante-qualidade calibrado contra x264 CRF 20 (`fast`);
/// `-b:v 0` deixa só o CQ mandar na taxa.
const NVENC_ARGS: &[&str] = &[
    "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", NVENC_CQ, "-b:v", "0", "-pix_fmt",
    "yuv420p",
];
/// QSV: `-global_quality 22` liga o modo ICQ (qualidade constante); `medium` equilibra
/// velocidade e eficiência. Entra como nv12, o formato nativo do Quick Sync.
const QSV_ARGS: &[&str] = &[
    "-preset",
    "medium",
    "-global_quality",
    "22",
    "-pix_fmt",
    "nv12",
];
/// AMF: `-quality quality` é o preset mais lento do AMF; `cqp` com QP 22 equivale a
/// qualidade constante.
const AMF_ARGS: &[&str] = &[
    "-quality", "quality", "-rc", "cqp", "-qp_i", "22", "-qp_p", "22", "-pix_fmt", "yuv420p",
];
/// VideoToolbox: `-q:v 65` (escala 0–100, maior é melhor) para qualidade constante.
const VIDEOTOOLBOX_ARGS: &[&str] = &["-q:v", "65", "-pix_fmt", "yuv420p"];

/// Argumentos de qualidade do encoder, ou `None` para um nome que o Clipes não conhece.
pub fn args(encoder: &str) -> Option<&'static [&'static str]> {
    match encoder {
        X264 => Some(X264_ARGS),
        "h264_nvenc" => Some(NVENC_ARGS),
        "h264_qsv" => Some(QSV_ARGS),
        "h264_amf" => Some(AMF_ARGS),
        "h264_videotoolbox" => Some(VIDEOTOOLBOX_ARGS),
        _ => None,
    }
}

// ------------------------------------------------------------------ processos

/// Roda um executável sem shell, com limite de tempo e cancelamento. Devolve o sucesso e o
/// stdout; o stderr é descartado.
fn capture(
    program: &Path,
    arguments: &[OsString],
    cancel: &CancelToken,
) -> Result<(bool, String), CoreError> {
    if cancel.is_cancelled() {
        return Err(cancelled());
    }
    let (mut child, group) = crate::process::spawn_managed_with(program, arguments, |c| {
        c.stdin(std::process::Stdio::null());
    })
    .map_err(|_| failed())?;
    let mut stdout = child.stdout.take().ok_or_else(failed)?;
    let mut stderr = child.stderr.take().ok_or_else(failed)?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = (&mut stdout).take(1 << 20).read_to_string(&mut text);
        text
    });
    let drain = std::thread::spawn(move || {
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
    });
    let started = Instant::now();
    let status = loop {
        if cancel.is_cancelled() || started.elapsed() > DETECT_TIMEOUT {
            group.terminate();
            let _ = child.wait();
            let _ = reader.join();
            let _ = drain.join();
            return Err(if cancel.is_cancelled() {
                cancelled()
            } else {
                failed()
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(render::PROCESS_POLL),
            Err(_) => {
                group.terminate();
                let _ = child.wait();
                return Err(failed());
            }
        }
    };
    let text = reader.join().map_err(|_| failed())?;
    let _ = drain.join();
    Ok((status.success(), text))
}

fn cancelled() -> CoreError {
    error("cancelled", "Export cancelado.")
}

fn os(items: &[&str]) -> Vec<OsString> {
    items.iter().map(OsString::from).collect()
}

/// Nomes de candidatos presentes na saída de `ffmpeg -encoders`, na ordem do ADR-0004.
pub fn listed(output: &str) -> Vec<&'static str> {
    let present: Vec<&str> = output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let flags = fields.next()?;
            (flags.len() == 6 && flags.starts_with('V')).then(|| fields.next())?
        })
        .collect();
    HARDWARE
        .into_iter()
        .filter(|name| present.contains(name))
        .collect()
}

/// Export real de 1 s e conferência do arquivo: precisa ser H.264 de 1080×1920.
fn probe(
    ffmpeg: &Path,
    ffprobe: &Path,
    encoder: &str,
    cancel: &CancelToken,
) -> Result<bool, CoreError> {
    let Some(quality) = args(encoder) else {
        return Ok(false);
    };
    let dir = tempfile::Builder::new()
        .prefix("clipes-encoder-")
        .tempdir()
        .map_err(|_| failed())?;
    let target = dir.path().join("teste.mp4");
    let mut run = os(&[
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        PROBE_SOURCE,
        "-an",
        "-c:v",
        encoder,
    ]);
    run.extend(quality.iter().map(OsString::from));
    run.extend(os(&["-f", "mp4", "-y"]));
    run.push(target.clone().into_os_string());
    match capture(ffmpeg, &run, cancel) {
        Ok((true, _)) => {}
        Err(e) if e.code == "cancelled" => return Err(e),
        _ => return Ok(false),
    }
    let mut check = os(&[
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height",
        "-of",
        "csv=p=0",
    ]);
    check.push(target.into_os_string());
    match capture(ffprobe, &check, cancel) {
        Ok((true, text)) => Ok(text.trim() == "h264,1080,1920"),
        Err(e) if e.code == "cancelled" => Err(e),
        _ => Ok(false),
    }
}

// ------------------------------------------------------------------ cache

/// Identidade da máquina: o resultado só vale para a mesma versão do FFmpeg e o mesmo driver.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Key {
    ffmpeg_version: String,
    gpu: String,
    driver: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Cache {
    #[serde(flatten)]
    key: Key,
    /// Encoders que passaram no teste, na ordem do ADR-0004; o x264 sempre fecha a lista.
    passed: Vec<String>,
    selected: String,
    /// Troca manual das Preferências; vale enquanto o encoder continuar na lista.
    #[serde(default)]
    manual: Option<String>,
    detected_at: u64,
}

impl Cache {
    fn effective(&self) -> &str {
        self.manual
            .as_deref()
            .filter(|m| self.passed.iter().any(|p| p == m))
            .unwrap_or(&self.selected)
    }
}

static LOCK: Mutex<()> = Mutex::new(());

fn cache_path() -> Result<PathBuf, CoreError> {
    crate::paths::data_file("export-encoder.json").map_err(|_| failed())
}

fn read_cache() -> Option<Cache> {
    let bytes = fs::read(cache_path().ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_cache(cache: &Cache) -> Result<(), CoreError> {
    let target = cache_path()?;
    fs::create_dir_all(target.parent().ok_or_else(failed)?).map_err(|_| failed())?;
    let temp = target.with_extension("json.part");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(cache).map_err(|_| failed())?,
    )
    .map_err(|_| failed())?;
    fs::rename(&temp, &target).map_err(|_| failed())
}

fn current_key(ffmpeg: &Path, cancel: &CancelToken) -> Result<Key, CoreError> {
    let (ok, text) = capture(ffmpeg, &os(&["-version"]), cancel)?;
    let line = text.lines().next().unwrap_or_default();
    if !ok || line.is_empty() {
        return Err(failed());
    }
    let gpu = crate::components::hardware::detect_gpu();
    Ok(Key {
        ffmpeg_version: line
            .split_whitespace()
            .nth(2)
            .unwrap_or(line)
            .chars()
            .take(80)
            .collect(),
        gpu: gpu.as_ref().map(|g| g.name.clone()).unwrap_or_default(),
        driver: gpu.map(|g| g.driver).unwrap_or_default(),
    })
}

fn ffmpeg_path() -> Result<PathBuf, CoreError> {
    crate::components::cache_settings()?
        .2
        .ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))
}

/// Testa cada candidato presente com um export real e monta o cache. Preserva a troca manual
/// se o encoder continuar aprovado.
fn detect(ffmpeg: &Path, key: Key, cancel: &CancelToken) -> Result<Cache, CoreError> {
    let ffprobe = crate::components::ffprobe_executable(Some(ffmpeg))?;
    let (_, text) = capture(ffmpeg, &os(&["-hide_banner", "-encoders"]), cancel)?;
    let mut passed = Vec::new();
    for name in listed(&text) {
        if probe(ffmpeg, &ffprobe, name, cancel)? {
            passed.push(name.to_string());
        }
    }
    // O x264 também é testado, mas fecha a lista de qualquer jeito: é o fallback garantido.
    let _ = probe(ffmpeg, &ffprobe, X264, cancel)?;
    passed.push(X264.into());
    let manual = read_cache()
        .and_then(|c| c.manual)
        .filter(|m| passed.contains(m));
    let cache = Cache {
        key,
        selected: passed[0].clone(),
        passed,
        manual,
        detected_at: crate::components::hardware::now(),
    };
    write_cache(&cache)?;
    Ok(cache)
}

/// Cache válido para esta máquina, detectando na primeira execução ou quando algo mudou.
fn ensure(ffmpeg: &Path, cancel: &CancelToken) -> Result<Cache, CoreError> {
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let key = current_key(ffmpeg, cancel)?;
    match read_cache() {
        Some(cache) if cache.key == key => Ok(cache),
        _ => detect(ffmpeg, key, cancel),
    }
}

/// Encoder para o próximo export. Qualquer falha de detecção (exceto cancelar) cai no x264.
pub fn resolve(ffmpeg: &Path, cancel: &CancelToken) -> Result<String, CoreError> {
    match ensure(ffmpeg, cancel) {
        Ok(cache) => Ok(cache.effective().to_string()),
        Err(e) if e.code == "cancelled" => Err(e),
        Err(_) => Ok(X264.into()),
    }
}

/// Tira o encoder da lista depois de uma falha no export, para não repetir nem avisar de novo.
fn forget(encoder: &str) {
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut cache) = read_cache() {
        cache.passed.retain(|p| p != encoder || p == X264);
        if cache.selected == encoder {
            cache.selected = cache.passed[0].clone();
        }
        let _ = write_cache(&cache);
    }
}

// ------------------------------------------------------------------ export com fallback

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fallback {
    pub from: String,
    pub reason: &'static str,
}

/// Representação JSON de fallback compartilhada entre `export.status` e `export.batch.*`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct FallbackView<'a> {
    pub(crate) from: &'a str,
    pub(crate) reason: &'a str,
}

pub(crate) fn fallback_view<'a>(
    from: Option<&'a str>,
    reason: Option<&'a str>,
) -> Option<FallbackView<'a>> {
    from.map(|from| FallbackView {
        from,
        reason: reason.unwrap_or(REASON_ENCODER_FAILED),
    })
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    /// Encoder que de fato gerou o arquivo.
    pub encoder: String,
    pub fallback: Option<Fallback>,
}

/// Exporta com `preferred`; se esse encoder falhar, refaz a etapa com x264. Só `export_failed`
/// (o FFmpeg saiu com erro) dispara o fallback: cancelamento e erros de entrada seguem iguais.
pub fn render_with_fallback(
    ffmpeg: &Path,
    input: &RenderInput,
    preferred: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    with_fallback(
        preferred,
        |encoder, progress| render::render_with(ffmpeg, input, encoder, cancel, progress),
        progress,
    )
}

/// Igual a `render_with_fallback`, com as legendas estilizadas do Corte (#65).
pub fn render_styled_with_fallback(
    ffmpeg: &Path,
    input: &RenderInput,
    prepared: &crate::caption_style::Prepared,
    preferred: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    render_styled_spliced_with_fallback(ffmpeg, input, &[], prepared, preferred, cancel, progress)
}

/// Igual a `render_styled_with_fallback`, aplicando os trechos mantidos do corte de silêncios (#77).
pub fn render_styled_spliced_with_fallback(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[crate::editor::silences::KeptSegment],
    prepared: &crate::caption_style::Prepared,
    preferred: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    render_styled_spliced_with_fallback_overwrite(
        ffmpeg, input, segments, prepared, preferred, false, cancel, progress,
    )
}

/// Variante interna usada pelo lote (#64) com sobrescrita confirmada.
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_styled_spliced_with_fallback_overwrite(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[crate::editor::silences::KeptSegment],
    prepared: &crate::caption_style::Prepared,
    preferred: &str,
    overwrite: bool,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    render_styled_spliced_crop_plan_with_fallback_overwrite(
        ffmpeg, input, segments, prepared, preferred, overwrite, None, cancel, progress,
    )
}

/// Variante interna usada pelo export com plano de layout (#78).
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_styled_spliced_crop_plan_with_fallback_overwrite(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[crate::editor::silences::KeptSegment],
    prepared: &crate::caption_style::Prepared,
    preferred: &str,
    overwrite: bool,
    crop_plan: Option<&crate::editor::crop::ResolvedCropPlan>,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    render_styled_spliced_crop_plan_narration_with_fallback_overwrite(
        ffmpeg, input, segments, prepared, preferred, overwrite, crop_plan, None, cancel, progress,
    )
}

/// Variante interna usada pelo export com plano de layout (#78) e Narração/ducking (#82).
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_styled_spliced_crop_plan_narration_with_fallback_overwrite(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[crate::editor::silences::KeptSegment],
    prepared: &crate::caption_style::Prepared,
    preferred: &str,
    overwrite: bool,
    crop_plan: Option<&crate::editor::crop::ResolvedCropPlan>,
    narration: Option<&render::NarrationRenderInput>,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    render_styled_spliced_crop_plan_narration_audio_with_fallback_overwrite(
        ffmpeg, input, segments, prepared, preferred, overwrite, crop_plan, narration, None,
        cancel, progress,
    )
}

/// Variante interna usada pelo export com plano de layout (#78), Narração (#82) e trilha/efeitos (#154).
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_styled_spliced_crop_plan_narration_audio_with_fallback_overwrite(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[crate::editor::silences::KeptSegment],
    prepared: &crate::caption_style::Prepared,
    preferred: &str,
    overwrite: bool,
    crop_plan: Option<&crate::editor::crop::ResolvedCropPlan>,
    narration: Option<&render::NarrationRenderInput>,
    audio: Option<&render::AudioMixRenderInput>,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    with_fallback(
        preferred,
        |encoder, progress| {
            render::render_styled_spliced_crop_plan_narration_audio_with_overwrite(
                ffmpeg, input, segments, prepared, encoder, overwrite, crop_plan, narration, audio,
                cancel, progress,
            )
        },
        progress,
    )
}

fn with_fallback(
    preferred: &str,
    mut run: impl FnMut(&str, &mut dyn FnMut(u8)) -> Result<(), CoreError>,
    progress: &mut dyn FnMut(u8),
) -> Result<Outcome, CoreError> {
    let mut last = 0_u8;
    let mut monotonic = |p: u8| {
        if p > last {
            last = p;
            progress(p);
        }
    };
    match run(preferred, &mut monotonic) {
        Ok(()) => Ok(Outcome {
            encoder: preferred.into(),
            fallback: None,
        }),
        Err(e) if preferred != X264 && e.code == "export_failed" => {
            forget(preferred);
            run(X264, &mut monotonic)?;
            Ok(Outcome {
                encoder: X264.into(),
                fallback: Some(Fallback {
                    from: preferred.into(),
                    reason: REASON_ENCODER_FAILED,
                }),
            })
        }
        Err(e) => Err(e),
    }
}

// ------------------------------------------------------------------ comandos

fn view(cache: Option<&Cache>, stale: bool) -> Value {
    match cache {
        Some(c) => json!({
            "ffmpeg": true, "detected": !stale, "stale": stale,
            "passed": c.passed, "selected": c.selected, "manual": c.manual,
            "effective": c.effective(), "gpu": c.key.gpu, "detected_at": c.detected_at,
        }),
        None => json!({
            "ffmpeg": true, "detected": false, "stale": false, "passed": [],
            "selected": X264, "manual": null, "effective": X264, "gpu": "", "detected_at": null,
        }),
    }
}

/// Estado do cache, sem testar nada: `detected:false` até a primeira detecção ou depois que
/// a versão do FFmpeg ou o driver mudaram.
fn cmd_status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let Ok(ffmpeg) = ffmpeg_path() else {
        return Ok(json!({"ffmpeg": false, "detected": false, "passed": [], "effective": X264}));
    };
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let cache = read_cache();
    let stale = match (&cache, current_key(&ffmpeg, &CancelToken::new())) {
        (Some(c), Ok(key)) => c.key != key,
        _ => false,
    };
    Ok(view(cache.as_ref(), stale))
}

fn cmd_detect(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ffmpeg = ffmpeg_path()?;
    let cancel = CancelToken::new();
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let cache = detect(&ffmpeg, current_key(&ffmpeg, &cancel)?, &cancel)?;
    Ok(view(Some(&cache), false))
}

/// `{encoder}` escolhe entre os que passaram no teste; `{encoder:null}` volta ao automático.
fn cmd_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let invalid = || {
        error(
            "encoder_invalid",
            "Escolha um encoder da lista que passou no teste.",
        )
    };
    let choice = match &v["encoder"] {
        Value::Null => None,
        Value::String(name) => Some(name.clone()),
        _ => return Err(invalid()),
    };
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut cache = read_cache().ok_or_else(invalid)?;
    if choice.as_ref().is_some_and(|c| !cache.passed.contains(c)) {
        return Err(invalid());
    }
    cache.manual = choice;
    write_cache(&cache)?;
    Ok(view(Some(&cache), false))
}

inventory::submit! { CommandRegistration {name:"export.encoder.status",execute:cmd_status} }
inventory::submit! { CommandRegistration {name:"export.encoder.detect",execute:cmd_detect} }
inventory::submit! { CommandRegistration {name:"export.encoder.set",execute:cmd_set} }
