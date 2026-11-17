//! Testes headless de trilha sonora e efeitos sonoros importados (#154):
//! - importação para `<projeto>/audio/`, limite de 500 MiB e deduplicação por SHA-256;
//! - licenças (enum + `cc_by` com atribuição obrigatória + `unknown` no checklist #76);
//! - `media::serve` para `audio/<id>` com `Range` e isolamento por Projeto;
//! - ancoragem de efeito em palavra da Transcrição e da Narração, silêncios, bordas e undo/redo;
//! - repetição e corte da trilha, intervalos de fala vindos das Frases e atribuição no Empacotamento (#68).

use clipes_core::{dispatch, media, projects::with_writer, CoreError};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

static SERIAL: Mutex<()> = Mutex::new(());

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

/// Gera um WAV PCM 16-bit mono válido sem depender de processos externos.
fn write_pcm_wav(path: &Path, sample_rate: u32, duration_ms: u32, freq_hz: f32) {
    let total_samples = (sample_rate as u64 * duration_ms as u64 / 1000) as usize;
    let data_bytes = (total_samples * 2) as u32;
    let byte_rate = sample_rate * 2;
    let mut f = File::create(path).unwrap();
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_bytes).to_le_bytes()).unwrap();
    f.write_all(b"WAVE").unwrap();
    f.write_all(b"fmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
    f.write_all(&1u16.to_le_bytes()).unwrap(); // mono
    f.write_all(&sample_rate.to_le_bytes()).unwrap();
    f.write_all(&byte_rate.to_le_bytes()).unwrap();
    f.write_all(&2u16.to_le_bytes()).unwrap();
    f.write_all(&16u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&data_bytes.to_le_bytes()).unwrap();
    let mut buf = Vec::with_capacity(total_samples * 2);
    for i in 0..total_samples {
        let t = i as f32 / sample_rate as f32;
        let sample = (2.0 * std::f32::consts::PI * freq_hz * t).sin() * 12000.0;
        buf.extend_from_slice(&(sample as i16).to_le_bytes());
    }
    f.write_all(&buf).unwrap();
}

#[test]
fn headless_audio_import_dedup_licenses_media_word_anchoring_loop_speech_and_packaging() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));

    // Sem Projeto aberto.
    assert_eq!(fail("audio.list", json!({})).code, "project_not_open");

    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "AudioProj"}),
    );
    let project_dir = PathBuf::from(project["path"].as_str().unwrap());

    // Arquivo acima de 500 MiB (arquivo esparso) é recusado antes de copiar.
    let huge_wav = root.path().join("huge.wav");
    {
        let f = File::create(&huge_wav).unwrap();
        f.set_len(500 * 1024 * 1024 + 1).unwrap();
    }
    assert_eq!(
        fail(
            "audio.import",
            json!({"path": huge_wav, "kind": "music", "license_kind": "own"})
        )
        .code,
        "invalid_license"
    );
    assert_eq!(
        fail(
            "audio.import",
            json!({"path": huge_wav, "kind": "music", "license_kind": "original"})
        )
        .code,
        "audio_too_large"
    );

    let music_short = root.path().join("trilha-curta.wav");
    let music_long = root.path().join("trilha-longa.wav");
    let sfx_wav = root.path().join("whoosh.wav");
    write_pcm_wav(&music_short, 24_000, 4_000, 220.0); // 4 s
    write_pcm_wav(&music_long, 24_000, 50_000, 330.0); // 50 s
    write_pcm_wav(&sfx_wav, 24_000, 600, 880.0); // 0.6 s

    // CC-BY exige atribuição.
    assert_eq!(
        fail(
            "audio.import",
            json!({"path": music_short, "kind": "music", "license_kind": "cc_by", "license_attribution": "   "})
        )
        .code,
        "attribution_required"
    );

    // Importa trilha curta com licença `unknown`.
    let m1 = call(
        "audio.import",
        json!({"path": music_short, "kind": "music", "license_kind": "unknown"}),
    );
    let m1_id = m1["id"].as_i64().unwrap();
    assert_eq!(m1["kind"], "music");
    assert_eq!(m1["licenseKind"], "unknown");
    assert_eq!(m1["licenseVerified"], false);
    assert_eq!(m1["durationUs"], 4_000_000);
    assert_eq!(m1["mediaId"], format!("audio/{m1_id}"));

    // Arquivo foi copiado para `<projeto>/audio/`.
    let audio_files: Vec<_> = fs::read_dir(project_dir.join("audio"))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert_eq!(audio_files.len(), 1);

    // Reimportar o mesmo arquivo como `music` reutiliza sem duplicar arquivo nem linha.
    let m1_dup = call(
        "audio.import",
        json!({"path": music_short, "kind": "music"}),
    );
    assert_eq!(m1_dup["id"], m1_id);
    assert_eq!(fs::read_dir(project_dir.join("audio")).unwrap().count(), 1);

    // Importa trilha longa (CC-BY) e efeito sonoro (`youtube_audio_library`).
    let m2 = call(
        "audio.import",
        json!({
            "path": music_long,
            "kind": "music",
            "license_kind": "cc_by",
            "license_attribution": "Lo-Fi Beat by Studio X (CC-BY 4.0)"
        }),
    );
    let m2_id = m2["id"].as_i64().unwrap();
    assert_eq!(m2["licenseVerified"], true);

    let sfx1 = call(
        "audio.import",
        json!({
            "path": sfx_wav,
            "kind": "sfx",
            "license_kind": "youtube_audio_library"
        }),
    );
    let sfx1_id = sfx1["id"].as_i64().unwrap();
    assert_eq!(sfx1["kind"], "sfx");
    assert_eq!(sfx1["licenseVerified"], true);

    // `media::serve` serve `audio/<id>` com Range e rejeita traversal.
    let served = media::serve(&format!("audio/{sfx1_id}"), Some("bytes=0-3"));
    assert_eq!(served.status, 206);
    assert_eq!(&served.body, b"RIFF");
    assert_eq!(media::serve("audio/../1", None).status, 404);
    assert_eq!(media::serve("audio/999999", None).status, 404);

    // Cria Fonte, Transcrição com 2 Frases separadas por silêncio, e candidato transformado aprovado.
    let nar_dir = project_dir.join("narrations").join("c1");
    fs::create_dir_all(&nar_dir).unwrap();
    let nar_wav = nar_dir.join("b1-v1.wav");
    write_pcm_wav(&nar_wav, 24_000, 3_000, 660.0);
    let nar_bytes = fs::read(&nar_wav).unwrap().len() as i64;

    let (source_id, candidate_id, block_id, clip_id) = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/v.mp4',1,40000000,'h','{\"streams\":[{\"codec_type\":\"video\",\"width\":1920,\"height\":1080,\"avg_frame_rate\":\"30/1\"}]}','{\"status\":\"none\"}',0)",
            [],
        )?;
        let sid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',40000000,40000000)",
            [sid],
        )?;
        let tid = c.last_insert_rowid();
        // Frase 1: 1.0s..4.0s (palavras pos 0 e 1); silêncio de 2.0s em 4.0..6.0s; Frase 2: 6.0s..10.0s (palavras pos 2 e 3); Frase 3: 15.0s..25.0s (palavra pos 4).
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,0,'word','Ola',1000000,2000000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,1,'word',' mundo.',2200000,4000000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,2,'word','Agora',6000000,7500000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,3,'word',' vai!',7700000,10000000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,4,'word',' Final.',15000000,25000000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,1,0,1,1000000,4000000,'Ola mundo.')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,2,2,3,6000000,10000000,'Agora vai!')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,3,4,4,15000000,25000000,'Final.')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','p','completed','',20000000,180000000,'[]','full',1,'transformed')",
            [tid],
        )?;
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust) VALUES (?1,1,1,3,1000000,25000000,'{}',900,'Teste','[0]',NULL)",
            [run_id],
        )?;
        let cand_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,1,3,'approved',1,3,1,3)",
            [run_id],
        )?;
        // Roteiro com 1 bloco ancorado na Frase 3 (15s da Fonte = 14s do Corte) + Narração alinhada (#81).
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (9501,?1,1,3,'pt-BR',1,'h','p','local','{}','{}')",
            [run_id],
        )?;
        let gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,1,'Fecho','i','[3]')",
            [gen_id],
        )?;
        let bid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated','Fecho','Fala final','[3]',0)",
            [bid],
        )?;
        let vid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
            (bid, vid),
        )?;
        c.execute(
            "INSERT INTO narration_blocks(block_id,version_id,voice_id,model_id,engine_id,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256) VALUES (?1,?2,'alba','m','pocket-tts','narrations/c1/b1-v1.wav',3000000,24000,1,?3,'narsha')",
            (bid, vid, nar_bytes),
        )?;
        let nid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO narration_alignments(narration_id,block_id,version_id,audio_sha256,language,model_id,status,choice) VALUES (?1,?2,?3,'narsha','pt','whisper-small','aligned',NULL)",
            (nid, bid, vid),
        )?;
        c.execute(
            "INSERT INTO narration_aligned_words(narration_id,track,position,sentence_idx,text,start_us,end_us) VALUES (?1,'script',0,1,'Fala',200000,1000000)",
            [nid],
        )?;
        c.execute(
            "INSERT INTO narration_aligned_words(narration_id,track,position,sentence_idx,text,start_us,end_us) VALUES (?1,'script',1,1,'final',1100000,2500000)",
            [nid],
        )?;
        Ok((sid, cand_id, bid, 0i64))
    })
    .unwrap();
    let _ = clip_id;

    let opened = call(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate_id}),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();

    // Intervalos de fala vêm das Frases (1: 0..3s, 2: 5..9s, resto da 3 após o bloco: 17..24s) e do alinhamento da Narração (bloco em 14s, fala alinhada 14.2..16.5s).
    let speech = opened["audioMix"]["speechIntervals"].as_array().unwrap();
    assert_eq!(speech.len(), 4, "speech={speech:?}");
    assert_eq!(speech[0], json!({"startUs": 0, "endUs": 3_000_000}));
    assert_eq!(speech[1], json!({"startUs": 5_000_000, "endUs": 9_000_000}));
    assert_eq!(
        speech[2],
        json!({"startUs": 14_200_000, "endUs": 16_500_000})
    );
    assert_eq!(
        speech[3],
        json!({"startUs": 17_000_000, "endUs": 24_000_000})
    );

    // Define trilha curta (4 s) com repetição (`loop_to_fit: true`) e depois sem repetição (`false`).
    let with_loop = call(
        "editor.audio.soundtrack.set",
        json!({
            "clip_id": clip_id,
            "asset_id": m1_id,
            "start_us": 0,
            "volume": 0.25,
            "fade_in_us": 500_000,
            "fade_out_us": 800_000,
            "loop_to_fit": true
        }),
    );
    assert_eq!(
        with_loop["audioMix"]["soundtrack"]["playDurationUs"],
        24_000_000
    );
    assert_eq!(with_loop["audioMix"]["soundtrack"]["loopToFit"], true);

    // Como m1 tem licença `unknown`, guardrails aponta 1 áudio sem licença verificada.
    let gr_unverified = call(
        "guardrails.check",
        json!({"source_id": source_id, "candidate_id": candidate_id, "clip_id": clip_id}),
    );
    assert_eq!(gr_unverified["audio"]["hasAudio"], true);
    assert_eq!(gr_unverified["audio"]["unverifiedCount"], 1);

    // Sem repetição, a trilha curta de 4 s toca só 4 s.
    let no_loop = call(
        "editor.audio.soundtrack.set",
        json!({"clip_id": clip_id, "loop_to_fit": false}),
    );
    assert_eq!(
        no_loop["audioMix"]["soundtrack"]["playDurationUs"],
        4_000_000
    );

    // Troca para trilha longa (50 s, CC-BY) -> é cortada para caber nos 24 s do Corte!
    let cut_long = call(
        "editor.audio.soundtrack.set",
        json!({"clip_id": clip_id, "asset_id": m2_id, "loop_to_fit": false}),
    );
    assert_eq!(
        cut_long["audioMix"]["soundtrack"]["playDurationUs"],
        24_000_000
    );
    assert_eq!(cut_long["audioMix"]["unverifiedCount"], 0);

    // Ancora efeito sonoro na palavra pos 2 ("Agora" em 6.0 s da Fonte -> 5.0 s da saída).
    let with_sfx_word = call(
        "editor.audio.sfx.add",
        json!({
            "clip_id": clip_id,
            "asset_id": sfx1_id,
            "anchor": {"kind": "word", "track": "original", "position": 2, "offset_us": 0},
            "volume": 0.9,
            "fade_in_us": 50_000,
            "fade_out_us": 100_000
        }),
    );
    assert_eq!(with_sfx_word["audioMix"]["sfx"][0]["wordText"], "Agora");
    assert_eq!(with_sfx_word["audioMix"]["sfx"][0]["startUs"], 5_000_000);

    // Ancora segundo efeito numa palavra da Narração (#81): bloco 1, palavra 1 ("final" em +1.1 s do bloco -> 14.0 + 1.1 = 15.1 s).
    let with_sfx_nar = call(
        "editor.audio.sfx.add",
        json!({
            "clip_id": clip_id,
            "asset_id": sfx1_id,
            "anchor": {"kind": "word", "track": "narration", "block_id": block_id, "position": 1, "offset_us": 0},
            "volume": 0.7
        }),
    );
    assert_eq!(with_sfx_nar["audioMix"]["sfx"][1]["wordText"], "final");
    assert_eq!(with_sfx_nar["audioMix"]["sfx"][1]["startUs"], 15_100_000);

    // Remover o silêncio entre Frase 1 e Frase 2 desloca a palavra "Agora" (e os intervalos de fala posteriores) automaticamente!
    call(
        "editor.silences.detect",
        json!({"clip_id": clip_id, "threshold_us": 600_000}),
    );
    let silenced = call("editor.silences.apply_all", json!({"clip_id": clip_id}));
    let sfx0_after_silence = silenced["audioMix"]["sfx"][0]["startUs"].as_i64().unwrap();
    assert!(
        sfx0_after_silence < 5_000_000 && sfx0_after_silence > 3_000_000,
        "efeito ancorado na palavra deveria acompanhar o corte de silêncio: {sfx0_after_silence}"
    );
    call("editor.undo", json!({"clip_id": clip_id})); // desfaz apply_all

    // Arrastar bloco da Narração para 18.0 s da Fonte (17.0 s da saída) move o efeito ancorado na Narração para 18.1 s!
    let moved_nar = call(
        "editor.montage.set_start",
        json!({"clip_id": clip_id, "block_id": block_id, "time_us": 18_000_000, "free": true}),
    );
    assert_eq!(moved_nar["audioMix"]["sfx"][1]["startUs"], 18_100_000);

    // Empacotamento (#68) inclui a atribuição CC-BY da trilha na descrição/crédito.
    with_writer(|c| {
        c.execute(
            "INSERT INTO packaging_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,generated)
             SELECT 9601, run_id, 1, 3, 'pt-BR', 2, 'h', 'p', '{\"title\":\"T\",\"description\":\"Desc base\",\"tags\":[\"t\"],\"hashtags\":[\"#c\"]}'
             FROM selection_candidates WHERE id=?1",
            [candidate_id],
        )?;
        Ok(())
    })
    .unwrap();
    let pkg = call("packaging.get", json!({"candidate": candidate_id}));
    let credit_text = pkg["credit"]["text"].as_str().unwrap();
    assert!(
        credit_text.contains("Música / áudio (CC-BY): Lo-Fi Beat by Studio X (CC-BY 4.0)"),
        "credit={credit_text}"
    );
    assert!(pkg["current"]["fullDescription"]
        .as_str()
        .unwrap()
        .contains("Lo-Fi Beat by Studio X (CC-BY 4.0)"));

    // Guardrails confirma 0 não verificados após trocar para m2 (CC-BY).
    let gr_ok = call(
        "guardrails.check",
        json!({"source_id": source_id, "candidate_id": candidate_id, "clip_id": clip_id}),
    );
    assert_eq!(gr_ok["audio"]["unverifiedCount"], 0);

    // Atualiza licença de m1 para `cc0` e testa remoção de m1.
    let m1_updated = call(
        "audio.license.set",
        json!({"id": m1_id, "license_kind": "cc0"}),
    );
    assert_eq!(m1_updated["licenseVerified"], true);
    call("audio.delete", json!({"id": m1_id}));
    let listed = call("audio.list", json!({})).as_array().unwrap().len();
    assert_eq!(listed, 2);

    call("projects.close", json!({}));
    assert_eq!(media::serve(&format!("audio/{sfx1_id}"), None).status, 404);
}
