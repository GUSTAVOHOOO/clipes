//! Detecção, cache, troca manual e fallback do encoder (#62) com um FFmpeg falso: sem rede,
//! sem GPU e com dados isolados por CLIPES_DATA_DIR. Um único teste de fluxo, porque as
//! variáveis do FFmpeg falso são do processo.
use clipes_core::{
    dispatch,
    export::{
        captions::CaptionWord,
        encoder::{self, Fallback},
        render::RenderInput,
    },
    provider::CancelToken,
};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
fn lines(log: &Path) -> Vec<String> {
    fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}
fn passed(status: &Value) -> Vec<String> {
    status["passed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn detects_in_order_caches_invalidates_switches_and_falls_back_to_x264() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    fs::create_dir_all(&data).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &data);
    // Sem NVIDIA real: o nome da GPU/driver fica vazio e não interfere no cache.
    std::env::set_var("CLIPES_NVIDIA_SMI", root.path().join("sem-nvidia-smi"));
    let bin = root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let ffmpeg = bin.join(format!("ffmpeg{ext}"));
    fs::copy(env!("CARGO_BIN_EXE_fake-encoders"), &ffmpeg).unwrap();
    fs::copy(
        env!("CARGO_BIN_EXE_fake-encoders"),
        bin.join(format!("ffprobe{ext}")),
    )
    .unwrap();
    let log = root.path().join("calls.log");
    std::env::set_var("CLIPES_FAKE_LOG", &log);
    std::env::set_var("CLIPES_FAKE_ENCODERS", "h264_qsv,h264_nvenc,h264_amf");
    let cancel = CancelToken::new();

    // Sem Componente FFmpeg, nada é detectado e nada quebra.
    assert_eq!(call("export.encoder.status", json!({}))["ffmpeg"], false);
    call(
        "components.settings.set",
        json!({"data_dir":data,"cache_dir":data.join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":null}),
    );
    call("components.ffmpeg.system", json!({"path":ffmpeg}));

    // Primeira execução: nada em cache, e o status não testa nada.
    let status = call("export.encoder.status", json!({}));
    assert_eq!(status["detected"], false);
    assert_eq!(status["effective"], "libx264");
    assert!(lines(&log).is_empty());

    // Cada candidato presente passa por um export real; a ordem é NVENC, QSV, AMF, x264.
    assert_eq!(encoder::resolve(&ffmpeg, &cancel).unwrap(), "h264_nvenc");
    assert_eq!(
        lines(&log),
        ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"]
    );
    let status = call("export.encoder.status", json!({}));
    assert_eq!(status["detected"], true);
    assert_eq!(
        passed(&status),
        ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"]
    );
    assert!(data.join("export-encoder.json").is_file());
    assert!(status["detected_at"].as_u64().unwrap() > 0);

    // Cache: nada é testado de novo enquanto a versão do FFmpeg e o driver não mudam.
    assert_eq!(encoder::resolve(&ffmpeg, &cancel).unwrap(), "h264_nvenc");
    assert_eq!(lines(&log).len(), 4);

    // Troca manual só entre os que passaram; "automático" volta ao primeiro.
    assert_eq!(
        call("export.encoder.set", json!({"encoder":"h264_qsv"}))["effective"],
        "h264_qsv"
    );
    assert_eq!(encoder::resolve(&ffmpeg, &cancel).unwrap(), "h264_qsv");
    for bad in [json!("h264_videotoolbox"), json!("rm -rf"), json!(7)] {
        let error =
            dispatch("export.encoder.set", json!({"encoder":bad}), &mut |_| {}).unwrap_err();
        assert_eq!(error.code, "encoder_invalid");
    }
    assert_eq!(
        call("export.encoder.set", json!({"encoder":null}))["effective"],
        "h264_nvenc"
    );
    call("export.encoder.set", json!({"encoder":"h264_amf"}));

    // Outra versão do FFmpeg invalida o cache; a troca manual sobrevive se ainda passa.
    std::env::set_var("CLIPES_FAKE_VERSION", "9.9");
    assert_eq!(call("export.encoder.status", json!({}))["stale"], true);
    fs::remove_file(&log).unwrap();
    std::env::set_var("CLIPES_FAKE_FAIL", "h264_nvenc");
    std::env::set_var("CLIPES_FAKE_BAD_OUTPUT", "h264_qsv");
    assert_eq!(encoder::resolve(&ffmpeg, &cancel).unwrap(), "h264_amf");
    assert_eq!(lines(&log).len(), 4, "refez o teste de todos");
    let status = call("export.encoder.status", json!({}));
    // NVENC saiu com erro e QSV gerou outro codec: nenhum dos dois entra na lista.
    assert_eq!(passed(&status), ["h264_amf", "libx264"]);
    assert_eq!(status["selected"], "h264_amf");
    assert_eq!(status["manual"], "h264_amf");

    // "Detectar de novo" refaz tudo e esquece a troca manual de um encoder que parou de passar.
    std::env::set_var("CLIPES_FAKE_FAIL", "h264_nvenc,h264_amf");
    let status = call("export.encoder.detect", json!({}));
    assert_eq!(passed(&status), ["libx264"]);
    assert_eq!(status["manual"], Value::Null);
    assert_eq!(status["effective"], "libx264");

    // Fallback em tempo de export: o encoder escolhido falha, o export repete com x264.
    std::env::set_var("CLIPES_FAKE_FAIL", "");
    std::env::remove_var("CLIPES_FAKE_BAD_OUTPUT");
    call("export.encoder.detect", json!({}));
    std::env::set_var("CLIPES_FAKE_FAIL", "h264_nvenc");
    fs::remove_file(&log).unwrap();
    let source = root.path().join("original.mp4");
    fs::write(&source, b"source").unwrap();
    let output = root.path().join("corte.mp4");
    let input = RenderInput {
        source,
        output: output.clone(),
        start_us: 0,
        end_us: 1_000_000,
        audio_track: 1,
        words: vec![CaptionWord {
            text: "fala".into(),
            start_us: 0,
            end_us: 800_000,
        }],
        crop: Vec::new(),
    };
    let outcome =
        encoder::render_with_fallback(&ffmpeg, &input, "h264_nvenc", &cancel, &mut |_| {}).unwrap();
    assert_eq!(outcome.encoder, "libx264");
    assert_eq!(
        outcome.fallback,
        Some(Fallback {
            from: "h264_nvenc".into(),
            reason: "encoder_failed"
        })
    );
    assert_eq!(lines(&log), ["h264_nvenc", "libx264"]);
    assert_eq!(fs::read(&output).unwrap(), b"h264:libx264");
    // O motivo é um identificador fixo: nada do stderr nem de caminhos pessoais.
    assert!(!format!("{outcome:?}").contains("segredo"));
    // O encoder que falhou sai da lista; o próximo export usa o seguinte, sem repetir nem avisar.
    let status = call("export.encoder.status", json!({}));
    assert!(!passed(&status).contains(&"h264_nvenc".to_string()));
    assert_eq!(encoder::resolve(&ffmpeg, &cancel).unwrap(), "h264_qsv");
    // Falha do próprio x264 não é mascarada.
    fs::remove_file(&output).unwrap();
    std::env::set_var("CLIPES_FAKE_FAIL", "libx264");
    let error = encoder::render_with_fallback(&ffmpeg, &input, "libx264", &cancel, &mut |_| {})
        .unwrap_err();
    assert_eq!(error.code, "export_failed");
    assert!(!output.exists());
    // Cancelamento não aciona o fallback.
    std::env::set_var("CLIPES_FAKE_FAIL", "");
    let cancelled = CancelToken::new();
    cancelled.cancel();
    let error =
        encoder::render_with_fallback(&ffmpeg, &input, "h264_nvenc", &cancelled, &mut |_| {})
            .unwrap_err();
    assert_eq!(error.code, "cancelled");
}

#[test]
fn quality_profiles_are_named_per_encoder_and_unknown_names_fall_back() {
    for name in [
        "libx264",
        "h264_nvenc",
        "h264_qsv",
        "h264_amf",
        "h264_videotoolbox",
    ] {
        let plan = clipes_core::export::pipeline::with_encoder(name);
        assert_eq!(plan.encoder, name);
        assert!(!plan.encoder_args.is_empty());
    }
    let plan = clipes_core::export::pipeline::with_encoder("nao-existe");
    assert_eq!(plan.encoder, "libx264");
    // O x264 mantém exatamente o que o #59 usa.
    assert_eq!(
        plan.encoder_args,
        ["-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p"]
    );
    assert_eq!(
        encoder::listed(" V....D h264_amf  x\n A....D h264_nvenc  y\n V....D h264_nvenc z\n"),
        ["h264_nvenc", "h264_amf"]
    );
}
