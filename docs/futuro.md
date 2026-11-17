# Melhorias futuras

O que ficou fora da v1 e pode entrar depois. A lista vem da seção "Out of Scope" e das "Further Notes" da spec ([#26](https://github.com/GUSTAVOHOOO/clipes/issues/26)). Este arquivo é o lugar para consultar e acrescentar ideias; a spec continua sendo a fonte do que a v1 promete.

Cada item diz o que é e, quando o repo registra, por que ficou de fora. Itens sem motivo registrado ficaram de fora só por escopo.

Antes de implementar algo daqui, abra uma issue com `needs-triage`. Os termos usados seguem o [GLOSSARY.md](../GLOSSARY.md).

## Edição e imagem

- **B-roll, busca por prompt e análise multimodal.** Imagens de cobertura (stock, geradas ou de outro trecho) inseridas sobre a Fonte. Ver B-roll no glossário. A pesquisa do Opus Clip aponta o B-roll por IA como ponto fraco do concorrente ([inventário](research/2026-11-12-opusclip-feature-inventory.md)).
- **Remoção de muletas.** Cortar "é", "tipo", "né" e similares da fala.
- **Seguir o corpo e layouts com três ou mais pessoas.** A v1 reenquadra por rosto e tem cinco Layouts.
- **Diarização e detecção automática de quem está falando.** O campo de falante já está reservado na Transcrição.
- **HyperFrames como plugin opcional de efeitos.** O render da v1 é FFmpeg + libass ([ADR-0002](adr/0002-hyperframes-como-referencia-render-ffmpeg-libass.md)).
- **Geração de imagem de thumbnail.** A v1 só sugere a ideia no Empacotamento.

## Tipos de vídeo

- **Vídeo sem Fonte, feito do zero.** Precisa de grilling e ADR próprio: conflita com a regra 7 do [ADR-0001](adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md), pesa na máquina-alvo e esbarra na política de modelos do ADR-0003.
- **Compilação e vídeo longo a partir de vários Cortes.**
- **Corte em tempo real durante a live.** A v1 é só VOD.

## Seleção e inteligência

- **Pesos da Nota por Perfil de canal e calibração automática.** A v1 já registra aprovações e rejeições só localmente, para permitir isso depois.
- **Chat de Twitch e Kick como sinal de seleção.** A v1 só lê o replay de chat do YouTube.
- **Tendências e predição de potencial.**
- **Agente com ferramentas no Provedor** (estilo "coach" do vidIQ) e **Gemini CLI**. Hoje a Tarefa de IA é um workflow fixo, nunca um agente.

## Fluxo de canal

- **Publicação direta nas redes e dublagem.** A v1 exporta os arquivos e o usuário publica.
- **Descoberta de Fontes, controle de repetição por canal, ciclo Corte → resultado, registro de claims e campanhas de clipping.**

## Plataforma e distribuição

- **whisper.cpp (Vulkan/Metal) e aceleração AMD/Intel na transcrição.**
- **Pacote offline, notarização no macOS e `.dmg` no primeiro lançamento.** O `.dmg` vem depois.
- **Criação de issue pela API do GitHub e qualquer telemetria.** A v1 não tem telemetria; o relato de bug é revisado pelo usuário.
- **Servidor MCP para agentes externos comandarem o Clipes** ([#192](https://github.com/GUSTAVOHOOO/clipes/issues/192)). Expor os comandos do núcleo a agentes como Claude Code e Codex. Fica para a v2.

## Experimentos que dependem de benchmark ou verificação

Não são promessa da v1 e não a bloqueiam.

- **Parakeet TDT 0.6B v3** como desafiante em CPU, só no benchmark.
- **Piper** como segundo motor de TTS, só depois de revisar a licença de cada voz.
- **Clonagem de voz na Narração** ([#214](https://github.com/GUSTAVOHOOO/clipes/issues/214)), por exemplo com Qwen3-TTS 0.6B. Experimental, consentida, e só se couber em 4 GB de VRAM. No teste de 16/11, o clone da voz do dev com o Pocket TTS ficou estranho. Fica para a v2.
- **TTS por API paga** (Google Neural2, com ElevenLabs como alternativa). Recomendado na pesquisa do #18, não fechado em grilling.
- **Claude Code CLI** segue experimental até a Anthropic confirmar por escrito o uso pelo Clipes.
- **Validação multiplataforma.** O protótipo do #15 rodou só no Windows; falta WebKitGTK no Linux e WKWebView no macOS.
