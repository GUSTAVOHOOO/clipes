//! Correção, desfazer/refazer e busca na Transcrição (#52), headless e sem rede. Os dados ficam
//! isolados em CLIPES_DATA_DIR; Fonte, Transcrição e palavras são gravadas direto no Projeto.

use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};
use std::sync::Mutex;

// A sessão de Projeto é global ao processo: um teste por vez.
static SERIAL: Mutex<()> = Mutex::new(());

struct Env {
    _guard: std::sync::MutexGuard<'static, ()>,
    root: tempfile::TempDir,
    project: String,
}

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

/// (texto, início em ms) de cada palavra; `.` ou `?` no fim fecha a Frase.
type Words = &'static [(&'static str, i64)];

impl Env {
    fn new() -> Env {
        let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let root = tempfile::tempdir().unwrap();
        std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
        let project = run(
            "projects.create",
            json!({"parent":root.path(),"name":"Canal"}),
        )
        .unwrap()["path"]
            .as_str()
            .unwrap()
            .to_owned();
        Env {
            _guard: guard,
            root,
            project,
        }
    }

    /// Cria Fonte e Transcrição completa com as palavras (uma a cada 300 ms, com espaço na
    /// frente como o Whisper grava) e segmenta. Devolve o ID da Fonte.
    fn transcript(&self, file: &str, words: Words) -> i64 {
        let source = with_writer(|c| {
            c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,1,60000000,'h','{}','{}',0)", [format!("C:/videos/{file}")])?;
            let source = c.last_insert_rowid();
            c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',60000000,60000000)", [source])?;
            let transcript = c.last_insert_rowid();
            for (i, (text, start)) in words.iter().enumerate() {
                c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, i as i64, format!(" {text}"), start * 1000, start * 1000 + 250_000))?;
            }
            Ok(source)
        })
        .unwrap();
        run("transcription.segment", json!({"source_id": source})).unwrap();
        source
    }

    fn sentences(&self, source: i64) -> Vec<Value> {
        run("transcription.sentences", json!({"source_id": source}))
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }

    fn correct(
        &self,
        source: i64,
        position: i64,
        text: &str,
    ) -> Result<Value, clipes_core::CoreError> {
        run(
            "transcription.correct",
            json!({"source_id": source, "position": position, "text": text}),
        )
    }

    fn search(&self, query: &str) -> Vec<Value> {
        run("transcription.search", json!({"query": query}))
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }

    fn reopen(&self) {
        run("projects.close", json!({})).unwrap();
        run("projects.open", json!({"path": self.project})).unwrap();
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = run("projects.close", json!({}));
        let _ = &self.root;
    }
}

const TALK: Words = &[
    ("Hoje", 0),
    ("teve", 300),
    ("ação", 600),
    ("demais", 900),
    ("Fim", 5000),
    ("de", 5300),
    ("jogo.", 5600),
];

fn texts(sentences: &[Value]) -> Vec<String> {
    sentences
        .iter()
        .map(|s| s["text"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn bundled_sqlite_has_fts5_with_diacritics_removal() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE VIRTUAL TABLE probe USING fts5(t, tokenize='unicode61 remove_diacritics 2'); INSERT INTO probe VALUES ('ação');",
    )
    .expect("o SQLite empacotado do rusqlite precisa ter FTS5 (feature `bundled`)");
    let hits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM probe WHERE probe MATCH 'acao'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hits, 1);
}

#[test]
fn correct_undo_redo_keep_times_positions_and_original() {
    let env = Env::new();
    let source = env.transcript("a.mp4", TALK);
    assert_eq!(
        texts(&env.sentences(source)),
        ["Hoje teve ação demais", "Fim de jogo."]
    );

    let r = env.correct(source, 1, "  tive  ").unwrap();
    assert_eq!(r["changed"], true);
    assert_eq!(r["sentence_id"], 1);
    // O Motor gravou com espaço na frente: a correção segue a convenção, sem colar palavras.
    assert_eq!(r["text"], " tive");
    assert_eq!(texts(&env.sentences(source))[0], "Hoje tive ação demais");

    let words = run("transcription.words", json!({"source_id": source})).unwrap();
    let w = &words[1];
    assert_eq!(
        (
            w["position"].as_i64(),
            w["start_us"].as_i64(),
            w["end_us"].as_i64()
        ),
        (Some(1), Some(300_000), Some(550_000))
    );
    assert_eq!(w["original_text"], " teve");
    assert_eq!(w["corrected"], true);

    // A → B → C desfaz para B, depois para o original.
    env.correct(source, 1, "tivemos").unwrap();
    assert_eq!(texts(&env.sentences(source))[0], "Hoje tivemos ação demais");
    let r = run("transcription.undo", json!({})).unwrap();
    assert_eq!(
        (
            r["source_id"].as_i64(),
            r["position"].as_i64(),
            r["sentence_id"].as_i64()
        ),
        (Some(source), Some(1), Some(1))
    );
    assert_eq!(texts(&env.sentences(source))[0], "Hoje tive ação demais");
    run("transcription.undo", json!({})).unwrap();
    assert_eq!(texts(&env.sentences(source))[0], "Hoje teve ação demais");
    assert_eq!(
        run("transcription.undo", json!({})).unwrap_err().code,
        "nothing_to_undo"
    );

    run("transcription.redo", json!({})).unwrap();
    run("transcription.redo", json!({})).unwrap();
    assert_eq!(texts(&env.sentences(source))[0], "Hoje tivemos ação demais");
    assert_eq!(
        run("transcription.redo", json!({})).unwrap_err().code,
        "nothing_to_redo"
    );

    // Uma correção nova limpa o refazer.
    run("transcription.undo", json!({})).unwrap();
    env.correct(source, 0, "Ontem").unwrap();
    assert_eq!(
        run("transcription.redo", json!({})).unwrap_err().code,
        "nothing_to_redo"
    );
    let state = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(
        (state["can_undo"].as_bool(), state["can_redo"].as_bool()),
        (Some(true), Some(false))
    );

    // Mesmo texto: sem entrada e sem limpar o refazer.
    run("transcription.undo", json!({})).unwrap();
    assert_eq!(env.correct(source, 1, "tive").unwrap()["changed"], false);
    assert_eq!(
        run("transcription.corrections", json!({})).unwrap()["can_redo"],
        true
    );
}

#[test]
fn undo_stack_survives_closing_and_reopening_the_project() {
    let env = Env::new();
    let source = env.transcript("a.mp4", TALK);
    env.correct(source, 2, "ação!").unwrap();
    env.reopen();
    assert_eq!(texts(&env.sentences(source))[0], "Hoje teve ação! demais");
    run("transcription.undo", json!({})).unwrap();
    env.reopen();
    assert_eq!(texts(&env.sentences(source))[0], "Hoje teve ação demais");
    run("transcription.redo", json!({})).unwrap();
    assert_eq!(texts(&env.sentences(source))[0], "Hoje teve ação! demais");
}

#[test]
fn punctuation_in_a_correction_never_changes_sentence_boundaries_or_ids() {
    let env = Env::new();
    let source = env.transcript("a.mp4", TALK);
    let before = env.sentences(source);
    let keys = |s: &[Value]| -> Vec<(Value, Value, Value, Value)> {
        s.iter()
            .map(|s| {
                (
                    s["id"].clone(),
                    s["first_position"].clone(),
                    s["last_position"].clone(),
                    s["start_us"].clone(),
                )
            })
            .collect()
    };
    env.correct(source, 3, "demais.").unwrap();
    env.correct(source, 6, "jogo").unwrap();
    // A segmentação sob demanda (a UI a chama ao abrir a Transcrição) não recalcula nada.
    let seg = run("transcription.segment", json!({"source_id": source})).unwrap();
    assert_eq!(seg["changed"], false);
    let after = env.sentences(source);
    assert_eq!(keys(&before), keys(&after));
    assert_eq!(texts(&after), ["Hoje teve ação demais.", "Fim de jogo"]);
    // O texto efetivo também vale para o texto compacto do #140.
    let rows: Vec<_> = after
        .iter()
        .map(|s| clipes_core::sentences::Sentence {
            id: s["id"].as_i64().unwrap(),
            first_position: 0,
            last_position: 0,
            start_us: s["start_us"].as_i64().unwrap(),
            end_us: 0,
            language: None,
            text: s["text"].as_str().unwrap().into(),
        })
        .collect();
    assert_eq!(
        clipes_core::sentences::compact(&rows),
        "## 00:00\n1 Hoje teve ação demais.\n2 Fim de jogo\n"
    );
}

#[test]
fn correction_input_is_validated_and_normalized() {
    let env = Env::new();
    let source = env.transcript("a.mp4", TALK);
    for bad in ["", "   ", "a\nb", "x\u{7}"] {
        assert_eq!(
            env.correct(source, 0, bad).unwrap_err().code,
            "invalid_correction"
        );
    }
    let long = "a".repeat(clipes_core::corrections::MAX_CORRECTION_CHARS + 1);
    assert_eq!(
        env.correct(source, 0, &long).unwrap_err().code,
        "invalid_correction"
    );
    assert_eq!(
        env.correct(source, 99, "x").unwrap_err().code,
        "word_missing"
    );
    // NFC: "a" + acento combinante vira "á", então a busca não depende de como foi digitado.
    env.correct(source, 0, "Ha\u{301}").unwrap();
    assert_eq!(texts(&env.sentences(source))[0], "Há teve ação demais");
    // Espaço interno é permitido e a palavra mantém os tempos.
    env.correct(source, 3, "de mais").unwrap();
    assert_eq!(texts(&env.sentences(source))[0], "Há teve ação de mais");
    // Voltar ao texto do Motor remove a correção.
    env.correct(source, 3, "demais").unwrap();
    let words = run("transcription.words", json!({"source_id": source})).unwrap();
    assert_eq!(words[3]["corrected"], false);
}

#[test]
fn search_finds_accented_terms_without_accents_across_sources() {
    let env = Env::new();
    let a = env.transcript("primeiro.mp4", TALK);
    let b = env.transcript(
        "segundo.mp4",
        &[("Outra", 0), ("ACAO", 400), ("aqui.", 800)],
    );
    let hits = env.search("acao");
    assert_eq!(
        hits.len(),
        2,
        "acha 'ação' e 'ACAO' em duas Fontes: {hits:?}"
    );
    let first = hits.iter().find(|h| h["source_id"] == a).unwrap();
    assert_eq!(
        first["source"], "primeiro.mp4",
        "só o nome do arquivo, sem pasta"
    );
    assert_eq!(first["sentence_id"], 1);
    assert_eq!(first["start_us"], 0);
    assert_eq!(first["row"], 0);
    let marked: Vec<_> = first["snippet"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["match"] == true)
        .collect();
    assert_eq!(marked.len(), 1);
    assert_eq!(marked[0]["text"], "ação");
    assert!(hits.iter().any(|h| h["source_id"] == b));
    // Com acento e prefixo.
    assert_eq!(env.search("AÇÃO").len(), 2);
    assert_eq!(env.search("dema").len(), 1);
    // Entrada com sintaxe de FTS5 não vira erro nem operador.
    for q in ["\"", "ação AND", "a-b:c*", "NOT", "(", "   ", "***"] {
        let _ = env.search(q);
    }
    assert!(env.search("zzzz").is_empty());
}

#[test]
fn search_follows_corrections_undo_and_resegmentation() {
    let env = Env::new();
    let source = env.transcript("a.mp4", TALK);
    assert_eq!(env.search("emocionante").len(), 0);
    env.correct(source, 3, "emocionante").unwrap();
    assert_eq!(env.search("emocionante").len(), 1);
    assert_eq!(
        env.search("demais").len(),
        0,
        "o texto antigo sai do índice"
    );
    run("transcription.undo", json!({})).unwrap();
    assert_eq!(env.search("emocionante").len(), 0);
    assert_eq!(env.search("demais").len(), 1);
    // Redo e reabertura mantêm o índice.
    run("transcription.redo", json!({})).unwrap();
    env.reopen();
    assert_eq!(env.search("emocionante")[0]["sentence_id"], 1);
    // Trocar a Transcrição (exclusão em cascata) limpa índice e pilha.
    with_writer(|c| c.execute("DELETE FROM transcripts", [])).unwrap();
    assert!(env.search("emocionante").is_empty());
    assert!(env.search("fim").is_empty());
    assert_eq!(
        run("transcription.corrections", json!({})).unwrap()["can_undo"],
        false
    );
}

#[test]
fn search_reports_the_timeline_row_after_silences() {
    let env = Env::new();
    let source = env.transcript("a.mp4", TALK);
    with_writer(|c| {
        // Silêncio entre as duas Frases, como o Motor grava.
        c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us) VALUES (1,100,'silence','',1500000,4900000)", [])
    })
    .unwrap();
    let hit = &env.search("jogo")[0];
    assert_eq!(hit["sentence_id"], 2);
    assert_eq!(hit["row"], 2, "Frase 1, silêncio, Frase 2");
    let page = run("transcription.timeline", json!({"source_id": source})).unwrap();
    assert_eq!(page["items"][2]["id"], 2);
    // Cada Frase traz as palavras (posição e texto efetivo) para a UI focar uma a uma.
    env.correct(source, 6, "jogo!").unwrap();
    let page = run("transcription.timeline", json!({"source_id": source})).unwrap();
    let words = page["items"][2]["words"].as_array().unwrap();
    assert_eq!(words.len(), 3);
    assert_eq!(
        (
            words[2]["position"].as_i64(),
            words[2]["text"].as_str(),
            words[2]["corrected"].as_bool()
        ),
        (Some(6), Some("jogo!"), Some(true))
    );
    // `start_us` na Fonte, para o preview (#58) posicionar o vídeo ao clicar na palavra.
    let starts: Vec<i64> = words
        .iter()
        .map(|w| w["start_us"].as_i64().unwrap())
        .collect();
    assert!(starts.windows(2).all(|w| w[0] <= w[1]), "{starts:?}");
    assert!(starts[0] >= page["items"][2]["start_us"].as_i64().unwrap());
}

#[test]
fn corrections_exposes_next_undo_and_next_redo_across_sources() {
    let env = Env::new();
    let empty = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(empty["can_undo"], false);
    assert_eq!(empty["can_redo"], false);
    assert_eq!(empty["next_undo"], json!(null));
    assert_eq!(empty["next_redo"], json!(null));

    let s1 = env.transcript("primeira.mp4", TALK);
    let s2 = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('D:\\lives\\segunda.mkv',1,60000000,'h','{}','{}',0)",
            [],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',60000000,60000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,0,'word',' jogo.',0,250000,'pt')",
            [transcript],
        )?;
        Ok(source)
    })
    .unwrap();
    run("transcription.segment", json!({"source_id": s2})).unwrap();

    env.correct(s1, 1, "tive").unwrap();
    let after_first = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(after_first["can_undo"], true);
    assert_eq!(after_first["can_redo"], false);
    assert_eq!(
        after_first["next_undo"],
        json!({"source_id": s1, "source_name": "primeira.mp4", "word": "tive"})
    );
    assert_eq!(after_first["next_redo"], json!(null));

    env.correct(s2, 0, "partida.").unwrap();
    let after_second = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(
        after_second["next_undo"],
        json!({"source_id": s2, "source_name": "segunda.mkv", "word": "partida."})
    );
    assert_eq!(after_second["next_redo"], json!(null));

    run("transcription.undo", json!({})).unwrap();
    let after_undo_one = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(after_undo_one["can_undo"], true);
    assert_eq!(after_undo_one["can_redo"], true);
    assert_eq!(
        after_undo_one["next_undo"],
        json!({"source_id": s1, "source_name": "primeira.mp4", "word": "tive"})
    );
    assert_eq!(
        after_undo_one["next_redo"],
        json!({"source_id": s2, "source_name": "segunda.mkv", "word": "partida."})
    );

    run("transcription.undo", json!({})).unwrap();
    let after_undo_all = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(after_undo_all["can_undo"], false);
    assert_eq!(after_undo_all["can_redo"], true);
    assert_eq!(after_undo_all["next_undo"], json!(null));
    assert_eq!(
        after_undo_all["next_redo"],
        json!({"source_id": s1, "source_name": "primeira.mp4", "word": "tive"})
    );

    run("transcription.redo", json!({})).unwrap();
    env.reopen();
    let after_reopen = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(
        after_reopen["next_undo"],
        json!({"source_id": s1, "source_name": "primeira.mp4", "word": "tive"})
    );
    assert_eq!(
        after_reopen["next_redo"],
        json!({"source_id": s2, "source_name": "segunda.mkv", "word": "partida."})
    );

    // Voltar para o texto original do Motor ainda entra na pilha e limpa next_redo.
    env.correct(s1, 1, "teve").unwrap();
    let reverted = run("transcription.corrections", json!({})).unwrap();
    assert_eq!(reverted["can_undo"], true);
    assert_eq!(reverted["can_redo"], false);
    assert_eq!(
        reverted["next_undo"],
        json!({"source_id": s1, "source_name": "primeira.mp4", "word": "teve"})
    );
    assert_eq!(reverted["next_redo"], json!(null));
}
