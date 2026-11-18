# Candidatos de aprofundamento de módulos (Fase codebase)

> **Mandato:** Aplicar `codebase-design` sobre Complexidade comprovada em callers reais, reduzir o que os callers precisam saber e testar pela interface pública, priorizando compatibilidade com Projetos V1 e comandos existentes (`Refs #288`).
> **Já concluídos (fora desta lista):** `#417`/`#419` (`paraErroCore` único em `front-v2/src/core/cliente.ts`) e `#292`/`#403` (`selection::effective_video_kind` única no núcleo).

---

## Método e vocabulário (`codebase-design`)

A varredura cobriu as três camadas do repositório (`core/src/**`, `src-tauri/src/**` + `src/lib/core.ts` e `front-v2/src/**`) aplicando os conceitos abaixo sem traduções soltas:

- **Module**: qualquer unidade com uma **Interface** e uma **Implementation** (função, módulo Rust, pacote TS ou fatia entre camadas).
- **Interface**: tudo o que um caller precisa saber para usar o **Module** corretamente — assinatura de tipos, invariantes, restrições de ordem, modos de erro, configuração exigida e efeitos de estado.
- **Depth** e **Leverage**: um **Module** profundo concentra lógica complexa atrás de uma **Interface** pequena; cada melhoria paga retorno sobre $N$ callers e $M$ testes.
- **Locality**: concentrar regras, correções e invariantes em um ponto único evita que mudanças vazeem para $N$ arquivos.
- **Seam** e **Adapter**: **Seam** é o local onde a **Interface** do **Module** vive e permite variar comportamento sem editar o caller. Só propomos **Seam** polimórfica quando existem **ao menos dois Adapters reais** (ex.: produção + teste em memória/fake; Tauri IPC + mock TS). Para dependências *in-process* ou *local-substitutable* (SQLite temporário), o aprofundamento consolida a implementação atrás da própria **Interface** do **Module**, sem port artificial (*one adapter = hypothetical seam*).
- **Deletion test**: imaginamos apagar o **Module** (ou o helper candidato). Se a complexidade desaparece, era apenas *pass-through* raso; se reaparece duplicada em $N$ callers, o **Module** ganha seu lugar pela **Depth**.
- **Testes pela Interface pública (*replace, don't layer*)**: os testes novos cruzam a mesma **Seam** que os callers reais (`clipes_core::dispatch`, `chamar`, `criarFila`, render de componente), substituindo testes fragmentados de helpers internos.

---

## Tabela-resumo (ordenada por Leverage ÷ Risco)

| Ordem | Candidato | Camada / Módulo | Callers reais | Risco V1 / comandos | Estimativa | Colisão com Ondas 4–6 | Leverage ÷ Risco |
| :-: | :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **1** | **Pré-vôo, estimativa, confirmação paga e leitura de resultado de Tarefas de IA** | `core/src/jobs/ai.rs` + `ai_task.rs` | 7 módulos (18+ pontos) | Baixo | **M** | Nenhuma (`core/` intacto) | **Muito alto** (elimina 7× `route_safety`, 4× `estimate_of`, 6× `confirmation_required`, 3× `job_code`) |
| **2** | **Contexto único de Corte aprovado e vínculo `clip_edits`** | `core/src/selection/review.rs` + `editor/edits.rs` | 14 módulos (20+ pontos) | Baixo–Médio | **M** | Nenhuma (`core/` intacto) | **Alto** (tira `dispatch("selection.review")` de `export*` e unifica `candidate:{id}` + `VideoKind`) |
| **3** | **Sessão de Projeto aberta e guarda tipada** | `core/src/projects/backups.rs` + `projects.rs` | 13 módulos (16 pontos) | Baixo | **P** | Nenhuma (`core/` intacto) | **Alto** (elimina 16× `dispatch("projects.current")` intra-Rust e uniformiza `project_not_open` / `invalid_project`) |
| **4** | **`origemEtapa` e ciclo de invalidação de jobs na `Fila`** | `front-v2/src/core/progresso.ts` + `stores/` | 2 stores atuais (+6 planejados) | Baixo | **P–M** | **Alta — Onda 6** (`progresso.ts`, `filaGlobal.ts`, `exportacaoProjeto.ts`) e **Onda 5** | **Alto** (acaba com `ultimaEtapaPorJob` e sniffing de `evento.message` em `fontesProjeto.ts`) |
| **5** | **Adaptador de erro do Projeto (`BannerErroProjeto`)** | `front-v2/src/core/erros.ts` + `componentes/` | 38 pontos em 24 arquivos | Baixo | **M** | **Média — Ondas 4–6** (`erros.ts` e telas novas de `corte/`, `fila/`, `exportacao/`) | **Médio–Alto** (centraliza `{ code, message }`, `mensagemDeErro` e `recuperacao.rota`/`acao`) |
| **6** | **Destino/privacidade de Provedor e fluxo `confirmation_required` cross-tier** | `core` (`*.estimate`) + `src/lib/core.ts` + `front-v2` | 5 arquivos (`selecaoProjeto.ts` + 4 telas) + Ondas 5–6 | Médio | **M** | **Alta — Ondas 5–6** (`src/lib/core.ts`, `*Mock.ts`, `TransformarCorte`, `PainelFilaJobs`) | **Médio** (remove `KINDS_CLI` / `HOSTS_LOOPBACK` e 7 RPCs paralelos em `ConfiguradorSelecao.tsx`) |

---

## Candidato 1 — Pré-vôo, estimativa, confirmação paga e resultado de Tarefas de IA (`core/src/jobs/ai.rs`)

### Callers reais (7 módulos, 18+ pontos)

1. `core/src/angles.rs`: `route` (`L247-254`), `estimate` (`L256-278`), `cmd_generate` confirmação paga (`L292-299`), `document` reutilizando `packaging::job_code` / `violation_codes` (`L322`).
2. `core/src/packaging.rs`: `route_safety` (`L538-545`), `estimate_of` (`L547-565`), `cmd_generate` confirmação paga (`L610-618`), `job_code` / `violation_codes` (`L787-813`).
3. `core/src/thumbnail.rs`: `route_safety` (`L200-207`), `estimate_of` (`L209-227`), `cmd_suggest` confirmação paga (`L249-257`), cópia exata de `job_code` / `violation_codes` (`L323-349`).
4. `core/src/script.rs`: `route_safety` (`L691-698`), `estimate_of` (`L700-724`), `confirmation_required` (`L773-780`) usada em `cmd_generate` (`L833-841`) e `cmd_regenerate` (`L1466-1472`).
5. `core/src/selection.rs`: `route_safety` (`L438-445`), `confirmation_required` (`L542-549`) usada em `cmd_start` (`L667`), `ensure_uncertain_handled` (`L1359`) e `resume_run` (`L1393`), além de delegar `estimate_inputs` (`L516`) para `jobs::redo::estimate_inputs`.
6. `core/src/translation.rs`: `route_safety` (`L558-565`), `cmd_start` confirmação paga (`L1225-1233`), delegando `estimate_batches` (`L1178`) para `jobs::redo::estimate_inputs`.
7. `core/src/jobs/redo.rs`: `route` (`L81-92`), `estimate_inputs` (`L96-141`), `confirmation_required` (`L156-162`).

### O que cada caller hoje precisa saber (Interface rasa)

Cada módulo de feature precisa conhecer toda a mecânica interna de roteamento e orçamento de `ai_task`, `provider` e `jobs`:
- Invocar `provider::routed(Some(task), profile)` e fazer `match` manual em `Routed::Cli` vs `Routed::Api { profile, local }` para converter em `(profile_id, Safety)`.
- Buscar `ai_task::find(task)`, validar com `ai_task::check_definition(def)`, chamar `jobs::route_of_profile(task, paid, profile)`, normalizar o prompt com `ai_task::normalized_prompt`, construir `provider::StructuredRequest` com `max_output_tokens`, chamar `provider::cost::estimate_for` e fabricar o JSON fallback `{"kind":"unknown","minMicroUsd":null,"maxMicroUsd":null}`.
- Reimplementar o portão `matches!(safety, Safety::Paid) && v["confirmed"] != true` e construir `CoreError { code: "confirmation_required", usage: Some(json!({"estimate": ...})), .. }`.
- Reimplementar (ou importar de `packaging.rs`) a sanitização `job_code` / `violation_codes` sobre `jobs.result` para impedir vazamento de texto livre do modelo (ADR-0006).

### Deletion test

Se apagássemos o protocolo de pré-vôo central, mais de 250 linhas de código de roteamento, estimativa, confirmação e sanitização reapareceriam (e já estão duplicadas) em 7 módulos distintos. Ao contrário, apagar as cópias locais (`route_safety`, `estimate_of`, `confirmation_required`, `job_code`) após aprofundar `jobs::ai` reduz 40–60 linhas por módulo de feature sem perda de capacidade.

### Interface proposta (antes / depois)

**Antes (exemplo típico em `angles.rs:247-313`, `packaging.rs:538-643`, `thumbnail.rs:200-282`):**

```rust
let (profile, safety) = route_safety()?; // duplicado 7x
let input = build_input(...);
if matches!(safety, Safety::Paid) && v["confirmed"] != true {
    return Err(CoreError {
        code: "confirmation_required".into(),
        message: "...".into(),
        usage: Some(json!({ "estimate": estimate_of(&input, safety) })),
    });
}
let job = jobs::enqueue_ai_in_batch(TASK_ID, &input, safety, Some(&batch))?;
```

**Depois (em `core/src/jobs/ai.rs`, reexportado em `jobs`):**

```rust
pub struct AiRoute {
    pub profile: ProfileSummary, // { id, label, kind, model }
    pub safety: Safety,
}

pub struct EnqueueAiRequest<'a> {
    pub task_id: &'a str,
    pub profile_id: Option<&'a str>,
    pub batch: Option<&'a str>,
    pub inputs: &'a [TaskInput],
    pub confirmed: bool,
    pub confirmation_message: &'a str,
}

pub struct JobOutcomeCodes {
    pub code: Option<String>,
    pub violations: Vec<String>,
}

/// Resolve rota já aplicando os dois vetos "somente local" (tarefa + Projeto).
pub fn resolve_route(task_id: &str, profile_id: Option<&str>) -> Result<AiRoute, CoreError>;

/// Estima 1..N unidades para a tarefa e rota informadas; custo desconhecido nunca vira zero.
pub fn estimate_units(
    task_id: &str,
    inputs: &[TaskInput],
    safety: Safety,
    profile_id: Option<&str>,
) -> Value;

/// Garante confirmação paga (calculando a estimativa apenas se necessário) e enfileira todas as unidades.
pub fn enqueue_checked(req: EnqueueAiRequest<'_>) -> Result<(AiRoute, Vec<i64>), CoreError>;

/// Extrai `code` e `violations[].code` de `jobs.result` somente no formato identificador seguro (`[a-z0-9_]`).
pub fn outcome_codes(result: Option<&Value>) -> JobOutcomeCodes;
```

- **Invariantes:**
  1. `resolve_route` aplica `local_only_violation` (por Tarefa e por Projeto) antes de qualquer estimativa ou rede.
  2. `enqueue_checked` só calcula `estimate_units` se `safety == Safety::Paid && !req.confirmed`, evitando trabalho inútil no caminho confirmado ou local.
  3. Se `req.inputs.len() > 1`, valida e resolve a rota uma única vez e enfileira todas as unidades na mesma `Safety`/`batch`.
  4. `outcome_codes` nunca devolve texto livre do modelo nem caminhos locais (ADR-0006).
- **Modos de erro:** `local_only_violation`, `profile_unavailable`, `invalid_settings`, `confirmation_required` (com `usage.estimate` idêntico ao contrato atual; `jobs.redo` pode acoplar `profile`/`leavesMachine` sem quebrar V1), `project_not_open` / `project_write`.

### Seam e Adapters

- **Seam:** A interface pública do executor de IA fica na **Seam** entre os módulos de domínio (`angles`, `packaging`, `thumbnail`, `script`, `selection`, `translation`, `jobs::redo`) e `jobs::ai`.
- **Adapters reais:** O transporte `dyn Provider` já possui **2 Adapters reais** nesta camada: `Configured` (HTTP Anthropic/OpenAI/Gemini/Ollama e CLIs Codex/Claude/OpenCode em `core/src/provider*.rs`) em produção, e o provedor falso/harness injetado por `jobs::set_ai_provider` em testes e benchmarks (`selection/benchmark.rs`). Persistência é *local-substitutable* (SQLite temporário do Projeto).

### Como testar pela Interface pública

- Exercitar via `clipes_core::dispatch` (`angles.estimate`/`generate`, `packaging.estimate`/`generate`, `thumbnail.estimate`/`suggest`, `script.estimate`/`generate`/`regenerate`, `selection.estimate`/`start`, `translation.estimate`/`start`, `jobs.redo.estimate`/`redo`) com Projeto temporário e `jobs::set_ai_provider`:
  - rota bloqueada por `Somente local` falha antes de pedir confirmação ou abrir rede;
  - provedor pago sem `confirmed: true` retorna `confirmation_required` com `usage.estimate`;
  - provedor local executa com `confirmed: false`;
  - job com `invalid_json` ou violações sanitiza `code`/`violations` em `*.get`.
- **Replace, don't layer:** remover eventuais testes unitários redundantes de helpers locais que apenas testavam `job_code` ou `route_safety`.

### Risco para Projetos V1 e comandos existentes · Estimativa · Colisão

- **Risco:** **Baixo.** Mantém exatamente os mesmos nomes de comandos, campos JSON de resposta e códigos de erro; nenhuma tabela SQLite muda.
- **Estimativa:** **M**.
- **Colisão com Ondas 4–6:** **Nenhuma** (Ondas 4–6 não alteram `core/src/`).

---

## Candidato 2 — Contexto único de Corte aprovado e vínculo `clip_edits` (`core/src/selection/review.rs` + `editor/edits.rs`)

### Callers reais (14 módulos, 20+ pontos)

1. **`approved_cut` + `candidate_arg` + checagem de `effective_video_kind` / `source_id`:**
   - `core/src/angles.rs:172-194` (`candidate_arg` + `approved_cut` + `effective_video_kind` → `script_requires_transformed`)
   - `core/src/script.rs:335-362, 1132-1140` (`candidate_arg` + `approved_cut` + `effective_video_kind`)
   - `core/src/packaging.rs:486-504, 567-571` (`candidate_arg` + `approved_cut` + query manual `SELECT source_id FROM transcripts`)
   - `core/src/thumbnail.rs:156-182` (`candidate_arg` + `approved_cut` + query manual `SELECT source_id FROM transcripts`)
   - `core/src/tts/narration.rs:184-191, 268, 349, 413, 496, 652, 841` (`candidate_arg` + `approved_cut` + `effective_video_kind`)
   - `core/src/narration_align.rs:817, 1147, 1321-1331, 1381` (`approved_cut` + `effective_video_kind` + `SELECT identity FROM clip_edits` em `L1219`)
   - `core/src/narration_cleanup.rs:896, 913` (`candidate_arg` + `approved_cut`)
   - `core/src/narration_record.rs:576, 734` (`candidate_arg` + `approved_cut`)
   - `core/src/narration_import.rs:285, 630` (`approved_cut`)
   - `core/src/montage.rs:386` (`approved_cut`)
   - `core/src/packaging/chapters.rs:183-221` (`approved_cut` + `effective_video_kind` + `SELECT id FROM clip_edits WHERE identity=?1`)
2. **Lookup manual de `clip_edits` por `"candidate:{id}"` e reentrada via `dispatch("selection.review")`:**
   - `core/src/export.rs:215-280` (`resolve_clip_id` com `"SELECT id FROM clip_edits WHERE identity=?1"` e `crate::dispatch("selection.review", ...)`)
   - `core/src/export/batch.rs:238-274` (`crate::dispatch("selection.review", ...)` e `"SELECT id FROM clip_edits WHERE identity=?1"`)
   - `core/src/guardrails.rs:77-91, 131, 152, 205` (`resolve_candidate_clip_id`, `approved_cut`, `effective_video_kind`)
   - `core/src/editor/edits.rs:475-491, 1414` (único dono legítimo da chave `"candidate:{id}"`, mas a string vazou para 5 outros módulos).

### O que cada caller hoje precisa saber (Interface rasa)

- O nome exato do campo JSON (`"candidate"` vs `"candidate_id"`) para extrair o `i64`.
- Que `selection::approved_cut` devolve `transcript`, mas **não** devolve `source_id` nem `video_kind`, obrigando o caller a abrir um segundo `projects::with_reader` para ler `transcripts.source_id` e `selection::effective_video_kind`.
- Que `selection::approved_cut` hoje emite a mensagem hardcoded `"Aprove o candidato antes de gerar o empacotamento."` (`review.rs:334`) mesmo quando chamada por Roteiro, Capa ou Narração.
- O formato interno de chave `"candidate:{id}"` da tabela `clip_edits` (5 módulos executam SQL direto em `clip_edits` em vez de perguntar a `editor::edits`), além de `export.rs` e `export/batch.rs` invocarem `crate::dispatch("selection.review", ...)` via JSON dentro do próprio núcleo.

### Deletion test

Se removêssemos `approved_cut` sem substituí-lo por um contexto mais rico, cada um dos 14 módulos teria de recompor `candidate_run` + `snapshot` + validação `status == "approved"` + slice de `sentences` + `source_id` + `video_kind`. Aprofundar `ApprovedCut` + `editor::edits::clip_id_for_candidate` elimina a reentrada JSON e todas as queries avulsas a `clip_edits` e `transcripts`.

### Interface proposta (antes / depois)

**Antes (ex.: `packaging.rs:486-504` + `angles.rs:178-194` + `export.rs:215-280`):**

```rust
let cut = crate::selection::approved_cut(candidate_arg(&v)?)?;
let source: i64 = projects::with_reader(|c| {
    c.query_row("SELECT source_id FROM transcripts WHERE id=?1", [cut.transcript], |r| r.get(0))
})?;
let is_transformed = projects::with_reader(|c| crate::selection::effective_video_kind(c, cut.candidate))?
    == Some(VideoKind::Transformed);
// e em export/batch/guardrails/chapters:
let clip_id: Option<i64> = projects::with_reader(|c| {
    c.query_row("SELECT id FROM clip_edits WHERE identity=?1", [format!("candidate:{cid}")], |r| r.get(0)).optional()
})?;
```

**Depois:**

```rust
// Em core/src/selection/review.rs (reexportado em selection):
pub(crate) struct ApprovedCut {
    pub candidate: i64,
    pub run: i64,
    pub source_id: i64,
    pub transcript: i64,
    pub video_kind: VideoKind,
    pub identity: (i64, i64),
    pub sentences: Vec<Sentence>,
}

pub(crate) fn candidate_id_arg(v: &Value, key: &str) -> Result<i64, CoreError>;
pub(crate) fn approved_cut(id: i64) -> Result<ApprovedCut, CoreError>;
pub(crate) fn approved_transformed_cut(id: i64, err_msg: &str) -> Result<ApprovedCut, CoreError>;
pub(crate) fn approved_borders_for_run(run: i64) -> Result<HashMap<i64, (i64, i64)>, CoreError>;

// Em core/src/editor/edits.rs:
pub(crate) fn clip_id_for_candidate(candidate_id: i64) -> Result<Option<i64>, CoreError>;
pub(crate) fn candidate_id_for_clip(clip_id: i64) -> Result<Option<i64>, CoreError>;
```

- **Invariantes:**
  1. `approved_cut` carrega `source_id` e `video_kind` (já resolvido por `effective_video_kind` dentro da mesma leitura) e mensagem neutra `"Aprove o candidato antes de continuar."`.
  2. `approved_transformed_cut` garante em uma única chamada que o candidato está aprovado e é `VideoKind::Transformed` (incluindo candidatos diretos convertidos via `#403`).
  3. Toda leitura/escrita da chave `candidate:{id}` em `clip_edits` passa exclusivamente por `editor::edits`.
  4. `export.rs` e `export/batch.rs` usam `approved_borders_for_run` / `approved_cut` em Rust tipado, sem `crate::dispatch("selection.review", ...)`.
- **Modos de erro:** `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `export_candidate` (preservado em `export.rs` ao mapear erros de revisão).

### Seam e Adapters

- Dependência **Local-substitutable** (SQLite do Projeto). A **Seam** externa fica nas funções tipadas de `selection` e `editor::edits`, sem port/adapter polimórfico artificial.

### Como testar pela Interface pública

- Testes de integração em `core/tests/` via `clipes_core::dispatch`:
  - `export.start`, `export.batch.plan` e `guardrails.check` em Projeto V1 com candidato aprovado sem `clip_edits` e em candidato com `clip_edits` ajustado no editor;
  - `angles.get`, `script.get`, `narration_align.track.set` e `packaging.chapters` em candidato direto vs convertido para transformado (`#403`), validando `script_requires_transformed`, `not_approved` e `export_candidate`.

### Risco para Projetos V1 e comandos existentes · Estimativa · Colisão

- **Risco:** **Baixo–Médio.** Em `export.rs`, erros de `approved_cut` (`not_approved` / `candidate_not_found`) precisam continuar sendo mapeados para `export_candidate` quando o pedido vier de `export.start`/`export.batch.*`, preservando testes existentes.
- **Estimativa:** **M**.
- **Colisão com Ondas 4–6:** **Nenhuma.**

---

## Candidato 3 — Sessão de Projeto aberta e guarda tipada (`core/src/projects/backups.rs` + `projects.rs`)

### Callers reais (13 módulos, 16 pontos)

Chamam `crate::dispatch("projects.current", json!({}), &mut |_| {})` dentro do próprio Rust só para ler o `path` do Projeto aberto (e muitas vezes validar `v["project"]`):
- `core/src/sources.rs:31-35, 290-294, 650-658`
- `core/src/transcription.rs:681-691` (`project_job`)
- `core/src/url_import.rs:106-111`
- `core/src/export.rs:672-678`
- `core/src/export/batch.rs:587-592`
- `core/src/proxy.rs:188-194`
- `core/src/audio.rs:377`
- `core/src/editor/assets.rs:131-136`
- `core/src/tts/narration.rs:240`
- `core/src/source_batches.rs:414`
- `core/src/jobs/preview.rs:518`
- `core/src/media.rs:217`
- `core/src/editor/edits.rs:914`
- `core/src/projects.rs:153`

### O que cada caller hoje precisa saber (Interface rasa)

Cada comando precisa: (1) adquirir `projects::start_job()?` separadamente, (2) passar um sink dummy `&mut |_| {}` para `crate::dispatch("projects.current", ...)` atravessando o registro `inventory` inteiro para ler um campo que já está em `backups::state()`, (3) extrair `current["path"].as_str()`, e (4) decidir manualmente entre `invalid_project` e `project_not_open` ao comparar com `v["project"]`.

### Deletion test

Apagar a guarda central faz cada comando de mídia/exportação/transcrição repetir o ritual de 6–10 linhas de `dispatch("projects.current")` + comparação de string + erro ad hoc.

### Interface proposta (antes / depois)

**Antes (`transcription.rs:681-691`, repetido em `sources.rs:649-658` e `url_import.rs:106-110`):**

```rust
let job = projects::start_job()?;
let requested = v["project"].as_str().ok_or_else(|| error("invalid_project", "Projeto obrigatório"))?;
let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
if current["path"].as_str() != Some(requested) {
    return Err(error("invalid_project", "O Projeto não está aberto"));
}
```

**Depois (em `core/src/projects/backups.rs`, reexportado por `projects`):**

```rust
/// Caminho do Projeto aberto, se houver sessão ativa (sem reentrar no dispatcher JSON).
pub fn current_path() -> Option<PathBuf>;

/// Caminho do Projeto aberto ou `CoreError` (`invalid_project` ou `project_not_open`).
pub fn require_open_path() -> Result<PathBuf, CoreError>;

/// Adquire `ProjectJob` e garante que o Projeto está aberto e (quando `expected` é `Some`)
/// coincide com o parâmetro recebido; se `require_arg` for true e `expected` for `None`, falha com `invalid_project`.
pub fn start_job_for(expected: Option<&str>, require_arg: bool) -> Result<(ProjectJob, PathBuf), CoreError>;
```

- **Invariantes:** Lido diretamente sob o mesmo `Mutex<Option<Session>>` que `start_job()`, sem janela de corrida entre verificar o caminho aberto e incrementar `s.jobs += 1`; nenhum comando reentra no dispatcher `inventory` para consultar a própria sessão.
- **Modos de erro:** `project_not_open` (quando chamado sem `expected` e nenhum Projeto está aberto, mantendo comportamento de `projects::with_reader` / `start_job`), `invalid_project` (quando `expected` diverge ou falta quando obrigatório), `project_busy` (mutex indisponível).

### Seam e Adapters

- Dependência **Local-substitutable / In-process** (`Session` em `projects/backups.rs`). Não há port polimórfico artificial; a interface pública testada é a dos comandos via `clipes_core::dispatch`.

### Como testar pela Interface pública

- Chamar via `clipes_core::dispatch` os comandos `sources.add`, `sources.delete`, `transcription.start`, `url_import.download`, `export.start`, `export.batch.start`, `proxy.ensure` nos cenários: (1) nenhum Projeto aberto, (2) `project` diferente do aberto, (3) `project` omitido quando obrigatório, (4) Projeto aberto válido — validando códigos de erro exatos e fechamento (`projects.close`) logo após o comando.

### Risco para Projetos V1 e comandos existentes · Estimativa · Colisão

- **Risco:** **Baixo.** Atenção apenas para preservar o código exato esperado por cada comando existente (`invalid_project` vs `project_not_open`) quando `project` é obrigatório vs opcional.
- **Estimativa:** **P**.
- **Colisão com Ondas 4–6:** **Nenhuma.**

---

## Candidato 4 — `origemEtapa` e ciclo de invalidação de jobs na `Fila` (`front-v2/src/core/progresso.ts`)

### Callers reais (2 stores atuais + 6 stores planejados nas Ondas 4–6)

1. `front-v2/src/stores/fontesProjeto.ts`:
   - `aplicarEventoProgresso` (`L282-375`): quando `evento.stage === 'complete' || evento.stage === 'failed'`, faz heurística textual em `evento.message.toLowerCase()` (`includes('energia' | 'chat' | 'prévia' | 'preview' | 'onda')`, `L346-366`) porque `Job.etapa` perdeu a etapa original!
   - `sincronizarJobs` (`L377-399`) + `jobsVistos` (`L167`): refaz diff de `(estado, etapa, percentual)` e reconstrói `EventoProgresso` sintético a partir de `Job`.
   - `useFontesProjeto` (`L431-462`): wiring `useSyncExternalStore` + `definirProjeto` + `useFila`.
2. `front-v2/src/stores/selecaoProjeto.ts`:
   - `ultimaEtapaPorJob` (`L285`) + `assinaturaJobs` (`L284`) + `sincronizarJobs` (`L437-472`) + `registrarEventoProgresso` (`L474-497`): mantém um `Map<jobId, etapaAnterior>` só para lembrar se um job que terminou com `'complete'` / `'failed'` era originalmente `'energy'`, `'chat'` ou `'proxy'`.
   - `useSelecaoProjeto` (`L531-570`): wiring análogo de `useSyncExternalStore` + `definirProjeto` + `useFila`.
3. **Ondas 4–6** (`08-plano-onda-4.md`, `09-plano-onda-5.md`, `10-plano-onda-6.md`): adicionam `editorCorte.ts`, `transformarCorte.ts`, `empacotarCorte.ts`, `filaGlobal.ts`, `exportacaoProjeto.ts` e `atualizador.ts`, todas precisando detectar término/pausa de jobs (`proxy`, `timeline`, `reframe`, `ai:angles:*`, `ai:script:*`, `narration`, `aligning`, `export`, `export_batch`).

### O que cada caller hoje precisa saber (Interface rasa)

- Que `core-progress` sobrescreve `stage` com `'complete'` ou `'failed'` no fim do job, apagando qual subsistema produziu o evento.
- Que `Job` em `progresso.ts` não guarda a etapa inicial (`origemEtapa`), obrigando cada store a rastrear transições com `Map` próprio ou inspecionar palavras em português de `evento.message` (frágil a qualquer ajuste de texto no núcleo Rust!).
- Como comparar snapshots inteiros de `Job[]` para descobrir quais jobs mudaram desde o último render.

### Deletion test

Se removêssemos o rastreio de `ultimaEtapaPorJob` e a heurística de `message` das stores sem mover `origemEtapa` para `progresso.ts`, invalidações pós-conclusão de `energy`, `chat` e `proxy` quebrariam silenciosamente. Movendo isso para `progresso.ts`, cada store perde ~40–60 linhas de máquina de estados duplicada.

### Interface proposta (antes / depois)

**Antes (`front-v2/src/core/progresso.ts:17-32`):**

```ts
export type Job = {
  id: string
  etapa: string
  percentual: number
  mensagem: string
  estado: EstadoJob
  erro?: { code: string; message: string }
  inicioMs: number
  etaMs?: number
}
```

**Depois (aditivo em `front-v2/src/core/progresso.ts`):**

```ts
export type Job = {
  id: string
  etapa: string
  /** Primeira etapa não-terminal observada para o job (ex.: 'energy', 'proxy', 'ai:selection:...'). */
  origemEtapa: string
  percentual: number
  mensagem: string
  estado: EstadoJob
  erro?: { code: string; message: string }
  inicioMs: number
  etaMs?: number
}

export type TransicaoJob = { anterior?: Job; atual: Job }
export type Fila = {
  aplicar(e: EventoProgresso): void
  jobs(): Job[]
  assinar(fn: () => void): () => void
  assinarTransicoes(fn: (transicao: TransicaoJob) => void): () => void
}
```

- **Invariantes:**
  1. `origemEtapa` é fixada no primeiro evento não-terminal (`stage !== 'complete' && stage !== 'failed'`) e nunca sobrescrita por `complete`/`failed` nem por regressão de percentual.
  2. `assinarTransicoes` dispara sincronamente dentro de `aplicar()` apenas quando `(estado, etapa, percentual, erro)` mudam, sem obrigar stores a diffar arrays em `useEffect`.
- **Modos de erro:** inalterados (`iniciarProgresso` propaga falha de `listen` e `criarFila` ignora `job === '' | '0'` e eventos de outro Projeto).

### Seam e Adapters

- **Seam:** `iniciarProgresso` em `front-v2/src/core/progresso.ts:153` já fica na **Seam** com **2 Adapters reais**: `listen('core-progress')` do Tauri em produção e `assinarProgressoMock` de `src/lib/core.ts` no browser/Vitest (`VITE_CORE_MOCK=1`). `criarFila` é *in-process*.

### Como testar pela Interface pública

- Em `front-v2/src/core/progresso.test.ts`: testar `criarFila` + `assinarTransicoes` enviando sequência `{ stage: 'energy', percentage: 10 }` → `{ stage: 'complete', percentage: 100, message: 'Concluído' }` e verificando `job.origemEtapa === 'energy'`.
- Em `fontesProjeto.test.ts` e `selecaoProjeto.test.ts`: remover texto `"energia"`/`"prévia"` da mensagem de conclusão para provar que a invalidação depende só do contrato estruturado `origemEtapa`, não de string em `message`.

### Risco para Projetos V1 e comandos existentes · Estimativa · Colisão

- **Risco:** **Baixo** (campo aditivo em `Job`; compatível com todos os consumidores existentes de `useFila`).
- **Estimativa:** **P–M**.
- **Colisão com Ondas 4–6:** **Alta com a Onda 6** (`10-plano-onda-6.md` altera `front-v2/src/core/progresso.ts` para reconciliação inicial via `sincronizarExterno` e cria `filaGlobal.ts` / `exportacaoProjeto.ts`) e beneficia diretamente **Onda 5** (`transformarCorte.ts`, `empacotarCorte.ts`). Recomendado aplicar em conjunto com ou logo após a Onda 6.

---

## Candidato 5 — Adaptador de erro do Projeto (`BannerErroProjeto` sobre `erros.ts` + `@ds/BannerErroCore`)

### Callers reais (38 pontos em 24 arquivos de `front-v2/src/`)

Chamadas diretas a `<BannerErroCore>` e `mensagemDeErro` repetindo o mesmo mapeamento em `front-v2/src/`:
- `telas/cortes/ConfiguradorSelecao.tsx` (`L684-755`, `L941-945`)
- `telas/cortes/AcompanhamentoSelecao.tsx` (`L272-305`, `L957-960`)
- `telas/cortes/DetalheCandidato.tsx` (`L896-900`, `L943-951`)
- `telas/cortes/Selecao.tsx` (`L282-292`)
- `telas/fontes/ListaFontes.tsx` (`L598-625`)
- `telas/fontes/ListaLotes.tsx` (`L370-385`)
- `telas/fontes/ConstrutorLote.tsx` (`L351-395`)
- `telas/fontes/DetalheFonte.tsx` (`L333-360`, `L533-540`)
- `telas/fontes/EntradaFonte.tsx` (`L462-515`)
- `telas/fontes/Fontes.tsx` (`L190-270`)
- `telas/fontes/GavetaBuscaFts.tsx` (`L47-96`)
- `telas/fontes/LotesFontes.tsx` (`L97-110`)
- `telas/fontes/PainelMotorSinais.tsx` (`L539-575`)
- `telas/inicio/Inicio.tsx` (`L65-75`, `L311-320`) e `DialogoNovoProjeto.tsx` (`L134-146`)
- `telas/config/ConfigComponentes.tsx` (`L240`, `L649`), `ConfigExportacao.tsx` (`L65`, `L183`, `L218`), `ConfigCustos.tsx` (`L161`, `L710`, `L887`, `L1039`, `L1298`, `L1356`), `ConfigProvedores.tsx` (`L608`, `L640`), `FormPerfilProvedor.tsx` (`L58`, `L340`), `ConfigProjeto.tsx` (`L117`, `L559`, `L590`)
- `telas/assistente/PassoProvedor.tsx` (`L340`), `PassoEssencial.tsx` (`L109`, `L348`)
- `componentes/DialogoResolverIncerteza.tsx` (`L158-165`), `SeletorPerfilRedo.tsx` (`L256-263`), `InstaladorJustInTime.tsx` (`L614-620`)
- `shell/EstadoForcado.tsx` (`L115-140`)

### O que cada caller hoje precisa saber (Interface rasa)

Todo caller precisa: (1) converter `ErroCore` para `{ code: erro.code, message: erro.detalhe || erro.message }`, (2) chamar `mensagemDeErro(erro)` para construir `traduzir`, e (3) interpretar manualmente `recuperacao.rota` (`window.location.hash = ...`) e `recuperacao.acao` (`'abrir-fila' | 'confirmar' | 'refazer-outro-perfil' | 'ajustar-orcamento' | 'instalar-componente' | 'relocalizar-fonte' | 'aceitar-termos' | 'recarregar' | 'importar-local'`). Em várias telas (`ConfiguradorSelecao.tsx:698-741`, `AcompanhamentoSelecao.tsx:274-285`), o caller ainda re-escreve `if (erro.code === ...)` por fora de `TABELA_ERROS`.

### Deletion test

Se o adaptador central existir e for apagado, a cola `{ code, message: detalhe || message }`, `traduzir` e o dispatch de `recuperacao.rota` / `acao` reaparecem imediatamente nos 24 arquivos acima (mais as novas telas das Ondas 4–6).

### Interface proposta (antes / depois)

**Antes (repetido ~38 vezes):**

```tsx
const trad = mensagemDeErro(erro)
<BannerErroCore
  erro={{ code: erro.code, message: erro.detalhe || erro.message }}
  traduzir={() => ({ titulo: trad.titulo })}
  acaoRecuperacao={trad.recuperacao ? {
    rotulo: trad.recuperacao.rotulo,
    aoAcionar: () => { if (trad.recuperacao?.rota) window.location.hash = trad.recuperacao.rota },
  } : undefined}
  permitirRelato
/>
```

**Depois (`front-v2/src/componentes/BannerErroProjeto.tsx`):**

```tsx
export type HandlersRecuperacaoErro = Partial<Record<AcaoRecuperacao, () => void>> & {
  tentarNovamente?: () => void
}

export function BannerErroProjeto(props: {
  erro: ErroCore
  acoes?: HandlersRecuperacaoErro
  traduzirExtra?: (erro: ErroCore) => MensagemErro | null
  acaoSecundaria?: { rotulo: string; aoAcionar: () => void }
  permitirRelato?: boolean
  aoDispensar?: () => void
}): JSX.Element
```

- **Invariantes:** Sempre traduz via `mensagemDeErro` (com override pontual via `traduzirExtra`), resolve navegação de `recuperacao.rota` automaticamente (sem perder ações locais como `abrir-fila`, `confirmar`, `relocalizar-fonte`), e mantém `@ds/BannerErroCore` 100% agnóstico de rotas e `ErroCore`.
- **Modos de erro:** Códigos desconhecidos caem em `MENSAGEM_DESCONHECIDA` mantendo fallback opcional `tentarNovamente`.

### Seam e Adapters

- **Seam:** A **Seam** já existe no boundary do pacote `@ds` (`BannerErroCore` recebe props puras `erro`, `traduzir`, `acaoRecuperacao`). Os **2 Adapters reais** são `BannerErroProjeto` (domínio Clipes/rotas/stores de `front-v2`) e o próprio harness/componentes isolados do `@ds` (que usam `BannerErroCore` sem acoplamento às rotas do app).

### Como testar pela Interface pública

- Testes de componente em `BannerErroProjeto.test.tsx` exercitando `ErroCore` com `recuperacao.rota` (`window.location.hash` atualizado no clique), `recuperacao.acao` (`abrir-fila`, `confirmar`, etc. chamando o handler certo), `traduzirExtra` para códigos locais e `permitirRelato`.

### Risco para Projetos V1 e comandos existentes · Estimativa · Colisão

- **Risco:** **Baixo** (componente aditivo em `front-v2`, migração gradual tela a tela sem alterar `CoreError` nem `@ds`).
- **Estimativa:** **M**.
- **Colisão com Ondas 4–6:** **Média.** Se não editar `front-v2/src/core/erros.ts` (que recebe ~65 novos códigos nas Ondas 4–6), não trava `erros.ts`, mas as novas telas das Ondas 4–6 (`telas/corte/*`, `telas/fila/*`, `telas/exportacao/*`) já nascem chamando `<BannerErroCore>` direto — convém adotar após a estabilização das Ondas 4–6.

---

## Candidato 6 — Destino/privacidade de Provedor e confirmação cross-tier (`resolverDestinoSelecao` + `*.estimate`)

### Callers reais (5 arquivos atuais + telas de Transformar/Empacotar/Fila)

1. `front-v2/src/stores/selecaoProjeto.ts:148-232`: `resolverDestinoSelecao` embute `KINDS_CLI = new Set(['codex', 'claude', 'opencode'])`, `HOSTS_LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])`, parse de `URL` e checagem de `projectLocalOnly`.
2. `front-v2/src/telas/cortes/ConfiguradorSelecao.tsx`: dispara 7 `chamar` paralelos (`L350-362`, incluindo `provider.profiles.list` + `assistant.tasks`), chama `resolverDestinoSelecao` (`L509-513`) e gerencia `confirmation_required` (`L633-670`).
3. `front-v2/src/telas/cortes/AcompanhamentoSelecao.tsx`: busca `provider.profiles.list` + `assistant.tasks` (`L212-221`) e chama `resolverDestinoSelecao` (`L266-270`).
4. `front-v2/src/componentes/SeletorPerfilRedo.tsx`: busca `provider.profiles.list` + `assistant.tasks` (`L103-107`) e chama `resolverDestinoSelecao` (`L174-177`) mesmo já recebendo `profile` e `leavesMachine` de `selection.estimate` (Modo 3).
5. `front-v2/src/telas/fontes/ConstrutorLote.tsx`: busca `channel_profile.get` + `assistant.tasks` + `projects.local_only.get` + `transcription.groq.info` (`L210-215`) e reconstrói fallback de `ConfirmacaoLoteUsage` (`L281-297`) no `catch` de `confirmation_required`.

### O que cada caller hoje precisa saber (Interface rasa)

- Que `selection.estimate` (Modos 1 e 2), `angles.estimate`, `packaging.estimate`, `script.estimate`, `thumbnail.estimate` e `translation.estimate` devolvem apenas `profile: "<string>"` e `paid: boolean` (ao contrário de `jobs.redo.estimate` e `selection.estimate` Modo 3, que já devolvem `profile: { id, label, kind, model }` e `leavesMachine`).
- Que precisa buscar `provider.profiles.list` + `assistant.tasks` + `projects.local_only.get` por fora e replicar em TypeScript as regras de `provider::is_loopback_endpoint` e `provider_cli` para decidir `localidade`, `host` e `bloqueadoSomenteLocal` antes de mostrar `<ResumoCustoPrivacidade>`.

### Deletion test

Se apagarmos `resolverDestinoSelecao` hoje, 3 telas quebram porque o núcleo não devolve os dados ricos de destino nas estimativas de tarefa padrão; quando o núcleo passar a devolver `destination` de forma aditiva em `*.estimate` (usando `AiRoute` do Candidato 1), `KINDS_CLI`, `HOSTS_LOOPBACK` e as chamadas extras a `provider.profiles.list` desaparecem das 4 telas e não precisam ser repetidas nas telas de Onda 5–6.

### Interface proposta (antes / depois)

**Antes (resposta de `selection.estimate` Modo 1 em `core/src/selection.rs:596-611`):**

```json
{
  "paid": true,
  "profile": "openai-default",
  "estimate": { "kind": "usd", "minMicroUsd": 1200, "maxMicroUsd": 2400 }
}
```

**Depois (aditivo em `*.estimate` no núcleo e `src/lib/core.ts` + cliente TS `front-v2/src/core/provedorDestino.ts`):**

```json
{
  "paid": true,
  "profile": "openai-default",
  "destination": {
    "profile": { "id": "openai-default", "label": "OpenAI", "kind": "openai", "model": "gpt-4o-mini" },
    "locality": "remote",
    "leavesMachine": true,
    "host": "api.openai.com",
    "blockedByLocalOnly": false
  },
  "estimate": { "kind": "usd", "minMicroUsd": 1200, "maxMicroUsd": 2400 }
}
```

```ts
// front-v2/src/core/provedorDestino.ts
export function destinoDeEstimativa(resp: { destination?: DestinationDto; profile?: unknown; paid?: boolean }): DestinoProvedor | null
export async function executarComConfirmacao<T>(
  executar: (confirmed: boolean) => Promise<T>,
  aoPedirConfirmacao: (erro: ErroCore) => void,
): Promise<T | null>
```

- **Invariantes:** `profile` string original é preservada para compatibilidade total com callers V1; `destination` reflete a mesma avaliação de `local_only_violation` e loopback do núcleo (`core/src/provider.rs`), sem duplicar `HOSTS_LOOPBACK` no frontend.
- **Modos de erro:** `profile_unavailable`, `local_only_violation`, `confirmation_required` (repassado ao callback em `!confirmed`).

### Seam e Adapters

- **Seam:** A **Seam** existente `@core` (`coreDispatch` em `src/lib/core.ts`), onde operam **2 Adapters reais**: IPC Tauri (`invoke('core_dispatch')` → `clipes_core::dispatch`) em produção e o mock TS (`src/lib/core.ts`) no browser/Vitest.

### Como testar pela Interface pública

- Testes de contrato em `core/tests/` validando o campo `destination` em `selection.estimate`, `angles.estimate`, `packaging.estimate`, `script.estimate`, `thumbnail.estimate` e `translation.estimate` (local loopback, remoto HTTPS, CLI e veto `Somente local`), e testes equivalentes em `front-v2/src/core/*Mock.test.ts` + telas sem mock manual de `provider.profiles.list` quando `destination` já estiver presente.

### Risco para Projetos V1 e comandos existentes · Estimativa · Colisão

- **Risco:** **Médio** — exige manter `src/lib/core.ts` e `*Mock.ts` sincronizados com o campo `destination` e não quebrar callers que leem `profile` como string.
- **Estimativa:** **M**.
- **Colisão com Ondas 4–6:** **Alta.** Ondas 5 e 6 editam intensamente `src/lib/core.ts`, `src/lib/scriptMock.ts`, `src/lib/thumbnailMock.ts`, `src/lib/packagingMock.ts` e criam as novas telas de `TransformarCorte`, `EmpacotarCorte` e `PainelFilaJobs`. Deve ser agendado **após** o Candidato 1 e após a entrega das Ondas 5–6.

---

## Textos prontos de issue (2 primeiros candidatos)

### Issue 1

**Título:** `refactor(core): unificar pré-vôo, estimativa, confirmação paga e códigos de resultado de Tarefas de IA em jobs::ai`

#### Problema
Sete módulos do núcleo (`core/src/angles.rs`, `packaging.rs`, `thumbnail.rs`, `script.rs`, `selection.rs`, `translation.rs` e `jobs/redo.rs`) reimplementam manualmente o mesmo protocolo para preparar e ler Tarefas de IA:
- `route()` / `route_safety()` fazendo `match` em `provider::routed(Some(task), profile)` em 7 arquivos;
- `estimate()` / `estimate_of()` montando `StructuredRequest` via `ai_task::find` + `check_definition` + `jobs::route_of_profile` + `provider::cost::estimate_for` em 4 arquivos (enquanto `selection.rs` e `translation.rs` já delegam para `jobs::redo::estimate_inputs`);
- checagem manual de `Safety::Paid && v["confirmed"] != true` devolvendo `CoreError { code: "confirmation_required", usage: Some(json!({"estimate": ...})) }` em 6 arquivos;
- cópias de `job_code` e `violation_codes` entre `packaging.rs:787-813` e `thumbnail.rs:323-349` (com `angles.rs` importando de `packaging`).

Qualquer mudança na regra de orçamento, veto "somente local" ou formato de resultado precisa ser replicada em 7 pontos.

#### Mudança proposta
Aprofundar `core/src/jobs/ai.rs` (reexportado via `core/src/jobs.rs`) como ponto único de pré-vôo e leitura de resultado:
1. Expor `resolve_route(task_id, profile_id) -> Result<AiRoute, CoreError>` (já aplicando o veto "somente local" por tarefa e por Projeto).
2. Centralizar `estimate_units(task_id, inputs, safety, profile_id) -> Value` substituindo `jobs::redo::estimate_inputs` e os `estimate_of` locais.
3. Expor `enqueue_checked(EnqueueAiRequest)` validando confirmação paga (calculando a estimativa só quando `Paid && !confirmed`) e enfileirando as unidades no lote.
4. Expor `outcome_codes(Option<&Value>) -> JobOutcomeCodes` substituindo `packaging::job_code`/`violation_codes` e as cópias em `thumbnail.rs`.
5. Migrar os 7 módulos callers sem alterar nomes de comandos, schema SQLite ou payloads JSON de resposta/erro.

Não altera nada em `front-v2/` nem `src/lib/core.ts` (zero colisão com Ondas 4–6).

#### Critérios de aceite e testes de regressão
- [ ] Nenhuma cópia local de `route_safety`, `estimate_of`, `job_code` ou `violation_codes` resta em `angles.rs`, `packaging.rs`, `thumbnail.rs`, `script.rs`, `selection.rs`, `translation.rs` ou `jobs/redo.rs`.
- [ ] Testes de regressão via interface pública (`clipes_core::dispatch`) cobrindo `angles.*`, `packaging.*`, `thumbnail.*`, `script.*`, `selection.*`, `translation.*` e `jobs.redo*` com `jobs::set_ai_provider`:
  - `local_only_violation` bloqueia provedor remoto/CLI antes de pedir confirmação paga ou acionar rede;
  - provedor pago sem `confirmed: true` retorna `confirmation_required` com `usage.estimate`;
  - provedor local executa sem `confirmed: true`;
  - `*.get` após falha/violação devolve apenas códigos identificadores sanitizados (sem texto do modelo nem caminhos locais).
- [ ] Projetos V1 e testes existentes da suíte `cargo test` continuam passando sem regressão.

---

### Issue 2

**Título:** `refactor(core): unificar contexto de Corte aprovado e vínculo clip_edits em selection e editor::edits`

#### Problema
Catorze módulos do núcleo precisam resolver um candidato aprovado ou seu vínculo na tabela `clip_edits` e acabam conhecendo detalhes internos espalhados:
- `candidate_arg(v)` é duplicada em `angles.rs:172`, `packaging.rs:567`, `thumbnail.rs:178`, `script.rs:358`, `selection/review.rs:297`, `narration_cleanup.rs:896`, `narration_record.rs:734` e `tts/narration.rs:413`;
- `selection::approved_cut` emite a mensagem fixa `"Aprove o candidato antes de gerar o empacotamento."` (`review.rs:334`) para todos os callers e não traz `source_id` nem `video_kind`, forçando segundos round-trips ao SQLite (`packaging.rs:488`, `thumbnail.rs:160`, `angles.rs:180`, `script.rs:338`, `narration_align.rs:1323`, `packaging/chapters.rs:185`, `tts/narration.rs:184`);
- 5 módulos fora de `editor/edits.rs` (`export.rs:224`, `export/batch.rs:268`, `guardrails.rs:83,152`, `packaging/chapters.rs:216` e `narration_align.rs:1219`) fazem SQL direto com a chave `"candidate:{id}"` em `clip_edits`;
- `export.rs:279` e `export/batch.rs:238` reentram em `crate::dispatch("selection.review", ...)` dentro do próprio Rust para ler bordas aprovadas.

#### Mudança proposta
1. Enriquecer `selection::ApprovedCut` (`core/src/selection/review.rs`) com `source_id` e `video_kind` (já resolvido por `effective_video_kind`), neutralizar a mensagem de `not_approved`, e expor `candidate_id_arg`, `approved_transformed_cut` e `approved_borders_for_run`.
2. Centralizar o mapeamento bidirecional entre `candidate_id` e `clip_id` em `core/src/editor/edits.rs` (`clip_id_for_candidate` e `candidate_id_for_clip`), removendo todas as queries diretas com `"candidate:{id}"` dos outros módulos.
3. Substituir o `crate::dispatch("selection.review", ...)` de `export.rs` e `export/batch.rs` pelas funções tipadas de `selection` + `editor::edits`, preservando os códigos `export_candidate` e `export_bounds`.

Não altera nada em `front-v2/` nem `src/lib/core.ts` (zero colisão com Ondas 4–6).

#### Critérios de aceite e testes de regressão
- [ ] Nenhuma query direta `FROM clip_edits WHERE identity='candidate:...'` nem `crate::dispatch("selection.review", ...)` permanece fora de `editor/edits.rs` e `selection/`.
- [ ] Testes de regressão via `clipes_core::dispatch`:
  - `export.start`, `export.batch.plan` e `guardrails.check` em Projeto V1 com candidato aprovado sem `clip_edits` e com `clip_edits` ajustado no editor;
  - `angles.get`, `script.get`, `packaging.chapters` e `narration_align.track.set` em candidato `direct` vs convertido para `transformed` (`#403`), validando `not_approved`, `script_requires_transformed` e `export_candidate`;
  - remoção de Fonte (`sources.delete`) continua limpando corretamente os vínculos de `clip_edits`.
- [ ] Projetos V1 e testes existentes da suíte `cargo test` continuam passando sem regressão.
