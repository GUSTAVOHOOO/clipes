//! Testes headless e puros do subcomando `deterministic-eval` (#286), sem rede e sem IA.
use clipes_core::{
    chat, dispatch, projects,
    selection::{
        benchmark::GroundTruthClip,
        deterministic_benchmark::{
            evaluate_deterministic_all, run_cli, DeterministicEvalReport, DeterministicSourceInput,
            HeatmapPoint, SampleWindowRef, SentenceData,
        },
        routing_benchmark::{RoutingWindowRecord, ScoredCandidateSpan},
    },
};
use serde_json::json;
use std::fs;

fn make_synthetic_source(
    source_index: usize,
    with_chat: bool,
    with_heatmap: bool,
) -> DeterministicSourceInput {
    // 60 Frases de 5 s cada = 300 s (5 min), com uma pausa de 3 s antes da Frase 20 (100..105 s)
    // onde há pico de loudness, salto dB, frase gatilho, chat e heatmap.
    let mut sentences = Vec::with_capacity(60);
    let mut cursor = 0_i64;
    for i in 1..=60_i64 {
        if i == 20 {
            cursor += 3_000_000; // pausa de 3 s antes da explosão
        }
        let start_us = cursor;
        let end_us = cursor + 4_500_000;
        cursor = end_us + 200_000;

        let (text, loudness) = if i == 20 {
            ("Não acredito, clipa isso agora!".to_owned(), Some(-800))
        } else if i == 19 {
            ("O que vai acontecer agora?".to_owned(), Some(-2400))
        } else if i == 45 {
            ("Sub train chegando no chat.".to_owned(), Some(-2300))
        } else {
            (
                format!("Frase de preenchimento número {i} sobre o assunto."),
                Some(-2200),
            )
        };
        sentences.push(SentenceData {
            id: i,
            start_us,
            end_us,
            text,
            loudness_centi: loudness,
        });
    }
    let duration_us = cursor;

    let chat = if with_chat {
        let n_buckets = (duration_us / chat::INTERVAL_US) as usize + 2;
        let mut series = vec![
            chat::Interval {
                people: 5,
                messages: 6,
                paid: 0,
                laugh: 0,
                surprise: 0,
                clip: 0,
            };
            n_buckets
        ];
        // Pico real em t ≈ 100 s + 20 s atraso = 120 s (bucket 12)
        if let Some(b) = series.get_mut(12) {
            *b = chat::Interval {
                people: 30,
                messages: 45,
                paid: 0,
                laugh: 20,
                surprise: 10,
                clip: 5,
            };
        }
        // Falso positivo de trem de subs em t ≈ 220 s + 20 s = 240 s (bucket 24), sem áudio alto
        if let Some(b) = series.get_mut(24) {
            *b = chat::Interval {
                people: 25,
                messages: 30,
                paid: 8,
                laugh: 0,
                surprise: 0,
                clip: 0,
            };
        }
        Some((chat::INTERVAL_US, series))
    } else {
        None
    };

    let heatmap = if with_heatmap {
        vec![
            HeatmapPoint {
                start_time: 0.0,
                end_time: 80.0,
                value: 0.2,
            },
            HeatmapPoint {
                start_time: 80.0,
                end_time: 140.0,
                value: 0.95,
            },
            HeatmapPoint {
                start_time: 140.0,
                end_time: 310.0,
                value: 0.15,
            },
        ]
    } else {
        Vec::new()
    };

    // Corte humano curto (15 s) em volta da Frase 20 para testar sensibilidade min_us = 10 s vs 20 s
    let s19 = &sentences[18];
    let s21 = &sentences[20];
    let ground_truth = vec![GroundTruthClip {
        start_us: s19.start_us,
        end_us: s21.end_us,
    }];

    DeterministicSourceInput {
        source_index,
        language: "pt".to_owned(),
        duration_us,
        sentences,
        chat,
        heatmap,
        ground_truth,
    }
}

#[test]
fn pure_evaluation_covers_mode_a_ablations_and_mode_b_budgets() {
    let sources = vec![
        make_synthetic_source(0, false, true),
        make_synthetic_source(1, true, false),
    ];
    let sample_windows = vec![
        SampleWindowRef {
            source_index: 0,
            window_index: 0,
            start_us: 0,
            end_us: sources[0].duration_us,
            est_input_tokens: 1500,
            overlapping_clip_indices: vec![0],
        },
        SampleWindowRef {
            source_index: 1,
            window_index: 0,
            start_us: 0,
            end_us: sources[1].duration_us,
            est_input_tokens: 1500,
            overlapping_clip_indices: vec![0],
        },
    ];

    let c1_hit = &sources[0].sentences[18..=21];
    let c2_hit = &sources[1].sentences[18..=21];
    let codex_windows = vec![
        RoutingWindowRecord {
            source_index: 0,
            window_index: 0,
            window_start_us: 0,
            window_end_us: sources[0].duration_us,
            schema_valid: true,
            rules_valid: true,
            error_code: None,
            calls: 1,
            input_tokens: 2000,
            output_tokens: 200,
            cost_micro_usd: 0,
            duration_ms: 5000,
            raw_candidates_count: 1,
            violations: Vec::new(),
            candidates: vec![ScoredCandidateSpan {
                start_id: c1_hit.first().unwrap().id,
                end_id: c1_hit.last().unwrap().id,
                start_us: c1_hit.first().unwrap().start_us,
                end_us: c1_hit.last().unwrap().end_us,
                total_centi: 850,
            }],
        },
        RoutingWindowRecord {
            source_index: 1,
            window_index: 0,
            window_start_us: 0,
            window_end_us: sources[1].duration_us,
            schema_valid: true,
            rules_valid: true,
            error_code: None,
            calls: 1,
            input_tokens: 2000,
            output_tokens: 200,
            cost_micro_usd: 0,
            duration_ms: 5000,
            raw_candidates_count: 1,
            violations: Vec::new(),
            candidates: vec![ScoredCandidateSpan {
                start_id: c2_hit.first().unwrap().id,
                end_id: c2_hit.last().unwrap().id,
                start_us: c2_hit.first().unwrap().start_us,
                end_us: c2_hit.last().unwrap().end_us,
                total_centi: 850,
            }],
        },
    ];

    let report = evaluate_deterministic_all(&sources, &sample_windows, &codex_windows);
    assert_eq!(report.sources_summary.len(), 2);
    assert_eq!(report.heatmap_sources_available, 1);
    assert_eq!(report.codex_baseline_hits_sample24, 2);
    assert_eq!(report.codex_baseline_clips_sample24, 2);

    // Zero bordas no meio de Frase em todas as ablações e faixas (20s e 10s).
    for row in &report.mode_a_results {
        assert_eq!(
            row.full_lives.recall.mid_sentence_boundaries, 0,
            "borda no meio de Frase em {} min={} k={:?}",
            row.arm, row.min_cut_secs, row.k_per_hour
        );
        assert_eq!(row.sample_seed57.recall.mid_sentence_boundaries, 0);
        if row.full_lives.precision_noise.candidates_count > 0 {
            let sum = row.full_lives.precision_noise.precision_min_50
                + row.full_lives.precision_noise.noise_rate_min_50;
            assert!((sum - 1.0).abs() < 1e-9);
        }
    }

    // C1 e C2 acertam os 2 Cortes sintéticos no K=15/h (com min_cut=20s e 10s).
    let c2_20 = report
        .mode_a_results
        .iter()
        .find(|r| r.arm == "C2_live_full" && r.min_cut_secs == 20 && r.k_per_hour == Some(15))
        .expect("linha C2_live_full K=15");
    assert_eq!(c2_20.full_lives.recall.recalled_min_50, 2);

    let c1_10 = report
        .mode_a_results
        .iter()
        .find(|r| r.arm == "C1_universal" && r.min_cut_secs == 10 && r.k_per_hour == Some(15))
        .expect("linha C1_universal min=10s K=15");
    assert_eq!(c1_10.full_lives.recall.recalled_min_50, 2);

    // Modo B deve cobrir os 4 orçamentos (15, 25, 35, 50) para C1 e C2.
    assert_eq!(report.mode_b_windows.len(), 8);
    assert_eq!(report.mode_b_focused.len(), 8);
    let b_focused_c2_35 = report
        .mode_b_focused
        .iter()
        .find(|r| r.scorer == "C2_live_full" && r.budget_pct == 35)
        .unwrap();
    assert_eq!(b_focused_c2_35.full_gt_covered_gt50, 2);
    assert_eq!(b_focused_c2_35.codex_hits_surviving, 2);
}

#[test]
fn cli_deterministic_eval_runs_on_isolated_synthetic_project_without_text_leak() {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    fs::create_dir_all(&data_dir).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);

    let created = dispatch(
        "projects.create",
        json!({"parent": dir.path(), "name": "bench"}),
        &mut |_| {},
    )
    .unwrap();
    let project_path = created["path"].as_str().unwrap().to_owned();

    let src = make_synthetic_source(0, true, true);
    let sentinel_text = "PALAVRA_SECRETA_TRANSCRICAO_NAO_VAZAR";

    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO sources(id, path, size, duration_us, partial_hash, metadata, permission, audio_track) VALUES (1, 'fake.mp4', 1024, ?1, 'abc', '{}', '{\"status\":\"none\"}', 0)",
            [src.duration_us],
        )?;
        c.execute(
            "INSERT INTO transcripts(id, source_id, audio_track, engine, model, revision, compute_type, state, duration_us) VALUES (1, 1, 0, 'local', 'whisper-turbo', 'rev1', 'int8', 'complete', ?1)",
            [src.duration_us],
        )?;
        for s in &src.sentences {
            let text = if s.id == 1 {
                format!("{sentinel_text} {}", s.text)
            } else {
                s.text.clone()
            };
            c.execute(
                "INSERT INTO sentences(transcript_id, id, first_position, last_position, start_us, end_us, language, text) VALUES (1, ?1, ?1, ?1, ?2, ?3, 'pt', ?4)",
                (s.id, s.start_us, s.end_us, text),
            )?;
            if let Some(loud) = s.loudness_centi {
                c.execute(
                    "INSERT INTO sentence_energy(transcript_id, sentence_id, loudness_centi) VALUES (1, ?1, ?2)",
                    (s.id, loud),
                )?;
            }
        }
        c.execute(
            "INSERT INTO energy_measurements(transcript_id, method, sentences) VALUES (1, 1, ?1)",
            [src.sentences.len() as i64],
        )?;
        if let Some((interval_us, ref series)) = src.chat {
            c.execute(
                "INSERT INTO chat_replays(source_id, state, method, interval_us, intervals, messages) VALUES (1, 'available', 1, ?1, ?2, 100)",
                (interval_us, series.len() as i64),
            )?;
            for (i, x) in series.iter().enumerate() {
                c.execute(
                    "INSERT INTO chat_series(source_id, idx, people, messages, paid, laugh, surprise, clip) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    (i as i64, x.people, x.messages, x.paid, x.laugh, x.surprise, x.clip),
                )?;
            }
        }
        Ok(())
    })
    .unwrap();
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();

    let manifest_path = dir.path().join("manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_vec(&json!({
            "items": [{
                "duration_seconds": src.duration_us / 1_000_000,
                "idiomas_provisorios": ["pt"],
                "clips": [{
                    "start": src.ground_truth[0].start_us as f64 / 1_000_000.0,
                    "end": src.ground_truth[0].end_us as f64 / 1_000_000.0
                }]
            }]
        }))
        .unwrap(),
    )
    .unwrap();

    let sample_path = dir.path().join("sample.json");
    fs::write(
        &sample_path,
        serde_json::to_vec(&json!({
            "sampledWindows": [{
                "sourceIndex": 0,
                "windowIndex": 0,
                "startUs": 0,
                "endUs": src.duration_us,
                "estInputTokens": 1200,
                "overlappingClipIndices": [0]
            }]
        }))
        .unwrap(),
    )
    .unwrap();

    let codex_path = dir.path().join("codex.json");
    fs::write(
        &codex_path,
        serde_json::to_vec(&json!([{
            "sourceIndex": 0,
            "windowIndex": 0,
            "windowStartUs": 0,
            "windowEndUs": src.duration_us,
            "schemaValid": true,
            "rulesValid": true,
            "errorCode": null,
            "calls": 1,
            "inputTokens": 1800,
            "outputTokens": 150,
            "costMicroUsd": 0,
            "durationMs": 4000,
            "rawCandidatesCount": 1,
            "violations": [],
            "candidates": [{
                "startId": 19,
                "endId": 22,
                "startUs": src.sentences[18].start_us,
                "endUs": src.sentences[21].end_us,
                "totalCenti": 880
            }]
        }]))
        .unwrap(),
    )
    .unwrap();

    let heatmaps_path = dir.path().join("heatmaps.json");
    fs::write(
        &heatmaps_path,
        serde_json::to_vec(&json!([{
            "sourceIndex": 0,
            "hasHeatmap": true,
            "points": src.heatmap
        }]))
        .unwrap(),
    )
    .unwrap();

    let out_path = dir.path().join("out.json");
    let args: Vec<String> = vec![
        manifest_path.to_string_lossy().into_owned(),
        dir.path().to_string_lossy().into_owned(),
        "--project".into(),
        project_path,
        "--sample".into(),
        sample_path.to_string_lossy().into_owned(),
        "--codex-windows".into(),
        codex_path.to_string_lossy().into_owned(),
        "--heatmaps".into(),
        heatmaps_path.to_string_lossy().into_owned(),
        "--out".into(),
        out_path.to_string_lossy().into_owned(),
    ];
    run_cli(&args).unwrap();

    let out_str = fs::read_to_string(&out_path).unwrap();
    assert!(!out_str.contains(sentinel_text));
    let parsed: DeterministicEvalReport = serde_json::from_str(&out_str).unwrap();
    assert_eq!(parsed.sources_summary[0].sentences, 60);
    assert_eq!(parsed.heatmap_sources_available, 1);
    assert_eq!(parsed.codex_baseline_hits_sample24, 1);
}
