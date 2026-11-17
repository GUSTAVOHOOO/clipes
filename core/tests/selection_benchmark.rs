//! Testes do benchmark de seleção (#57) com fixtures sintéticas e sem rede.
use clipes_core::{
    ai_task,
    chat::{ChatMark, Interval, Reaction},
    dispatch,
    energy::EnergyLevel,
    jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    selection::{
        benchmark::{
            aggregate_metrics, bench_window_input, build_candidates_for_benchmark, default_matrix,
            evaluate_chat_signal, evaluate_source, evaluate_two_pass_rerank,
            evaluate_window_crossing, format_b_line, format_timestamp_tenths, grid_search_chat,
            merge_overlapping_scenes, mid_sentence_boundary_count, plan_matrix_windows,
            wilson_ci95, BenchFormat, BenchPlanStatus, CandidateSpan, ChatCalibrationParams,
            CostCounts, GroundTruthClip, MatrixWindowSpec, ProviderCostTiming, SentenceSpan,
            ValidityCounts,
        },
        cut::{MAX_CUT_US, MIN_CUT_US},
    },
    selection_windows::WINDOW_MAX_US,
    sentences::{Marks, Sentence},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn recall_merges_overlapping_scenes_and_verifies_sentence_boundaries() {
    let sentences: Vec<SentenceSpan> = (1..=10)
        .map(|id| SentenceSpan {
            id,
            start_us: (id - 1) * 10_000_000,
            end_us: id * 10_000_000,
        })
        .collect();
    // Dois Cortes humanos que se sobrepõem (10-35s e 25-50s -> 1 cena única 10-50s) + 1 isolado.
    let gt = vec![
        GroundTruthClip {
            start_us: 10_000_000,
            end_us: 35_000_000,
        },
        GroundTruthClip {
            start_us: 25_000_000,
            end_us: 50_000_000,
        },
        GroundTruthClip {
            start_us: 70_000_000,
            end_us: 90_000_000,
        },
    ];
    let scenes = merge_overlapping_scenes(&gt);
    assert_eq!(scenes.len(), 2);
    assert_eq!(scenes[0].start_us, 10_000_000);
    assert_eq!(scenes[0].end_us, 50_000_000);

    // Candidato alinhado às Frases 2..4 (10-40s): acerta ambos os segmentos sobrepostos (IoU >= 0.30
    // e min_overlap >= 50%), erra o terceiro segmento (70-90s).
    let candidates = vec![CandidateSpan {
        start_id: 2,
        end_id: 4,
        start_us: 10_000_000,
        end_us: 40_000_000,
    }];
    let m = evaluate_source(&gt, &candidates, &sentences);
    assert_eq!(m.total_clips, 3);
    assert_eq!(m.recalled_min_50, 2);
    assert_eq!(m.recalled_iou_30, 2);
    assert_eq!(m.total_scenes, 2);
    assert_eq!(m.recalled_scenes_min_50, 1);
    assert_eq!(m.mid_sentence_boundaries, 0);
    assert_eq!(m.mid_sentence_boundary_rate, 0.0);

    let agg = aggregate_metrics(&[m, m]);
    assert_eq!(agg.total_clips, 6);
    assert_eq!(agg.recalled_min_50, 4);
    assert_eq!(agg.mid_sentence_boundaries, 0);
}

#[test]
fn mid_sentence_boundary_count_catches_internal_or_mismatched_edges() {
    let sentences = vec![
        SentenceSpan {
            id: 1,
            start_us: 0,
            end_us: 10_000_000,
        },
        SentenceSpan {
            id: 2,
            start_us: 10_000_000,
            end_us: 20_000_000,
        },
    ];
    let bad = vec![
        CandidateSpan {
            start_id: 1,
            end_id: 2,
            start_us: 5_000_000, // meio da Frase 1
            end_us: 20_000_000,
        },
        CandidateSpan {
            start_id: 1,
            end_id: 2,
            start_us: 0,
            end_us: 20_000_000,
        },
    ];
    assert_eq!(mid_sentence_boundary_count(&bad, &sentences), 1);
}

#[test]
fn chat_calibration_measures_delay_gain_and_noise_peaks() {
    // 20 intervalos de 10 s (200 s). Linha de base = 2 pessoas.
    // Corte humano em 50..70 s; pico do chat reage 10 s depois (intervalo 6 = 60..70s, ou 7 = 70..80s).
    // Dois picos de ruído (raid/sorteio) nos intervalos 12 (120..130s) e 17 (170..180s).
    let mut series = vec![
        Interval {
            people: 2,
            messages: 3,
            ..Default::default()
        };
        20
    ];
    series[7].people = 12; // 70..80s -> com atraso 10s aponta 60..70s (dentro do Corte 50..70s)
    series[12].people = 10; // ruído
    series[17].people = 15; // ruído
    let clips = vec![GroundTruthClip {
        start_us: 50_000_000,
        end_us: 70_000_000,
    }];

    let default = ChatCalibrationParams::default(); // delay = 10s, ratio = 2.0
    let ev = evaluate_chat_signal(&series, &clips, &default, 0);
    assert_eq!(ev.total_clips, 1);
    assert_eq!(ev.clips_hit, 1);
    assert_eq!(ev.total_peaks, 3);
    assert_eq!(ev.signal_peaks, 1);
    assert_eq!(ev.noise_peaks, 2);
    assert!((ev.noise_rate - 2.0 / 3.0).abs() < 1e-6);

    // Sem atraso (0s), o pico em 70..80s não toca o Corte 50..70s.
    let no_delay = ChatCalibrationParams {
        reaction_delay_us: 0,
        ..default
    };
    let rows = grid_search_chat(&[(&series, &clips)], &[no_delay, default], 0);
    assert_eq!(rows[0].aggregate.clips_hit, 0);
    assert_eq!(rows[1].aggregate.clips_hit, 1);
    assert_eq!(rows[1].per_source_recall_min, 1.0);
}

#[test]
fn provider_cost_and_timing_normalizes_per_hour() {
    let stats = ProviderCostTiming::from_counts(CostCounts {
        source_duration_us: 1_800_000_000, // 0.5 h
        wall_ms: 30_000,                   // 30 s
        windows_total: 2,
        windows_completed: 2,
        windows_failed: 0,
        calls: 2,
        repairs: 0,
        input_tokens: 10_000,
        output_tokens: 1_000,
        cost_micro_usd: 250_000, // $0.25
    });
    assert!((stats.hours - 0.5).abs() < 1e-9);
    assert!((stats.secs_per_hour - 60.0).abs() < 1e-6);
    assert!((stats.usd_per_hour - 0.50).abs() < 1e-6);

    let (lo, hi) = wilson_ci95(5, 34);
    assert!(lo > 0.06 && lo < 0.07);
    assert!(hi > 0.29 && hi < 0.31);
    assert_eq!(wilson_ci95(0, 0), (0.0, 0.0));
}

struct FakeBenchProvider {
    seen_chat_mark: Mutex<bool>,
}

impl Provider for FakeBenchProvider {
    fn structured(&self, request: &StructuredRequest) -> Result<Value, CoreError> {
        self.structured_with(request, &CancelToken::new())
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        if request.transcript.contains("[chat ") {
            *self.seen_chat_mark.lock().unwrap() = true;
        }
        // Escolhe sempre as Frases 4..6 (30..60 s), coincidindo com o Corte humano sintético.
        let axis = |why: &str| json!({"score": 8, "why": why});
        Ok(json!({
            "data": {
                "schemaVersion": 1,
                "candidates": [{
                    "startId": 4,
                    "endId": 6,
                    "title": "Momento sintetico",
                    "hook": axis("comeco claro"),
                    "selfContained": axis("completo"),
                    "energy": axis("pico de reacao"),
                    "value": axis("engracado"),
                    "closing": axis("fecha bem")
                }]
            },
            "usage": {"inputTokens": 400, "outputTokens": 120},
            "calls": 1
        }))
    }
}

#[test]
fn headless_benchmark_pipeline_runs_with_fake_provider_and_synthetic_fixture() {
    let dir = tempfile::tempdir().unwrap();
    let prev = std::env::var_os("CLIPES_DATA_DIR");
    std::env::set_var("CLIPES_DATA_DIR", dir.path().join("data"));

    let fake = Arc::new(FakeBenchProvider {
        seen_chat_mark: Mutex::new(false),
    });
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "gpt-6-luna".into(),
            local: false,
        },
        "bench-fake".into(),
    )));

    {
        call(
            "provider.configure",
            json!({
                "profileId": "bench-fake",
                "kind": "openai",
                "endpoint": "http://127.0.0.1:9/v1",
                "model": "gpt-6-luna",
                "context": 131072
            }),
        );
        call(
            "assistant.task.set",
            json!({"task": "selection", "choice": "profile:bench-fake"}),
        );
        let project = call(
            "projects.create",
            json!({"parent": dir.path(), "name": "Bench"}),
        );
        let path = project["path"].as_str().unwrap().to_owned();

        // 12 Frases de 10 s cada = 120 s (2 min).
        let source = with_writer(|c| {
            c.execute(
                "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/synthetic/live.webm',1,120000000,'h','{}','{}',0)",
                [],
            )?;
            let source = c.last_insert_rowid();
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',120000000,120000000)",
                [source],
            )?;
            let transcript = c.last_insert_rowid();
            for pos in 0..120 {
                let text = if pos % 10 == 9 { " fala." } else { " fala" };
                c.execute(
                    "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                    (transcript, pos, text, pos * 1_000_000, (pos + 1) * 1_000_000),
                )?;
            }
            // Série de chat sintética: pico em 40..50s (intervalo 4) -> atraso 10s marca 30..40s (Frase 4).
            c.execute(
                "INSERT INTO chat_replays(source_id,state,method,interval_us,intervals,messages) VALUES (?1,'available',1,10000000,12,100)",
                [source],
            )?;
            for idx in 0..12 {
                let people = if idx == 4 { 20 } else { 3 };
                c.execute(
                    "INSERT INTO chat_series(source_id,idx,people,messages,paid,laugh,surprise,clip) VALUES (?1,?2,?3,?3,0,0,0,0)",
                    (source, idx, people),
                )?;
            }
            Ok(source)
        })
        .unwrap();

        call("transcription.segment", json!({"source_id": source}));
        let started = Instant::now();
        let run = call(
            "selection.start",
            json!({"source_id": source, "confirmed": true}),
        )["run"]
            .as_i64()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        let details = loop {
            let g = call("selection.get", json!({"run": run}));
            if g["run"]["state"] != "running" {
                break g;
            }
            assert!(Instant::now() < deadline, "timeout na selecao sintetica");
            std::thread::sleep(Duration::from_millis(20));
        };
        let wall_ms = started.elapsed().as_millis() as u64;
        assert_eq!(details["run"]["state"], "completed");
        assert!(*fake.seen_chat_mark.lock().unwrap());

        let sentences: Vec<SentenceSpan> = call(
            "transcription.sentences",
            json!({"source_id": source, "limit": 1000}),
        )
        .as_array()
        .unwrap()
        .iter()
        .map(|s| SentenceSpan {
            id: s["id"].as_i64().unwrap(),
            start_us: s["start_us"].as_i64().unwrap(),
            end_us: s["end_us"].as_i64().unwrap(),
        })
        .collect();
        let candidates: Vec<CandidateSpan> = details["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| CandidateSpan {
                start_id: c["startId"].as_i64().unwrap(),
                end_id: c["endId"].as_i64().unwrap(),
                start_us: c["startUs"].as_i64().unwrap(),
                end_us: c["endUs"].as_i64().unwrap(),
            })
            .collect();
        let gt = vec![GroundTruthClip {
            start_us: 30_000_000,
            end_us: 60_000_000,
        }];
        let metrics = evaluate_source(&gt, &candidates, &sentences);
        assert_eq!(metrics.recall_iou_50, 1.0);
        assert_eq!(metrics.mid_sentence_boundaries, 0);

        let costs = call("provider.cost.list", json!({}))
            .as_array()
            .unwrap()
            .clone();
        let total_micro: u64 = costs.iter().filter_map(|r| r["microUsd"].as_u64()).sum();
        let timing = ProviderCostTiming::from_counts(CostCounts {
            source_duration_us: 120_000_000,
            wall_ms,
            windows_total: 1,
            windows_completed: 1,
            windows_failed: 0,
            calls: 1,
            repairs: 0,
            input_tokens: 400,
            output_tokens: 120,
            cost_micro_usd: total_micro,
        });
        assert!(timing.cost_micro_usd > 0);
        call("projects.close", json!({}));
        let _ = path;
    }

    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    if let Some(p) = prev {
        std::env::set_var("CLIPES_DATA_DIR", p);
    } else {
        std::env::remove_var("CLIPES_DATA_DIR");
    }
}

fn synthetic_sentences(count: usize, step_secs: i64, lang: &str) -> Vec<Sentence> {
    (1..=count)
        .map(|i| {
            let idx = (i - 1) as i64;
            Sentence {
                id: i as i64,
                first_position: idx * 10,
                last_position: idx * 10 + 9,
                start_us: idx * step_secs * 1_000_000,
                end_us: (idx + 1) * step_secs * 1_000_000,
                language: Some(lang.to_owned()),
                text: "frase sintetica de fala continua para testar janelas do benchmark."
                    .to_owned(),
            }
        })
        .collect()
}

#[test]
fn format_b_line_and_timestamp_tenths_include_marks() {
    assert_eq!(format_timestamp_tenths(0), "00:00:00.0");
    assert_eq!(format_timestamp_tenths(3_723_450_000), "01:02:03.4");
    let s = Sentence {
        id: 123,
        first_position: 0,
        last_position: 4,
        start_us: 3_723_400_000,
        end_us: 3_728_000_000,
        language: Some("pt".into()),
        text: "momento engracado".into(),
    };
    let mut marks = Marks::default();
    marks.energy.insert(123, EnergyLevel::Peak);
    marks.chat.insert(
        123,
        ChatMark {
            interval: 1,
            ratio_tenths: 31,
            reaction: Some(Reaction::Laugh),
            at_us: 3_723_400_000,
        },
    );
    let line = format_b_line(&s, &marks);
    assert_eq!(
        line,
        "[S123 01:02:03.4] [energia pico] [chat 3,1× · risadas] momento engracado\n"
    );
}

#[test]
fn matrix_planner_covers_26_cells_keeps_product_cap_15m_and_marks_infeasible() {
    assert_eq!(WINDOW_MAX_US, 15 * 60_000_000);
    let matrix = default_matrix();
    assert_eq!(matrix.len(), 26);

    // 90 min de fala sintética (540 Frases de 10 s).
    let frases = synthetic_sentences(540, 10, "pt");
    let marks = Marks::default();

    // Perfil 500k (Codex): todas as 26 células são viáveis.
    for spec in &matrix {
        let plan = plan_matrix_windows(&frases, &marks, spec, 500_000, 1_200, 2_000, 0, 1.2);
        assert!(
            matches!(plan.status, BenchPlanStatus::Full),
            "esperava Full para {} em 500k, veio {:?}",
            spec.id,
            plan.status
        );
        assert!(!plan.windows.is_empty());
        if spec.window_max_us.is_none() {
            assert_eq!(plan.windows.len(), 1);
        }
    }

    // Perfil local 8k: live inteira (90 min) e 30/60 min em formato B são inviáveis e não são forçadas.
    let full_h = MatrixWindowSpec::new(None, 0, BenchFormat::CompactH);
    let plan_full_8k = plan_matrix_windows(&frases, &marks, &full_h, 8_192, 1_200, 2_000, 0, 1.2);
    assert!(matches!(
        plan_full_8k.status,
        BenchPlanStatus::Infeasible { .. }
    ));
    assert!(plan_full_8k.windows.is_empty());

    let w60_b = MatrixWindowSpec::new(Some(60), 3, BenchFormat::FullB);
    let plan_60b_8k = plan_matrix_windows(&frases, &marks, &w60_b, 8_192, 1_200, 2_000, 0, 1.2);
    assert!(matches!(
        plan_60b_8k.status,
        BenchPlanStatus::Infeasible { .. }
    ));

    // Perfil local 32k: 30 min H é viável, mas live inteira de 90 min em B é inviável.
    let w30_h = MatrixWindowSpec::new(Some(30), 3, BenchFormat::CompactH);
    let plan_30h_32k = plan_matrix_windows(&frases, &marks, &w30_h, 32_768, 1_200, 2_000, 0, 1.2);
    assert!(matches!(plan_30h_32k.status, BenchPlanStatus::Full));
}

#[test]
fn window_crossing_measures_clips_straddling_boundaries() {
    // Janelas de 10 min sem sobreposição: [0..600s] e [600..1200s].
    let windows_ov0 = vec![(0, 600_000_000), (600_000_000, 1_200_000_000)];
    // Janelas de 10 min com sobreposição de 3 min: [0..600s] e [420..1020s].
    let windows_ov3 = vec![(0, 600_000_000), (420_000_000, 1_020_000_000)];
    let gt = vec![
        GroundTruthClip {
            start_us: 100_000_000,
            end_us: 140_000_000,
        },
        GroundTruthClip {
            // Cruza a borda de 600 s!
            start_us: 585_000_000,
            end_us: 615_000_000,
        },
    ];
    let s0 = evaluate_window_crossing(&windows_ov0, &gt);
    assert_eq!(s0.total_clips, 2);
    assert_eq!(s0.contained_clips, 1);
    assert_eq!(s0.crossing_clips, 1);
    assert!((s0.crossing_rate - 0.5).abs() < 1e-9);

    let s3 = evaluate_window_crossing(&windows_ov3, &gt);
    assert_eq!(s3.contained_clips, 2);
    assert_eq!(s3.crossing_clips, 0);
    assert_eq!(s3.crossing_rate, 0.0);
}

struct FakeMatrixProvider {
    fail_with_bad_id: bool,
}

impl Provider for FakeMatrixProvider {
    fn structured(&self, request: &StructuredRequest) -> Result<Value, CoreError> {
        self.structured_with(request, &CancelToken::new())
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        let axis = |why: &str| json!({"score": 8, "why": why});
        let (start_id, end_id) = if self.fail_with_bad_id {
            (999_999, 999_999)
        } else {
            assert!(!request.transcript.is_empty());
            (2, 4)
        };
        Ok(json!({
            "data": {
                "schemaVersion": 1,
                "candidates": [{
                    "startId": start_id,
                    "endId": end_id,
                    "title": "Teste",
                    "hook": axis("gancho"),
                    "selfContained": axis("completo"),
                    "energy": axis("alta"),
                    "value": axis("bom"),
                    "closing": axis("fecha")
                }]
            },
            "usage": {"inputTokens": 250, "outputTokens": 80},
            "calls": 1
        }))
    }
}

#[test]
fn bench_window_input_runs_through_ai_task_verifiers_for_h_and_b() {
    let task = ai_task::find("selection").unwrap();
    assert_eq!(task.version, 3);
    assert_eq!(
        task.prompt_sha256,
        "e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a"
    );

    let frases = synthetic_sentences(6, 10, "en");
    let marks = Marks::default();
    let ok_provider = FakeMatrixProvider {
        fail_with_bad_id: false,
    };
    let bad_provider = FakeMatrixProvider {
        fail_with_bad_id: true,
    };

    for fmt in [BenchFormat::CompactH, BenchFormat::FullB] {
        let input = bench_window_input(&frases, fmt, MIN_CUT_US, MAX_CUT_US, &marks);
        let out = ai_task::run(task, &input, &ok_provider, &CancelToken::new()).unwrap();
        let (cands, tally) =
            build_candidates_for_benchmark(&frases, MIN_CUT_US, MAX_CUT_US, &[(0, out.data)]);
        assert_eq!(tally.kept, 1);
        assert_eq!(cands[0].start_id, 2);
        assert_eq!(cands[0].end_id, 4);

        let err = ai_task::run(task, &input, &bad_provider, &CancelToken::new()).unwrap_err();
        assert_eq!(err.code, "verification_failed");
        let mut val = ValidityCounts {
            windows_total: 2,
            windows_attempted: 2,
            windows_completed: 1,
            ..Default::default()
        };
        val.record_failure(&err.code);
        val.finalize();
        assert_eq!(val.verification_failed, 1);
        assert!((val.validity_rate - 0.5).abs() < 1e-9);
    }
}

#[test]
fn two_pass_rerank_measures_recall_at_k_improvement() {
    let gt = vec![
        GroundTruthClip {
            start_us: 100_000_000,
            end_us: 130_000_000,
        },
        GroundTruthClip {
            start_us: 200_000_000,
            end_us: 230_000_000,
        },
    ];
    let pass1 = vec![
        CandidateSpan {
            start_id: 1,
            end_id: 2,
            start_us: 10_000_000,
            end_us: 40_000_000,
        },
        CandidateSpan {
            start_id: 5,
            end_id: 6,
            start_us: 100_000_000,
            end_us: 130_000_000,
        },
        CandidateSpan {
            start_id: 9,
            end_id: 10,
            start_us: 200_000_000,
            end_us: 230_000_000,
        },
    ];
    // Na 1ª passada o topo-2 tem apenas 1/2 acertos; na 2ª passada sobe os dois acertos para o topo-2.
    let eval = evaluate_two_pass_rerank(&gt, &pass1, &[1, 2, 0], &[2, 3]);
    assert_eq!(eval.top_k[0].k, 2);
    assert!((eval.top_k[0].pass1_recall_min_50 - 0.5).abs() < 1e-9);
    assert!((eval.top_k[0].pass2_recall_min_50 - 1.0).abs() < 1e-9);
}
