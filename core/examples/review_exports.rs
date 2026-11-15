//! Conferência humana do #102: exporta N trechos de uma Fonte local já transcrita.
//! Usa dispatch/filas reais e um CLIPES_DATA_DIR temporário, sem Provedor nem rede.
use clipes_core::dispatch;
use serde_json::{json, Value};
use std::{
    io,
    path::PathBuf,
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> io::Result<Value> {
    dispatch(name, args, &mut |_| {})
        .map_err(|e| io::Error::other(format!("{}: {}", e.code, e.message)))
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !(4..=5).contains(&args.len()) {
        return Err(
            "Uso: review_exports <Projeto.clipes> <source_id> <pasta-saída> <N> [ffmpeg]".into(),
        );
    }
    let project = PathBuf::from(&args[0]).canonicalize()?;
    let source: i64 = args[1].parse()?;
    let count: usize = args[3].parse()?;
    if count == 0 {
        return Err("N deve ser maior que zero.".into());
    }
    std::fs::create_dir_all(&args[2])?;
    let output = PathBuf::from(&args[2]).canonicalize()?;
    let data = tempfile::tempdir()?;
    std::env::set_var("CLIPES_DATA_DIR", data.path());
    call(
        "components.ffmpeg.system",
        json!({"path":args.get(4).map_or("ffmpeg",String::as_str)}),
    )?;
    call("projects.open", json!({"path":project}))?;
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        call("transcription.segment", json!({"source_id":source}))?;
        let mut after = 0;
        let mut cuts = Vec::new();
        let mut first: Option<(i64, i64)> = None;
        while cuts.len() < count {
            let page = call(
                "transcription.sentences",
                json!({"source_id":source,"after_id":after,"limit":1000}),
            )?;
            let rows = page.as_array().ok_or("Frases indisponíveis.")?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let id = row["id"].as_i64().ok_or("Frase inválida.")?;
                after = id;
                let start = row["start_us"].as_i64().ok_or("Frase inválida.")?;
                let end = row["end_us"].as_i64().ok_or("Frase inválida.")?;
                let (first_id, first_us) = *first.get_or_insert((id, start));
                if end - first_us >= 20_000_000 {
                    cuts.push((first_id, id));
                    first = None;
                }
                if cuts.len() == count {
                    break;
                }
            }
        }
        if cuts.len() < count {
            return Err(
                "A Fonte não tem N trechos de pelo menos 20 s; reduza N ou escolha outra Fonte."
                    .into(),
            );
        }
        for (index, (start, end)) in cuts.into_iter().enumerate() {
            let path = output.join(format!("conferencia-{source}-{:02}.mp4", index + 1));
            let started = call(
                "export.start",
                json!({"source_id":source,"start_id":start,"end_id":end,"output":path}),
            )?;
            let job = started["job"].as_i64().ok_or("Job inválido.")?;
            let deadline = Instant::now() + Duration::from_secs(3600);
            loop {
                let state = call("export.status", json!({"job":job}))?;
                match state["state"].as_str() {
                    Some("completed") => {
                        println!(
                            "Corte {} de {} pronto (Frases {}–{}).",
                            index + 1,
                            count,
                            start,
                            end
                        );
                        break;
                    }
                    Some("failed" | "cancelled") => {
                        return Err(format!(
                            "Export interrompido: {}",
                            state["error"]["code"].as_str().unwrap_or("cancelled")
                        )
                        .into())
                    }
                    _ => {}
                }
                if Instant::now() > deadline {
                    call("jobs.cancel", json!({"id":job}))?;
                    return Err("Tempo de conferência excedido; export cancelado.".into());
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        }
        println!("Assista aos arquivos e registre a avaliação de sincronia PT/EN no #59 antes de fechá-lo.");
        Ok(())
    })();
    // Ao sair em erro, a fila encerra o processo gerenciado e remove o parcial.
    let close = call("projects.close", json!({}));
    result?;
    close?;
    Ok(())
}
