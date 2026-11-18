# Changelog

Todas as mudanças relevantes do Clipes serão documentadas neste arquivo.

O formato segue o padrão [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

- Interface v2 em construção ([#288](https://github.com/GUSTAVOHOOO/clipes/issues/288)).

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
