//! Testes do benchmark de seleção (#57) com fixtures sintéticas e sem rede.
use clipes_core::{
    chat::Interval,
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    selection::benchmark::{
        aggregate_metrics, evaluate_chat_signal, evaluate_source, grid_search_chat,
        merge_overlapping_scenes, mid_sentence_boundary_count, wilson_ci95, CandidateSpan,
        ChatCalibrationParams, CostCounts, GroundTruthClip, ProviderCostTiming, SentenceSpan,
    },
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
