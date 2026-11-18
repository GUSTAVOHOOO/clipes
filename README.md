# Clipes

**Transforma lives e vídeos longos em vídeos curtos prontos para postar, direto no seu computador.**

O Clipes é um app de desktop gratuito e open source. Você dá a ele uma live de 4 horas e ele acha os melhores momentos, corta, coloca legenda palavra por palavra, ajusta para o formato vertical (9:16) e exporta. Tudo roda na sua máquina, sem marca d'água, sem assinatura e sem mandar seu vídeo para a nuvem.

> **Status: v1 lançada.** A primeira versão está disponível em [releases](https://github.com/GUSTAVOHOOO/clipes/releases). A v2 (interface nova, refeita do zero sobre o mesmo núcleo) está em construção — acompanhe na issue [#288](https://github.com/GUSTAVOHOOO/clipes/issues/288) e veja [Em que pé estamos](#em-que-pé-estamos).

## Por que existe

Serviços como Opus Clip e Vizard cobram por minuto, sobem o vídeo inteiro para a nuvem, dão uma nota que ninguém sabe explicar e colocam marca d'água. Numa live longa, o custo e a espera crescem rápido. Quem tem um computador comum, sem GPU potente, fica sem opção.

O Clipes tenta ser a alternativa aberta:

- **Roda no seu PC.** A transcrição é local. Seu vídeo não sai da máquina.
- **Você escolhe a IA.** Use uma chave de API (OpenAI, Anthropic, Gemini), um modelo local (Ollama, LM Studio) ou a assinatura que você já tem (Codex CLI). O app não depende de nenhum provedor.
- **Sem surpresa de custo.** O app mostra o custo estimado antes e o real depois, e para quando chega no teto que você definiu.
- **Sem telemetria.** Nada é enviado sem você ver e confirmar.
- **Sem marca d'água.** O render usa FFmpeg e libass.

## Para quem é

Dois tipos de canal, com dois tipos de vídeo:

| Tipo de vídeo | Para quem | Como funciona |
|---|---|---|
| **Corte direto** | Canais de cortes | Automático e rápido: pega os melhores momentos de uma live e corta. |
| **Vídeo transformado** | Canais dark | Um Corte com Roteiro próprio revisado por você e Narração (voz sintética, gravada ou importada). Nunca é 100% automático, para evitar conteúdo em massa. |

## Como funciona

1. Você cria um **Projeto** (um por canal) e importa uma **Fonte**: um arquivo local ou um link de VOD.
2. O app **transcreve** o áudio na sua máquina, palavra por palavra.
3. A IA que você escolheu **aponta os melhores momentos** e dá uma nota explicada para cada um.
4. O app ajusta as bordas do corte para não cortar uma frase no meio e gera a **legenda karaokê**.
5. Você **revisa no editor**: preview, timeline, transcrição clicável e enquadramento 9:16 (com sugestão automática ou ajuste manual).
6. **Empacota e exporta** um corte por vez ou em lote, com título, descrição e tags sugeridos (em PT-BR ou EN; capítulos automáticos no Vídeo transformado).

## Em que pé estamos

Atualizado em 18/11/2026. O plano da v1 está na issue [#26](https://github.com/GUSTAVOHOOO/clipes/issues/26).

### O que a v1 traz

**A base do app**
- Aplicativo desktop com instaladores para Windows e Linux (validados no CI) e atualização assinada.
- Download sob demanda de FFmpeg, yt-dlp, deno e Pocket TTS, com verificação de integridade. Nada é baixado sem você confirmar.
- Checagem automática de licenças e vulnerabilidades das dependências.

**O design system "Foco"**
- Interface em tema escuro e claro, em PT-BR e EN, com atalhos de teclado.
- Fluxos de Projetos, Fontes, Cortes, Editor, Roteiro e Narração, Empacotamento, Exportação, Componentes, Preferências e Relatos.
- Há uma [demo interativa](design-system/README.md) que roda no navegador, com dados de exemplo.

**Projetos e Fontes**
- Um Projeto é uma pasta portátil com um banco SQLite, que você pode levar para outro computador.
- Backup automático rotativo e restauração verificada.
- Importação de vídeo local ou por link (yt-dlp), com registro e edição da Permissão do streamer e processamento em lote.
- Fila de tarefas que continua de onde parou se o app fechar.

**Transcrição**
- Roda no seu PC com faster-whisper, detectando GPU NVIDIA ou CPU automaticamente. Numa RTX 3050 ficou mais rápida que o tempo real.
- Opção de transcrição remota pelo Groq (envia só o áudio, com estimativa de custo e confirmação).
- Trabalha em blocos com checkpoint, divide em frases navegáveis e tem correção e busca na transcrição.
- Medida contra um conjunto de VODs reais, em português e inglês.

**IA e provedores**
- Funciona com OpenAI, Anthropic, Gemini, Ollama, qualquer endpoint compatível com OpenAI e os CLIs Codex, Claude Code e OpenCode (experimentais).
- Perfis de provedor, catálogo de modelos com faixas de preço, formato compacto das frases, custo por chamada, orçamento por tarefa e por lote, trilha de auditoria e modo "somente local" por tarefa e por Projeto.
- Uma chamada paga com resultado incerto nunca é repetida às cegas.

**Seleção de Cortes, editor e exportação**
- Seleção de Cortes com janelas ajustadas ao contexto do modelo, energia do áudio, replay de chat do YouTube e nota explicável, com revisão de candidatos e opção de refazer com outro perfil.
- Editor com preview por proxy, timeline, ajuste de bordas, remoção de silêncios, legenda karaokê personalizável e reenquadramento 9:16 (YuNet, layouts e crop manual).
- Exportação individual e em lote com FFmpeg e libass, loudness em duas passagens e detecção de encoder (NVENC, QSV, AMF, VideoToolbox e x264).

**Vídeo transformado e Empacotamento**
- Escolha de ângulo, Roteiro em blocos com trava antes da narração, Narração (Pocket TTS local, gravação com teleprompter ou áudio importado), alinhamento por palavra, redução automática do volume da Fonte (ducking), trilha sonora e efeitos.
- Empacotamento (título, descrição, tags, ideia de thumbnail/capa, capítulos), tradução de legenda (PT-BR ↔ EN), Perfil de canal e guarda-corpos de monetização antes de exportar.

### v2: em construção

A v2 é a nova interface do Clipes, refeita do zero a partir do [catálogo de funcionalidades](docs/produto/funcionalidades.md) do núcleo, sem mudar o que o núcleo faz. A especificação e o progresso ficam na issue [#288](https://github.com/GUSTAVOHOOO/clipes/issues/288).

- **Fases já concluídas:**
  - Levantamento do núcleo ([funcionalidades](docs/produto/funcionalidades/)).
  - Pesquisa de UX ([mapa total](docs/research/2026-11-17-ux-mapa-total.md) e estudos `2026-11-17-ux-*.md` em [docs/research/](docs/research/)).
  - Arquitetura de informação e telas ([arquitetura](docs/produto/front-v2/01-arquitetura.md), [consolidação](docs/produto/front-v2/02-consolidacao.md) e [telas](docs/produto/front-v2/telas/)).
  - [Wireframes navegáveis](docs/produto/front-v2/wireframes/) e [direção visual](docs/produto/front-v2/03-direcao-visual.md) (minimalista, grafite com um laranja, referências Linear e Raycast).
- **Em andamento e próximos passos:** novo design system, tickets de ajuste do núcleo ([#289](https://github.com/GUSTAVOHOOO/clipes/issues/289)–[#307](https://github.com/GUSTAVOHOOO/clipes/issues/307)) e implementação da interface por ondas.

O que fica para depois da v1 — incluindo clonagem de voz ([#214](https://github.com/GUSTAVOHOOO/clipes/issues/214)) e servidor MCP ([#192](https://github.com/GUSTAVOHOOO/clipes/issues/192)) — está em [melhorias futuras](docs/futuro.md).

## Tecnologias

| Para quê | O que usamos |
|---|---|
| Aplicativo desktop | [Tauri 2](https://tauri.app/): leve e usa o navegador do sistema |
| Interface | React, TypeScript e Bun, com componentes Base UI e cores em OKLCH |
| Núcleo do app | Rust: Projetos, fila de tarefas, provedores de IA e componentes |
| Transcrição e modelos de ML | Python (gerenciado pelo `uv`) com faster-whisper e YuNet; Pocket TTS para narração |
| Armazenamento | SQLite, uma pasta portátil por Projeto |
| Vídeo | FFmpeg e libass para o render e as legendas |
| Importação por link | yt-dlp, com atualização verificada por assinatura |
| Automação | GitHub Actions: build, licenças, vulnerabilidades e release |

As decisões e os motivos estão nos [ADRs](docs/adr/). O vocabulário do projeto, como Fonte, Corte e Projeto, está no [glossário](GLOSSARY.md).

### Mapa das pastas

| Pasta | Conteúdo |
|---|---|
| `src/` | Interface do app (React) |
| `src-tauri/` | Casca Tauri |
| `core/` | Núcleo em Rust |
| `worker/` | Worker Python de transcrição |
| `design-system/` | Demo do design system |
| `benchmarks/` | Dataset de VODs e benchmark de transcrição |
| `docs/produto/` | Funcionalidades do núcleo e especificação do front v2 |
| `docs/` | ADRs, pesquisas e guias |

## Instalação

Baixe o instalador na página de [releases](https://github.com/GUSTAVOHOOO/clipes/releases). No Windows, o instalador NSIS instala para o usuário atual, sem exigir administrador. No Linux há AppImage e `.deb`. Os instaladores não incluem FFmpeg, Python nem modelos: você os baixa pela tela de Componentes, vendo o tamanho e a licença de cada um.

No Linux, o pacote `.deb` já declara as dependências GStreamer para o preview (`gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad` e `gstreamer1.0-libav`). O **AppImage** não embute GStreamer nem `libav` (`bundleMediaFramework: false`, conforme o [ADR-0003](docs/adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)) e depende dos codecs do sistema hospedeiro; em Debian/Ubuntu sem esses pacotes, instale:

```sh
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

O instalador do Windows ainda não tem assinatura de código (a assinatura gratuita para projetos open source pela SignPath Foundation é planejada, sem data definida — veja a issue [#24](https://github.com/GUSTAVOHOOO/clipes/issues/24)). Por isso, o Microsoft Defender SmartScreen pode avisar que o aplicativo é desconhecido. Confira a origem e o SHA-256 do arquivo com o `SHA256SUMS.txt` publicado na release; se confiar no arquivo, escolha **Mais informações** e depois **Executar assim mesmo** no aviso. No PowerShell, calcule o hash com `Get-FileHash .\<instalador.exe> -Algorithm SHA256`.

## Quer ajudar?

```sh
bun install
bun run tauri dev
```

Precisa de Rust (estável), Bun e os [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/). O [guia de contribuição](CONTRIBUTING.md) explica o resto, incluindo o DCO (`git commit -s`). Há também guias para [Provedor](docs/contribuindo/provedor.md), [Motor de transcrição](docs/contribuindo/motor-de-transcricao.md), [Tarefa de IA](docs/contribuindo/tarefa-de-ia.md) e [OpenCode](docs/contribuindo/opencode.md).

Achou um bug ou tem uma ideia? Abra uma [issue](https://github.com/GUSTAVOHOOO/clipes/issues/new/choose). Dúvidas de uso vão em [Discussions](https://github.com/GUSTAVOHOOO/clipes/discussions). Vulnerabilidades seguem o [SECURITY.md](SECURITY.md).

## Para mantenedores: publicar uma release

Depois de ajustar as versões do app, crie e envie uma tag no commit a publicar, por exemplo `git tag v0.1.0` e `git push origin v0.1.0`. O fluxo **Instaladores e release** gera os três instaladores, cria o `SHA256SUMS.txt` e publica a release. Pull requests só fazem os builds e deixam os instaladores como artefatos do Actions.

As atualizações usam pacotes assinados do Tauri. Para gerar o par de chaves e configurar os secrets `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, siga o [guia de contribuição](CONTRIBUTING.md#chave-do-updater).

## Licença

[Apache-2.0](LICENSE). As dependências e os modelos seguem a política do [ADR-0003](docs/adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md), e os avisos de terceiros estão em [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
