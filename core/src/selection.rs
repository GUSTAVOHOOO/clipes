//! Seleção de Cortes (#53): uma Tarefa de IA por Janela de seleção (#144), num lote próprio da
//! execução; depois, só código: valida, ajusta as bordas, junta duplicatas, ordena e grava.
//!
//! O Provedor só aponta IDs de Frase e dá notas por eixo ([`cut::AXES`]); nunca devolve tempos.
//! O checkpoint por janela é o próprio job de IA concluído (#121): retomar não repete janela
//! concluída. Juiz e voting estão desligados nesta versão. Veja
//! `docs/contribuindo/selecao-de-cortes.md`.
use crate::{
    ai_task::{self, AiTask, Budget, TaskInput, Violation},
    energy::{self, EnergyLevel, EnergyMarks},
    jobs::{self, Safety},
    projects, provider, selection_windows,
    sentences::{self, Sentence},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use cut::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub mod cut;

pub const TASK_ID: &str = "selection";
/// Tipo do job de cada Janela na fila.
pub const JOB_KIND: &str = "ai:selection";
/// Tamanho máximo de uma justificativa (caracteres) e de um título.
pub const MAX_WHY_CHARS: usize = 300;
pub const MAX_TITLE_CHARS: usize = 80;

const PROMPT: &str = include_str!("selection/prompt.md");
const WIRE: &str = include_str!("selection/wire.json");
const FULL: &str = include_str!("selection/full.json");

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

// ---------------------------------------------------------------- verificadores

fn candidates_of(output: &Value) -> &[Value] {
    output["candidates"].as_array().map_or(&[], Vec::as_slice)
}

fn violation(code: &'static str, i: usize, field: &str, message: &'static str) -> Violation {
    Violation::new(code, format!("/candidates/{i}/{field}"), message)
}

/// Os IDs existem e pertencem à Janela.
fn ids_belong_to_window(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let ids: Vec<i64> = input.context["ids"]
        .as_array()
        .map_or_else(Vec::new, |a| a.iter().filter_map(Value::as_i64).collect());
    let mut found = Vec::new();
    for (i, c) in candidates_of(output).iter().enumerate() {
        for field in ["startId", "endId"] {
            if !c[field].as_i64().is_some_and(|id| ids.contains(&id)) {
                found.push(violation(
                    "unknown_sentence_id",
                    i,
                    field,
                    "Sentence id is not in the window",
                ));
            }
        }
    }
    found
}

/// `startId` ≤ `endId` (os IDs crescem com a ordem das Frases).
fn start_not_after_end(_: &TaskInput, output: &Value) -> Vec<Violation> {
    candidates_of(output)
        .iter()
        .enumerate()
        .filter(|(_, c)| c["startId"].as_i64() > c["endId"].as_i64())
        .map(|(i, _)| {
            violation(
                "start_after_end",
                i,
                "startId",
                "Start sentence comes after the end sentence",
            )
        })
        .collect()
}

/// Notas de 0 a 10, justificativas não vazias e de tamanho limitado, título limitado.
fn scores_and_reasons(_: &TaskInput, output: &Value) -> Vec<Violation> {
    let mut found = Vec::new();
    for (i, c) in candidates_of(output).iter().enumerate() {
        for axis in AXES {
            let node = &c[axis.key];
            let path = format!("{}/score", axis.key);
            if !node["score"]
                .as_i64()
                .is_some_and(|s| (0..=i64::from(SCORE_MAX)).contains(&s))
            {
                found.push(violation(
                    "score_out_of_range",
                    i,
                    &path,
                    "Score is outside 0 to 10",
                ));
            }
            let why = node["why"].as_str().unwrap_or("").trim();
            let path = format!("{}/why", axis.key);
            if why.is_empty() {
                found.push(violation("empty_reason", i, &path, "Reason is empty"));
            } else if why.chars().count() > MAX_WHY_CHARS {
                found.push(violation("reason_too_long", i, &path, "Reason is too long"));
            }
        }
        if c["title"].as_str().unwrap_or("").chars().count() > MAX_TITLE_CHARS {
            found.push(violation("title_too_long", i, "title", "Title is too long"));
        }
    }
    found
}

/// Sem candidatos repetidos na mesma Janela e sem passar da meta (com folga).
fn no_repeats_and_limit(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let mut found = Vec::new();
    let mut seen = Vec::new();
    for (i, c) in candidates_of(output).iter().enumerate() {
        let key = (c["startId"].as_i64(), c["endId"].as_i64());
        if seen.contains(&key) {
            found.push(violation(
                "duplicate_candidate",
                i,
                "startId",
                "Candidate repeats another one in the window",
            ));
        }
        seen.push(key);
    }
    let target = input.context["targetCandidates"].as_i64().unwrap_or(1);
    if candidates_of(output).len() as i64 > target * CANDIDATE_HARD_FACTOR {
        found.push(Violation::new(
            "too_many_candidates",
            "/candidates",
            "Window has more candidates than allowed",
        ));
    }
    found
}

inventory::submit! {
    AiTask {
        id: TASK_ID,
        version: 1,
        prompt: PROMPT,
        prompt_sha256: "c17df5c8f1cc2bef1ed06f7ecc6c99b634f231240c9ca66fe71f5a4659db32e1",
        wire_schema: WIRE,
        full_schema: FULL,
        verifiers: &[
            ids_belong_to_window,
            start_not_after_end,
            scores_and_reasons,
            no_repeats_and_limit,
        ],
        budget: Budget {
            max_calls: 2,
            max_input_tokens: 60_000,
            max_output_tokens: 2_000,
            max_wall_clock_secs: 600,
            max_cost_micro_cents: None,
        },
    }
}

fn task() -> &'static AiTask {
    ai_task::find(TASK_ID).expect("selection task is registered")
}

// ---------------------------------------------------------------- persistência

inventory::submit! { projects::Migration { id: "0053_001_selection", sql: "
CREATE TABLE selection_runs (
  id INTEGER PRIMARY KEY,
  transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  task_version INTEGER NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK(state IN ('running','completed','partial')),
  batch TEXT NOT NULL DEFAULT '',
  min_us INTEGER NOT NULL,
  max_us INTEGER NOT NULL,
  weights TEXT NOT NULL,
  plan_state TEXT NOT NULL,
  windows_total INTEGER NOT NULL,
  windows_completed INTEGER NOT NULL DEFAULT 0,
  windows_failed INTEGER NOT NULL DEFAULT 0,
  candidates_kept INTEGER NOT NULL DEFAULT 0,
  discarded INTEGER NOT NULL DEFAULT 0,
  merged INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE selection_windows (
  run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  first_id INTEGER NOT NULL,
  last_id INTEGER NOT NULL,
  start_us INTEGER NOT NULL,
  end_us INTEGER NOT NULL,
  job_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, idx)
) WITHOUT ROWID;
CREATE TABLE selection_candidates (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  start_id INTEGER NOT NULL,
  end_id INTEGER NOT NULL,
  start_us INTEGER NOT NULL,
  end_us INTEGER NOT NULL,
  axes TEXT NOT NULL,
  total_centi INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  windows TEXT NOT NULL,
  adjust TEXT
);
CREATE INDEX selection_candidates_run ON selection_candidates(run_id, rank);
" } }

// ---------------------------------------------------------------- entrada de cada Janela

struct Range {
    min_us: i64,
    max_us: i64,
}

fn parse_range(v: &Value) -> Result<Range, CoreError> {
    let min_us = v["minUs"].as_i64().unwrap_or(MIN_CUT_US);
    let max_us = v["maxUs"].as_i64().unwrap_or(MAX_CUT_US);
    if min_us <= 0 || min_us >= max_us {
        return Err(error(
            "invalid_cut_range",
            "A faixa de duração dos Cortes é inválida: o mínimo precisa ser positivo e menor que o máximo.",
        ));
    }
    Ok(Range { min_us, max_us })
}

fn weights_json() -> Value {
    AXES.iter()
        .map(|a| json!({"key": a.key, "weight": f64::from(a.weight_percent) / 100.0}))
        .collect()
}

/// O pedido de uma Janela: linha `#JANELA` (escrita pelo núcleo, antes da Transcrição) e as
/// Frases no formato compacto sobre o texto corrigido (#52, #140).
fn window_input(frases: &[Sentence], range: &Range, marks: &EnergyMarks) -> TaskInput {
    let compact = sentences::compact_with_hint_marked(frases, marks);
    let length = frases.last().map_or(0, |s| s.end_us) - frases.first().map_or(0, |s| s.start_us);
    let target = target_candidates(length);
    let header = format!(
        "#JANELA max_candidatos={target} duracao_desejada_s={}-{} duracao_maxima_s={}\n",
        range.min_us / SECOND_US,
        PREFERRED_MAX_US.max(range.min_us) / SECOND_US,
        range.max_us / SECOND_US
    );
    TaskInput {
        transcript: header + &compact.text,
        estimate_hint: compact.hint,
        context: json!({
            "ids": frases.iter().map(|s| s.id).collect::<Vec<_>>(),
            "targetCandidates": target,
        }),
        native_schema: false,
    }
}

fn slice_by_ids(all: &[Sentence], first: i64, last: i64) -> &[Sentence] {
    let from = all.partition_point(|s| s.id < first);
    let to = all.partition_point(|s| s.id <= last);
    &all[from..to]
}

fn structured_request(input: &TaskInput) -> Result<provider::StructuredRequest, CoreError> {
    let (wire, _) = ai_task::check_definition(task()).map_err(CoreError::from)?;
    Ok(provider::StructuredRequest {
        estimate_hint: input.estimate_hint.clone(),
        instruction: ai_task::normalized_prompt(PROMPT),
        transcript: input.transcript.clone(),
        schema: wire,
        native_schema: false,
        max_output_tokens: Some(task().budget.max_output_tokens),
    })
}

// ---------------------------------------------------------------- planejamento e custo

struct Setup {
    transcript: i64,
    frases: Vec<Sentence>,
    range: Range,
    safety: Safety,
    profile: String,
    plan: selection_windows::Plan,
    /// Marcas de energia do áudio (#54): `None` se a energia não foi medida; a execução roda
    /// sem marcas e o resumo diz isso. Decidido uma vez, em `selection.start`.
    marks: Option<EnergyMarks>,
}

/// Rota da seleção, com os dois vetos "somente local" (por tarefa e por Projeto) aplicados
/// antes de qualquer envio: devolve o id do perfil e se a chamada é paga.
fn route_safety() -> Result<(String, Safety), CoreError> {
    Ok(match provider::routed(Some(TASK_ID), None)? {
        provider::Routed::Cli(name) => (name, Safety::Paid),
        provider::Routed::Api { profile, local } => {
            (profile.id, if local { Safety::Local } else { Safety::Paid })
        }
    })
}

impl Setup {
    fn marks(&self) -> EnergyMarks {
        self.marks.clone().unwrap_or_default()
    }
}

fn setup(v: &Value) -> Result<Setup, CoreError> {
    let transcript = sentences::source_transcript(v)?;
    prepare(transcript, parse_range(v)?)
}

fn prepare(transcript: i64, range: Range) -> Result<Setup, CoreError> {
    sentences::segment_transcript(transcript)?;
    let frases = sentences::load_for(transcript)?;
    if frases.is_empty() {
        return Err(error(
            "no_sentences",
            "A Transcrição não tem Frases para selecionar.",
        ));
    }
    let (profile, safety) = route_safety()?;
    let (wire, _) = ai_task::check_definition(task()).map_err(CoreError::from)?;
    let instruction = ai_task::normalized_prompt(PROMPT);
    let marks = energy::load_marks(transcript)?;
    let plan = selection_windows::plan_for_profile_marked(
        &selection_windows::ProfileRequest {
            profile_id: None,
            task: Some(TASK_ID),
            instruction: &instruction,
            schema: &wire,
            native_schema: false,
            output_reserve: task().budget.max_output_tokens,
            reasoning_reserve: selection_windows::DEFAULT_REASONING_RESERVE,
            max_cut_us: range.max_us,
        },
        &frases,
        &marks.clone().unwrap_or_default(),
    )?;
    Ok(Setup {
        transcript,
        frases,
        range,
        safety,
        profile,
        plan,
        marks,
    })
}

fn state_label(state: selection_windows::PlanState) -> &'static str {
    match state {
        selection_windows::PlanState::Full => "full",
        selection_windows::PlanState::Reduced => "reduced",
        selection_windows::PlanState::Blocked => "blocked",
    }
}

/// Soma a estimativa do #40 das Janelas informadas; `kind` e valores como em
/// `provider.cost.estimate`. Custo desconhecido nunca vira zero.
fn estimate_inputs(inputs: &[TaskInput], safety: Safety) -> Value {
    let paid = matches!(safety, Safety::Paid);
    let route = jobs::route_of(TASK_ID, paid);
    let mut kind = String::from("unknown");
    let (mut input_tokens, mut min, mut max) = (0_u64, Some(0_u64), Some(0_u64));
    if let Ok((target, profile)) = route {
        for (i, input) in inputs.iter().enumerate() {
            let estimate = structured_request(input)
                .and_then(|request| provider::cost::estimate_for(&target, &profile, &request));
            let Ok(estimate) = estimate else {
                kind = "unknown".into();
                min = None;
                max = None;
                break;
            };
            let this = estimate["kind"].as_str().unwrap_or("unknown").to_owned();
            if i == 0 {
                kind = this;
            } else if kind != this {
                kind = "unknown".into();
            }
            input_tokens += estimate["inputTokens"].as_u64().unwrap_or(0);
            min = min
                .zip(estimate["minMicroUsd"].as_u64())
                .map(|(a, b)| a + b);
            max = max
                .zip(estimate["maxMicroUsd"].as_u64())
                .map(|(a, b)| a + b);
        }
    }
    json!({
        "kind": kind,
        "windows": inputs.len(),
        "inputTokens": input_tokens,
        "minMicroUsd": min,
        "maxMicroUsd": max,
    })
}

/// Estado da energia do áudio numa execução: se foi medida e quantas Frases têm cada marca.
fn energy_json(marks: Option<&EnergyMarks>) -> Value {
    match marks {
        None => json!({"measured": false}),
        Some(m) => {
            let count = |l| m.values().filter(|x| **x == l).count();
            json!({"measured": true, "high": count(EnergyLevel::High), "peak": count(EnergyLevel::Peak)})
        }
    }
}

fn confirmation_required(estimate: Value) -> CoreError {
    CoreError {
        code: "confirmation_required".into(),
        message: "Esta seleção usa um Provedor pago: confirme o custo estimado antes de começar."
            .into(),
        usage: Some(json!({"estimate": estimate})),
    }
}

fn windows_json(setup: &Setup) -> Vec<Value> {
    setup
        .plan
        .windows
        .iter()
        .enumerate()
        .map(|(i, w)| {
            json!({"index": i, "firstId": w.first_id, "lastId": w.last_id, "startUs": w.start_us, "endUs": w.end_us})
        })
        .collect()
}

/// `selection.estimate {source_id, minUs?, maxUs?}` ou `{run, windows?}`: planeja (ou lê as
/// Janelas pendentes de uma execução) e estima o custo antes de enviar. Janela bloqueada
/// devolve o erro tipado do planejador (#144).
fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    if let Some(run) = v["run"].as_i64() {
        let (_, safety) = route_safety()?;
        let inputs = redo_inputs(run, &v)?;
        let estimate = estimate_inputs(
            &inputs.iter().map(|i| i.1.clone()).collect::<Vec<_>>(),
            safety,
        );
        return Ok(json!({"paid": matches!(safety, Safety::Paid), "estimate": estimate}));
    }
    let s = setup(&v)?;
    let inputs: Vec<TaskInput> = s
        .plan
        .windows
        .iter()
        .map(|w| {
            window_input(
                &s.frases[w.first_index..=w.last_index],
                &s.range,
                &s.marks(),
            )
        })
        .collect();
    Ok(json!({
        "paid": matches!(s.safety, Safety::Paid),
        "profile": s.profile,
        "plan": {
            "state": state_label(s.plan.state),
            "windows": windows_json(&s),
            "contextTokens": s.plan.context.tokens,
        },
        "weights": weights_json(),
        "energy": energy_json(s.marks.as_ref()),
        "estimate": estimate_inputs(&inputs, s.safety),
    }))
}

// ---------------------------------------------------------------- execução

fn batch_of(run: i64) -> String {
    format!("selection-{run}")
}

/// `selection.start {source_id, minUs?, maxUs?, confirmed?}`: planeja, cria a execução e
/// enfileira um job de IA por Janela, todos no lote da execução.
fn cmd_start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let s = setup(&v)?;
    let inputs: Vec<TaskInput> = s
        .plan
        .windows
        .iter()
        .map(|w| {
            window_input(
                &s.frases[w.first_index..=w.last_index],
                &s.range,
                &s.marks(),
            )
        })
        .collect();
    if matches!(s.safety, Safety::Paid) && v["confirmed"] != true {
        return Err(confirmation_required(estimate_inputs(&inputs, s.safety)));
    }
    let definition = task();
    let run = projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,energy_marks) VALUES (?1,?2,?3,?4,'running',?5,?6,?7,?8,?9,?10)",
            (
                s.transcript,
                definition.version,
                definition.prompt_sha256,
                &s.profile,
                s.range.min_us,
                s.range.max_us,
                weights_json().to_string(),
                state_label(s.plan.state),
                s.plan.windows.len() as i64,
                s.marks.is_some(),
            ),
        )?;
        let run = tx.last_insert_rowid();
        tx.execute(
            "UPDATE selection_runs SET batch=?2 WHERE id=?1",
            (run, batch_of(run)),
        )?;
        for (i, w) in s.plan.windows.iter().enumerate() {
            tx.execute(
                "INSERT INTO selection_windows(run_id,idx,first_id,last_id,start_us,end_us) VALUES (?1,?2,?3,?4,?5,?6)",
                (run, i as i64, w.first_id, w.last_id, w.start_us, w.end_us),
            )?;
        }
        tx.commit()?;
        Ok(run)
    })?;
    let pending: Vec<(i64, TaskInput)> = inputs
        .into_iter()
        .enumerate()
        .map(|(i, t)| (i as i64, t))
        .collect();
    enqueue_windows(run, &pending, s.safety)?;
    Ok(
        json!({"run": run, "batch": batch_of(run), "windows": s.plan.windows.len(), "planState": state_label(s.plan.state), "weights": weights_json()}),
    )
}

fn enqueue_windows(
    run: i64,
    windows: &[(i64, TaskInput)],
    safety: Safety,
) -> Result<(), CoreError> {
    let batch = batch_of(run);
    for (idx, input) in windows {
        let job = jobs::enqueue_ai_in_batch(TASK_ID, input, safety, Some(&batch))?;
        projects::with_writer(|c| {
            c.execute(
                "UPDATE selection_windows SET job_id=?3, attempts=attempts+1 WHERE run_id=?1 AND idx=?2",
                (run, idx, job),
            )?;
            c.execute(
                "UPDATE selection_runs SET state='running' WHERE id=?1",
                [run],
            )?;
            Ok(())
        })?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
enum Outcome {
    Pending,
    Done(Value),
    Failed(String),
}

struct WindowRow {
    idx: i64,
    first_id: i64,
    last_id: i64,
    start_us: i64,
    end_us: i64,
    job_id: Option<i64>,
    job_state: Option<String>,
    result: Option<Value>,
}

impl WindowRow {
    fn state(&self) -> &str {
        self.job_state.as_deref().unwrap_or("unscheduled")
    }
    fn outcome(&self) -> Outcome {
        match self.state() {
            "queued" | "running" => Outcome::Pending,
            "completed" => match self.result.as_ref().filter(|r| r["data"].is_object()) {
                Some(r) => Outcome::Done(r["data"].clone()),
                None => Outcome::Failed("invalid_job_result".into()),
            },
            "cancelled" => Outcome::Failed("cancelled".into()),
            "uncertain" => Outcome::Failed(self.code("timeout_uncertain")),
            "failed" => Outcome::Failed(self.code("failed")),
            _ => Outcome::Failed("not_started".into()),
        }
    }
    /// Código fixo do erro do job (nunca texto do modelo); só aceita o formato esperado.
    fn code(&self, fallback: &str) -> String {
        self.result
            .as_ref()
            .and_then(|r| r["code"].as_str())
            .filter(|c| {
                !c.is_empty()
                    && c.len() <= 48
                    && c.chars()
                        .all(|ch| ch.is_ascii_lowercase() || ch == '_' || ch.is_ascii_digit())
            })
            .unwrap_or(fallback)
            .to_owned()
    }
}

fn read_windows(run: i64) -> Result<Vec<WindowRow>, CoreError> {
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT w.idx,w.first_id,w.last_id,w.start_us,w.end_us,w.job_id,j.state,j.result FROM selection_windows w LEFT JOIN jobs j ON j.id=w.job_id WHERE w.run_id=?1 ORDER BY w.idx",
        )?;
        let rows = q.query_map([run], |r| {
            let result: Option<String> = r.get(7)?;
            Ok(WindowRow {
                idx: r.get(0)?,
                first_id: r.get(1)?,
                last_id: r.get(2)?,
                start_us: r.get(3)?,
                end_us: r.get(4)?,
                job_id: r.get(5)?,
                job_state: r.get(6)?,
                result: result.and_then(|t| serde_json::from_str(&t).ok()),
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
}

struct RunRow {
    transcript: i64,
    state: String,
    min_us: i64,
    max_us: i64,
    completed: i64,
    failed: i64,
    energy_marks: bool,
}

fn read_run(run: i64) -> Result<RunRow, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT transcript_id,state,min_us,max_us,windows_completed,windows_failed,energy_marks FROM selection_runs WHERE id=?1",
            [run],
            |r| {
                Ok(RunRow {
                    transcript: r.get(0)?,
                    state: r.get(1)?,
                    min_us: r.get(2)?,
                    max_us: r.get(3)?,
                    completed: r.get(4)?,
                    failed: r.get(5)?,
                    energy_marks: r.get(6)?,
                })
            },
        )
    })
    .map_err(|_| error("run_not_found", "Execução de seleção não encontrada."))
}

fn emit(run: i64, step: &str, percentage: u8, message: &str, error: Option<CoreError>) {
    let project = projects::with_reader(|c| {
        c.query_row("SELECT id FROM queue_project_identity", [], |r| {
            r.get::<_, String>(0)
        })
    })
    .ok();
    crate::emit_background(crate::ProgressEvent {
        job: format!("selection-{run}"),
        project,
        stage: format!("selection:{step}"),
        percentage,
        message: message.into(),
        error,
    });
}

/// Chamado pela fila depois de cada job `ai:selection`.
pub(crate) fn on_job_settled(job: i64) {
    let run = projects::with_reader(|c| {
        c.query_row(
            "SELECT run_id FROM selection_windows WHERE job_id=?1",
            [job],
            |r| r.get::<_, i64>(0),
        )
    });
    if let Ok(run) = run {
        let _ = advance(run);
    }
}

#[derive(Default)]
struct Tally {
    proposed: usize,
    too_short: usize,
    too_long: usize,
    unknown_id: usize,
    merged: usize,
    adjusted: usize,
}

struct Pick {
    start: usize,
    end: usize,
    scores: [u8; AXIS_COUNT],
    why: Vec<String>,
    title: String,
    adjust: Adjust,
}

/// Transforma as saídas validadas das Janelas concluídas nos candidatos finais.
fn build_candidates(
    frases: &[Sentence],
    range: &Range,
    done: &[(usize, Value)],
) -> (Vec<(Merged, Pick)>, Tally) {
    let spans: Vec<Span> = frases
        .iter()
        .map(|s| Span {
            start_us: s.start_us,
            end_us: s.end_us,
        })
        .collect();
    let index_of = |id: i64| frases.binary_search_by_key(&id, |s| s.id).ok();
    let mut tally = Tally::default();
    let mut picks: Vec<Pick> = Vec::new();
    let mut merged: Vec<Merged> = Vec::new();
    for (window, data) in done {
        for c in candidates_of(data) {
            tally.proposed += 1;
            let (Some(a), Some(b)) = (
                c["startId"].as_i64().and_then(index_of),
                c["endId"].as_i64().and_then(index_of),
            ) else {
                tally.unknown_id += 1;
                continue;
            };
            let mut scores = [0_u8; AXIS_COUNT];
            let mut why = Vec::new();
            for (i, axis) in AXES.iter().enumerate() {
                scores[i] = c[axis.key]["score"]
                    .as_u64()
                    .unwrap_or(0)
                    .min(u64::from(SCORE_MAX)) as u8;
                why.push(c[axis.key]["why"].as_str().unwrap_or("").trim().to_owned());
            }
            match fit(&spans, a.min(b), b.max(a), range.min_us, range.max_us) {
                Ok((start, end, adjust)) => {
                    if adjust.changed() {
                        tally.adjusted += 1;
                    }
                    merged.push(Merged {
                        span: Span {
                            start_us: spans[start].start_us,
                            end_us: spans[end].end_us,
                        },
                        total_centi: total_centi(&scores),
                        windows: vec![*window],
                        tag: picks.len(),
                    });
                    picks.push(Pick {
                        start,
                        end,
                        scores,
                        why,
                        title: c["title"].as_str().unwrap_or("").trim().to_owned(),
                        adjust,
                    });
                }
                Err(Discard::TooShort) => tally.too_short += 1,
                Err(Discard::TooLong) => tally.too_long += 1,
            }
        }
    }
    let (kept, absorbed) = merge_duplicates(merged);
    tally.merged = absorbed;
    let mut picks: Vec<Option<Pick>> = picks.into_iter().map(Some).collect();
    let out = kept
        .into_iter()
        .filter_map(|m| picks[m.tag].take().map(|p| (m, p)))
        .collect();
    (out, tally)
}

/// Avança a execução: com todas as Janelas resolvidas, fecha (grava candidatos e resumo) uma
/// única vez; antes disso só atualiza as contagens e emite o progresso. Idempotente.
fn advance(run: i64) -> Result<(), CoreError> {
    let row = read_run(run)?;
    if row.state != "running" {
        return Ok(());
    }
    let windows = read_windows(run)?;
    let total = windows.len();
    let outcomes: Vec<Outcome> = windows.iter().map(WindowRow::outcome).collect();
    let completed = outcomes
        .iter()
        .filter(|o| matches!(o, Outcome::Done(_)))
        .count() as i64;
    let failed = outcomes
        .iter()
        .filter(|o| matches!(o, Outcome::Failed(_)))
        .count() as i64;
    if outcomes.contains(&Outcome::Pending) {
        if (completed, failed) != (row.completed, row.failed) {
            projects::with_writer(|c| {
                c.execute(
                    "UPDATE selection_runs SET windows_completed=?2, windows_failed=?3 WHERE id=?1 AND state='running'",
                    (run, completed, failed),
                )?;
                Ok(())
            })?;
            let pct = ((completed + failed) * 100 / total.max(1) as i64) as u8;
            emit(run, "window", pct, "Janela da seleção resolvida", None);
        }
        return Ok(());
    }
    let frases = sentences::load_for(row.transcript)?;
    let range = Range {
        min_us: row.min_us,
        max_us: row.max_us,
    };
    let done: Vec<(usize, Value)> = outcomes
        .iter()
        .enumerate()
        .filter_map(|(i, o)| match o {
            Outcome::Done(data) => Some((i, data.clone())),
            _ => None,
        })
        .collect();
    let (kept, tally) = build_candidates(&frases, &range, &done);
    let failures: Vec<Value> = outcomes
        .iter()
        .enumerate()
        .filter_map(|(i, o)| match o {
            Outcome::Failed(code) => Some(json!({"window": i, "code": code})),
            _ => None,
        })
        .collect();
    let summary = json!({
        "energy": energy_json(run_marks(&row)?.as_ref()),
        "windows": {"total": total, "completed": completed, "failed": failures},
        "candidates": {
            "proposed": tally.proposed,
            "kept": kept.len(),
            "merged": tally.merged,
            "adjusted": tally.adjusted,
            "discarded": {"tooShort": tally.too_short, "tooLong": tally.too_long, "unknownId": tally.unknown_id},
        },
    });
    let state = if failed == 0 { "completed" } else { "partial" };
    let closed = projects::with_writer(|c| {
        let tx = c.transaction()?;
        let changed = tx.execute(
            "UPDATE selection_runs SET state=?2,windows_completed=?3,windows_failed=?4,candidates_kept=?5,discarded=?6,merged=?7,summary=?8 WHERE id=?1 AND state='running'",
            (
                run,
                state,
                completed,
                failed,
                kept.len() as i64,
                (tally.too_short + tally.too_long + tally.unknown_id) as i64,
                tally.merged as i64,
                summary.to_string(),
            ),
        )?;
        if changed == 1 {
            tx.execute("DELETE FROM selection_candidates WHERE run_id=?1", [run])?;
            for (rank, (m, p)) in kept.iter().enumerate() {
                let axes: BTreeMap<&str, Value> = AXES
                    .iter()
                    .enumerate()
                    .map(|(i, a)| (a.key, json!({"score": p.scores[i], "why": p.why[i]})))
                    .collect();
                let adjust = p.adjust.changed().then(|| {
                    json!({"extendedBefore": p.adjust.extended_before, "extendedAfter": p.adjust.extended_after, "trimmedEnd": p.adjust.trimmed_end}).to_string()
                });
                tx.execute(
                    "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    (
                        run,
                        rank as i64,
                        frases[p.start].id,
                        frases[p.end].id,
                        m.span.start_us,
                        m.span.end_us,
                        serde_json::to_string(&axes).unwrap_or_default(),
                        m.total_centi,
                        &p.title,
                        json!(m.windows).to_string(),
                        adjust,
                    ),
                )?;
            }
        }
        tx.commit()?;
        Ok(changed == 1)
    })?;
    if closed {
        let error = (failed > 0).then(|| {
            error(
                "selection_windows_failed",
                "Algumas Janelas da seleção falharam; refaça-as para completar.",
            )
        });
        emit(run, "done", 100, "Seleção de Cortes concluída", error);
    }
    Ok(())
}

/// As marcas que esta execução usou: decididas no início e guardadas como sinalizador; um
/// refazer ou o resumo nunca consultam se a energia foi medida depois.
fn run_marks(row: &RunRow) -> Result<Option<EnergyMarks>, CoreError> {
    if !row.energy_marks {
        return Ok(None);
    }
    Ok(Some(
        energy::load_marks(row.transcript)?.unwrap_or_default(),
    ))
}

// ---------------------------------------------------------------- retomar e refazer

/// Janelas que um refazer atinge: as pedidas (ou todas as não concluídas) que não estão na
/// fila nem rodando. Janela concluída nunca é repetida.
fn redo_inputs(run: i64, v: &Value) -> Result<Vec<(i64, TaskInput)>, CoreError> {
    let row = read_run(run)?;
    let windows = read_windows(run)?;
    let wanted: Option<Vec<i64>> = v["windows"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_i64).collect());
    let frases = sentences::load_for(row.transcript)?;
    let range = Range {
        min_us: row.min_us,
        max_us: row.max_us,
    };
    let marks = run_marks(&row)?.unwrap_or_default();
    let mut out = Vec::new();
    for w in &windows {
        let selected = wanted.as_ref().is_none_or(|ids| ids.contains(&w.idx));
        if !selected {
            continue;
        }
        match w.outcome() {
            Outcome::Failed(_) => out.push((
                w.idx,
                window_input(slice_by_ids(&frases, w.first_id, w.last_id), &range, &marks),
            )),
            Outcome::Done(_) | Outcome::Pending if wanted.is_some() => {
                return Err(error(
                    "window_not_redoable",
                    "Só uma Janela que falhou ou foi cancelada pode ser refeita.",
                ))
            }
            _ => {}
        }
    }
    if let Some(ids) = &wanted {
        if ids.iter().any(|i| !windows.iter().any(|w| w.idx == *i)) {
            return Err(error(
                "window_not_found",
                "Janela da seleção não encontrada.",
            ));
        }
    }
    if out.is_empty() {
        return Err(error(
            "nothing_to_redo",
            "Não há Janela para refazer nesta execução.",
        ));
    }
    Ok(out)
}

/// `selection.redo {run, windows?, confirmed?}` (e `selection.resume`, sem `windows`): refaz
/// só as Janelas que falharam ou foram canceladas, no mesmo lote, contando no orçamento.
fn cmd_redo(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let run = v["run"]
        .as_i64()
        .ok_or_else(|| error("run_not_found", "Execução de seleção não encontrada."))?;
    let (_, safety) = route_safety()?;
    let inputs = redo_inputs(run, &v)?;
    if matches!(safety, Safety::Paid) && v["confirmed"] != true {
        let list: Vec<TaskInput> = inputs.iter().map(|i| i.1.clone()).collect();
        return Err(confirmation_required(estimate_inputs(&list, safety)));
    }
    enqueue_windows(run, &inputs, safety)?;
    Ok(json!({"run": run, "windows": inputs.iter().map(|i| i.0).collect::<Vec<_>>()}))
}

/// `selection.cancel {run}`: cancela as Janelas na fila e a em andamento (como `jobs.cancel`).
fn cmd_cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let run = v["run"]
        .as_i64()
        .ok_or_else(|| error("run_not_found", "Execução de seleção não encontrada."))?;
    read_run(run)?;
    projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END, cancel_requested=1 WHERE id IN (SELECT job_id FROM selection_windows WHERE run_id=?1 AND job_id IS NOT NULL) AND state IN ('queued','running')",
            [run],
        )?;
        Ok(())
    })?;
    advance(run)?;
    Ok(Value::Null)
}

// ---------------------------------------------------------------- leitura

fn run_json(run: i64) -> Result<Value, CoreError> {
    let (head, batch) = projects::with_reader(|c| {
        c.query_row(
            "SELECT id,transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,windows_completed,windows_failed,candidates_kept,discarded,merged,summary,created_at,batch FROM selection_runs WHERE id=?1",
            [run],
            |r| {
                let weights: String = r.get(8)?;
                let summary: Option<String> = r.get(16)?;
                Ok((
                    json!({
                        "id": r.get::<_, i64>(0)?, "transcriptId": r.get::<_, i64>(1)?,
                        "taskVersion": r.get::<_, i64>(2)?, "promptSha256": r.get::<_, String>(3)?,
                        "profile": r.get::<_, String>(4)?, "state": r.get::<_, String>(5)?,
                        "minUs": r.get::<_, i64>(6)?, "maxUs": r.get::<_, i64>(7)?,
                        "weights": serde_json::from_str::<Value>(&weights).unwrap_or(Value::Null),
                        "planState": r.get::<_, String>(9)?,
                        "counts": {"windows": r.get::<_, i64>(10)?, "completed": r.get::<_, i64>(11)?, "failed": r.get::<_, i64>(12)?, "kept": r.get::<_, i64>(13)?, "discarded": r.get::<_, i64>(14)?, "merged": r.get::<_, i64>(15)?},
                        "summary": summary.and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null),
                        "createdAt": r.get::<_, String>(17)?,
                    }),
                    r.get::<_, String>(18)?,
                ))
            },
        )
    })
    .map_err(|_| error("run_not_found", "Execução de seleção não encontrada."))?;
    let pause: Option<String> = projects::with_reader(|c| {
        c.query_row(
            "SELECT reason FROM ai_pauses WHERE scope='batch' AND key=?1",
            [&batch],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            e => Err(e),
        })
    })?;
    let windows: Vec<Value> = read_windows(run)?
        .iter()
        .map(|w| {
            let code = match w.outcome() {
                Outcome::Failed(code) => Value::String(code),
                _ => Value::Null,
            };
            json!({"index": w.idx, "firstId": w.first_id, "lastId": w.last_id, "startUs": w.start_us, "endUs": w.end_us, "jobId": w.job_id, "state": w.state(), "code": code})
        })
        .collect();
    let candidates = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust FROM selection_candidates WHERE run_id=?1 ORDER BY rank",
        )?;
        let rows = q.query_map([run], |r| {
            let axes: String = r.get(6)?;
            let origin: String = r.get(9)?;
            let adjust: Option<String> = r.get(10)?;
            let centi: i64 = r.get(7)?;
            Ok(json!({
                "id": r.get::<_, i64>(0)?, "rank": r.get::<_, i64>(1)?,
                "startId": r.get::<_, i64>(2)?, "endId": r.get::<_, i64>(3)?,
                "startUs": r.get::<_, i64>(4)?, "endUs": r.get::<_, i64>(5)?,
                "axes": serde_json::from_str::<Value>(&axes).unwrap_or(Value::Null),
                "total": centi as f64 / 100.0, "totalCenti": centi,
                "title": r.get::<_, String>(8)?,
                "windows": serde_json::from_str::<Value>(&origin).unwrap_or(Value::Null),
                "adjusted": adjust.is_some(),
                "adjust": adjust.and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null),
            }))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    let mut head = head;
    head["budgetPause"] = json!(pause);
    Ok(json!({"run": head, "windows": windows, "candidates": candidates}))
}

/// `selection.get {run}`: execução, Janelas (estado e código de erro fixo) e candidatos
/// ordenados pela Nota total, com eixos, justificativas e pesos.
fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let run = v["run"]
        .as_i64()
        .ok_or_else(|| error("run_not_found", "Execução de seleção não encontrada."))?;
    read_run(run)?;
    advance(run)?;
    run_json(run)
}

/// `selection.list {source_id}`: execuções da Transcrição da Fonte, da mais recente à mais antiga.
fn cmd_list(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let transcript = sentences::source_transcript(&v)?;
    let ids: Vec<i64> = projects::with_reader(|c| {
        let mut q =
            c.prepare("SELECT id FROM selection_runs WHERE transcript_id=?1 ORDER BY id DESC")?;
        let rows = q.query_map([transcript], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    for id in &ids {
        advance(*id)?;
    }
    Ok(Value::Array(
        ids.into_iter()
            .map(|id| run_json(id).map(|v| v["run"].clone()))
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

inventory::submit! { CommandRegistration { name: "selection.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "selection.start", execute: cmd_start } }
inventory::submit! { CommandRegistration { name: "selection.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "selection.list", execute: cmd_list } }
inventory::submit! { CommandRegistration { name: "selection.cancel", execute: cmd_cancel } }
inventory::submit! { CommandRegistration { name: "selection.redo", execute: cmd_redo } }
inventory::submit! { CommandRegistration { name: "selection.resume", execute: cmd_redo } }

#[cfg(test)]
mod tests;
