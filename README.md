# Clipes

Gerador open source de cortes de lives e vídeos. A transcrição roda na sua máquina, a IA fica por sua conta (API, modelo local ou CLI de assinatura) e nada sai do computador sem aviso.

> **Estado:** pré-v1, em desenvolvimento ativo. A infraestrutura está pronta, mas o fluxo que gera Cortes de ponta a ponta ainda não existe. Veja [Estado atual](#estado-atual).

Para desenvolver, leia o [guia de contribuição](CONTRIBUTING.md). Os termos do projeto estão no [glossário](GLOSSARY.md) e as decisões de arquitetura em [`docs/adr/`](docs/adr/).

## O que é

Quem tem um Canal de cortes ou um Canal dark hoje depende de serviços pagos por minuto, que sobem a Fonte inteira para a nuvem, dão uma nota opaca e colocam marca d'água. O Clipes é a alternativa local, aberta e sem marca d'água.

O usuário abre um **Projeto** por canal, importa uma **Fonte** (arquivo local ou VOD por URL, com Permissão registrada) e o app:

1. transcreve localmente, por palavra, usando a GPU quando há;
2. pede ao Provedor escolhido que aponte os melhores momentos, com uma Nota explicável e o custo visível antes e depois;
3. ajusta as bordas de cada Corte por Frase inteira, sugere o reenquadramento 9:16 e gera legenda karaokê por palavra;
4. deixa o usuário revisar tudo num editor focado;
5. exporta em lote com FFmpeg e libass.

Há dois tipos de vídeo, escolhidos antes da produção ([ADR-0001](docs/adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md)):

- **Corte direto**, para Canais de cortes: automático e rápido.
- **Vídeo transformado**, para Canais dark: um Corte com Roteiro revisado bloco a bloco e Narração (TTS local, gravação ou áudio importado).

Cada vídeo sai com Empacotamento sugerido e editável: título, descrição com crédito da Fonte, tags, hashtags, ideia de thumbnail e capítulos, em PT-BR ou EN.

## Princípios

- **Local-first.** Tudo roda offline depois dos downloads, exceto Provedor por API e importação por URL.
- **Agnóstico de Provedor de IA.** Há perfis múltiplos, uma Tarefa de IA aponta para um perfil, e não existe fallback automático. O "somente local" pode vetar qualquer envio externo por Projeto.
- **Consentimento e custo visíveis.** Nada é baixado sem confirmação. O custo é estimado antes, medido depois e limitado por orçamento. Uma chamada paga com resultado incerto nunca é repetida às cegas.
- **Sem telemetria.** Problemas são relatados por uma issue que o usuário revisa antes de enviar ([ADR-0006](docs/adr/0006-relato-de-problemas-sem-telemetria.md)).
- **Projeto portátil.** Uma pasta por canal, com SQLite, que dá para levar para outro computador ([ADR-0005](docs/adr/0005-projeto-portatil-com-sqlite.md)).

## Stack

Definida no [ADR-0004](docs/adr/0004-stack-tauri-react-nucleo-rust-worker-python.md).

| Camada | Tecnologia | Pasta |
|---|---|---|
| Casca do app | Tauri 2 | `src-tauri/` |
| Interface | React, TypeScript, Bun | `src/` |
| Núcleo | Rust (Projeto, fila, Provedores, Componentes) | `core/` |
| Transcrição e ML | Worker Python via `uv`, protocolo JSON lines | `worker/` |
| Render | FFmpeg + libass, baixado sob demanda | |

Outras pastas: [`design-system/`](design-system/) (demo do design system Foco), [`benchmarks/`](benchmarks/) (dataset de VODs e benchmark de transcrição), [`tools/`](tools/) e [`docs/research/`](docs/research/) (pesquisas que embasam as decisões).

## Estado atual

Atualizado em 15/11/2026. O plano completo vive na issue [#26](https://github.com/GUSTAVOHOOO/clipes/issues/26) (spec da v1) e no mapa [#1](https://github.com/GUSTAVOHOOO/clipes/issues/1). O trabalho avança em ondas de tickets, cada um num PR.

### Pronto

**Fundação e distribuição**
- Esqueleto do app, harness do núcleo e CI em Ubuntu e Windows, com checagem de DCO.
- Instaladores e release por tag (NSIS no Windows, AppImage e `.deb` no Linux) e updater assinado.
- Componentes sob demanda (FFmpeg e yt-dlp) com SHA-256 fixo, cache com limite e escolha de disco.
- CI de licenças e vulnerabilidades das dependências (cargo-deny e verificação em JS e Python).
- Repositório pronto para contribuição, com formulários de issue e [`SECURITY.md`](SECURITY.md).
- Relato de problemas e exportação de diagnóstico, sem telemetria.

**Design system Foco**
- Tokens OKLCH em tema escuro e claro, primitivas sobre Base UI e galeria de componentes.
- Telas de Fontes, Cortes, Editor (preview, timeline, legenda karaokê), Transformar, Narração, Empacotar, Exportar e Configurações.
- A casca Foco já está no app, com PT-BR e EN e testes de UI. A demo interativa fica em [`design-system/`](design-system/README.md).

**Projeto e Fontes**
- Projeto portátil em SQLite, com backup rotativo e restauração verificada.
- Importação de Fonte local com Permissão e identificação por tamanho, data e hash parcial.
- Importação por URL com yt-dlp, atualizado só com assinatura verificada.
- Fila de jobs persistida, com waveform e miniaturas.

**Provedores de IA**
- Adaptadores OpenAI-compatível, Anthropic, Gemini e Ollama nativo (com contexto explícito por chamada).
- CLIs Codex e Claude Code, isolados e marcados como experimentais.
- Perfis de Provedor múltiplos, Tarefa de IA com prompt versionado e verificadores, e Tarefa → perfil por regra fixa.
- Executor de jobs de IA na fila, com cancelamento.
- Custo por chamada, tabela de preços verificada, orçamento por tarefa e por lote.
- "Somente local" por tarefa e como veto por Projeto.
- Assistente de primeira execução que detecta Ollama, LM Studio e CLIs.

**Transcrição**
- Worker Python instalado via `uv`, com protocolo JSON lines.
- Transcrição local em blocos com checkpoint e retomada (faster-whisper turbo). Na RTX 3050, o RTF medido foi 0,386.
- Transcrição dividida em Frases navegáveis.
- Benchmark de transcrição e de bordas de palavra. Os timestamps nativos do modelo foram considerados suficientes.

### Em andamento

| Ticket | O que é |
|---|---|
| [#51](https://github.com/GUSTAVOHOOO/clipes/issues/51) | Motor de transcrição remoto (Groq), com VAD, consentimento e checkpoints pagos |
| [#135](https://github.com/GUSTAVOHOOO/clipes/issues/135) | Provedor via CLI OpenCode (teste real pendente: cota gratuita esgotada) |
| [#140](https://github.com/GUSTAVOHOOO/clipes/issues/140) | Formato compacto de Frases e estimador de tokens por perfil |
| [#141](https://github.com/GUSTAVOHOOO/clipes/issues/141) | Catálogo de modelos e custo por faixa de tokens de entrada |

### Próximo

**Cadeia de contexto, antes da seleção de Cortes:** descoberta do contexto efetivo por perfil (#143), planejador de Janelas com teto de 15 minutos (#144), detecção de truncamento (#145), avisos e diagnóstico (#146), limites de saída e timeout por perfil (#147), experimento de janelas (#148) e detecção de hardware (#50).

**Seleção e edição de Cortes**
- Pipeline de seleção de Cortes (#53), energia do áudio (#54), revisão dos candidatos (#55), lote com teto de custo (#56) e benchmark (#57).
- Preview com proxy (#58), export com legenda karaokê (#59), timeline (#61), encoder (#62), loudness (#63) e export em lote (#64).
- Reenquadramento 9:16 (#60, #66, #78), remoção de silêncios (#77) e correção e busca na Transcrição (#52).

**Vídeo transformado**
- Roteiro em blocos com aprovação (#73) e ângulo do vídeo (#153).
- Narração por TTS (#79), gravação com teleprompter (#83) e importação de áudio (#84).
- Ducking (#82), trilha e efeitos importados (#154) e limpeza de voz (#155).

**Empacotamento e qualidade**
- Título, descrição e tags (#68), thumbnail (#74), tradução de legenda (#75) e capítulos (#80).
- Guarda-corpos de monetização e originalidade (#76), Perfil de canal (#72) e validação no Linux (#69).
- Teste de contrato com Provedores reais (#122), chat da live como sinal de seleção (#151) e importação só áudio (#152).

## Requisitos

- Windows 10 ou superior, ou Linux. A validação no Linux ainda está pendente (#69).
- Uma GPU NVIDIA acelera a transcrição. Sem ela, o app roda em CPU e avisa que vai demorar: no teste, um modelo pequeno em CPU levou cerca de 2,5 vezes a duração do áudio.
- Para a IA, qualquer um destes: chave de API, modelo local (Ollama, LM Studio, llama.cpp) ou uma assinatura via Codex CLI.

## Instalação

Baixe o instalador para seu sistema na página de [releases](https://github.com/GUSTAVOHOOO/clipes/releases). No Windows, o instalador NSIS instala o Clipes para o usuário atual, sem exigir administrador, e baixa o bootstrapper do WebView2 se necessário. No Linux estão disponíveis AppImage e `.deb`. Os instaladores não incluem FFmpeg, Python ou modelos: os componentes são obtidos separadamente pela tela de Componentes.

No Linux, o pacote `.deb` já declara as dependências GStreamer para o preview (`gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad` e `gstreamer1.0-libav`). O **AppImage** não embute GStreamer nem `libav` (`bundleMediaFramework: false`, conforme o [ADR-0003](docs/adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)) e depende dos codecs do sistema hospedeiro; em Debian/Ubuntu sem esses pacotes, instale:

```sh
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

O beta do Windows ainda não tem assinatura de código. Por isso, o Microsoft Defender SmartScreen pode avisar que o aplicativo é desconhecido. Confira a origem e o SHA-256 do arquivo com o `SHA256SUMS.txt` publicado na release; se confiar no arquivo, escolha **Mais informações** e depois **Executar assim mesmo** no aviso. No PowerShell, calcule o hash com `Get-FileHash .\<instalador.exe> -Algorithm SHA256`.

## Desenvolvimento

```sh
bun install
bun run tauri dev
```

Os pré-requisitos (Rust estável, Bun e dependências do Tauri) e as verificações antes de um PR estão no [guia de contribuição](CONTRIBUTING.md). Guias por área:

- [Provedor](docs/contribuindo/provedor.md)
- [Motor de transcrição](docs/contribuindo/motor-de-transcricao.md)
- [Tarefa de IA](docs/contribuindo/tarefa-de-ia.md)
- [OpenCode](docs/contribuindo/opencode.md)

Issues, tickets e o mapa do projeto ficam no [GitHub Issues](https://github.com/GUSTAVOHOOO/clipes/issues).

## Publicação de uma release

Após integrar o fluxo e ajustar as versões do aplicativo para a versão desejada, o mantenedor cria e envia uma tag no commit a publicar, por exemplo `git tag v0.1.0` e `git push origin v0.1.0`. A execução de **Instaladores e release** gera os três instaladores, cria `SHA256SUMS.txt` e publica uma release com notas geradas pelo GitHub. Pull requests executam somente os builds e disponibilizam os instaladores como artefatos do Actions, sem criar release.

As atualizações usam pacotes assinados do Tauri. Para gerar e proteger o par de chaves, configurar os secrets `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` e definir a chave pública, siga [o guia de contribuição](CONTRIBUTING.md#chave-do-updater). O app mostra a versão e as notas e só baixa a atualização depois da confirmação.

## Licença

[Apache-2.0](LICENSE). As dependências e os modelos seguem a política do [ADR-0003](docs/adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md), e os avisos de terceiros estão em [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
