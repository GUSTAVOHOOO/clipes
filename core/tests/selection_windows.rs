//! #144: o wrapper monta o plano a partir do perfil, sem rede (dados isolados, endpoint
//! documentário 192.0.2.x sem consentimento: nada é sondado).
use clipes_core::energy::{EnergyLevel, EnergyMarks};
use clipes_core::selection_windows::{
    plan_for_profile, plan_for_profile_marked, PlanState, ProfileRequest, MAX_CUT_US,
};
use clipes_core::sentences::Sentence;
use clipes_core::{dispatch, CoreError};
use serde_json::{json, Value};
use std::sync::Mutex;

static ENV: Mutex<()> = Mutex::new(());
fn run(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}

/// 2 h de fala densa: uma Frase de 5 s por vez.
fn sentences() -> Vec<Sentence> {
    (0..1_440)
        .map(|i| Sentence {
            id: i + 1,
            first_position: i * 10,
            last_position: i * 10 + 9,
            start_us: i * 5_000_000,
            end_us: (i + 1) * 5_000_000,
            language: Some("pt".into()),
            text: "uma frase falada com bastante conteudo para encher o contexto do modelo "
                .repeat(1)
                + &"palavra ".repeat(4),
        })
        .collect()
}

fn request<'a>(profile: &'a str, schema: &'a Value) -> ProfileRequest<'a> {
    ProfileRequest {
        profile_id: Some(profile),
        task: None,
        instruction: "Escolha candidatos a Corte.",
        schema,
        native_schema: true,
        output_reserve: 1_000,
        reasoning_reserve: 0,
        max_cut_us: 3 * 60_000_000,
    }
}

#[test]
fn profile_context_origin_and_price_threshold_drive_the_plan() {
    let _guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", dir.path());
    let schema = json!({"type": "object"});
    let frases = sentences();

    let configure = |id: &str, kind: &str, model: &str, context: Option<u64>| {
        run("provider.configure", json!({"profileId": id, "label": id, "endpoint": "https://192.0.2.10/v1", "kind": kind, "model": model, "context": context})).unwrap();
    };
    configure("small", "openai", "unknown", Some(4096));
    configure("eight", "openai", "unknown", Some(8192));
    configure("haiku", "anthropic", "claude-haiku-5-5", None);

    let blocked = plan_for_profile(&request("small", &schema), &frases).unwrap_err();
    assert_eq!(blocked.code, "context_too_small");
    assert!(blocked.message.contains("4096"));
    assert!(blocked.message.contains("definido por você"));

    let reduced = plan_for_profile(&request("eight", &schema), &frases).unwrap();
    assert_eq!(reduced.state, PlanState::Reduced);

    // #54: as marcas de energia são texto enviado; o planejador conta cada uma.
    let marks: EnergyMarks = frases.iter().map(|s| (s.id, EnergyLevel::Peak)).collect();
    let marked = plan_for_profile_marked(&request("eight", &schema), &frases, &marks).unwrap();
    let total = |p: &clipes_core::selection_windows::Plan| {
        p.windows.iter().map(|w| w.tokens_high).sum::<u64>()
    };
    assert!(total(&marked) > total(&reduced));

    // Catálogo (1 M) com limiar de preço de 100 mil: entrada em até 85 mil tokens.
    let capped = plan_for_profile(&request("haiku", &schema), &frases).unwrap();
    assert_eq!(capped.input_limit_tokens, 85_000);
    assert_eq!(capped.state, PlanState::Full);
    assert!(capped.windows.iter().all(|w| w.tokens_high <= 85_000));

    let mut long_cut = request("haiku", &schema);
    long_cut.max_cut_us = MAX_CUT_US + 1_000_000;
    let error = plan_for_profile(&long_cut, &frases).unwrap_err();
    assert_eq!(error.code, "max_cut_too_long");
}

/// #173: uma só razão de planejamento. Sem calibração o planejador usa o ponto ×1,2; com
/// `CALIBRATION_MIN_SAMPLES` amostras, a ponta alta calibrada. `token_range().high` (orçamento e
/// guard de envio) não muda.
#[test]
fn planning_ratio_is_point_times_1_2_until_calibrated() {
    use clipes_core::provider::cost::{
        observe_tokens, planning_range, token_range, PLANNING_UNCALIBRATED_FACTOR,
    };
    use clipes_core::provider::{EstimateHint, StructuredRequest};
    let _guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", dir.path());
    let request = StructuredRequest {
        estimate_hint: EstimateHint {
            format: "compact".into(),
            language: "pt".into(),
        },
        instruction: "Escolha.".into(),
        transcript: "frase falada ".repeat(2_000),
        schema: json!({"type": "object"}),
        native_schema: true,
        max_output_tokens: None,
    };
    let uncalibrated = token_range("p", "m", &request).unwrap();
    let planning = planning_range("p", "m", &request).unwrap();
    let point = uncalibrated.high as f64 / 1.5;
    assert_eq!(planning.low, uncalibrated.low);
    assert!(planning.high < uncalibrated.high);
    assert!((planning.high as f64 - point * PLANNING_UNCALIBRATED_FACTOR).abs() <= 2.0);

    let chars = clipes_core::provider::cost::input_characters(&request);
    for _ in 0..3 {
        observe_tokens("p", "m", &request, chars / 2, "ok").unwrap();
    }
    let calibrated = token_range("p", "m", &request).unwrap();
    let planning = planning_range("p", "m", &request).unwrap();
    assert_eq!(planning, calibrated);
}

#[test]
fn overlapping_and_zero_duration_sentences_from_asr_still_plan() {
    let _guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", dir.path());
    let schema = json!({"type": "object"});
    run(
        "provider.configure",
        json!({"profileId": "p", "label": "p", "endpoint": "http://127.0.0.1:11434/v1", "kind": "openai", "model": "m", "context": 32768}),
    )
    .unwrap();
    let mut frases = sentences();
    // Padrão real medido do faster-whisper: uma Frase termina em 391844000 µs e a seguinte
    // começa 196 ms antes (391648000 µs) após palavra com duração zero / sobreposta.
    let i = 78;
    frases[i].start_us = 390_864_000;
    frases[i].end_us = 391_844_000;
    frases[i + 1].start_us = 391_648_000;
    frases[i + 1].end_us = 392_268_000;
    // Frase inteira com duração zero (4 ocorrências vistas nos bancos reais).
    frases[109].start_us = 547_764_000;
    frases[109].end_us = 547_764_000;
    let plan = plan_for_profile(&request("p", &schema), &frases).unwrap();
    assert!(!plan.windows.is_empty());
}
