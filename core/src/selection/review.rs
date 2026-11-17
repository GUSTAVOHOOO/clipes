//! Revisão dos Cortes candidatos (#55): aprovar, rejeitar e ajustar as bordas por Frase inteira.
//!
//! As decisões ficam **só no Projeto** (`selection_decisions`, migração `0055_001_...`): candidato,
//! decisão, bordas antes e depois e data. Não há calibração automática nem telemetria; o núcleo
//! nunca lê estas linhas para decidir nada. O candidato do #53 (`selection_candidates`) não é
//! alterado: o estado de revisão é a última decisão sobre ele.
//!
//! **Identidade do candidato.** Os `id` de `selection_candidates` mudam quando uma Janela é
//! refeita (o #53 regrava os candidatos da execução). A decisão guarda por isso a identidade
//! `(execução, Frase inicial, Frase final)` do candidato como o #53 o propôs, e a leitura casa
//! as duas coisas. Uma nova execução (`selection.start`) é outra `run_id` e não toca nas
//! decisões da anterior.
//!
//! Tempos nunca vêm da UI: ela só pede "mover a borda N Frases"; o núcleo calcula as bordas
//! pelos IDs de Frase e confere a faixa de duração da própria execução.
use super::{error, read_run};
use crate::{
    projects,
    sentences::{self, Sentence},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::Connection;
use serde_json::{json, Value};

/// Maior deslocamento aceito num único pedido de ajuste, em Frases.
const MAX_STEP: i64 = 1000;
/// Trecho de texto de cada borda devolvido à tela, em caracteres.
const MAX_TEXT_CHARS: usize = 160;

inventory::submit! { projects::Migration { id: "0055_001_selection_review", sql: "
CREATE TABLE selection_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  cand_start_id INTEGER NOT NULL,
  cand_end_id INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','adjusted')),
  before_start_id INTEGER NOT NULL,
  before_end_id INTEGER NOT NULL,
  after_start_id INTEGER NOT NULL,
  after_end_id INTEGER NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX selection_decisions_run ON selection_decisions(run_id, cand_start_id, cand_end_id, id);
" } }

struct Candidate {
    id: i64,
    start_id: i64,
    end_id: i64,
}

struct Decision {
    cand_start: i64,
    cand_end: i64,
    kind: String,
    after_start: i64,
    after_end: i64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Edge {
    Start,
    End,
}

fn not_found() -> CoreError {
    error("candidate_not_found", "Candidato não encontrado.")
}

fn index_of(frases: &[Sentence], id: i64) -> Option<usize> {
    frases.binary_search_by_key(&id, |s| s.id).ok()
}

fn excerpt(text: &str) -> String {
    let flat: Vec<&str> = text.split_whitespace().collect();
    let flat = flat.join(" ");
    if flat.chars().count() <= MAX_TEXT_CHARS {
        return flat;
    }
    let mut cut: String = flat.chars().take(MAX_TEXT_CHARS).collect();
    cut.push('…');
    cut
}

fn read_candidate(c: &Connection, id: i64) -> rusqlite::Result<Option<(i64, Candidate)>> {
    match c.query_row(
        "SELECT run_id,id,start_id,end_id FROM selection_candidates WHERE id=?1",
        [id],
        |r| {
            Ok((
                r.get(0)?,
                Candidate {
                    id: r.get(1)?,
                    start_id: r.get(2)?,
                    end_id: r.get(3)?,
                },
            ))
        },
    ) {
        Ok(found) => Ok(Some(found)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

fn read_decisions(c: &Connection, run: i64) -> rusqlite::Result<Vec<Decision>> {
    let mut q = c.prepare(
        "SELECT cand_start_id,cand_end_id,decision,after_start_id,after_end_id FROM selection_decisions WHERE run_id=?1 ORDER BY id",
    )?;
    let rows = q.query_map([run], |r| {
        Ok(Decision {
            cand_start: r.get(0)?,
            cand_end: r.get(1)?,
            kind: r.get(2)?,
            after_start: r.get(3)?,
            after_end: r.get(4)?,
        })
    })?;
    rows.collect()
}

/// Estado atual de um candidato: a última decisão aprova ou rejeita (`pending` sem nenhuma) e
/// as bordas são as do último ajuste.
struct State {
    status: &'static str,
    start_id: i64,
    end_id: i64,
    adjusted: bool,
}

fn state_of(candidate: &Candidate, decisions: &[Decision]) -> State {
    let mut state = State {
        status: "pending",
        start_id: candidate.start_id,
        end_id: candidate.end_id,
        adjusted: false,
    };
    for d in decisions
        .iter()
        .filter(|d| d.cand_start == candidate.start_id && d.cand_end == candidate.end_id)
    {
        state.start_id = d.after_start;
        state.end_id = d.after_end;
        state.adjusted = (d.after_start, d.after_end) != (candidate.start_id, candidate.end_id);
        match d.kind.as_str() {
            "approved" => state.status = "approved",
            "rejected" => state.status = "rejected",
            _ => {}
        }
    }
    state
}

/// Nova borda ao mover `edge` em `delta` Frases (negativo = para trás no tempo), validada contra
/// a Transcrição e a faixa de duração da execução. Nunca corrige sozinha: recusa com erro fixo.
fn moved(
    frases: &[Sentence],
    (start, end): (usize, usize),
    edge: Edge,
    delta: i64,
    (min_us, max_us): (i64, i64),
) -> Result<(usize, usize), CoreError> {
    let target = |from: usize| {
        i64::try_from(from)
            .ok()
            .and_then(|n| n.checked_add(delta))
            .and_then(|n| usize::try_from(n).ok())
            .filter(|n| *n < frases.len())
            .ok_or_else(|| {
                error(
                    "adjust_out_of_transcript",
                    "A borda não pode sair da Transcrição.",
                )
            })
    };
    let (start, end) = match edge {
        Edge::Start => (target(start)?, end),
        Edge::End => (start, target(end)?),
    };
    if start > end {
        return Err(error(
            "adjust_empty",
            "O Corte precisa manter ao menos uma Frase.",
        ));
    }
    let length = frases[end].end_us - frases[start].start_us;
    if length < min_us {
        return Err(error(
            "adjust_too_short",
            "O Corte ficaria abaixo da duração mínima.",
        ));
    }
    if length > max_us {
        return Err(error(
            "adjust_too_long",
            "O Corte ficaria acima da duração máxima.",
        ));
    }
    Ok((start, end))
}

fn item(
    frases: &[Sentence],
    range: (i64, i64),
    candidate: &Candidate,
    decisions: &[Decision],
) -> Value {
    let state = state_of(candidate, decisions);
    let (Some(start), Some(end)) = (
        index_of(frases, state.start_id),
        index_of(frases, state.end_id),
    ) else {
        return json!({"candidate": candidate.id, "status": state.status});
    };
    let can = |edge, delta| moved(frases, (start, end), edge, delta, range).is_ok();
    json!({
        "candidate": candidate.id,
        "status": state.status,
        "adjusted": state.adjusted,
        "startId": state.start_id, "endId": state.end_id,
        "startUs": frases[start].start_us, "endUs": frases[end].end_us,
        "startText": excerpt(&frases[start].text), "endText": excerpt(&frases[end].text),
        "moves": {
            "startEarlier": can(Edge::Start, -1), "startLater": can(Edge::Start, 1),
            "endEarlier": can(Edge::End, -1), "endLater": can(Edge::End, 1),
        },
    })
}

struct Snapshot {
    run: i64,
    range: (i64, i64),
    frases: Vec<Sentence>,
    candidates: Vec<Candidate>,
    decisions: Vec<Decision>,
}

fn snapshot(run: i64) -> Result<Snapshot, CoreError> {
    let row = read_run(run)?;
    let frases = sentences::load_for(row.transcript)?;
    let (candidates, decisions) = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id,start_id,end_id FROM selection_candidates WHERE run_id=?1 AND revision=(SELECT revision FROM selection_runs WHERE id=?1) ORDER BY rank",
        )?;
        let rows = q.query_map([run], |r| {
            Ok(Candidate {
                id: r.get(0)?,
                start_id: r.get(1)?,
                end_id: r.get(2)?,
            })
        })?;
        Ok((
            rows.collect::<rusqlite::Result<Vec<_>>>()?,
            read_decisions(c, run)?,
        ))
    })?;
    Ok(Snapshot {
        run,
        range: (row.min_us, row.max_us),
        frases,
        candidates,
        decisions,
    })
}

impl Snapshot {
    fn item_of(&self, candidate: i64) -> Result<Value, CoreError> {
        let found = self
            .candidates
            .iter()
            .find(|c| c.id == candidate)
            .ok_or_else(not_found)?;
        Ok(item(&self.frases, self.range, found, &self.decisions))
    }
    fn can_undo(&self) -> bool {
        !self.decisions.is_empty()
    }
}

/// Candidato e execução a partir do `id` atual; erro fixo quando não existe.
fn candidate_run(id: i64) -> Result<i64, CoreError> {
    projects::with_reader(|c| read_candidate(c, id))?
        .map(|(run, _)| run)
        .ok_or_else(not_found)
}

fn candidate_arg(v: &Value) -> Result<i64, CoreError> {
    v["candidate"].as_i64().ok_or_else(not_found)
}

fn outcome(run: i64, candidate: Option<i64>) -> CommandResult {
    let snap = snapshot(run)?;
    let item = match candidate {
        Some(id) => snap.item_of(id).ok(),
        None => None,
    };
    Ok(json!({"run": snap.run, "item": item, "canUndo": snap.can_undo()}))
}

/// Corte aprovado na revisão, com a identidade estável do candidato e as bordas atuais (#68).
pub(crate) struct ApprovedCut {
    pub run: i64,
    pub transcript: i64,
    /// Identidade `(Frase inicial, Frase final)` do candidato como o #53 o propôs.
    pub identity: (i64, i64),
    /// Frases (já ajustadas pelo usuário) que formam o Corte.
    pub sentences: Vec<Sentence>,
}

/// O Corte do candidato `id`, se foi aprovado: `candidate_not_found` ou `not_approved`.
pub(crate) fn approved_cut(id: i64) -> Result<ApprovedCut, CoreError> {
    let run = candidate_run(id)?;
    let snap = snapshot(run)?;
    let candidate = snap
        .candidates
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(not_found)?;
    let state = state_of(candidate, &snap.decisions);
    if state.status != "approved" {
        return Err(error(
            "not_approved",
            "Aprove o candidato antes de gerar o empacotamento.",
        ));
    }
    let (Some(start), Some(end)) = (
        index_of(&snap.frases, state.start_id),
        index_of(&snap.frases, state.end_id),
    ) else {
        return Err(error(
            "adjust_out_of_transcript",
            "A borda não pode sair da Transcrição.",
        ));
    };
    Ok(ApprovedCut {
        run,
        transcript: read_run(run)?.transcript,
        identity: (candidate.start_id, candidate.end_id),
        sentences: snap.frases[start..=end].to_vec(),
    })
}

/// `selection.review {run}`: estado de revisão de cada candidato da execução (na ordem da Nota):
/// situação (`pending`, `approved`, `rejected`), bordas atuais, o trecho de cada borda e quais
/// movimentos de uma Frase cabem na faixa de duração. `canUndo` diz se há decisão a desfazer.
fn cmd_review(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let run = v["run"]
        .as_i64()
        .ok_or_else(|| error("run_not_found", "Execução de seleção não encontrada."))?;
    let snap = snapshot(run)?;
    let items: Vec<Value> = snap
        .candidates
        .iter()
        .map(|c| item(&snap.frases, snap.range, c, &snap.decisions))
        .collect();
    Ok(json!({"run": run, "items": items, "canUndo": snap.can_undo()}))
}

fn record(
    run: i64,
    identity: (i64, i64),
    kind: &str,
    before: (i64, i64),
    after: (i64, i64),
) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            (run, identity.0, identity.1, kind, before.0, before.1, after.0, after.1),
        )?;
        Ok(())
    })
}

/// `selection.decide {candidate, decision}`: `approved` ou `rejected`. Repetir a decisão que já
/// vale não grava nada; trocar de uma para a outra grava uma linha nova.
fn cmd_decide(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = candidate_arg(&v)?;
    let kind = match v["decision"].as_str() {
        Some("approved") => "approved",
        Some("rejected") => "rejected",
        _ => return Err(error("invalid_decision", "Decisão inválida.")),
    };
    let run = candidate_run(id)?;
    let snap = snapshot(run)?;
    let candidate = snap
        .candidates
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(not_found)?;
    let state = state_of(candidate, &snap.decisions);
    if state.status != kind {
        record(
            run,
            (candidate.start_id, candidate.end_id),
            kind,
            (state.start_id, state.end_id),
            (state.start_id, state.end_id),
        )?;
    }
    outcome(run, Some(id))
}

/// `selection.adjust {candidate, edge: "start"|"end", delta}`: move uma borda `delta` Frases
/// inteiras (negativo = mais cedo). Estender ou encurtar, no início e no fim, sempre dentro da
/// faixa de duração da execução; fora dela, erro fixo e nada é gravado.
fn cmd_adjust(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = candidate_arg(&v)?;
    let edge = match v["edge"].as_str() {
        Some("start") => Edge::Start,
        Some("end") => Edge::End,
        _ => return Err(error("invalid_edge", "Borda inválida.")),
    };
    let delta = v["delta"]
        .as_i64()
        .filter(|d| *d != 0 && d.abs() <= MAX_STEP)
        .ok_or_else(|| error("invalid_delta", "Deslocamento inválido."))?;
    let run = candidate_run(id)?;
    let snap = snapshot(run)?;
    let candidate = snap
        .candidates
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(not_found)?;
    let state = state_of(candidate, &snap.decisions);
    let (Some(start), Some(end)) = (
        index_of(&snap.frases, state.start_id),
        index_of(&snap.frases, state.end_id),
    ) else {
        return Err(error(
            "adjust_out_of_transcript",
            "A borda não pode sair da Transcrição.",
        ));
    };
    let (new_start, new_end) = moved(&snap.frases, (start, end), edge, delta, snap.range)?;
    record(
        run,
        (candidate.start_id, candidate.end_id),
        "adjusted",
        (state.start_id, state.end_id),
        (snap.frases[new_start].id, snap.frases[new_end].id),
    )?;
    outcome(run, Some(id))
}

/// `selection.undo {run}`: desfaz a última decisão da execução (apaga a linha). Funciona também
/// com decisões de uma sessão anterior, porque elas estão no Projeto.
fn cmd_undo(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let run = v["run"]
        .as_i64()
        .ok_or_else(|| error("run_not_found", "Execução de seleção não encontrada."))?;
    read_run(run)?;
    let last = projects::with_writer(|c| {
        let last: Option<(i64, i64, i64)> = c
            .query_row(
                "SELECT id,cand_start_id,cand_end_id FROM selection_decisions WHERE run_id=?1 ORDER BY id DESC LIMIT 1",
                [run],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                e => Err(e),
            })?;
        if let Some((row, _, _)) = last {
            c.execute("DELETE FROM selection_decisions WHERE id=?1", [row])?;
        }
        Ok(last)
    })?;
    let Some((_, start, end)) = last else {
        return Err(error("nothing_to_undo", "Não há decisão para desfazer."));
    };
    let snap = snapshot(run)?;
    let candidate = snap
        .candidates
        .iter()
        .find(|c| c.start_id == start && c.end_id == end)
        .map(|c| c.id);
    outcome(run, candidate)
}

inventory::submit! { CommandRegistration { name: "selection.review", execute: cmd_review } }
inventory::submit! { CommandRegistration { name: "selection.decide", execute: cmd_decide } }
inventory::submit! { CommandRegistration { name: "selection.adjust", execute: cmd_adjust } }
inventory::submit! { CommandRegistration { name: "selection.undo", execute: cmd_undo } }

#[cfg(test)]
mod tests {
    use super::*;

    fn frases(count: i64) -> Vec<Sentence> {
        (0..count)
            .map(|i| Sentence {
                id: i + 1,
                first_position: i * 10,
                last_position: i * 10 + 9,
                start_us: i * 10_000_000,
                end_us: (i + 1) * 10_000_000,
                language: None,
                text: format!("frase {i}"),
            })
            .collect()
    }

    const RANGE: (i64, i64) = (20_000_000, 40_000_000);

    #[test]
    fn moves_whole_sentences_inside_the_range() {
        let f = frases(10);
        assert_eq!(moved(&f, (2, 3), Edge::End, 1, RANGE).unwrap(), (2, 4));
        assert_eq!(moved(&f, (2, 3), Edge::Start, -1, RANGE).unwrap(), (1, 3));
        assert_eq!(moved(&f, (2, 5), Edge::End, -1, RANGE).unwrap(), (2, 4));
        assert_eq!(moved(&f, (2, 5), Edge::Start, 1, RANGE).unwrap(), (3, 5));
    }

    #[test]
    fn refuses_what_leaves_the_range_or_the_transcript() {
        let f = frases(10);
        assert_eq!(
            moved(&f, (2, 3), Edge::End, -1, RANGE).unwrap_err().code,
            "adjust_too_short"
        );
        assert_eq!(
            moved(&f, (2, 5), Edge::End, 1, RANGE).unwrap_err().code,
            "adjust_too_long"
        );
        assert_eq!(
            moved(&f, (0, 1), Edge::Start, -1, RANGE).unwrap_err().code,
            "adjust_out_of_transcript"
        );
        assert_eq!(
            moved(&f, (8, 9), Edge::End, 1, RANGE).unwrap_err().code,
            "adjust_out_of_transcript"
        );
        assert_eq!(
            moved(&f, (3, 4), Edge::Start, 3, (1, i64::MAX))
                .unwrap_err()
                .code,
            "adjust_empty"
        );
    }

    #[test]
    fn excerpt_flattens_and_truncates() {
        assert_eq!(excerpt("  a \n b  "), "a b");
        let long = "x".repeat(400);
        assert_eq!(excerpt(&long).chars().count(), MAX_TEXT_CHARS + 1);
    }
}
