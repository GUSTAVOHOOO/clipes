# Especificação de Telas — Pacote A: Shell, Início, Primeiro Uso e Configurações

> **Pacote:** A · **Rotas cobertas:** Shell Global (todas as rotas), `#/inicio`, `#/assistente`, componente reutilizável de instalação *just-in-time*, `#/config/:secao` (`provedores`, `custos`, `componentes`, `exportacao`, `aparencia`, `projeto`).  
> **Documentos vinculantes:** [01-arquitetura.md](../01-arquitetura.md) e [GLOSSARY.md](../../../../GLOSSARY.md).  
> **Contratos de núcleo de referência:** [01-instalacao-e-sistema.md](../../funcionalidades/01-instalacao-e-sistema.md), [02-projetos-e-fontes.md](../../funcionalidades/02-projetos-e-fontes.md), [03-transcricao.md](../../funcionalidades/03-transcricao.md), [04-selecao-de-cortes.md](../../funcionalidades/04-selecao-de-cortes.md), [06-roteiro-narracao-e-saida.md](../../funcionalidades/06-roteiro-narracao-e-saida.md), [07-provedores-jobs-e-eventos.md](../../funcionalidades/07-provedores-jobs-e-eventos.md).  
> **Nota de escopo:** Este documento especifica estrutura, fluxo, dados, textos PT-BR, estados, acessibilidade e critérios de aceite. Cores, fontes, espaçamentos detalhados e estilo visual pertencem à Fase 4.

---

## Índice

1. [Superfície 1 — Shell Global](#superfície-1--shell-global)
2. [Tela 2 — Início e Projetos (`#/inicio`)](#tela-2--início-e-projetos-inicio)
3. [Tela 3 — Assistente de Primeiro Uso (`#/assistente`)](#tela-3--assistente-de-primeiro-uso-assistente)
4. [Superfície 4 — Instalador Just-in-Time (`yt-dlp`/`deno`, `YuNet`, `pocket-tts`)](#superfície-4--instalador-just-in-time-yt-dlpdeno-yunet-pocket-tts)
5. [Tela 5 — Configurações: Provedores e Tarefas de IA (`#/config/provedores`)](#tela-5--configurações-provedores-e-tarefas-de-ia-configprovedores)
6. [Tela 6 — Configurações: Custos, Orçamentos e Auditoria (`#/config/custos`)](#tela-6--configurações-custos-orçamentos-e-auditoria-configcustos)
7. [Tela 7 — Configurações: Componentes e Armazenamento (`#/config/componentes`)](#tela-7--configurações-componentes-e-armazenamento-configcomponentes)
8. [Tela 8 — Configurações: Exportação e Encoder (`#/config/exportacao`)](#tela-8--configurações-exportação-e-encoder-configexportacao)
9. [Tela 9 — Configurações: Aparência e Teclado (`#/config/aparencia`)](#tela-9--configurações-aparência-e-teclado-configaparencia)
10. [Tela 10 — Configurações: Projeto atual (`#/config/projeto`)](#tela-10--configurações-projeto-atual-configprojeto)
11. [Componentes compartilhados usados](#componentes-compartilhados-usados)
12. [Questões para a arquitetura](#questões-para-a-arquitetura)

---

## Superfície 1 — Shell Global

### 1. Objetivo e Navegação
* **Objetivo:** Fornecer a moldura fixa da janela (`100vw × 100vh`) com acesso contínuo ao Projeto ativo, etapas, indicadores globais (Somente local, Orçamento e Fila de Jobs), Paleta `Ctrl/Cmd+K`, Configurações, barra de status e diálogos transversais sem bloquear a navegação.
* **De onde chega / para onde vai:** Envolve todas as rotas autenticadas/ativas (`#/inicio`, `#/projeto/:id/...`, `#/config/:secao`, `#/relatos`, `#/sobre`). Na rota `#/assistente`, oculta as etapas de Projeto e deixa apenas identificação da janela e atalho discreto para sair/pular. Do menu do Projeto, vai para `#/inicio` ou `#/config/projeto`; do botão de fila (`Ctrl/Cmd+J`), abre a gaveta global da Fila de Jobs (especificada no Pacote F); de Configurações (`Ctrl/Cmd+,`), vai para `#/config/provedores`; do menu secundário, vai para `#/relatos` e `#/sobre`.

### 2. Layout por zonas
A moldura externa **nunca rola** (`overflow: hidden` no root); apenas colunas internas de `<main>` rolam.

**Em 1366 px (notebook alvo):**
```
+----------------------------------------------------------------------------------+
| [Clipes · Meu Canal v] | 1. Fontes (3) | 2. Cortes (12) | 3. Export (4)          |  <- Barra Superior
|      ... [Slot ContextoCorte se em /corte/:id] ... | [Somente local] [Orçam.]    |     (44 px fixos)
|      [Fila: 2 ativas !] [Buscar Ctrl+K] [Config] [Menu ...]                      |
+----------------------------------------------------------------------------------+
|                                                                                  |
|  <main> Área de Conteúdo Principal (min-h-0 flex-1)                              |
|  (ocupada pela rota ativa; em #/projeto/:id/corte/:cid mostra sub-cabeçalho      |
|   <ContextoCorte> acoplado logo abaixo ou integrado no slot central)             |
|                                                                                  |
+----------------------------------------------------------------------------------+
| [Salvo] | Transcrição: bloco 4/12 · GPU   ...   [F6 Região · ? Atalhos] [Painéis]|  <- Barra de Status
+----------------------------------------------------------------------------------+     (28–32 px)
```

**Variação em 1440+ px e 1280 px:**
* **1440+ px:** Rótulos completos nas etapas (`1. Fontes e Transcrição`, `2. Cortes`, `3. Exportação`) com contadores numéricos por extenso e botão `Paleta de comandos (Ctrl+K)` com `<Kbd>` visível; `<ContextoCorte>` pode ser exibido por extenso sem truncar o nome do Corte.
* **1280 px:** Rótulos curtos nas etapas (`Fontes`, `Cortes`, `Exportar`); `Relatos` e `Sobre` recolhidos dentro do botão de menu secundário (`Mais ações`); gatilho da paleta mostra ícone + `Ctrl+K` compacto.

**Camadas globais sobrepostas ao shell (ordem de empilhamento definida no Design System):**
* **Gaveta/Painel da Fila de Jobs** (Pacote F, aberta pelo botão da barra ou `Ctrl/Cmd+J`).
* **Paleta de Comandos (`Ctrl/Cmd+K`)** (`z-index: palette`): diálogo centralizado sobre scrim.
* **`<ConfirmDialog>`** (`z-index: dialog`): modal de confirmação para ações destrutivas ou com impacto financeiro.
* **Diálogo de Atualização (`UpdateNotice`)** e **Toast / Alertas persistentes** (`z-index: toast`, canto inferior direito acima da Barra de Status).

### 3. Conteúdo e componentes por zona
1. **Barra Superior (`<header>`):**
   * **Esquerda — Seletor de Projeto (`Menu`):**
     * Sem Projeto aberto: marca `Clipes` + link/botão `Projetos` (`#/inicio`).
     * Com Projeto aberto (`projects.current`): exibe `projects.current.name` como botão de menu contendo:
       * `Trocar Projeto` (lista rápida de `projects.recent` disponíveis + link `Ver todos em Início`);
       * `Configurações do Projeto` (`#/config/projeto`);
       * `Fechar Projeto` (`projects.close`).
   * **Centro-esquerda — Navegação das 3 macro-etapas (`<nav aria-label="Etapas do Projeto">`):** visível somente quando há Projeto aberto:
     * `1. Fontes e Transcrição` (`#/projeto/:id/fontes`) — contador: total de Fontes (`sources.list.length`).
     * `2. Cortes` (`#/projeto/:id/cortes`) — contador: Cortes aprovados / candidatos.
     * `3. Exportação` (`#/projeto/:id/exportacao`) — contador: prontos para exportar.
     * *Quando em `#/projeto/:id/corte/:corteId/...`:* slot `meio` exibe ou acopla `<ContextoCorte>` (especificado no Pacote D).
   * **Direita — Indicadores e ações globais:**
     * **Selo `Somente local`:** visível sempre que `projects.local_only.get().enabled === true` ou qualquer tarefa em `assistant.tasks` tiver `localOnly === true`. Texto: `"Somente local"` (ou `"Parcialmente local"` se apenas parte das tarefas); ícone de cadeado; clicável para abrir `#/config/projeto` (se veto do Projeto) ou `#/config/provedores` (se veto por tarefa).
     * **Indicador de Orçamento / Pausa:** visível quando `jobs.budget.get` tem teto configurado ou `paused !== null`. Exibe ícone + texto `"Orçamento"` ou `"Pausado por orçamento"` (`role="status"` / destaque de atenção); clicável para abrir `#/config/custos` ou a Fila de Jobs.
     * **Botão da Fila de Jobs (`Ctrl/Cmd+J`):** indicador único consolidado do store global. Mostra contagem de ativos (`queued` + `running` + downloads globais), porcentagem agregada se houver job determinístico rodando, ou alerta prioritário se houver item `uncertain` (`"1 decisão pendente"`). O painel interno é especificado no Pacote F.
     * **Gatilho da Paleta (`Ctrl/Cmd+K`):** botão `"Buscar ações"` com `<Kbd>Ctrl+K</Kbd>` (`Cmd+K` no macOS).
     * **Botão Configurações (`Ctrl/Cmd+,`):** ícone de engrenagem + `aria-label="Configurações"`.
     * **Menu secundário (`Mais`):** links para `Relatos e Diagnóstico` (`#/relatos`), `Sobre e Atualizações` (`#/sobre`, com ponto indicador se houver atualização pendente) e `Ajuda de atalhos (?)`.

2. **Barra de Status (`<footer>`):**
   * **Esquerda:**
     * Indicador de salvamento do Editor (quando em rota do Editor ou Projeto com alteração): `"Salvo"` (`editor_saved`), `"Salvando…"` ou botão clicável de alerta `"Falha ao salvar Corte — tentar novamente"` (`editor_save_failed`).
     * Aviso de backup falho (`projects.current.warning !== null`): `"Falha no backup automático"` clicável levando para `#/config/projeto`.
     * Resumo vivo da fila: `"Sem tarefas em andamento"` ou `"<Nome da tarefa>: <etapa> · <N>%"` (ex.: `"Transcrição: bloco 4/12 · 33%"`).
   * **Direita:**
     * Dica contextual curta da região focada (ex.: `"F6 alternar região · ? atalhos"`).
     * Botão rápido para alternar painéis laterais (`Ctrl+[` / `Ctrl+]`) quando a rota atual possuir painéis acoplados (Revisão e Editor).

3. **Paleta de Comandos (`Ctrl/Cmd+K`):**
   * Diálogo modal pesquisável via `cmdk` alimentado pelo registro dinâmico de `useComandos`.
   * Agrupa comandos por `grupo` (`Navegar`, `Projetos`, `Tela atual`, `Transporte`, `Configurações`, `App`).
   * Cada item mostra título, `dica` opcional à direita e atalho em `<Kbd>` lido diretamente da mesma definição que dispara o teclado.
   * Suporta subpáginas (`filhos()`), ex.: `"Trocar para Projeto…"`.
   * **Textos reais:** placeholder `"Digite um comando ou navegue…"`; estado sem resultados `"Nenhum comando encontrado para esta busca."`; rodapé `"Enter para executar · Esc para fechar"`.

4. **`<ConfirmDialog>` Global:**
   * Baseado em `@base-ui/react/alert-dialog`, com `initialFocus` no botão de **Cancelar** (proteção contra `Enter` acidental), `finalFocus` restaurado ao gatilho e suporte a conteúdo extra (`children`) para `<ResumoCustoPrivacidade>`.

5. **Central de Notificações e `UpdateNotice`:**
   * **Toasts não bloqueantes (`role="status"`, `aria-live="polite"`):** conclusão de transcrição, seleção, exportação ou download com 1 botão de ação direta (`"Revisar Cortes"`, `"Abrir pasta"`, `"Ir para Fontes"`).
   * **Alertas persistentes (`role="alert"`):** pausas por orçamento, jobs `uncertain`, `editor_save_failed` e erro de atualização; permanecem visíveis até dispensa manual ou clique na ação de reparo.
   * **Notificação nativa do SO:** disparada apenas quando a janela está desfocada (`!document.hasFocus()`) e um job longo (`transcription`, `batches.*`, `export.batch.*`, `export`) conclui ou pausa por erro/orçamento.
   * **`UpdateNotice`:** verifica atualização assinada no startup via `@tauri-apps/plugin-updater`; se houver nova versão, exibe banner discreto/toast `"Nova versão disponível (<versão>)"` com botão `"Ver detalhes"` (nunca atualiza sem confirmação e nunca imprime `reason` técnico cru).

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Abrir menu de Projeto e clicar em *Fechar Projeto* | `projects.close` | Sem job ativo (`project_busy`) e `editor.flush` OK | Se houver edição pendente falhando, bloqueia; senão direto | Limpa Store de Projeto Ativo, navega para `#/inicio` | Reabrir em Recentes |
| Trocar de Projeto pelo menu | `projects.open { path }` | Sem job ativo no Projeto atual | Se houver jobs/edições pendentes, núcleo faz `editor.flush`; erro `project_busy` impede troca | Limpa store do Projeto anterior, abre novo Projeto e navega para `#/projeto/:id/fontes` | Reabrir Projeto anterior |
| Clicar na macro-etapa (1, 2 ou 3) | Navegação de rota | Projeto aberto | Nenhuma | Atualiza rota para `#/projeto/:id/fontes`, `cortes` ou `exportacao` | Botão Voltar |
| Clicar em `Somente local` | Navegação de rota | — | Nenhuma | Abre `#/config/projeto` (se veto do Projeto) ou `#/config/provedores` | — |
| Clicar no botão Fila de Jobs (`Ctrl/Cmd+J`) | Leitura do store + `jobs.list` / `batches.list` / `export.batch.list` | — | Nenhuma | Abre/fecha o painel global da Fila de Jobs | `Esc` / `Ctrl/Cmd+J` |
| Abrir Paleta (`Ctrl/Cmd+K`) | Leitura de `useComandos` | — | Nenhuma | Abre paleta modal; ao escolher item, fecha e executa ação | `Esc` fecha sem executar |
| Fechar a janela do app com operação ativa | `editor.flush` (via Tauri `CloseRequested`) + checagem do store | Janela em fechamento | `<ConfirmDialog>` se houver download global (`components.*`/`tts.models.*`/`sources.url.*`) ou exportação/chamada paga em execução | Dialogo: `"Há operações em andamento. Downloads globais e exportações serão interrompidos; tarefas locais voltam para a fila ao reabrir; chamadas pagas em voo ficarão como incertas para sua decisão."` Botões: `"Continuar trabalhando"` / `"Fechar mesmo assim"` | Cancelar fechamento |
| Instalar atualização do app (`UpdateNotice`) | `@tauri-apps/plugin-updater` | Usuário confirmou | `<ConfirmDialog>`: `"Instalar atualização <versão> e reiniciar o Clipes?"` | Baixa atualização assinada com progresso e reinicia app | — |

### 5. Estados
* **`loading`:** Na carga inicial do app antes de `projects.current` e `assistant.status` responderem, barra superior mostra placeholder neutro para o seletor de Projeto e mantém ações globais (`Configurações`, `Paleta`) operáveis.
* **`empty` (sem Projeto aberto):** Barra superior oculta as 3 etapas de Projeto, exibe marca `Clipes`, indicador de downloads globais (se houver), `Ctrl+K`, `Configurações` e menu secundário.
* **`error`:**
  * `editor_save_failed` → Barra de status em destaque de erro (`role="alert"`): `"Não foi possível salvar as últimas edições do Corte."` + botão `"Tentar salvar agora"` (`editor.flush`).
  * `project_busy` ao tentar fechar/trocar Projeto → Toast de alerta: `"Há uma tarefa em andamento bloqueando a troca de Projeto."` + botão `"Abrir Fila de Jobs"`.
  * Erro de atualização (`UpdateNotice`) → Traduz erro de rede vs. assinatura (`updateError.ts`) para mensagem humana + `"Tentar novamente"` (nunca expõe string bruta do Rust).
* **`job_running`:** Botão da Fila exibe ícone animado (estático em `prefers-reduced-motion`), contagem e `%`; Barra de Status mostra tarefa atual.
* **`partial` / atenção prioritária:** Se houver job `uncertain` ou pausa por orçamento (`ai_pauses`), botão da Fila e Barra de Status exibem selo de atenção `"Decisão necessária"` / `"Orçamento pausado"`.
* **`sem pré-condição`:** Sem Projeto aberto, atalhos para etapas `#/projeto/...` ficam ausentes da barra e desabilitados na Paleta com dica `"Abra um Projeto primeiro"`.

### 6. Eventos (`core-progress`)
O Store Global de Fila e Eventos assina `listen('core-progress', ...)` em um único ponto:
* `stage === "editor_saved"` → Atualiza Barra de Status para `"Salvo"`.
* `stage === "editor_save_failed"` → Atualiza Barra de Status para estado de erro e dispara `role="alert"`.
* `job` numérico (`project === currentProjectId`): atualiza barra resumida do Shell e contagem de ativos; nos estágios terminais (`complete`, `failed`, `ai:*:done`, `ai:*:paused`), atualiza `jobs.list` com debounce e dispara toast / notificação nativa do SO.
* Agregadores (`selection-<id>`, `batch-<id>`, `export-batch-<id>`): atualizam resumo na Barra de Status e contagem no botão da Fila.
* Operações globais (`project: null`: `ffmpeg`, `yt-dlp`, `deno`, `pocket-tts`, `uv`, `worker`, `catalog`, `<model_id>`, `tts:<model_id>`, `hardware-probe`, `transcription-estimate`, `<url_job_id>`): alimentam o contador de downloads globais no botão da Fila e na Barra de Status.
* Ignora `job === "0"` residual de `narration_record`.

### 7. Teclado e acessibilidade
* **Atalhos globais do Shell (via `useComandos`):**
  * `Ctrl/Cmd+K`: abre/fecha Paleta de comandos (funciona mesmo dentro de campos de texto).
  * `F6` / `Shift+F6`: cicla entre regiões macro (`Barra Superior` → `Painel esquerdo / Lista` → `Conteúdo principal / Palco` → `Painel direito` → `Timeline / Barra de Status`).
  * `Ctrl/Cmd+,`: abre Configurações (`#/config/provedores`).
  * `Ctrl/Cmd+J`: abre/fecha painel da Fila de Jobs.
  * `Ctrl/Cmd+F`: foca busca da tela atual (quando houver).
  * `?` (fora de campo, sujeito à opção WCAG 2.1.4) ou `Ctrl/Cmd+/`: abre folha rápida de atalhos.
* **Regras de disparo:** Com Paleta aberta, só a Paleta responde; em diálogos/menus abertos, só comandos `global` (`Esc`, `Ctrl/Cmd+K`); dentro de campos de texto, letras sem modificador são texto.
* **Padrões WAI-ARIA APG:**
  * Barra superior: `<header>` com `<nav aria-label="Etapas do Projeto">`, menu do Projeto seguindo APG `Menu Button`.
  * Barra de status: `<footer>` com `role="status"` (`aria-live="polite"`, com throttle) para progresso/autosave e `role="alert"` apenas para falhas.
  * Paleta: `dialog` modal + `combobox`/`listbox` (`cmdk`) com `aria-activedescendant`, restaurando foco ao elemento salvo em `focoRetornoPaleta`.
  * `<ConfirmDialog>`: `alertdialog` com `inert` no fundo e foco inicial no botão de cancelar.
* **Ordem de foco:** Seletor de Projeto → Etapas (1 → 2 → 3) → Selos clicáveis (se visíveis) → Fila de Jobs → Paleta → Configurações → Menu secundário → `<main>` → Barra de Status. Todos os controles têm alvo ≥ 24×24 CSS px e classe `.foco`.

### 8. US do #26 atendidas
* US-16 (atualização com confirmação e assinatura), US-34, US-35 (trocar/fechar Projeto portátil), US-39 (aviso de falha de backup), US-51 (progresso global visível), US-69 (paleta `Ctrl+K`), US-121, US-122 (visibilidade contínua de `Somente local`).

### 9. Lacunas
* **Núcleo Rust:**
  * `WindowEvent::CloseRequested` em `src-tauri/src/main.rs` já roda `editor.flush`, mas falta coordenação explícita para exibir o `<ConfirmDialog>` de confirmação na UI quando houver download global (`components.*`) ou exportação/chamada paga em andamento.
  * Backups automáticos em segundo plano não emitem evento em `core-progress`; o Shell depende de `projects.current` ao abrir/retornar foco para mostrar `warning` de backup.
* **Mock TS (`src/lib/core.ts`):**
  * Falta mock de `projects.close` e `projects.open` / `projects.create`.
  * Falta barramento simulado de eventos `core-progress` no mock para alimentar o Store Global em tempo real.
  * `projects.current` hoje exige `?source-test=1`; deve existir Projeto padrão disponível no mock sem query flag oculta.

### 10. Critérios de aceite (E2E / Playwright)
1. Ao abrir qualquer rota de Projeto, a Barra Superior exibe o nome do Projeto, as 3 etapas (`Fontes`, `Cortes`, `Exportação`) e o gatilho `Ctrl+K` sem quebrar linha em `1366×768`.
2. Pressionar `Ctrl+K` (ou `Cmd+K`) abre a Paleta com foco no campo de busca; digitar `"Configurações"` e pressionar `Enter` navega para `#/config/provedores` e fecha a Paleta.
3. Pressionar `Esc` na Paleta devolve o foco exatamente ao botão que tinha foco antes da abertura.
4. Clicar em `Fechar Projeto` no menu do Projeto chama `projects.close`, limpa os seletores de etapa da Barra Superior e navega para `#/inicio`.
5. Quando `projects.local_only.get` retorna `{ open: true, enabled: true }`, o selo `"Somente local"` aparece na Barra Superior com texto e ícone (não só cor).
6. Em `#/inicio?estado=erro` ou ao simular `editor_save_failed`, a Barra de Status exibe alerta acessível (`role="alert"`) com o texto `"Não foi possível salvar as últimas edições do Corte."` e botão acionável.
7. Pressionar `F6` move o foco sequencialmente entre Barra Superior, conteúdo principal e Barra de Status com anel `.foco` visível.

---

## Tela 2 — Início e Projetos (`#/inicio`)

### 1. Objetivo e Navegação
* **Objetivo:** Permitir criar um novo **Projeto** portátil `.clipes`, abrir uma pasta `.clipes` existente no disco ou retomar Projetos recentes verificando sua disponibilidade real.
* **De onde chega / para onde vai:** Rota inicial padrão quando não há Projeto aberto (`projects.current === null`), ou acessada pelo menu do Projeto (`Trocar Projeto` / `Fechar Projeto`). Se `assistant.status().needsSetup === true` na primeira abertura do app, redireciona/abre o **Assistente de Primeiro Uso** (`#/assistente`). Ao criar ou abrir um Projeto com sucesso, navega para `#/projeto/:id/fontes`.

### 2. Layout por zonas
Sem scroll na moldura externa; a área principal divide-se em cabeçalho de entrada fixo e lista rolável de Projetos recentes.

**Em 1366 px e 1440+ px:**
```
+----------------------------------------------------------------------------------+
| Shell: Barra Superior (Marca Clipes | Fila | Ctrl+K | Config | Menu)            |
+----------------------------------------------------------------------------------+
|                                                                                  |
|  [Faixa condicional: se há Projeto aberto -> "Projeto ativo: <Nome>  [Continuar] |
|   [Fechar Projeto]"]                                                             |
|                                                                                  |
|  Cabeçalho:                                                                      |
|  Projetos                                                                        |
|  Cada Projeto guarda suas Fontes, Cortes e Perfil de canal numa pasta portátil.  |
|  [ + Novo Projeto ]   [ Abrir pasta .clipes ]                                    |
|                                                                                  |
|  ------------------------------------------------------------------------------  |
|  Projetos recentes                                          (busca local se > 8) |
|  +----------------------------------------------------------------------------+  |
|  | Meu Canal de Cortes           C:\Videos\MeuCanal.clipes   [Abrir]          |  |
|  | Canal Dark História           D:\Projetos\Historia.clipes [Abrir]          |  |
|  | Live Antiga (Indisponível)    E:\Backup\Antiga.clipes     [Pasta ausente]  |  |
|  +----------------------------------------------------------------------------+  |
|  (Lista com scroll interno apenas nesta região se ultrapassar a altura)          |
+----------------------------------------------------------------------------------+
| Shell: Barra de Status                                                           |
+----------------------------------------------------------------------------------+
```
*Em 1440+ px:* o bloco central mantém largura confortável (até `960 px` centralizado ou alinhado ao grid de conteúdo) para que caminho completo em `font-mono` e ações fiquem na mesma linha sem truncamento agressivo.
*Diálogo "Novo Projeto" (modal `<Dialog>`):* campo `Nome do Projeto`, seletor `Pasta onde salvar` (botão nativo `Escolher pasta` + campo de texto editável para acessibilidade/E2E/digitação direta, exibindo prévia `<pasta>/<nome>.clipes`), botões `Cancelar` e `Criar Projeto`.
*Fluxo "Abrir pasta .clipes":* abre seletor nativo de pasta do SO (com diálogo fallback de caminho manual quando em ambiente navegador/mock ou sem plugin de diálogo).

### 3. Conteúdo e componentes por zona
1. **Faixa de Projeto Ativo (condicional, se `projects.current !== null`):**
   * Mostra nome e caminho (`projects.current.name`, `projects.current.path`).
   * Aviso de backup falho se `projects.current.warning !== null`.
   * Botões: `Continuar no Projeto` (volta para `#/projeto/:id/fontes`) e `Fechar Projeto` (`projects.close`).
2. **Cabeçalho e Ações Primárias:**
   * Título: `Projetos`.
   * Subtítulo (≤ 68 ch): `"Cada canal pode ter seu Projeto em uma pasta .clipes portátil, com backups próprios."`
   * Ação primária (`variante="primario"`): `Novo Projeto`.
   * Ação secundária (`variante="secundario"`): `Abrir pasta .clipes`.
3. **Lista de Projetos Recentes (`projects.recent`):**
   * Dados: `name`, `path`, `available` (`boolean`).
   * Item disponível (`available: true`): nome do Projeto, caminho em fonte monoespaçada e botão `Abrir` (ou clique na linha + `Enter`).
   * Item indisponível (`available: false`): ícone de alerta + selo textual `"Indisponível no disco"` (nunca só cor), caminho e botão `"Localizar pasta…"` (abre seletor para apontar nova localização com `projects.open`).

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Entrar em `#/inicio` | `projects.recent`, `projects.current`, `assistant.status` | Nenhuma | Nenhuma | Se `needsSetup === true` na largada inicial, abre `#/assistente`; senão renderiza lista de recentes | — |
| Criar Projeto | `projects.create { name, parent }` | `name` válido (sem `/`, `\`, `:`, `.`, `..`), `parent` absoluto; sem `project_busy` | Nenhuma (grava pasta `.clipes` no disco) | Fecha diálogo, atualiza Projeto ativo e navega para `#/projeto/:id/fontes` | `projects.close` |
| Abrir Projeto existente / recente | `projects.open { path }` | Pasta `.clipes` com `project.sqlite`; sem `project_busy` | Se Projeto for antigo, núcleo faz backup pré-migração automaticamente | Abre Projeto e navega para `#/projeto/:id/fontes` | `projects.close` |
| Localizar Projeto recente indisponível | `projects.open { path }` (novo caminho escolhido) | Pasta válida selecionada | Nenhuma | Abre o Projeto no novo local e atualiza índice de recentes | — |
| Fechar Projeto ativo | `projects.close` | Sem `project_busy` | Nenhuma | Remove faixa de Projeto ativo e limpa store do Projeto | Reabrir na lista |

### 5. Estados
* **`loading`:** Exibe `<Esqueleto>` estrutural de 4 linhas na área de Projetos recentes; botões `Novo Projeto` e `Abrir pasta .clipes` permanecem utilizáveis.
* **`empty`:** Quando `projects.recent` retorna `[]`:
  * Título: `"Nenhum Projeto recente ainda"`.
  * Descrição: `"Crie seu primeiro Projeto para importar Fontes e gerar Cortes, ou abra uma pasta .clipes existente."`
  * CTA primário focado/destacado: `"Criar primeiro Projeto"` (abre o diálogo de criação) + botão secundário `"Abrir pasta .clipes"`.
* **`error`:** Container `role="alert"` mapeando `CoreError.code`:
  * `invalid_project` → `"Escolha um nome válido (sem barras ou dois-pontos) e uma pasta .clipes válida."` → foca campo com erro.
  * `newer_project` → `"Este Projeto foi criado por uma versão mais nova do Clipes."` → botão `"Verificar atualizações"` (`#/sobre`).
  * `project_busy` → `"Há uma tarefa ativa no Projeto atual impedindo a troca."` → botão `"Abrir Fila de Jobs"`.
  * `project_create` / `project_open` / `migration` / `backup` → `"Não foi possível abrir ou criar a pasta do Projeto. Verifique permissões e espaço em disco."` + `"Tentar novamente"` + `"Ver detalhe técnico"`.
  * `library` → `"Não foi possível ler a lista de Projetos recentes, mas você ainda pode abrir qualquer pasta .clipes diretamente."` + botão `"Abrir pasta .clipes"`.
* **`job_running`:** Botões de criação/abertura mostram spinner e `aria-busy="true"` durante execução de `projects.create`/`projects.open` (inclusive migração).
* **`partial`:** Não se aplica como parcial da tela; porém itens recentes individuais podem estar `available: false` enquanto outros estão disponíveis.

### 6. Eventos (`core-progress`)
* Não escuta eventos específicos de job próprio; herda do Shell o indicador global caso haja downloads de componentes em andamento.

### 7. Teclado e acessibilidade
* **Atalhos da tela (via `useComandos`):** `Ctrl/Cmd+N` (Novo Projeto), `Ctrl/Cmd+O` (Abrir pasta `.clipes`), registrados apenas nesta tela/escopo de Projetos.
* **Regiões `F6`:** Barra Superior → Área principal de Projetos → Barra de Status.
* **WAI-ARIA APG:**
  * Lista de recentes: `listbox` ou lista semântica (`<ul>`) com itens navegáveis por `Tab` / setas e botões de ação explícitos (`aria-label="Abrir Projeto Meu Canal de Cortes"`).
  * Diálogo Novo Projeto: `dialog` modal (`@base-ui/react/dialog`) com foco inicial no campo `Nome do Projeto`, validação com `aria-invalid` e `aria-describedby` apontando para a mensagem de erro.
* **Ordem de foco:** `Continuar no Projeto` (se ativo) → `Novo Projeto` → `Abrir pasta .clipes` → Lista de Projetos recentes (botões `Abrir` / `Localizar`).

### 8. US do #26 atendidas
* US-34 (Projeto por canal em pasta portátil), US-35 (reabrir apontando pasta mesmo sem índice), US-39 (backup verificado antes de migração e aviso de erro de backup).

### 9. Lacunas
* **Núcleo Rust:** Nenhuma para `#/inicio` — `projects.create`, `projects.open`, `projects.recent`, `projects.current` e `projects.close` já existem no núcleo.
* **Mock TS (`src/lib/core.ts`):**
  * Faltam handlers para `projects.create`, `projects.open` e `projects.close`.
  * `projects.recent` retorna sempre `[]` no mock atual; precisa retornar lista realista padrão (incluindo ao menos 1 disponível e 1 indisponível para E2E, além de suportar `?estado=vazio`).

### 10. Critérios de aceite (E2E / Playwright)
1. Com `?estado=carregando`, `#/inicio` renderiza `<Esqueleto>` estrutural e nunca exibe `"Nenhum Projeto recente ainda"`.
2. Com `?estado=vazio`, exibe `"Nenhum Projeto recente ainda"` e o botão `"Criar primeiro Projeto"`.
3. Com Projetos recentes no estado padrão, exibe itens disponíveis com botão `"Abrir"` e item indisponível com selo textual `"Indisponível no disco"` (ícone + texto).
4. Clicar em `"Novo Projeto"`, preencher nome `"Canal Teste"` e pasta `"/tmp/clipes"` e confirmar chama `projects.create` e navega para `#/projeto/.../fontes`.
5. Informar nome inválido (ex.: `"a/b"`) exibe erro humano no formulário sem expor stack trace nem `CoreError.code` cru.
6. Simular `newer_project` ao abrir Projeto exibe alerta (`role="alert"`) em PT-BR com botão `"Verificar atualizações"`.

---

## Tela 3 — Assistente de Primeiro Uso (`#/assistente`)

### 1. Objetivo e Navegação
* **Objetivo:** Preparar o mínimo funcional do Clipes em 2 passos guiados — (1) FFmpeg + Motor de transcrição local compatível com GPU/RAM/disco e (2) Provedor padrão e Perfis de Provedor — adiando ferramentas opcionais (`yt-dlp`/`deno`, `YuNet`, `pocket-tts`) para instalação sob demanda.
* **De onde chega / para onde vai:** Aberto automaticamente a partir de `#/inicio` quando `assistant.status().needsSetup === true` na primeira abertura do app, ou reaberto manualmente em `#/config/provedores` (botão `"Reabrir assistente de configuração"`). Ao concluir ou pular (`assistant.complete`), retorna para `#/inicio` (ou para `#/config/provedores` se foi reaberto dali).

### 2. Layout por zonas
Fluxo limpo e focado (largura máxima de leitura `760 px` centralizada no `<main>`), com indicador de progresso de 2 passos no topo e rodapé fixo de ações do passo.

**Em 1366 px e 1440+ px:**
```
+----------------------------------------------------------------------------------+
| Shell: Barra mínima (Clipes · Configuração inicial)           [Configurar depois] |
+----------------------------------------------------------------------------------+
|                                                                                  |
|     Indicador: (●) 1. Essencial e Hardware  ────  ( ) 2. Provedor de IA          |
|                                                                                  |
|     +----------------------------------------------------------------------+     |
|     | Passo 1: Essencial para transcrever e cortar                         |     |
|     |                                                                      |     |
|     | [1] FFmpeg e FFprobe                                  [Pronto / Baixar]|   |
|     |     Usado para ler vídeos, gerar previews e exportar. ~150 MB · GPL  |     |
|     |     > Usar FFmpeg já instalado no computador                         |     |
|     |                                                                      |     |
|     | [2] Motor de transcrição local                                       |     |
|     |     Placa detectada: NVIDIA RTX 3050 (4 GB) · 16 GB RAM              |     |
|     |     Recomendado: Precisão alta com aceleração NVIDIA (~1,6 GB)       |     |
|     |     (inclui ambiente Python isolado + modelo Whisper)                |     |
|     |     [ Instalar motor recomendado ]   [ Testar meu hardware ]         |     |
|     |     Barra de progresso (quando baixando/sondando) + [Cancelar]       |     |
|     +----------------------------------------------------------------------+     |
|                                                                                  |
|     Rodapé do Assistente:                                                        |
|     [ Pular por enquanto ]                       [ Próximo: Provedor de IA -> ]  |
+----------------------------------------------------------------------------------+
```

**Passo 2 (Provedores) dentro da mesma moldura:**
```
|     Indicador: (✓) 1. Essencial e Hardware  ────  (●) 2. Provedor de IA          |
|     +----------------------------------------------------------------------+     |
|     | Passo 2: Quem escolhe os Cortes e sugere títulos                     |     |
|     |                                                                      |     |
|     | Detectamos no seu computador:                                        |     |
|     |  (•) Ollama (http://127.0.0.1:11434) · Modelos: qwen2.5:14b          |     |
|     |      Custo: US$ 0,00 · Privacidade: texto não sai da máquina         |     |
|     |  ( ) Codex CLI (assinatura local encontrada)                         |     |
|     |      Custo: cota do seu plano · Privacidade: envia pela CLI          |     |
|     |                                                                      |     |
|     | Ou configure uma chave de API:                                       |     |
|     |  ( ) Chave de API (OpenAI, Anthropic, Gemini, OpenRouter, Groq...)   |     |
|     |      [Provedor v] [Modelo] [Chave de API (salva no cofre do SO)]     |     |
|     |      [x] Concordo em enviar apenas texto de transcrições para <host> |     |
|     |      [ Testar conexão ]                                              |     |
|     +----------------------------------------------------------------------+     |
|     [ <- Voltar ]    [ Pular por enquanto ]      [ Concluir configuração ]       |
+----------------------------------------------------------------------------------+
```

### 3. Conteúdo e componentes por zona
1. **Passo 1 — Essencial e Hardware (`?passo=1`):**
   * **Bloco FFmpeg (`components.ffmpeg.status`, `components.manifest`):**
     * Exibe tamanho aproximado e licença (`GPL · executável separado`).
     * Aviso quando ausente: botão primário `"Baixar FFmpeg"` (exibe confirmação com tamanho/licença ou confirmação inline no próprio passo antes do download) e expansão discreta `"Já tenho FFmpeg instalado no sistema"` (`components.ffmpeg.system`).
     * Quando `incomplete: true`: alerta `"FFmpeg incompleto no disco. Reinstale ou aponte o FFmpeg do sistema."`
   * **Bloco Motor de Transcrição Local (`transcription.hardware.status`, `components.worker.status`, `components.models.manifest`):**
     * Traduz hardware para linguagem humana (sem jargões `int8_float16` ou `handshake` na camada principal):
       * Com GPU NVIDIA: `"Placa NVIDIA detectada (<nome>, <vram> GB). A transcrição usará aceleração por placa de vídeo."`
       * Sem GPU compatível (`no_compatible_gpu`): `"Sem placa NVIDIA compatível. A transcrição rodará no processador (CPU) com modelo mais leve."`
       * Com GPU AMD/Intel: explica que a transcrição local roda no processador (US-13) — não travou.
     * Mostra espaço livre necessário e destino (`components.settings.get` → `data_dir` + link discreto `"Mudar pasta de instalação"` que abre `#/config/componentes`).
     * Botão `"Instalar motor e modelo recomendados"` orquestra em sequência clara: `components.worker.install { confirmed: true }` (se ausente/quebrado) → `components.models.download { id: recommended, confirmed: true }` → `transcription.hardware.probe` (opcional/automático após instalar) + status do agrupamento VAD (`transcription.grouping`).
     * Detalhes técnicos (`compute_type`, versões de libs, `CUDA`) recolhidos em `<details>Detalhes técnicos</details>`.
   * **Nota sobre opcionais *just-in-time*:** Texto discreto informando: `"Ferramentas para baixar links do YouTube, reenquadramento automático de rosto e voz por TTS serão oferecidas só quando você usar esses recursos."`
2. **Passo 2 — Provedores (`?passo=2`):**
   * Executa `assistant.detect` ao entrar e lista opções detectadas:
     * Servidores locais em loopback encontrados (`ollama`, `lmStudio`, `llamaCpp`) com seletor de modelo encontrado e selo `"Local · US$ 0,00 · não sai do computador"`.
     * CLIs detectados (`codex`, `claude` com selo explícito `"Experimental"`, `opencode`) com selo `"Assinatura via CLI · consome cota do seu plano"` e checkbox de consentimento (`provider.cli.confirm`).
     * Opção `"Usar chave de API na nuvem"` (OpenAI, Anthropic, Gemini, OpenRouter ou endpoint compatível): campos de tipo (`kind`), endpoint (pré-preenchido por preset amigável), modelo, campo de senha para chave (salva no cofre via `provider.key.set`), checkbox de consentimento remoto (`provider.confirm`) informando que **apenas texto é enviado (nunca vídeo ou áudio)**, e botão `"Testar conexão"` (`provider.test`).
   * Ao concluir: cria/atualiza Perfil de Provedor (`provider.configure` com `profileId` ou `provider.cli.configure`), define como padrão global (`assistant.default.set`) e chama `assistant.complete { skipped: false }`.

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Baixar FFmpeg | `components.download { id: "ffmpeg", confirmed: true }` | `data_dir` gravável | `<ConfirmDialog>` com tamanho, licença e URL oficial | Barra `0..100%` e status `"FFmpeg pronto"` | `components.cancel { id: "ffmpeg" }` durante download |
| Validar FFmpeg do sistema | `components.ffmpeg.system { path? }` | Binários `ffmpeg` e `ffprobe` no caminho/PATH | Nenhuma | Exibe versão detectada e marca FFmpeg como pronto | Pode trocar depois em `#/config/componentes` |
| Instalar Motor de transcrição recomendado | `components.worker.install { confirmed: true }` → `components.models.download { id, confirmed: true }` | Conexão internet; `uv` disponível na plataforma | `<ConfirmDialog>` mostrando tamanho total (worker + libs CUDA se NVIDIA + modelo) e licença | Progresso por etapa (`Preparando ambiente Python` → `Baixando modelo` → `Pronto`) | `components.cancel { id: "worker" \| "<model_id>" }` |
| Testar hardware | `transcription.hardware.probe` | Worker e modelo instalados | Nenhuma | Atualiza configuração recomendada e selo de velocidade | `components.cancel { id: "hardware-probe" }` |
| Detectar Provedores locais / CLIs | `assistant.detect` | Nenhuma | Nenhuma | Lista servidores locais em loopback e CLIs encontrados | — |
| Salvar e testar Provedor no Passo 2 | `provider.configure` + `provider.key.set` + `provider.confirm` (ou `provider.cli.configure` + `provider.cli.confirm`) + `provider.test` | Campos válidos; DNS resolve se remoto | Consentimento explícito se remoto/CLI; custo da chamada mínima de teste se API | Exibe `"Conexão verificada"` e habilita conclusão com aquele perfil selecionado | Pode editar depois em `#/config/provedores` |
| Concluir Assistente | `assistant.default.set` + `assistant.complete { skipped: false }` | Opcionalmente sem provedor se optar por configurar depois | Nenhuma | Marca `needsSetup = false` e navega para `#/inicio` | Reabrir em `#/config/provedores` |
| Pular por enquanto | `assistant.complete { skipped: true }` | Nenhuma | Nenhuma | Marca `needsSetup = false` e navega para `#/inicio` | Reabrir em `#/config/provedores` |

### 5. Estados
* **`loading`:** `<Esqueleto>` para os cartões do Passo 1 (enquanto checa `ffmpeg.status`, `worker.status`, `hardware.status`) e do Passo 2 (enquanto `assistant.detect` sonda portas loopback em até 800 ms: `"Procurando modelos locais e CLIs no computador…"`).
* **`empty`:** No Passo 2, se `assistant.detect` não encontrar nenhum servidor local nem CLI: exibe mensagem neutra `"Nenhum servidor local ou CLI encontrado automaticamente"` e foca a opção `"Configurar chave de API"` ou `"Pular e configurar depois"`.
* **`error`:**
  * `unknown_component` (ex.: `uv` no macOS) → `"A instalação automática do motor ainda não está disponível neste sistema operacional."` + orientação ou pular.
  * `download` / `hash_mismatch` → `"Falha ao baixar ou verificar a integridade do arquivo. O download pode ser retomado."` + botão `"Tentar novamente"`.
  * `invalid_ffmpeg` / `ffprobe_missing` → `"Não encontramos o FFmpeg e o FFprobe válidos nesse caminho."`
  * `vault` / `network` / `cli_auth_required` → mensagem humana correspondente + botão `"Testar novamente"`.
* **`job_running`:** Durante download de FFmpeg, instalação do Worker, download do modelo ou sonda de hardware, exibe barra de progresso determinística com `%`, etapa legível e botão `"Cancelar"`.
* **`partial`:** Se o usuário concluir o Passo 1 apenas com FFmpeg (sem baixar o modelo ainda) ou fechar antes do Passo 2, é permitido avançar ou pular; ao abrir uma Fonte sem motor local instalado, o fluxo de Transcrição oferecerá instalação *just-in-time* ou Groq.

### 6. Eventos (`core-progress`)
Escuta no Store Global filtrando estritamente por `job`:
* `job === "ffmpeg"` (`download`, `complete`) → atualiza barra do card FFmpeg.
* `job === "worker"` (`download`, `worker`, `complete`) → traduz percentuais `25`/`45`/`95` em etapas amigáveis (`"Instalando ambiente isolado"`, `"Instalando aceleração"` / `"Instalando dependências"`, `"Verificando funcionamento"`).
* `job === "<model_id>"` (`whisper-turbo` / `whisper-small`: `download`, `complete`) → atualiza barra do modelo.
* `job === "hardware-probe"` (`probe`) → atualiza progresso do teste de hardware.
* `job === "provider.structured"` (`starting`, `complete`, `failed`) → spinner no botão `"Testar conexão"`.

### 7. Teclado e acessibilidade
* **Atalhos:** `Esc` no diálogo de confirmação cancela confirmação; `Ctrl/Cmd+K` disponível para ajuda/tema.
* **Regiões `F6`:** Barra mínima → Indicador de passos / Conteúdo do passo → Rodapé de navegação do Assistente.
* **WAI-ARIA APG:**
  * Indicador de 2 passos: `<nav aria-label="Etapas da configuração inicial">` com `aria-current="step"`.
  * Escolha do tipo de Provedor no Passo 2: `radiogroup` com `radio` acessíveis.
  * Barras de progresso: `role="progressbar"` com `aria-valuenow`, `aria-valuetext` e anúncios com throttle em `role="status"`.
  * Detalhes técnicos recolhidos em `<details>/<summary>` nativo com classe `.foco`.
* **Ordem de foco:** Botão sair/pular no topo → Conteúdo do passo atual (ações principais de cima para baixo) → `Pular por enquanto` → `Voltar` / `Próximo` / `Concluir`.

### 8. US do #26 atendidas
* US-3, US-4, US-5, US-6, US-7, US-10, US-13, US-14, US-20, US-21, US-22, US-23, US-24, US-25, US-27.

### 9. Lacunas
* **Núcleo Rust:**
  * `core/src/components.rs` não traz entradas para `ffmpeg`, `yt-dlp` e `uv` no macOS (`unknown_component`).
  * `components.worker.install` não informa tamanho estimado prévio de pacotes Python/CUDA antes de iniciar (o manifesto traz tamanho de `uv`, mas não do pacote PyTorch/CUDA baixado pelo `uv sync`).
* **Mock TS (`src/lib/core.ts`):**
  * `components.download` não cobre `ffmpeg` nem `uv`; `components.cancel` e `components.ffmpeg.system` não têm mock; `components.worker.install` não emite eventos `core-progress`.

### 10. Critérios de aceite (E2E / Playwright)
1. Com `assistant.status` retornando `needsSetup: true` ao iniciar o app em `#/inicio`, o usuário é direcionado ao Assistente no Passo 1 (`#/assistente?passo=1`).
2. O Passo 1 exibe apenas FFmpeg e Motor de transcrição local (não exibe `yt-dlp`, `deno`, `YuNet` nem `pocket-tts` como downloads obrigatórios).
3. Na camada principal do Passo 1, o texto não expõe termos internos como `int8_float16` ou `handshake` fora de `<details>`.
4. Clicar em `"Baixar FFmpeg"` abre `<ConfirmDialog>` com tamanho e licença; confirmar dispara `components.download { id: "ffmpeg", confirmed: true }` e mostra barra de progresso.
5. No Passo 2 (`#/assistente?passo=2`), ao detectar Ollama local, exibe selo `"Local · US$ 0,00 · não sai do computador"`; ao escolher chave de API remota, o botão `"Testar conexão"` exige marcar o consentimento de envio de texto.
6. Clicar em `"Pular por enquanto"` chama `assistant.complete { skipped: true }` e navega para `#/inicio`.

---

## Superfície 4 — Instalador *Just-in-Time* (`yt-dlp`/`deno`, `YuNet`, `pocket-tts`)

### 1. Objetivo e Navegação
* **Objetivo:** Instalar sob demanda ferramentas opcionais pesadas ou específicas apenas no momento em que o usuário aciona uma funcionalidade que depende delas — sem poluir a primeira execução e sempre com tamanho, licença, termo aplicável e confirmação explícita.
* **De onde chega / para onde vai:** Componente reutilizável montado inline (banner/cartão acionável) ou em `<Dialog>` disparado por:
  1. **Importar por URL** (Pacote B, `#/projeto/:id/fontes`): solicita `yt-dlp` e `deno` (mais aceite único dos Termos de URL se ainda não aceito).
  2. **Reenquadramento automático 9:16** (Pacote D, `#/projeto/:id/corte/:cid/editar` aba Enquadramento): solicita modelo `yunet` (e `worker` se ainda não instalado).
  3. **Narração por voz local** (Pacote E, `#/projeto/:id/corte/:cid/transformar` passo 3): solicita executável `pocket-tts` + modelo/vozes TTS para o idioma do Canal/Corte (ex.: `portuguese_24l` / `english`), exigindo aceite explícito do termo de uso proibido (`prohibitedUse.summaryPt`).
  Ao concluir a instalação, desbloqueia automaticamente a ação original na tela chamadora ou oferece botão único `"Continuar"` sem perder o contexto da tela; também pode ser gerenciado em `#/config/componentes`.

### 2. Layout por zonas
Exibido como **cartão contextual inline** no ponto de bloqueio ou **modal compacto** (`<Dialog>` de até `520 px`) quando acionado por um botão de ferramenta:

```
+----------------------------------------------------------------------+
| Recurso necessário para esta ação                            [Fechar]|
|----------------------------------------------------------------------|
| Para <baixar vídeos por URL / detectar rostos / gerar voz local>,    |
| o Clipes precisa baixar:                                             |
|                                                                      |
| • <Nome amigável> (ex.: YuNet — detector de rostos)                  |
|   Tamanho: 230 KB · Licença: MIT · Origem: <domínio oficial>         |
|   [Se TTS] Termo de uso responsável:                                 |
|   [Resumo em PT-BR de prohibitedUse.summaryPt]                       |
|   [ ] Li e concordo com os termos de uso deste modelo de voz         |
|                                                                      |
|   Destino: <data_dir>/...  (Espaço livre suficiente / aviso se baixo)|
|                                                                      |
| [Se downloading:]                                                    |
|   Baixando <Nome>… 64%  [====================--------]   [Cancelar]  |
|----------------------------------------------------------------------|
|                                [ Cancelar ]  [ Baixar e continuar ]  |
+----------------------------------------------------------------------+
```

### 3. Conteúdo e componentes por zona
* **Variante A — Importação por URL (`yt-dlp` + `deno`):**
  * Verifica `components.ytdlp.status`, `components.deno.status`, `components.manifest` e `sources.url.settings.get`.
  * Se `terms_accepted === false`, exibe primeiro/junto o aviso único dos Termos do YouTube (responsabilidade do usuário, sem contornar DRM/login) com checkbox que salva `sources.url.settings.set`.
  * Mostra tamanho e licença de `yt-dlp` (`Unlicense`) e `deno` (`MIT`, recomendado para desafios JS do YouTube — se `yt-dlp` já estiver instalado e apenas `deno` faltar ou falhar `js_runtime_missing`, oferece baixar `deno`).
* **Variante B — Enquadramento automático (`YuNet`):**
  * Verifica `components.worker.status` e `components.models.manifest` (item `id: "yunet"`).
  * Se `worker_installed === false`, avisa que precisa instalar o ambiente Python antes e encadeia `components.worker.install { confirmed: true }` → `components.models.download { id: "yunet", confirmed: true }`.
* **Variante C — Narração TTS (`pocket-tts` + modelo/vozes):**
  * Verifica `components.pocket_tts.status` e `tts.catalog` (modelo ativo para `pt` ou `en` do Perfil de canal).
  * Exibe tamanho separado/total de `pocket-tts` + pesos + vozes (`size`), licença, e o resumo em PT-BR do termo de uso proibido (`engine.prohibitedUse.summaryPt`, com opção de expandir `textEn`), exigindo checkbox marcado (`termsAccepted: true`) antes de habilitar `"Baixar e continuar"`.
  * Se já instalado mas `outdated === true` ou `updateAvailable === true`, oferece atualização opcional sem bloquear uso imediato se funcional.

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Aceitar termos de importação por URL | `sources.url.settings.set { terms_accepted: true, download_dir }` | `download_dir` absoluto | Checkbox explícito de responsabilidade | Libera download por URL | — |
| Instalar `yt-dlp` ou `deno` | `components.download { id: "yt-dlp" \| "deno", confirmed: true }` | `id` no manifesto da plataforma | Botão `"Baixar e continuar"` envia `confirmed: true` | Progresso `0..100%`; ao terminar, dispara callback `onInstalled()` | `components.cancel { id }` |
| Instalar `YuNet` (e Worker se ausente) | `components.worker.install { confirmed: true }` (se necessário) → `components.models.download { id: "yunet", confirmed: true }` | `worker` instalado | Botão `"Baixar e continuar"` envia `confirmed: true` | Progresso `0..100%`; ao terminar, libera `reframe.start` | `components.cancel { id: "worker" \| "yunet" }` |
| Instalar `pocket-tts` | `components.download { id: "pocket-tts", confirmed: true }` | Manifesto da plataforma | Botão `"Baixar e continuar"` envia `confirmed: true` | Progresso `0..100%` | `components.cancel { id: "pocket-tts" }` |
| Instalar modelo e vozes TTS | `tts.models.download { id, confirmed: true, termsAccepted: true }` | Checkbox `termsAccepted` marcado | Confirmação + aceite de termos obrigatório | Progresso `0..100%` (pesos + vozes); libera `narration.generate` | **`tts.models.cancel { id }`** (nunca `components.cancel`) |

### 5. Estados
* **`loading`:** Enquanto consulta `*.status`, `components.manifest` ou `tts.catalog`, mostra `<Esqueleto>` curto de 2 linhas (evita piscar botão de instalar quando já está pronto).
* **`empty` / já instalado:** Se todos os pré-requisitos do recurso já estiverem instalados e íntegros, o componente não bloqueia e devolve controle imediato ao fluxo principal.
* **`error`:**
  * `component_integrity` (ex.: `yt-dlp` adulterado) → `"O arquivo do yt-dlp não passou na verificação de integridade. Reinstale para continuar."` + botão `"Reinstalar yt-dlp"`.
  * `terms_acceptance_required` → `"Marque a caixa confirmando os termos de uso antes de baixar o modelo de voz."`
  * `hash_mismatch` / `download` → `"Falha ao baixar ou verificar o arquivo. Você pode retomar de onde parou."` + `"Tentar novamente"`.
  * `unknown_component` (ex.: `yt-dlp` ou `uv` no macOS) → `"Este componente ainda não tem instalador automático para este sistema operacional."` + orientação manual/alternativa.
* **`job_running`:** Desabilita o botão de início, exibe barra determinística (`Progress`) com `%` e rótulo da etapa (`"Baixando modelo TTS…"`, `"Baixando voz TTS…"`) e botão `"Cancelar"` ligado ao comando de cancelamento correto (`components.cancel` vs `tts.models.cancel`).
* **`partial`:** Quando `pocket-tts` já está instalado mas falta o modelo/vozes do idioma, ou `yt-dlp` está instalado mas falta `deno`, lista apenas o item faltante como pendente e marca o já presente com selo `"Instalado"`.

### 6. Eventos (`core-progress`)
* Filtra estritamente por `job`:
  * `"yt-dlp"`, `"deno"`, `"pocket-tts"`, `"yunet"`, `"worker"` (`stage: "download" | "worker" | "complete"`).
  * `"tts:<model_id>"` (`stage: "download" | "complete"` — exibe `message` para distinguir pesos vs. embeddings de voz).

### 7. Teclado e acessibilidade
* **WAI-ARIA APG:** Quando exibido em modal, usa `<Dialog>` (`role="dialog"`, foco inicial no checkbox de termos se houver ou no botão principal, `Esc` fecha quando não está baixando ou pergunta se cancela download). Quando inline, usa `<section aria-label="Instalação necessária">`.
* Links externos de licença/código-fonte abrem no navegador do sistema com texto descritivo (ex.: `"Ver código-fonte do YuNet (abre no navegador)"`).
* Todos os botões e checkboxes respeitam alvo mínimo 24×24 px e classe `.foco`.

### 8. US do #26 atendidas
* US-3, US-4, US-5, US-6, US-17, US-45, US-46, US-81, US-91.

### 9. Lacunas
* **Núcleo Rust:**
  * `yt-dlp` e `uv` ausentes no manifesto do macOS (`core/src/components.rs:50-59`).
* **Mock TS (`src/lib/core.ts`):**
  * `components.download` não suporta `id: "yt-dlp"` nem `"uv"`; `components.cancel` ausente.
  * `tts.models.download` e `components.models.download` precisam emitir `core-progress` no mock para testar cancelamento e conclusão em E2E.

### 10. Critérios de aceite (E2E / Playwright)
1. Ao acionar importação por URL com `yt-dlp` não instalado, o `<InstaladorJustInTime>` aparece mostrando tamanho, licença e botão `"Baixar e continuar"`.
2. Ao acionar Narração TTS com `tts.models.download` pendente, o botão `"Baixar e continuar"` permanece desabilitado até o checkbox de termo de uso responsável ser marcado.
3. Clicar em `"Cancelar"` durante download de modelo TTS chama `tts.models.cancel { id }` (e não `components.cancel`).
4. Clicar em `"Cancelar"` durante download de `deno` ou `yunet` chama `components.cancel { id }`.
5. Após `core-progress` emitir `stage: "complete"` (100%), o instalador invoca `onInstalled` e libera a ação original sem recarregar a página.

---

## Tela 5 — Configurações: Provedores e Tarefas de IA (`#/config/provedores`)

### 1. Objetivo e Navegação
* **Objetivo:** Gerenciar todos os **Perfis de Provedor** (API, modelo local em loopback e CLIs), chaves no cofre do sistema, consentimentos remotos, chave do Groq para Transcrição remota e o roteamento fixo **Tarefa de IA × Perfil de Provedor** com veto **Somente local** por tarefa.
* **De onde chega / para onde vai:** Acessada pelo botão `Configurações` (`Ctrl/Cmd+,`), por links de erro (`profile_unavailable`, `vault`, `local_only_violation`) ou pelo selo `Somente local`. Permite navegar entre as 6 seções laterais de `#/config/:secao` e reabrir `#/assistente`. Se `:secao === 'projeto'` for acessado sem Projeto aberto, redireciona para `#/config/provedores` com alerta discreto.

### 2. Layout por zonas
Estrutura compartilhada de Configurações: menu lateral esquerdo fixo (`180–220 px`) com as 6 seções + área principal à direita com scroll interno próprio. Prosa e formulários mantêm leitura confortável (`≤ 68 ch`), enquanto tabelas (`grid` de Tarefas de IA) usam a largura disponível sem comprimir colunas.

**Em 1366 px:**
```
+----------------------------------------------------------------------------------+
| Shell: Barra Superior                                                            |
+----------------------------------------------------------------------------------+
| Menu Config     | Conteúdo: Provedores e Tarefas de IA                           |
| (fixo à esq.)   |                                                                |
| > Provedores    | [Reabrir assistente de 2 passos]                               |
|   Custos e Aud. |                                                                |
|   Componentes   | 1. Roteamento por Tarefa de IA (grid)                          |
|   Exportação    | Provedor padrão do app: [ Perfil: OpenAI Rápido v ]            |
|   Aparência     | +------------------------------------------------------------+ |
|   Projeto atual | | Tarefa          | Perfil         | Origem/Custo | Local    | |
|   (desab. s/    | | Seleção Cortes  | [Herdar padrão]| Local · $0   | [x]      | |
|    Projeto)     | | Empacotamento   | [Claude Sonnet]| Remoto · $$  | [ ] [!]  | |
|                 | | Roteiro         | [Herdar padrão]| ...          | [x]      | |
|                 | | Tradução        | [Herdar padrão]| ...          | [ ]      | |
|                 | +------------------------------------------------------------+ |
|                 | Aviso de Janela de contexto p/ Seleção (provider.selection_state)|
|                 |                                                                |
|                 | 2. Perfis de Provedor configurados          [+ Novo Perfil]    |
|                 | [ Lista de cartões/linhas: API/Local/CLI + Testar + Editar ]   |
|                 |                                                                |
|                 | 3. Transcrição remota (Groq)                                   |
|                 | [Chave no cofre: configurada / ausente] [Salvar] [Testar] [Rem]|
+----------------------------------------------------------------------------------+
| Shell: Barra de Status                                                           |
+----------------------------------------------------------------------------------+
```

**Em 1440+ px:** A lista de Perfis e o editor/detalhe de Perfil selecionado (ou formulário de criação/edição) podem abrir lado a lado (mestre-detalhe) ou em painel lateral sem alongar a rolagem vertical; a tabela de Tarefas exibe coluna extra de estado da Janela de contexto sem truncar rótulos.

### 3. Conteúdo e componentes por zona
1. **Menu Lateral de Configurações (`<nav aria-label="Seções de Configurações">`):**
   * `Provedores e Tarefas de IA` (`#/config/provedores`)
   * `Custos, Orçamentos e Auditoria` (`#/config/custos`)
   * `Componentes e Armazenamento` (`#/config/componentes`)
   * `Exportação e Encoder` (`#/config/exportacao`)
   * `Aparência e Teclado` (`#/config/aparencia`)
   * `Projeto atual` (`#/config/projeto` — se não houver Projeto aberto, aparece com indicação `"Abra um Projeto"` e redireciona se acessado diretamente).
2. **Cabeçalho da Seção:**
   * Título `"Provedores e Tarefas de IA"`, subtítulo curto e botão secundário `"Reabrir assistente inicial"` (`#/assistente`).
3. **Bloco 1 — Roteamento por Tarefa de IA (`assistant.status`, `assistant.tasks`, `provider.selection_state`):**
   * Seletor `"Provedor padrão do app"` (`assistant.default.set`).
   * Tabela semântica (`role="grid"`) das 4 **Tarefas de IA**: `Seleção de Cortes`, `Empacotamento`, `Roteiro`, `Tradução`:
     * Coluna `Tarefa`: nome + dica do que faz.
     * Coluna `Perfil atribuído`: seletor (`Herdar padrão`, qualquer `profile:<id>`, ou CLI `codex`/`claude`/`opencode`). Se `missing[task]` existir, mostra alerta `"Perfil anterior removido"`.
     * Coluna `Destino e Custo`: selo textual + ícone (`Local · US$ 0,00`, `Remoto (<host>) · pago`, `CLI · cota do plano`).
     * Coluna `Somente local`: interruptor (`assistant.local_only.set`). Se `blocked === true` (pela tarefa ou por `projectLocalOnly`), exibe ícone de cadeado + texto `"Bloqueado pelo modo Somente local"` e botão rápido para trocar para perfil local ou usar `suggestion` se houver.
   * Cartão de compatibilidade para **Seleção de Cortes** (`provider.selection_state { task: "selection" }`): exibe estado (`Janelas completas até 15 min` / `Janelas reduzidas` / `Contexto insuficiente`), se aplicável (não exibido para CLI), e guias acionáveis para Ollama/LM Studio/llama.cpp quando `reduced`/`blocked`.
4. **Bloco 2 — Perfis de Provedor (`provider.profiles.list`, `provider.cli.status`, `provider.status`):**
   * Lista dos Perfis salvos (API/Local + os 3 CLIs: `Codex CLI`, `Claude Code CLI [Experimental]`, `OpenCode CLI`):
     * Para cada Perfil HTTP/Local: nome (`label`), tipo (`openai`/`anthropic`/`gemini`/`ollama`), modelo, endpoint, selo `Local` vs `Remoto` + status de consentimento (`confirmed`), últimos 4 dígitos da chave no cofre (`••••1234` ou `"Sem chave"`), contexto efetivo (`provider.context.get` com origem `user`/`measured`/`loaded`/`server`/`catalog`/`fallback`), botões `Testar` (`provider.test`), `Atualizar contexto` (`provider.context.get { refresh: true }`), `Medir contexto` (`provider.test { probeContext: true }` — só se `local: true`), `Editar`, `Remover` (se `id !== "legacy"`).
     * Para cada CLI: estado de confirmação (`provider.cli.confirm`), aviso explícito `"Experimental: aguarda confirmação formal da Anthropic"` no Claude Code CLI, campo de modelo `provedor/modelo` no OpenCode, campo `Timeout (segundos)` (`1..3600`, padrão `300`) e botão `Testar` (`provider.test`).
   * Formulário/Diálogo `"Novo Perfil de Provedor"` / `"Editar Perfil"`: campos organizados em **Básicos** (`Nome`, `Tipo`, `Endpoint`, `Modelo`, `Chave de API no cofre`, `Chave própria por perfil` `ownKey`, `Consentimento remoto`) e **Limites avançados** recolhidos (`Janela de contexto`, `Máx. tokens de saída`, `Timeout (s)`, `Schema nativo`, `Tokens por requisição/minuto/dia`).
   * *Nota:* Perfil `"legacy"` (se existir no disco) pode ser editado e ter sua chave removida, mas não removido pela API (`provider.profiles.remove` proíbe `"legacy"`).
5. **Bloco 3 — Transcrição Remota (Groq) (`transcription.groq.key.*`):**
   * Subseção dedicada à chave da API Groq no cofre do sistema (usada apenas quando o usuário escolhe explicitamente Groq na Transcrição): mostra se há chave configurada (`configured`), campo de entrada mascarado `Salvar chave`, botão `Testar chave` e botão `Remover chave`.

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Alterar Provedor padrão | `assistant.default.set { choice }` | Se CLI, confirmado | Se `confirmation_required`, abre diálogo de consentimento do CLI | Atualiza lista de tarefas herdadas | Selecionar anterior |
| Alterar Perfil de uma Tarefa de IA | `assistant.task.set { task, choice }` | Tarefa válida | Se CLI não confirmado, pede confirmação | Atualiza linha da tarefa e `selection_state` | Selecionar anterior / `Herdar padrão` |
| Alternar `Somente local` de uma Tarefa | `assistant.local_only.set { task, enabled }` | Nenhuma | Nenhuma | Atualiza coluna `Somente local`, flag `blocked` e selo no Shell | Alternar novamente |
| Criar / Editar Perfil de Provedor | `provider.configure` + opcional `provider.key.set` + opcional `provider.confirm` | URL válida (DNS resolve se remoto), `model` não vazio | Se remoto, exige aceite de consentimento (`provider.confirm`) para testar/usar | Atualiza lista de perfis e cache de `assistant.tasks` | Editar novamente |
| Remover Perfil de Provedor | `provider.profiles.remove { profileId }` | `profileId !== "legacy"` | `<ConfirmDialog>`: `"Remover perfil <nome>? A chave própria no cofre será apagada e tarefas ligadas a ele precisarão de outro perfil."` | Remove perfil e atualiza `assistant.tasks` (mostrando `missing` se estava em uso) | — |
| Remover chave de API (Perfil ou Groq) | `provider.key.remove { profileId? }` ou `transcription.groq.key.remove` | Chave salva | `<ConfirmDialog>`: `"Remover chave salva do cofre do sistema?"` | Atualiza indicador para `"Sem chave"` | Inserir chave de novo |
| Testar conexão do Perfil / CLI | `provider.test { profileId? }` | Perfil configurado e consentido | `<ConfirmDialog>` ou aviso explícito de custo mínimo se remoto pela 1ª vez (`provider.structured` mínimo) | Exibe `"Conexão aprovada"` ou erro mapeado | — |
| Medir contexto real de servidor local | `provider.test { profileId, probeContext: true }` | Endpoint `loopback` local (`probe_not_local` caso contrário) | Nenhuma (US$ 0,00 local) | Atualiza `context` medido e `provider.selection_state` | — |
| Configurar / Confirmar CLI | `provider.cli.configure` + `provider.cli.confirm` | CLI válido | Checkbox/diálogo de ciência (aviso extra se `claude`) | Marca CLI como confirmado e disponível nas tarefas | Desativar CLI |
| Salvar / Testar chave Groq | `transcription.groq.key.set` / `.test` | Chave não vazia; sem `local_only` no Projeto ao testar | Nenhuma ao salvar; aviso de envio HTTPS ao testar | Atualiza status `Configurada` / `Chave válida` | Remover chave |

### 5. Estados
* **`loading`:** `<Esqueleto>` para a grade de Tarefas de IA, lista de Perfis e bloco Groq.
* **`empty`:** Quando não há nenhum Perfil HTTP/local configurado e nenhum CLI confirmado:
  * Título: `"Nenhum Perfil de Provedor configurado"`
  * Descrição: `"Adicione um modelo local, uma chave de API ou uma CLI para selecionar Cortes, sugerir títulos e gerar Roteiros."`
  * CTA primário: `"Adicionar Perfil de Provedor"` + CTA secundário `"Abrir assistente inicial"`.
* **`error`:**
  * `local_only_violation` → `"Bloqueado pelo modo Somente local: esta ação tenta acessar um endereço externo."` + botão `"Trocar para Perfil local"` / `"Revisar Somente local"`.
  * `vault` → `"Não foi possível acessar o cofre de senhas do sistema operacional."`
  * `invalid_endpoint` / `insecure_endpoint` → `"Endereço inválido. Endpoints remotos com chave exigem HTTPS."`
  * `groq_key` (401) → `"A chave do Groq foi recusada. Verifique se foi copiada corretamente."`
  * `cli_auth_required` → `"O CLI escolhido não está autenticado. Faça login no terminal e teste novamente."`
  * `probe_not_local` → `"A medição automática de contexto funciona apenas para modelos locais em loopback."`
* **`job_running`:** Botões `"Testar conexão"`, `"Medir contexto"` e `"Testar chave Groq"` mostram spinner e ficam desabilitados enquanto aguardam resposta.
* **`partial`:** Quando uma Tarefa de IA aponta para perfil removido (`missing`) ou está `blocked` por `Somente local`, o restante das configurações continua operável com aviso claro apenas na linha afetada.

### 6. Eventos (`core-progress`)
* Escuta `job === "provider.structured"` (`starting`, `complete`, `failed`) para refletir andamento do teste de conexão.

### 7. Teclado e acessibilidade
* **Atalhos:** `Ctrl/Cmd+,` já traz para Configurações; `Ctrl/Cmd+K` registra ações da seção (`Novo Perfil de Provedor`, `Testar chave Groq`, `Reabrir assistente`).
* **Regiões `F6`:** Barra Superior → Menu lateral de Configurações → Conteúdo da seção → Barra de Status.
* **WAI-ARIA APG:**
  * Menu lateral: `<nav aria-label="Configurações">` com `aria-current="page"`.
  * Tabela de Tarefas de IA: `role="grid"` permitindo navegar células com setas e editar `<select>` / `<Switch>` com `Enter`/`Espaço`.
  * Campos de chave de API: `type="password"` com botão acessível `"Mostrar/ocultar chave durante digitação"` (nunca preenche chave já salva; exibe apenas máscara `••••1234` vinda de `keyLastFour`).
* **Ordem de foco:** Itens do menu lateral → `Reabrir assistente` → Seletor padrão → Grid de Tarefas → Lista de Perfis → `Novo Perfil` → Seção Groq.

### 8. US do #26 atendidas
* US-20, US-21, US-22, US-23, US-24, US-25, US-26, US-27, US-31, US-57, US-121, US-122.

### 9. Lacunas
* **Núcleo Rust:**
  * `provider.json` guarda `timeouts.remote` e `timeouts.local` globais sem comando setter para editá-los na UI (documentado em [07-provedores-jobs-e-eventos.md](../../funcionalidades/07-provedores-jobs-e-eventos.md#observa%C3%A7%C3%B5es-para-o-front-novo)).
  * `provider.profiles.remove` não permite remover o perfil `"legacy"`.
* **Mock TS (`src/lib/core.ts`):**
  * `provider.configure` não valida DNS nem `ownKey` em `"legacy"`; `provider.context.get` e `provider.selection_state` usam valores simplificados; `provider.cli.configure` não persiste `timeoutSeconds`.

### 10. Critérios de aceite (E2E / Playwright)
1. Acessar `#/config/projeto` sem Projeto aberto redireciona para `#/config/provedores` exibindo aviso explicativo.
2. Na grade de Tarefas de IA, ligar `Somente local` em `Seleção de Cortes` quando o perfil atribuído é remoto exibe o aviso de bloqueio (ícone + texto) e ativa o selo `Somente local` na Barra Superior.
3. Clicar em `"Remover"` em um Perfil de Provedor abre `<ConfirmDialog>` com foco inicial em `"Cancelar"`; confirmar chama `provider.profiles.remove` e remove o perfil da lista.
4. Clicar em `"Remover chave"` no bloco Groq ou em um Perfil abre `<ConfirmDialog>` antes de chamar `*.key.remove` (nunca remove em 1 clique como na v1).
5. Com `?estado=vazio`, a lista de Perfis mostra `"Nenhum Perfil de Provedor configurado"` e botão `"Adicionar Perfil de Provedor"`.
6. Na seção do Claude Code CLI, o selo textual `"Experimental"` aparece visível antes da ativação.

---

## Tela 6 — Configurações: Custos, Orçamentos e Auditoria (`#/config/custos`)

### 1. Objetivo e Navegação
* **Objetivo:** Dar transparência financeira e de privacidade antes, durante e depois do uso de Provedores: configurar tetos de orçamento do Projeto aberto, consultar gastos reais (inclusive falhas cobradas), inspecionar a trilha de auditoria SHA-256 sem conteúdo de texto, ajustar sobrescritas da tabela de preços e simular custos.
* **De onde chega / para onde vai:** Acessada pelo menu lateral de Configurações (`#/config/custos`), pelo indicador de orçamento/pausa na Barra Superior ou pela Fila de Jobs. Funciona mesmo sem Projeto aberto para Tabela de Preços e Estimador; os blocos de Orçamentos do Projeto, Gastos Reais e Auditoria exibem estado explicativo quando nenhum Projeto está aberto.

### 2. Layout por zonas
Menu lateral de Configurações à esquerda + área principal em largura confortável com sub-abas internas (`Abas` estilo sublinhado) para evitar rolagem excessiva:
1. `Orçamentos e Gastos` (padrão quando há Projeto aberto)
2. `Auditoria`
3. `Tabela de Preços e Estimador`

**Em 1366 px e 1440+ px:**
```
+----------------------------------------------------------------------------------+
| Shell: Barra Superior                                                            |
+----------------------------------------------------------------------------------+
| Menu Config     | Custos, Orçamentos e Auditoria                                 |
|   Provedores    | Abas: [ Orçamentos e Gastos ] [ Auditoria ] [ Preços/Estimador]|
| > Custos e Aud. |----------------------------------------------------------------|
|   Componentes   | (Aba 1: Orçamentos e Gastos — requer Projeto aberto)           |
|   Exportação    | Orçamentos ativos (jobs.budget.get):                           |
|   Aparência     | +------------------------------------------------------------+ |
|   Projeto atual | | Escopo | Gasto / Teto USD | Chamadas | Tokens | Estado     | |
|                 | | Tarefa: selection | $0.42 / $1.00 | 8/20 | ... | [Editar]  | |
|                 | | Lote #3           | $1.05 / $1.00 | ...  | [Pausado: Continuar]|
|                 | +------------------------------------------------------------+ |
|                 |                                                                |
|                 | Histórico real de chamadas (provider.cost.list):               |
|                 | Filtro: [Todas v] [Somente falhas cobradas]                    |
|                 | +------------------------------------------------------------+ |
|                 | | Data | Tarefa | Perfil/Modelo | Tokens | Custo | Desfecho  | |
|                 | +------------------------------------------------------------+ |
+----------------------------------------------------------------------------------+
```

### 3. Conteúdo e componentes por zona
1. **Aba `Orçamentos e Gastos` (requer Projeto aberto):**
   * **Orçamentos do Projeto (`jobs.budget.get`, `jobs.budget.set`, `jobs.budget.continue`):**
     * Lista orçamentos configurados por `scope` (`"task"` ou `"batch"`) e `key` (ex.: `selection`, `packaging`, `script`, `translation`, ou ID do lote), mostrando barra de progresso `microUsd / maxCostMicroUsd`, `calls / maxCalls`, `tokens / maxTokens`, `durationMs / maxWallMs` (sempre `tabular-nums`).
     * Botão `Editar tetos` (`jobs.budget.set`), opção `Zerar contagem` (`resetUsage: true`) e, quando `paused !== null`, banner prioritário com motivo traduzido (`budget_cost`, `budget_calls`, `budget_tokens`, `time_budget_exhausted`, `cost_unknown`) e botão `"Ajustar e continuar fila"` (`jobs.budget.continue`).
     * Ação `"Definir orçamento por tarefa"` para criar teto em tarefas ainda sem teto.
   * **Histórico real de gastos (`provider.cost.list`):**
     * Exibe `createdAt`, `task`, `profile`, `provider`/`model`, `inputTokens`/`outputTokens`, `costKind` (`usd` em `$`, `zero` `"US$ 0,00"`, `plan_quota` `"Cota do plano"`, `unknown` `"Desconhecido"`), `microUsd` vs. `estimateMicroUsd`, e `outcome` (destacando falhas cobradas com `outcome !== "ok"` e `microUsd > 0`, conforme ADR-0009).
     * Totalizador no topo: soma em USD do Projeto, total de chamadas em cota de plano e chamadas de custo desconhecido.
2. **Aba `Auditoria` (`provider.audit.list` — requer Projeto aberto):**
   * Explicação clara no topo (≤ 68 ch): `"Nenhum texto de Transcrição, Roteiro ou chave de API é salvo aqui. A trilha registra apenas destino, tamanho em bytes e assinaturas criptográficas SHA-256 para verificação."`
   * Filtro por `job` (`job?: number`) ou Tarefa.
   * Tabela `grid` com colunas: `Job`, `Tarefa / Versão`, `Provedor / Modelo`, `Host de destino` (`loopback` vs. domínio externo), `Bytes enviados`, `Desfecho`, e hashes recolhidos/truncados com botão `Copiar` (`promptSha256`, `inputSha256`, `responseSha256`).
3. **Aba `Tabela de Preços e Estimador` (global, funciona sem Projeto aberto):**
   * **Estimador manual (`provider.cost.estimate`):** seletor de Perfil ou Tarefa, texto de amostra ou tamanho estimado, exibe resultado no padrão `<ResumoCustoPrivacidade>` (`~US$ min – max`, `inputTokensRange`, `priceSource: "table" | "override"`).
   * **Tabela de preços (`provider.prices.get`, `provider.prices.set`, `provider.prices.clear`):**
     * Lista preços embutidos (com `updatedAt` da tabela) e sobrescritas do usuário (`overrides`) destacando quando há preço customizado.
     * Formulário `"Sobrescrever preço"` (`provider`, `model`, `inputPerMillion`, `outputPerMillion`, limites opcionais e `tiers` crescentes) e botão `"Restaurar padrão"` (`provider.prices.clear`).

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Salvar teto de orçamento | `jobs.budget.set { scope, key, ... }` | Projeto aberto; valores válidos (`> 0` ou `null`) | Nenhuma | Atualiza barra de consumo/teto do escopo | Editar/remover teto |
| Retomar fila pausada por orçamento | `jobs.budget.continue { scope, key, ..., confirmed?, resetUsage? }` | Projeto aberto; se `cost_unknown`, exige ciência explícita | Checkbox / `<ConfirmDialog>` se `cost_unknown` (`confirmed: true`) | Remove pausa em `ai_pauses`, atualiza indicador do Shell e retoma fila | — |
| Simular custo | `provider.cost.estimate` | Perfil ou tarefa configurada | Nenhuma (cálculo local) | Exibe faixa USD, tokens estimados e localidade | — |
| Salvar sobrescrita de preço | `provider.prices.set` | Valores `>= 0` e `tiers` em ordem crescente | Nenhuma | Atualiza tabela marcando linha como `"Personalizado"` | `"Restaurar padrão"` (`provider.prices.clear`) |
| Remover sobrescrita de preço | `provider.prices.clear { provider, model }` | Sobrescrita existente | `<ConfirmDialog>` opcional ou ação direta reversível | Volta a usar preço embutido | Inserir sobrescrita novamente |

### 5. Estados
* **`loading`:** `<Esqueleto>` para tabelas de Orçamentos, Gastos, Auditoria e Preços.
* **`empty`:**
  * Sem Projeto aberto nas abas `Orçamentos e Gastos` e `Auditoria`: `"Nenhum Projeto aberto. Abra um Projeto para acompanhar orçamentos, gastos reais e trilha de auditoria."` + CTA `"Ir para Início"` (`#/inicio`). (Aba `Tabela de Preços e Estimador` continua funcionando.)
  * Com Projeto aberto e listas vazias: `"Nenhuma chamada de IA registrada neste Projeto ainda"` / `"Nenhum teto de orçamento configurado"` + CTA `"Configurar teto por tarefa"`.
* **`error`:**
  * Nunca silencia `provider.cost.list` com `catch {}` (corrigindo a v1!). Exibe `role="alert"` com `"Não foi possível carregar os registros de custo do Projeto."` + `"Tentar novamente"`.
  * `invalid_budget` → `"Informe limites numéricos positivos para o orçamento."`
  * `invalid_price` → `"Verifique os valores por milhão de tokens e garanta que as faixas de preço estejam em ordem crescente."`
  * `local_only_violation` no Estimador → `"Estimativa bloqueada pelo modo Somente local para este perfil remoto."`
* **`job_running`:** Botão de continuar orçamento ou estimar mostra spinner curto enquanto aguarda retorno.
* **`partial`:** Quando há orçamento ativo em estado `paused !== null`, exibe faixa de alerta no topo da aba indicando exatamente o escopo pausado e ação direta de retomada.

### 6. Eventos (`core-progress`)
* Quando o Store Global recebe `ai:<task>:done` ou `ai:<task>:paused`, invalida e recarrega `jobs.budget.get`, `provider.cost.list` e `provider.audit.list` caso a tela esteja montada.

### 7. Teclado e acessibilidade
* **WAI-ARIA APG:**
  * Sub-abas usam `role="tablist"` / `role="tab"` / `role="tabpanel"` (`@base-ui/react/tabs`).
  * Tabelas de Gastos, Auditoria e Preços usam `role="grid"` ou `<table>` semântico com cabeçalhos `<th scope="col">` e valores numéricos com `tabular-nums`.
  * Botões de copiar hash SHA-256 têm `aria-label="Copiar hash de entrada da chamada <id>"` e anunciam `"Hash copiado"` em `role="status"`.

### 8. US do #26 atendidas
* US-28 (estimativa antes e custo real depois), US-29 (teto de custo que pausa a fila), US-30 (cota do plano em CLI), US-113, US-122 (auditoria sem dados sensíveis).

### 9. Lacunas
* **Núcleo Rust:** Nenhuma — `jobs.budget.*`, `provider.cost.*`, `provider.prices.*` e `provider.audit.list` estão todos prontos.
* **Mock TS (`src/lib/core.ts` e `src/lib/batchMock.ts`):**
  * `provider.audit.list` e `jobs.budget.get` não existem no mock atual.
  * `jobs.budget.set` e `jobs.budget.continue` em `batchMock.ts` não suportam `scope: "task"` e retornam formato divergente do Rust (`{ budgets: [...] }`).
  * `provider.cost.list` depende de `?source-test=1` no mock; `provider.cost.estimate` só simula `kind: "usd"`; `provider.prices.get` lista apenas 1 modelo.

### 10. Critérios de aceite (E2E / Playwright)
1. Sem Projeto aberto, `#/config/custos` exibe aviso com CTA `"Ir para Início"` na aba `Orçamentos e Gastos`, mas permite navegar para `Tabela de Preços e Estimador` e usar normalmente.
2. Com Projeto aberto, a aba `Auditoria` exibe a declaração de que nenhum texto de Transcrição/Roteiro é armazenado e lista chamadas com `host`, `sentBytes` e hashes SHA-256.
3. Na aba `Orçamentos e Gastos`, quando um orçamento está pausado (`paused !== null`), clicar em `"Ajustar e continuar fila"` chama `jobs.budget.continue` e limpa o estado de pausa.
4. Na lista de gastos (`provider.cost.list`), uma falha cobrada (`outcome !== "ok"` e `microUsd > 0`) é exibida normalmente no total e marcada com status explícito de erro + valor cobrado.
5. Ao falhar `provider.cost.list`, a tela exibe container `role="alert"` com botão `"Tentar novamente"` (nunca engole o erro silenciosamente).

---

## Tela 7 — Configurações: Componentes e Armazenamento (`#/config/componentes`)

### 1. Objetivo e Navegação
* **Objetivo:** Gerenciar todos os componentes opcionais e essenciais (FFmpeg gerenciado ou do sistema, `yt-dlp`, `deno`, `pocket-tts`, Worker Python, catálogo assinado, modelos Whisper/YuNet e vozes TTS), configurar o hardware de **Transcrição** (com escolha manual e **agrupamento VAD #279**) e definir pastas e limite LRU de cache.
* **De onde chega / para onde vai:** Acessada pelo menu lateral de Configurações (`#/config/componentes`), por links de erros (`component_missing`, `insufficient_space`) ou a partir do Assistente de Primeiro Uso.

### 2. Layout por zonas
Menu lateral de Configurações à esquerda + conteúdo com sub-abas ou blocos colapsáveis claros para não reproduzir a pilha infinita da v1:
* Sub-aba 1: `Hardware de Transcrição` (em destaque primeiro ou aba padrão junto com Essenciais)
* Sub-aba 2: `Componentes e Modelos` (`FFmpeg`, `yt-dlp`, `deno`, `Worker Python`, `Whisper/YuNet`, `Catálogo`)
* Sub-aba 3: `Vozes TTS (Narração)` (`pocket-tts` + `tts.catalog`)
* Sub-aba 4: `Pastas e Armazenamento` (`data_dir`, `cache_dir`, `cache_limit_bytes`)

**Em 1366 px e 1440+ px:**
```
+----------------------------------------------------------------------------------+
| Shell: Barra Superior                                                            |
+----------------------------------------------------------------------------------+
| Menu Config     | Componentes e Armazenamento                                    |
|   Provedores    | Abas: [ Hardware Transcrição ] [ Componentes/Modelos ]         |
|   Custos e Aud. |       [ Vozes TTS ] [ Pastas e Cache ]                         |
| > Componentes   |----------------------------------------------------------------|
|   Exportação    | Hardware de Transcrição (sub-aba 1)                            |
|   Aparência     | Placa detectada: NVIDIA RTX 3050 (4 GB VRAM) · 16 GB RAM       |
|   Projeto atual | Configuração ativa: Automática (Whisper Turbo · GPU)           |
|                 | [ Testar hardware novamente ]  [ Voltar ao automático ]        |
|                 |                                                                |
|                 | Agrupamento de falas por silêncio (VAD #279):                  |
|                 | Modo: (●) Automático (ligado na CPU, desligado na GPU)         |
|                 |       ( ) Manual: [x] Agrupar trechos consecutivos             |
|                 | Info: "Na CPU acelera ~18%; na GPU usa ~1 GB a mais de VRAM    |
|                 |        sem ganho medido."                                      |
|                 |                                                                |
|                 | Troca manual de modelo/dispositivo (opções compatíveis):       |
|                 | [ Lista de opções enabled/disabled com motivo claro ]          |
+----------------------------------------------------------------------------------+
```

### 3. Conteúdo e componentes por zona
1. **Sub-aba `Hardware de Transcrição` (`transcription.hardware.*`, `transcription.grouping`):**
   * Resumo em linguagem humana da GPU (`gpu`), RAM (`ram`), se CUDA está ativo (`cuda`) e eventual `fallback_reason` traduzido (`probe_timeout` / `gpu_probe_failed`: *"O teste na placa de vídeo falhou ou expirou; usando processador como alternativa segura."*).
   * Rótulos amigáveis para `effective` (ex.: `"Modelo rápido de alta precisão · Placa NVIDIA"` em vez de `whisper-turbo / cuda / int8_float16`), com detalhes técnicos recolhidos em `<details>`.
   * Lista de combinações (`options`): opções indisponíveis mostram `reason` em PT-BR (ex.: `"Exige 8 GB de RAM para este modelo na CPU"`, `"Requer placa NVIDIA e ambiente CUDA"`).
   * Botões: `"Testar hardware"` (`transcription.hardware.probe`) e `"Restaurar automático"` (`transcription.hardware.choose { reset: true }`, quando `manual === true`).
   * **Bloco obrigatório — Agrupamento de VAD (#279):**
     * Controle de modo `Automático` (`transcription.grouping { auto: true }`) vs. `Manual` (`{ enabled: boolean }`), exibindo o tamanho de lote efetivo (`size` / `measured_size`).
     * **Aviso explícito obrigatório:** `"No modo automático, fica ligado na CPU e desligado na GPU: na CPU acelera ~18%; na GPU usa ~1 GB a mais de VRAM sem ganho medido."`
2. **Sub-aba `Componentes e Modelos`:**
   * **FFmpeg:** status (`installed`, `incomplete`), botão `Baixar/Reinstalar` (`components.download { id: "ffmpeg", confirmed: true }`) e seção `"Usar FFmpeg do sistema"` (`components.ffmpeg.system { path? }`).
   * **Ferramentas de URL (`yt-dlp` e `deno`):** status/versão, aviso se `component_integrity`, botão `Baixar` / `Atualizar yt-dlp` (`components.ytdlp.update { confirmed: true }`) ou `Baixar deno`.
   * **Worker Python e Modelos (`components.worker.*`, `components.models.*`, `components.catalog.*`):**
     * Status do ambiente Python isolado (sem jargão `handshake`/`protocol` fora de `<details>`), botão `Instalar / Reparar`.
     * Catálogo de modelos (`components.catalog.status`, botão `"Verificar catálogo de modelos"` → `components.catalog.check`, exibindo `warning` traduzido se o cache remoto falhou e caiu para o embutido).
     * Lista de modelos (`whisper-turbo`, `whisper-small`, `yunet`): nome legível, uso, tamanho, licença, link de código-fonte, estado (`Não instalado` / `Instalado` / `Atualização disponível`) e botão `Baixar` / `Atualizar` (exige `<ConfirmDialog>` com tamanho e licença).
3. **Sub-aba `Vozes TTS (Narração)` (`components.pocket_tts.status`, `tts.catalog`, `tts.models.*`):**
   * Card `pocket-tts` (tamanho, licença, instalar/atualizar).
   * Seletor de modelo ativo por idioma (`PT-BR` e `EN` via `tts.models.choose`), lista de vozes com atribuição e licença, resumo do termo de uso proibido (`prohibitedUse.summaryPt`) e download/atualização via `tts.models.download { id, confirmed: true, termsAccepted: true }` (cancelamento por `tts.models.cancel`).
4. **Sub-aba `Pastas e Armazenamento` (`components.settings.get` / `.set`):**
   * Campo `Pasta de componentes e modelos (data_dir)` (seletor de pasta + input editável).
   * **Aviso explícito e obrigatório:** `"Alterar a pasta de componentes vale apenas para downloads futuros. Arquivos já baixados não são movidos automaticamente (e listas de Projetos, histórico de encoder e diagnóstico continuam na pasta padrão de dados do app)."`
   * Campo `Pasta de cache temporário (cache_dir)` (proxies, ondas de áudio e miniaturas).
   * Campo `Limite do cache (GB)` (`cache_limit_bytes`, padrão 10 GB) com validação `> 0` e botão `Salvar pastas e limite`.

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Executar sonda de hardware | `transcription.hardware.probe` | Worker instalado; se CUDA, `whisper-turbo` baixado | Nenhuma | Atualiza hardware detectado, escolha recomendada e tentativas | `components.cancel { id: "hardware-probe" }` |
| Escolher combinação manual / resetar | `transcription.hardware.choose` | Opção `enabled: true` | Nenhuma | Atualiza configuração efetiva e exibe botão `"Restaurar automático"` | `choose { reset: true }` |
| Alterar agrupamento VAD #279 | `transcription.grouping` (`{ auto: true }` ou `{ enabled }`) | Nenhuma | Nenhuma | Atualiza modo e lote efetivo exibido | Alternar para `auto: true` |
| Baixar Componente ou Modelo ML | `components.download` / `components.models.download` / `components.worker.install` | `data_dir` gravável; plataforma suportada | `<ConfirmDialog>` com tamanho, licença e fonte oficial (`confirmed: true`) | Barra `0..100%` no item e atualização de status | `components.cancel { id }` |
| Atualizar `yt-dlp` | `components.ytdlp.update { confirmed: true }` | `yt-dlp` instalado | `<ConfirmDialog>` | Progresso e nova versão ou `"Já está atualizado"` | `components.cancel { id: "yt-dlp" }` |
| Validar FFmpeg do sistema | `components.ffmpeg.system { path? }` | `ffmpeg` + `ffprobe` acessíveis | Nenhuma | Registra `ffmpeg_path` e exibe versão | Reinstalar gerenciado ou apontar outro |
| Verificar catálogo de modelos | `components.catalog.check` | Internet | Nenhuma | Atualiza `version`/`source` ou mostra que já está atualizado | — |
| Baixar / Escolher modelo TTS | `tts.models.download` / `tts.models.choose` | Aceite de termo de uso (`termsAccepted: true`) para download | `<ConfirmDialog>` com tamanho, licença e termo de uso proibido | Instala pesos/vozes ou define modelo ativo do idioma | `tts.models.cancel { id }` |
| Salvar pastas e limite de cache | `components.settings.set` | Caminhos absolutos; limite `> 0` | Nenhuma | Salva configurações e revalida FFmpeg gerenciado no novo `data_dir` | Restaurar caminho anterior |

### 5. Estados
* **`loading`:** `<Esqueleto>` por sub-aba enquanto consultas iniciais (`manifest`, `status`, `settings.get`, `tts.catalog`, `hardware.status`) carregam. Nunca oculta a seção com `return null`.
* **`empty`:** Se manifesto ou lista de vozes retornar vazio (falha atípica), exibe `<Estado tipo="vazio">` explicativo com `"Verificar catálogo"`.
* **`error`:** Mapeia `CoreError.code`:
  * `worker_missing` / `model_missing` → `"Instale o ambiente Python e o modelo recomendado antes de testar o hardware."` + botão que leva à sub-aba `Componentes e Modelos`.
  * `ram_insufficient` → `"Este modelo em CPU exige pelo menos 8 GB de RAM."`
  * `gpu_unavailable` → `"Placa NVIDIA ou aceleração CUDA não disponível neste ambiente."`
  * `invalid_ffmpeg` / `ffprobe_missing` → `"FFmpeg ou FFprobe não encontrado no caminho informado."`
  * `catalog_signature_invalid` / `catalog_rollback` → `"A assinatura do catálogo remoto não pôde ser verificada; mantendo catálogo seguro embutido."`
  * `invalid_settings` → `"Informe pastas com caminho completo (absoluto) e limite de cache maior que zero."`
* **`job_running`:** Cada cartão de componente/modelo escuta **apenas seu próprio `job`** em `core-progress` (corrigindo o bug da v1 que misturava barras). Botão `"Cancelar"` visível ao lado da barra.
* **`partial`:** FFmpeg `incomplete: true` ou Worker `outdated: true` / `error` aparece com selo de atenção `"Incompleto"` / `"Atualização recomendada"` e botão único de reparo.

### 6. Eventos (`core-progress`)
* Filtra estritamente `e.payload.job`:
  * `"ffmpeg"`, `"yt-dlp"`, `"deno"`, `"pocket-tts"`, `"uv"`, `"worker"`, `"catalog"`, `"<model_id>"`, `"tts:<model_id>"`, `"hardware-probe"`.

### 7. Teclado e acessibilidade
* **WAI-ARIA APG:** Sub-abas em `role="tablist"`; opções de hardware em `radiogroup`; botões só-ícone e ações de cancelamento com `aria-label` específico (`"Cancelar download de FFmpeg"`).
* Detalhes técnicos (`SHA-256`, `Ed25519`, `handshake`, `compute_type`) sempre dentro de `<details>` acessíveis por teclado.

### 8. US do #26 atendidas
* US-3, US-4, US-5, US-6, US-7, US-8, US-9, US-10, US-11, US-13, US-14, US-17, US-51, US-91.

### 9. Lacunas
* **Núcleo Rust:**
  * Mudança #279 em `transcription.grouping` (`mode: "auto" | "manual"`, `auto: true`) está decidida em [03-transcricao.md](../../funcionalidades/03-transcricao.md#transcriptiongrouping) e aguardando implementação no Rust.
  * Manifesto no macOS sem `ffmpeg`, `yt-dlp`, `uv`.
* **Mock TS (`src/lib/core.ts`):**
  * Faltam `components.cancel`, `components.settings.set`, `components.ffmpeg.system`, cobertura completa de `components.download` (`ffmpeg`, `yt-dlp`, `uv`) e suporte ao contrato atualizado do `#279` em `transcription.grouping`.

### 10. Critérios de aceite (E2E / Playwright)
1. Na sub-aba `Hardware de Transcrição`, o aviso exato do agrupamento VAD #279 (`"na CPU acelera ~18%; na GPU usa ~1 GB a mais de VRAM sem ganho medido"`) está visível sem precisar abrir `<details>`.
2. Ao baixar dois itens ou simular `core-progress` de `job: "deno"`, apenas a barra de progresso do `deno` atualiza (não vaza para outros cartões).
3. Na sub-aba `Pastas e Armazenamento`, o aviso de que alterar `data_dir` não move arquivos já baixados é visível antes de salvar; salvar caminho relativo exibe erro humano sem `CoreError.code` cru.
4. Clicar em `"Baixar"` em um modelo Whisper abre `<ConfirmDialog>` (não `window.confirm`) exibindo tamanho e licença.
5. Na sub-aba `Vozes TTS`, o texto do termo de uso proibido e o checkbox de aceite são obrigatórios antes de chamar `tts.models.download`.

---

## Tela 8 — Configurações: Exportação e Encoder (`#/config/exportacao`)

### 1. Objetivo e Navegação
* **Objetivo:** Exibir o estado da detecção de encoders H.264 de vídeo (NVENC, QSV, AMF, VideoToolbox ou x264 em CPU), permitir reexecutar o teste real de 1 s e escolher manualmente entre os encoders aprovados ou modo automático.
* **De onde chega / para onde vai:** Acessada pelo menu lateral de Configurações (`#/config/exportacao`) ou via atalho na Mesa de Exportação quando houver aviso de `encoder_fallback`.

### 2. Layout por zonas
```
+----------------------------------------------------------------------------------+
| Shell: Barra Superior                                                            |
+----------------------------------------------------------------------------------+
| Menu Config     | Exportação e Encoder                                           |
|   Provedores    | Exporta vídeos em 1080×1920 (H.264) usando aceleração quando   |
|   Custos e Aud. | disponível, com fallback seguro para CPU (x264).               |
|   Componentes   |                                                                |
| > Exportação    | Status atual:                                                  |
|   Aparência     | [✓] Encoder ativo: NVIDIA NVENC (Automático) · GPU detectada   |
|   Projeto atual | Última verificação: <data/hora>  [ Re-testar encoders ]        |
|                 |                                                                |
|                 | Escolha de encoder:                                            |
|                 |  (•) Automático (usa o mais rápido aprovado)                   |
|                 |  ( ) NVIDIA NVENC (h264_nvenc) — aprovado                      |
|                 |  ( ) Processador / CPU (libx264) — aprovado                    |
|                 |  ( ) Intel QSV / AMD AMF — não disponível neste computador     |
+----------------------------------------------------------------------------------+
```

### 3. Conteúdo e componentes por zona
* **Cartão de Status (`export.encoder.status`):**
  * Se `ffmpeg === false`: aviso claro `"FFmpeg não está instalado. Instale o FFmpeg para detectar encoders de vídeo."` + botão `"Ir para Componentes"` (`#/config/componentes`).
  * Se `detected === false`: `"Ainda não testamos os encoders deste computador. Por padrão usaremos o processador (x264)."` + CTA primário `"Detectar encoders agora"`.
  * Se `stale === true`: alerta discreto `"O FFmpeg ou o driver de vídeo mudou desde o último teste. Recomendamos testar novamente."`
  * Exibe `effective` traduzido em linguagem simples (ex.: `h264_nvenc` → `"Placa NVIDIA (NVENC)"`, `h264_qsv` → `"Intel Quick Sync"`, `h264_amf` → `"AMD AMF"`, `h264_videotoolbox` → `"Apple VideoToolbox"`, `libx264` → `"Processador / CPU (x264)"`).
* **Seletor de Encoder (`export.encoder.set`):**
  * Opção `"Automático (recomendado)"` (`{ encoder: null }`) + opções em `passed` habilitadas; opções testadas que não passaram ficam informativas/desabilitadas para evitar falha na exportação.
  * Botão `"Detectar encoders novamente"` (`export.encoder.detect`).

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Carregar seção | `export.encoder.status` | Nenhuma | Nenhuma | Mostra estado atual e lista `passed` | — |
| Detectar encoders | `export.encoder.detect` | FFmpeg e `ffprobe` instalados | Nenhuma (teste local de 1 s) | Atualiza `passed`, `effective`, `detected_at` e limpa `stale` | — |
| Escolher encoder ou Automático | `export.encoder.set { encoder: string \| null }` | `detected === true` | Nenhuma | Atualiza `manual` e `effective` | Selecionar `Automático` (`null`) |

### 5. Estados
* **`loading`:** `<Esqueleto>` de 3 linhas antes de `export.encoder.status` responder.
* **`empty`:** Quando `detected === false` (nenhuma sonda rodada ainda), explica que o fallback `x264` garante a exportação e oferece CTA `"Detectar encoders agora"`.
* **`error`:**
  * `component_missing` / `ffprobe_missing` → `"FFmpeg ou FFprobe ausente. Instale em Componentes para testar os encoders."` + botão `"Ir para Componentes"`.
  * `encoder_invalid` → `"Este encoder não está disponível ou ainda não foi testado neste computador."`
  * `export_failed` → `"Não foi possível concluir o teste dos encoders (limite de tempo ou erro no FFmpeg)."` + `"Tentar novamente"`.
* **`job_running`:** Durante `export.encoder.detect` (chamada síncrona bloqueante de até 30 s por sonda), botão entra em estado `carregando` (`"Testando encoders (pode levar alguns segundos)…"`) e opções de rádio ficam desabilitadas.
* **`partial`:** Quando `stale === true`, mantém encoders utilizáveis visíveis com faixa sugerindo nova detecção.

### 6. Eventos (`core-progress`)
* Nenhum (`export.encoder.detect` é síncrono sem eventos `core-progress`).

### 7. Teclado e acessibilidade
* Lista de encoders implementada como `radiogroup` semântico com `.foco`, usando texto + ícone (nunca só cor) para indicar `Aprovado` vs. `Indisponível`.

### 8. US do #26 atendidas
* US-15 (detecção e teste real de encoders NVENC, QSV, AMF, VideoToolbox, x264 com fallback).

### 9. Lacunas
* **Núcleo Rust:** Nenhuma para esta tela. (O bug de `export.status` omitir `encoder_fallback` impacta Editor/Exportação nos Pacotes D e F.)
* **Mock TS:** `src/features/export/mock.ts` já cobre `export.encoder.*`, mas deve permitir simular `ffmpeg: false` e `stale: true` via query/estado para testes E2E.

### 10. Critérios de aceite (E2E / Playwright)
1. Com `ffmpeg: false`, a tela exibe aviso humano e botão `"Ir para Componentes"` que navega para `#/config/componentes`.
2. Clicar em `"Detectar encoders novamente"` chama `export.encoder.detect`, exibe estado de carregamento no botão e atualiza o encoder efetivo.
3. Selecionar um encoder específico da lista `passed` chama `export.encoder.set { encoder }` e seleciona `"Automático"` envia `{ encoder: null }`.

---

## Tela 9 — Configurações: Aparência e Teclado (`#/config/aparencia`)

### 1. Objetivo e Navegação
* **Objetivo:** Permitir ajustar tema, contraste, escala de texto da interface, idioma e gerenciar o mapa completo de atalhos de teclado — incluindo remapeamento e o interruptor de acessibilidade **WCAG 2.2 SC 2.1.4** para teclas únicas.
* **De onde chega / para onde vai:** Acessada pelo menu lateral de Configurações (`#/config/aparencia`) ou pelo atalho `?` → link `"Personalizar atalhos"`.

### 2. Layout por zonas
```
+----------------------------------------------------------------------------------+
| Shell: Barra Superior                                                            |
+----------------------------------------------------------------------------------+
| Menu Config     | Aparência e Teclado                                            |
|   Provedores    |                                                                |
|   Custos e Aud. | 1. Visual e Idioma                                             |
|   Componentes   | Tema:     [ Escuro ]  [ Claro ]  [ Seguir sistema ]            |
|   Exportação    | Contraste:[ ] Modo Alto Contraste                              |
| > Aparência     | Escala UI:[ 100% (Padrão 13 px) ]  [ 115% (Maior 15 px) ]      |
|   Projeto atual | Idioma:   [ Português (Brasil) v ]                             |
|                 | Painéis:  [ ] Abrir gavetas/painéis só por clique/atalho       |
|                 |               (desativa abertura acidental ao encostar mouse)  |
|                 |----------------------------------------------------------------|
|                 | 2. Acessibilidade de Teclado (WCAG 2.1.4)                      |
|                 | Teclas únicas (Espaço, J, K, L, I, O, A, R...):                |
|                 |  (•) Ativas fora de campos de texto (padrão NLE)               |
|                 |  ( ) Exigir Alt + tecla (evita disparos acidentais)            |
|                 |  ( ) Desligar todos os atalhos de tecla única                  |
|                 |----------------------------------------------------------------|
|                 | 3. Mapa de Atalhos (pesquisável e remapeável)                  |
|                 | [ Buscar ação ou tecla… ]        [ Restaurar padrões ]         |
|                 | +------------------------------------------------------------+ |
|                 | | Escopo     | Ação                  | Atalho      | Ação    | |
|                 | | Global     | Paleta de comandos    | Ctrl+K      | [Editar]| |
|                 | | Transporte | Reproduzir / Pausar   | Espaço      | [Editar]| |
|                 | | Revisão    | Aprovar candidato     | A           | [Editar]| |
|                 | +------------------------------------------------------------+ |
+----------------------------------------------------------------------------------+
```

### 3. Conteúdo e componentes por zona
1. **Visual e Idioma:**
   * **Tema (`src/lib/tema.ts`):** `Escuro`, `Claro` e `Sistema` (expondo os 3 modos já suportados por `tema.ts`, corrigindo a omissão de `Sistema` na v1).
   * **Alto Contraste:** interruptor que aplica `[data-contrast="high"]` no `<html>` (elevando contraste de bordas e texto terciário para ≥ 7:1).
   * **Escala da interface:** controle segmentado `100% (Padrão)` vs. `115% (Texto maior)` — ajusta variável raiz de escala de texto sem quebrar layout em `1366×768`.
   * **Idioma (`src/lib/i18n.ts`):** `Português (Brasil)` (`pt-BR`) e `English` (`en`).
   * **Movimento e painéis:** nota informando respeito automático a `prefers-reduced-motion` + interruptor para exigir clique/atalho na abertura de painéis/gavetas (evitando obstrução de foco — WCAG 2.4.11).
2. **Acessibilidade de Teclado (WCAG 2.2 SC 2.1.4):**
   * Seletor de 3 opções para atalhos de caractere único (`Espaço`, `J`, `K`, `L`, `I`, `O`, `A`, `R`, `?`, `+`, `-`):
     1. `"Ativos fora de campos de texto"` (padrão).
     2. `"Exigir modificador Alt"` (transforma `A` em `Alt+A`, etc.).
     3. `"Desligados"` (desativa teclas únicas sem modificador; atalhos com `Ctrl/Cmd`, `F6` e teclas de função continuam ativos).
3. **Mapa Pesquisável de Atalhos e Remapeamento (`useComandos`):**
   * Campo de busca por nome da ação, escopo ou tecla.
   * Tabela listando todos os atalhos oficiais do mapa da arquitetura (Global, Transporte, Revisão de Cortes, Editor do Corte, Transcrição).
   * Botão `"Remapear"` em cada linha: entra em modo de captura (`"Pressione a nova combinação… Esc para cancelar"`), valida conflitos dentro do mesmo escopo ou com atalhos globais (`Ctrl+K`, `F6`), impede salvar conflito silencioso e permite `"Restaurar padrão"` individual ou `"Restaurar todos os padrões"`.

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Trocar tema / alto contraste / escala | Persistência local no front (`localStorage` / Store de Sessão) | Nenhuma | Nenhuma | Aplica `data-theme`, `data-contrast="high"` e escala imediatamente no `<html>` | Selecionar anterior |
| Trocar idioma (`PT-BR` / `EN`) | Persistência local no front (`LanguageContext`) | Nenhuma | Nenhuma | Atualiza strings da interface imediatamente | Selecionar outro idioma |
| Alterar modo WCAG 2.1.4 de teclas únicas | Persistência no Store de Atalhos / `useComandos` | Nenhuma | Nenhuma | Atualiza manipulador global e todos os `<Kbd>` na tela e na Paleta | Selecionar padrão |
| Remapear atalho | Persistência no Store de Atalhos / `useComandos` | Sem conflito no mesmo escopo/global | Se houver conflito, exibe aviso indicando a ação conflitante e oferece substituir ou cancelar | Atualiza `<Kbd>` e atalho ativo | `"Restaurar padrão"` |
| Restaurar todos os atalhos | Persistência no Store de Atalhos | Nenhuma | `<ConfirmDialog>`: `"Restaurar todos os atalhos para o padrão original?"` | Restaura tabela completa | — |

### 5. Estados
* **`loading`:** Não há chamada assíncrona pesada; lê preferências síncronas na montagem.
* **`empty`:** Na busca da tabela de atalhos, quando nenhuma ação corresponde ao termo digitado: `"Nenhum atalho corresponde a '<termo>'."` + botão `"Limpar busca"`.
* **`error`:** Na captura de remapeamento, se o usuário pressionar combinação reservada pelo SO ou conflitante no mesmo escopo: alerta inline (`role="alert"`) explicando qual comando já usa aquela tecla.
* **`job_running` / `partial`:** Não aplicáveis.

### 6. Eventos (`core-progress`)
* Nenhum.

### 7. Teclado e acessibilidade
* **WAI-ARIA APG:**
  * Tema e Escala UI em `radiogroup` visual ou `<Segmented>` acessível.
  * Tabela de atalhos em `grid` ou `<table>`; botão de captura de tecla anuncia em `aria-live="polite"` `"Gravando atalho para <ação>. Pressione a nova tecla ou Esc para cancelar."`
  * Quando o usuário muda a escala para `115%`, nenhum controle pode cortar texto nem ocultar foco em `1366×768`.

### 8. US do #26 atendidas
* US-18 (interface PT-BR/EN), US-74 (atalhos visíveis) e conformidade integral WCAG 2.2 AA (SC 2.1.4, 2.4.7, 2.4.11, 1.4.3).

### 9. Lacunas
* **Núcleo Rust:** Não existem comandos no núcleo para persistir preferências de aparência e mapa de atalhos no sistema de arquivos (`config_dir`); hoje vivem apenas no `localStorage` da WebView (registrado em Questões para a arquitetura).
* **Mock TS / Infra Front:** `src/lib/comandos.tsx` ainda não possui camada de remapeamento nem o interruptor WCAG 2.1.4; `src/styles/tokens.css` ainda não define `[data-contrast="high"]` nem escala `115%`.

### 10. Critérios de aceite (E2E / Playwright)
1. Selecionar Tema `Claro`, `Escuro` ou `Sistema` atualiza o atributo `data-theme` no `<html>` imediatamente.
2. Ativar `"Modo Alto Contraste"` aplica `data-contrast="high"` no `<html>`; selecionar `"115%"` aumenta a escala sem gerar scroll horizontal em `1366×768`.
3. Alterar o interruptor WCAG 2.1.4 para `"Desligar atalhos de tecla única"` faz com que `Espaço`/`A`/`R` isolados deixem de disparar ações globais/de lista, mantendo `Ctrl+K` ativo.
4. Digitar `"Paleta"` na busca de atalhos filtra a tabela exibindo `Ctrl+K`; limpar a busca restaura a lista completa.
5. Clicar em `"Remapear"` em um comando e pressionar uma tecla já usada no mesmo escopo exibe alerta de conflito antes de sobrescrever.

---

## Tela 10 — Configurações: Projeto atual (`#/config/projeto`)

### 1. Objetivo e Navegação
* **Objetivo:** Centralizar todas as configurações armazenadas dentro do Projeto portátil `.clipes` aberto: **Perfil de canal**, veto **Somente local** do Projeto e **Backups rotativos** (configuração, criação manual e restauração segura).
* **De onde chega / para onde vai:** Acessada pelo menu lateral de Configurações (`#/config/projeto`), pelo menu do Projeto na Barra Superior (`Configurações do Projeto`), pelo selo `Somente local` ou pelo aviso de falha de backup na Barra de Status. **Guarda de rota obrigatória:** se não houver Projeto aberto (`projects.current === null`), redireciona imediatamente para `#/config/provedores` com toast/aviso informativo.

### 2. Layout por zonas
Menu lateral de Configurações à esquerda + conteúdo dividido em 3 sub-abas limpas (`Abas`) para evitar formulário gigante:
1. `Perfil de canal`
2. `Privacidade (Somente local)`
3. `Backups do Projeto`

**Em 1366 px e 1440+ px:**
```
+----------------------------------------------------------------------------------+
| Shell: Barra Superior (Projeto: Meu Canal · [Somente local se ativo])            |
+----------------------------------------------------------------------------------+
| Menu Config     | Projeto atual: Meu Canal  (C:\Videos\MeuCanal.clipes)          |
|   Provedores    | Abas: [ Perfil de canal ] [ Privacidade ] [ Backups ]          |
|   Custos e Aud. |----------------------------------------------------------------|
|   Componentes   | (Aba 1: Perfil de canal)                                       |
|   Exportação    | Tipo de vídeo padrão:                                          |
|   Aparência     |  (•) Corte direto (Canal de cortes)                            |
| > Projeto atual |  ( ) Vídeo transformado (Canal dark — exige Roteiro + Narração)|
|                 | Idioma principal: [ Português (pt) v ]                         |
|                 | Duração dos Cortes: Mín [ 20 ] s · Máx [ 60 ] s (máx. 180 s)   |
|                 | Voz padrão da Narração: [ Feminina PT v ]                      |
|                 | Estilo padrão de legenda: Preset [ Vertical v ] · Fonte [Noto] |
|                 | Fontes / Criadores permitidos: [+ Adicionar criador/URL]       |
|                 | Orientação de ritmo: "Publique em ritmo regular (1–3/dia)..."  |
|                 |                                          [ Salvar Perfil ]     |
+----------------------------------------------------------------------------------+
```

### 3. Conteúdo e componentes por zona
1. **Aba `Perfil de canal` (`channel_profile.get`, `channel_profile.set`, `channel_profile.languages`, `tts.catalog`):**
   * **Tipo de vídeo padrão (`videoKind`):** `Corte direto` vs. `Vídeo transformado` com explicação curta da diferença (Corte direto oculta Roteiro/Narração; Vídeo transformado exige revisão humana bloco a bloco).
   * **Idioma (`language`):** lista vinda de `channel_profile.languages`.
   * **Faixa de duração (`minUs`, `maxUs`):** entradas em segundos (convertidas para µs ao salvar; `min > 0`, `min < max`, `max <= 180 s`), exibindo os limites do núcleo (`limits.defaultMinUs`, `limits.maxUs`).
   * **Voz padrão da Narração (`narrationVoice`):** lista de vozes de `tts.catalog` (ou `"Sem voz padrão"`).
   * **Estilo padrão de legenda (`captionStyle`):** seleção de preset (`vertical`, `cinema`, `simple`), fonte (`Noto Sans`, `Noto Serif`), tamanho (`24..96`), destaque karaokê (`highlight`), contorno/sombra/posição/cores. *(Nota: alterações atualizam apenas o padrão para novos Cortes; estilos de Cortes já abertos mantêm sua revisão.)*
   * **Fontes permitidas (`allowedSources`):** lista editável (máx. 200 entradas) com `label` (1..120), `url` (opcional HTTP/HTTPS) e `note` (opcional ≤ 300) usada como referência/autocomplete de Permissão.
   * **Status somente leitura (`directMonetizationAck`):** indica se o aviso único de monetização de Corte direto já foi visualizado neste canal.
   * **Ritmo de publicação sugerido (US-42):** caixa informativa fixa: `"Ritmo de publicação sugerido: publique em ritmo regular e moderado (por exemplo, 1 a 3 vídeos por dia por canal) e evite enviar lotes grandes de vídeos parecidos em sequência, para reduzir risco de filtros de spam."`
2. **Aba `Privacidade (Somente local)` (`projects.local_only.get`, `projects.local_only.set`):**
   * Interruptor `"Ativar veto Somente local para este Projeto"`.
   * Explicação clara (ADR-0010): `"Quando ligado, nenhuma chamada deste Projeto pode enviar texto ou áudio para fora deste computador (incluindo APIs remotas, Groq e CLIs). Este veto apenas bloqueia envios externos; ele nunca troca seu Provedor sozinho."`
3. **Aba `Backups do Projeto` (`backups.settings.get`, `backups.settings.set`, `backups.create`, `backups.list`, `backups.restore`):**
   * Alerta no topo se `backups.settings.get().warning !== null` (`"O último backup automático falhou"`).
   * **Configuração automática:** `Intervalo (minutos ou segundos — núcleo aceita inteiro > 0 s; padrão 1800 s / 30 min)` e `Cópias mantidas na rotação` (padrão `10`), com botão `"Salvar configuração"` e `"Restaurar padrão (30 min · 10 cópias)"`.
   * **Ação manual:** botão `"Criar backup agora"` (`backups.create` — executa `editor.flush`, cria e verifica integridade).
   * **Lista de backups (`backups.list`):** data/hora formatada (`created_at`), nome do arquivo (`id`), selo `"Pré-restauração"` quando `before_restore === true`, e botão `"Restaurar"` (`backups.restore`).

### 4. Ações
| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | Mudança na tela após sucesso | Desfazer |
|---|---|---|---|---|---|
| Salvar Perfil de canal | `channel_profile.set` | Projeto aberto; `minUs < maxUs <= 180_000_000`; URLs válidas | Nenhuma | Atualiza perfil em cache e invalida `guardrails.check` | Editar novamente |
| Ligar/desligar `Somente local` do Projeto | `projects.local_only.set { enabled }` | Projeto aberto | Nenhuma | Atualiza estado no Store do Projeto e exibe/oculta selo no Shell | Alternar interruptor |
| Salvar configuração de backup | `backups.settings.set { interval_seconds, copies }` | Projeto aberto; inteiros `> 0` | Nenhuma | Atualiza valores salvos | Editar novamente |
| Criar backup agora | `backups.create` | Projeto aberto | Nenhuma | Novo backup aparece no topo da lista | — |
| Restaurar backup | `backups.restore { id }` | Projeto aberto e **0 jobs ativos** (`jobs == 0`) | `<ConfirmDialog>`: `"Restaurar este backup substituirá o estado atual do Projeto. O estado atual será preservado em uma cópia 'Pré-restauração' antes da troca. Deseja continuar?"` | Banco restaurado, backup `before-restore-*` criado e caches do Projeto recarregados | Restaurar o arquivo `before-restore-*` gerado |

### 5. Estados
* **`loading`:** `<Esqueleto>` em cada aba enquanto `channel_profile.get`, `projects.local_only.get`, `backups.settings.get` e `backups.list` carregam (corrigindo a v1 onde `Backups` mostrava `"Nenhum backup"` antes de carregar).
* **`empty`:**
  * Lista de `allowedSources` vazia: `"Nenhuma Fonte permitida cadastrada ainda."` + botão `"Adicionar criador/canal"`.
  * Lista de `backups.list` vazia: `"Nenhum backup salvo ainda."` + botão `"Criar primeiro backup agora"`.
* **`error`:**
  * `project_not_open` → redireciona para `#/config/provedores` com aviso `"Abra um Projeto para configurar Perfil de canal, privacidade e backups."`
  * `project_busy` ao restaurar backup → `"Pare ou aguarde os jobs ativos na Fila antes de restaurar um backup."` + botão `"Abrir Fila de Jobs"`.
  * `invalid_cut_range` → `"A duração mínima deve ser maior que zero e menor que a máxima (até 180 segundos)."`
  * `backup_invalid` / `restore_failed` → `"Este arquivo de backup está corrompido ou é de uma versão incompatível."`
  * `backup_settings` → `"Informe intervalo e número de cópias inteiros maiores que zero."`
* **`job_running`:** Botão `"Restaurar"` fica desabilitado com dica explicativa quando o Store Global indica jobs rodando (`jobs > 0`), prevenindo `project_busy`.
* **`partial`:** Se `backups.settings.get().warning` existir, exibe faixa de alerta na aba de Backups mantendo o restante configurável.

### 6. Eventos (`core-progress`)
* Não há evento para backup automático em segundo plano (lacuna conhecida). A UI recarrega `backups.list` e `backups.settings.get` ao focar a aba `Backups` e após conclusão de jobs no Store Global.

### 7. Teclado e acessibilidade
* **WAI-ARIA APG:**
  * 3 abas em `role="tablist"`; escolha `Corte direto` vs. `Vídeo transformado` em `radiogroup` com descrições associadas por `aria-describedby`.
  * Lista de backups em tabela/lista com botão `Restaurar` rotulado por data (`aria-label="Restaurar backup de 17/11/2026 14:30"`).
  * `<ConfirmDialog>` de restauração abre com foco inicial no botão `"Cancelar"`.

### 8. US do #26 atendidas
* US-34, US-39, US-41, US-42, US-63, US-102, US-121, US-122.

### 9. Lacunas
* **Núcleo Rust:**
  * Backups automáticos em segundo plano não emitem evento `core-progress` ao concluir ou falhar (documentado em [01-arquitetura.md](../01-arquitetura.md#11-dependências-do-núcleo)).
* **Mock TS (`src/lib/core.ts`):**
  * Faltam `backups.settings.set`, `backups.create` e `backups.restore`.
  * `backups.list` e `backups.settings.get` só funcionam com `?source-test` na URL, e `backups.settings.get` omite `default_interval_seconds`, `default_copies` e `warning`.

### 10. Critérios de aceite (E2E / Playwright)
1. Navegar para `#/config/projeto` sem Projeto aberto redireciona para `#/config/provedores` com toast/aviso `"Abra um Projeto para editar estas configurações."`
2. Na aba `Perfil de canal`, alterar a duração máxima para `90` s e salvar chama `channel_profile.set` com `maxUs: 90_000_000`; inserir `min >= max` mostra validação humana sem disparar comando.
3. Ligar o interruptor `Somente local` na aba `Privacidade` chama `projects.local_only.set { enabled: true }` e exibe o selo permanente `"Somente local"` na Barra Superior.
4. Na aba `Backups`, com `?estado=carregando`, exibe `<Esqueleto>` e nunca `"Nenhum backup salvo ainda."`
5. Clicar em `"Restaurar"` em um backup abre `<ConfirmDialog>` (nunca `window.confirm`) com foco inicial no botão `"Cancelar"`; com jobs em andamento, o botão `"Restaurar"` aparece desabilitado com explicação.

---

## Componentes compartilhados usados

Interface mínima (props) dos componentes compartilhados propostos ou reutilizados neste pacote para unificação entre os Pacotes A–F:

1. **`<Tela>` (Shell da janela)**
   * Props: `titulo: string`, `meio?: ReactNode` (slot para `<ContextoCorte>` no Pacote D), `direita?: ReactNode`, `mostrarEtapas?: boolean`, `modoMinimo?: boolean` (para `#/assistente`), `children: ReactNode`.
2. **`<BarraSuperior>` e `<SeletorProjeto>`**
   * Consome Store de Projeto Ativo + Store Global de Fila: exibe projeto aberto, 3 etapas com contadores (`fontes`, `cortesAprovados`, `prontosExport`), selo `somenteLocal`, indicador de `orcamento`, botão da Fila (`ativosCount`, `uncertainCount`, `progressoResumo`, `onAbrirFila`), `<GatilhoPaleta />`, botão Configurações e menu secundário (`Relatos`, `Sobre`, `Atalhos`).
3. **`<BarraStatus>`**
   * Consome Store do Editor (`autosaveEstado: 'saved' | 'saving' | 'failed'`, `onRetrySave`) + Store de Projeto (`backupWarning`) + Store de Fila (`jobResumo`), mais `dicaContextual?: string` e `acaoPaineis?: ReactNode`.
4. **`<Paleta>` (`Ctrl/Cmd+K`)**
   * Alimentada por `ComandosProvider` / `useComandos(comandos: Comando[])`, com suporte a `filhos()`, `desabilitado`, `atalho`, `grupo` e retorno de foco.
5. **`<ConfirmDialog>`**
   * Props: `open: boolean`, `onOpenChange: (open: boolean) => void`, `title: string`, `description: string`, `cancelLabel: string`, `confirmLabel: string`, `confirmDisabled?: boolean`, `variante?: 'primario' | 'perigo'`, `onConfirm: () => void`, `finalFocus?: RefObject<HTMLElement | null>`, `children?: ReactNode`.
6. **`<ResumoCustoPrivacidade>` (Cartão único de custo e privacidade — Seção 7 da Arquitetura)**
   * Props: `tarefa: string`, `perfil?: { label: string; kind: string; model: string | null }`, `localidade: 'local' | 'remoto' | 'cli'`, `host?: string | null`, `estimativa?: { kind: 'usd' | 'zero' | 'plan_quota' | 'unknown'; minMicroUsd?: number | null; maxMicroUsd?: number | null; inputTokens?: number | null }`, `orcamento?: { restanteMicroUsd?: number | null; callsRestantes?: number | null } | null`, `consentimentoPendente?: boolean`, `onConfirmarConsentimento?: (aceito: boolean) => void`.
7. **`<InstaladorJustInTime>`**
   * Props: `recurso: 'url_import' | 'yunet' | 'tts'`, `idioma?: 'pt' | 'en'`, `modo?: 'inline' | 'modal'`, `aberto?: boolean`, `onFechar?: () => void`, `onPronto: () => void`.
8. **`<EstadoTela>` e `<Esqueleto>`**
   * `<EstadoTela>`: `tipo: 'vazio' | 'erro' | 'parcial' | 'sem_permissao'`, `titulo: string`, `descricao: string`, `acaoPrimaria?: { rotulo: string; onClick: () => void }`, `acaoSecundaria?: { rotulo: string; onClick: () => void }`, `detalheTecnico?: string` (recolhível).
   * `<Esqueleto>`: `linhas?: number`, `variante?: 'lista' | 'formulario' | 'cards'`, `rotulo?: string`.
9. **`<Status>`, `<Campo>`, `<Input>`, `<Select>`, `<Switch>`, `<Abas>`, `<Segmented>`, `<Progresso>`, `<Kbd>`, `<Tooltip>`, `<Toaster>`**
   * Primitivas baseadas em `@base-ui/react` conforme inventário do `design-system/src/components/ui/`.
10. **`<DataGrid>` (tabela acessível `grid`)**
    * Props: `colunas`, `linhas`, `ariaLabel: string`, `ordenacao?`, `vazio?: ReactNode`, com navegação de teclado entre linhas/células e suporte a controles interativos internos (usado em Tarefas de IA, Gastos, Auditoria e Atalhos, além de Lotes/Fila nos Pacotes B e F).

---

## Questões para a arquitetura

1. **`#/assistente` como rota dedicada vs. modal sobre `#/inicio`:** A Seção 2 de [01-arquitetura.md](../01-arquitetura.md) descreve o Assistente como *"(modal/fluxo guiado)"*, enquanto a Seção 3 define a rota própria `#/assistente?passo=1|2`. Esta especificação adotou fluxo em rota própria com barra de janela simplificada para permitir histórico, recarregamento e testes E2E diretos; confirmar se o coordenador prefere tela dedicada em `#/assistente` ou modal montado sobre `#/inicio` mantendo a URL `#/assistente`.
2. **Persistência das preferências de Aparência, Escala UI (`100%`/`115%`), Alto Contraste e Teclado (WCAG 2.1.4 + remapeamento):** O núcleo Rust atual não tem comandos para salvar essas preferências em arquivo (`config_dir`), ficando hoje apenas no `localStorage` da WebView (que não segue `CLIPES_DATA_DIR`). Definir se permanecerão no front (`localStorage` / `@tauri-apps/plugin-store`) ou se haverá ticket no Rust para `ui-settings.json`.
3. **Diálogo de fechamento da janela com downloads ou exportação em voo:** `src-tauri/src/main.rs` já intercepta `WindowEvent::CloseRequested` no lado Rust para rodar `editor.flush`. Como downloads globais de Componentes, URLs e estado de jobs ficam no front/store, é preciso alinhar como o `CloseRequested` consultará ou notificará a WebView para exibir o `<ConfirmDialog>` previsto na Seção 5 de [01-arquitetura.md](../01-arquitetura.md) antes de encerrar o processo.
4. **Seção `#/config/custos` sem Projeto aberto:** Apenas `#/config/projeto` possui redirecionamento na tabela de rotas da arquitetura. Assumimos que `#/config/custos` continua acessível sem Projeto aberto para Tabela de Preços e Estimador, exibindo estado vazio acionável nos blocos de Orçamentos, Gastos e Auditoria. Confirmar se esse comportamento é o esperado.
5. **Diálogo de seleção de pasta do SO vs. fallback manual:** Os comandos `projects.create`, `projects.open` e `components.settings.set` recebem caminhos absolutos em string. Em modo navegador (`VITE_CORE_MOCK=1`) e testes Playwright, assumimos campo de texto editável ao lado do botão nativo `Escolher pasta` (`@tauri-apps/plugin-dialog`) para não bloquear testes automatizados.
6. **Manifesto macOS (`ffmpeg`, `yt-dlp`, `uv`):** Já listado nas dependências do núcleo (Seção 11 de `01-arquitetura.md`). Enquanto não houver binários no manifesto para macOS, `#/assistente`, `#/config/componentes` e `<InstaladorJustInTime>` assumem exibir mensagem informativa não bloqueante orientando o uso do `FFmpeg` do sistema (`components.ffmpeg.system`).
