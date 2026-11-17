//! Seleção de Cortes (#53): uma Tarefa de IA por Janela de seleção (#144), num lote próprio da
//! execução; depois, só código: valida, ajusta as bordas, junta duplicatas, ordena e grava.
//!
//! O Provedor só aponta IDs de Frase e dá notas por eixo ([`cut::AXES`]); nunca devolve tempos.
//! O checkpoint por janela é o próprio job de IA concluído (#121): retomar não repete janela
//! concluída. Juiz e voting estão desligados nesta versão. Veja
//! `docs/contribuindo/selecao-de-cortes.md`.
use crate::{
    ai_task::{self, AiTask, Budget, TaskInput, Violation},
    chat::{self, ChatMarks},
    energy::{self, EnergyLevel, EnergyMarks},
    jobs::{self, Safety},
    projects, provider, selection_windows,
    sentences::{self, Marks, Sentence},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use cut::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub mod benchmark;
pub mod cut;
mod review;
pub mod routing_benchmark;
pub(crate) use review::{approved_cut, ApprovedCut};

pub const TASK_ID: &str = "selection";
/// Tarefa de IA do Vídeo transformado (#67): prompt e schema próprios, com o 6º eixo. Roteia
/// (Provedor, veto "somente local") como `selection`: veja `ai_task::routing_id`.
pub const TASK_ID_TRANSFORMED: &str = "selection_transformed";
/// Tipo do job de cada Janela na fila (Corte direto).
pub const JOB_KIND: &str = "ai:selection";
/// Tipo do job de cada Janela do Vídeo transformado.
pub const JOB_KIND_TRANSFORMED: &str = "ai:selection_transformed";

/// O job é uma Janela de seleção, de qualquer tipo de vídeo.
pub fn is_job_kind(kind: &str) -> bool {
    kind == JOB_KIND || kind == JOB_KIND_TRANSFORMED
}
/// Tamanho máximo de uma justificativa (caracteres) e de um título.
pub const MAX_WHY_CHARS: usize = 300;
pub const MAX_TITLE_CHARS: usize = 80;

const PROMPT: &str = include_str!("selection/prompt.md");
const WIRE: &str = include_str!("selection/wire.json");
const FULL: &str = include_str!("selection/full.json");
const PROMPT_TRANSFORMED: &str = include_str!("selection/prompt_transformed.md");
const WIRE_TRANSFORMED: &str = include_str!("selection/wire_transformed.json");
const FULL_TRANSFORMED: &str = include_str!("selection/full_transformed.json");

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

/// Notas de 0 a 10, justificativas não vazias e de tamanho limitado, título limitado. Cada tipo
/// de vídeo exige os eixos da própria tabela: o 6º (`commentary`) só existe no transformado.
fn scores_and_reasons(axes: &[Axis], output: &Value) -> Vec<Violation> {
    let mut found = Vec::new();
    for (i, c) in candidates_of(output).iter().enumerate() {
        for axis in axes {
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

fn scores_direct(_: &TaskInput, output: &Value) -> Vec<Violation> {
    scores_and_reasons(&AXES, output)
}

fn scores_transformed(_: &TaskInput, output: &Value) -> Vec<Violation> {
    scores_and_reasons(&AXES_TRANSFORMED, output)
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
        version: 3,
        prompt: PROMPT,
        prompt_sha256: "e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a",
        wire_schema: WIRE,
        full_schema: FULL,
        verifiers: &[
            ids_belong_to_window,
            start_not_after_end,
            scores_direct,
            no_repeats_and_limit,
        ],
        budget: SELECTION_BUDGET,
    }
}

const SELECTION_BUDGET: Budget = Budget {
    max_calls: 2,
    max_input_tokens: 60_000,
    max_output_tokens: 2_000,
    max_wall_clock_secs: 600,
    max_cost_micro_cents: None,
};

inventory::submit! {
    AiTask {
        id: TASK_ID_TRANSFORMED,
        version: 2,
        prompt: PROMPT_TRANSFORMED,
        prompt_sha256: "9d02b5dd4589777e97b14c5e69c582444ab40e1af878cfe7dfcc5d56a2d284ec",
        wire_schema: WIRE_TRANSFORMED,
        full_schema: FULL_TRANSFORMED,
        verifiers: &[
            ids_belong_to_window,
            start_not_after_end,
            scores_transformed,
            no_repeats_and_limit,
        ],
        budget: SELECTION_BUDGET,
    }
}

/// A Tarefa de IA do tipo de vídeo: prompt, schema e verificadores próprios.
fn task_for(kind: VideoKind) -> &'static AiTask {
    let id = match kind {
        VideoKind::Direct => TASK_ID,
        VideoKind::Transformed => TASK_ID_TRANSFORMED,
    };
    ai_task::find(id).expect("selection task is registered")
}

fn prompt_for(kind: VideoKind) -> &'static str {
    task_for(kind).prompt
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

// Refazer com outro Perfil (#126): cada Janela guarda o perfil que gerou o seu resultado, e
// cada candidato o perfil da Janela de onde veio. Os candidatos novos de um refazer entram
// como uma nova `revision` da execução; as revisões anteriores e as decisões do #55 ficam.
inventory::submit! { projects::Migration { id: "0126_001_selection_redo_profile", sql: "
ALTER TABLE selection_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE selection_windows ADD COLUMN profile TEXT NOT NULL DEFAULT '';
ALTER TABLE selection_windows ADD COLUMN redo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE selection_windows ADD COLUMN prev_job_id INTEGER;
ALTER TABLE selection_windows ADD COLUMN prev_profile TEXT NOT NULL DEFAULT '';
ALTER TABLE selection_candidates ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE selection_candidates ADD COLUMN profile TEXT NOT NULL DEFAULT '';
UPDATE selection_windows SET profile=COALESCE((SELECT r.profile FROM selection_runs r WHERE r.id=run_id),'');
UPDATE selection_candidates SET profile=COALESCE((SELECT r.profile FROM selection_runs r WHERE r.id=run_id),'');
" } }

// Tipo de vídeo (#67): uma execução e um lote de Fontes têm um tipo, escolhido antes de produzir.
// Execuções e lotes anteriores valem como Corte direto (o DEFAULT).
inventory::submit! { projects::Migration { id: "0067_001_video_kind", sql: "
ALTER TABLE selection_runs ADD COLUMN video_kind TEXT NOT NULL DEFAULT 'direct' CHECK(video_kind IN ('direct','transformed'));
ALTER TABLE source_batches ADD COLUMN video_kind TEXT NOT NULL DEFAULT 'direct' CHECK(video_kind IN ('direct','transformed'));
" } }

// ---------------------------------------------------------------- entrada de cada Janela

struct Range {
    min_us: i64,
    max_us: i64,
}

fn parse_range(v: &Value) -> Result<Range, CoreError> {
    let defaults = crate::channel_profile::selection_defaults()?;
    let range_err = || {
        error(
            "invalid_cut_range",
            "A faixa de duração dos Cortes é inválida: o mínimo precisa ser positivo e menor que o máximo.",
        )
    };
    let min_us = match v.get("minUs") {
        None | Some(Value::Null) => defaults.min_us,
        Some(n) => n.as_i64().ok_or_else(range_err)?,
    };
    let max_us = match v.get("maxUs") {
        None | Some(Value::Null) => defaults.max_us,
        Some(n) => n.as_i64().ok_or_else(range_err)?,
    };
    if min_us <= 0 || min_us >= max_us {
        return Err(range_err());
    }
    Ok(Range { min_us, max_us })
}

/// `videoKind` do pedido: ausente usa o padrão do Perfil de canal (Corte direto sem Perfil
/// customizado); qualquer outro valor é recusado.
pub(crate) fn parse_kind(v: &Value) -> Result<VideoKind, CoreError> {
    match v.get("videoKind") {
        None | Some(Value::Null) => Ok(crate::channel_profile::selection_defaults()?.video_kind),
        Some(Value::String(k)) => VideoKind::parse(k).ok_or_else(invalid_kind),
        _ => Err(invalid_kind()),
    }
}

fn invalid_kind() -> CoreError {
    error(
        "invalid_video_kind",
        "Tipo de vídeo inválido: use direct (Corte direto) ou transformed (Vídeo transformado).",
    )
}

/// Pesos do tipo, na ordem da tabela, como a UI os mostra.
fn weights_json(kind: VideoKind) -> Value {
    kind.axes()
        .iter()
        .map(|a| json!({"key": a.key, "weight": f64::from(a.weight_percent) / 100.0}))
        .collect()
}

/// O pedido de uma Janela: linha `#JANELA` (escrita pelo núcleo, antes da Transcrição) e as
/// Frases no formato compacto sobre o texto corrigido (#52, #140).
fn window_input(frases: &[Sentence], range: &Range, marks: &Marks) -> TaskInput {
    let compact = sentences::compact_with_hint_marked(frases, marks);
    let length = frases.last().map_or(0, |s| s.end_us) - frases.first().map_or(0, |s| s.start_us);
    let target = target_candidates(length);
    let desired_max = PREFERRED_MAX_US.min(range.max_us).max(range.min_us);
    let header = format!(
        "#JANELA max_candidatos={target} duracao_desejada_s={}-{} duracao_maxima_s={}\n",
        range.min_us / SECOND_US,
        desired_max / SECOND_US,
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

// ---------------------------------------------------------------- planejamento e custo

struct Setup {
    transcript: i64,
    frases: Vec<Sentence>,
    range: Range,
    kind: VideoKind,
    safety: Safety,
    profile: String,
    plan: selection_windows::Plan,
    /// Marcas de energia do áudio (#54): `None` se a energia não foi medida; a execução roda
    /// sem marcas e o resumo diz isso. Decidido uma vez, em `selection.start`.
    marks: Option<EnergyMarks>,
    /// Marcas do chat da live (#151): `None` se a Fonte não tem chat. Também decidido uma vez,
    /// em `selection.start`.
    chat: Option<ChatMarks>,
}

/// Rota da seleção, com os dois vetos "somente local" (por tarefa e por Projeto) aplicados
/// antes de qualquer envio: devolve o id do perfil e se a chamada é paga.
pub(crate) fn route_safety() -> Result<(String, Safety), CoreError> {
    Ok(match provider::routed(Some(TASK_ID), None)? {
        provider::Routed::Cli(name) => (name, Safety::Paid),
        provider::Routed::Api { profile, local } => {
            (profile.id, if local { Safety::Local } else { Safety::Paid })
        }
    })
}

impl Setup {
    fn marks(&self) -> Marks {
        Marks {
            energy: self.marks.clone().unwrap_or_default(),
            chat: self.chat.clone().unwrap_or_default(),
        }
    }
}

fn setup(v: &Value) -> Result<Setup, CoreError> {
    let transcript = sentences::source_transcript(v)?;
    prepare(transcript, parse_range(v)?, parse_kind(v)?)
}

fn prepare(transcript: i64, range: Range, kind: VideoKind) -> Result<Setup, CoreError> {
    sentences::segment_transcript(transcript)?;
    let frases = sentences::load_for(transcript)?;
    if frases.is_empty() {
        return Err(error(
            "no_sentences",
            "A Transcrição não tem Frases para selecionar.",
        ));
    }
    let (profile, safety) = route_safety()?;
    let (wire, _) = ai_task::check_definition(task_for(kind)).map_err(CoreError::from)?;
    let instruction = ai_task::normalized_prompt(prompt_for(kind));
    let marks = energy::load_marks(transcript)?;
    let chat = chat::load_marks(transcript, &frases)?;
    let plan = selection_windows::plan_for_profile_marked(
        &selection_windows::ProfileRequest {
            profile_id: None,
            task: Some(TASK_ID),
            instruction: &instruction,
            schema: &wire,
            native_schema: false,
            output_reserve: task_for(kind).budget.max_output_tokens,
            reasoning_reserve: selection_windows::DEFAULT_REASONING_RESERVE,
            max_cut_us: range.max_us,
        },
        &frases,
        &Marks {
            energy: marks.clone().unwrap_or_default(),
            chat: chat.clone().unwrap_or_default(),
        },
    )?;
    Ok(Setup {
        transcript,
        frases,
        range,
        kind,
        safety,
        profile,
        plan,
        marks,
        chat,
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
/// `provider.cost.estimate`. Custo desconhecido nunca vira zero. É a mesma soma de "refazer
/// com outro perfil" (`jobs::redo`), com a rota da Tarefa do tipo de vídeo.
fn estimate_inputs(video: VideoKind, inputs: &[TaskInput], safety: Safety) -> Value {
    jobs::redo::estimate_inputs(task_for(video).id, inputs, safety, None)
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

/// Estado do chat da live numa execução: se a Fonte tem chat e quantos picos viraram marca.
fn chat_json(marks: Option<&ChatMarks>) -> Value {
    match marks {
        None => json!({"available": false}),
        Some(m) => {
            let peaks: std::collections::BTreeSet<u32> = m.values().map(|x| x.interval).collect();
            json!({"available": true, "peaks": peaks.len(), "marked": m.len()})
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
        if let Some(profile) = explicit_profile(&v)? {
            return profile_redo_preview(run, &profile, &v);
        }
        let (_, safety) = route_safety()?;
        let kind = read_run(run)?.kind;
        let inputs = redo_inputs(run, &v)?;
        let estimate = estimate_inputs(
            kind,
            &inputs.iter().map(|i| i.1.clone()).collect::<Vec<_>>(),
            safety,
        );
        return Ok(
            json!({"paid": matches!(safety, Safety::Paid), "videoKind": kind.as_str(), "estimate": estimate}),
        );
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
        "minUs": s.range.min_us,
        "maxUs": s.range.max_us,
        "plan": {
            "state": state_label(s.plan.state),
            "windows": windows_json(&s),
            "contextTokens": s.plan.context.tokens,
        },
        "videoKind": s.kind.as_str(),
        "weights": weights_json(s.kind),
        "energy": energy_json(s.marks.as_ref()),
        "chat": chat_json(s.chat.as_ref()),
        "estimate": estimate_inputs(s.kind, &inputs, s.safety),
    }))
}

// ---------------------------------------------------------------- execução

fn batch_of(run: i64) -> String {
    format!("selection-{run}")
}

/// Lote da execução: o do pedido (lote de Fontes, #56) ou o próprio `selection-<run>`. Refazer
/// e retomar leem o que a execução gravou, para continuar sob o mesmo teto.
fn batch_for(run: i64) -> String {
    projects::with_reader(|c| {
        c.query_row("SELECT batch FROM selection_runs WHERE id=?1", [run], |r| {
            r.get::<_, String>(0)
        })
    })
    .ok()
    .filter(|b| !b.is_empty())
    .unwrap_or_else(|| batch_of(run))
}

/// Chave de lote aceita no pedido: curta, sem texto livre.
fn requested_batch(v: &Value) -> Result<Option<String>, CoreError> {
    match v.get("batch") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(b))
            if !b.is_empty()
                && b.len() <= 80
                && b.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') =>
        {
            Ok(Some(b.clone()))
        }
        _ => Err(error("invalid_batch", "Lote inválido.")),
    }
}

/// `selection.start {source_id, minUs?, maxUs?, confirmed?}`: planeja, cria a execução e
/// enfileira um job de IA por Janela, todos no lote da execução.
fn cmd_start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let batch = requested_batch(&v)?;
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
        return Err(confirmation_required(estimate_inputs(
            s.kind, &inputs, s.safety,
        )));
    }
    let definition = task_for(s.kind);
    let run = projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,energy_marks,chat_marks,video_kind) VALUES (?1,?2,?3,?4,'running',?5,?6,?7,?8,?9,?10,?11,?12)",
            (
                s.transcript,
                definition.version,
                definition.prompt_sha256,
                &s.profile,
                s.range.min_us,
                s.range.max_us,
                weights_json(s.kind).to_string(),
                state_label(s.plan.state),
                s.plan.windows.len() as i64,
                s.marks.is_some(),
                s.chat.is_some(),
                s.kind.as_str(),
            ),
        )?;
        let run = tx.last_insert_rowid();
        tx.execute(
            "UPDATE selection_runs SET batch=?2 WHERE id=?1",
            (run, batch.clone().unwrap_or_else(|| batch_of(run))),
        )?;
        for (i, w) in s.plan.windows.iter().enumerate() {
            tx.execute(
                "INSERT INTO selection_windows(run_id,idx,first_id,last_id,start_us,end_us,profile) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                (run, i as i64, w.first_id, w.last_id, w.start_us, w.end_us, &s.profile),
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
    enqueue_windows(
        run,
        &pending,
        &Dest {
            safety: s.safety,
            profile: &s.profile,
            explicit: false,
        },
    )?;
    Ok(
        json!({"run": run, "batch": batch_for(run), "videoKind": s.kind.as_str(), "minUs": s.range.min_us, "maxUs": s.range.max_us, "windows": s.plan.windows.len(), "planState": state_label(s.plan.state), "weights": weights_json(s.kind)}),
    )
}

/// Para onde vão as Janelas enfileiradas: o perfil que gera o resultado (gravado na Janela) e,
/// só no "refazer com outro perfil" (#126), o perfil explícito do job. Sem `explicit`, o job
/// segue a rota da Tarefa e o padrão nunca muda.
struct Dest<'a> {
    safety: Safety,
    profile: &'a str,
    explicit: bool,
}

fn enqueue_windows(
    run: i64,
    windows: &[(i64, TaskInput)],
    dest: &Dest<'_>,
) -> Result<(), CoreError> {
    let batch = batch_for(run);
    let task = task_for(read_run(run)?.kind).id;
    for (idx, input) in windows {
        let job = jobs::enqueue_ai_with_profile(
            task,
            input,
            dest.safety,
            Some(&batch),
            dest.explicit.then_some(dest.profile),
        )?;
        projects::with_writer(|c| {
            // Refazer com perfil sobre uma Janela concluída guarda o resultado dela: se o novo
            // job falhar, os candidatos dela não somem.
            c.execute(
                "UPDATE selection_windows SET prev_job_id=CASE WHEN ?5=1 AND (SELECT state FROM jobs WHERE id=job_id)='completed' THEN job_id ELSE prev_job_id END, prev_profile=CASE WHEN ?5=1 AND (SELECT state FROM jobs WHERE id=job_id)='completed' THEN profile ELSE prev_profile END, job_id=?3, profile=?4, redo=?5, attempts=attempts+1 WHERE run_id=?1 AND idx=?2",
                (run, idx, job, dest.profile, i64::from(dest.explicit)),
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
    /// Perfil que gerou o resultado do job atual (#126).
    profile: String,
    /// O job atual é um refazer com perfil explícito que ainda não virou uma revisão.
    redo: bool,
    prev_profile: String,
    prev_state: Option<String>,
    prev_result: Option<Value>,
}

/// O que vale para uma Janela: o resultado do job atual ou, quando um refazer com perfil
/// falhou ou foi cancelado, o resultado anterior (com o código do erro do refazer).
struct Effective {
    outcome: Outcome,
    profile: String,
    redo_failed: Option<String>,
}

impl WindowRow {
    fn effective(&self) -> Effective {
        let current = self.outcome();
        if let Outcome::Failed(code) = &current {
            let previous = (self.prev_state.as_deref() == Some("completed"))
                .then_some(self.prev_result.as_ref())
                .flatten()
                .filter(|r| r["data"].is_object());
            if let Some(previous) = previous {
                return Effective {
                    outcome: Outcome::Done(previous["data"].clone()),
                    profile: self.prev_profile.clone(),
                    redo_failed: Some(code.clone()),
                };
            }
        }
        Effective {
            outcome: current,
            profile: self.profile.clone(),
            redo_failed: None,
        }
    }
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
    fn reset_at_ms(&self) -> Option<u64> {
        matches!(self.outcome(), Outcome::Failed(_))
            .then(|| self.result.as_ref().and_then(|r| r["resetAtMs"].as_u64()))
            .flatten()
    }
}

fn read_windows(run: i64) -> Result<Vec<WindowRow>, CoreError> {
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT w.idx,w.first_id,w.last_id,w.start_us,w.end_us,w.job_id,j.state,j.result,w.profile,w.redo,w.prev_profile,p.state,p.result FROM selection_windows w LEFT JOIN jobs j ON j.id=w.job_id LEFT JOIN jobs p ON p.id=w.prev_job_id WHERE w.run_id=?1 ORDER BY w.idx",
        )?;
        let rows = q.query_map([run], |r| {
            let result: Option<String> = r.get(7)?;
            let prev_result: Option<String> = r.get(12)?;
            Ok(WindowRow {
                idx: r.get(0)?,
                first_id: r.get(1)?,
                last_id: r.get(2)?,
                start_us: r.get(3)?,
                end_us: r.get(4)?,
                job_id: r.get(5)?,
                job_state: r.get(6)?,
                result: result.and_then(|t| serde_json::from_str(&t).ok()),
                profile: r.get(8)?,
                redo: r.get(9)?,
                prev_profile: r.get(10)?,
                prev_state: r.get(11)?,
                prev_result: prev_result.and_then(|t| serde_json::from_str(&t).ok()),
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
    chat_marks: bool,
    revision: i64,
    kind: VideoKind,
}

fn read_run(run: i64) -> Result<RunRow, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT transcript_id,state,min_us,max_us,windows_completed,windows_failed,energy_marks,chat_marks,video_kind,revision FROM selection_runs WHERE id=?1",
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
                    chat_marks: r.get(7)?,
                    kind: r
                        .get::<_, String>(8)
                        .ok()
                        .and_then(|k| VideoKind::parse(&k))
                        .unwrap_or_default(),
                    revision: r.get(9)?,
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
    let info = projects::with_reader(|c| {
        c.query_row(
            "SELECT w.run_id, j.state, json_extract(j.result,'$.code') FROM selection_windows w JOIN jobs j ON j.id=w.job_id WHERE w.job_id=?1",
            [job],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            },
        )
    });
    if let Ok((run, state, code)) = info {
        if state == "failed" && code.as_deref() == Some("provider_daily_limit") {
            let _ = projects::with_writer(|c| {
                c.execute(
                    "UPDATE jobs SET state='cancelled' WHERE state='queued' AND id IN (SELECT job_id FROM selection_windows WHERE run_id=?1 AND job_id IS NOT NULL)",
                    [run],
                )?;
                Ok(())
            });
        }
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
    scores: Vec<u8>,
    why: Vec<String>,
    title: String,
    adjust: Adjust,
}

/// Transforma as saídas validadas das Janelas concluídas nos candidatos finais.
fn build_candidates(
    kind: VideoKind,
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
            let mut scores = Vec::new();
            let mut why = Vec::new();
            for axis in kind.axes() {
                scores.push(
                    c[axis.key]["score"]
                        .as_u64()
                        .unwrap_or(0)
                        .min(u64::from(SCORE_MAX)) as u8,
                );
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
                        total_centi: total_centi(kind, &scores),
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
    let effective: Vec<Effective> = windows.iter().map(WindowRow::effective).collect();
    let outcomes: Vec<Outcome> = effective.iter().map(|e| e.outcome.clone()).collect();
    let completed = outcomes
        .iter()
        .filter(|o| matches!(o, Outcome::Done(_)))
        .count() as i64;
    let failed = outcomes
        .iter()
        .filter(|o| matches!(o, Outcome::Failed(_)))
        .count() as i64;
    if windows.iter().any(|w| w.outcome() == Outcome::Pending) {
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
    let (kept, tally) = build_candidates(row.kind, &frases, &range, &done);
    // Um refazer com perfil que concluiu abre uma nova revisão; o resto fecha na atual (#126).
    let redone = windows
        .iter()
        .zip(&effective)
        .any(|(w, e)| w.redo && e.redo_failed.is_none());
    let revision = row.revision + i64::from(redone);
    let profiles: Vec<&str> = effective.iter().map(|e| e.profile.as_str()).collect();
    let redo_failed: Vec<Value> = effective
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            e.redo_failed
                .as_ref()
                .map(|code| json!({"window": i, "code": code}))
        })
        .collect();
    let failures: Vec<Value> = outcomes
        .iter()
        .enumerate()
        .filter_map(|(i, o)| match o {
            Outcome::Failed(code) => Some(json!({"window": i, "code": code})),
            _ => None,
        })
        .collect();
    let summary = json!({
        "videoKind": row.kind.as_str(),
        "energy": energy_json(run_marks(&row)?.as_ref()),
        "chat": chat_json(run_chat(&row, &frases)?.as_ref()),
        "revision": revision,
        "redoFailed": redo_failed,
        "windows": {"total": total, "completed": completed, "failed": failures},
        "candidates": {
            "proposed": tally.proposed,
            "kept": kept.len(),
            "merged": tally.merged,
            "adjusted": tally.adjusted,
            "discarded": {"tooShort": tally.too_short, "tooLong": tally.too_long, "unknownId": tally.unknown_id},
        },
    });
    let chat_marks = run_chat(&row, &frases)?.unwrap_or_default();
    let state = if failed == 0 { "completed" } else { "partial" };
    let closed = projects::with_writer(|c| {
        let tx = c.transaction()?;
        let changed = tx.execute(
            "UPDATE selection_runs SET state=?2,windows_completed=?3,windows_failed=?4,candidates_kept=?5,discarded=?6,merged=?7,summary=?8,revision=?9 WHERE id=?1 AND state='running'",
            (
                run,
                state,
                completed,
                failed,
                kept.len() as i64,
                (tally.too_short + tally.too_long + tally.unknown_id) as i64,
                tally.merged as i64,
                summary.to_string(),
                revision,
            ),
        )?;
        if changed == 1 {
            // Só a revisão em fechamento é regravada: as anteriores (e as decisões do #55) ficam.
            tx.execute(
                "DELETE FROM selection_candidates WHERE run_id=?1 AND revision=?2",
                (run, revision),
            )?;
            tx.execute("UPDATE selection_windows SET redo=0 WHERE run_id=?1", [run])?;
            for (rank, (m, p)) in kept.iter().enumerate() {
                let axes: BTreeMap<&str, Value> = row
                    .kind
                    .axes()
                    .iter()
                    .enumerate()
                    .map(|(i, a)| (a.key, json!({"score": p.scores[i], "why": p.why[i]})))
                    .collect();
                let adjust = p.adjust.changed().then(|| {
                    json!({"extendedBefore": p.adjust.extended_before, "extendedAfter": p.adjust.extended_after, "trimmedEnd": p.adjust.trimmed_end}).to_string()
                });
                tx.execute(
                    "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust,chat_marks,revision,profile) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
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
                        {
                            let found = chat::candidate_marks(&chat_marks, &frases, p.start, p.end);
                            (!found.is_empty()).then(|| Value::Array(found).to_string())
                        },
                        revision,
                        m.windows
                            .iter()
                            .min()
                            .and_then(|w| profiles.get(*w))
                            .copied()
                            .unwrap_or(""),
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

/// As marcas de chat que esta execução usou (mesma regra da energia: decididas no início). A
/// série é gravada por Fonte e não muda quando a execução refaz uma Janela.
fn run_chat(row: &RunRow, frases: &[Sentence]) -> Result<Option<ChatMarks>, CoreError> {
    if !row.chat_marks {
        return Ok(None);
    }
    Ok(Some(
        chat::load_marks(row.transcript, frases)?.unwrap_or_default(),
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
    let marks = Marks {
        energy: run_marks(&row)?.unwrap_or_default(),
        chat: run_chat(&row, &frases)?.unwrap_or_default(),
    };
    let mut out = Vec::new();
    for w in &windows {
        let selected = wanted.as_ref().is_none_or(|ids| ids.contains(&w.idx));
        if !selected {
            continue;
        }
        match w.effective().outcome {
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
///
/// Com `profileId` (#126, "refazer com o forte"): refaz as `windows` pedidas, mesmo concluídas,
/// com esse Perfil de Provedor só desta vez. Veja [`redo_with_profile`].
fn cmd_redo(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let run = v["run"]
        .as_i64()
        .ok_or_else(|| error("run_not_found", "Execução de seleção não encontrada."))?;
    if let Some(profile) = explicit_profile(&v)? {
        return redo_with_profile(run, &profile, &v);
    }
    let (profile, safety) = route_safety()?;
    let inputs = redo_inputs(run, &v)?;
    if matches!(safety, Safety::Paid) && v["confirmed"] != true {
        let list: Vec<TaskInput> = inputs.iter().map(|i| i.1.clone()).collect();
        let kind = read_run(run)?.kind;
        return Err(confirmation_required(estimate_inputs(kind, &list, safety)));
    }
    enqueue_windows(
        run,
        &inputs,
        &Dest {
            safety,
            profile: &profile,
            explicit: false,
        },
    )?;
    Ok(json!({"run": run, "windows": inputs.iter().map(|i| i.0).collect::<Vec<_>>()}))
}

/// O `profileId` pedido, se houver: um id curto, escolhido pelo usuário. Nunca vem do padrão.
fn explicit_profile(v: &Value) -> Result<Option<String>, CoreError> {
    match v.get("profileId") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(id)) if !id.is_empty() && id.len() <= 64 => Ok(Some(id.clone())),
        _ => Err(error("invalid_profile", "Escolha um Perfil de Provedor.")),
    }
}

/// Janelas e entradas de um refazer com perfil, depois de todas as recusas que não precisam de
/// rede: Janela inexistente, ocupada ou com job `uncertain` (indisponível, ADR-0010 regra 4) e o
/// veto "somente local" da rota (por tarefa e por Projeto). A entrada é a do próprio job da
/// Janela, então o outro perfil responde à mesma pergunta.
fn profile_redo_plan(
    run: i64,
    profile: &str,
    v: &Value,
) -> Result<(jobs::redo::Route, Vec<(i64, TaskInput)>), CoreError> {
    read_run(run)?;
    let wanted: Vec<i64> = v["windows"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    if wanted.is_empty() {
        return Err(error(
            "windows_required",
            "Escolha a(s) Janela(s) da seleção a refazer.",
        ));
    }
    let windows = read_windows(run)?;
    let mut inputs = Vec::new();
    for idx in &wanted {
        let w = windows
            .iter()
            .find(|w| w.idx == *idx)
            .ok_or_else(|| error("window_not_found", "Janela da seleção não encontrada."))?;
        let job = w.job_id.ok_or_else(|| {
            error(
                "window_not_redoable",
                "Esta Janela ainda não foi enviada a nenhum Provedor.",
            )
        })?;
        let source = jobs::redo::source(job).map_err(|e| match e.code.as_str() {
            "job_uncertain" => error(
                "window_uncertain",
                "A chamada desta Janela tem resultado incerto: resolva a incerteza antes de refazer com outro perfil.",
            ),
            "job_not_redoable" => error(
                "window_not_redoable",
                "Só uma Janela concluída, que falhou ou foi cancelada pode ser refeita.",
            ),
            _ => e,
        })?;
        inputs.push((*idx, source.input));
    }
    let route = jobs::redo::route(TASK_ID, profile)?;
    Ok((route, inputs))
}

/// O que a confirmação mostra: perfil, custo estimado e se o texto sai da máquina.
fn profile_redo_preview(run: i64, profile: &str, v: &Value) -> CommandResult {
    let (route, inputs) = profile_redo_plan(run, profile, v)?;
    let list: Vec<TaskInput> = inputs.iter().map(|i| i.1.clone()).collect();
    let estimate = jobs::redo::estimate_inputs(TASK_ID, &list, route.safety, Some(profile));
    let mut preview = jobs::redo::preview(&route, estimate);
    preview["windows"] = json!(inputs.iter().map(|i| i.0).collect::<Vec<_>>());
    Ok(preview)
}

/// Refaz as Janelas com o perfil `profile`: enfileira cada uma de novo, no mesmo lote (o teto
/// do lote vale e pausa), grava o perfil na Janela e deixa o resultado entrar como uma nova
/// revisão da execução. Perfil pago pede confirmação antes de qualquer envio.
fn redo_with_profile(run: i64, profile: &str, v: &Value) -> CommandResult {
    let (route, inputs) = profile_redo_plan(run, profile, v)?;
    if route.paid() && v["confirmed"] != true {
        let list: Vec<TaskInput> = inputs.iter().map(|i| i.1.clone()).collect();
        let estimate = jobs::redo::estimate_inputs(TASK_ID, &list, route.safety, Some(profile));
        return Err(jobs::redo::confirmation_required(jobs::redo::preview(
            &route, estimate,
        )));
    }
    let id = route.profile["id"].as_str().unwrap_or(profile).to_owned();
    enqueue_windows(
        run,
        &inputs,
        &Dest {
            safety: route.safety,
            profile: &id,
            explicit: true,
        },
    )?;
    Ok(json!({
        "run": run,
        "windows": inputs.iter().map(|i| i.0).collect::<Vec<_>>(),
        "profile": route.profile,
    }))
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

fn run_json(run: i64, revision: Option<i64>) -> Result<Value, CoreError> {
    let (head, batch) = projects::with_reader(|c| {
        c.query_row(
            "SELECT id,transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,windows_completed,windows_failed,candidates_kept,discarded,merged,summary,created_at,batch,video_kind,revision FROM selection_runs WHERE id=?1",
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
                        "videoKind": r.get::<_, String>(19)?,
                        "revision": r.get::<_, i64>(20)?,
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
            json!({"index": w.idx, "firstId": w.first_id, "lastId": w.last_id, "startUs": w.start_us, "endUs": w.end_us, "jobId": w.job_id, "state": w.state(), "code": code, "resetAtMs": w.reset_at_ms(), "profile": w.effective().profile, "redoFailed": w.effective().redo_failed})
        })
        .collect();
    let candidates = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust,chat_marks,revision,profile FROM selection_candidates WHERE run_id=?1 AND revision=COALESCE(?2,(SELECT revision FROM selection_runs WHERE id=?1)) ORDER BY rank",
        )?;
        let rows = q.query_map((run, revision), |r| {
            let axes: String = r.get(6)?;
            let origin: String = r.get(9)?;
            let adjust: Option<String> = r.get(10)?;
            let chat: Option<String> = r.get(11)?;
            let centi: i64 = r.get(7)?;
            Ok(json!({
                "id": r.get::<_, i64>(0)?, "rank": r.get::<_, i64>(1)?,
                "startId": r.get::<_, i64>(2)?, "endId": r.get::<_, i64>(3)?,
                "startUs": r.get::<_, i64>(4)?, "endUs": r.get::<_, i64>(5)?,
                "axes": serde_json::from_str::<Value>(&axes).unwrap_or(Value::Null),
                "total": centi as f64 / 100.0, "totalCenti": centi,
                "title": r.get::<_, String>(8)?,
                "windows": serde_json::from_str::<Value>(&origin).unwrap_or(Value::Null),
                "chat": chat.and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or_else(|| json!([])),
                "revision": r.get::<_, i64>(12)?, "profile": r.get::<_, String>(13)?,
                "adjusted": adjust.is_some(),
                "adjust": adjust.and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null),
            }))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    let mut head = head;
    head["budgetPause"] = json!(pause);
    // RevisÃµes com candidatos guardados: a atual e as anteriores (cada refazer com perfil abre uma).
    let revisions: Vec<i64> = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT revision FROM selection_candidates WHERE run_id=?1 UNION SELECT revision FROM selection_runs WHERE id=?1 ORDER BY 1",
        )?;
        let rows = q.query_map([run], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    head["revisions"] = json!(revisions);
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
    run_json(run, v["revision"].as_i64())
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
            .map(|id| run_json(id, None).map(|v| v["run"].clone()))
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
