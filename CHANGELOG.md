# Changelog

Todas as mudanças relevantes do Clipes serão documentadas neste arquivo.

O formato segue o padrão [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [2.0.0] - 2026-11-19

Nova interface v2 (`front-v2/` e `design-system-v2/`) construída do zero sobre o mesmo núcleo em Rust (`clipes-core`), o mesmo formato portátil de Projeto (`.clipes` com `project.sqlite`) e os mesmos Provedores da v1. Veja as notas completas em [docs/releases/v2.0.0.md](docs/releases/v2.0.0.md).

### Adicionado

- Design system v2 (`design-system-v2/`) com tokens visuais em OKLCH, temas escuro e claro, alto contraste, escala tipográfica, interface em PT-BR (`English` em preparação), navegação entre regiões (`F6`), paleta de comandos (`Ctrl+K`) e folha de atalhos (`?` / `Ctrl+/`).
- Telas **Início** (`#/inicio`, com abertura de Projetos `.clipes` da v1 e detecção de Projetos movidos no disco), **Assistente de primeiro uso** em dois passos (`#/assistente`) e **Configurações** (Aparência e teclado, Projeto atual, Provedores, Custos, Componentes e Exportação).
- Fluxo de **Fontes e Transcrição**: entrada local ou por URL, busca global FTS5, correção inline com `F2` e desfazer/refazer (`next_undo`/`next_redo`, [#302](https://github.com/GUSTAVOHOOO/clipes/issues/302)), visão **Lotes** com teto de custo e escolha explícita entre Motor local (`faster-whisper`) e Groq remoto.
- **Seleção e Bancada de Revisão**: configurador com sinais locais (energia do áudio e chat do YouTube) e pré-visualização de custo/privacidade, preview 9:16, eixos da Nota, decisão por teclado (`A`/`R`, `I`/`O`, `Ctrl+Z`, `Enter`), **Refazer com outro Perfil** e conversão individual de **Corte direto** em **Vídeo transformado** (`selection.candidate.set_kind`, [#483](https://github.com/GUSTAVOHOOO/clipes/issues/483)).
- **Editor do Corte** em três zonas: **Transcrição do Corte** recolhível (`Ctrl+[`), palco 9:16 com barra de 5 ações em popovers (`Enquadrar`, `Legenda`, `Silêncios`, `Áudio` e `Histórico`, `Ctrl+]`), timeline compacta, autosave a cada segundo e coordenação de fechamento da janela com operações em andamento (`CloseRequested`, [#291](https://github.com/GUSTAVOHOOO/clipes/issues/291)).
- Fluxo **Transformar** em 3 passos (Ângulo, Roteiro em blocos com trava humana antes da Narração e Narração por Pocket TTS, teleprompter ou áudio importado, com limpeza e alinhamento por palavra) e sub-aba **Empacotar** ([#367](https://github.com/GUSTAVOHOOO/clipes/issues/367)) com captura de capa PNG, validadores de tamanho e criação manual sem geração prévia por Provedor (`packaging.edit`, [#299](https://github.com/GUSTAVOHOOO/clipes/issues/299)).
- **Mesa de Prontidão** (`export.readiness`, #463), exportação individual (`Ctrl+E`) e em lote com aviso quando o encoder de hardware cai para `x264` ([#289](https://github.com/GUSTAVOHOOO/clipes/issues/289)), **Fila de Jobs** global (`Ctrl+J`, #461), **Relatos** (`#/relatos`) com inferência da etapa real da falha (`diagnostic.get`, [#300](https://github.com/GUSTAVOHOOO/clipes/issues/300)) e **Sobre** (`#/sobre`).
- Comandos e eventos no núcleo: `sources.delete` ([#295](https://github.com/GUSTAVOHOOO/clipes/issues/295)), `editor.snapshots.restore` ([#294](https://github.com/GUSTAVOHOOO/clipes/issues/294)), `jobs.preview` com chaves opacas `clipes-media` ([#296](https://github.com/GUSTAVOHOOO/clipes/issues/296)), `clip_id` em `ai:translation:*` e evento de backup automático ([#297](https://github.com/GUSTAVOHOOO/clipes/issues/297)), e `startedAtMs`/alvo em `jobs.list` + `export.settings.set` ([#484](https://github.com/GUSTAVOHOOO/clipes/issues/484)).

### Alterado

- Aplicativo desktop (`src-tauri/tauri.conf.json`) passa a embutir `front-v2/dist` por padrão ([#374](https://github.com/GUSTAVOHOOO/clipes/issues/374), [#377](https://github.com/GUSTAVOHOOO/clipes/issues/377)), mantendo a interface v1 (`src/` e `design-system/`) intacta no repositório como caminho de reversão documentado.
- Suíte E2E real no Tauri (`tauri-driver` + WebdriverIO), validação no Linux (`scripts/linux-validation.mjs`) e smoke de pacotes `.exe`, `.AppImage` e `.deb` migrados para o `front-v2` ([#375](https://github.com/GUSTAVOHOOO/clipes/issues/375), [#376](https://github.com/GUSTAVOHOOO/clipes/issues/376), #441).

### Corrigido

- Bloqueio explícito de janela `uncertain` em `selection.resume` (#372) e curto-circuito de chamadas canceladas de provedor (#335).
- Remoção do evento residual com `job_id` 0 em `narration.record_block` (#486).
- Restauração do tema escuro no E2E em Ubuntu (#506) e determinismo de `sources_delete` em testes do núcleo (#432).

## [1.0.0] - 2026-11-18

Primeira versão estável do Clipes com a interface atual ("Foco") ligada ao núcleo completo da v1. Veja as notas completas em [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md).

### Adicionado

- Aplicativo desktop Tauri 2 com núcleo em Rust, fila de jobs persistida em SQLite, Projetos portáteis, backup rotativo e restauração verificada.
- Download sob demanda de FFmpeg, `yt-dlp`, `deno`, `uv` e modelos de transcrição/TTS com retomada HTTP e verificação SHA-256.
- Importação de Fontes locais ou por URL (`yt-dlp`), com registro e edição da Permissão do criador e processamento em Lote de Fontes.
- Transcrição local em blocos com `faster-whisper` (detecção automática de GPU NVIDIA/CPU, VAD e checkpoints) e opção remota via Groq com confirmação explícita.
- Camada agnóstica de Provedores de IA (OpenAI, Anthropic, Gemini, Ollama e CLIs experimentais Codex, Claude Code e OpenCode), orçamento por tarefa e lote, trilha de auditoria e modo "Somente local".
- Seleção de Cortes em Janelas com energia do áudio, replay de chat do YouTube e Nota explicável; editor com preview por proxy, timeline, remoção de silêncios, legenda karaokê editável e reenquadramento 9:16 com 5 Layouts e keyframes de crop.
- Fluxo de Vídeo transformado (ângulo, Roteiro em blocos travado antes da Narração, Pocket TTS local, gravação com teleprompter, importação de áudio, ducking e trilha sonora), Empacotamento (título, descrição, tags, capa e capítulos), tradução PT-BR ↔ EN, Perfil de canal e guarda-corpos de monetização.
- Exportação individual e em lote com FFmpeg e libass, detecção de encoder com fallback `x264` e loudnorm em duas passagens, com aviso quando o encoder de hardware cai para x264 (#321).
- Instaladores Windows (NSIS) e Linux (AppImage e `.deb`), updater assinado, relatos de problemas sem telemetria e checagem de licenças/advisories no CI.
