# Front v2 · Onda 1: Entrada e Configurações

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa por tarefa. Toda tarefa é TDD (`superpowers:test-driven-development`): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Construir todas as telas de entrada e configuração do front v2 do Clipes — Início e Projetos (inclusive abrir Projetos existentes da V1), Assistente de primeiro uso, Instalador *just-in-time* e as 6 seções de Configurações — sobre a fundação da Onda 0 e o design system v2, com mock TS completo e testes Vitest + Playwright em `1366×768` e `1440×900`.

**Architecture:** Telas e componentes em `front-v2/src/` importam primitivas/componentes de `@ds` (`design-system-v2/src/index.ts`) e chamam o núcleo exclusivamente via `chamar<T>()` (`~/core/cliente`), `mensagemDeErro()` (`~/core/erros`), `useFila()` (`~/core/progresso`), `useRota()` (`~/rotas/useRota`), `usePreferencias()` (`~/preferencias/preferencias`) e `useAtalhos()` (`~/comandos/atalhos`). O mock TS em `src/lib/core.ts` (e módulos auxiliares) passa a funcionar sem flags ocultas obrigatórias (`?source-test=1` etc.), emitindo eventos simulados de `core-progress` em `VITE_CORE_MOCK=1`. Sem alterações em `core/` nem `src-tauri/`.

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@base-ui/react` 1.9.0, `lucide-react`, Vite; testes com Vitest + Testing Library + jsdom (unidade e componente) e `@playwright/test` contra o mock (`VITE_CORE_MOCK=1`).

**Spec:** `docs/produto/front-v2/telas/A-shell-inicio-config.md` (Telas 2–10 e Superfície 4), wireframes `docs/produto/front-v2/wireframes/A2-inicio.html` até `A10-config-projeto.html`, `docs/produto/front-v2/01-arquitetura.md` (§3 rotas, §4 shell, §6 estados, §7 custo/privacidade, §8 atalhos, §9 acessibilidade, §10 estado) e `docs/produto/front-v2/02-consolidacao.md` (catálogo canônico e "Lacunas do mock TS"). Issue-mãe: #288.

## Global Constraints

Herdadas integralmente de [04-plano-implementacao.md](./04-plano-implementacao.md#global-constraints):

- Vocabulário canônico do `GLOSSARY.md` em PT-BR (Projeto, Fonte, Corte, Corte direto, Vídeo transformado, Transcrição, Frase, Nota, Narração, Empacotamento, Provedor, Perfil de canal, Perfil de Provedor, Somente local). Nunca "clipe", "short", "input" nem "IA" como substantivo.
- Visual só pelos tokens e componentes de `design-system-v2/src/index.ts` (`@ds`); nenhuma cor fora dos tokens; laranja-sinal apenas no único botão primário da tela, marca de seleção (`marcado`) e foco.
- Revelação progressiva: detalhes técnicos (`SHA-256`, `compute_type`, `handshake`, JSON/trace de erro) ficam recolhidos em `<details>` ou `<BannerErroCore>`.
- WCAG 2.2 AA (`1366×768` sem rolagem externa e verificado em `1440×900`, alvos ≥ 24 px, foco `.foco`/`.foco-interno`, teclas únicas configuráveis SC 2.1.4).
- Toda ação que depende de ticket aberto no núcleo (#289–#307) fica **desabilitada com `<Dica>` citando o ticket** (listadas abaixo).
- Nada de mudança em `core/` ou `src-tauri/`.
- Disco: `cargo clean` (se algo tiver compilado) e limpeza de `%TEMP%\clipes-<ticket>-*` antes de cada `worker_done` (`AGENTS.md`).

### Ações dependentes de tickets abertos no núcleo (#289–#307)

| Ticket aberto | Tela afetada | Comportamento na Onda 1 |
|---|---|---|
| **#305** (`core(provider): setter de timeouts globais e remoção opcional de legacy`) | `#/config/provedores` | 1) Botão `"Remover"` na linha do perfil `"legacy"` fica **desabilitado** com `<Dica>` citando `#305` (`"Remoção do perfil legado aguarda suporte no núcleo (#305)."`).<br>2) Edição dos timeouts globais de `provider.json` (`timeouts.remote` / `timeouts.local`) fica **desabilitada** com `<Dica>` citando `#305` (`"Timeouts globais aguardam comando no núcleo (#305); ajuste por perfil."`). |
| **#301** (`core(components): adicionar entradas macOS (ffmpeg, yt-dlp, uv) no manifesto`) | `#/assistente`, `<InstaladorJustInTime>`, `#/config/componentes` | Quando `ffmpeg`, `yt-dlp` ou `uv` estiver ausente no manifesto retornado por `components.manifest` (cenário macOS ou `unknown_component`), o botão de download automático fica **desabilitado** com `<Dica>` citando `#301` (`"Download automático indisponível nesta plataforma; aguarda manifesto macOS (#301)."`), mantendo orientação não bloqueante para `components.ffmpeg.system` no caso do FFmpeg. |
| **#297** (`core(events): incluir clip_id em ai:translation:* e emitir evento de backup automático`) | `#/config/projeto` (aba Backups) | Não desabilita botão; a aba recarrega `backups.list` e `backups.settings.get` ao focar a aba e após jobs terminarem na Fila, e exibe `projects.current.warning` quando houver falha. |
| **#307** (`core(telemetry): campos informativos extras...`) | `#/assistente`, `#/config/componentes` | Não desabilita botão; antes de `components.worker.install`, exibe `"Tamanho variável conforme ambiente CUDA/CPU (#307)"` sem inventar bytes. |

## Review Focus

1. **Abertura e migração de Projetos V1 existentes (`#/inicio`):** `projects.open` deve funcionar para pastas `.clipes` da V1 via lista de recentes, botão `"Abrir pasta .clipes"` e `"Localizar pasta…"` (em itens `available: false`), tratando `newer_project`, `migration`/`backup`, `invalid_project` e `project_busy`, além de exibir `projects.current.warning` se o backup automático ou pré-migração falhou.
2. **Cancelamento e isolamento por `job` no `<InstaladorJustInTime>` e Componentes:** downloads de `components.download` / `components.models.download` / `components.worker.install` cancelam com `components.cancel { id }`, enquanto modelos de voz (`tts.models.download`) exigem `termsAccepted: true` e cancelam com **`tts.models.cancel { id }`**; eventos `core-progress` são filtrados estritamente por `job` sem vazar progresso entre cartões.
3. **Cofre, consentimento e veto `Somente local` (`#/config/provedores` e Assistente Passo 2):** chaves de API (`provider.key.set` e `transcription.groq.key.set`) nunca são preenchidas com segredo salvo (apenas `keyLastFour` mascarado `••••1234`), remoções de chave/perfil passam por `<ConfirmDialog>` com foco inicial em `"Cancelar"`, endpoints remotos e CLIs exigem consentimento explícito antes do teste, e `local_only` bloqueia chamadas externas sem trocar de Provedor sozinho (ADR-0010).
4. **Custos, Orçamentos e Auditoria (`#/config/custos`):** `provider.cost.list` nunca pode falhar silenciosamente (`role="alert"` + `"Tentar novamente"`); falhas cobradas (`outcome !== "ok"` e `microUsd > 0`) somam no total com status explícito; `jobs.budget.continue` com pausa `cost_unknown` exige `confirmed: true`; `#/config/custos` permanece utilizável sem Projeto aberto na aba `Tabela de Preços e Estimador`, e a aba `Auditoria` exibe apenas metadados e hashes SHA-256 (nunca texto de Transcrição ou Roteiro).
5. **Aplicação real de Aparência e WCAG 2.1.4 (`#/config/aparencia`) + guarda de `#/config/projeto`:** tema aplica `data-tema="escuro"|"claro"` (alinhado a `design-system-v2/src/tokens/tokens.css`), alto contraste aplica `data-contrast="high"` (conferido por `bun scripts/contraste.ts`), escala `115%` não gera scroll horizontal em `1366×768`, modo WCAG 2.1.4 (`ativas` / `alt` / `desligadas`) e remapeamento com detecção de conflitos refletem imediatamente em `useAtalhos`/`<Paleta>`, e `#/config/projeto` sem Projeto aberto redireciona para `#/config/provedores` sem loop; `backups.restore` fica desabilitado se `useFila()` tiver jobs ativos.

---

## Onda 1 · Entrada e Configurações

**Estrutura de arquivos:**

```
front-v2/
  src/
    componentes/
      SeletorCaminho.tsx            botão nativo (@tauri-apps/plugin-dialog) + input editável
      InstaladorJustInTime.tsx      wrapper conectado (url_import, yunet, tts) inline/modal
    telas/
      inicio/
        Inicio.tsx                  #/inicio (Projetos recentes, V1, diálogo Novo Projeto)
        DialogoNovoProjeto.tsx
      assistente/
        Assistente.tsx              #/assistente?passo=1|2
        PassoEssencial.tsx          Passo 1: FFmpeg + Motor local + hardware
        PassoProvedor.tsx           Passo 2: detecção local/CLI + chave de API
      config/
        ConfiguracoesLayout.tsx     menu lateral das 6 seções + guarda #/config/projeto
        ConfigProvedores.tsx        #/config/provedores (grid Tarefas, Perfis, CLIs, Groq)
        FormPerfilProvedor.tsx      diálogo/painel Novo/Editar Perfil de Provedor
        ConfigCustos.tsx            #/config/custos (Orçamentos, Gastos, Auditoria, Preços)
        ConfigComponentes.tsx       #/config/componentes (Hardware+VAD #279, Modelos, TTS, Pastas)
        ConfigExportacao.tsx        #/config/exportacao (Encoder H.264)
        ConfigAparencia.tsx         #/config/aparencia (Tema, Contraste, Escala, WCAG 2.1.4, Mapa)
        ConfigProjeto.tsx           #/config/projeto (Perfil de canal, Somente local, Backups)
    preferencias/
      aplicarPreferencias.ts        aplica data-tema, data-contrast, data-escala no <html>
  e2e/
    inicio.spec.ts
    assistente.spec.ts
    config-provedores-custos.spec.ts
    config-componentes-exportacao.spec.ts
    config-aparencia-projeto.spec.ts
```

---

### Tarefa 1: Barramento `core-progress` no mock, handlers base de `projects.*` e `<SeletorCaminho>`

**Files:**
- Modify: `src/lib/core.ts` (expor barramento de eventos simulado `emitirProgressoMock` / `assinarProgressoMock`; remover exigência de `?source-test=1` para `projects.current` e `projects.local_only.get`; implementar `projects.create`, `projects.open`, `projects.close`; atualizar `projects.recent` para retornar ao menos 1 Projeto disponível e 1 indisponível no estado padrão e `[]` com `?estado=vazio`)
- Modify: `front-v2/src/core/progresso.ts` (em ambiente `!isTauri()` com `VITE_CORE_MOCK === '1'`, assinar o barramento simulado do mock no `iniciarProgresso`)
- Create: `front-v2/src/componentes/SeletorCaminho.tsx`
- Test: `front-v2/src/componentes/SeletorCaminho.test.tsx`, `front-v2/src/core/projetosMock.test.ts`

**Interfaces:**
- Consumes: `coreDispatch` de `@core`; `Botao`, `Campo`, `Entrada` de `@ds`; `openDialog` de `src/lib/desktop.ts` (ou wrapper direto de `@tauri-apps/plugin-dialog` quando `isTauri()`).
- Produces:
  - `SeletorCaminho({ rotulo, valor, aoMudar, modo, ajuda, erro, placeholder, desabilitado })`: input editável acessível + botão `"Escolher pasta"` / `"Escolher arquivo"` (quando fora do Tauri ou em `VITE_E2E=1`, permite digitação direta ou fila de diálogo E2E sem travar Playwright).
  - Handlers mock em `src/lib/core.ts`:
    - `projects.recent` → `{ available: boolean; name: string; path: string }[]`
    - `projects.current` → `{ id: string; name: string; path: string; warning?: string | null } | null`
    - `projects.create { name, parent }` → valida nome (sem `/`, `\`, `:`, `.`, `..`, vazio → `invalid_project`), cria e abre `{ id, name, path }`
    - `projects.open { path }` → valida sufixo `.clipes` (`invalid_project`) e simula `newer_project` quando `path` termina em `futuro.clipes` (ou `?estado=erro` específico), abrindo Projeto V1 existente e atualizando `projects.recent`
    - `projects.close {}` → fecha Projeto ativo e retorna `null` (rejeita com `project_busy` se houver job ativo simulado)

- [ ] **Step 1: Testes falhando** — `projetosMock.test.ts`: `projects.recent` retorna itens disponíveis e indisponíveis por padrão; `projects.create { name: 'a/b', parent: '/tmp' }` rejeita com `{ code: 'invalid_project' }`; `projects.create` válido muda `projects.current`; `projects.open` em caminho `.clipes` existente (inclusive V1) atualiza `projects.current`; `projects.close` limpa `projects.current`. `SeletorCaminho.test.tsx`: digitar caminho dispara `aoMudar`; exibe mensagem `erro` ligada por `aria-describedby`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/core/projetosMock.test.ts src/componentes/SeletorCaminho.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar handlers `projects.*` e barramento de `core-progress` em `src/lib/core.ts`, conectar em `iniciarProgresso` (`front-v2/src/core/progresso.ts`) e criar `SeletorCaminho.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/core/projetosMock.test.ts src/componentes/SeletorCaminho.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): mock de projetos, barramento de progresso e SeletorCaminho`.

---

### Tarefa 2: Tela Início e Projetos (`#/inicio`) — inclusive Projetos V1 existentes

**Files:**
- Create: `front-v2/src/telas/inicio/Inicio.tsx`, `front-v2/src/telas/inicio/DialogoNovoProjeto.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `inicio` a `<Inicio />`), `front-v2/src/shell/Shell.tsx` (disparar refresh de Projeto ativo ao criar/abrir/fechar)
- Test: `front-v2/src/telas/inicio/Inicio.test.tsx`, `front-v2/e2e/inicio.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useAtalhos` (`~/comandos/atalhos`); `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `<SeletorCaminho>`; `@ds` (`Botao`, `Busca`, `Dialogo`, `Esqueleto`, `EstadoTela`, `BannerErroCore`, `Status`, `useToast`).
- Real core commands used: `projects.recent`, `projects.current`, `projects.create`, `projects.open`, `projects.close`, `assistant.status`.
- Produces:
  - Redireciona para `#/assistente?passo=1` quando `assistant.status().needsSetup === true` na abertura inicial (exceto se `?estado=` estiver ativo para inspeção de QA).
  - Faixa condicional de Projeto ativo (`projects.current !== null`): nome, caminho monoespaçado, aviso clicável se `warning !== null`, botões `"Continuar no Projeto"` (`#/projeto/:id/fontes`) e `"Fechar Projeto"` (`projects.close`).
  - Cabeçalho `"Projetos"` com único primário `"Novo Projeto"` (`Mod+N`) e secundário `"Abrir pasta .clipes"` (`Mod+O`, abre `SeletorCaminho` / diálogo fallback para abrir qualquer pasta `.clipes` da V1 ou nova).
  - Lista de recentes (`Busca` local quando `> 8` itens): item `available: true` com botão `"Abrir"`, item `available: false` com `<Status tom="aviso">Indisponível no disco</Status>` (ícone + texto) e botão `"Localizar pasta…"` que abre seletor e chama `projects.open { path }`.
  - `<DialogoNovoProjeto>`: campo `Nome do Projeto`, `<SeletorCaminho>` para `Pasta onde salvar`, prévia `<pasta>/<nome>.clipes`, validação inline `invalid_project` com `aria-invalid` e `aria-describedby`.
  - Todos os estados §6 presentes na tela: `loading` (`<Esqueleto variante="lista" />` mantendo botões de ação utilizáveis), `empty` (`"Nenhum Projeto recente ainda"` + CTA primário `"Criar primeiro Projeto"` + secundário `"Abrir pasta .clipes"`), `error` (`<BannerErroCore>` com tradução de `newer_project` → botão `"Verificar atualizações"` para `#/sobre`, `project_busy` → `"Abrir Fila de Jobs"`, `project_create`/`project_open`/`migration`/`backup`/`library`), `ready`, `job_running` (botão em `carregando` durante criação/abertura/migração), `partial` (itens individuais `available: false` na lista).

- [ ] **Step 1: Testes falhando** (`Inicio.test.tsx`):
  - `loading` exibe `<Esqueleto>` sem mostrar `"Nenhum Projeto recente ainda"`;
  - `empty` (`?estado=vazio` ou `recent: []`) exibe `"Nenhum Projeto recente ainda"` e `"Criar primeiro Projeto"`;
  - `error` traduz `newer_project` (com botão `"Verificar atualizações"`) e `project_busy` dentro de `role="alert"`;
  - `ready` renderiza Projeto disponível com `"Abrir"` e indisponível com `<Status>` `"Indisponível no disco"` + `"Localizar pasta…"`;
  - `job_running` mantém botão `"Novo Projeto"` / `"Abrir"` em `aria-busy` durante criação/migração;
  - `needsSetup: true` redireciona para `#/assistente`;
  - ações: criar Projeto chama `projects.create { name, parent }` e navega para `#/projeto/:id/fontes`; abrir Projeto V1 chama `projects.open { path }` e navega; fechar Projeto ativo chama `projects.close`;
  - teclado: `Ctrl+N` abre diálogo Novo Projeto; `Ctrl+O` aciona `"Abrir pasta .clipes"`; foco inicial no campo `Nome do Projeto` ao abrir diálogo.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/inicio` → FAIL.
- [ ] **Step 3:** Implementar `Inicio.tsx`, `DialogoNovoProjeto.tsx` e ligar rota em `App.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/inicio` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/inicio.spec.ts`)** em `1366×768` e `1440×900`: estado padrão (disponível + indisponível), `?estado=carregando`, `?estado=vazio`, criar Projeto (`"Canal Teste"` em `"/tmp/clipes"`), abrir pasta `.clipes` V1 existente, nome inválido `"a/b"` sem stack trace, erro `newer_project`, zero `pageerror` e sem scroll horizontal. `bunx playwright test e2e/inicio.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Início e Projetos (#/inicio)`.

---

### Tarefa 3: `<InstaladorJustInTime>` conectado (`yt-dlp`/`deno`, `YuNet`, `pocket-tts`)

**Files:**
- Modify: `src/lib/core.ts` (adicionar handlers `components.cancel`, `components.ffmpeg.system`, `components.download` para `ffmpeg`/`yt-dlp`/`uv`, `components.worker.install` emitindo `core-progress` em etapas `25`/`45`/`95`/`100`, `components.models.download` e `tts.models.download` emitindo `core-progress` cancelável)
- Create: `front-v2/src/componentes/InstaladorJustInTime.tsx`
- Test: `front-v2/src/componentes/InstaladorJustInTime.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useFila` (`~/core/progresso`); `@ds` (`Botao`, `Checkbox`, `Dialogo`, `Dica`, `Esqueleto`, `BannerErroCore`, `Progresso`, `Status`, `tamanho`).
- Real core commands used:
  - `url_import`: `components.ytdlp.status`, `components.deno.status`, `components.manifest`, `sources.url.settings.get`, `sources.url.settings.set`, `components.download`, `components.cancel`.
  - `yunet`: `components.worker.status`, `components.worker.install`, `components.models.manifest`, `components.models.download`, `components.cancel`.
  - `tts`: `components.pocket_tts.status`, `tts.catalog`, `components.download`, `components.cancel`, `tts.models.download`, `tts.models.cancel`.
- Produces:
  - `InstaladorJustInTime({ recurso, idioma, modo = 'inline', aberto, aoFechar, aoConcluir })` (interface canônica de `02-consolidacao.md`).
  - Roteia cancelamento corretamente: `components.cancel { id }` para `yt-dlp`, `deno`, `worker`, `yunet`, `pocket-tts`; **`tts.models.cancel { id }`** para `tts:<modelId>`.
  - Quando item requerido faltar em `components.manifest` (cenário macOS `#301`), desabilita o botão de download automático com `<Dica>` citando `#301`.

- [ ] **Step 1: Testes falhando** (`InstaladorJustInTime.test.tsx`):
  - `loading`: exibe `<Esqueleto>` enquanto consulta status/manifesto;
  - `ready` (já instalado): não bloqueia e notifica pronto;
  - `partial`: quando `yt-dlp` instalado e `deno` faltando (ou `pocket-tts` instalado e modelo TTS faltando), marca o presente com `<Status tom="sucesso">Instalado</Status>` e lista apenas o pendente;
  - `url_import`: exibe tamanho, licença (`Unlicense` / `MIT`), exige checkbox de termos (`sources.url.settings.set { terms_accepted: true, download_dir }`) e dispara `components.download { id, confirmed: true }`;
  - `yunet`: se `worker` ausente, encadeia `components.worker.install { confirmed: true }` → `components.models.download { id: 'yunet', confirmed: true }`;
  - `tts`: exibe `prohibitedUse.summaryPt` (com expansão opcional de `textEn`) e mantém `"Baixar e continuar"` desabilitado até marcar aceite (`termsAccepted: true`), depois chama `tts.models.download { id, confirmed: true, termsAccepted: true }`;
  - `job_running`: progresso vindo de `useFila()` por `job` exato; cancelar `deno`/`yunet` chama `components.cancel`, cancelar modelo TTS chama `tts.models.cancel`;
  - `error`: `component_integrity` / `hash_mismatch` / `terms_acceptance_required` / `unknown_component` (`#301`) traduzidos em `role="alert"`;
  - `modo="modal"` abre em `<Dialogo>` acessível com `Esc` quando ocioso.
- [ ] **Step 2:** `cd front-v2 && bun run test src/componentes/InstaladorJustInTime.test.tsx` → FAIL.
- [ ] **Step 3:** Estender mock em `src/lib/core.ts` e implementar `InstaladorJustInTime.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/componentes/InstaladorJustInTime.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): InstaladorJustInTime conectado e mock de download`.

---

### Tarefa 4: Tela Assistente de Primeiro Uso (`#/assistente?passo=1|2`)

**Files:**
- Create: `front-v2/src/telas/assistente/Assistente.tsx`, `front-v2/src/telas/assistente/PassoEssencial.tsx`, `front-v2/src/telas/assistente/PassoProvedor.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `assistente` ao `<Assistente />` dentro de `<Shell>` com `modoMinimo`)
- Test: `front-v2/src/telas/assistente/Assistente.test.tsx`, `front-v2/e2e/assistente.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useFila` (`~/core/progresso`); `<ComEstado>`, `estadoForcado`; `<SeletorCaminho>`; `@ds` (`Botao`, `Campo`, `Checkbox`, `ConfirmDialog`, `Dica`, `Entrada`, `Esqueleto`, `BannerErroCore`, `Progresso`, `Select`, `Status`, `tamanho`).
- Real core commands used:
  - Passo 1: `components.ffmpeg.status`, `components.ffmpeg.system`, `components.manifest`, `components.download`, `components.cancel`, `components.settings.get`, `components.worker.status`, `components.worker.install`, `components.models.manifest`, `components.models.download`, `transcription.hardware.status`, `transcription.hardware.probe`, `transcription.grouping`.
  - Passo 2: `assistant.status`, `assistant.detect`, `assistant.default.set`, `assistant.complete`, `provider.configure`, `provider.key.set`, `provider.confirm`, `provider.test`, `provider.cli.configure`, `provider.cli.confirm`, `provider.profiles.list`.
- Produces:
  - Passo 1 (`?passo=1`):
    - Card FFmpeg: mostra tamanho/licença; `"Baixar FFmpeg"` abre `<ConfirmDialog>` antes de `components.download { id: 'ffmpeg', confirmed: true }`; se `ffmpeg` ausente do manifesto (`#301`), botão de download fica desabilitado com `<Dica>` citando `#301`; expansão `"Já tenho FFmpeg instalado no computador"` chama `components.ffmpeg.system`; se `incomplete: true`, alerta claro.
    - Card Motor de transcrição local: traduz GPU/CPU/VRAM em linguagem humana (sem expor `int8_float16`/`handshake` fora de `<details>Detalhes técnicos</details>`); mostra destino `data_dir` + link `"Mudar pasta de instalação"` (`#/config/componentes`); nota sobre `#307` (`"Tamanho variável conforme ambiente CUDA/CPU (#307)"`); `"Instalar motor e modelo recomendados"` abre `<ConfirmDialog>` e encadeia `components.worker.install { confirmed: true }` → `components.models.download { id, confirmed: true }`; `"Testar meu hardware"` chama `transcription.hardware.probe`.
    - Nota sobre ferramentas *just-in-time* (`yt-dlp`/`deno`, `YuNet`, `pocket-tts` adiados).
  - Passo 2 (`?passo=2`):
    - Executa `assistant.detect` e exibe `radiogroup` com servidores locais em loopback (`ollama`, `lmStudio`, `llamaCpp` — selo `"Local · US$ 0,00 · não sai do computador"`), CLIs (`codex`, `claude` com selo explícito `"Experimental"`, `opencode` — consentimento `provider.cli.confirm`), ou `"Chave de API"` (presets OpenAI/Anthropic/Gemini/OpenRouter/compatível, senha no cofre via `provider.key.set`, checkbox `"Concordo em enviar apenas texto de transcrições para <host>"` → `provider.confirm`, `"Testar conexão"` → `provider.test`).
    - `"Concluir configuração"` grava Perfil (`provider.configure` / `provider.cli.configure`), define padrão (`assistant.default.set`) e chama `assistant.complete { skipped: false }`, navegando para `#/inicio` (ou `#/config/provedores` se veio de lá).
    - `"Pular por enquanto"` / `"Configurar depois"` chama `assistant.complete { skipped: true }` e navega para `#/inicio`.

- [ ] **Step 1: Testes falhando** (`Assistente.test.tsx`):
  - Passo 1 `loading` exibe `<Esqueleto>`; `partial` permite avançar só com FFmpeg; `job_running` mostra progresso por etapa (`25`/`45`/`95`) e botão `"Cancelar"` chamando `components.cancel`; `error` traduz `unknown_component`, `download`/`hash_mismatch`, `invalid_ffmpeg`;
  - na camada principal do Passo 1, não há `int8_float16` nem `handshake` fora de `<details>`;
  - `"Baixar FFmpeg"` abre `<ConfirmDialog>` com tamanho e licença antes de chamar `components.download`;
  - Passo 2 `empty` (nenhum servidor/CLI encontrado) destaca opção `"Configurar chave de API"`; com Ollama detectado exibe `"Local · US$ 0,00 · não sai do computador"`; com API remota desabilita `"Testar conexão"` até marcar consentimento; Claude CLI exibe `"Experimental"`;
  - `"Pular por enquanto"` chama `assistant.complete { skipped: true }`;
  - teclado/A11y: `<nav aria-label="Etapas da configuração inicial">` com `aria-current="step"`, `radiogroup` com setas no Passo 2, `Esc` no `<ConfirmDialog>` cancela.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/assistente` → FAIL.
- [ ] **Step 3:** Implementar `Assistente.tsx`, `PassoEssencial.tsx`, `PassoProvedor.tsx` e ligar em `App.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/assistente` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/assistente.spec.ts`)** em `1366×768` e `1440×900`: abrir `#/inicio?assistant-test=1` redireciona para `#/assistente?passo=1`; baixar FFmpeg via `<ConfirmDialog>`; avançar para Passo 2; detectar Ollama e concluir ou pular para `#/inicio`; zero `pageerror`. `bunx playwright test e2e/assistente.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): Assistente de Primeiro Uso (#/assistente)`.

---

### Tarefa 5: Moldura de Configurações (`ConfiguracoesLayout`) e guarda de `#/config/projeto`

**Files:**
- Create: `front-v2/src/telas/config/ConfiguracoesLayout.tsx`
- Modify: `front-v2/src/rotas/rotas.ts` (garantir que `#/config/projeto` sem Projeto aberto redirecione com aviso `"Abra um Projeto para editar estas configurações."`), `front-v2/src/App.tsx` (renderizar `<ConfiguracoesLayout>` com feedback de aviso no toast)
- Test: `front-v2/src/telas/config/ConfiguracoesLayout.test.tsx`

**Interfaces:**
- Consumes: `useRota`, `Rota` (`~/rotas/useRota`, `~/rotas/rotas`); `@ds` (`AreaRolagem`, `Status`, `useToast`).
- Produces:
  - `ConfiguracoesLayout({ secao, projetoAberto, titulo, subtitulo, acoesCabecalho, children })`: menu lateral esquerdo fixo (`200 px`) com as 6 seções em `<nav aria-label="Seções de Configurações">` e `aria-current="page"` na ativa; item `Projeto atual` mostra dica `"Abra um Projeto"` quando `projetoAberto === null`; conteúdo principal com `AreaRolagem` independente (nunca rola a moldura externa).

- [ ] **Step 1: Testes falhando** (`ConfiguracoesLayout.test.tsx`): renderiza as 6 seções com `aria-current="page"` na ativa; sem Projeto aberto indica `"Abra um Projeto"` no item `Projeto atual`; acessar `#/config/projeto` sem Projeto redireciona para `#/config/provedores` com aviso.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar `ConfiguracoesLayout.tsx` e ajustar mensagem de aviso na guarda em `rotas.ts` / `App.tsx`. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(front-v2): layout lateral de Configurações e guarda de Projeto`.

---

### Tarefa 6: Configurações — Provedores e Tarefas de IA (`#/config/provedores`)

**Files:**
- Modify: `src/lib/core.ts` (garantir persistência de `timeoutSeconds` em `provider.cli.configure`, validação de remoção proibida de `"legacy"` em `provider.profiles.remove`, dados padrão coerentes sem query flag oculta)
- Create: `front-v2/src/telas/config/ConfigProvedores.tsx`, `front-v2/src/telas/config/FormPerfilProvedor.tsx`
- Modify: `front-v2/src/App.tsx` (ligar `secao === 'provedores'`)
- Test: `front-v2/src/telas/config/ConfigProvedores.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `mensagemDeErro`; `useFila`; `<ComEstado>`, `estadoForcado`; `<ConfiguracoesLayout>`; `@ds` (`Botao`, `BotaoIcone`, `Campo`, `Checkbox`, `ConfirmDialog`, `Dica`, `Dialogo`, `Entrada`, `Esqueleto`, `BannerErroCore`, `Select`, `Status`, `Switch`, `TabelaGrade`, `useToast`).
- Real core commands used: `assistant.status`, `assistant.tasks`, `assistant.default.set`, `assistant.task.set`, `assistant.local_only.set`, `provider.profiles.list`, `provider.profiles.remove`, `provider.status`, `provider.configure`, `provider.key.set`, `provider.key.remove`, `provider.confirm`, `provider.test`, `provider.context.get`, `provider.selection_state`, `provider.cli.status`, `provider.cli.configure`, `provider.cli.confirm`, `transcription.groq.key.status`, `transcription.groq.key.set`, `transcription.groq.key.remove`, `transcription.groq.key.test`.
- Produces:
  - Bloco 1 — Roteamento por Tarefa de IA: seletor `Provedor padrão do app` (`assistant.default.set`) + `<TabelaGrade>` das 4 Tarefas (`Seleção de Cortes`, `Empacotamento`, `Roteiro`, `Tradução`) com Perfil atribuído (`assistant.task.set`), Destino/Custo, `<Switch>` `Somente local` (`assistant.local_only.set`) e aviso de `blocked` / `missing` + `suggestion`; cartão `provider.selection_state { task: 'selection' }` (oculto para CLI).
  - Bloco 2 — Perfis de Provedor + CLIs: lista HTTP/Local com `keyLastFour` mascarado (`••••1234` / `"Sem chave"`), `provider.context.get`, `"Testar"` (`provider.test`), `"Atualizar contexto"`, `"Medir contexto"` (`probeContext: true`, só se `local: true`), `"Editar"`, `"Remover"` (`<ConfirmDialog>` com foco inicial em `"Cancelar"`); na linha `"legacy"`, botão `"Remover"` fica **desabilitado** com `<Dica>` citando `#305`; controles globais de timeout de `provider.json` ficam **desabilitados** com `<Dica>` citando `#305`; nos 3 CLIs, Claude exibe selo `"Experimental"`, OpenCode exibe campo `provedor/modelo`, todos permitem `Timeout (s)` (`provider.cli.configure { kind, timeoutSeconds }`) e confirmação (`provider.cli.confirm`).
  - Bloco 3 — Transcrição remota (Groq): status da chave no cofre, entrada mascarada com botão mostrar/ocultar durante digitação, `"Salvar chave"`, `"Testar chave"`, `"Remover chave"` (sempre via `<ConfirmDialog>`).

- [ ] **Step 1: Testes falhando** (`ConfigProvedores.test.tsx`):
  - `loading` (`<Esqueleto>`), `empty` (`"Nenhum Perfil de Provedor configurado"` + `"Adicionar Perfil de Provedor"`), `error` (`local_only_violation`, `vault`, `invalid_endpoint`, `groq_key`, `cli_auth_required`, `probe_not_local`), `job_running` (botão `"Testar conexão"` em `carregando`), `partial` (`missing` ou `blocked` apenas na linha afetada);
  - ações: ligar `Somente local` na tarefa chama `assistant.local_only.set`; remover perfil abre `<ConfirmDialog>` com foco inicial em `"Cancelar"` e chama `provider.profiles.remove`; remover chave Groq ou de perfil abre `<ConfirmDialog>` antes de `*.key.remove`; `"Remover"` em perfil `"legacy"` e timeouts globais ficam desabilitados com tooltip citando `#305`;
  - teclado/A11y: `<TabelaGrade>` navega com setas; campos de chave usam `type="password"` sem expor segredo salvo.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/config/ConfigProvedores.test.tsx` → FAIL.
- [ ] **Step 3:** Atualizar mock em `src/lib/core.ts` e implementar `ConfigProvedores.tsx` e `FormPerfilProvedor.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/config/ConfigProvedores.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): Configurações de Provedores e Tarefas de IA (#/config/provedores)`.

---

### Tarefa 7: Configurações — Custos, Orçamentos e Auditoria (`#/config/custos`) + E2E Provedores/Custos

**Files:**
- Modify: `src/lib/core.ts`, `src/lib/batchMock.ts` (adicionar `jobs.budget.get`, `provider.audit.list`; corrigir `jobs.budget.set` e `jobs.budget.continue` para suportar `scope: 'task' | 'batch'` retornando `{ budgets: [...] }` como o Rust; remover portão `?source-test=1` de `provider.cost.list` e incluir falha cobrada no mock padrão; ampliar `provider.cost.estimate` para simular `zero`/`plan_quota`/`unknown` e `provider.prices.get` com múltiplos modelos)
- Create: `front-v2/src/telas/config/ConfigCustos.tsx`
- Modify: `front-v2/src/App.tsx` (ligar `secao === 'custos'`)
- Test: `front-v2/src/telas/config/ConfigCustos.test.tsx`, `front-v2/e2e/config-provedores-custos.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `mensagemDeErro`; `useFila`; `<ComEstado>`, `estadoForcado`; `<ConfiguracoesLayout>`; `copyText` (`src/lib/desktop.ts` ou `navigator.clipboard`); `@ds` (`Abas`, `Botao`, `Campo`, `Checkbox`, `ConfirmDialog`, `Entrada`, `Esqueleto`, `EstadoTela`, `BannerErroCore`, `Progresso`, `ResumoCustoPrivacidade`, `Select`, `Status`, `TabelaGrade`, `usd`).
- Real core commands used: `jobs.budget.get`, `jobs.budget.set`, `jobs.budget.continue`, `provider.cost.list`, `provider.audit.list`, `provider.prices.get`, `provider.prices.set`, `provider.prices.clear`, `provider.cost.estimate`.
- Produces:
  - 3 sub-abas (`Abas`): `Orçamentos e Gastos`, `Auditoria`, `Tabela de Preços e Estimador`.
  - Sem Projeto aberto: abas 1 e 2 exibem `<EstadoTela tipo="vazio">` com CTA `"Ir para Início"` (`#/inicio`); aba 3 (`Tabela de Preços e Estimador`) continua 100% operável.
  - Aba 1: orçamentos `task` e `batch` com barras tabulares, editar teto (`jobs.budget.set`), zerar contagem (`resetUsage: true`), retomar pausa (`jobs.budget.continue`, exigindo confirmação explícita quando `paused === 'cost_unknown'`), filtro de histórico real (`Todas` / `Somente falhas cobradas`), somando falhas cobradas (`outcome !== 'ok' && microUsd > 0`) com `<Status tom="perigo">`.
  - Aba 2: aviso de privacidade no topo (`"Nenhum texto de Transcrição, Roteiro ou chave de API é salvo aqui..."`), filtro por `job`, tabela com `host`, `sentBytes`, hashes SHA-256 truncados com botão copiar (`aria-label="Copiar hash ..."` e anúncio `role="status"` `"Hash copiado"`).
  - Aba 3: simulador alimentando `<ResumoCustoPrivacidade>` + tabela de preços com sobrescrita (`provider.prices.set`) e `"Restaurar padrão"` (`provider.prices.clear`).
  - Nunca engole erro de `provider.cost.list`: exibe `<BannerErroCore>` com `"Tentar novamente"`.

- [ ] **Step 1: Testes falhando** (`ConfigCustos.test.tsx`):
  - `loading`, `empty` (sem Projeto nas abas 1 e 2 + aba 3 funcional), `error` (erro em `provider.cost.list` nunca é engolido e exibe `role="alert"` + `"Tentar novamente"`; `invalid_budget`, `invalid_price`, `local_only_violation`), `job_running`, `partial` (`paused !== null` exibe faixa de retomada);
  - ações: `jobs.budget.continue` em `cost_unknown` envia `confirmed: true`; falha cobrada entra no total e exibe status; copiar hash na Auditoria escreve no clipboard e anuncia `"Hash copiado"`;
  - teclado/A11y: sub-abas em `role="tablist"`, valores monetários com `.num`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/config/ConfigCustos.test.tsx` → FAIL.
- [ ] **Step 3:** Atualizar mocks (`core.ts`, `batchMock.ts`) e implementar `ConfigCustos.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/config/ConfigCustos.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/config-provedores-custos.spec.ts`)** em `1366×768` e `1440×900`: redirecionamento `#/config/projeto` sem Projeto; toggle `Somente local` + bloqueio; remoção de perfil/chave via `<ConfirmDialog>` e botão `"Remover"` desabilitado em `"legacy"` (`#305`); `#/config/custos` sem Projeto na aba Preços; com Projeto aberto, retomada de orçamento pausado e lista de Auditoria sem texto; zero `pageerror`. `bunx playwright test e2e/config-provedores-custos.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): Configurações de Custos, Orçamentos e Auditoria (#/config/custos)`.

---

### Tarefa 8: Configurações — Componentes e Armazenamento (`#/config/componentes`)

**Files:**
- Modify: `src/lib/core.ts` (implementar handler `components.settings.set` validando caminhos absolutos e `cache_limit_bytes > 0`)
- Create: `front-v2/src/telas/config/ConfigComponentes.tsx`
- Modify: `front-v2/src/App.tsx` (ligar `secao === 'componentes'`)
- Test: `front-v2/src/telas/config/ConfigComponentes.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `mensagemDeErro`; `useFila`; `<ComEstado>`, `estadoForcado`; `<ConfiguracoesLayout>`; `<SeletorCaminho>`; `@ds` (`Abas`, `Botao`, `Campo`, `Checkbox`, `ConfirmDialog`, `Dica`, `Entrada`, `Esqueleto`, `EstadoTela`, `BannerErroCore`, `Progresso`, `Select`, `Status`, `tamanho`).
- Real core commands used: `transcription.hardware.status`, `transcription.hardware.probe`, `transcription.hardware.choose`, `transcription.grouping`, `components.manifest`, `components.download`, `components.cancel`, `components.settings.get`, `components.settings.set`, `components.ffmpeg.status`, `components.ffmpeg.system`, `components.deno.status`, `components.pocket_tts.status`, `components.ytdlp.status`, `components.ytdlp.update`, `components.worker.status`, `components.worker.install`, `components.catalog.status`, `components.catalog.check`, `components.models.manifest`, `components.models.download`, `tts.catalog`, `tts.models.choose`, `tts.models.download`, `tts.models.cancel`.
- Produces:
  - 4 sub-abas (`Abas`):
    1. `Hardware de Transcrição`: GPU/RAM/CUDA em linguagem simples + `<details>` técnico, `Testar hardware` (`transcription.hardware.probe`), escolha manual / `"Restaurar automático"` (`transcription.hardware.choose`), e **bloco Agrupamento de VAD (#279)** (`Automático` → `transcription.grouping { auto: true }` vs `Manual` → `{ enabled }`) com aviso exato visível fora de `<details>`: `"No modo automático, fica ligado na CPU e desligado na GPU: na CPU acelera ~18%; na GPU usa ~1 GB a mais de VRAM sem ganho medido."`
    2. `Componentes e Modelos`: FFmpeg (gerenciado + `"Usar FFmpeg do sistema"`), `yt-dlp` (`Atualizar`) e `deno`, Worker Python (`Instalar / Reparar` com nota `#307`), Catálogo (`components.catalog.check`), Modelos (`whisper-turbo`, `whisper-small`, `yunet`) com `<ConfirmDialog>` de tamanho+licença e progresso isolado estritamente por `job`. Itens ausentes no manifesto (`#301`) ficam desabilitados com `<Dica>` citando `#301`.
    3. `Vozes TTS (Narração)`: `pocket-tts`, seletor de modelo por idioma (`tts.models.choose`), lista de vozes com atribuição/licença, termo `prohibitedUse.summaryPt` + checkbox obrigatório (`termsAccepted: true`), download (`tts.models.download`) e cancelamento via **`tts.models.cancel`**.
    4. `Pastas e Armazenamento`: `data_dir` + `cache_dir` (`<SeletorCaminho>`) + `Limite do cache (GB)` (`cache_limit_bytes`), com aviso obrigatório visível antes de salvar: `"Alterar a pasta de componentes vale apenas para downloads futuros. Arquivos já baixados não são movidos automaticamente..."`.

- [ ] **Step 1: Testes falhando** (`ConfigComponentes.test.tsx`):
  - `loading`, `empty` (catálogo/vozes vazio), `error` (`worker_missing`, `ram_insufficient`, `invalid_ffmpeg`, `catalog_signature_invalid`, `invalid_settings`), `job_running` (simular `core-progress` de `job: 'deno'` atualiza apenas o card do `deno`), `partial` (`incomplete` / `outdated`);
  - aviso exato do VAD #279 e aviso obrigatório de `data_dir` visíveis na tela principal;
  - download de modelo abre `<ConfirmDialog>` com tamanho e licença; download TTS exige termo aceito e cancela com `tts.models.cancel`; componente ausente do manifesto desabilita download com tooltip `#301`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/config/ConfigComponentes.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `components.settings.set` em `src/lib/core.ts` e criar `ConfigComponentes.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/config/ConfigComponentes.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): Configurações de Componentes e Armazenamento (#/config/componentes)`.

---

### Tarefa 9: Configurações — Exportação e Encoder (`#/config/exportacao`) + E2E Componentes/Exportação

**Files:**
- Modify: `src/features/export/mock.ts` (permitir simular `ffmpeg: false` e `stale: true` por cenário `?estado=`)
- Create: `front-v2/src/telas/config/ConfigExportacao.tsx`
- Modify: `front-v2/src/App.tsx` (ligar `secao === 'exportacao'`)
- Test: `front-v2/src/telas/config/ConfigExportacao.test.tsx`, `front-v2/e2e/config-componentes-exportacao.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `mensagemDeErro`; `<ComEstado>`, `estadoForcado`; `<ConfiguracoesLayout>`; `@ds` (`Botao`, `Esqueleto`, `EstadoTela`, `BannerErroCore`, `Status`).
- Real core commands used: `export.encoder.status`, `export.encoder.detect`, `export.encoder.set`.
- Produces:
  - Cartão de status traduzindo `effective` (`h264_nvenc` → `"Placa NVIDIA (NVENC)"`, `h264_qsv` → `"Intel Quick Sync"`, `h264_amf` → `"AMD AMF"`, `h264_videotoolbox` → `"Apple VideoToolbox"`, `libx264` → `"Processador / CPU (x264)"`).
  - `ffmpeg === false`: aviso + botão `"Ir para Componentes"` (`#/config/componentes`).
  - `detected === false` (estado `empty`): explica fallback `x264` + CTA `"Detectar encoders agora"`.
  - `stale === true` (estado `partial`): faixa discreta sugerindo retestar.
  - `radiogroup` acessível (`Automático` → `{ encoder: null }`, `passed` habilitados, não aprovados desabilitados com `<Status>` textual).

- [ ] **Step 1: Testes falhando** (`ConfigExportacao.test.tsx`): `loading`, `empty` (`detected: false`), `error` (`component_missing` / `encoder_invalid` / `export_failed`, `ffmpeg: false` → `"Ir para Componentes"`), `job_running` (botão `"Detectar encoders novamente"` em `carregando` e rádios desabilitados), `partial` (`stale: true`); ações `export.encoder.detect` e `export.encoder.set`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/config/ConfigExportacao.test.tsx` → FAIL.
- [ ] **Step 3:** Estender `src/features/export/mock.ts` e implementar `ConfigExportacao.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/config/ConfigExportacao.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/config-componentes-exportacao.spec.ts`)** em `1366×768` e `1440×900`: sub-abas de `#/config/componentes`, aviso VAD #279, progresso isolado de `deno`, aviso `data_dir` + erro humano em caminho relativo, `#/config/exportacao` com `detect` e `set`; zero `pageerror`. `bunx playwright test e2e/config-componentes-exportacao.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): Configurações de Exportação e Encoder (#/config/exportacao)`.

---

### Tarefa 10: Configurações — Aparência e Teclado (`#/config/aparencia`) e extensão de preferências/atalhos

**Files:**
- Modify: `design-system-v2/src/tokens/tokens.css` (adicionar `[data-contrast='high']` para escuro e claro elevando contraste de `--t2`, `--t3`, `--linha` e `--linha-forte` ≥ 7:1; adicionar suporte a escala `115%` via `[data-escala='115']` sem quebrar layout)
- Modify: `front-v2/src/preferencias/preferencias.ts`, `front-v2/src/comandos/atalhos.ts` (estender preferências com `modoTeclasUnicas: 'ativas' | 'alt' | 'desligadas'` mantendo compatibilidade com `teclasUnicas`, `paineisSoPorClique: boolean`, remapeamento com detecção de conflito no mesmo escopo ou global, restauração individual e total)
- Create: `front-v2/src/preferencias/aplicarPreferencias.ts`, `front-v2/src/telas/config/ConfigAparencia.tsx`
- Modify: `front-v2/src/App.tsx` (aplicar preferências no `<html>` e ligar `secao === 'aparencia'`)
- Test: `front-v2/src/preferencias/preferencias.test.ts`, `front-v2/src/comandos/atalhos.test.ts`, `front-v2/src/telas/config/ConfigAparencia.test.tsx`

**Interfaces:**
- Consumes: `usePreferencias`, `PADRAO` (`~/preferencias/preferencias`); `ProvedorAtalhos` / registro (`~/comandos/atalhos`); `<ConfiguracoesLayout>`; `@ds` (`Botao`, `Busca`, `ConfirmDialog`, `Kbd`, `Segmentado`, `Select`, `Switch`, `TabelaGrade`).
- Produces:
  - `aplicarPreferencias(prefs)` aplica `data-tema="escuro"|"claro"` (resolvendo `sistema` via `matchMedia('(prefers-color-scheme: light)')`), `data-contrast="high"` quando `altoContraste: true` e `data-escala="115"` quando `escala === 115`.
  - Seção 1 (`Visual e Idioma`): Tema (`Escuro` / `Claro` / `Sistema`), Alto Contraste (`Switch`), Escala UI (`100%` / `115%`), Idioma (`pt` / `en`), `Abrir gavetas/painéis só por clique/atalho` (`Switch`).
  - Seção 2 (`Acessibilidade de Teclado — WCAG 2.1.4`): 3 opções exclusivas (`Ativas fora de campos de texto` / `Exigir Alt + tecla` / `Desligar todos os atalhos de tecla única`), atualizando imediatamente manipulador global e `<Kbd>`.
  - Seção 3 (`Mapa de Atalhos`): `<Busca>` por ação/escopo/tecla (estado `empty` `"Nenhum atalho corresponde a '<termo>'."` + `"Limpar busca"`), captura de tecla por linha (`Esc` cancela, `aria-live="polite"`), alerta `role="alert"` em conflito no mesmo escopo/global (`"Substituir"` ou `"Escolher outra tecla"`), `"Restaurar padrão"` por item e `"Restaurar todos os padrões"` via `<ConfirmDialog>`.

- [ ] **Step 1: Testes falhando** (`preferencias.test.ts`, `atalhos.test.ts`, `ConfigAparencia.test.tsx`):
  - `aplicarPreferencias` define `data-tema`, `data-contrast="high"` e `data-escala="115"` no `document.documentElement`;
  - modo `'alt'` exige `Alt+<tecla>` para tecla única e mostra `<Kbd>Alt+A</Kbd>`; modo `'desligadas'` bloqueia teclas únicas mantendo `Ctrl+K`;
  - busca vazia mostra `"Limpar busca"`; captura com conflito exibe alerta inline antes de sobrescrever; `"Restaurar todos os padrões"` abre `<ConfirmDialog>` com foco em `"Cancelar"`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/preferencias src/comandos src/telas/config/ConfigAparencia.test.tsx` → FAIL.
- [ ] **Step 3:** Atualizar `tokens.css`, `preferencias.ts`, `atalhos.ts`, criar `aplicarPreferencias.ts` e `ConfigAparencia.tsx`, ligar em `App.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test` → PASS; `cd design-system-v2 && bun scripts/contraste.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): Configurações de Aparência, WCAG 2.1.4 e remapeamento (#/config/aparencia)`.

---

### Tarefa 11: Configurações — Projeto atual (`#/config/projeto`) + E2E Aparência/Projeto

**Files:**
- Modify: `src/lib/core.ts` (implementar `backups.settings.set`, `backups.create`, `backups.restore`; remover portão `?source-test` de `backups.list` e `backups.settings.get` incluindo `default_interval_seconds`, `default_copies`, `warning`, e `before_restore` nos itens)
- Create: `front-v2/src/telas/config/ConfigProjeto.tsx`
- Modify: `front-v2/src/App.tsx` (ligar `secao === 'projeto'`)
- Test: `front-v2/src/telas/config/ConfigProjeto.test.tsx`, `front-v2/e2e/config-aparencia-projeto.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `mensagemDeErro`; `useFila`; `<ComEstado>`, `estadoForcado`; `<ConfiguracoesLayout>`; `@ds` (`Abas`, `Botao`, `Campo`, `ConfirmDialog`, `Dica`, `Entrada`, `Esqueleto`, `EstadoTela`, `BannerErroCore`, `Select`, `Status`, `Switch`, `TabelaGrade`).
- Real core commands used: `channel_profile.get`, `channel_profile.set`, `channel_profile.languages`, `tts.catalog`, `projects.local_only.get`, `projects.local_only.set`, `backups.settings.get`, `backups.settings.set`, `backups.create`, `backups.list`, `backups.restore`.
- Produces:
  - 3 sub-abas (`Abas`):
    1. `Perfil de canal`: `radiogroup` `Corte direto` vs `Vídeo transformado`, idioma (`channel_profile.languages`), duração em segundos convertida para µs (`minUs < maxUs <= 180_000_000`), voz padrão (`tts.catalog`), estilo padrão de legenda (`captionStyle`), `Fontes permitidas` (`allowedSources`, máx. 200), status `directMonetizationAck`, e caixa fixa de ritmo sugerido (US-42).
    2. `Privacidade (Somente local)`: `<Switch>` ligado a `projects.local_only.set { enabled }` com explicação ADR-0010 e atualização imediata do selo no Shell.
    3. `Backups do Projeto`: faixa de alerta quando `warning !== null`, formulário `interval_seconds` / `copies` + `"Restaurar padrão (30 min · 10 cópias)"`, `"Criar backup agora"` (`backups.create`), lista de backups com selo `"Pré-restauração"` (`before_restore`), e botão `"Restaurar"` desabilitado com `<Dica>` quando `useFila()` tiver jobs ativos (`jobs > 0`), abrindo `<ConfirmDialog>` com foco inicial em `"Cancelar"`. Recarrega `backups.*` ao focar a aba e após conclusão de jobs (nota `#297`).

- [ ] **Step 1: Testes falhando** (`ConfigProjeto.test.tsx`):
  - `loading` (`<Esqueleto>`, nunca `"Nenhum backup salvo ainda."`), `empty` (`allowedSources` vazia; `backups.list` vazia), `error` (`invalid_cut_range`, `project_busy`, `backup_invalid`/`restore_failed`, `backup_settings`), `job_running` (`"Restaurar"` desabilitado com jobs ativos na Fila), `partial` (`warning !== null` mantendo formulário editável);
  - ações: salvar Perfil de canal com `90` s envia `maxUs: 90_000_000`; `min >= max` valida localmente sem chamar núcleo; ligar `Somente local` chama `projects.local_only.set { enabled: true }`; `"Restaurar"` abre `<ConfirmDialog>` com foco em `"Cancelar"` e chama `backups.restore { id }`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/config/ConfigProjeto.test.tsx` → FAIL.
- [ ] **Step 3:** Estender mock de backups em `src/lib/core.ts` e implementar `ConfigProjeto.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/config/ConfigProjeto.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/config-aparencia-projeto.spec.ts`)** em `1366×768` e `1440×900`: trocar tema/alto contraste/escala `115%` sem overflow horizontal; desligar teclas únicas WCAG 2.1.4; buscar atalho e detectar conflito no remapeamento; em `#/config/projeto`, salvar Perfil `90` s, ativar `Somente local` vendo selo na barra superior, testar `<ConfirmDialog>` de restauração de backup; zero `pageerror`. `bunx playwright test e2e/config-aparencia-projeto.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): Configurações do Projeto atual (#/config/projeto)`.

---

### Tarefa 12: Fechamento da Onda 1

- [ ] **Step 1:** Em `front-v2/`: `bun run typecheck && bun run test && bunx playwright test` → 100% verde em `1366×768` e `1440×900`.
- [ ] **Step 2:** Em `design-system-v2/`: `bun scripts/contraste.ts` → todos os pares passam (inclusive `[data-contrast="high"]`).
- [ ] **Step 3:** `bunx impeccable detect --json front-v2/src` → sem achados críticos (ou corrigidos antes do PR final).
- [ ] **Step 4:** Salvar screenshots `1366×768` e `1440×900` de `#/inicio`, `#/assistente`, `#/config/provedores`, `#/config/custos`, `#/config/componentes`, `#/config/exportacao`, `#/config/aparencia` e `#/config/projeto` no último PR de fechamento (ou por PR de tela).

---

## Tickets

Agrupamento das 12 tarefas em **5 tickets** executáveis em PRs pequenos (arquivos disjuntos entre os fluxos sempre que possível; onde tocam `src/lib/core.ts` ou `front-v2/src/App.tsx`, fazer rebase após merge do anterior conforme `docs/agents/impedimentos.md`).

| Ticket | Título | Tarefas | Depende de | Arquivos criados / editados | Lacunas do mock TS fechadas |
|---|---|---|---|---|---|
| **T1** | `front-v2(onda 1): Início e Projetos (#/inicio) e mock base de Projetos` | Tarefas 1, 2 | Onda 0 (`#315`, `#316`, `#317`) | `src/lib/core.ts`, `front-v2/src/core/progresso.ts`, `front-v2/src/componentes/SeletorCaminho.tsx`, `front-v2/src/telas/inicio/*`, `front-v2/src/shell/Shell.tsx`, `front-v2/src/App.tsx`, `front-v2/e2e/inicio.spec.ts` | Barramento `core-progress` no mock; `projects.create`, `projects.open`, `projects.close`; `projects.recent` padrão (disponível + indisponível); remover `?source-test=1` de `projects.current` e `projects.local_only.get` |
| **T2** | `front-v2(onda 1): Instalador Just-in-Time e Assistente de Primeiro Uso (#/assistente)` | Tarefas 3, 4 | Onda 0 (`#315`–`#317`), **T1** | `src/lib/core.ts`, `front-v2/src/componentes/InstaladorJustInTime.tsx`, `front-v2/src/telas/assistente/*`, `front-v2/src/App.tsx`, `front-v2/e2e/assistente.spec.ts` | `components.cancel`, `components.ffmpeg.system`, `components.download` (`ffmpeg`, `yt-dlp`, `uv`), eventos `core-progress` em `components.*`/`worker`/`models`/`tts.*` |
| **T3** | `front-v2(onda 1): Configurações — Layout, Provedores (#/config/provedores) e Custos (#/config/custos)` | Tarefas 5, 6, 7 | Onda 0 (`#315`–`#317`) *(rebase se paralelo a T1/T2)* | `src/lib/core.ts`, `src/lib/batchMock.ts`, `front-v2/src/rotas/rotas.ts`, `front-v2/src/telas/config/ConfiguracoesLayout.tsx`, `ConfigProvedores.tsx`, `FormPerfilProvedor.tsx`, `ConfigCustos.tsx`, `front-v2/src/App.tsx`, `front-v2/e2e/config-provedores-custos.spec.ts` | `jobs.budget.get`, `provider.audit.list`; `jobs.budget.set`/`.continue` com `scope: "task"` e retorno `{ budgets }`; `provider.cost.list` sem `?source-test=1`; `provider.cost.estimate` (`zero`/`plan_quota`/`unknown`); `provider.prices.get` multi-modelo; `provider.cli.configure` persistindo `timeoutSeconds`; bloqueio de remoção de `"legacy"` |
| **T4** | `front-v2(onda 1): Configurações — Componentes (#/config/componentes) e Exportação (#/config/exportacao)` | Tarefas 8, 9 | **T1**, **T2**, **T3** | `src/lib/core.ts`, `src/features/export/mock.ts`, `front-v2/src/telas/config/ConfigComponentes.tsx`, `ConfigExportacao.tsx`, `front-v2/src/App.tsx`, `front-v2/e2e/config-componentes-exportacao.spec.ts` | `components.settings.set`; estados `ffmpeg: false` e `stale: true` em `exportMock` via `?estado=`; validação completa de `transcription.grouping` (`#279`) |
| **T5** | `front-v2(onda 1): Configurações — Aparência/Teclado (#/config/aparencia), Projeto atual (#/config/projeto) e fechamento` | Tarefas 10, 11, 12 | **T1**, **T3** | `src/lib/core.ts`, `design-system-v2/src/tokens/tokens.css`, `front-v2/src/preferencias/*`, `front-v2/src/comandos/atalhos.ts`, `front-v2/src/telas/config/ConfigAparencia.tsx`, `ConfigProjeto.tsx`, `front-v2/src/App.tsx`, `front-v2/e2e/config-aparencia-projeto.spec.ts` | `backups.settings.set`, `backups.create`, `backups.restore`; `backups.list` e `backups.settings.get` sem `?source-test`, com `default_interval_seconds`, `default_copies`, `warning` e `before_restore` |

### Critérios de aceite por ticket

#### T1 — `front-v2(onda 1): Início e Projetos (#/inicio) e mock base de Projetos`
- [ ] Testes de componente em `Inicio.test.tsx` cobrindo os estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), incluindo abertura/migração de pasta `.clipes` V1 existente, `Localizar pasta…`, erro `newer_project` e redirecionamento `needsSetup` → `#/assistente`.
- [ ] Testes de ação (`projects.create`, `projects.open`, `projects.close`) e de teclado (`Ctrl+N`, `Ctrl+O`, foco inicial em `Nome do Projeto`).
- [ ] Testes unitários de `SeletorCaminho` e do mock de `projects.*`.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/inicio.spec.ts`) verde, sem `pageerror` nem scroll horizontal.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/inicio.spec.ts` verdes no CI.

#### T2 — `front-v2(onda 1): Instalador Just-in-Time e Assistente de Primeiro Uso (#/assistente)`
- [ ] Testes de componente em `InstaladorJustInTime.test.tsx` cobrindo `loading`, `ready`, `partial`, `job_running`, `error`, modo `inline`/`modal`, termos URL/TTS, `components.cancel` vs `tts.models.cancel`, e desabilitação com tooltip citando `#301` quando ausente do manifesto.
- [ ] Testes de componente em `Assistente.test.tsx` cobrindo estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), ações de Passo 1 e Passo 2 (Ollama, CLI `Experimental`, API com consentimento, Pular/Concluir), ausência de `int8_float16`/`handshake` fora de `<details>`, e navegação por teclado (`aria-current="step"`, `radiogroup`, `Esc` no `<ConfirmDialog>`).
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/assistente.spec.ts`) verde, sem `pageerror`.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/assistente.spec.ts` verdes no CI.

#### T3 — `front-v2(onda 1): Configurações — Layout, Provedores (#/config/provedores) e Custos (#/config/custos)`
- [ ] Testes de `ConfiguracoesLayout.test.tsx` cobrindo as 6 seções e redirecionamento `#/config/projeto` → `#/config/provedores` sem Projeto aberto.
- [ ] Testes em `ConfigProvedores.test.tsx` cobrindo estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), ações (`assistant.*`, `provider.*`, `transcription.groq.key.*`), `<ConfirmDialog>` em remoções, navegação por setas em `<TabelaGrade>`, e botão `"Remover"` em `"legacy"` + timeouts globais desabilitados com tooltip citando `#305`.
- [ ] Testes em `ConfigCustos.test.tsx` cobrindo estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), acesso sem Projeto à aba Preços/Estimador, retomada `cost_unknown` (`confirmed: true`), falhas cobradas, erro visível em `provider.cost.list` e copiar hash SHA-256 na Auditoria.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/config-provedores-custos.spec.ts`) verde, sem `pageerror`.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/config-provedores-custos.spec.ts` verdes no CI.

#### T4 — `front-v2(onda 1): Configurações — Componentes (#/config/componentes) e Exportação (#/config/exportacao)`
- [ ] Testes em `ConfigComponentes.test.tsx` cobrindo estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), isolamento estrito de `core-progress` por `job`, aviso exato do VAD `#279`, aviso `data_dir`, `<ConfirmDialog>` em modelos, cancelamento TTS via `tts.models.cancel`, e tooltip `#301` quando ausente do manifesto.
- [ ] Testes em `ConfigExportacao.test.tsx` cobrindo estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), `ffmpeg: false` → `"Ir para Componentes"`, `stale: true`, e ações `export.encoder.detect`/`set` via teclado em `radiogroup`.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/config-componentes-exportacao.spec.ts`) verde, sem `pageerror`.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/config-componentes-exportacao.spec.ts` verdes no CI.

#### T5 — `front-v2(onda 1): Configurações — Aparência/Teclado (#/config/aparencia), Projeto atual (#/config/projeto) e fechamento`
- [ ] Testes em `preferencias.test.ts`, `atalhos.test.ts` e `ConfigAparencia.test.tsx` cobrindo `loading` síncrono/`ready`, `empty` na busca de atalhos, `error` de conflito no remapeamento, aplicação de `data-tema`/`data-contrast="high"`/`data-escala="115"`, modo WCAG 2.1.4 (`ativas` / `alt` / `desligadas`), e `<ConfirmDialog>` ao restaurar padrões.
- [ ] Testes em `ConfigProjeto.test.tsx` cobrindo estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), conversão s ↔ µs em `channel_profile.set`, `projects.local_only.set`, `"Restaurar"` desabilitado com jobs ativos e `<ConfirmDialog>` com foco inicial em `"Cancelar"` (nota `#297`).
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/config-aparencia-projeto.spec.ts`) verde, sem overflow horizontal em `115%` nem `pageerror`.
- [ ] `bun scripts/contraste.ts` em `design-system-v2/` verde; `bunx impeccable detect --json front-v2/src` limpo; screenshots `1366×768` e `1440×900` anexados ao PR; `bun run typecheck && bun run test && bunx playwright test` verdes no CI.
