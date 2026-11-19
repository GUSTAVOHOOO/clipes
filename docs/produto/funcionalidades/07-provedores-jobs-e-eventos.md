# Provedores de IA, Perfis de Provedor, Custo, Fila de Jobs e Eventos

## A jornada

Antes de pedir ao Clipes que escolha Cortes, sugira Empacotamento, escreva um Roteiro ou traduza legendas, o usuário precisa decidir quem vai processar esse texto e sob quais regras. Nesta área do app, ele cadastra um ou mais **Perfis de Provedor** (APIs remotas, modelos locais ou ferramentas de linha de comando por assinatura), guarda chaves de API com segurança no cofre do sistema operacional (**keyring**), dá consentimento antes de enviar texto para fora da máquina e define tetos de custo ou restrições de privacidade (**Somente local**).

Ao mesmo tempo, as operações demoradas do Clipes — transcrição, análise de áudio, proxies, geração de áudio de Narração, exportação de vídeo e todas as chamadas de **Tarefa de IA** — rodam em segundo plano como **jobs** (tarefas persistidas no arquivo SQLite do **Projeto** e executadas uma após a outra por uma fila). O usuário acompanha o andamento em tempo real pelos eventos de progresso, pode cancelar tarefas em andamento, decidir se repete ou descarta uma chamada paga cujo resultado ficou incerto, retomar uma fila pausada pelo orçamento ou refazer uma unidade de IA usando outro Perfil de Provedor.

---

## Conceitos do domínio

### 1. Provedor, Perfil de Provedor e Tarefa de IA (ADRs 0007, 0008 e 0010)

- **Provedor** é o backend de LLM que recebe **apenas texto** (nunca vídeo, áudio ou caminhos locais) e devolve JSON estruturado. O Clipes suporta três famílias:
  1. **Chave de API / HTTP remoto** (`openai`, `anthropic`, `gemini`, além de provedores compatíveis com OpenAI como OpenRouter, Groq e DeepSeek);
  2. **Modelo local** (`ollama`, ou endpoint `openai` apontando para endereço loopback como LM Studio e llama.cpp);
  3. **Assinatura via CLI** (`codex`, `claude`, `opencode`), executada como subprocesso isolado sem ferramentas.
- **Perfil de Provedor** (`core/src/provider.rs`) é uma configuração nomeada e salva em `provider.json`, com: `id`, `label`, `kind`, `endpoint`, `model`, `nativeSchema`, opção de chave própria (`ownKey`), limites opcionais (`context`, `maxOutput`, `timeoutSecs`, `tokensPerRequest`, `tokensPerMinute`, `tokensPerDay`).
  - **Compatibilidade v1 (`legacy`):** quando o usuário usa a forma antiga sem `profileId`, o núcleo grava os campos de nível raiz de `provider.json` e sintetiza na leitura o perfil `legacy` (`"Principal"`).
  - **Sem padrão de fábrica e sem fallback automático:** o mapa de rotas começa vazio. Se o perfil escolhido falhar, o núcleo devolve erro tipado e **nunca** troca para outro Provedor por conta própria. O usuário pode acionar manualmente **"refazer com o forte"** (`jobs.redo` / `selection.redo`), vendo antes o perfil, o custo estimado e se o texto sai da máquina.
- **Tarefa de IA** (`core/src/ai_task.rs`): cada trabalho de IA (`selection`, `selection_transformed`, `packaging`, `thumbnail`, `script`, `script_block`, `angles`, `translation`) é um workflow fixo em Rust (sem agente autônomo nem *tool calling*), com prompt versionado, `prompt_sha256`, **schema fio** mínimo enviado ao Provedor e **schema completo** + verificadores determinísticos validados localmente.
  - **Tarefa → Perfil:** o roteamento por tarefa (`assistant::route` em `core/src/assistant.rs`, com agrupamento via `ai_task::routing_id` onde `selection_transformed` usa `selection`, `thumbnail` usa `packaging`, e `script_block`/`angles` usam `script`) escolhe: perfil específico da tarefa → padrão global → CLI selecionado. Nem o **Projeto** nem o **Perfil de canal** escolhem Provedor.

### 2. Modo Somente local

- O veto **Somente local** proíbe envio de texto para fora da máquina, mas **nunca escolhe Provedor** (ADR-0010).
- Existe em duas camadas independentes que se somam por `OU` lógico:
  1. **Por tarefa** (`assistant.json`, gerenciado por `assistant.local_only.set`);
  2. **Por Projeto** (`project.sqlite`, tabela `project_privacy`, gerenciado por `projects.local_only.get` / `projects.local_only.set`, viajando com o Projeto portátil).
- **Regra de localidade:** local significa **apenas loopback** (`localhost`, `127.0.0.1`, `::1`). Servidor na rede local (LAN) e CLIs (`codex`, `claude`, `opencode`) **não** contam como locais. A localidade é calculada no momento da chamada (`is_loopback_endpoint` / `is_local_endpoint`), nunca gravada no perfil. Quando vetada, a chamada falha antes de qualquer acesso ao cofre ou à rede com `local_only_violation`.

### 3. Provedor via CLI (`codex`, `claude`, `opencode`)

- Implementado em `core/src/provider_cli.rs` e `core/src/provider_cli/opencode.rs`.
- Marcado como **experimental** e desligado por padrão; o Clipes nunca lê nem guarda tokens de login dos CLIs.
- Exige confirmação explícita por CLI (`provider.cli.confirm`) e roda sem shell, em diretório temporário isolado, com timeout configurável (`timeoutSeconds`, padrão `300` s):
  - **Codex (`codex`)**: `codex exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --skip-git-repo-check -C <tmp> --output-schema <schema.json>` e lista de `--disable` para ferramentas (`browser_use`, `shell_tool`, `plugins`, `multi_agent` etc.).
  - **Claude Code (`claude`)**: verifica `--help` para garantir suporte a `--tools` e roda `-p --output-format json --json-schema <schema> --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence --setting-sources ""`.
  - **OpenCode (`opencode`)**: valida versão exata `opencode v2.2.7`, recusa configurações de sistema (`/etc/opencode`, `ProgramData\opencode`, `/Library/...`), limpa variáveis de ambiente (`env_clear`), injeta `OPENCODE_CONFIG_CONTENT` negando todas as ferramentas/MCP/plugins e **só aceita modelos gratuitos oficiais** da lista `FREE_MODELS` (sem usar login salvo).

### 4. Chaves no keyring (cofre do sistema) e consentimento

- As chaves de API são gravadas via crate `keyring` no serviço `io.github.gustavohooo.clipes.provider` (`core/src/provider.rs:513-532`). Nunca são gravadas em arquivos JSON nem devolvidas à UI: `provider.json` guarda apenas `keyLastFour` (os últimos 4 caracteres).
- **Conta no cofre:** por padrão, a conta é a própria URL do `endpoint` (perfis diferentes no mesmo servidor compartilham a mesma chave). Se o perfil (não `legacy`) tiver `ownKey: true`, a conta vira `profile:<id>`.
- **Segurança de envio:** uma chave só é enviada por HTTPS para endpoints remotos (`insecure_endpoint` em HTTP não loopback), sem proxy (`no_proxy`), sem redirecionamentos (`redirect::Policy::none`) e com resolução DNS fixada antes da conexão (`resolve_to_addrs`).
- **Consentimento remoto:** o consentimento (`confirmed`) é gravado por `endpoint` em `provider.json` (`provider.confirm`). Toda chamada remota HTTP sem consentimento falha com `confirmation_required`.

### 5. Janela de contexto efetiva e aviso na seleção

- `provider.context.get` (`core/src/provider/context.rs`) resolve o contexto efetivo seguindo uma ordem fixa de prioridade e depois aplica o menor teto conhecido:
  `user` (digitado no perfil) → `measured` (medido pela sonda `provider.test` com `probeContext: true`) → `loaded` (carregado no servidor local) → `server` (máximo operacional reportado pela API) → `catalog` (em `prices.json`, só para API hospedada) → `fallback` (`4096` Ollama, `8192` demais).
- Os resultados são cacheados em `provider-context.json` (TTL de 5 min para `loaded`/`measured`, 6 h para estáticos).
- `provider.selection_state` (`core/src/context_notice.rs`) avalia esse contexto em cache contra uma **Fonte sintética de referência** de 60 min (fala densa) usando o planejador de **Janelas de seleção**, devolvendo `full`, `reduced` ou `blocked` e códigos de guias práticos (`guides`).

### 6. Preços, estimativa, custo, orçamento e auditoria (ADR-0009)

- **Tabela de preços:** `core/src/provider/prices.json` (embutida, datada de `2026-11-15`) + sobrescritas do usuário em `provider-prices.json` (`provider.prices.set` / `provider.prices.clear`). Suporta faixas de entrada (`tiers`, como em modelos OpenAI, Anthropic e Gemini) e limites do modelo (`contextWindow`, `maxOutput`, `tokensPerRequest`, `tokensPerMinute`, `tokensPerDay`).
- **Estimativa e calibração:** `provider.cost.estimate` calcula um intervalo `[min, max]` de tokens e micro-USD (`1e-6` US$) a partir dos caracteres da instrução, schema e Transcrição. Chamadas bem-sucedidas alimentam `token-calibration.json` (até 20 amostras por `(profile, model, format, language)`, exigindo 3 amostras para ativar a faixa calibrada).
- **Registro por chamada (`provider_costs`):** toda chamada que chega ao Provedor grava uma linha em `provider_costs`, **inclusive reparos e falhas cobradas** (como `invalid_json`, `output_truncated`, `context_truncated`, `refusal`). Modelos locais gravam `cost_kind = 'zero'`; CLIs (`codex`/`claude`) gravam `'plan_quota'` ("consome a cota do plano"); OpenCode gratuito grava `'zero'`; modelo sem preço ou sem `usage` grava `'unknown'` ("custo desconhecido", nunca zero).
- **Orçamento (`ai_budgets` e `ai_pauses`):** o usuário pode definir limites por escopo `task` ou `batch`: `maxCalls`, `maxTokens`, `maxWallMs`, `maxCostMicroUsd`. Antes de cada envio HTTP (incluindo reparos), `budget::gate` soma `acumulado desde since + estimativa da próxima chamada`. Se ultrapassar, nada é enviado: o job volta para `queued` (desfazendo o incremento de `attempts`), só aquele escopo pausa em `ai_pauses`, e a UI pode retomar com `jobs.budget.continue`. Num lote (`scope = 'batch'`), um Provedor sem preço conhecido pausa com `cost_unknown` até `confirmed: true`.
- **Auditoria (`call_audit`):** na mesma transação que grava `provider_costs` (ou `transcription_calls` para Groq), o núcleo grava em `call_audit` apenas hashes e metadados (`provider_kind`, `host`, `model`, `prompt_sha256`, `input_sha256`, `sent_bytes`, `response_sha256`) — **nunca** texto de Transcrição, prompt ou Roteiro.

---

## A fila de jobs (`core/src/jobs.rs` e `core/src/jobs/*`)

- Quando um Projeto é aberto, o núcleo inicia um worker único em segundo plano (`jobs::start_worker`) que faz polling na tabela `jobs` do `project.sqlite` a cada 100 ms (além de chamar `source_batches::tick()`).
- **Tipos (`kind`) suportados pela fila** (`core/src/jobs/preview.rs:54`):
  - Locais/mídia: `preview` (onda de áudio + miniaturas), `proxy`, `export`, `timeline`, `energy`, `chat`, `narration`, `narration_align`, `narration_import`, `reframe`, `transcription` (local ou remoto Groq).
  - Tarefas de IA (`ai:<tarefa>`): `ai:selection`, `ai:selection_transformed`, `ai:packaging`, `ai:thumbnail`, `ai:script`, `ai:script_block`, `ai:angles`, `ai:translation`.
- **Segurança (`safety`):** `'local'` ou `'paid'`. Todo job que envia para fora da máquina (API remota ou CLI) é `'paid'`.
- **Estados e transições:**
  - `queued` → `running` (`jobs::begin`, incrementa `attempts`).
  - `running` → `completed` (sucesso; `progress = 100`; em jobs de IA grava `checkpoint = 'validated'` e `result` na mesma instrução).
  - `running` → `failed` (erro não recuperável ou falha de validação após reparo).
  - `running` → `cancelled` (cancelado antes de enviar chamada paga, ou em job `local`).
  - `running` → `uncertain` (`timeout_uncertain`, ou cancelamento em job `paid` **depois** de a requisição já ter saído para o Provedor, ou reconciliação pós-crash de job `running` + `paid`).
  - `running` → `queued` (app fechando antes de enviar chamada ou em job `local`; ou pausa de orçamento antes de enviar, caso em que `attempts` também é revertido; ou interrupção limpa).
  - `queued` → `cancelled` (`jobs.cancel` imediato antes de iniciar).
  - `uncertain` → `queued` (`jobs.retry` — se `safety = 'paid'`, exige `confirmed: true`, mostrando estimativa de `jobs.estimate` antes; se `safety = 'local'`, repete sem confirmação).
  - `uncertain` → `cancelled` (`jobs.discard`).
- **Reconciliação após crash (`jobs::reconcile`):** ao reabrir um Projeto que fechou abruptamente com jobs em `running`, jobs `local` voltam automaticamente para `queued`, enquanto jobs `paid` viram `uncertain` (`code: "interrupted"`, `cost: "unknown"`), impedindo repetição paga às cegas (ADR-0005).
- **Refazer (`jobs.redo` / `jobs.redo.estimate`):** para qualquer job `ai:<tarefa>` em estado `completed`, `failed` ou `cancelled` (nunca `uncertain`, `queued` ou `running`), permite enfileirar uma nova execução com um `profileId` escolhido só para aquela tentativa.
- **Prévia (`jobs.preview`):** lê do cache de previews (`waveform.bin` e `thumb-*.jpg`) gerados pelo job `preview` de uma Fonte, atualizando o `mtime` para LRU.

---

## Fluxo típico

1. **Configurar Provedores e Perfis:**
   - A UI chama `provider.profiles.list` (e `provider.cli.status` / `provider.status` se usar modo legado) para listar os Perfis cadastrados e CLIs.
   - Para criar/editar um perfil HTTP/local: `provider.configure` → `provider.key.set` (se usar chave de API) → `provider.context.get` → `provider.selection_state` (mostra se o contexto comporta seleção de Cortes).
   - Para testar a conexão: se o endpoint for remoto e ainda não confirmado, a UI exibe o aviso e chama `provider.confirm`, depois `provider.test`. Para medir contexto real de um servidor local, chama `provider.test` com `probeContext: true`.
   - Para usar CLI (Codex/Claude/OpenCode): `provider.cli.configure` → `provider.cli.confirm` → `provider.test`.
2. **Consultar preços e estimar custos:**
   - `provider.prices.get` exibe a tabela embutida e sobrescritas; `provider.prices.set` / `provider.prices.clear` ajustam preços; `provider.cost.estimate` estima custo para um texto; `provider.cost.list` e `provider.audit.list` mostram histórico de gastos e trilha de hashes do Projeto.
3. **Acompanhar e controlar a fila de jobs:**
   - Ao iniciar qualquer operação assíncrona (seleção, transcrição, export etc.), a UI escuta eventos `core-progress` filtrados por `project` ou `job` e consulta `jobs.list`.
   - **Caminho alternativo — Cancelar:** `jobs.cancel { id }` (se ainda na fila, cancela na hora; se rodando e já enviou chamada paga, o job de IA vai para `uncertain`).
   - **Caminho alternativo — Resultado incerto (`uncertain`):** a UI chama `jobs.estimate { id }` para mostrar o custo de repetição e pede confirmação antes de `jobs.retry { id, confirmed: true }`, ou descarta com `jobs.discard { id }`.
   - **Caminho alternativo — Orçamento pausado:** quando um lote ou tarefa pausa (`ai_pauses`), a UI usa `jobs.budget.set` / `jobs.budget.continue` para ajustar o teto (ou confirmar custo desconhecido) e retomar a fila.
   - **Caminho alternativo — Refazer unidade de IA com outro perfil:** `jobs.redo.estimate { id, profileId }` → diálogo de confirmação mostrando custo e saída da máquina → `jobs.redo { id, profileId, confirmed: true }`.

---

## Comandos

### `provider.audit.list`
- **O que faz:** Lista a trilha de auditoria das chamadas de IA e transcrição remota registradas no Projeto (apenas hashes e metadados, sem texto).
- **Entrada:** `job?: number` opcional (inteiro ID do job; se omitido, devolve todas as linhas).
- **Saída:** array de objetos `{ id: number, providerKind: string, host: string | null, model: string | null, promptSha256: string | null, inputSha256: string | null, sentBytes: number | null, responseSha256: string | null, task: string | null, taskVersion: number | null, outcome: string | null, costId: number | null, transcriptionCallId: number | null, job: number | null }`, ordenado por `id` crescente.
- **Erros:** `project_not_open` (nenhum Projeto aberto), `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-113, US-122 (auditoria sem dados sensíveis, ADR-0009 regras 7–10).
- **Código:** `core/src/audit.rs:46`

### `provider.capabilities`
- **O que faz:** Devolve o registro estático de capacidades dos adaptadores (formato de schema nativo, ponteiros de `usage`, recusa e truncamento, sinal de corte de entrada), opcionalmente filtrado por tipo e modelo.
- **Entrada:** `kind?: string` opcional (`"openai"`, `"anthropic"`, `"gemini"`, `"ollama"`, `"codex"`, `"claude"`, `"opencode"`), `model?: string` opcional (mescla observação medida do modelo quando existe). Se `{}` (sem `kind`), devolve o mapa completo.
- **Saída:** objeto de capacidades `{ nativeSchema, nativeSchemaSupport, usage, refusalPointer, truncationPointer, truncationValues, repairNative, schemaAlways, contextSources, inputTruncationSignal?, observation? }` (ou mapa `kind -> Capabilities` quando `kind` é omitido).
- **Erros:** `invalid_settings` (`kind` ausente do registro ou não é string).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** ADR-0008 regra 7 (capacidades como dado).
- **Código:** `core/src/provider/capabilities.rs:162`

### `provider.cli.configure`
- **O que faz:** Seleciona (ou desativa) o Provedor via CLI e opcionalmente configura o modelo do OpenCode e o timeout de CLI.
- **Entrada:** `kind?: string` (`""`, `"codex"`, `"claude"` ou `"opencode"`; ausente equivale a `""`, que desativa o CLI e limpa escolhas de CLI em `assistant.json`), `model?: string` (opcional quando `kind == "opencode"`; formato `provedor/modelo`, até 200 caracteres), `timeoutSeconds?: number | null` (opcional; inteiro 1..3600 ou `null` para restaurar padrão 300 s; ausente mantém o atual).
- **Saída:** `{}` (objeto vazio).
- **Erros:** `invalid_settings` (`kind` inválido, `model` de OpenCode inválido, ou `timeoutSeconds` fora de 1..3600), `settings` (erro de acesso/leitura/gravação de `provider-cli.json` ou `assistant.json`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma (para executar chamadas depois, o CLI precisa estar instalado e confirmado).
- **Tela hoje:** `src/features/provider/CliSettings.tsx`, `src/features/assistant/Assistant.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (não valida formato de `model` nem atualiza `timeoutSeconds`).
- **US (#26):** US-23, US-24.
- **Código:** `core/src/provider_cli.rs:407`

### `provider.cli.confirm`
- **O que faz:** Registra a confirmação do usuário para envio de texto ao CLI atualmente selecionado.
- **Entrada:** `kind: string` obrigatório (`"codex"`, `"claude"` ou `"opencode"`; deve coincidir com o CLI selecionado em `provider-cli.json`).
- **Saída:** `{}` (objeto vazio).
- **Erros:** `invalid_settings` (`kind` não coincide com `selected`, ou nenhum CLI selecionado), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** CLI selecionado via `provider.cli.configure`.
- **Tela hoje:** `src/features/provider/CliSettings.tsx`, `src/features/assistant/Assistant.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-23, US-24, US-27.
- **Código:** `core/src/provider_cli.rs:408`

### `provider.cli.status`
- **O que faz:** Retorna o CLI selecionado, o status de confirmação de cada CLI, o modelo do OpenCode e o timeout efetivo em segundos.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ selected: string, codexConfirmed: boolean, claudeConfirmed: boolean, opencodeConfirmed: boolean, opencodeModel: string, timeoutSeconds: number }`.
- **Erros:** `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/provider/CliSettings.tsx`, `src/features/assistant/AssistantSettings.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-23, US-24.
- **Código:** `core/src/provider_cli.rs:406`

### `provider.configure`
- **O que faz:** Cria ou atualiza um Perfil de Provedor (ou o perfil legado `"legacy"` quando `profileId` é omitido) em `provider.json`.
- **Entrada:** `endpoint: string` obrigatório (URL HTTP/HTTPS sem credenciais, query ou fragmento), `model: string` obrigatório (não vazio), `kind?: string` (`"openai"` padrão, `"anthropic"`, `"gemini"`, `"ollama"`), `profileId?: string | null` (omitido/`null` atualiza `"legacy"` e desativa CLI ativo; senão `"legacy"` ou `[a-z0-9_-]{1,40}`, exceto `"codex"`, `"claude"`, `"opencode"`), `label?: string` (até 60 chars), `nativeSchema?: boolean` (padrão `false`), `ownKey?: boolean` (proibido em `"legacy"`; `true` cria conta própria no keyring `profile:<id>`, `false` remove a chave própria antiga), `context?: number | null` (`1..u32::MAX` ou `null`), `maxOutput?: number | null`, `timeoutSecs?: number | null` (`1..3600` ou `null`), `tokensPerRequest?: number | null`, `tokensPerMinute?: number | null`, `tokensPerDay?: number | null`.
- **Saída:** `{}` quando `profileId` é omitido; `{ profileId: string }` quando `profileId` é informado.
- **Erros:** `invalid_endpoint` (URL malformada ou com credenciais/query/fragmento), `network` (DNS do host não resolve), `invalid_settings` (`model` vazio, `profileId` inválido, `ownKey` em `"legacy"`, `kind` inválido, limites inválidos ou `timeoutSecs` fora de 1..3600), `vault`, `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma (para endpoints remotos, o DNS precisa resolver no momento da configuração).
- **Tela hoje:** `src/features/provider/ProviderSettings.tsx` (modo legado sem `profileId`), `src/features/provider/ProviderProfiles.tsx` (perfis nomeados), `src/features/assistant/Assistant.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (não valida `resolve`, `ownKey` em legacy nem `kind`).
- **US (#26):** US-21, US-22, US-26.
- **Código:** `core/src/provider.rs:1139`

### `provider.confirm`
- **O que faz:** Registra o consentimento informado do usuário para envio de texto ao `endpoint` de um Perfil de Provedor remoto (todo perfil no mesmo endpoint herda o consentimento).
- **Entrada:** `endpoint: string` obrigatório (deve bater exatamente com o endpoint salvo do perfil), `profileId?: string` opcional (padrão `"legacy"`).
- **Saída:** `{}` (objeto vazio).
- **Erros:** `invalid_settings` (perfil não encontrado, endpoint vazio ou endpoint diferente do salvo), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Perfil configurado com `endpoint`.
- **Tela hoje:** `src/features/provider/ProviderSettings.tsx`, `src/features/provider/ProviderProfiles.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-27.
- **Código:** `core/src/provider.rs:1144`

### `provider.context.get`
- **O que faz:** Resolve a Janela de contexto efetiva e os limites de saída de um Perfil de Provedor (ou da rota de uma tarefa), consultando o cache e opcionalmente sondando metadados passivos do servidor (sem gerar texto pago).
- **Entrada:** `profileId?: string | null` opcional, `task?: string` opcional (usado se `profileId` omitido), `refresh?: boolean` opcional (padrão `false`; quando `true`, ignora cache e faz *preload* leve no Ollama local/privado via `/api/chat` com `messages: []` e `num_predict: 1`).
- **Saída:** `{ profileId: string, kind: string, value: number, source: "user" | "loaded" | "server" | "catalog" | "fallback" | "measured", detail: "ollama" | "lmstudio" | "llamacpp" | "openrouter" | "anthropic" | "gemini" | "models" | null, explanation: string, capped: boolean, warning: "local_only" | "consent_required" | "unavailable" | "not_measured" | null, measured: boolean, userContext: number | null, loaded: { value: number } | null, maxContext: { value: number, source } | null, maxOutput: { value: number, source } | null, refreshed: boolean }`.
- **Erros:** `invalid_settings` (perfil não encontrado ou não configurado), `invalid_request` (`task` inválido), `confirmation_required` / `profile_unavailable` (rota da tarefa aponta para CLI sem confirmação ou perfil removido), `vault`, `settings`, `cancelled`, `network`.
- **Eventos e jobs:** nenhum (síncrono; faz requisições HTTP de metadados se necessário).
- **Pré-condições:** Perfil configurado (ou rota da tarefa configurada).
- **Tela hoje:** `src/features/provider/ProviderProfiles.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (não faz sondagem real e só retorna `user`/`fallback`).
- **US (#26):** US-21, US-22.
- **Código:** `core/src/provider/context.rs:951`

### `provider.cost.estimate`
- **O que faz:** Estima tokens de entrada, faixa de custo em micro-USD (ou `zero` / `plan_quota` / `unknown`) e faixa de preço aplicável antes de enviar uma requisição estruturada.
- **Entrada:** campos de `StructuredRequest` (`instruction: string`, `transcript: string`, `schema: any`, `nativeSchema: boolean`, `maxOutputTokens?: number | null`, `estimateHint?: { format: "generic" | "compact" | "full", language: string }`), mais `profileId?: string` e `task?: string` opcionais para resolver a rota.
- **Saída:** `{ kind: "usd" | "zero" | "plan_quota" | "unknown", callsOnly: boolean, inputTokens: number, inputTokensRange: { min: number, max: number }, inputTokensLow: number, inputCharacters: number, estimateHint: object | null, initialRatio: number, calibrationSamples: number, tier: { aboveInputTokens, upToInputTokens, crossesThreshold } | null, maxOutputTokens: number | null, minMicroUsd: number | null, maxMicroUsd: number | null, priceSource: "table" | "override" | null, tableUpdatedAt: string, heuristic: "format-range", profileId: string }`.
- **Erros:** `invalid_request` (payload de `StructuredRequest` inválido ou `task` inválido), `local_only_violation`, `confirmation_required` (CLI não confirmado), `invalid_settings`, `profile_unavailable`, `settings`, `network` / `invalid_endpoint` (ao checar localidade do endpoint).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Perfil ou rota da tarefa configurada.
- **Tela hoje:** `src/features/provider/Costs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (retorna apenas cálculo fictício `usd`).
- **US (#26):** US-28, US-30.
- **Código:** `core/src/provider/cost.rs:1076`

### `provider.cost.list`
- **O que faz:** Lista os registros reais de custo gravados no SQLite do Projeto aberto (`provider_costs`), com filtro opcional por lote ou job.
- **Entrada:** `batch?: string` opcional, `job?: number` opcional. Sem filtros se `{}`.
- **Saída:** array de `{ id: number, jobId: number | null, task: string, taskVersion: number | null, attempt: number | null, outcome: string | null, code: string | null, batch: string | null, profile: string | null, provider: string, model: string, inputTokens: number | null, outputTokens: number | null, calls: number, costKind: "usd" | "zero" | "plan_quota" | "unknown", microUsd: number | null, estimateMicroUsd: number | null, durationMs: number | null, priceSource: string | null, tableUpdatedAt: string, createdAt: number }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/provider/Costs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (só retorna itens se `?source-test=1` estiver na URL; sem o flag retorna `[]`).
- **US (#26):** US-28, US-30 (ADR-0009).
- **Código:** `core/src/provider/cost.rs:1078`

### `provider.cost.run`
- **O que faz:** Executa `provider.structured` diretamente (fora da fila de jobs), calcula e anexa o custo real da chamada (inclusive em falhas com `usage`) e grava uma linha de custo e auditoria no Projeto se houver Projeto aberto.
- **Entrada:** `task: string` obrigatório (não vazio), `batch?: string` opcional, `profileId?: string` opcional, além dos campos de `StructuredRequest` (`instruction`, `transcript`, `schema`, `nativeSchema`, `maxOutputTokens?`, `estimateHint?`).
- **Saída:** `{ data: any, usage: { inputTokens, outputTokens } | null, calls: number, cost: { kind: string, microUsd: number | null, priceSource: string | null, recorded: boolean }, route: { profileId: string, kind: string, model: string | null } }`.
- **Erros:** `invalid_request` (`task` vazio ou request inválido), além de todos os erros de `provider.structured` (em falhas que carregam `usage` ou timeout/cancelamento, grava a linha em `provider_costs` e `call_audit` antes de retornar o erro enriquecido com `cost`).
- **Eventos e jobs:** emite via `EventSink` os mesmos eventos de `provider.structured` (`job: "provider.structured"`, stages `"starting"`, `"complete"` / `"failed"`). Não entra na fila de jobs.
- **Pré-condições:** Perfil ou rota da tarefa configurada; consentimento remoto (se remoto); chave no keyring se exigida.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-28, US-30 (ADR-0009).
- **Código:** `core/src/provider/cost.rs:1077`

### `provider.key.remove`
- **O que faz:** Remove a chave de API do Perfil de Provedor do keyring do sistema e limpa `keyLastFour` em `provider.json`.
- **Entrada:** `profileId?: string` opcional (omitido atua sobre `"legacy"`).
- **Saída:** `{}` (objeto vazio).
- **Erros:** `invalid_settings` (`profileId` informado não existe), `vault`, `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma (se não houver perfil `legacy`, retorna `{}`).
- **Tela hoje:** `src/features/provider/ProviderSettings.tsx`, `src/features/provider/ProviderProfiles.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-25.
- **Código:** `core/src/provider.rs:1143`

### `provider.key.set`
- **O que faz:** Armazena a chave de API no keyring do sistema (na conta do endpoint compartilhado ou `profile:<id>` se `ownKey: true`) e salva apenas os 4 últimos caracteres (`keyLastFour`) em `provider.json`.
- **Entrada:** `key: string` obrigatório (não vazio), `profileId?: string` opcional (omitido atua sobre `"legacy"`).
- **Saída:** `{}` (objeto vazio).
- **Erros:** `invalid_key` (`key` ausente ou vazio), `invalid_settings` (perfil não configurado ou não encontrado), `vault`, `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Perfil configurado.
- **Tela hoje:** `src/features/provider/ProviderSettings.tsx`, `src/features/provider/ProviderProfiles.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-21, US-25.
- **Código:** `core/src/provider.rs:1142`

### `provider.prices.clear`
- **O que faz:** Remove uma sobrescrita de preço definida pelo usuário para um par `(provider, model)`, voltando a valer a tabela embutida (se existir).
- **Entrada:** `provider: string` obrigatório, `model: string` obrigatório.
- **Saída:** mesmo objeto de `provider.prices.get` (`{ updatedAt, prices, overrides }`).
- **Erros:** `invalid_price` (`provider` ou `model` ausente/não string), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/provider/Costs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-28.
- **Código:** `core/src/provider/cost.rs:1081`

### `provider.prices.get`
- **O que faz:** Devolve a tabela de preços embutida no app e todas as sobrescritas salvas pelo usuário em `provider-prices.json`.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ updatedAt: string, prices: Price[], overrides: Price[] }`, onde cada `Price` contém `provider`, `model`, `inputPerMillion`, `outputPerMillion` e campos opcionais (`source`, `updatedAt`, `contextWindow`, `maxOutput`, `tokensPerRequest`, `tokensPerMinute`, `tokensPerDay`, `limitsSource`, `tiers`).
- **Erros:** `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/provider/Costs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (devolve apenas 1 modelo fixo na tabela embutida simulada).
- **US (#26):** US-28.
- **Código:** `core/src/provider/cost.rs:1079`

### `provider.prices.set`
- **O que faz:** Salva ou substitui uma sobrescrita de preço para `(provider, model)` em `provider-prices.json`.
- **Entrada:** objeto `Price` (`provider: string`, `model: string`, `inputPerMillion: number >= 0`, `outputPerMillion: number >= 0`, opcionais `contextWindow > 0`, `maxOutput > 0`, `tokensPerRequest > 0`, `tokensPerMinute > 0`, `tokensPerDay > 0`, `tiers: Tier[]` crescentes).
- **Saída:** mesmo objeto de `provider.prices.get` (`{ updatedAt, prices, overrides }`).
- **Erros:** `invalid_price` (campos inválidos, negativos, zero em limites, ou `tiers` fora de ordem crescente), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/provider/Costs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (sem validação de `tiers`/limites).
- **US (#26):** US-28.
- **Código:** `core/src/provider/cost.rs:1080`

### `provider.profiles.list`
- **O que faz:** Lista todos os Perfis de Provedor configurados (incluindo o `"legacy"` se houver), com limites efetivos, preço resolvido, localidade e consentimento, seguidos dos 3 CLIs (`codex`, `claude`, `opencode`).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ profiles: ProfileView[] }`. Perfis HTTP/local trazem `id`, `label`, `kind`, `endpoint`, `model`, `nativeSchema`, `context`, `maxOutput`, `timeoutSecs`, `tokensPerRequest`, `tokensPerMinute`, `tokensPerDay`, `limits`, `ownKey`, `keyLastFour`, `local`, `confirmed`, `price`, `cli: false`. CLIs trazem `id`, `label`, `kind`, `endpoint: null`, `model` (`opencodeModel` ou `null`), `cost`, `confirmed`, `active`, `cli: true`, `experimental: true`.
- **Erros:** `settings`.
- **Eventos e jobs:** nenhum (síncrono; lê `provider.cli.status` internamente).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/provider/ProviderProfiles.tsx`, `src/features/assistant/AssistantSettings.tsx`, `src/features/assistant/TaskTable.tsx`, `src/features/projects/RedoWithProfile.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-20, US-21, US-22, US-23, US-24, US-26.
- **Código:** `core/src/provider.rs:1140`

### `provider.profiles.remove`
- **O que faz:** Remove um Perfil de Provedor salvo (exceto `"legacy"`), apaga sua chave própria do keyring (se `ownKey`), remove entradas no cache de contexto e na calibração de tokens.
- **Entrada:** `profileId: string` obrigatório.
- **Saída:** `{}` (objeto vazio).
- **Erros:** `invalid_settings` (`profileId` ausente, igual a `"legacy"` ou não encontrado), `vault`, `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Perfil salvo com `profileId != "legacy"`.
- **Tela hoje:** `src/features/provider/ProviderProfiles.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-26.
- **Código:** `core/src/provider.rs:1141`

### `provider.selection_state`
- **O que faz:** Avalia se o contexto efetivo em cache de um Perfil de Provedor (ou da rota de uma tarefa) comporta a seleção de Cortes com janelas cheias, reduzidas ou bloqueadas, sobre uma Fonte sintética de 60 minutos. Não faz rede.
- **Entrada:** `profileId?: string` opcional, `task?: string` opcional.
- **Saída:** `{ applicable: false }` para CLIs; para API/local: `{ applicable: true, profileId, kind, model, contextTokens, origin, state: "full" | "reduced" | "blocked", reference: { sourceMinutes: 60, maxWindowMinutes: 15, minWindowMinutes, firstWindowMinutes, windows }, guides: ("ollama_profile" | "ollama_server" | "lmstudio" | "llamacpp")[] }`.
- **Erros:** `invalid_settings`, `invalid_request`, `confirmation_required`, `profile_unavailable`, `settings` (ou erro do planejador diferente de `context_too_small`, que vira `state: "blocked"`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Perfil configurado (ou rota configurada).
- **Tela hoje:** `src/features/provider/SelectionState.tsx` (usado em `ProviderProfiles.tsx`).
- **Mock TS:** sim, em `src/lib/core.ts` (usa limites simplificados `< 11000` / `< 16000` em vez do planejador real).
- **US (#26):** US-22, US-59.
- **Código:** `core/src/context_notice.rs:165`

### `provider.status`
- **O que faz:** Lê a configuração atual do perfil principal (`"legacy"`, ou do `profileId` informado), incluindo timeouts efetivos da API, limites calculados, `keyLastFour`, `remote` e `confirmed`.
- **Entrada:** `profileId?: string` opcional (omitido lê `"legacy"`).
- **Saída:** se não houver perfil salvo, `{ endpoint: "", model: "", kind: "openai", nativeSchema: false, timeouts: { remote, local }, keyLastFour: null, remote: false, confirmed: false }`; se houver, inclui também `profileId`, `context`, `maxOutput`, `timeoutSecs`, `tokensPerRequest`, `tokensPerMinute`, `tokensPerDay`, `limits`.
- **Erros:** `invalid_settings` (`profileId` informado não existe), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/provider/ProviderSettings.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-21, US-22.
- **Código:** `core/src/provider.rs:1138`

### `provider.structured`
- **O que faz:** Envia uma requisição estruturada ao Provedor resolvido (por `profileId`, por `task` ou pelo padrão/CLI ativo), valida a saída contra o `schema` (com até 1 tentativa de reparo em JSON inválido quando suportado) e emite eventos de início e conclusão.
- **Entrada:** `instruction: string` obrigatório, `transcript: string` obrigatório, `schema: object` obrigatório (JSON Schema), `nativeSchema: boolean` obrigatório (sobrescrito pelo do perfil na rota HTTP), `maxOutputTokens?: number | null`, `estimateHint?: { format, language }`, `profileId?: string | null`, `task?: string`.
- **Saída:** `{ data: Value, usage: { inputTokens, outputTokens } | null, calls: number }`.
- **Erros:** `invalid_settings`, `invalid_request`, `invalid_schema`, `local_only_violation`, `confirmation_required`, `profile_unavailable`, `output_space_insufficient`, `vault`, `insecure_endpoint`, `invalid_endpoint`, `network`, `timeout_uncertain`, `cancelled`, `budget_calls`, `time_budget_exhausted`, `rate_limit`, `provider_daily_limit`, `request_too_large`, `provider_http`, `invalid_response`, `context_truncated`, `output_truncated`, `refusal`, `invalid_json`, `cli_unavailable`, `unsupported_cli`, `cli_auth_required`, `cli_model_unavailable`, `cli_free_limit`, `cli`. (Erros após resposta do Provedor carregam `usage` com `{ usage, calls }`.)
- **Eventos e jobs:** síncrono, não entra na fila de jobs; emite via `EventSink` com `job: "provider.structured"`, `project: null`, stages `"starting"` (0%) e `"complete"` (100%) ou `"failed"` (100%, com `error`).
- **Pré-condições:** Perfil ou CLI configurado; se remoto ou CLI, consentimento dado; se remoto com chave, endpoint HTTPS.
- **Tela hoje:** nenhuma (sem uso na UI; usado internamente pelo núcleo e por `provider.test` / `provider.cost.run`).
- **Mock TS:** não.
- **US (#26):** US-21, US-22, US-23, US-24, US-31 (ADR-0008).
- **Código:** `core/src/provider.rs:1146`

### `provider.test`
- **O que faz:** Testa a conexão com o Provedor (chamada mínima `schemaVersion: 1`) ou, se `probeContext: true`, mede o contexto real de um servidor local enviando um texto sintético.
- **Entrada:** `profileId?: string` opcional (omitido usa rota padrão/legado/CLI ativo), `probeContext?: boolean` opcional (padrão `false`; só funciona para perfil HTTP loopback).
- **Saída:** se `probeContext` ausente/`false`: `{ data: { schemaVersion: 1 }, usage, calls }`. Se `probeContext: true`: `{ profileId, contextSent, inputTokens, truncated: boolean, measured: number | null, value: number, source: string }`.
- **Erros:** com `probeContext: true`: `probe_not_local`, `probe_unavailable`, `invalid_settings`, `vault`, além dos erros de rede/HTTP/cancelamento do adaptador. Sem `probeContext`: todos os erros de `provider.structured`.
- **Eventos e jobs:** sem `probeContext`, delega a `provider.structured` (emite `"starting"` e `"complete"`/`"failed"` via `EventSink`); com `probeContext: true`, não emite eventos.
- **Pré-condições:** Perfil ou CLI configurado; consentimento se remoto.
- **Tela hoje:** `src/features/provider/ProviderSettings.tsx`, `src/features/provider/ProviderProfiles.tsx`, `src/features/provider/CliSettings.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (suporta `?opencode-free-limit` e `probeContext: true`).
- **US (#26):** US-21, US-22, US-23, US-24, US-27.
- **Código:** `core/src/provider.rs:1145`

### `jobs.budget.continue`
- **O que faz:** Atualiza opcionalmente os limites de orçamento (`ai_budgets`), opcionalmente reinicia o marco temporal `since`, confirma custo desconhecido se necessário e **remove a pausa** do escopo em `ai_pauses` para a fila voltar a rodar.
- **Entrada:** `scope: "task" | "batch"` obrigatório, `key: string` obrigatório (não vazio, até 80 chars), `maxCalls?: number | null`, `maxTokens?: number | null`, `maxWallMs?: number | null`, `maxCostMicroUsd?: number | null`, `confirmed?: boolean`, `resetUsage?: boolean`.
- **Saída:** `{ budgets: [ { scope, key, maxCalls, maxTokens, maxWallMs, maxCostMicroUsd, unknownConfirmed, since, usage, paused } ] }` filtrado para o `(scope, key)` informado.
- **Erros:** `invalid_budget`, `confirmation_required` (se a pausa for `cost_unknown` e não houver `confirmed: true` nem `unknown_confirmed` prévio), `project_not_open`, `project_busy`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum direto (síncrono; ao remover a linha de `ai_pauses`, o worker da fila retoma os jobs `queued` daquele escopo).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/SourceBatches.tsx` (`scope: "batch"`).
- **Mock TS:** sim, em `src/lib/batchMock.ts` (apenas `scope === "batch"`, devolve formato `view(batch).budget` em vez de `{ budgets: [...] }`).
- **US (#26):** US-29 (ADR-0009 regras 2–4).
- **Código:** `core/src/jobs/budget.rs:344`

### `jobs.budget.get`
- **O que faz:** Lista todos os orçamentos configurados no Projeto (`ai_budgets`), seu consumo acumulado desde `since` e o motivo da pausa em `ai_pauses`, se houver.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ budgets: [ { scope: "task" | "batch", key: string, maxCalls: number | null, maxTokens: number | null, maxWallMs: number | null, maxCostMicroUsd: number | null, unknownConfirmed: boolean, since: number, usage: { calls, inputTokens, outputTokens, microUsd, audioMicroUsd?, unknownCostCalls, planQuotaCalls, durationMs, costLabel }, paused: string | null } ] }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `invalid_request`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-29 (ADR-0009).
- **Código:** `core/src/jobs/budget.rs:342`

### `jobs.budget.set`
- **O que faz:** Cria ou atualiza os tetos de orçamento para um escopo (`task` ou `batch`) sem despausar uma pausa ativa. Campo ausente preserva o atual; `null` remove o teto.
- **Entrada:** `scope: "task" | "batch"` obrigatório, `key: string` obrigatório (1..80 chars), `maxCalls?: number | null`, `maxTokens?: number | null`, `maxWallMs?: number | null`, `maxCostMicroUsd?: number | null`, `confirmed?: boolean`, `resetUsage?: boolean`.
- **Saída:** `{ budgets: [ ... ] }` (igual a `jobs.budget.get`, filtrado para o `(scope, key)` alterado).
- **Erros:** `invalid_budget`, `project_not_open`, `project_busy`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/SourceBatches.tsx` (`scope: "batch"`).
- **Mock TS:** sim, em `src/lib/batchMock.ts` (apenas `scope === "batch"`, retorna `view(batch).budget`).
- **US (#26):** US-29 (ADR-0009).
- **Código:** `core/src/jobs/budget.rs:343`

### `jobs.cancel`
- **O que faz:** Solicita cancelamento de um job: se estiver `queued`, passa imediatamente para `cancelled`; se estiver `running`, marca `cancel_requested = 1` para o executor interrompê-lo.
- **Entrada:** `id: number` obrigatório (ID inteiro do job).
- **Saída:** `null`.
- **Erros:** `invalid_job` (`id` ausente ou não inteiro), `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** síncrono no pedido; o job em execução emitirá o evento final ao encerrar (em jobs `ai:*`, `stage: "ai:<task>:done"` com estado `cancelled` ou `uncertain` se pago e já enviado; nos demais jobs, `stage: "complete"` / `"failed"` via `jobs/preview.rs`).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/Jobs.tsx`, `src/features/projects/Transcription.tsx`, `src/features/projects/CutPreview.tsx`, `src/features/projects/Narration.tsx`, `src/features/editor/Editor.tsx`, `src/features/editor/CropPanel.tsx`, `src/features/export/ExportButton.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (para `id === 99` e sob `?source-test=1`) e `src/features/export/mock.ts` (para `id >= 5900`).
- **US (#26):** US-51.
- **Código:** `core/src/jobs.rs:139`

### `jobs.discard`
- **O que faz:** Descarta um job em estado `uncertain`, mudando seu estado para `cancelled` e limpando `cancel_requested`.
- **Entrada:** `id: number` obrigatório.
- **Saída:** `null`.
- **Erros:** `invalid_job` (`id` ausente/inválido), `invalid_job_state` (o job não existe ou não está em `uncertain`), `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; job no estado `uncertain`.
- **Tela hoje:** `src/features/projects/Jobs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (apenas sob `?source-test=1`).
- **US (#26):** US-33 (ADR-0005).
- **Código:** `core/src/jobs.rs:183`

### `jobs.estimate`
- **O que faz:** Retorna o `safety` (`"local"` ou `"paid"`) e a estimativa de custo de repetir um job (usada antes de confirmar `jobs.retry` em chamadas incertas, tanto para jobs `ai:*` quanto para transcrição paga no Groq).
- **Entrada:** `id: number` obrigatório.
- **Saída:** `{ safety: "local" | "paid", estimate: { kind: "zero" | "plan_quota" | "usd" | "unknown", ... } }`.
- **Erros:** `invalid_job` (`id` ausente/inválido ou job não encontrado), `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; job existente.
- **Tela hoje:** `src/features/projects/Jobs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (apenas sob `?source-test=1`, devolve sempre `{ safety: 'paid', estimate: { kind: 'unknown' } }`).
- **US (#26):** US-28, US-33 (ADR-0009 regra 5).
- **Código:** `core/src/jobs/ai.rs:888`

### `jobs.list`
- **O que faz:** Lista todos os jobs do Projeto aberto com seu estado, progresso, lote, último perfil usado, motivo de pausa por orçamento e custos acumulados da tarefa, do perfil e do lote.
- **Entrada:** nenhuma (`{}`).
- **Saída:** array de `{ id: number, kind: string, safety: "local" | "paid", state: "queued" | "running" | "uncertain" | "completed" | "cancelled" | "failed", attempts: number, checkpoint: string | null, progress: number, project: string, outcome: string | null, cost: string | null, batch: string | null, profile: string | null, budgetPause: string | null, taskCost: Totals | null, profileCost: Totals | null, batchCost: Totals | null }`, ordenado por `id`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/Jobs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (retorna `jobItems` sob `?source-test=1`, senão `[]`).
- **US (#26):** US-33, US-51.
- **Código:** `core/src/jobs.rs:223`

### `jobs.preview`
- **O que faz:** Retorna os caminhos dos arquivos de prévia em cache (`waveform.bin` e miniaturas `thumb-*.jpg`) de uma Fonte e atualiza suas datas de modificação para proteção no cache LRU.
- **Entrada:** `source_id: number` obrigatório (**atenção: `snake_case`**).
- **Saída:** `{ waveform: string, thumbnails: string[] }`.
- **Erros:** `preview_failed` (`source_id` inválido, sem Projeto, metadados inválidos ou erro de I/O), `source_changed` (Fonte ausente ou modificada no disco), `preview_unavailable` (`waveform.bin` ainda não gerado), `project_not_open`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono; apenas lê o que o job em segundo plano `preview` gerou).
- **Pré-condições:** Projeto aberto; Fonte válida; job `preview` já concluído.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-71.
- **Código:** `core/src/jobs/preview.rs:502`

### `jobs.redo`
- **O que faz:** Reenfileira uma unidade de Tarefa de IA (`ai:<tarefa>`) concluída, falha ou cancelada usando um `profileId` escolhido só para esta execução (sem alterar rotas padrão), respeitando o veto Somente local e exigindo confirmação se o perfil for pago.
- **Entrada:** `id: number` obrigatório (ID do job `ai:*`), `profileId: string` obrigatório (1..64 chars), `confirmed?: boolean` (obrigatório `true` quando `route.paid()` for verdadeiro).
- **Saída:** `{ job: number, profile: { id: string, label: string, kind: string, model: string | null } }`.
- **Erros:** `invalid_profile`, `invalid_job` (`id` inválido ou job não é `ai:*`), `job_uncertain` (job está em `uncertain`), `job_not_redoable` (job está `queued` ou `running`), `invalid_job_payload`, `unknown_task`, `task_version_changed`, `local_only_violation`, `confirmation_required` (perfil pago sem `confirmed: true`, trazendo `usage: { estimate, profile, leavesMachine }`; ou CLI não confirmado), `invalid_settings`, `profile_unavailable`, `project_not_open`, `project_read`, `project_write`.
- **Eventos e jobs:** cria e enfileira um novo job `ai:<tarefa>` na fila (`jobs::enqueue_ai_with_profile`), que emitirá eventos `ai:<tarefa>:*` ao executar; cancelável por `jobs.cancel`.
- **Pré-condições:** Projeto aberto; job `ai:*` em estado `completed`, `failed` ou `cancelled`; perfil existente.
- **Tela hoje:** nenhuma (sem uso na UI; a UI usa `selection.redo` em `RedoWithProfile.tsx`).
- **Mock TS:** não.
- **US (#26):** US-31 (ADR-0010 regra 4).
- **Código:** `core/src/jobs/redo.rs:212`

### `jobs.redo.estimate`
- **O que faz:** Calcula o perfil de destino, se o texto sai da máquina e o custo estimado de refazer um job `ai:<tarefa>` com um `profileId` específico, para exibição antes de confirmar `jobs.redo`.
- **Entrada:** `id: number` obrigatório, `profileId: string` obrigatório.
- **Saída:** `{ profile: { id, label, kind, model }, paid: boolean, leavesMachine: boolean, estimate: { kind, units, windows, inputTokens, minMicroUsd, maxMicroUsd } }`.
- **Erros:** `invalid_profile`, `invalid_job`, `job_uncertain`, `job_not_redoable`, `invalid_job_payload`, `unknown_task`, `task_version_changed`, `local_only_violation`, `confirmation_required` (CLI não confirmado), `invalid_settings`, `profile_unavailable`, `project_not_open`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; job `ai:*` em `completed`, `failed` ou `cancelled`.
- **Tela hoje:** nenhuma (sem uso na UI; a UI usa `selection.estimate`).
- **Mock TS:** não.
- **US (#26):** US-28, US-31 (ADR-0010 regra 4).
- **Código:** `core/src/jobs/redo.rs:211`

### `jobs.result`
- **O que faz:** Devolve o JSON `result` salvo na linha de um job (para jobs `ai:*`: `outcome`, `data` ou `code`/`violations`, `usage`, `calls`, `cost`, `resetAtMs`).
- **Entrada:** `id: number` obrigatório.
- **Saída:** objeto JSON de `result`, ou `null` se o job ainda não tem resultado gravado.
- **Erros:** `invalid_job`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; job existente.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-31 (ADR-0005).
- **Código:** `core/src/jobs/ai.rs:901`

### `jobs.retry`
- **O que faz:** Recoloca na fila (`queued`) um job em estado `uncertain`; se `safety = 'paid'`, exige `confirmed: true` (ADR-0005), e se `safety = 'local'`, repete sem confirmação.
- **Entrada:** `id: number` obrigatório, `confirmed?: boolean` (obrigatório `true` quando `safety == "paid"`).
- **Saída:** `null`.
- **Erros:** `invalid_job`, `confirmation_required` (job pago sem `confirmed: true`; traz `usage: { estimate }` de `jobs.estimate`), `invalid_job_state` (job não está em `uncertain`), `project_not_open`, `project_busy`, `project_read`, `project_write`.
- **Eventos e jobs:** recoloca o job existente na fila (ao rodar novamente, o job emitirá eventos `core-progress` normalmente; cancelável por `jobs.cancel`).
- **Pré-condições:** Projeto aberto; job em estado `uncertain`.
- **Tela hoje:** `src/features/projects/Jobs.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (apenas sob `?source-test=1`).
- **US (#26):** US-33 (ADR-0005, ADR-0009 regra 5).
- **Código:** `core/src/jobs.rs:182`

---

## Estados e eventos do domínio

### Eventos de `core-progress` deste domínio

| Emissor / Módulo | `job` | `project` | `stage` | Quando acontece | `percentage` | `error` |
|---|---|---|---|---|---|---|
| `core/src/provider.rs` (`EventSink`) | `"provider.structured"` | `null` | `"starting"` | Início de `provider.structured`, `provider.test` (sem `probeContext`) ou `provider.cost.run` | `0` | `null` |
| `core/src/provider.rs` (`EventSink`) | `"provider.structured"` | `null` | `"complete"` | Resposta validada | `100` | `null` |
| `core/src/provider.rs` (`EventSink`) | `"provider.structured"` | `null` | `"failed"` | Falha na chamada/validação | `100` | `Some(CoreError)` |
| `core/src/jobs/ai.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"ai:<task>:prepare"` | Job `ai:<task>` começa (`execute`) | `0` | `null` |
| `core/src/jobs/ai.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"ai:<task>:call"` | Antes de chamar o Provedor | `10` | `null` |
| `core/src/jobs/ai.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"ai:<task>:verify"` | Após retorno do Provedor, conferindo saída | `80` | `null` |
| `core/src/jobs/ai.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"ai:<task>:paused"` | Orçamento (`ai_budgets`) pausou a fila antes de enviar | `0` | `Some(CoreError)` |
| `core/src/jobs/ai.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"ai:<task>:done"` | Conclusão (`100`, `error: null`), cancelamento (`0`, `error: null`), incerto ou falha (`0`, `error: Some(...)`) | `100` ou `0` | `Option<CoreError>` |
| `core/src/jobs/preview.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"waveform"` | Geração da onda de áudio (`waveform.bin`) | `1`..`49` | `null` |
| `core/src/jobs/preview.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"thumbnails"` | Extração de miniaturas | `50` | `null` |
| `core/src/jobs/preview.rs` (`emit_background`) | `<job_id>` | `<queue_project_identity>` | `"complete"` / `"failed"` | Fim de qualquer job não-`ai:*` da fila (`preview`, `export`, `transcription`, etc.) | `100` / `0` | `Option<CoreError>` |

### Estados dos objetos do domínio

- **Job na fila (`jobs.state`):**
  - `queued`: aguardando execução na fila (ou pausado por `ai_pauses`, caso em que `jobs.list` preenche `budgetPause`).
  - `running`: em execução no worker único.
  - `completed`: concluído com sucesso (`progress = 100`).
  - `failed`: falhou (erro não recuperável ou falha de validação após reparo).
  - `cancelled`: cancelado antes de enviar chamada paga (ou cancelado em job `local`), ou descartado a partir de `uncertain`.
  - `uncertain`: chamada `paid` sofreu `timeout_uncertain`, cancelamento após envio ou interrupção abrupta do app; exige ação explícita (`jobs.retry` ou `jobs.discard`).
- **Contexto efetivo para seleção (`provider.selection_state` `state`):** `full` (janelas de até 15 min), `reduced` (janelas menores, entre o mínimo e 15 min), `blocked` (contexto insuficiente mesmo para a janela mínima).
- **Avisos de descoberta de contexto (`provider.context.get` `warning`):** `local_only`, `consent_required`, `unavailable`, `not_measured`, ou `null`.
- **Origem do contexto (`provider.context.get` `source`):** `user`, `measured`, `loaded`, `server`, `catalog`, `fallback`.
- **Tipo de custo (`provider_costs.cost_kind` / `estimate.kind`):** `usd`, `zero`, `plan_quota`, `unknown`.
- **Desfecho normalizado de chamada de IA (`provider_costs.outcome`):** `ok`, `invalid_json`, `truncated`, `refused`, `timeout_uncertain`, `rate_limit`, `provider_http`, `cancelled`.

---

## Catálogo completo de eventos

No Tauri, todo progresso do núcleo chega à WebView pelo único nome de evento **`core-progress`** (`src-tauri/src/main.rs:32, 96, 120`), carregando `ProgressEvent { job: String, project?: String, clip_id?: i64, stage: String, percentage: u8, message: String, error?: CoreError }` (`core/src/lib.rs:13-23`). `clip_id` é opcional (omitido quando `None`) e é preenchido nos eventos dos jobs `ai:translation:*`.

Existem dois canais de emissão no núcleo e um terceiro direto no adaptador Tauri:
1. **`EventSink` da chamada (`events(...)`)**: entregue apenas enquanto o comando síncrono `core_dispatch` está rodando (`src-tauri/src/main.rs:31-33`).
2. **Emissor global de segundo plano (`emit_background`)**: instalado uma vez na inicialização do Tauri (`src-tauri/src/main.rs:119-121` via `set_event_emitter`), usado pela fila de jobs e tarefas em segundo plano (`core/src/lib.rs:31-35`).
3. **Adaptador Tauri (`window.emit`)**: emissão direta no fechamento da janela.

### 1. Eventos via emissor global (`emit_background`)

| Módulo / Origem | `job` | `project` | `stage` possíveis | `percentage` | `error` |
|---|---|---|---|---|---|
| `core/src/jobs.rs:116` (`jobs::progress`) | `<job_id>` (ou `"0"` em `narration_record.rs:859`) | `Some(project_id)` | `"chat"` (`chat.rs`), `"timeline"` (`editor/assets.rs`), `"export"` (`export.rs`), `"energy"` (`energy.rs`), `"aligning"` (`narration_align.rs`), `"narration_import"` (`narration_import.rs`), `"narration_record"` (`narration_record.rs:859`), `"proxy"` (`proxy.rs`), `"reframe_proxy"` / `"reframe_scenes"` / `"reframe_faces"` (`reframe.rs`), `"transcribing"` (`transcription.rs`), `"narration"` (`tts/narration.rs`), `"waveform"` / `"thumbnails"` (`jobs/preview.rs`) | `0..100` (clamp `100`) | `None` |
| `core/src/jobs/preview.rs:130` (`progress_event`, fim de jobs não-`ai:*`) | `<job_id>` | `Some(project_id)` | `"complete"`, `"failed"` | `100` / `0` | `None` / `Some(CoreError)` |
| `core/src/jobs/ai.rs` (`ai::emit`, jobs `ai:<task>`) | `<job_id>` | `Option<project_id>` | `"ai:<task>:prepare"`, `"ai:<task>:call"`, `"ai:<task>:verify"`, `"ai:<task>:paused"`, `"ai:<task>:done"` (com `clip_id: Some(<clip_id>)` em `ai:translation`) | `0`, `10`, `80`, `100` | `Option<CoreError>` |
| `core/src/transcription.rs:391` (`auto_probe_before_transcription`) | `<job_id>` | `Some(project_id)` | `"probe"`, `"gpu_probe_fallback"` | `0..99` | `None` |
| `core/src/selection.rs:905` (`selection::emit`, `selection.start` / `selection.redo`) | `"selection-<run_id>"` | `Option<project_id>` | `"selection:window"`, `"selection:done"` | `0..100` | `None` / `Option<CoreError>` |
| `core/src/source_batches.rs:140` (`source_batches::emit`, `batches.*`) | `"batch-<batch_id>"` | `Option<project_id>` | `"batch:created"`, `"batch:item"`, `"batch:item-paused"`, `"batch:paused"`, `"batch:resumed"`, `"batch:cancelled"`, `"batch:completed"` | `0` | `None` / `Some(CoreError)` |
| `core/src/export/batch.rs:504` (`emit_batch_event`, `export.batch.*`) | `"export-batch-<batch_id>"` | `Option<project_id>` | `"export_batch"`, `"export_batch_complete"`, `"export_batch_cancelled"` | `0..100` | `None` |
| `core/src/editor/edits.rs:428` (`save`, `editor.adjust` / `editor.flush` / autosave) | `"editor:<clip_id>"` | `Some(project_id)` | `"editor_saved"` | `100` | `None` |
| `core/src/editor/edits.rs:446` (`start_autosave`, thread em segundo plano) | `"editor"` | `None` | `"editor_save_failed"` | `0` | `Some(CoreError)` |
| `core/src/projects/backups.rs` (`run_auto_backup`, backup automático em segundo plano) | `"backup"` | `Option<project_id>` | `"backup_complete"`, `"backup_failed"` | `100` / `0` | `None` / `Some(CoreError)` |

### 2. Eventos via `EventSink` da chamada (`events(...)`)

Todos abaixo emitem com `project: None` e `error: None`, exceto `provider.structured` quando falha (`error: Some(CoreError)`):

| Módulo / Comando | `job` | `stage` possíveis | `percentage` |
|---|---|---|---|
| `core/src/provider.rs:1081,1090` (`provider.structured`, `provider.test`, `provider.cost.run`) | `"provider.structured"` | `"starting"`, `"complete"`, `"failed"` | `0`, `100` |
| `core/src/components.rs:492,514` (`components.download` para `ffmpeg`, `yt-dlp`, `deno`, `pocket-tts`, `uv`) | `"<component_id>"` | `"download"`, `"complete"` | `0..99`, `100` |
| `core/src/components/catalog.rs:912` (`components.catalog.check`) | `"catalog"` | `"complete"` | `100` |
| `core/src/components/models.rs:417,467` (`components.models.download`: `whisper-turbo`, `whisper-small`, `yunet`, etc.) | `"<model_id>"` | `"download"`, `"complete"` | `0..99`, `100` |
| `core/src/components/update.rs:222,237` (`components.ytdlp.update`) | `"yt-dlp"` | `"update"`, `"complete"` | `0..99`, `100` |
| `core/src/components/worker.rs:298,510,554` (`components.worker.install`) | `"worker"` | `"download"` (ao baixar `uv`, 0..24%), `"worker"` (25, 45, 95), `"complete"` | `0..100` |
| `core/src/components/hardware.rs:660` (`transcription.hardware.probe`) | `"hardware-probe"` | `"probe"` | `0..100` |
| `core/src/transcription/estimate.rs:38` (`transcription.estimate`) | `"transcription-estimate"` | `"estimate"` | `0`, `10..60`, `100` |
| `core/src/sources.rs:167` (`sources.hash`, `sources.relocate`) | `v["job"]` (padrão `"source-hash"`) | `"hash"` | `0..100` |
| `core/src/url_import.rs:150` (`sources.url.download`) | `v["job"]` (obrigatório) | `"download"` | `0..100` |
| `core/src/tts/catalog.rs:1049,1075,1141` (`tts.models.download`) | `"tts:<model_id>"` | `"download"`, `"complete"` | `0..99`, `100` |
| `core/src/narration_record.rs:780,851,939` (`narration.record_block`, `narration.trim_block`) | `"narration_record"` | `"vad"`, `"done"` | `40`/`50`, `100` |
| `core/src/version.rs:5` (`app.version`) | `"app.version"` | `"complete"` | `100` |

### 3. Evento direto no adaptador Tauri (`src-tauri/src/main.rs`)

- **`editor_save_failed`** (`src-tauri/src/main.rs:90-108`): quando o usuário tenta fechar a janela (`WindowEvent::CloseRequested`), o Tauri chama sincronamente `clipes_core::dispatch("editor.flush", {})`. Se falhar, o fechamento é bloqueado (`api.prevent_close()`) e a janela recebe `core-progress` com `{ job: "editor", project: null, stage: "editor_save_failed", percentage: 0, message: "Não foi possível salvar o Corte.", error: Some(error) }`.

### 4. Comandos Tauri e transporte de mídia fora do `core_dispatch`

Além de `core_dispatch(name, arguments)` (`src-tauri/src/main.rs:25`), o adaptador Tauri expõe:
- **`media_base_url`** (`src-tauri/src/main.rs:12`): comando Tauri chamado uma vez na inicialização em `src/lib/media.ts:12`. No Linux, devolve `http://127.0.0.1:<porta>/<token_hex_64>` (do `MediaServer` em `src-tauri/src/media_server.rs`, criado para contornar limitações de `Range` do WebKitGTK); em Windows/macOS, devolve `null`.
- **Protocolo `clipes-media`** (`src-tauri/src/main.rs:45-79, 110-115`): esquema URI customizado assíncrono usado em Windows/macOS via `convertFileSrc(clean, 'clipes-media')` (`src/lib/media.ts:24`). Ambos os transportes (protocolo e servidor Linux) delegam para `clipes_core::media::serve(path, range)` (`core/src/media.rs`), que aceita **apenas** IDs opacos (`proxy/<64hex>`, `thumbs/<64hex>`, `source/<id>`, `narration/<id>`, `narration-original/<id>`, `narration-clean/<id>`, `audio/<id>`), valida `Origin` (`is_allowed_origin`) e entrega respostas parciais `206` em blocos de até `8 MiB` (`MAX_RESPONSE_BYTES`).

### 5. Como a UI atual escuta `core-progress`

A UI assina `listen('core-progress', ...)` de `@tauri-apps/api/event` em 19 pontos (`src/features/**`):
- **Por `project`:** `Jobs.tsx`, `SourceBatches.tsx` (`event.payload.project === projectId`).
- **Por `job`:** `Sources.tsx`, `ExportButton.tsx`, `BatchExport.tsx` (`job === export-batch-${id}` ou `String(job)`), `LocalEstimate.tsx` (`"transcription-estimate"`), `DenoCard.tsx` (`"deno"`), `HardwareCard.tsx` (`"hardware-probe"`), `WorkerCard.tsx` (`"worker"`).
- **Por `stage`:** `Editor.tsx` (`stage === 'editor_saved' || stage === 'editor_save_failed'`), `Components.tsx` (`'download' | 'update'`), `ModelsCard.tsx` (`'download'`), `PocketTtsCard.tsx`, `TtsCatalogCard.tsx`.
- **Sem filtro (dispara `sync()` em qualquer evento):** `CutPreview.tsx`, `Narration.tsx`, `Selection.tsx`, `Transcription.tsx`.

---

## Configurações deste domínio

| Preferência / Dado | Onde vive | Quem lê | Quem grava |
|---|---|---|---|
| Perfis HTTP/local, perfil `legacy`, `timeouts` globais (`remote`/`local`), `providers` (`confirmed`, `keyLastFour`) | `<config_dir>/provider.json` (Windows: `%LOCALAPPDATA%\io.github.gustavohooo.clipes\`; Linux/macOS: `config_local_dir`; ou `CLIPES_DATA_DIR`) | `provider.status`, `provider.profiles.list`, `provider.context.get`, `provider.selection_state`, `provider.structured`, `provider.test`, `provider.cost.*` | `provider.configure`, `provider.profiles.remove`, `provider.key.set`, `provider.key.remove`, `provider.confirm` |
| Seleção, confirmação, modelo OpenCode e `timeoutSeconds` de CLIs | `<config_dir>/provider-cli.json` | `provider.cli.status`, `provider.profiles.list`, `provider.structured`, `provider.test`, `provider.cost.*` | `provider.cli.configure`, `provider.cli.confirm`, `provider.configure` (limpa ao gravar `legacy`) |
| Chaves de API | Keyring do SO (serviço `io.github.gustavohooo.clipes.provider`, conta `<endpoint>` ou `profile:<id>`) | `provider.context.get`, `provider.structured`, `provider.test`, `provider.cost.run` | `provider.key.set`, `provider.key.remove`, `provider.configure` (ao desligar `ownKey`), `provider.profiles.remove` |
| Sobrescritas da tabela de preços | `<config_dir>/provider-prices.json` | `provider.prices.get`, `provider.profiles.list`, `provider.cost.estimate`, `provider.cost.run`, `provider.context.get`, `jobs.*` | `provider.prices.set`, `provider.prices.clear` |
| Amostras de calibração de tokens (máx. 20/chave) | `<config_dir>/token-calibration.json` | `provider.cost.estimate`, `provider.structured`, `jobs.*`, `diagnostic.get` | `provider.cost.run`, executor de jobs (`jobs/ai.rs`), `provider.profiles.remove` (limpa entradas do perfil) |
| Cache de descoberta/medição de contexto | `<config_dir>/provider-context.json` (`data_file` relativo a `provider.json`) | `provider.context.get`, `provider.selection_state`, `provider.status`, `provider.profiles.list`, `provider.structured` | `provider.context.get`, `provider.test` (`probeContext: true`), `provider.profiles.remove` |
| Rota padrão, rota por tarefa e veto `Somente local` por tarefa | `<config_dir>/assistant.json` | `provider.context.get`, `provider.selection_state`, `provider.structured`, `provider.test`, `provider.cost.*`, `assistant.*` | `assistant.*`, `provider.cli.configure` (`kind: ""` limpa escolhas de CLI) |
| Veto `Somente local` do Projeto | `project.sqlite` (tabela `project_privacy`) | `projects.local_only.get`, `provider.structured`, `provider.context.get`, `provider.cost.*`, `jobs.redo*` | `projects.local_only.set` |
| Fila de jobs, custos por chamada, orçamentos, pausas e auditoria | `project.sqlite` (tabelas `jobs`, `queue_project_identity`, `provider_costs`, `ai_budgets`, `ai_pauses`, `call_audit`) | `jobs.list`, `jobs.estimate`, `jobs.result`, `jobs.budget.get`, `jobs.redo*`, `provider.cost.list`, `provider.audit.list` | `jobs.cancel`, `jobs.retry`, `jobs.discard`, `jobs.budget.set`, `jobs.budget.continue`, `jobs.redo`, `provider.cost.run`, worker da fila |
| Isolamento de diretórios do app (testes/dev) | Variável de ambiente `CLIPES_DATA_DIR` | `core/src/paths.rs` (`resolve_with_env`) | Externa ao app |

---

## Observações para o front novo

1. **9 comandos do núcleo sem uso na UI (e sem mock TS):**
   - `provider.audit.list`, `provider.capabilities`, `provider.cost.run`, `provider.structured`, `jobs.budget.get`, `jobs.preview`, `jobs.redo`, `jobs.redo.estimate` e `jobs.result`.
   - O caso mais crítico para o produto é `provider.audit.list`: a tabela `call_audit` já é gravada em toda chamada de IA e transcrição paga, mas o usuário não tem onde ver a trilha de hashes/metadados no app. `jobs.budget.get` também está pronto para mostrar orçamentos por Tarefa de IA (não só por lote), e `jobs.redo` / `jobs.redo.estimate` generalizam "refazer com outro perfil" além de `selection`.
2. **Inconsistência de payload em `jobs.preview`:**
   - `jobs.preview` (`core/src/jobs/preview.rs:478`) exige `source_id` em `snake_case`, enquanto praticamente todo o domínio `provider.*`/`jobs.*` usa `camelCase` (`profileId`, `maxCostMicroUsd`, `inputPerMillion`), e devolve caminhos absolutos do disco em vez de URLs/chaves opacas do protocolo `clipes-media`.
3. **Configurações existentes no núcleo sem controle na UI:**
   - `provider.json` tem `timeouts` globais (`remote` e `local`), retornados em `provider.status` e `provider.profiles.list`, mas nenhuma tela os exibe nem há comando para editá-los (`provider.configure` só edita `timeoutSecs` por perfil, e `Timeouts::parse` em `core/src/provider/control.rs` não é ligado a nenhum comando).
   - `provider-cli.json` tem `timeoutSeconds` (aceito por `provider.cli.configure` e retornado em `provider.cli.status`), mas `CliSettings.tsx` não oferece campo para alterá-lo.
   - `provider.selection_state` e `provider.context.get` aceitam `task` para inspecionar a rota efetiva de uma Tarefa de IA específica, mas `SelectionState.tsx` só envia `profileId`.
4. **Lacunas e divergências importantes no Mock TS (`src/lib/core.ts` e `src/lib/batchMock.ts`):**
   - `jobs.budget.set` e `jobs.budget.continue` em `src/lib/batchMock.ts:51-57` só respondem para `scope === 'batch'` e retornam um objeto de orçamento de lote, enquanto o núcleo (`core/src/jobs/budget.rs:330`) retorna `{ budgets: [...] }`.
   - `jobs.list`, `jobs.estimate`, `jobs.retry`, `jobs.discard` e `provider.cost.list` em `src/lib/core.ts` dependem da flag de URL `?source-test=1`; sem ela, retornam vazio ou ignoram o comando.
   - `provider.cost.estimate` no mock retorna sempre `kind: 'usd'` fixo, sem simular `zero`, `plan_quota` ou `unknown`; `provider.prices.get` no mock lista apenas 1 modelo (`openai/gpt-5`) com data antiga (`2026-11-14`).
5. **Erros tipados ignorados pela UI atual e evento duplicado no núcleo:**
   - `ProviderSettings.tsx`, `ProviderProfiles.tsx`, `Costs.tsx` e `Jobs.tsx` colapsam a maioria dos códigos de erro (`local_only_violation`, `confirmation_required`, `rate_limit`, `provider_daily_limit`, `output_space_insufficient`, `context_truncated`, `output_truncated`, `refusal`, `invalid_json`, `vault`, `invalid_price`, `project_not_open`) em mensagens genéricas de falha.
   - Em `core/src/narration_record.rs:859`, `narration.record_block` emite `jobs::progress(0, "narration_record", 100, ...)` logo após emitir no `EventSink`, gerando um evento global extra com `job: "0"` sem linha correspondente na tabela `jobs`.
