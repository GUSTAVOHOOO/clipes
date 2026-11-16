//! Perfil de canal (#72), headless e sem rede: persistência no Projeto, integração com
//! `caption_style_default` (#65), seleção (#53/#67) e lotes (#56), com `CLIPES_DATA_DIR` isolado.

use clipes_core::{
    caption_style::{Preset, Style},
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
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

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

const SENTENCES: i64 = 120;

fn seed(n: i64) -> i64 {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,1,1200000000,?2,'{}','{}',0)",
            (format!("C:/videos/live{n}.mp4"), format!("h{n}")),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',1200000000,1200000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for position in 0..SENTENCES * 10 {
            let text = if position % 10 == 9 { " palavra." } else { " palavra" };
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000),
            )?;
        }
        Ok(source)
    })
    .unwrap()
}

#[derive(Default)]
struct Fake {
    headers: Mutex<Vec<String>>,
    first_window_only: bool,
}

impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        if let Some(first_line) = request.transcript.lines().next() {
            self.headers.lock().unwrap().push(first_line.to_owned());
        }
        let first = request
            .transcript
            .lines()
            .find(|l| !l.starts_with('#'))
            .and_then(|l| l.split(' ').next())
            .and_then(|id| id.parse::<i64>().ok())
            .unwrap_or(1);
        let wants_sixth = request.schema.to_string().contains("commentary");
        let candidates = if !self.first_window_only || first == 1 {
            // Proposta de 150 s (15 Frases de 10 s): testa o corte no teto escolhido.
            let mut c = json!({
                "startId": first,
                "endId": (first + 14).min(SENTENCES),
                "title": "Teste",
                "hook": {"score": 8, "why": "motivo"},
                "selfContained": {"score": 7, "why": "motivo"},
                "energy": {"score": 6, "why": "motivo"},
                "value": {"score": 7, "why": "motivo"},
                "closing": {"score": 8, "why": "motivo"},
            });
            if wants_sixth {
                c["commentary"] = json!({"score": 9, "why": "motivo"});
            }
            vec![c]
        } else {
            vec![]
        };
        Ok(json!({
            "data": {"schemaVersion": 1, "candidates": candidates},
            "usage": {"inputTokens": 10, "outputTokens": 5},
            "calls": 1
        }))
    }
}

fn wait_run(run: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let v = call("selection.get", json!({"run": run}));
        if v["run"]["state"] == "completed" {
            return v;
        }
        assert!(Instant::now() < deadline, "run {run} did not complete: {v}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn wait_batch(id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let v = call("batches.get", json!({"id": id}));
        if v["status"] == "completed" {
            return v;
        }
        assert!(
            Instant::now() < deadline,
            "batch {id} did not complete: {v}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn channel_profile_persists_validates_and_feeds_selection_batches_and_caption_defaults() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));

    // Sem Projeto aberto.
    assert_eq!(
        fail("channel_profile.get", json!({})).code,
        "project_not_open"
    );
    let langs = call("channel_profile.languages", json!({}));
    assert!(langs
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["code"] == "pt" && l["name"] == "portuguese"));

    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "MeuCanal"}),
    );

    // ---- Padrões iniciais ao criar o Projeto.
    let initial = call("channel_profile.get", json!({}));
    assert_eq!(initial["videoKind"], "direct");
    assert_eq!(initial["language"], "pt");
    assert_eq!(initial["minUs"], 20_000_000);
    assert_eq!(initial["maxUs"], 60_000_000);
    assert_eq!(initial["narrationVoice"], Value::Null);
    assert_eq!(initial["allowedSources"], json!([]));
    assert_eq!(initial["captionStyle"]["preset"], "vertical");
    assert_eq!(initial["limits"]["maxUs"], 180_000_000);
    assert_eq!(initial["limits"]["technicalMaxUs"], 300_000_000);

    // ---- Validações de campos e veto de campos fora de escopo (Provedor / credenciais sociais).
    assert_eq!(
        fail("channel_profile.set", json!({"language": "PT"})).code,
        "channel_profile_invalid"
    );
    assert_eq!(
        fail("channel_profile.set", json!({"language": "pt-BR"})).code,
        "channel_profile_invalid"
    );
    assert_eq!(
        fail("channel_profile.set", json!({"language": "auto"})).code,
        "channel_profile_invalid"
    );
    assert_eq!(
        fail("channel_profile.set", json!({"videoKind": "dark"})).code,
        "invalid_video_kind"
    );
    assert_eq!(
        fail(
            "channel_profile.set",
            json!({"minUs": 0, "maxUs": 60_000_000})
        )
        .code,
        "invalid_cut_range"
    );
    assert_eq!(
        fail(
            "channel_profile.set",
            json!({"minUs": 60_000_000, "maxUs": 60_000_000})
        )
        .code,
        "invalid_cut_range"
    );
    assert_eq!(
        fail(
            "channel_profile.set",
            json!({"minUs": 20_000_000, "maxUs": 181_000_000})
        )
        .code,
        "invalid_cut_range"
    );
    assert_eq!(
        fail("channel_profile.set", json!({"narrationVoice": "rafael"})).code,
        "channel_profile_invalid"
    );
    assert_eq!(
        fail("channel_profile.set", json!({"provider": "openai"})).code,
        "channel_profile_invalid"
    );
    assert_eq!(
        fail("channel_profile.set", json!({"socialCredentials": {}})).code,
        "channel_profile_invalid"
    );
    assert_eq!(
        fail(
            "channel_profile.set",
            json!({"allowedSources": [{"label": "Canal", "url": "ftp://bad.example"}]})
        )
        .code,
        "invalid_url"
    );
    assert_eq!(
        fail(
            "channel_profile.set",
            json!({"allowedSources": [{"label": "   "}]})
        )
        .code,
        "channel_profile_invalid"
    );
    let mut bad_style = Style::preset(Preset::Vertical);
    bad_style.font_size = 200;
    assert_eq!(
        fail("channel_profile.set", json!({"captionStyle": bad_style})).code,
        "caption_style_invalid"
    );

    // ---- Salvar perfil completo + estilo de legenda padrão + persistência após reabrir Projeto.
    let mut cinema = Style::preset(Preset::Cinema);
    cinema.color = "#FEF08A".into();
    let saved = call(
        "channel_profile.set",
        json!({
            "videoKind": "transformed",
            "language": "en",
            "minUs": 30_000_000,
            "maxUs": 120_000_000,
            "captionStyle": cinema,
            "allowedSources": [
                {"label": "  Criador A  ", "url": "https://example.com/@criadora", "note": "  Contrato 2026  "},
                {"label": "Criador B", "url": "   ", "note": ""}
            ],
            "narrationVoice": null
        }),
    );
    assert_eq!(saved["videoKind"], "transformed");
    assert_eq!(saved["language"], "en");
    assert_eq!(saved["minUs"], 30_000_000);
    assert_eq!(saved["maxUs"], 120_000_000);
    assert_eq!(saved["captionStyle"]["preset"], "cinema");
    assert_eq!(saved["captionStyle"]["color"], "#FEF08A");
    assert_eq!(
        saved["allowedSources"],
        json!([
            {"label": "Criador A", "url": "https://example.com/@criadora", "note": "Contrato 2026"},
            {"label": "Criador B"}
        ])
    );
    assert_eq!(saved["narrationVoice"], Value::Null);

    call("projects.close", json!({}));
    call("projects.open", json!({"path": project["path"]}));
    let reopened = call("channel_profile.get", json!({}));
    assert_eq!(reopened["videoKind"], "transformed");
    assert_eq!(reopened["language"], "en");
    assert_eq!(reopened["minUs"], 30_000_000);
    assert_eq!(reopened["maxUs"], 120_000_000);
    assert_eq!(reopened["captionStyle"]["preset"], "cinema");
    assert_eq!(reopened["captionStyle"]["color"], "#FEF08A");

    // ---- Integração #65: novo Corte herda o estilo do Perfil; `captions.style.default` atualiza o Perfil.
    with_writer(|c| {
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES ('candidate:1','{}')",
            [],
        )?;
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES ('candidate:2','{}')",
            [],
        )?;
        Ok(())
    })
    .unwrap();
    let clip1_style = call("captions.style.get", json!({"clip_id": 1}));
    assert_eq!(clip1_style["preset"], "cinema");
    assert_eq!(clip1_style["color"], "#FEF08A");

    let simple = call(
        "captions.style.preset",
        json!({"clip_id": 1, "preset": "simple", "revision": clip1_style["revision"]}),
    );
    assert_eq!(simple["preset"], "simple");
    call("captions.style.default", json!({"clip_id": 1}));
    assert_eq!(
        call("channel_profile.get", json!({}))["captionStyle"]["preset"],
        "simple"
    );
    assert_eq!(
        call("captions.style.get", json!({"clip_id": 2}))["preset"],
        "simple"
    );

    // ---- Integração com seleção (#53/#67) e lotes (#56).
    let s1 = seed(1);
    let s2 = seed(2);
    call("transcription.segment", json!({"source_id": s1}));
    call("transcription.segment", json!({"source_id": s2}));
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    let fake = Arc::new(Fake {
        first_window_only: true,
        ..Default::default()
    });
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));

    // Sem `videoKind`/`minUs`/`maxUs`: herda do Perfil (transformed, 30s..120s).
    let est = call("selection.estimate", json!({"source_id": s1}));
    assert_eq!(est["videoKind"], "transformed");
    assert_eq!(est["minUs"], 30_000_000);
    assert_eq!(est["maxUs"], 120_000_000);

    let run = call("selection.start", json!({"source_id": s1}))["run"]
        .as_i64()
        .unwrap();
    let done = wait_run(run);
    assert_eq!(done["run"]["videoKind"], "transformed");
    assert_eq!(done["run"]["minUs"], 30_000_000);
    assert_eq!(done["run"]["maxUs"], 120_000_000);
    let header = fake.headers.lock().unwrap().first().cloned().unwrap();
    assert!(
        header.contains("duracao_desejada_s=30-60 duracao_maxima_s=120"),
        "{header}"
    );
    let cand = &done["candidates"][0];
    let dur = cand["endUs"].as_i64().unwrap() - cand["startUs"].as_i64().unwrap();
    assert_eq!(
        dur, 120_000_000,
        "candidato de 150s aparado para o máximo do perfil (120s)"
    );

    // Sobrescrita explícita na seleção continua valendo.
    let explicit_run = call(
        "selection.start",
        json!({"source_id": s1, "videoKind": "direct", "minUs": 20_000_000, "maxUs": 60_000_000}),
    )["run"]
        .as_i64()
        .unwrap();
    let explicit_done = wait_run(explicit_run);
    assert_eq!(explicit_done["run"]["videoKind"], "direct");
    assert_eq!(explicit_done["run"]["minUs"], 20_000_000);
    assert_eq!(explicit_done["run"]["maxUs"], 60_000_000);

    // Lote sem `videoKind`/`minUs`/`maxUs`: herda do Perfil.
    let batch = call("batches.create", json!({"sourceIds": [s2]}));
    assert_eq!(batch["videoKind"], "transformed");
    assert_eq!(batch["minUs"], 30_000_000);
    assert_eq!(batch["maxUs"], 120_000_000);
    let finished_batch = wait_batch(batch["id"].as_i64().unwrap());
    let batch_run_id = finished_batch["items"][0]["selectionRun"].as_i64().unwrap();
    let batch_run = call("selection.get", json!({"run": batch_run_id}));
    assert_eq!(batch_run["run"]["videoKind"], "transformed");
    assert_eq!(batch_run["run"]["minUs"], 30_000_000);
    assert_eq!(batch_run["run"]["maxUs"], 120_000_000);

    call("projects.close", json!({}));
    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
}
