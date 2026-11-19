# Console ao vivo — Análise e Plano de Implementação

> **Status:** Plano técnico (somente análise; nenhum código de produto alterado).  
> **Base analisada:** `origin/master` (`6f791e7`).  
> **Referências vinculantes:** [GLOSSARY.md](../../../GLOSSARY.md), [ADR-0004](../../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md), [ADR-0006](../../adr/0006-relato-de-problemas-sem-telemetria.md), [ADR-0009](../../adr/0009-custo-orcamento-e-auditoria-de-chamadas-de-ia.md), [01-arquitetura.md](./01-arquitetura.md), [03-direcao-visual.md](./03-direcao-visual.md).

---

## 1. Resumo da recomendação

1. **UX recomendada (componente único, dois encaixes coordenados):** criar um único componente `<ConsoleAoVivo>` alimentado por um único store global em memória (`front-v2/src/core/console.ts`):
   - **Em Componentes (`ConfigComponentes` e, opcionalmente, Passo 1 do `Assistente`):** painel **inline recolhível fixo embaixo** do conteúdo da aba ativa, fechado quando ocioso e expansível em um clique (com opção de abrir automaticamente ao iniciar instalação/teste de hardware na tela), mostrando o que downloads, `uv`, FFmpeg e sonda de hardware estão fazendo.
   - **No app inteiro (`Shell`):** **dock inferior recolhível** acoplado acima da `BarraStatus`, **recolhido por padrão** para preservar a altura útil de `1366×768` (especialmente no Editor de Corte), acionável por um botão discreto na `BarraStatus`, por atalho/Paleta `Ctrl/Cmd+K` e por atalho *"Ver console"* nos cards da `PainelFilaJobs` (`Ctrl/Cmd+J`).
   - **Modos e controles:** modo **Simples** por padrão (frases curtas em PT-BR sem jargão de tradutor) com alternância explícita para **Técnico** (timestamp, origem, etapa e saída sanitizada de subprocessos), filtro por origem/job (`Todos` ou job específico), botões **Copiar**, **Limpar** e **Rolagem automática** (com pausa automática ao rolar para cima).
2. **Contrato de eventos separado (`core-console`):** manter `"core-progress"` (`ProgressEvent`) intocado para barras de progresso, `useFila()`, `storeFilaGlobal` e `FechamentoJanela`, e criar um canal dedicado `"core-console"` (`ConsoleEvent`) no núcleo Rust (`core/src/console.rs`) repassado pelo `src-tauri/src/main.rs`.
3. **Privacidade by-design antes do IPC (ADR-0006 e ADR-0009):** hoje **não existe** redator genérico de segredos no núcleo (a proteção atual é allowlist fechada em `diagnostic.rs` e descarte de `stderr`). O novo módulo `core/src/console.rs` centraliza **redação obrigatória** (chaves de API, `Bearer`, cookies, tokens em URL, caminhos pessoais mascarados com `~`, remoção de sequências ANSI e `\r`, truncamento de linha) e **proibição estrita** de emitir texto de prompts, Transcrição, Roteiro ou respostas de Provedores. O console ao vivo fica apenas em memória de sessão e **nunca** grava em `diagnostic.log` nem entra no diagnóstico exportado de `Relatos`.
4. **Fatiamento em 5 tickets independentes:** contrato + redator Rust → store + mock TS + `<ConsoleAoVivo>` → encaixe em Componentes + subprocessos de instalação → dock global no `Shell` + jobs de mídia (`ffmpeg`, `yt-dlp`, `worker`, `pocket-tts`) → jobs de IA (`jobs/ai.rs`, `provider_cli.rs`) + E2E Tauri.

---

## 2. Achados do código

### 2.1 Front-v2: telas de Componentes, Fila e fluxo de eventos

| Área | Arquivo e linhas | Situação atual encontrada |
|---|---|---|
| Tela de Componentes e Armazenamento | `front-v2/src/telas/config/ConfigComponentes.tsx:30-31, 312, 427-460, 632-646, 732-747, 946-961, 1008-1023, 1090-1105, 1190-1205, 1314-1329, 1383-1398, 1542-1557` | Usa `<ConfiguracoesLayout>` com 4 abas (`hardware`, `componentes`, `tts`, `armazenamento`). Consome `useFila()` (`L312`) e exibe apenas uma barra `<Progresso>` inline dentro do card do item ativo (`jobProbe`, `jobFfmpeg`, `jobYtdlp`, `jobDeno`, `jobWorker`, `jobPocket`, `jobModelo`, `jobTts`). Não há área de log/console embaixo da tela nem histórico do que cada etapa executou. |
| Moldura das Configurações | `front-v2/src/telas/config/ConfiguracoesLayout.tsx:44-97` | Layout flex horizontal: menu lateral `200px` + `<AreaRolagem className="min-h-0 flex-1">` (`L80`) envolvendo o conteúdo da seção. Um painel recolhível no fim de `ConfigComponentes` entra naturalmente dentro dessa área rolável ou como rodapé fixo da coluna direita. |
| Assistente (Passo 1) | `front-v2/src/telas/assistente/PassoEssencial.tsx:149-162` | Também instala FFmpeg, Worker Python, modelo Whisper e sonda hardware consumindo `useFila()`. Hoje mapeia manualmente o progresso do worker em 4 frases fixas (`etapaAmigavelWorker`, `L149-158`). |
| Instalador sob demanda (JIT) | `front-v2/src/componentes/InstaladorJustInTime.tsx:189-199, 714-725` | Instala `yt-dlp`/`deno`, `yunet` e `pocket-tts` fora de Configurações (inline ou modal), também exibindo apenas `<Progresso>` com a última mensagem. |
| Gaveta global da Fila de Jobs | `front-v2/src/telas/fila/PainelFilaJobs.tsx:83-95, 257-271, 629-636, 860-1325` | `<aside data-regiao="fila">` lateral direita (`470px` em 1366 px, `560px` em 1440+ px), acionada por `Ctrl/Cmd+J` ou pelo topo do `Shell`. Unifica 4 trilhas (jobs persistidos, Lotes de Fontes, Lotes de exportação, Operações Globais em memória) e mostra apenas estágio traduzido (`traduzirEstagioAoVivo`, `L83-95`), percentual, decorrido e ETA. |
| Store reativo da Fila Global | `front-v2/src/stores/filaGlobal.ts:146-193, 292-583` | `criarStoreFilaGlobal` agrega `jobs.list`, `batches.list`, `export.batch.list`, `jobs.budget.get` e `useFila()`; reage a mudanças de `estado:etapa:percentual` (`L477`) para disparar invalidations e toasts. |
| Assinatura `core-progress` e `useFila()` | `front-v2/src/core/progresso.ts:7-14, 133-218, 359-405, 444-446` | `iniciarProgresso()` (`L360`) é chamado uma vez no boot (`front-v2/src/App.tsx:593`). No Tauri assina `'core-progress'` via `listen<EventoProgresso>`; fora do Tauri, se `VITE_CORE_MOCK === '1'`, chama `assinarProgressoMock` (`@core`). **Restrição chave (`L178-197`):** `criarFila().aplicar` mantém apenas um registro por `job`, sobrescreve `mensagem` e `etapa` a cada evento e ignora eventos se `percentage` regredir (`regrediu` em `L182`). |
| Shell global e Barra de Status | `front-v2/src/shell/Shell.tsx:269, 534-557, 827-904` | Envolve `<main data-regiao="conteudo">` e `<PainelFilaJobs>` em `<div className="flex min-h-0 flex-1 flex-row overflow-hidden">` (`L881`) dentro de `<Tela>` (`design-system-v2/src/componentes/Tela.tsx:46-90`). `BarraStatus` (`data-regiao="rodape"`) mostra à esquerda salvamento + resumo do último job ativo + atalhos à direita. O ciclo `F6` (`L534-557`) percorre `topo → contexto → conteudo → fila → rodape`. |
| Mock TS do núcleo | `src/lib/core.ts:39-81, 183-233, 739-750` | `emitirProgressoMock` e `runCancellableSteps` já simulam passos temporizados de download/probe com cancelamento, mas só emitem `EventoProgressoMock` (sem canal de console nem linhas técnicas). |

### 2.2 Núcleo Rust (`core/src/` e `src-tauri/src/`): o que já emite e o que falta

- **Infraestrutura de eventos atual:**
  - `core/src/lib.rs:12-39`: define `ProgressEvent { job, project, clip_id, stage, percentage, message, error }`, `EventSink<'a>` (usado durante `dispatch` síncrono em `src-tauri/src/main.rs:32-34`) e `EVENT_EMITTER` global (`set_event_emitter` / `emit_background`) instalado no setup do Tauri (`src-tauri/src/main.rs:248-250`) para threads em background.
- **O que o núcleo já emite hoje via `ProgressEvent`:**
  - Downloads HTTP (`components.rs:492,515`, `components/models.rs:417,468`, `components/update.rs:222,238`, `tts/catalog.rs:1049,1076,1143`) e verificação de catálogo (`components/catalog.rs:912`): apenas estágio `"download"`/`"update"` + percentual inteiro + frase fixa (`"Baixando componente"`, `"Baixando modelo"`, etc.).
  - Instalação do Worker Python (`components/worker.rs:298,511,555`): apenas 3 marcos fixos (`25%` Python gerenciado, `45%` dependências CUDA/CPU, `95%` verificação) mais o primeiro quarto compartilhado do download do `uv`.
  - Sonda de hardware (`components/hardware.rs:671` e `transcription.rs:391`): marcos da cadeia de sonda.
  - Importação por URL (`url_import.rs:146-165`): apenas `clipes-progress:%` do `stdout` do `yt-dlp`.
  - Jobs da fila (`jobs.rs:128`, `jobs/preview.rs:130`, `transcription.rs:514`, `reframe.rs:256`, `export.rs:1268,1296`, `export/batch.rs:500`, `source_batches.rs:140`, `selection.rs:897`, `tts/narration.rs:921`, `narration_align.rs:792,1052`, `narration_import.rs:653`, `chat.rs:704,717`, `energy.rs:392,399`, `proxy.rs:492,510`, `editor/assets.rs:303,315`): apenas estágio + percentual + frase curta fixa.
  - Tarefas de IA (`jobs/ai.rs:623-658, 871, 966, 993`): apenas 4 passos (`prepare` 0%, `call` 10%, `verify` 80%, `done` 0%/100%).
- **O que está faltando ou sendo descartado hoje no núcleo:**
  1. **`uv` (`core/src/components/worker.rs:203-206, 219-222, 265-278`):** passa `--no-progress --color never` e drena **todo** `stdout` e `stderr` para `io::sink()`. Durante os vários minutos baixando/instalando `faster-whisper` e bibliotecas CUDA, o usuário só vê `"45% Instalando as dependências do worker (CUDA)"` parado.
  2. **Downloads e extração (`components.rs:485-524, 608`):** `fetch_with` não informa bytes baixados/totais nem velocidade, e `install()` (descompactação de ZIP `ffmpeg`/`deno`/`uv` e verificação SHA-256) não emite nenhuma etapa intermediária.
  3. **FFmpeg (`export/render.rs:188-239`, `export/encoder.rs:93-102`, `transcription.rs:321-335`, `jobs/preview.rs:360-378`):** no render, `stdout` traz `-progress` (lê só `out_time_us=`, ignorando `frame=`, `fps=`, `speed=`, `bitrate=`, `progress=`) e `stderr` descarta tudo exceto o JSON de `loudnorm` e `fontselect` (`render.rs:210`). Em extração de áudio, preview e detecção de encoder, `stderr` vai direto para `io::sink()`.
  4. **Worker Python (`core/src/worker.rs:121-137, 223-237`):** `stderr` vai para `io::sink()`; `WorkerEvent::Model` (`model_loaded`/`model_released`, `L42-43`) não é repassado ao front; `LocalEngine::transcribe_block` (`transcription.rs:197`) e `hardware.rs:522` ignoram o `message` do `WorkerEvent::Progress`.
  5. **`yt-dlp` (`url_import.rs:199-230, 446-460`):** `stderr` é resumido só para padrões de erro após terminar o processo (`read_stderr`); linhas de preparação/formato/velocidade não chegam ao vivo.
  6. **`pocket-tts` (`tts/narration.rs:748, 754-798`):** roda com `-q` sem ler `stdout`/`stderr`.
  7. **IA e CLIs (`jobs/ai.rs`, `provider_cli.rs:215-224`, `provider_cli/opencode.rs`):** não emitem qual perfil/modelo/host está rodando, qual janela ou bloco está em execução, tentativas de reparo (`repair`), nem resumo de tokens/duração ao finalizar a chamada; `provider_cli.rs` usa `read_to_end` após término.
- **Reaproveitar vs. contrato novo:**
  - **Reaproveitar:** o padrão `EventSink` + `OnceLock<SharedEmitter>` de `core/src/lib.rs` e a ponte `app.emit(...)` em `src-tauri/src/main.rs`, além de manter `"core-progress"` exclusivo para estado/percentual dos jobs.
  - **Exige contrato novo:** não é viável empilhar logs dentro de `ProgressEvent` porque (a) `progresso.ts:182` bloqueia regressão de percentual e sobrescreve a mensagem única do job, (b) `filaGlobal.ts:477` reprocessa estado a cada mudança de mensagem/etapa, e (c) logs precisam de `timestamp`, `level`, `origin`, `simple_message` e `technical_message` (além de redação dedicada).

### 2.3 Segurança, privacidade, memória e volume

- **Redação de segredos existente hoje:** **não existe** função genérica de redação/mascaramento de strings em `core/src/`. O código atual protege dados sensíveis por:
  - Allowlist fechada em `core/src/diagnostic.rs:10-93, 160-240` (`DiagnosticKind`, `DiagnosticEvent`, `valid_ytdlp_code`, `valid_ytdlp_pattern`), respeitando o [ADR-0006](../../adr/0006-relato-de-problemas-sem-telemetria.md).
  - Descarte de `stderr` e textos livres do worker/FFmpeg/yt-dlp (`core/src/export/encoder.rs:3`, `core/src/export/render.rs:210`, `core/src/url_import.rs:166`, `core/src/worker.rs:54-56`).
  - Cofre do sistema em `core/src/vault.rs` e comandos que nunca retornam segredo (`transcription/groq_tests.rs:191-202`).
  - Lembrete na UI de `Relatos.tsx:88, 610-617` (`REGEX_SEGREDO`) alertando o usuário caso digite `"token"`, `"chave"` ou `"key"`.
- **O que precisa ser protegido no console ao vivo:**
  - **Segredos e credenciais:** chaves de API (`sk-...`, `sk-ant-...`, `AIza...`, `gsk_...`, etc.), headers `Authorization: Bearer ...`, `x-api-key`, `Cookie:` / `Set-Cookie:`, URLs com query params sensíveis (`?key=`, `?token=`, `?sig=`, `?signature=`, `?cookie=`, `?auth=`), e o token aleatório de 64 chars do loopback de mídia Linux (`src-tauri/src/media_server.rs:30-85`).
  - **Caminhos pessoais:** prefixos de usuário (`C:\Users\<nome>\...`, `/home/<nome>/...`, `/Users/<nome>/...`) devem ser normalizados para `~` (ou `<dados>`/`<projeto>`) antes de sair do núcleo, tanto pela privacidade ao usuário usar o botão **Copiar** quanto pela legibilidade.
  - **Conteúdo protegido pelos ADR-0006 e ADR-0009:** **nunca** encaminhar ao console `stdin` de CLIs, corpo de prompts, trechos de Transcrição, texto de Roteiro ou JSON bruto de resposta de Provedor.
  - **Separação estrita de `Relatos` (ADR-0006):** o console ao vivo é volátil em memória; **nada** do console vai para `diagnostic.log` nem para `diagnostic.get`. (ADR-0006 e ADR-0009 continuam integralmente cumpridos sem necessidade de emenda.)
- **ANSI, volume e memória:**
  - `uv` (`components/worker.rs:204,220`) e `yt-dlp` (`url_import.rs:424`) já usam `--color never`, mas binários externos (`ffmpeg`, `pocket-tts`, `codex`, `claude`, `opencode`, libs Python) ainda podem emitir sequências ANSI (`\x1b[...`, `\x1b]...`) e retorno de carro (`\r`) para sobrescrita de linha. O núcleo deve remover ANSI e tratar `\r` (mantendo apenas o último segmento da linha ou convertendo em atualização coalescida) antes de emitir.
  - **Limites de memória:** buffer circular de **500 linhas** visíveis por padrão (teto máximo configurável no store em **1.000 linhas**), truncamento de linha individual em **512 caracteres** no núcleo, e **throttle/coalescing** (no núcleo: marcos contínuos como `ffmpeg -progress` ou bytes de download no máximo a cada **250–500 ms** por job; no front: batching por `requestAnimationFrame` / 80 ms para evitar re-renders excessivos no WebView2/WebKitGTK).

### 2.4 Design system (`design-system-v2`), acessibilidade e vocabulário

- **Componentes reaproveitáveis em `design-system-v2/src/`:**
  - `AreaRolagem` (`primitivas/Indicadores.tsx:106`) ou `ListaVirtual` (`componentes/Listas.tsx:23`, baseada em `@tanstack/react-virtual`) para manter DOM leve mesmo com 500–1.000 linhas.
  - `Botao` e `BotaoIcone` (`primitivas/Botao.tsx:41, 80`) com alvo mínimo `24 px` (`tamanho="p"` = `h-6`).
  - `Status` (`primitivas/Indicadores.tsx:59`) — ícone + palavra sempre em cinza (WCAG 1.4.1).
  - `Abas` (`primitivas/Indicadores.tsx:26`) ou `Select` (`primitivas/Campos.tsx`) para filtro por origem e alternância Simples/Técnico.
  - `Separador` (`primitivas/Indicadores.tsx:99`), `Dica` (`primitivas/Flutuantes.tsx`) e `Kbd` (`primitivas/Botao.tsx:100`).
- **Tokens visuais (`design-system-v2/src/tokens/tokens.css` e `03-direcao-visual.md`):**
  - Superfície da área do console em `bg-chao` (`#0f1012` no escuro / `#f6f6f7` no claro) dentro de um painel `bg-area` (`#141518`) separado por `border-t border-linha` (`1px`), mantendo um degrau por área sem caixas pesadas.
  - Texto em `--t1` (mensagem principal), `--t2` (detalhe técnico), `--t3` (timestamp e origem) e `--erro` apenas como texto em falhas (nunca como fundo, conforme `tokens.css:34`).
  - Fonte `font-mono` (`Geist Mono` já declarada em `package.json:18`) com `.num` (`tabular-nums`) para timestamps e contadores. Todos os pares passam no verificador `design-system-v2/scripts/contraste.ts` (≥ 4,5:1 no tema padrão e ≥ 7:1 em `[data-contrast="high"]`).
- **Acessibilidade (WCAG 2.2 AA):**
  - **Evitar flood em leitor de tela:** usar `role="log"` com `aria-label="Registro de atividade ao vivo"` e **`aria-live="off"`** na lista de linhas; anúncios ao vivo ficam restritos a uma região auxiliar `role="status" aria-live="polite"` apenas para marcos espaçados (início, conclusão ou falha de tarefa), nunca para cada linha de progresso.
  - **Teclado e foco:** região navegável via `F6` (quando no dock global do `Shell`) e botão/sumário expansível com `aria-expanded` e `aria-controls`; foco visível `.foco` / `.foco-interno`; `prefers-reduced-motion` respeitado (`tokens.css:145-151`).
- **Vocabulário (`GLOSSARY.md` e `01-arquitetura.md`):**
  - Usar estritamente **Projeto**, **Fonte**, **Corte**, **Transcrição**, **Narração**, **Roteiro**, **Empacotamento**, **Provedor**, **Perfil de Provedor**, **Motor de transcrição**, **Lote de Fontes** e **Tarefa de IA**.
  - **Zero `#NNN` visível** (nunca expor números de issue do GitHub na UI, conforme `avaliacao-ondas-0-1.md:105` e `fila-jobs.spec.ts:138`). Para IDs numéricos de job persistido, exibir o rótulo humano da tarefa + alvo (`targetLabel`), reservando o número interno apenas como metadado discreto no modo Técnico se necessário.
  - PT-BR natural sem jargão de tradutor (ex.: usar `"Registro ao vivo"` ou `"Console"`, `"Detalhes técnicos"`, `"Rolagem automática"`, `"Limpar"`, `"Copiar"`).

---

## 3. Opções de UX e recomendação

### 3.1 Comparação de posicionamento

| Opção | Como funciona | Prós | Contras | Veredito |
|---|---|---|---|---|
| **A. Painel fixo sempre visível embaixo** | Barra inferior fixa em todas as telas, sempre expandida (160–220 px). | Visibilidade imediata. | Viola revelação progressiva (`03-direcao-visual.md`), rouba altura vital em `1366×768` (especialmente no Editor de Corte com Timeline embaixo e em `Exportacao`). | **Descartada** |
| **B. Apenas aba/seção dentro da Gaveta `PainelFilaJobs` (`Ctrl+J`)** | Console vira uma sub-aba da gaveta lateral direita (`470px`). | Zero impacto na altura da viewport; reaproveita a gaveta existente. | **Não atende ao pedido 1**: em `ConfigComponentes`, o usuário não vê o console embaixo da tela de ferramentas; além disso `470px` de largura quebra/trunca linhas técnicas de FFmpeg e `uv`. | **Descartada** |
| **C. Componente único `<ConsoleAoVivo>` em 2 encaixes recolhíveis (embaixo em Componentes + dock inferior recolhido no `Shell`)** | Um único componente e store global: **(1)** inline embaixo de `ConfigComponentes` (e opcionalmente Passo 1 do Assistente), recolhido quando ocioso e expansível na hora da instalação; **(2)** dock inferior recolhível no `Shell` acima da `BarraStatus`, recolhido por padrão e aberto por botão no rodapé, Paleta `Ctrl+K` ou atalho *"Ver console"* nos cards da Fila. | Atende diretamente aos dois cenários do dev; preserva `1366×768` sem roubar altura quando ocioso; largura total evita quebra excessiva de linhas técnicas; zero duplicação de lógica/estado. | Exige coordenar o dock inferior com o ciclo `F6` do `Shell` e evitar que abra dois consoles visíveis ao mesmo tempo em `ConfigComponentes` (basta ocultar/sincronizar o dock global quando o inline estiver visível). | **RECOMENDADA** |

### 3.2 Especificação da UX recomendada (Opção C)

1. **Encaixe 1 — Embaixo das ferramentas (`ConfigComponentes` e Passo 1 do `Assistente`):**
   - Bloco `<ConsoleAoVivo contexto="componentes" />` posicionado logo após as abas/conteúdo de `ConfigComponentes` (fora das abas individuais, visível para `Hardware`, `Componentes e Modelos`, `Vozes TTS` e `Armazenamento`).
   - **Estado padrão:** recolhido em uma barra compacta de 1 linha (`~32px` de altura) com título `"Console de instalação e verificação"`, último evento resumido à direita (quando houver atividade) e botão `"Expandir"` (`aria-expanded`).
   - **Expansão:** abre ao clicar ou **automaticamente** quando o usuário dispara uma ação de instalação/verificação nessa tela (download de `ffmpeg`, `yt-dlp`, `deno`, `pocket-tts`, modelo ML/TTS, instalação do Worker ou teste de hardware), recolhendo apenas por ação do usuário para que ele veja o desfecho e possíveis avisos.
2. **Encaixe 2 — Dock global recolhível no `Shell` (para IAs e jobs em andamento):**
   - Renderizado dentro do `Shell` entre a coluna principal (`main` + `PainelFilaJobs`) e a `BarraStatus`, **recolhido por padrão** (`altura = 0` quando fechado — zero impacto no layout de `1366×768`).
   - **Gatilhos:**
     - Botão discreto no rodapé (`BarraStatus` à esquerda, junto ao resumo de job ativo, ou à direita antes dos atalhos): `"Console"` (com indicador sutil de atividade quando houver linhas novas ou job rodando).
     - Comando na Paleta `Ctrl/Cmd+K`: `"Alternar console ao vivo"`.
     - Botão discreto `"Ver console"` em cards de jobs ativos/falhos na `PainelFilaJobs`, que abre o dock já pré-filtrado para aquele job.
   - **Altura do dock quando aberto:** `180px` a `220px` (ou `min(240px, 32vh)`) com `border-t border-linha` e `bg-area`/`bg-chao`, fechável com botão `"Recolher"` ou `Esc` quando o foco estiver dentro do dock (devolvendo o foco ao gatilho).
   - **Regra de unicidade:** se a tela ativa for `#/config/componentes` (ou `#/assistente?passo=1`) com o painel inline montado, o gatilho do dock global foca/expande o painel inline da tela para nunca exibir dois consoles simultâneos.
3. **Barra de controles do `<ConsoleAoVivo>` (enxuta, 1 linha de altura `32px`):**
   - **Filtro por origem/job:** `<Select>` compacto (`Todas as atividades` + itens ativos/recentes com nome humano, ex.: `Worker Python`, `FFmpeg`, `Transcrição · Live.mp4`, `Seleção de Cortes`).
   - **Modo Simples vs. Técnico:** controle segmentado de 2 opções (`Simples` [padrão] | `Técnico`), acessível por teclado.
     - **Simples:** exibe `HH:MM:SS`, ícone de status (`Status` semântico em cinza/erro) e frase curta em PT-BR (ex.: *"Instalando dependências de GPU (CUDA)…"* / *"Transcrevendo bloco 2 de 6 · 34%"* / *"Consultando Provedor (janela 3 de 8) — Perfil Principal"*).
     - **Técnico:** exibe `HH:MM:SS`, etiqueta curta de origem (`worker`, `uv`, `ffmpeg`, `yt-dlp`, `ia`) e a linha técnica sanitizada (ex.: `ffmpeg: frame=1420 fps=84.2 speed=2.8x bitrate=3412kbits/s` ou `uv: Resolved 42 packages in 1.8s`).
   - **Rolagem automática:** ligada por padrão; ao o usuário rolar para cima (`scrollTop + clientHeight < scrollHeight - 16`), pausa automaticamente e exibe botão compacto `"Retomar rolagem"` que desce ao fim.
   - **Limpar:** limpa as linhas em memória do store (mantendo os jobs rodando).
   - **Copiar:** copia as linhas visíveis do filtro/modo atual em texto plano sanitizado via `copiarTexto()` (`front-v2/src/core/desktop.ts:56`), com toast curto `"Console copiado."`.

---

## 4. Mudanças de contrato (Núcleo / Tauri / Front / Mock)

### 4.1 Núcleo Rust (`core/src/console.rs` e `core/src/lib.rs`)

Manter `ProgressEvent` (`core/src/lib.rs:13-23`) inalterado e adicionar um canal irmão:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsoleLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEvent {
    pub seq: u64,
    pub timestamp_ms: u64,
    pub job: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// Origem curta: "component", "uv", "ffmpeg", "yt-dlp", "worker", "tts", "ai", "job".
    pub origin: String,
    pub level: ConsoleLevel,
    /// Mensagem humana em PT-BR para o modo Simples.
    pub simple: String,
    /// Linha técnica sanitizada (opcional; quando ausente, o modo Técnico exibe `simple`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technical: Option<String>,
}
```

- **Emissor global no núcleo (`core/src/lib.rs`):** análogo a `EVENT_EMITTER` (`L25-37`), instalar `CONSOLE_EMITTER: OnceLock<Arc<dyn Fn(ConsoleEvent) + Send + Sync>>` com `set_console_emitter(...)` e `pub(crate) fn emit_console(...)` (aplicando sequência monotônica + sanitização + ring buffer interno antes de entregar ao callback). Usar emissor global evita alterar a assinatura `EventSink<'_>` de centenas de comandos síncronos e funciona tanto em comandos diretos quanto em workers de fila em background.
- **Tauri (`src-tauri/src/main.rs`):** no `.setup(...)` (`L242-252`), registrar `clipes_core::set_console_emitter(...)` emitindo `handle.emit("core-console", event)`.
- **Comando de histórico opcional (`console.history`):** retorna as últimas `N` linhas (até 500) do ring buffer em memória do núcleo já sanitizadas (`{ items: ConsoleEvent[] }`), opcionalmente filtrado por `project` (quando houver Projeto aberto, exclui eventos de outro Projeto mantendo eventos globais `project: null`). Isso garante que um reload da WebView não perca o contexto de um job já em execução. **Nunca grava em disco.**
- **Regras obrigatórias do sanitizador (`core/src/console.rs`):**
  1. Remover sequências ANSI (`ESC [` ... e `ESC ]` ...) e caracteres de controle (exceto espaço/tab), normalizando `\r` para reter apenas o trecho final útil.
  2. Mascarar segredos antes de emitir: headers `Authorization`, `x-api-key`, `Cookie`, `Set-Cookie`, parâmetros de query (`token`, `key`, `api_key`, `sig`, `signature`, `cookie`, `auth`, `secret`), prefixos conhecidos de chaves (`sk-`, `sk-ant-`, `AIza`, `gsk_`, `ghp_`) e tokens hexadecimais longos (≥ 32 chars) em URLs loopback.
  3. Mascarar prefixos de caminhos pessoais (`$HOME`, `$USERPROFILE`, `C:\Users\<user>`, `/home/<user>`, `/Users/<user>`) com `~`.
  4. Truncar linhas acima de `512` bytes UTF-8 (em fronteira válida de char) com `…`.
  5. Throttle por `(job, origin, kind)` para linhas contínuas (ex. progresso de download/FFmpeg no máximo a cada `300 ms`), deixando passar sem throttle marcos de início, troca de etapa, erro e conclusão.

### 4.2 Pontos de instrumentação no núcleo Rust

| Subsistema | Arquivo(s) e linhas | O que passar a emitir em `core-console` |
|---|---|---|
| Downloads e instalação de componentes | `core/src/components.rs:475-525, 624-640`, `core/src/components/models.rs:407-478`, `core/src/components/update.rs:200-247`, `core/src/tts/catalog.rs:1040-1153` | Início do download (domínio de origem + tamanho, sem tokens), progresso com bytes/total a cada ~500 ms (ou variação ≥ 5%), etapa de verificação SHA-256 / assinatura PGP, etapa de extração/instalação e conclusão. |
| Instalação do Worker Python (`uv`) | `core/src/components/worker.rs:194-295, 496-565` | Remover `--no-progress` apenas se compatível ou manter `--no-progress` e ler linhas do `stdout`/`stderr` de `uv` (passando pelo sanitizador + filtro de ruído) em vez de `io::sink()` (`L277`); traduzir marcos conhecidos (baixando Python, resolvendo dependências, baixando/instalando pacotes, verificando handshake + versões das libs). |
| Sonda de hardware e catálogo | `core/src/components/hardware.rs:500-537, 670-717`, `core/src/components/catalog.rs:906-921` | Tentativas da sonda (`device`, `compute_type`, `batch_size`), fallback para CPU com motivo fechado (`sanitize_fallback_reason`), e resultado da verificação de catálogo (versão embutida vs. remota). |
| Worker Python (protocolo JSONL) | `core/src/worker.rs:120-138, 223-237` | Repassar `WorkerEvent::Model` (`model_loaded` / `model_released`) e `WorkerEvent::Progress.message` (`transcription.rs:197`, `hardware.rs:522`). Para `stderr` do worker (`L121-124`), manter **descartado** ou classificar apenas códigos seguros em `core/src/worker.rs` — **nunca** emitir traceback bruto Python com caminhos/dados de áudio. |
| FFmpeg (export, preview, proxy, extração) | `core/src/export/render.rs:188-239`, `core/src/export.rs:1266-1304`, `core/src/export/encoder.rs:89-105`, `core/src/proxy.rs:492-515` | Ler linhas `-progress` (`frame=`, `fps=`, `speed=`, `out_time_us=`) já presentes em `stdout` (`render.rs:193`), emitir resumo sanitizado a cada ~500 ms (ex.: `"Exportando · 48% · 2,4x tempo real"` no Simples / `frame=1240 fps=72 speed=2.4x encoder=h264_nvenc` no Técnico), além de escolha de encoder e fallback (`render.rs`/`export.rs`). **Manter `stderr` de mídia descartado ou restrito a métricas estruturadas** (ADR-0006). |
| `yt-dlp` (URL) | `core/src/url_import.rs:146-230, 445-465` | Emitir marcos de pré-checagem, resolução de formato, taxa/ETA de download a partir de `--progress-template` ampliado (`clipes-progress:%(progress._percent_str)s\|%(progress._speed_str)s\|%(progress._eta_str)s`) e padrões fechados de `stderr_pattern` (`L167`), sem vazar URL completa nem cookies. |
| `pocket-tts` (Narração) | `core/src/tts/narration.rs:738-798, 921` | Emitir início/conclusão de cada bloco (`block_id`, duração gerada) e falhas tipadas (mantendo `-q` no binário ou capturando apenas saída segura). |
| Tarefas de IA e CLIs | `core/src/jobs/ai.rs:871, 966, 993, 1093`, `core/src/selection.rs:890-906`, `core/src/source_batches.rs:133-149`, `core/src/provider_cli.rs` | Emitir início da tarefa/janela/bloco, Perfil de Provedor + modelo (sem chave nem endpoint com token), envio/verificação, reparo automático (`repair`) se o JSON falhar, e resumo final (tokens/custo/duração). **Nunca emitir texto de prompt, Transcrição, Roteiro ou resposta do Provedor.** |

### 4.3 Contrato Front-v2 e Mock TS

- **Novo módulo `front-v2/src/core/console.ts`:**
  - `EventoConsole` (espelhando `ConsoleEvent` em camelCase).
  - `criarStoreConsole(opcoes?: { limite?: number; projetoAtual?: () => string | null })`: ring buffer (padrão `500`, máx. `1000`), deduplicação por `seq`, filtro por `project` (aceita `project == null` ou `project === projetoAtual`), `limpar()`, `exportarTexto({ filtroOrigem, modo })`, `assinar()`.
  - `iniciarConsole()` (chamado no `AppInterno` em `front-v2/src/App.tsx` junto de `iniciarProgresso()`):
    - No Tauri: assina `listen<EventoConsole>('core-console', ...)` (listener compartilhado único, mesmo padrão de `progresso.ts:352-405`) e opcionalmente sincroniza `chamar('console.history', {})` na inicialização.
    - No Mock (`VITE_CORE_MOCK === '1'`): assina `assinarConsoleMock(...)` de `@core`.
  - `useConsole()` com `useSyncExternalStore` + coalescing de notificações por `requestAnimationFrame` (ou `80 ms`) para não saturar o React sob rajadas.
- **Extensão do Mock TS (`src/lib/core.ts`):**
  - Exportar `EventoConsoleMock`, `assinarConsoleMock`, `emitirConsoleMock`.
  - Atualizar `runCancellableSteps` (`L183-233`) e fluxos mockados relevantes (`components.download`, `components.worker.install`, `components.models.download`, `transcription.hardware.probe`, `sources.url.download`, `export.start`, `selection.start`) para emitir linhas realistas de modo Simples + Técnico no `emitirConsoleMock`, incluindo casos de teste de sanitização no mock quando necessário.

---

## 5. Fatiamento em tickets pequenos e independentes

Cada ticket abaixo cabe em um PR pequeno, na ordem sugerida, respeitando DCO (`git commit -s`), zero `#NNN` na UI e limpeza de disco/temporários.

### Ticket 1 — Núcleo: módulo `console`, redator de segredos e ponte `core-console`
- **Escopo:** criar `core/src/console.rs` com `ConsoleEvent`, `ConsoleLevel`, ring buffer em memória (500 linhas), throttle por `(job, origin)`, remoção de ANSI/`\r`, truncamento de 512 bytes, redator/sanitizador (chaves API, `Bearer`, `Cookie`, query tokens, tokens hex ≥ 32, caminhos pessoais → `~`), `set_console_emitter`/`emit_console` em `core/src/lib.rs`, comando `console.history` (somente leitura) e registro no `.setup(...)` de `src-tauri/src/main.rs`.
- **Não faz:** não altera UI nem instrumenta comandos ainda.
- **Critérios de aceite:**
  - `emit_console` mascara chaves/tokens/cookies/caminhos pessoais e remove ANSI antes de acionar o emitter e antes de guardar no ring buffer.
  - Ring buffer nunca ultrapassa o limite configurado (FIFO) e isola eventos de outro Projeto em `console.history`.
  - `diagnostic.get` e `diagnostic.log` permanecem 100% intocados (ADR-0006).
- **Testes:** `cargo test --workspace` (testes unitários em `core/src/console.rs` cobrindo cada regra de redação, ANSI, `\r`, truncamento, throttle e ring buffer; teste de `src-tauri` se aplicável).

### Ticket 2 — Front-v2 + Mock: store `console.ts`, mock TS e componente `<ConsoleAoVivo>`
- **Escopo:**
  - Estender `src/lib/core.ts` com `assinarConsoleMock` / `emitirConsoleMock`.
  - Criar `front-v2/src/core/console.ts` (`criarStoreConsole`, `iniciarConsole`, `useConsole`, sanitizador defensivo de fallback no front) e conectar `iniciarConsole()` em `front-v2/src/App.tsx`.
  - Criar `front-v2/src/componentes/ConsoleAoVivo.tsx` usando exclusivamente componentes/tokens de `@ds` (`AreaRolagem` ou `ListaVirtual`, `Botao`, `BotaoIcone`, `Status`, `Select`, `Separador`, `Dica`), com modos `Simples` / `Técnico`, filtro por origem, `Copiar`, `Limpar`, `Rolagem automática` com pausa ao rolar para cima, `role="log"` com `aria-live="off"` + região `role="status" aria-live="polite"` espaçada para marcos.
- **Critérios de aceite:**
  - Buffer circular respeita teto (500 linhas padrão / 1.000 máx.), filtra por Projeto ativo e não causa flood em leitores de tela.
  - Nenhum texto com `#NNN` ou jargão de tradutor; contraste validado em temas claro/escuro e `[data-contrast="high"]`.
  - Botão `Copiar` usa `copiarTexto()` de `~/core/desktop`.
- **Testes:**
  - Vitest (`bunx vitest run --maxWorkers=1` com timeout externo): `front-v2/src/core/console.test.ts` e `front-v2/src/componentes/ConsoleAoVivo.test.tsx` (ring buffer, filtro, alternância Simples/Técnico, copiar, limpar, pausa de auto-scroll, `role="log"`/`aria-live`).

### Ticket 3 — Componentes e Assistente: console inline embaixo + instrumentação de instalação/hardware
- **Escopo:**
  - Encaixar `<ConsoleAoVivo>` recolhível embaixo de `front-v2/src/telas/config/ConfigComponentes.tsx` (e opcionalmente no `PassoEssencial.tsx` do Assistente, conforme resposta à pergunta em aberto #1).
  - Instrumentar emissores Rust de instalação/verificação: `core/src/components.rs`, `core/src/components/worker.rs` (ler saída sanitizada de `uv` em vez de `io::sink()`), `core/src/components/models.rs`, `core/src/components/update.rs`, `core/src/components/catalog.rs`, `core/src/components/hardware.rs` e `core/src/tts/catalog.rs`.
  - Atualizar `runCancellableSteps` no mock (`src/lib/core.ts`) para emitir eventos de console durante downloads e sonda de hardware.
- **Critérios de aceite:**
  - Em `ConfigComponentes`, o console aparece recolhido por padrão embaixo da tela; ao disparar download/instalação do Worker/teste de hardware, expande e exibe passos em PT-BR (modo Simples) e detalhes sanitizados (modo Técnico).
  - Sem scroll na moldura externa em `1366×768` e `1440×900`.
- **Testes:**
  - Rust: testes de emissão sanitizada em `components`, `worker` e `hardware` (com fake `uv`/HTTP local).
  - Vitest (`--maxWorkers=1`): atualizar `ConfigComponentes.test.tsx` (e `Assistente.test.tsx` se aplicável).
  - Playwright mock (`front-v2/e2e/config-componentes-exportacao.spec.ts` ou spec dedicado): fluxo baixar componente → console expande e registra linhas → alterna para Técnico → Copiar → Limpar → validar `1366×768` e `1440×900`.

### Ticket 4 — Dock global recolhível no `Shell` + ligação com Fila + subprocessos de mídia
- **Escopo:**
  - Adicionar dock inferior recolhível no `front-v2/src/shell/Shell.tsx` (recolhido por padrão, gatilho discreto na `BarraStatus`, comando na Paleta `Ctrl/Cmd+K`, inclusão no ciclo `F6`, `Esc` fecha devolvendo foco).
  - Adicionar ação discreta *"Ver console"* nos cards da `front-v2/src/telas/fila/PainelFilaJobs.tsx` que abre o dock filtrado para o job.
  - Instrumentar subprocessos de mídia no núcleo: `core/src/export/render.rs` + `core/src/export.rs` (métricas de `-progress` e fallback de encoder), `core/src/url_import.rs` (`yt-dlp` progress template + `stderr_pattern`), `core/src/worker.rs` + `core/src/transcription.rs` + `core/src/reframe.rs` (`WorkerEvent::Model` + `WorkerEvent::Progress.message`), `core/src/tts/narration.rs` (`pocket-tts`) e `core/src/proxy.rs`.
  - Emitir eventos de console no mock (`src/lib/core.ts`) para transcrição, URL e exportação.
- **Critérios de aceite:**
  - Dock abre/fecha sem quebrar layout de Editor, Revisão, Exportação ou `PainelFilaJobs` aberto simultaneamente em `1366×768`.
  - Nunca exibe console duplicado quando o inline de Componentes estiver montado.
  - `stderr` bruto do `ffmpeg`, `yt-dlp` e `worker.py` continua nunca vazando caminhos pessoais ou URLs assinadas.
- **Testes:**
  - Rust: testes de `export::render`, `url_import`, `worker` garantindo que métricas saem e segredos/caminhos não vazam.
  - Vitest (`--maxWorkers=1`): `Shell.test.tsx`, `PainelFilaJobs.test.tsx`.
  - Playwright mock (`front-v2/e2e/console-shell.spec.ts`): abrir/fechar dock por botão/Paleta/`Esc`/`F6`, abrir filtrado a partir da `PainelFilaJobs`, verificar sem overflow em `1366×768` e `1440×900`.

### Ticket 5 — Instrumentação de Tarefas de IA + cobertura E2E Tauri real
- **Escopo:**
  - Instrumentar `core/src/jobs/ai.rs`, `core/src/selection.rs`, `core/src/source_batches.rs` e `core/src/provider_cli.rs` com marcos legíveis (perfil/modelo usado, janela/bloco N de M, tentativa de reparo, tokens/custo/duração ao concluir, nunca texto de prompt/Transcrição/Roteiro/resposta).
  - Adicionar asserções no E2E Tauri (`scripts/e2e-tauri.mjs`) validando recebimento real de `core-console` na WebView ao instalar worker (fake-worker/`uv`) e ao transcrever/exportar mídia sintética, além de checar ausência de chaves/caminhos do `CLIPES_TEST_VAULT_FILE` / `CLIPES_DATA_DIR`.
- **Critérios de aceite:**
  - Durante Seleção de Cortes, Roteiro ou Empacotamento, o console mostra andamento por janela/etapa e motivo de pausa/reparo sem expor conteúdo protegido pelos ADR-0006 e ADR-0009.
  - E2E Tauri passa em Windows (e Linux no CI, já que toca `src-tauri/`/`scripts/e2e-tauri.mjs`).
- **Testes:** `cargo test --workspace`, Vitest (`--maxWorkers=1`), Playwright mock e `bun run test:e2e`.

---

## 6. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **Vazamento de segredos ou caminhos no `uv` / `yt-dlp` / `ffmpeg`** | Alto (exposição ao usuário copiar console ou gravar tela) | Redator obrigatório em `core/src/console.rs` na saída do núcleo; **nunca** encaminhar `stderr` bruto de `ffmpeg`, `worker.py` ou HTTP bodies; no `yt-dlp`, emitir só templates numéricos + identificadores fechados (`stderr_pattern`). |
| **Vazamento de texto de prompt/Transcrição/Roteiro** | Alto (viola ADR-0006 e ADR-0009) | `jobs/ai.rs` e `provider_cli.rs` só emitem metadados fechados (nome da tarefa, perfil, modelo, índice da janela, tokens, código de erro); `stdin` de CLIs nunca é tocado pelo console. |
| **Travamento da WebView por rajada de eventos IPC** | Médio/Alto (CPU/RAM em transcrição ou export rápido) | Throttle de `300 ms` no núcleo para linhas contínuas + coalescing por `requestAnimationFrame` (80 ms) no front + buffer circular limitado (500 linhas padrão) com `ListaVirtual`. |
| **Flood em leitores de tela** | Alto (inacessibilidade WCAG) | `role="log"` com `aria-live="off"` na lista técnica; anúncios `aria-live="polite"` apenas para marcos de início/erro/conclusão com debounce. |
| **Roubo de espaço vertical em `1366×768` (principalmente no Editor)** | Médio | Dock global **recolhido por padrão**; em `ConfigComponentes`, painel embaixo começa recolhido quando ocioso e abre sob demanda/ação. |
| **Conflito de porta `1430` ao rodar Playwright localmente** | Baixo (operacional) | Respeitar `docs/agents/impedimentos.md` (`L41-44`): checar porta 1430 antes de rodar local e usar `CI` quando outro worktree estiver usando. |

---

## 7. Perguntas em aberto ao dev

1. **Auto-abertura em Componentes:** quando o usuário clica em *"Baixar"* / *"Instalar Worker"* / *"Testar hardware"* em `ConfigComponentes`, o painel do console embaixo deve **abrir automaticamente** na primeira linha emitida, ou permanecer **recolhido até o usuário clicar** para expandir? (Recomendação no plano: abrir automaticamente apenas durante ação disparada na tela de Componentes; manter o dock global do `Shell` sempre recolhido por padrão até o usuário abrir.)
2. **Assistente de Primeiro Uso (`PassoEssencial`):** o console inline embaixo também deve aparecer no Passo 1 do Assistente (`#/assistente?passo=1`, onde o usuário instala FFmpeg, Worker e modelo pela primeira vez), ou apenas em `ConfigComponentes` (`#/config/componentes`)?
3. **Sobrevivência a reload (`console.history`):** vale expor o comando `console.history` (ring buffer em memória no núcleo, sem disco) já no Ticket 1 para que um `F5`/reload da WebView recupere as linhas do job em andamento, ou o buffer exclusivamente no front-v2 já basta para a v1 do console?
4. **Nível de detalhe de `uv` no modo Técnico:** durante `components.worker.install`, basta traduzir/emitir as linhas principais do `uv sync` (pacotes resolvidos/instalados, passo CUDA/CPU) sem barra de progresso ASCII, ou vale remover `--no-progress` para capturar ritmo de download de wheels? (Com `--no-progress` a saída já vem em linhas limpas sem flood de `\r`, sendo mais segura e previsível.)
