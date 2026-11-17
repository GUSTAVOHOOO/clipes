# Pacote C — Cortes: Seleção e Revisão

Especificação das telas da **Macro-etapa 2 (Cortes)** do front-end v2 do Clipes, seguindo integralmente [01-arquitetura.md](../01-arquitetura.md), o glossário canônico ([GLOSSARY.md](../../../GLOSSARY.md)) e os contratos de comandos em [04-selecao-de-cortes.md](../funcionalidades/04-selecao-de-cortes.md), [02-projetos-e-fontes.md](../funcionalidades/02-projetos-e-fontes.md), [03-transcricao.md](../funcionalidades/03-transcricao.md) e [07-provedores-jobs-e-eventos.md](../funcionalidades/07-provedores-jobs-e-eventos.md).

---

## Sumário das superfícies do pacote

| Tela / Superfície | Rota (hash) | Papel no fluxo |
|---|---|---|
| **Tela C.1 — Configurador e Acompanhamento de Seleção** | `#/projeto/:id/cortes` (`?fonte=:fonteId&run=:runId&rev=:n`) | Escolher a Fonte transcrita, configurar tipo de vídeo e faixa de duração, conferir sinais locais (energia e chat) e compatibilidade da Janela de contexto, revisar estimativa/custo, disparar a seleção e acompanhar Janelas e Revisões da execução. |
| **Tela C.2 — Bancada de Revisão de Cortes** | `#/projeto/:id/cortes/revisao/:runId` (`?rev=:n&corte=:cid`) | Triagem mestre-detalhe de candidatos: filtrar e ordenar por Nota/estado, assistir proxy 9:16, ler eixos da Nota e justificativas, ajustar bordas em ±1 Frase (`I`/`O`), aprovar/rejeitar/desfazer, refazer com outro Perfil de Provedor, conferir guarda-corpos e abrir o Corte aprovado no Editor. |

---

## Tela C.1 — Configurador e Acompanhamento de Seleção

### 1. Objetivo e Navegação

* **Objetivo:** Configurar parâmetros de seleção de uma Fonte transcrita (tipo de vídeo, faixa de duração, sinais locais e compatibilidade de contexto), confirmar custo/privacidade antes do disparo e acompanhar o progresso por Janela de seleção e Revisões da execução.
* **De onde chega:**
  * Barra superior do Shell → aba **2. Cortes** (de qualquer rota do Projeto aberto);
  * Macro-etapa 1 (`#/projeto/:id/fontes/:fonteId`) via CTA **"Selecionar Cortes"** após Transcrição concluída (`?fonte=:fonteId`);
  * Retorno da Tela C.2 (`#/projeto/:id/cortes/revisao/:runId`) via breadcrumb/botão **"Voltar para seleção"**;
  * Redirecionamento de guarda de rota quando uma execução ou Corte não é encontrado em `#/projeto/:id/cortes/revisao/:runId` ou `#/projeto/:id/corte/:corteId/...`.
* **Para onde vai:**
  * **Tela C.2 — Bancada de Revisão** (`#/projeto/:id/cortes/revisao/:runId?rev=:n`) ao clicar em **"Revisar candidatos"** de uma execução com candidatos;
  * **Macro-etapa 1** (`#/projeto/:id/fontes`) quando nenhuma Fonte tem Transcrição concluída;
  * **Configurações de Provedores** (`#/config/provedores`) ou **Perfil de canal** (`#/config/projeto`) por links acionáveis de erro/aviso.
* **Guarda de rota:** Se não houver Projeto aberto (`projects.current === null`), redireciona para `#/inicio`. Ao entrar, carrega `sources.list`, `channel_profile.get`, `provider.profiles.list`, `provider.selection_state { task: "selection" }`, `jobs.budget.get` e `transcription.status` por Fonte para filtrar as Fontes com `transcript.state === "complete"`.

---

### 2. Layout por zonas

Sem scroll na moldura externa do Shell (`100vw × 100vh`); as duas colunas internas rolam de forma independente quando excedem a altura disponível.

#### Viewport 1366 px (notebook alvo)

```text
+----------------------------------------------------------------------------------+
| [Shell: Barra Superior 44px]  Projeto v | 1. Fontes | [2. Cortes] | 3. Export... |
+----------------------------------------------------------------------------------+
| CABECALHO DA FONTE E EXECUCAO (fixo no topo da area)                             |
| Fonte: [Live 12/11 - Ep. 42 (03:18:40) v]   |  Execucoes anteriores: [2]        |
+-----------------------------------------+----------------------------------------+
| COLUNA ESQUERDA (~42%, rolavel)         | COLUNA DIREITA (~58%, rolavel)         |
| CONFIGURADOR DE SELECAO                 | ACOMPANHAMENTO E HISTORICO             |
|                                         |                                        |
| [1. Tipo de video]                      | [Seletor de Execucao]                  |
|   (o) Corte direto   ( ) Video transf.  |   Execucao #14 (17/11 16:40) [v]       |
|   Herdado do Perfil de canal            |   Seletor de Revisao: [Rev. 1] [Rev. 2] |
|   [Faixa informativa Guardrails se ack  |                                        |
|    pendente para Corte direto]          | [Banner prioritario se uncertain /     |
|   Pesos da Nota: Gancho 30% · ...       |  pausa de orcamento / erro parcial]    |
|                                         |                                        |
| [2. Faixa de duracao do Corte]          | [Resumo da execucao selecionada]       |
|   Minimo (s): [ 20 ]  Maximo (s): [ 60 ]|   Estado: Concluida / Em andamento     |
|   [Restaurar padrao do canal (20-60 s)] |   12 candidatos · 3 juntados · 2 desc. |
|                                         |   Sinais congelados: Energia + Chat    |
| [3. Sinais locais da Fonte]             |   [ Abrir bancada de revisao -> ]      |
|   Energia do audio: [142 altas, 19 pico]|   [ Cancelar ] / [ Retomar janelas ]   |
|   Chat da live: [Disponivel: 24 picos]  |                                        |
|                                         | [Lista de Janelas de selecao]          |
| [4. Contexto e Custo (<ResumoCusto>)]   |   +----------------------------------+ |
|   Janela de contexto: Completa (15 min) |   | Janela 1 | 00:00-15:00 | Concluida | |
|   Rota: perfil-rapido · Remoto (HTTPS)  |   | Janela 2 | 12:00-27:00 | Falhou  [R]| |
|   Estimativa: ~13 janelas · ~US$ 0,04   |   | Janela 3 | 24:00-39:00 | Incerta [F]| |
|   Saldo orcamento: US$ 1,96 restante    |   +----------------------------------+ |
|                                         |   [R] Refazer janela / outro perfil    |
| [CTA Primario: Selecionar Cortes]       |   [F] Resolver incerteza na Fila       |
+-----------------------------------------+----------------------------------------+
| [Shell: Barra de Status 28-32px] Salvo · Sem jobs ativos · F6 trocar regiao      |
+----------------------------------------------------------------------------------+
```

#### Variação em 1440+ px (e 1920 px)

* A proporção muda para **~38% esquerda / ~62% direita** (com largura máxima de leitura dos controles de formulário ≤ 68 ch à esquerda para manter legibilidade).
* Na coluna direita, as **Janelas de seleção** passam de lista de 1 coluna para **grade responsiva de 2 colunas** (ou tabela completa com colunas: Janela, Intervalo na Fonte, Perfil usado, Estado e Ações), exibindo mais Janelas simultaneamente sem rolagem excessiva.

---

### 3. Conteúdo e componentes por zona

| Zona | Dados mostrados (comando.campo) | Controles e ordem de leitura |
|---|---|---|
| **Cabeçalho da Fonte e Execução** | `sources.list` (`id`, `path` → nome do arquivo, `metadata.duration_us`, `status`: `available` \| `offline` \| `changed`), filtrado por `transcription.status` (`transcript.state === "complete"`). | 1. Seletor de **Fonte** (`<select>` ou combobox acessível, ordenado por mais recente ou ID; atualiza `?fonte=:fonteId`).<br>2. Selo de saúde da Fonte no disco (se `offline`/`changed`, exibe aviso de que a seleção usa apenas texto, mas preview exigirá relocalização).<br>3. Link secundário *"Ver Transcrição"* (`#/projeto/:id/fontes/:fonteId`). |
| **Coluna Esquerda — 1. Tipo de vídeo** | `channel_profile.get` (`videoKind`, `directMonetizationAck`), `selection.estimate` (`weights`). Se `videoKind === "direct"` e `!directMonetizationAck`, usa `guardrails.check { scope: "source", source_id }` (`needsDirectNotice`). | 1. Grupo `radiogroup` **"Tipo de vídeo desta seleção"**: **Corte direto** (Canal de cortes) vs. **Vídeo transformado** (Canal dark).<br>2. Subtítulo indicando *"Herdado do Perfil de canal"* ou *"Sobrescrito só para esta execução"* + resumo da implicação (Corte direto vai direto ao Editor/Empacotamento; Vídeo transformado exige Ângulo → Roteiro aprovado → Narração).<br>3. Linha de pesos da Nota (`weights`: ex. *Gancho 30% · Autossuficiência 20%...* ou *Espaço para comentário 30% · Gancho 20%...*).<br>4. Se **Corte direto** e `needsDirectNotice === true`: aviso informativo não bloqueante sobre risco de monetização por conteúdo reutilizado + botão discreto **"Entendi o risco"** (`guardrails.ack_direct_notice`). |
| **Coluna Esquerda — 2. Faixa de duração** | `channel_profile.get` (`minUs`, `maxUs`, `limits.technicalMaxUs` = 300 s, `limits.maxUs` = 180 s). | 1. Campos numéricos em segundos: **Duração mínima (s)** e **Duração máxima (s)** (convertidos para microssegundos em `minUs`/`maxUs`).<br>2. Validação inline imediata (`minUs > 0`, `minUs < maxUs`, `maxUs <= 300 s`), com nota se passar de `60 s` (aviso sobre regra de música reivindicada em Shorts > 60 s).<br>3. Botão secundário **"Restaurar padrão do canal"** quando diferente de `channel_profile`. |
| **Coluna Esquerda — 3. Sinais locais da Fonte** | `energy.status { source_id }` (`measured`, `marks.high`, `marks.peak`, `job`); `chat.status { source_id }` (`state`, `canFetch`, `peaks`, `messages`, `job`). | 1. Cartão **Energia do áudio**: mostra contagem de Frases `high`/`peak` se `measured`, progresso se `queued`/`running` (com botão **Cancelar** via `jobs.cancel`), ou botão **"Medir energia do áudio"** (`energy.start`) se `!measured` e sem job ativo.<br>2. Cartão **Chat da live**: mostra picos e mensagens se `available`; estado *"Sem replay de chat"* se `absent`; progresso + **Cancelar** (`jobs.cancel`) se `queued`/`running`; ou botão **"Buscar chat da live"** (`chat.fetch`) quando `state === "none" && canFetch`. |
| **Coluna Esquerda — 4. Contexto, Estimativa e Disparo** | `provider.selection_state { task: "selection" }` (`applicable`, `state`, `contextTokens`, `reference`, `guides`); `selection.estimate { source_id, minUs, maxUs, videoKind }` (`paid`, `profile`, `plan.state`, `plan.windows.length`, `estimate`); `provider.profiles.list` + `assistant.tasks` (para resolver `local`/`cli`/host de destino); `jobs.budget.get` (teto ativo da tarefa `selection`). | 1. Indicador de compatibilidade da **Janela de contexto** (`full`: janelas de até 15 min; `reduced`: janelas encurtadas pelo contexto do modelo; `blocked`: contexto insuficiente + orientações de `guides` e link para `#/config/provedores`; CLI: *"Contexto gerenciado pelo CLI"*).<br>2. `<ResumoCustoPrivacidade>` pré-disparo: rota resolvida, privacidade (`Local (loopback)` / `Remoto (HTTPS)` / `CLI`), nº de janelas planejadas, tokens e faixa estimada em USD / `US$ 0,00` / `Consome cota do plano` / `Custo desconhecido`, e saldo do orçamento se houver.<br>3. Botão primário **"Selecionar Cortes"** (`selection.start`), desabilitado apenas quando `plan.state` estiver bloqueado, já houver execução `running` nesta Fonte ou `minUs`/`maxUs` estiver inválido. |
| **Coluna Direita — Histórico, Revisão da Execução e Janelas** | `selection.list { source_id }`; `selection.get { run, revision }` (`run`, `windows[]`, `candidates[]`). | 1. Seletor de **Execução** (`selection.list`, da mais recente à mais antiga, exibindo data/hora, tipo de vídeo, nº de candidatos e estado).<br>2. **Seletor de Revisão da execução** (visível quando `run.revisions.length > 1`, ex.: tabs/segmented `Revisão 1`, `Revisão 2 (atual)` chamando `selection.get { run, revision }`).<br>3. Banners prioritários no topo do painel quando aplicável:<br>   - `run.budgetPause !== null` → banner de pausa por orçamento com **"Ajustar orçamento e continuar"** (`jobs.budget.continue`).<br>   - Alguma janela com `state === "uncertain"` → banner prioritário *"Chamada paga incerta — resolva antes de repetir"* com botão por janela para abrir confirmação (`jobs.estimate` → `jobs.retry` ou `jobs.discard`).<br>4. Resumo da execução (`counts`, sinais congelados em `run.summary`, perfil usado) + CTA primário **"Abrir bancada de revisão"** (`#/projeto/:id/cortes/revisao/:runId?rev=:n`, habilitado quando `candidates.length > 0`).<br>5. Lista/Grade de **Janelas de seleção** (`windows[]`): índice (`Janela 1..N`), faixa `startUs–endUs` (`tabular-nums`), perfil que gerou (`w.profile`), estado traduzido, motivo do erro traduzido (`w.code` + `resetAtMs` se limite diário) e ações por janela: **"Refazer janela"** (`selection.redo` sem trocar perfil, apenas se `failed`/`cancelled`) e **"Refazer com outro Perfil"** (`selection.estimate` + `<ConfirmDialog>` + `selection.redo { profileId }`, se não `queued`/`running`/`uncertain`). |

---

### 4. Ações

| Ação | Comando(s) do núcleo | Pré-condições | Confirmação / Cartão de custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Mudar Fonte / parâmetros (`videoKind`, `minUs`, `maxUs`) | `selection.estimate` (debounced) + `guardrails.check` (se `direct`) | Fonte com `transcript.state === "complete"` | Não (leitura local síncrona) | Atualiza plano de Janelas, pesos da Nota e `<ResumoCustoPrivacidade>`. | Botão *"Restaurar padrão do canal"* |
| Medir energia do áudio | `energy.start { source_id }` | Transcrição completa; `!energy.measured` | Não (local, `US$ 0,00`) | Exibe progresso do job `energy`; ao concluir, recarrega `energy.status` e refaz `selection.estimate`. | Cancelável via `jobs.cancel` |
| Buscar chat da live | `chat.fetch { source_id }` | `origin_url` presente; `yt-dlp` disponível | Não (local; avisa se faltar `yt-dlp`) | Exibe progresso do job `chat`; ao concluir, atualiza `chat.status` e refaz `selection.estimate`. | Cancelável via `jobs.cancel` |
| Entender risco do Corte direto | `guardrails.ack_direct_notice {}` | Projeto aberto | Não (ação única por canal) | Oculta aviso único de monetização (`directMonetizationAck = true`). | Não aplicável |
| Iniciar seleção de Cortes | `selection.estimate` → `selection.start { source_id, minUs, maxUs, videoKind, confirmed }` | Fonte transcrita; Provedor configurado; sem seleção `running` na Fonte; respeito a `local_only` | **Sim, se `paid === true` ou CLI**: abre `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` exigindo `confirmed: true` | Cria `run`, enfileira `N` jobs na fila, seleciona a nova execução na coluna direita e inicia atualização via `core-progress`. | Cancelar via `selection.cancel` |
| Cancelar seleção em andamento | `selection.cancel { run }` | `run.state === "running"` | `<ConfirmDialog>` se houver job pago `running` (*"Chamada já enviada ao Provedor pode ficar como incerta"*) | Janelas `queued` viram `cancelled`; janela em curso encerra como `cancelled` ou `uncertain`; atualiza `selection.get`. | Retomar falhas com `selection.resume` |
| Retomar janelas falhas/canceladas | `selection.estimate { run }` → `selection.resume { run, confirmed }` | `run.state === "partial"` com janelas `failed`/`cancelled` e **sem** incluir janelas `uncertain` | **Sim, se `paid === true` ou CLI**: `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` | Reenfileira apenas janelas falhas/canceladas e coloca `run.state` em `running`. | Cancelar via `selection.cancel` |
| Refazer janela(s) com outro Perfil | `provider.profiles.list` → `selection.estimate { run, windows, profileId }` → `selection.redo { run, windows, profileId, confirmed: true }` | Janela elegível (não `queued`/`running`/`uncertain`); respeito a `local_only` | **Sempre exibe `<ConfirmDialog>`** com perfil escolhido, se texto sai da máquina (`leavesMachine`), e estimativa | Reabre execução para `running`; ao concluir ao menos 1 janela, incrementa `revision` preservando revisões e decisões anteriores. | Revisão anterior continua acessível no seletor `revision` |
| Resolver janela `uncertain` | `jobs.estimate { id: jobId }` → `jobs.retry { id: jobId, confirmed: true }` ou `jobs.discard { id: jobId }` | `window.state === "uncertain"` e `jobId !== null` | `<ConfirmDialog>` obrigatório mostrando estimativa de repetir vs. descartar | Se `retry`: janela volta para `queued`. Se `discard`: job vira `cancelled` e libera uso de `selection.resume`/`redo`. | Não aplicável |
| Ajustar orçamento e continuar | `jobs.budget.continue { scope, key, maxCostMicroUsd?, confirmed?, resetUsage? }` | `run.budgetPause !== null` | `<ConfirmDialog>` com formulário de teto e consumo atual (`jobs.budget.get`) | Limpa pausa em `ai_pauses`; fila retoma jobs `queued` da execução. | Editável em `#/config/custos` |
| Trocar Revisão da execução | `selection.get { run, revision }` | `run.revisions.length > 1` | Não | Atualiza lista de candidatos e estados de janela da revisão selecionada (`?rev=:n`). | Trocar de volta no seletor |

---

### 5. Estados da tela

1. **`loading` (carregando):**
   * `<Skeleton>` nas duas colunas (controles do configurador à esquerda; cabeçalho + 4 cartões de janela à direita). Nunca exibe lista vazia antes da primeira resposta.
2. **`empty` (vazio — dois cenários distintos):**
   * *Sem Fontes com Transcrição concluída no Projeto:* estado vazio central com título **"Nenhuma Fonte transcrita ainda"**, texto *"Transcreva uma Fonte na etapa anterior antes de selecionar Cortes."* e CTA primário **"Ir para Fontes e Transcrição"** (`#/projeto/:id/fontes`).
   * *Fonte transcrita, mas nenhuma seleção rodada ainda (`selection.list` vazio):* coluna esquerda pronta para configurar e disparar; coluna direita exibe estado vazio com título **"Nenhuma seleção executada nesta Fonte"**, texto *"Ajuste a duração desejada ao lado e clique em Selecionar Cortes para ver os candidatos e as Notas."* e botão secundário que foca o botão **"Selecionar Cortes"**.
   * *Execução concluída com `0` candidatos (`candidates.length === 0`):* exibe **"Nenhum Corte encontrado nesta seleção"**, texto *"O Provedor não encontrou trechos dentro dos critérios e da faixa de duração. Tente ampliar a faixa ou refazer com outro Perfil."* com CTA **"Refazer com outro Perfil"**.
3. **`error` (erro — container `role="alert"` com tradução do `CoreError.code`):**
   * `context_too_small` / `max_cut_too_long` → *"A Janela de contexto deste Perfil de Provedor é pequena para a duração máxima escolhida."* + botões **"Reduzir duração máxima"** (foca campo `maxUs`) e **"Trocar Perfil de Provedor"** (`#/config/provedores`).
   * `local_only_violation` → *"Bloqueado pelo modo Somente local: o Provedor configurado envia texto para fora da máquina."* + botões **"Escolher Perfil local"** (`#/config/provedores`) e **"Ver veto do Projeto"** (`#/config/projeto`).
   * `profile_unavailable` / `invalid_settings` → *"O Perfil de Provedor configurado para seleção não está disponível ou está incompleto."* + botão **"Configurar Tarefa de seleção"** (`#/config/provedores`).
   * `confirmation_required` → *"Este Perfil de Provedor exige confirmação antes de enviar texto."* + botão **"Confirmar e continuar"**.
   * `vault` / `cli_auth_required` → *"Falta autenticar ou atualizar a chave deste Provedor."* + botão **"Ir para Provedores"** (`#/config/provedores`).
   * `transcript_incomplete` / `no_sentences` → *"A Transcrição desta Fonte ainda não foi concluída ou não tem Frases."* + botão **"Abrir Transcrição"** (`#/projeto/:id/fontes/:fonteId`).
   * `project_busy` / `project_not_open` → conforme mapeador global da arquitetura.
   * Qualquer outro código cai no mapeador global + botão recolhido *"Ver detalhe técnico"*.
4. **`job_running` (seleção em curso):**
   * Configurador esquerdo permanece legível (com aviso *"Seleção em andamento para esta Fonte"* e botão de disparo desabilitado para evitar duplicidade acidental; usuário pode continuar editando outros parâmetros ou navegar para outra etapa).
   * Coluna direita mostra barra de progresso determinística `X de Y Janelas concluídas`, estágio atual (`Preparando…` → `Consultando Provedor…` → `Verificando resposta…`) e botão **"Cancelar seleção"**.
5. **`partial` (execução parcial):**
   * Faixa de aviso no topo da coluna direita: *"Seleção parcial: {completed} de {windows} Janelas concluídas, {failed} pendente(s)."*
   * Candidatos das janelas concluídas já ficam acessíveis via **"Abrir bancada de revisão"** (com alerta de que faltam janelas), e os botões **"Retomar janelas pendentes"** ou **"Resolver na Fila"** ficam em destaque.
   * Se houver pausa de orçamento (`run.budgetPause !== null`): faixa *"Seleção pausada pelo teto de orçamento"* + botão **"Ajustar orçamento e continuar"**.
6. **`sem permissão / pré-condição`:**
   * Se não houver Provedor configurado para `selection` (`profile_unavailable`): faixa de pré-condição no configurador substituindo o `<ResumoCustoPrivacidade>` por **"Configure um Perfil de Provedor para selecionar Cortes"** + CTA **"Configurar Provedores"** (`#/config/provedores`).
   * Se a Fonte estiver `offline` ou `changed`: aviso informativo no cabeçalho permitindo rodar seleção (a Transcrição está no SQLite), porém alertando que o preview 9:16 exigirá relocalizar a mídia.

---

### 6. Eventos (`core-progress`)

A tela consome o **Store global de Fila de Jobs** (que assina `core-progress`), sem criar listeners isolados:

| `job` | `stage` | O que atualiza na tela |
|---|---|---|
| `<job_id>` (janelas da execução ativa) | `ai:selection:prepare` / `ai:selection:call` / `ai:selection:verify` (ou `ai:selection_transformed:*`) | Atualiza o sub-estágio visual na ficha da Janela correspondente (`Preparando`, `Enviando ao Provedor`, `Validando`). |
| `<job_id>` | `ai:selection:paused` / `ai:selection_transformed:paused` | Dispara recarga de `selection.get` e `jobs.budget.get` para exibir o banner de pausa por orçamento. |
| `<job_id>` | `ai:selection:done` / `ai:selection_transformed:done` | Atualiza o estado da Janela específica (`completed`, `failed`, `cancelled`, `uncertain`) e, em erro, exibe mensagem traduzida. |
| `"selection-<run>"` | `selection:window` | Atualiza a barra de progresso global da execução (`percentage`, `completed + failed / total`) e revalida `selection.get`. |
| `"selection-<run>"` | `selection:done` | Recarrega `selection.get` e `selection.list`; muda execução para `completed` ou `partial`; habilita CTA **"Abrir bancada de revisão"** (o Shell exibe toast com ação direta). |
| `<energy_job_id>` | `energy`, `complete`, `failed` | Atualiza progresso da medição de energia; ao concluir (`complete`), recarrega `energy.status` e recalcula `selection.estimate`. |
| `<chat_job_id>` | `chat`, `complete`, `failed` | Atualiza progresso da busca do chat; ao concluir (`complete`), recarrega `chat.status` e recalcula `selection.estimate`. |

---

### 7. Teclado e acessibilidade

* **Regiões para `F6` / `Shift+F6`:**
  1. Barra superior do Shell (`<header>`);
  2. Cabeçalho da Fonte + Configurador de Seleção (`<aside>` / região esquerda);
  3. Painel de Acompanhamento e Janelas (`<main>` / região direita);
  4. Barra de Status do Shell (`<footer>`).
* **Padrões WAI-ARIA APG:**
  * Seletor de **Tipo de vídeo**: `role="radiogroup"` com `aria-labelledby`, setas `↑`/`↓` ou `←`/`→` alternando entre `Corte direto` e `Vídeo transformado`.
  * Seletor de **Revisão da execução**: `role="tablist"` (quando ≤ 5 revisões) ou `<select>` nativo estilizado com `.foco` (quando > 5), anunciando *"Revisão N de M"*.
  * Lista/Grade de **Janelas de seleção**: `role="list"` com cada Janela contendo cabeçalho acessível (`aria-label="Janela 2, de 12:00 a 27:00, falhou"`) e botões próprios alcançáveis via `Tab`.
  * Diálogos de confirmação de custo, cancelamento e orçamento: `<ConfirmDialog>` (`role="alertdialog"` ou `role="dialog"`, `aria-modal="true"`, focus trap incluindo `<textarea>` e retorno de foco ao gatilho ao fechar).
  * Anúncios de progresso e mudança de estado: `role="status"` com `aria-live="polite"` com *throttle* (anuncia conclusão de seleção, mudança de revisão ou erro em `role="alert"`).
* **Atalhos da tela:**
  * `Ctrl/Cmd+K`: Paleta de comandos;
  * `Ctrl/Cmd+J`: Abrir/fechar Fila de Jobs;
  * `Ctrl/Cmd+,`: Abrir Configurações;
  * `F6` / `Shift+F6`: Ciclar regiões;
  * `?` (ou `Ctrl/Cmd+/`): Ajuda rápida de atalhos.
* **Alvos e contraste:** Todos os botões, radios e inputs usam `.foco` e área clicável ≥ 24×24 CSS px; durações, contagens e valores USD usam `tabular-nums`; estados das Janelas combinam ícone + texto + badge (nunca só cor).

---

### 8. US da issue #26 atendidas

* **US-28, US-29, US-30:** Custo estimado antes de rodar, pausa por orçamento (`jobs.budget.continue`) e indicação de cota de plano para CLIs.
* **US-31, US-32, US-33:** Erro claro sem troca automática de Provedor, opção explícita de **"Refazer com outro Perfil"** e proteção contra repetição às cegas em chamadas `uncertain`.
* **US-41, US-59, US-60, US-61, US-63:** Herança e sobrescrita do Perfil de canal (`Corte direto` vs. `Vídeo transformado`), faixa de duração em Frases inteiras, pesos visíveis (incluindo `Espaço para comentário` no Vídeo transformado).
* **US-62, US-125, US-126:** Medição/exibição de picos de energia do áudio (`energy.*`) e busca/uso do replay de chat do YouTube (`chat.*`).
* **US-51:** Acompanhamento de progresso por Janela e cancelamento (`selection.cancel`).

---

### 9. Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:**
  1. `sources.list` não traz o estado da Transcrição (`transcriptState`), obrigando o front a disparar `N` chamadas `transcription.status` para filtrar Fontes prontas na entrada de `#/projeto/:id/cortes`. (Funciona com chamadas paralelas, mas um campo resumo em `sources.list` simplificaria a abertura.)
  2. `selection.estimate` no Modo 1 (nova seleção) retorna `profile: string` (ID ou rótulo), mas não retorna `leavesMachine` nem `kind`/`model` estruturados como faz no Modo 3 (`{ profile: { id, label, kind, model }, leavesMachine }`), exigindo cruzamento adicional com `provider.profiles.list` e `assistant.tasks` para montar `<ResumoCustoPrivacidade>`.
  3. `selection.resume` no Rust (`core/src/selection.rs:1558`) aponta para o mesmo handler de `selection.redo` e mapeia `uncertain` dentro de `Outcome::Failed` quando chamado sem `profileId`; até haver guarda explícita no Rust bloqueando `selection.resume` se houver `uncertain`, o front bloqueia a chamada na UI e direciona para resolução explícita na Fila.
  4. `energy.start` já existe no Rust (`core/src/energy.rs:484`), mas não possui implementação em nenhuma tela da v1; nenhuma alteração de Rust necessária para chamá-lo.
* **Mock TS (`src/lib/core.ts` e `src/lib/batchMock.ts`):**
  1. Remover o portão obrigatório de query params `?source-test` e `?transcript-test` em `selectionMockDispatch`, `energy.status` e `chat.status`.
  2. Adicionar handlers no mock para `energy.start` (inexistente hoje), `jobs.budget.get` (inexistente hoje) e corrigir `jobs.budget.set`/`continue` em `batchMock.ts` para suportar `scope: "task"` retornando `{ budgets: [...] }`.
  3. Corrigir `selection.list` e `selection.get` no mock para incluir `minUs`, `maxUs`, `planState`, `revision`, `revisions` e `window.profile` / `window.jobId` (idênticos ao Rust).
  4. Corrigir `chat.status` no mock para retornar `intervals` e `messages` além de `peaks`.
  5. Simular eventos `core-progress` (`ai:selection:*`, `selection:window`, `selection:done`, `energy`, `chat`) no barramento do mock em tempo real, permitindo simular estado `uncertain` e `budgetPause` via query param de teste (ex.: `?estado=parcial` / `?cenario=uncertain`).

---

### 10. Critérios de aceite (E2E / Playwright com o mock)

1. Com `?estado=vazio` (sem Fontes transcritas), `#/projeto/demo/cortes` exibe **"Nenhuma Fonte transcrita ainda"** e o botão **"Ir para Fontes e Transcrição"** recebe foco/navega para `#/projeto/demo/fontes`.
2. Com Projeto demo carregado, `#/projeto/demo/cortes` exibe o configurador pré-preenchido com o `videoKind` e a faixa `minUs`/`maxUs` do `channel_profile.get` e o selo de compatibilidade de `provider.selection_state`.
3. Alterar a faixa de duração (ex.: mínimo `30 s`, máximo `90 s`) atualiza a estimativa via `selection.estimate` e exibe aviso não bloqueante sobre limite de 60 s em Shorts com música reivindicada.
4. Clicar em **"Medir energia do áudio"** quando `energy.measured === false` chama `energy.start`, exibe progresso simulado via `core-progress` e atualiza a contagem de Frases com energia alta/pico sem recarregar a página.
5. Ao clicar em **"Selecionar Cortes"** com um Provedor pago no mock, um `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` (rota, destino remoto/local, custo estimado e saldo de orçamento) é exibido e só chama `selection.start { confirmed: true }` após confirmação.
6. Durante `selection.start`, as Janelas atualizam progressivamente de `queued` → `running` → `completed` via `core-progress` sem `setInterval` e habilitam **"Abrir bancada de revisão"** ao receber `selection:done`.
7. Em uma execução com janela `uncertain` simulada, o botão **"Retomar janelas pendentes"** fica bloqueado/oculto para aquela janela, o banner prioritário de incerteza aparece e clicar em **"Resolver na Fila"** abre o fluxo de estimativa (`jobs.estimate`) antes de `jobs.retry`/`jobs.discard`.
8. Em uma execução com `revisions: [1, 2]`, alternar no seletor de **Revisão da execução** dispara `selection.get { run, revision: 1 }` e atualiza a query `?rev=1` e a contagem de candidatos na tela.
9. Com `?estado=erro` simulando `local_only_violation`, a região `role="alert"` exibe a mensagem em PT-BR sem código cru e oferece os botões **"Escolher Perfil local"** e **"Ver veto do Projeto"**.

---

## Tela C.2 — Bancada de Revisão de Cortes

### 1. Objetivo e Navegação

* **Objetivo:** Permitir que o usuário filtre, assista em proxy 9:16, entenda a Nota explicável e picos de chat, ajuste bordas em ±1 Frase, aprove/rejeite/desfaça decisões, refaça Janelas com outro Perfil de Provedor e envie Cortes aprovados para o Editor.
* **De onde chega:**
  * Tela C.1 (`#/projeto/:id/cortes`) ao clicar em **"Abrir bancada de revisão"** de uma execução (`#/projeto/:id/cortes/revisao/:runId?rev=:n`);
  * Retorno da Tela do Corte (`#/projeto/:id/corte/:corteId/...`) via breadcrumb **"2. Cortes / Revisão"**;
  * Toast da Fila de Jobs após conclusão de `selection:done` (botão **"Revisar Cortes"**);
  * Guarda de rota da Macro-etapa 3 (`#/projeto/:id/exportacao`) quando ainda não há Cortes aprovados.
* **Para onde vai:**
  * **Tela do Corte — Editar** (`#/projeto/:id/corte/:corteId/editar`) ao clicar em **"Abrir no editor"** ou pressionar `Enter` em um Corte aprovado;
  * **Tela C.1** (`#/projeto/:id/cortes?fonte=:fonteId&run=:runId&rev=:n`) pelo botão **"Voltar à seleção"**;
  * **Macro-etapa 3 — Exportação** (`#/projeto/:id/exportacao`) pelo atalho de cabeçalho **"Ir para Exportação (N aprovados)"** quando houver ao menos 1 Corte aprovado.
* **Guarda de rota:** Se não houver Projeto aberto → `#/inicio`. Se `:runId` não existir (`run_not_found`) → `#/projeto/:id/cortes` com toast explicativo. Ao entrar, carrega `selection.get { run, revision }`, `selection.review { run }`, `sources.list`, `provider.profiles.list`, inicia `proxy.request` para o candidato selecionado (se a Fonte estiver `available`) e, se o candidato selecionado estiver `approved`, carrega `guardrails.check { scope: "single", source_id, candidate_id }` (e `angles.get { candidate }` somente quando `run.videoKind === "transformed"` e `status === "approved"`).

---

### 2. Layout por zonas

Ocupa 100% da largura da janela dentro do Shell, sem `max-w-4xl`. Apenas a lista de candidatos à esquerda e o painel de detalhe à direita têm rolagem interna independente.

#### Viewport 1366 px (notebook alvo)

```text
+----------------------------------------------------------------------------------+
| [Shell: Barra Superior 44px]  Projeto v | 1. Fontes | [2. Cortes] | 3. Export... |
+----------------------------------------------------------------------------------+
| SUB-CABECALHO DE REVISAO (fixo)                                                  |
| <- Voltar | Execucao #14 · [Corte direto] · Rev: [v2 (atual) v]                  |
| 3 aprovados · 2 rejeitados · 7 pendentes  |  [Desfazer (Ctrl+Z)] | [Exportar (3)]|
+------------------------------------+---------------------------------------------+
| LISTA DE CANDIDATOS (~36%, rolavel)| BANCADA DE DETALHE (~64%, rolavel)          |
|                                    |                                             |
| [Filtros e Ordenacao]              | +-------------------+ +-------------------+ |
|   Estado: [Todos|Pend.|Aprov.|Rej.]| | PREVIEW 9:16      | | NOTA E MOTIVO     | |
|   Nota min: [0,0 =====o=== 10,0]   | | +---------------+ | | Nota: 8,40 / 10   | |
|   Ordenar: [Maior Nota v]          | | |  Proxy Video  | | | [Espaco coment.30]| |
|                                    | | |     9:16      | | | [Gancho       20] | |
| [ListaVirtualizada (listbox)]      | | |               | | | [Energia      15] | |
| +--------------------------------+ | | +---------------+ | | ... + motivo why  | |
| | > 8,40  00:14:10-00:14:58 (48s)| | | [|<] [>] [>|]    | | [Chat 3,1x · ris.]| |
| |   "Momento da virada na partida| | | 00:12 / 00:48     | | Janelas 1,2 · Rev2| |
| |   [Pendente] [Chat 3,1x]       | | +-------------------+ +-------------------+ |
| +--------------------------------+ |                                             |
| |   7,90  01:02:05-01:02:47 (42s)| | BORDAS POR FRASE (±1 Frase)                 |
| |   "Explicacao do bug ao vivo"  | |   Entrada (I / Shift+I): [-1] [+1] "Quando.."|
| |   [Aprovado · ajustado]        | |   Saida   (O / Shift+O): [-1] [+1] "..pronto."|
| +--------------------------------+ |   Duracao: 00:48 (faixa 20 s - 60 s)        |
| |   7,10  02:15:30-02:16:00 (30s)| |                                             |
| |   [Rejeitado]                  | | DECISAO E PASSAGEM                          |
| +--------------------------------+ |   [ Aprovar (A) ] [ Rejeitar (R) ]          |
|                                    |   [ Abrir Corte no Editor (Enter) -> ]      |
|                                    |                                             |
|                                    | [Guardrails (quando aprovado)]              |
|                                    |   Permissao: Concedida | Duracao <= 60s     |
|                                    |   (Se transformed: Angulo pendente na aba   |
|                                    |    Transformar · Se direct: aviso unico)    |
|                                    |                                             |
|                                    | [Refazer com outro Perfil]                  |
|                                    |   Perfil: [Modelo Forte v] [Refazer janela] |
+------------------------------------+---------------------------------------------+
| [Shell: Barra de Status 28-32px] Salvo · I/O bordas · A/R aprova/rejeita · F6    |
+----------------------------------------------------------------------------------+
```

#### Variação em 1440+ px (e 1920 px)

* **Lista de candidatos à esquerda** fica fixa em ~32% (`~440–480 px`), exibindo título completo em 2 linhas e prévia do trecho inicial sem truncamento agressivo.
* **Bancada de detalhe à direita** (~68%) ganha folga horizontal para manter **Preview 9:16** (esquerda do detalhe) e **Eixos da Nota + Motivo** (direita do detalhe) confortavelmente lado a lado sem quebrar os eixos em coluna estreita, e em 1920 px pode mostrar a **Transição de Frases** (Frase anterior / borda Entrada / borda Saída / Frase seguinte) sem precisar de rolagem vertical para alcançar os botões **Aprovar / Rejeitar / Abrir no Editor**.

---

### 3. Conteúdo e componentes por zona

| Zona | Dados mostrados (comando.campo) | Controles e ordem de leitura |
|---|---|---|
| **Sub-cabeçalho de Revisão** | `selection.get` (`run.id`, `run.videoKind`, `run.revision`, `run.revisions`, `run.state`); contadores derivados de `selection.review` (`items[].status`). | 1. Botão **"Voltar à seleção"** (`#/projeto/:id/cortes?fonte=:fonteId&run=:runId&rev=:n`).<br>2. Título da execução + selo de tipo (`Corte direto` ou `Vídeo transformado`).<br>3. Seletor **"Revisão da execução"** (quando `run.revisions.length > 1`, lista `v1`, `v2 (atual)` via `selection.get { run, revision }`).<br>4. Contadores ao vivo (`aria-live="polite"`): *"{N} aprovados · {M} rejeitados · {P} pendentes"*.<br>5. Botão **"Desfazer decisão"** (`selection.undo`, atalho `Ctrl/Cmd+Z`, desabilitado se `!canUndo`) com tooltip explícito: *"Desfaz a última aprovação, rejeição ou ajuste desta execução"*.<br>6. Botão **"Ir para Exportação"** (`#/projeto/:id/exportacao`, habilitado quando `approved > 0`). |
| **Coluna Esquerda — Filtros e Lista de Candidatos** | `selection.get` (`candidates[]`: `id`, `rank`, `startUs`, `endUs`, `total`, `title`, `chat`, `adjusted`, `revision`, `profile`); `selection.review` (`items[]`: `status`, `adjusted`, `startUs`, `endUs`). | 1. Barra de filtros:<br>   - Filtro por estado (`Todos`, `Pendentes`, `Aprovados`, `Rejeitados`) com contadores;<br>   - Slider/campo **Nota mínima** (`0,0` a `10,0`, passo `0,5`);<br>   - Ordenação (`Maior Nota` vs. `Ordem na Fonte`).<br>2. `<ListaVirtual>` com `role="listbox"` (`aria-activedescendant`, sem `tabIndex={-1}`!). Cada opção mostra:<br>   - Nota total formatada com vírgula em `tabular-nums` (ex.: `8,40`), intervalo `startUs–endUs` e duração;<br>   - Título do candidato (ou *"Sem título"*);<br>   - Selo de estado com ícone + texto (*Pendente*, *Aprovado*, *Rejeitado*) + marca *"· ajustado"* quando `review.adjusted`;<br>   - Selo de maior pico de chat (`chat X× acima do normal`) se `c.chat?.length > 0`. |
| **Detalhe — Bloco Superior: Preview 9:16 + Nota Explicável** | `proxy.request` / `proxy.status` / `proxy.map_time`; `selection.get` (`candidates[]`: `axes`, `weights`, `total`, `chat`, `windows`, `profile`, `revision`, `adjust`). | **Lado do Player:**<br>1. `<PlayerProxy>` em proporção 9:16 (mostrando barra de progresso se proxy estiver `queued`/`running`, botão **Cancelar** via `jobs.cancel`, e recorte visual central de referência do trecho `[startUs, endUs]`).<br>2. Barra de transporte (`role="toolbar"`): Reproduzir/Pausar (`Espaço`/`K`), Rebobinar (`J`), Avançar (`L`), salto ±1 quadro ou ±1 Frase (`←`/`→`, `Shift+←`/`Shift+→`), relógio `atual / duração` em `tabular-nums`, e botão **"Ir para o início do Corte"**.<br><br>**Lado da Nota e Motivo:**<br>1. Nota total (`total` / `10,00`), perfil e revisão de origem (`"Gerado por {profile} · revisão {revision}"`) e Janelas de origem (`"Janelas 1, 2"`).<br>2. Se `c.adjusted === true` (ajuste automático de `fit`), indicação discreta (*"Bordas ajustadas na seleção: começo estendido / fim encurtado"*).<br>3. Lista de eixos da Nota (`weights` + `axes[key].score` + `axes[key].why`): no **Vídeo transformado**, **Espaço para comentário (30%)** vem em primeiro destaque.<br>4. Chips de todos os picos de chat (`"chat 3,1× acima do normal · risadas · 00:14:22"`). |
| **Detalhe — Bloco Médio: Ajuste de Bordas por Frase** | `selection.review` (`startText`, `endText`, `startUs`, `endUs`, `moves: { startEarlier, startLater, endEarlier, endLater }`); `run.minUs`, `run.maxUs`. | 1. Linha **Entrada (Início)**: botões **Recuar 1 Frase (`I`)** (`delta: -1`) e **Avançar 1 Frase (`Shift+I`)** (`delta: +1`), desabilitados conforme `!moves.startEarlier`/`!moves.startLater`, ao lado da citação da Frase inicial (`review.startText`).<br>2. Linha **Saída (Fim)**: botões **Recuar 1 Frase (`O`)** (`delta: -1`) e **Avançar 1 Frase (`Shift+O`)** (`delta: +1`), desabilitados conforme `!moves.endEarlier`/`!moves.endLater`, ao lado da citação da Frase final (`review.endText`).<br>3. Linha de metadado: *"Duração atual: 00:48 (limites desta execução: 20 s – 60 s) · Bordas sempre em Frase inteira."* |
| **Detalhe — Bloco Inferior: Decisão, Guardrails, Passagem e Refazer** | `selection.decide`, `guardrails.check { scope: "single", source_id, candidate_id }`, `guardrails.ack_direct_notice`, `angles.get { candidate }` (se `transformed && approved`), `provider.profiles.list`, `selection.estimate`, `selection.redo`. | 1. Barra de decisão e passagem:<br>   - **Aprovar (`A`)** (`aria-pressed={status === "approved"}`);<br>   - **Rejeitar (`R`)** (`aria-pressed={status === "rejected"}`);<br>   - CTA primário **"Abrir Corte no Editor (`Enter`)"** (navega para `#/projeto/:id/corte/:corteId/editar`; se não aprovado, mostra dica *"Aprove o Corte antes de abrir no Editor"*).<br>2. **Faixa contextual de Guardrails (visível quando `status === "approved"`, puramente informativa):**<br>   - Status da **Permissão** da Fonte (`granted`/`partial`/`none` + link rápido para Fontes se ausente);<br>   - Se `over60s === true`: aviso *"Corte acima de 60 s: músicas com reivindicação de direitos podem bloquear monetização em Shorts."*;
   - Se `needsDirectNotice === true` (`Corte direto` sem aceite): aviso único do canal *"Corte direto publica sem Transformação e pode ter monetização recusada por conteúdo reutilizado."* + botão **"Entendi o risco"** (`guardrails.ack_direct_notice`);<br>   - Se `videoKind === "transformed"`: indicador vindo de `angles.get` (*"Próximo passo no Editor: escolher Ângulo → aprovar Roteiro → gerar Narração na aba Transformar"* ou *"Ângulo escolhido: {selected.name}"*).<br>3. Seção colapsável/discreta **"Refazer com outro Perfil"**: seletor de outro Perfil de Provedor (`provider.profiles.list` excluindo `current.profile`) + botão **"Refazer Janelas ({windows})"**; exibe aviso de bloqueio se alguma Janela de origem estiver `uncertain` ou `running`/`queued`. |

---

### 4. Ações

| Ação | Comando(s) do núcleo | Pré-condições | Confirmação / Cartão de custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Selecionar candidato na lista | `proxy.request { source_id, start_us, end_us }` (+ `guardrails.check` e `angles.get` se `approved`) | Candidato existente; Fonte `available` para proxy | Não | Atualiza painel direito, query `?corte=:cid`, e solicita/carrega proxy 9:16. | Não aplicável |
| Aprovar / Rejeitar candidato | `selection.decide { candidate, decision }` | Candidato na revisão atual | Não (atualização otimista com rollback em erro) | Atualiza `status` na lista e contadores; ativa `canUndo`; se aprovado, carrega `guardrails.check` (e `angles.get` se `transformed`) e habilita **"Abrir Corte no Editor"**. | `selection.undo { run }` (`Ctrl/Cmd+Z`) |
| Ajustar borda em ±1 Frase | `selection.adjust { candidate, edge: "start" \| "end", delta: -1 \| 1 }` | `moves[...]` permitido dentro de `[minUs, maxUs]` e da Transcrição | Não (otimista com rollback se erro `adjust_*`) | Atualiza `startUs`/`endUs`, `startText`/`endText`, duração, `adjusted: true`, e pede novo proxy se sair da janela em cache. | `selection.undo { run }` (`Ctrl/Cmd+Z`) |
| Desfazer última decisão/ajuste | `selection.undo { run }` | `canUndo === true` | Não | Reverte a última linha de `selection_decisions`, seleciona o candidato afetado e atualiza contadores/estado. | Reaplicar `decide`/`adjust` |
| Trocar Revisão da execução | `selection.get { run, revision }` + `selection.review { run }` | `run.revisions.length > 1` | Não | Recarrega candidatos da revisão selecionada preservando decisões em `selection_decisions` compatíveis (`?rev=:n`). | Trocar no seletor |
| Refazer Janela(s) de origem com outro Perfil | `selection.estimate { run, windows, profileId }` → `selection.redo { run, windows, profileId, confirmed: true }` *(ou `jobs.redo.estimate` → `jobs.redo` quando por janela unitária na fila)* | Janela(s) de origem não `queued`/`running`/`uncertain`; respeito a `local_only` | **Sim (`<ConfirmDialog>` + `<ResumoCustoPrivacidade>`)** mostrando perfil, se texto sai da máquina e USD/cota | Enfileira novas chamadas; ao concluir, cria `revision + 1` e exibe aviso com link para ver a nova Revisão da execução. | Revisão anterior preservada no seletor `revision` |
| Confirmar ciência de Corte direto | `guardrails.ack_direct_notice {}` | `needsDirectNotice === true` | Não | Atualiza `directMonetizationAck` para `true` e recolhe o aviso único no Projeto. | Não aplicável |
| Abrir Corte aprovado no Editor | Navegação para `#/projeto/:id/corte/:corteId/editar` *(Editor chama `editor.open`)* | `review.status === "approved"` | Não | Abre a Tela do Corte na sub-aba `Editar` (com `Transformar` visível no cabeçalho caso `videoKind === "transformed"`). | Voltar via breadcrumb |

---

### 5. Estados da tela

1. **`loading` (carregando):**
   * `<Skeleton>` no sub-cabeçalho, 6 itens simulados na lista à esquerda e blocos de player 9:16 + eixos da Nota à direita.
2. **`empty` (vazio):**
   * *Execução sem candidatos (`candidates.length === 0`):* **"Nenhum candidato gerado nesta execução"** + botão **"Voltar à seleção para tentar outro Perfil"** (`#/projeto/:id/cortes`).
   * *Filtro zerou a lista (ex.: `Nota mínima 9,0` ou filtro `Aprovados` com 0 itens):* **"Nenhum candidato corresponde aos filtros atuais"** + botão **"Limpar filtros"** que restaura `Todos` e Nota mínima `0,0`.
3. **`error` (erro — `role="alert"`):**
   * `run_not_found` → redireciona para `#/projeto/:id/cortes` com aviso *"Esta execução de seleção não foi encontrada."*
   * `adjust_out_of_transcript` / `adjust_empty` / `adjust_too_short` / `adjust_too_long` → mensagem inline próxima aos botões de borda (ex.: *"O Corte ficaria abaixo da duração mínima desta execução (20 s)."*) mantendo o candidato selecionado.
   * `nothing_to_undo` → *"Não há mais decisões para desfazer nesta execução."* e desabilita o botão `Desfazer`.
   * `local_only_violation` / `window_uncertain` / `window_not_redoable` / `confirmation_required` (no bloco **"Refazer com outro Perfil"**) → mensagens claras com link para Fila de Jobs (`Ctrl/Cmd+J`) ou `#/config/provedores`.
   * `source_offline` / `source_changed` (no `<PlayerProxy>`) → *"O arquivo da Fonte foi movido ou alterado; não é possível exibir o preview."* + botão **"Ir para Fontes e relocalizar"** (`#/projeto/:id/fontes/:fonteId`), mantendo textos da Nota, bordas em Frases e Aprovar/Rejeitar funcionais!
   * `component_missing` (FFmpeg ausente para gerar proxy) → *"Falta o FFmpeg para gerar o preview 9:16."* + CTA *just-in-time* / link para `#/config/componentes`.
4. **`job_running` (proxy gerando ou redo de revisão em andamento):**
   * Se `proxy.request` devolver `queued`/`running`: o player 9:16 exibe barra de progresso determinística do proxy (`1..98%`) + botão **"Cancelar preview"** (`jobs.cancel`), enquanto eixos da Nota, texto das bordas e Aprovar/Rejeitar permanecem 100% interativos.
   * Se um `selection.redo` estiver rodando em background: faixa discreta no sub-cabeçalho *"Gerando nova revisão da execução em segundo plano…"* com link para acompanhar na C.1 ou Fila de Jobs, sem travar a revisão dos candidatos já existentes.
5. **`partial` (execução parcial em revisão):**
   * Faixa informativa no sub-cabeçalho: *"Esta execução está parcial ({completed}/{windows} Janelas). Alguns trechos da Fonte podem não ter sido analisados."* + botão **"Retomar na tela de seleção"** (`#/projeto/:id/cortes?fonte=:fonteId&run=:runId`).
6. **`sem permissão / pré-condição`:**
   * Se `review.status !== "approved"`, o botão **"Abrir Corte no Editor"** fica desabilitado com texto explicativo acessível (`aria-describedby`: *"Aprove este candidato para editar, transformar ou exportar"*).
   * Se `permission.status === "none"` nos guardrails do candidato aprovado, exibe alerta informativo não bloqueante: *"Esta Fonte ainda não tem Permissão registrada para crédito automático."* + link para registrar em `#/projeto/:id/fontes/:fonteId`.

---

### 6. Eventos (`core-progress`)

| `job` | `stage` | O que atualiza na tela |
|---|---|---|
| `<proxy_job_id>` (retornado por `proxy.request`) | `proxy` | Atualiza porcentagem (`1..98%`) do carregamento no `<PlayerProxy>` do candidato ativo. |
| `<proxy_job_id>` | `complete` / `failed` | Se `complete`: recarrega `proxy.status` e inicia playback do vídeo 9:16; se `failed`: exibe erro acionável no player com botão *"Tentar novamente"*. |
| `"selection-<run>"` | `selection:window` / `selection:done` | Quando uma reexecução (`selection.redo`) termina, recarrega `selection.get { run }` e `selection.review { run }`, atualiza `run.revisions` e exibe toast discreto *"Nova revisão (v{N}) disponível"*. |
| `<job_id>` (job `ai:selection*` do redo) | `ai:selection:paused` / `ai:selection:done` | Atualiza disponibilidade do bloco **"Refazer com outro Perfil"** e sinaliza caso o redo tenha parado por orçamento ou ficado `uncertain`. |

---

### 7. Teclado e acessibilidade

* **Regiões para `F6` / `Shift+F6`:**
  1. Barra superior do Shell (`<header>`);
  2. Sub-cabeçalho de Revisão e filtros (`<nav>` / barra de ferramentas superior da tela);
  3. Lista de candidatos (`role="listbox"`);
  4. Bancada de Detalhe: Player 9:16 + Eixos da Nota + Bordas + Decisão (`<main>`);
  5. Barra de Status do Shell (`<footer>`).
* **Padrões WAI-ARIA APG:**
  * **Lista de candidatos:** `<ListaVirtual>` com `role="listbox"`, `aria-label="Candidatos a Corte"`, `aria-activedescendant="cand-<id>"` e `tabIndex={0}` no container (eliminando o bug `tabIndex={-1}` da v1!). `↑`/`↓` movem o item ativo com rolagem automática (`scrollIntoView`).
  * **Filtros de estado:** `role="tablist"` ou `role="radiogroup"` horizontal (*Todos*, *Pendentes*, *Aprovados*, *Rejeitados*).
  * **Slider de Nota mínima:** `role="slider"` com `aria-valuemin="0"`, `aria-valuemax="10"`, `aria-valuenow`, `aria-valuetext="Nota mínima 7,5 de 10"`.
  * **Barra de transporte do `<PlayerProxy>`:** `role="toolbar"` com *roving tabindex* (`←`/`→` entre botões internos quando focada).
  * **Botões Aprovar/Rejeitar:** `aria-pressed="true" | "false"`, com rótulo + ícone (SC 1.4.1 — nunca só cor).
  * **Diálogo de "Refazer com outro Perfil":** `<ConfirmDialog>` modal com focus trap e devolução de foco ao botão *"Refazer com outro Perfil"*.
* **Atalhos específicos da tela (sem conflito com `[` / `]` de painéis do Shell):**
  * `↑` / `↓`: Candidato anterior / próximo;
  * `A`: Aprovar candidato selecionado;
  * `R`: Rejeitar candidato selecionado;
  * `I` / `Shift+I`: Recuar / Avançar borda inicial em 1 Frase;
  * `O` / `Shift+O`: Recuar / Avançar borda final em 1 Frase;
  * `Enter`: Abrir Corte aprovado no Editor (`#/projeto/:id/corte/:corteId/editar`);
  * `Ctrl/Cmd+Z`: Desfazer última decisão/ajuste (`selection.undo`);
  * `Espaço`, `J`/`K`/`L`, `←`/`→` (`Shift+←`/`Shift+→`): Transporte do Player 9:16.
  * Todos respeitam a regra WCAG 2.2 SC 2.1.4 (desligados dentro de `input`/`select`/`textarea`, e configuráveis em `#/config/aparencia`).

---

### 8. US da issue #26 atendidas

* **US-28, US-31, US-33:** Custo/privacidade explícitos antes de **"Refazer com outro Perfil"** e bloqueio seguro quando Janela de origem é `uncertain`.
* **US-40, US-66, US-67:** Aprovar, rejeitar, ajustar e desfazer decisões localmente com persistência entre sessões.
* **US-59, US-60, US-61, US-64, US-65:** Lista sem duplicatas, ordenada/filtrável por Nota mínima, com eixos nomeados, pesos visíveis (incluindo `Espaço para comentário` em `Vídeo transformado`) e justificativa textual.
* **US-63, US-73:** Bordas sempre presas em Frase inteira e ajuste rápido `±1 Frase` dentro de `[minUs, maxUs]`.
* **US-70:** Preview rápido via proxy 9:16 sem carregar a Fonte inteira.
* **US-102, US-103, US-104:** Avisos informativos de guardrails no momento certo (monetização de Corte direto, Permissão, limite 60 s em Shorts, próximos passos de Transformação).
* **US-126:** Exibição da marca de chat (`chat X× acima do normal`) na lista e no detalhe do candidato.

---

### 9. Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:**
  1. `selection.get` e `selection.review` já suportam `revision`, porém se o usuário acionar `jobs.redo` diretamente sobre um único `jobId` de seleção (pela Fila de Jobs) em vez de `selection.redo { run, windows, profileId }`, é preciso confirmar se `jobs.redo` atualiza `selection_runs.revision` e `selection_candidates` da mesma forma que `selection.redo`. (Na Bancada C.2, usar sempre `selection.redo` para múltiplos ou únicos candidatos).
  2. Não existe na v1 um comando para **converter** um Corte individual de `direct` para `transformed` após a seleção (`selection_runs.video_kind` é por execução), embora isso impacte principalmente a tela D (`<ContextoCorte>`).
  3. O retorno de `selection.review` fornece `startText` e `endText` (a primeira e a última Frase do Corte), mas não traz as Frases imediatamente vizinhas (`prevStartText` / `nextEndText`) nem o miolo resumido das Frases internas — se desejarmos mostrar prévia da Frase adjacente antes de clicar `I`/`O`, seria necessário consultar `transcription.sentences` por faixa ou enriquecer `selection.review` (atualmente a tela mostra `startText` e `endText` já retornados).
* **Mock TS (`src/lib/core.ts`):**
  1. Remover exigência de `?source-test&transcript-test` em `selectionReviewMock` e `proxy.request`/`proxy.status`.
  2. `selectionReviewMock` hoje ignora o parâmetro `run` e trava em 3 candidatos fixos (`1, 2, 3`); precisa suportar revisões múltiplas (`revision`), filtro por `run`, cálculo real de `moves` e persistência em memória de `decide`/`adjust`/`undo`.
  3. Implementar `proxy.map_time` no mock (hoje inexistente) e emissão real de eventos `core-progress` para `proxy`.
  4. Alinhar `guardrails.check` no mock aos nomes reais do Rust (`hasAudio`, `unverifiedCount`, `freezeTail*`) e suportar `angles.get` para candidatos aprovados em execução `transformed`.

---

### 10. Critérios de aceite (E2E / Playwright com o mock)

1. Na lista de candidatos (`role="listbox"`), pressionar `Tab` foca a lista (sem `tabIndex={-1}` bloqueando), e pressionar `↓` e `↑` move a seleção visual, atualiza `aria-activedescendant` e troca o candidato exibido no painel direito.
2. Filtrar por **"Aprovados"** ou mover o slider **Nota mínima** para `8,5` atualiza a lista visível sem perder o estado das decisões já tomadas; se nenhum item passar no filtro, exibe **"Nenhum candidato corresponde aos filtros atuais"** com botão **"Limpar filtros"**.
3. Pressionar `A` aprova o candidato selecionado (atualizando contador e `aria-pressed="true"`), habilita o botão **"Abrir Corte no Editor"** e carrega os avisos de `guardrails.check`.
4. Pressionar `I` ou `O` (ou clicar nos botões `±1 Frase`) dispara `selection.adjust`, atualiza os textos `startText`/`endText` e a duração, e mantém o foco estável no controle acionado.
5. Pressionar `Ctrl+Z` (ou clicar em **"Desfazer decisão"**) dispara `selection.undo`, restaura o status anterior do candidato afetado e atualiza os contadores.
6. Em um candidato de execução `Vídeo transformado`, o eixo **Espaço para comentário** aparece em primeiro lugar com peso `30%` e justificativa textual; quando aprovado, exibe orientação para o fluxo `Ângulo → Roteiro → Narração` na aba `Transformar`.
7. Em um candidato de execução `Corte direto` aprovado quando `directMonetizationAck === false`, o aviso não bloqueante de monetização aparece com o botão **"Entendi o risco"**; clicar nele chama `guardrails.ack_direct_notice` e remove o aviso.
8. Acionar **"Refazer com outro Perfil"** abre `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` antes de chamar `selection.redo { confirmed: true }`; se uma janela de origem estiver `uncertain`, a ação fica bloqueada com explicação clara.
9. Pressionar `Enter` (ou clicar em **"Abrir Corte no Editor"**) em um candidato aprovado navega para `#/projeto/demo/corte/:corteId/editar`.

---

## Componentes compartilhados usados

Componentes de UI compartilhados entre os pacotes que as telas C.1 e C.2 requerem:

1. **`<ResumoCustoPrivacidade>`** (definido em [01-arquitetura.md](../01-arquitetura.md#7-custo-provedor-e-privacidade))
   * Props mínimas: `{ taskName: string; profileLabel: string; model: string | null; destination: { kind: "local" | "remote" | "cli"; host?: string; cliName?: string }; estimate: { kind: "zero" | "usd" | "plan_quota" | "unknown"; windows?: number; inputTokens?: number; minMicroUsd?: number | null; maxMicroUsd?: number | null }; budget?: { remainingMicroUsd?: number | null; paused?: boolean } | null; compact?: boolean }`
2. **`<ConfirmDialog>`**
   * Props mínimas: `{ open: boolean; title: string; description?: string; children?: ReactNode; confirmLabel: string; cancelLabel?: string; variant?: "primary" | "danger"; busy?: boolean; onConfirm: () => void; onCancel: () => void }`
3. **`<ListaVirtual>`** (WAI-ARIA APG `listbox` virtualizada)
   * Props mínimas: `<T>({ items: T[]; getId: (item: T) => string | number; selectedId: string | number | null; onSelect: (item: T) => void; renderItem: (item: T, selected: boolean) => ReactNode; label: string; estimatedHeight: number; emptyState?: ReactNode })`
4. **`<PlayerProxy>`** (compartilhado com Pacote D e E)
   * Props mínimas: `{ sourceId: number; sourceStatus: "available" | "offline" | "changed"; startUs: number; endUs: number; aspect?: "9:16"; showTransport?: boolean; onRelocateRequest?: () => void }`
5. **`<BannerEstado>` / `<EstadoTela>`** (Skeleton, Vazio, Erro `CoreErrorNormalized` e Parcial)
   * Props mínimas: `{ state: "loading" | "empty" | "error" | "partial"; title?: string; message?: string; errorCode?: string; primaryAction?: { label: string; onClick: () => void }; secondaryAction?: { label: string; onClick: () => void } }`
6. **`<SeloTipoVideo>`** e **`<SeletorTipoVideo>`** (evolução de `videoKind.tsx`)
   * Props mínimas: `{ value: "direct" | "transformed"; inherited?: boolean; onChange?: (next: "direct" | "transformed") => void; weights?: Array<{ key: string; weight: number }> }`
7. **`<BadgeNota>` / `<BarrasEixosNota>`** (específico do domínio de seleção, reutilizável se houver resumo em Exportação)
   * Props mínimas: `{ total: number; weights: Array<{ key: string; weight: number }>; axes: Record<string, { score: number; why: string }> }`
8. **`<Kbd>`** (já existente no design system Foco)
   * Props mínimas: `{ teclas: string[] }`

---

## Questões para a arquitetura

1. **Identificador `:corteId` na rota `#/projeto/:id/corte/:corteId/editar`:**
   * Na Tela C.2, o candidato tem `candidate.id`, enquanto `editor.open` recebe `{ source_id, start_id, end_id, candidate_id }` e devolve `clipId` (que pode diferir de `candidate_id`, além de existir a abertura avulsa sem `candidate_id`). Convém fixar na Seção 3 de `01-arquitetura.md` se `:corteId` na URL representa `clipId` (chamando `editor.open` antes de navegar ou resolvendo por query `?fonte=&start=&end=&cand=`) ou `candidateId` quando vindo da revisão.
2. **Dados de `leavesMachine` e destino em `selection.estimate` (Modo 1):**
   * O Modo 3 de `selection.estimate` já retorna `{ profile: { id, label, kind, model }, leavesMachine, estimate }`, permitindo renderizar `<ResumoCustoPrivacidade>` diretamente. O Modo 1 retorna apenas `profile: string` (sem `leavesMachine` nem `kind`). A arquitetura deve decidir se o front sempre cruza `profile` com `provider.profiles.list` + `assistant.tasks`, ou se abrimos ticket para o Modo 1 retornar a mesma estrutura `{ profile, leavesMachine }`.
3. **Resolução de `jobs.redo` vs. `selection.redo` na Bancada:**
   * Na Seção 12 de `01-arquitetura.md`, o Pacote C cita `selection.redo / jobs.redo`. Como um candidato pode originar-se de mais de uma Janela (`candidate.windows: number[]`) e `selection.redo { run, windows, profileId }` garante incremento de `selection_runs.revision` e preservação de `prev_job_id`, este pacote adota `selection.redo` como comando principal na bancada (deixando `jobs.redo` para a Fila Global de Jobs no Pacote F). Vale confirmar se `jobs.redo` no Rust sobre um job `ai:selection` também avança `revision` ou se deve permanecer separado.
4. **Visibilidade de Fontes transcritas em `sources.list`:**
   * Como `sources.list` não retorna o estado da Transcrição, `#/projeto/:id/cortes` precisa chamar `transcription.status` para cada Fonte do Projeto (ou depender do cache do Store caso o usuário tenha passado pela Macro-etapa 1). Vale confirmar se o Store de Projeto mantém um mapa `transcriptStatusBySource` carregado sob demanda ou se vale ticket para incluir `transcriptState` em `sources.list`.
