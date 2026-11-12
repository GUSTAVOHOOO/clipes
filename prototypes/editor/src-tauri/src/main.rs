// Protótipo descartável do editor de Cortes do Clipes.
// Lado Rust: serve a mídia por um protocolo próprio com Range e chama o FFmpeg
// com std::process::Command (sem shell) para proxy, miniaturas, forma de onda e exportação.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const FONTE: &str = "fonte-2h.mp4";
const FONTE_LARGURA: f64 = 1920.0;
const FONTE_ALTURA: f64 = 1080.0;
/// Intervalo entre miniaturas da tira da timeline, em segundos.
const MINIATURA_INTERVALO: f64 = 2.0;
const MINIATURA_COLUNAS: u32 = 10;
const MINIATURA_W: u32 = 192;
const MINIATURA_H: u32 = 108;
/// Picos da forma de onda por segundo.
const ONDA_POR_SEGUNDO: u32 = 100;

struct Estado {
    midia: PathBuf,
    /// Chaves de proxy em geração, para não disparar dois FFmpeg iguais.
    gerando: Mutex<HashSet<String>>,
}

fn pasta_midia() -> PathBuf {
    let bruto = match std::env::var("CLIPES_MIDIA") {
        Ok(p) => PathBuf::from(p),
        Err(_) => Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("media"),
    };
    // Resolve o "..": canonicalize no Windows devolve \\?\C:\..., que o Explorer não aceita.
    match fs::canonicalize(&bruto) {
        Ok(p) => PathBuf::from(p.to_string_lossy().trim_start_matches(r"\\?\").to_string()),
        Err(_) => bruto,
    }
}

fn ffmpeg() -> Command {
    let mut c = Command::new("ffmpeg");
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

// ---------------------------------------------------------------------------
// Protocolo midia:// (no Windows: http://midia.localhost/<caminho em media/>)
// ---------------------------------------------------------------------------

/// Teto de bytes por resposta parcial; o player pede o resto em seguida.
const PEDACO_MAX: u64 = 4 * 1024 * 1024;

fn tipo_conteudo(caminho: &Path) -> &'static str {
    match caminho.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "mp4" => "video/mp4",
        "json" => "application/json",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "srt" | "ass" | "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn resposta_erro(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

/// Lê `bytes=a-b`, `bytes=a-` ou `bytes=-n`. Retorna (início, fim inclusivo).
fn ler_range(valor: &str, total: u64) -> Option<(u64, u64)> {
    let espec = valor.trim().strip_prefix("bytes=")?;
    let primeiro = espec.split(',').next()?.trim();
    let (a, b) = primeiro.split_once('-')?;
    if total == 0 {
        return None;
    }
    if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        let n = n.min(total);
        return Some((total - n, total - 1));
    }
    let inicio: u64 = a.parse().ok()?;
    if inicio >= total {
        return None;
    }
    let fim = if b.is_empty() {
        (inicio + PEDACO_MAX - 1).min(total - 1)
    } else {
        b.parse::<u64>().ok()?.min(total - 1).min(inicio + 4 * PEDACO_MAX - 1)
    };
    if fim < inicio {
        return None;
    }
    Some((inicio, fim))
}

fn servir_midia(midia: &Path, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let bruto = req.uri().path().trim_start_matches('/');
    let rel = percent_encoding::percent_decode_str(bruto).decode_utf8_lossy().to_string();
    if rel.is_empty() || rel.split(['/', '\\']).any(|p| p == "..") {
        return resposta_erro(StatusCode::FORBIDDEN, "caminho inválido");
    }
    let caminho = midia.join(&rel);
    let mut arquivo = match fs::File::open(&caminho) {
        Ok(f) => f,
        Err(_) => return resposta_erro(StatusCode::NOT_FOUND, "arquivo não encontrado"),
    };
    let total = arquivo.metadata().map(|m| m.len()).unwrap_or(0);
    let tipo = tipo_conteudo(&caminho);
    let pedido = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Sem Range: arquivos pequenos vão inteiros; vídeo grande vira a 1ª parte.
    let intervalo = match pedido {
        Some(ref r) => match ler_range(r, total) {
            Some(i) => Some(i),
            None => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Vec::new())
                    .unwrap()
            }
        },
        None if total > 16 * 1024 * 1024 => Some((0, PEDACO_MAX.min(total) - 1)),
        None => None,
    };

    let mut resp = Response::builder()
        .header(header::CONTENT_TYPE, tipo)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache");
    match intervalo {
        Some((a, b)) => {
            let n = (b - a + 1) as usize;
            let mut buf = vec![0u8; n];
            if arquivo.seek(SeekFrom::Start(a)).is_err() || arquivo.read_exact(&mut buf).is_err() {
                return resposta_erro(StatusCode::INTERNAL_SERVER_ERROR, "falha de leitura");
            }
            resp = resp
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {a}-{b}/{total}"))
                .header(header::CONTENT_LENGTH, n.to_string());
            resp.body(buf).unwrap()
        }
        None => {
            let mut buf = Vec::with_capacity(total as usize);
            if arquivo.read_to_end(&mut buf).is_err() {
                return resposta_erro(StatusCode::INTERNAL_SERVER_ERROR, "falha de leitura");
            }
            resp = resp
                .status(StatusCode::OK)
                .header(header::CONTENT_LENGTH, buf.len().to_string());
            resp.body(buf).unwrap()
        }
    }
}

// ---------------------------------------------------------------------------
// FFmpeg: utilidades
// ---------------------------------------------------------------------------

fn seg(s: f64) -> String {
    format!("{:.3}", s.max(0.0))
}

/// Roda o FFmpeg com `-progress pipe:1` e chama `progresso(0..1)` a cada atualização.
/// Retorna Err com o fim do stderr se o processo falhar.
fn rodar_com_progresso(
    mut cmd: Command,
    duracao: f64,
    mut progresso: impl FnMut(f64),
) -> Result<(), String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut filho: Child = cmd.spawn().map_err(|e| format!("não foi possível iniciar o FFmpeg: {e}"))?;
    let stderr = filho.stderr.take().unwrap();
    let coletor = std::thread::spawn(move || {
        let mut linhas: Vec<String> = Vec::new();
        for l in BufReader::new(stderr).lines().map_while(Result::ok) {
            linhas.push(l);
            if linhas.len() > 40 {
                linhas.remove(0);
            }
        }
        linhas.join("\n")
    });
    let stdout = filho.stdout.take().unwrap();
    for linha in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(v) = linha.strip_prefix("out_time_us=") {
            if let Ok(us) = v.trim().parse::<f64>() {
                if duracao > 0.0 {
                    progresso((us / 1_000_000.0 / duracao).clamp(0.0, 1.0));
                }
            }
        }
    }
    let status = filho.wait().map_err(|e| e.to_string())?;
    let erro = coletor.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(erro)
    }
}

#[derive(Clone, Serialize)]
struct Progresso {
    chave: String,
    pct: f64,
    etapa: String,
}

// ---------------------------------------------------------------------------
// Proxy + tira de miniaturas (uma única decodificação da janela do Corte)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Miniaturas {
    url: String,
    colunas: u32,
    linhas: u32,
    largura_celula: u32,
    altura_celula: u32,
    intervalo: f64,
    inicio: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyPronto {
    chave: String,
    /// Caminho relativo a media/ do proxy.
    proxy: String,
    /// Tempo da Fonte em que o proxy começa (o proxy começa em 0).
    inicio: f64,
    fim: f64,
    miniaturas: Miniaturas,
    encoder: String,
    segundos: f64,
    em_cache: bool,
}

fn chave_janela(a: f64, b: f64) -> (String, f64, f64) {
    let a = a.max(0.0).floor();
    let b = b.ceil();
    (format!("{:05}-{:05}", a as u64, b as u64), a, b)
}

fn args_proxy(fonte: &Path, a: f64, d: f64, proxy: &Path, sprite: &Path, encoder: &str) -> Vec<String> {
    let celulas = (d / MINIATURA_INTERVALO).ceil() as u32;
    let linhas = celulas.div_ceil(MINIATURA_COLUNAS).max(1);
    let filtro = format!(
        "[0:v]split=2[p][m];[p]scale=-2:540:flags=bicubic,format=yuv420p[pv];\
         [m]fps=1/{MINIATURA_INTERVALO}:round=down,scale={MINIATURA_W}:{MINIATURA_H},tile={MINIATURA_COLUNAS}x{linhas}[spr]"
    );
    let mut v: Vec<String> = vec![
        "-hide_banner", "-nostdin", "-y", "-ss", &seg(a), "-t", &seg(d),
        "-i", &fonte.to_string_lossy(), "-filter_complex", &filtro,
        "-map", "[pv]", "-map", "0:a:0",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    // GOP curto (12 quadros = 0,5 s a 24 fps) e sem B-frames: busca barata no preview.
    let video: &[&str] = if encoder == "h264_nvenc" {
        &["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "25", "-b:v", "2500k", "-maxrate", "4M", "-bufsize", "4M", "-g", "12", "-bf", "0", "-no-scenecut", "1"]
    } else {
        &["-c:v", "libx264", "-preset", "veryfast", "-tune", "fastdecode", "-crf", "24", "-g", "12", "-keyint_min", "12", "-sc_threshold", "0", "-bf", "0"]
    };
    v.extend(video.iter().map(|s| s.to_string()));
    v.extend(
        ["-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats"]
            .iter()
            .map(|s| s.to_string()),
    );
    v.push(proxy.to_string_lossy().to_string());
    v.extend(["-map", "[spr]", "-frames:v", "1", "-q:v", "4", "-update", "1"].iter().map(|s| s.to_string()));
    v.push(sprite.to_string_lossy().to_string());
    v
}

#[tauri::command]
async fn gerar_proxy(app: AppHandle, estado: State<'_, Arc<Estado>>, inicio: f64, fim: f64) -> Result<ProxyPronto, String> {
    let midia = estado.midia.clone();
    let estado = estado.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (chave, a, b) = chave_janela(inicio, fim);
        let d = b - a;
        let cache = midia.join("cache");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let proxy = cache.join(format!("proxy_{chave}.mp4"));
        let sprite = cache.join(format!("miniaturas_{chave}.jpg"));
        let celulas = (d / MINIATURA_INTERVALO).ceil() as u32;
        let miniaturas = Miniaturas {
            url: format!("cache/miniaturas_{chave}.jpg"),
            colunas: MINIATURA_COLUNAS,
            linhas: celulas.div_ceil(MINIATURA_COLUNAS).max(1),
            largura_celula: MINIATURA_W,
            altura_celula: MINIATURA_H,
            intervalo: MINIATURA_INTERVALO,
            inicio: a,
        };
        let emitir = |pct: f64, etapa: &str| {
            let _ = app.emit("proxy-progresso", Progresso { chave: chave.clone(), pct, etapa: etapa.into() });
        };
        if proxy.exists() && sprite.exists() {
            emitir(1.0, "cache");
            return Ok(ProxyPronto { chave: chave.clone(), proxy: format!("cache/proxy_{chave}.mp4"), inicio: a, fim: b, miniaturas, encoder: "cache".into(), segundos: 0.0, em_cache: true });
        }
        if !estado.gerando.lock().unwrap().insert(chave.clone()) {
            return Err("proxy já em geração".into());
        }
        let parcial = cache.join(format!("proxy_{chave}.parcial.mp4"));
        let sprite_parcial = cache.join(format!("miniaturas_{chave}.parcial.jpg"));
        let relogio = Instant::now();
        let mut resultado = Err(String::new());
        let mut usado = String::new();
        for encoder in ["h264_nvenc", "libx264"] {
            let mut cmd = ffmpeg();
            cmd.args(args_proxy(&midia.join(FONTE), a, d, &parcial, &sprite_parcial, encoder));
            emitir(0.0, encoder);
            resultado = rodar_com_progresso(cmd, d, |p| emitir(p, encoder));
            usado = encoder.into();
            if resultado.is_ok() {
                break;
            }
        }
        estado.gerando.lock().unwrap().remove(&chave);
        resultado.map_err(|e| format!("falha ao gerar proxy: {e}"))?;
        fs::rename(&sprite_parcial, &sprite).map_err(|e| e.to_string())?;
        fs::rename(&parcial, &proxy).map_err(|e| e.to_string())?;
        emitir(1.0, &usado);
        Ok(ProxyPronto { chave: chave.clone(), proxy: format!("cache/proxy_{chave}.mp4"), inicio: a, fim: b, miniaturas, encoder: usado, segundos: relogio.elapsed().as_secs_f64(), em_cache: false })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Forma de onda: PCM mono 8 kHz pelo FFmpeg, picos calculados aqui.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Onda {
    inicio: f64,
    por_segundo: u32,
    /// Picos 0..1000 (inteiros para o JSON ficar pequeno).
    picos: Vec<u16>,
}

#[tauri::command]
async fn gerar_onda(estado: State<'_, Arc<Estado>>, inicio: f64, fim: f64) -> Result<Onda, String> {
    let midia = estado.midia.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (chave, a, b) = chave_janela(inicio, fim);
        let cache = midia.join("cache");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let arquivo = cache.join(format!("onda_{chave}.json"));
        if let Ok(txt) = fs::read_to_string(&arquivo) {
            if let Ok(o) = serde_json::from_str::<Onda>(&txt) {
                return Ok(o);
            }
        }
        const TAXA: u32 = 8000;
        let saida = ffmpeg()
            .args(["-hide_banner", "-nostdin", "-v", "error", "-ss", &seg(a), "-t", &seg(b - a)])
            .arg("-i")
            .arg(midia.join(FONTE))
            .args(["-vn", "-ac", "1", "-ar", &TAXA.to_string(), "-f", "s16le", "pipe:1"])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("não foi possível iniciar o FFmpeg: {e}"))?;
        if !saida.status.success() {
            return Err(String::from_utf8_lossy(&saida.stderr).to_string());
        }
        let amostras: Vec<i16> = saida.stdout.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        let janela = (TAXA / ONDA_POR_SEGUNDO) as usize;
        let brutos: Vec<f32> = amostras
            .chunks(janela)
            .map(|c| c.iter().map(|s| (*s as f32).abs()).fold(0.0, f32::max) / 32768.0)
            .collect();
        // Normaliza pelo percentil 99,5 da janela e comprime (raiz) para leitura visual.
        let mut ordenados = brutos.clone();
        ordenados.sort_by(|x, y| x.partial_cmp(y).unwrap());
        let teto = ordenados.get(ordenados.len().saturating_sub(1) * 995 / 1000).copied().unwrap_or(1.0).max(1e-3);
        let picos = brutos.iter().map(|p| ((p / teto).min(1.0).sqrt() * 1000.0) as u16).collect();
        let onda = Onda { inicio: a, por_segundo: ONDA_POR_SEGUNDO, picos };
        let _ = fs::write(&arquivo, serde_json::to_string(&onda).unwrap_or_default());
        Ok(onda)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Exportação 1080×1920 com crop, ASS karaokê (libass) e cortes de silêncio
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PedidoExport {
    id: String,
    titulo: String,
    inicio: f64,
    fim: f64,
    /// Trechos mantidos em tempo da Fonte (um só quando não há remoção de silêncio).
    trechos: Vec<(f64, f64)>,
    /// Centro horizontal do crop 9:16, normalizado 0..1 na largura da Fonte.
    crop_cx: f64,
    /// Conteúdo do arquivo .ass, já em tempo de saída.
    ass: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPronto {
    caminho: String,
    encoder: String,
    segundos: f64,
    duracao: f64,
}

fn nome_arquivo(titulo: &str) -> String {
    let base: String = titulo
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' => 'a',
            'é' | 'ê' => 'e',
            'í' => 'i',
            'ó' | 'ô' | 'õ' => 'o',
            'ú' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();
    let base = base.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if base.is_empty() { "corte".into() } else { base }
}

fn filtro_export(p: &PedidoExport, arquivo_ass: &str) -> (String, f64) {
    let crop_w = (FONTE_ALTURA * 9.0 / 16.0).round(); // 608 (par)
    let crop_w = crop_w - (crop_w as i64 % 2) as f64;
    let x = (p.crop_cx * FONTE_LARGURA - crop_w / 2.0).clamp(0.0, FONTE_LARGURA - crop_w).round();
    let visual = format!(
        "crop={crop_w}:{FONTE_ALTURA}:{x}:0,scale=1080:1920:flags=lanczos,setsar=1,ass={arquivo_ass},format=yuv420p"
    );
    // Tempos relativos ao -ss de entrada (a entrada começa em p.inicio).
    let rel: Vec<(f64, f64)> = p
        .trechos
        .iter()
        .map(|(a, b)| ((a - p.inicio).max(0.0), (b - p.inicio).min(p.fim - p.inicio)))
        .filter(|(a, b)| b > a)
        .collect();
    let duracao: f64 = rel.iter().map(|(a, b)| b - a).sum();
    let inteiro = rel.len() == 1 && rel[0].0 < 0.01 && rel[0].1 > p.fim - p.inicio - 0.01;
    if rel.is_empty() || inteiro {
        return (format!("[0:v]{visual}[v];[0:a]anull[a]"), p.fim - p.inicio);
    }
    let expr = rel.iter().map(|(a, b)| format!("between(t,{a:.3},{b:.3})")).collect::<Vec<_>>().join("+");
    (
        format!(
            "[0:v]select='{expr}',setpts=N/FRAME_RATE/TB,{visual}[v];[0:a]aselect='{expr}',asetpts=N/SR/TB[a]"
        ),
        duracao,
    )
}

#[tauri::command]
async fn exportar(app: AppHandle, estado: State<'_, Arc<Estado>>, pedido: PedidoExport) -> Result<ExportPronto, String> {
    let midia = estado.midia.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cache = midia.join("cache");
        let exports = midia.join("exports");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
        // O filtro ass recebe nome relativo: o FFmpeg roda com cwd = cache/ (evita escapar "C:\").
        let nome_ass = format!("export_{}.ass", nome_arquivo(&pedido.id));
        fs::write(cache.join(&nome_ass), pedido.ass.as_bytes()).map_err(|e| e.to_string())?;
        let carimbo = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let destino = exports.join(format!("{}-{carimbo}.mp4", nome_arquivo(&pedido.titulo)));
        let parcial = exports.join(format!("{}-{carimbo}.parcial.mp4", nome_arquivo(&pedido.titulo)));
        let (filtro, duracao) = filtro_export(&pedido, &nome_ass);
        let relogio = Instant::now();
        let mut erro = String::new();
        for encoder in ["h264_nvenc", "libx264"] {
            let mut cmd = ffmpeg();
            cmd.current_dir(&cache)
                .args(["-hide_banner", "-nostdin", "-y", "-ss", &seg(pedido.inicio), "-t", &seg(pedido.fim - pedido.inicio)])
                .arg("-i")
                .arg(midia.join(FONTE))
                .args(["-filter_complex", &filtro, "-map", "[v]", "-map", "[a]"]);
            if encoder == "h264_nvenc" {
                cmd.args(["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "21", "-b:v", "10M", "-maxrate", "16M", "-bufsize", "20M", "-profile:v", "high"]);
            } else {
                cmd.args(["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high"]);
            }
            cmd.args(["-r", "24", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats"])
                .arg(&parcial);
            let emitir = |pct: f64| {
                let _ = app.emit("exportar-progresso", Progresso { chave: pedido.id.clone(), pct, etapa: encoder.into() });
            };
            emitir(0.0);
            match rodar_com_progresso(cmd, duracao, emitir) {
                Ok(()) => {
                    fs::rename(&parcial, &destino).map_err(|e| e.to_string())?;
                    let _ = app.emit("exportar-progresso", Progresso { chave: pedido.id.clone(), pct: 1.0, etapa: encoder.into() });
                    return Ok(ExportPronto {
                        caminho: destino.to_string_lossy().to_string(),
                        encoder: encoder.into(),
                        segundos: relogio.elapsed().as_secs_f64(),
                        duracao,
                    });
                }
                Err(e) => {
                    let _ = fs::remove_file(&parcial);
                    erro = e;
                }
            }
        }
        Err(format!("falha na exportação: {erro}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn abrir_pasta(caminho: String) -> Result<(), String> {
    let mut cmd = Command::new("explorer.exe");
    #[cfg(windows)]
    cmd.raw_arg(format!("/select,\"{}\"", caminho.replace('"', "")));
    #[cfg(not(windows))]
    cmd.arg(Path::new(&caminho).parent().unwrap_or(Path::new(".")));
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Grava um JSON de medição em media/medicoes/<nome>.json.
#[tauri::command]
fn salvar_medicao(estado: State<'_, Arc<Estado>>, nome: String, conteudo: String) -> Result<String, String> {
    let pasta = estado.midia.join("medicoes");
    fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    let nome: String = nome.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    let destino = pasta.join(format!("{nome}.json"));
    fs::write(&destino, conteudo).map_err(|e| e.to_string())?;
    Ok(destino.to_string_lossy().to_string())
}

/// Repassa logs e erros do WebView para o terminal do `tauri dev`.
#[tauri::command]
fn registrar(nivel: String, mensagem: String) {
    eprintln!("[ui:{nivel}] {mensagem}");
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    midia: String,
    fonte_pronta: bool,
    transcricao_pronta: bool,
}

#[tauri::command]
fn info(estado: State<'_, Arc<Estado>>) -> Info {
    Info {
        midia: estado.midia.to_string_lossy().to_string(),
        fonte_pronta: estado.midia.join(FONTE).exists(),
        transcricao_pronta: estado.midia.join("transcript.json").exists(),
    }
}

fn main() {
    let estado = Arc::new(Estado { midia: pasta_midia(), gerando: Mutex::new(HashSet::new()) });
    let para_protocolo = estado.midia.clone();
    tauri::Builder::default()
        .manage(estado)
        .register_asynchronous_uri_scheme_protocol("midia", move |_ctx, req, responder| {
            let midia = para_protocolo.clone();
            std::thread::spawn(move || responder.respond(servir_midia(&midia, &req)));
        })
        .invoke_handler(tauri::generate_handler![gerar_proxy, gerar_onda, exportar, abrir_pasta, salvar_medicao, info, registrar])
        .setup(|app| {
            if let Some(janela) = app.get_webview_window("main") {
                let _ = janela.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("falha ao abrir o protótipo");
}
