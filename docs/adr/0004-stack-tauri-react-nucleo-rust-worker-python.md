---
status: accepted
---

# Stack: Tauri 2 + React, núcleo Rust dono de tudo e um worker Python sob demanda

O Clipes é um app **Tauri 2** com a UI em **React + TypeScript**. O **Bun** é o gerenciador de pacotes e roda os scripts de desenvolvimento. O app distribuído não leva o Bun: no final, ficam só o binário Rust e o WebView do sistema. Decisão do dev em 12/11/2026, no grilling do [#14](https://github.com/GUSTAVOHOOO/clipes/issues/14). Ela se baseia no protótipo do [#15](https://github.com/GUSTAVOHOOO/clipes/issues/15) e nas pesquisas do [#18](https://github.com/GUSTAVOHOOO/clipes/issues/18) (TTS) e do [#20](https://github.com/GUSTAVOHOOO/clipes/issues/20) (reenquadramento).

O protótipo provou que o Tauri 2 com WebView2 dá conta do editor. A condição é que o preview use um **proxy de GOP curto, gerado automaticamente por Corte**. Com a busca direta numa Fonte de 2 h, o preview fica em ~277 ms. Com o proxy, cai para ~33 ms. Electron é desnecessário.

## Três camadas

1. **Núcleo Rust**, que é dono de tudo o que tem efeito:
   - os dados locais (o formato está no [#23](https://github.com/GUSTAVOHOOO/clipes/issues/23));
   - a fila de trabalhos;
   - as chamadas a FFmpeg e yt-dlp como executáveis separados, via `std::process::Command` e sem shell;
   - o cofre de chaves do sistema;
   - a **camada de Provedor**.
2. **UI React**, que só exibe e edita. Ela pode enviar a chave ao núcleo na entrada, mas nunca lê chaves e nunca abre processos. Fala com o núcleo por comandos do Tauri, e a mídia chega por um protocolo próprio com suporte a Range (no Linux, por servidor HTTP loopback autenticado — ver emenda ao final).
3. **Um único worker Python ("worker de ML")**, que roda:
   - o faster-whisper (transcrição);
   - o Kokoro (TTS), de preferência via ONNX Runtime e sem PyTorch, se o benchmark confirmar;
   - o YuNet (reenquadramento).

   Ele carrega **um modelo por vez**, numa fila fixa (transcrição → reenquadramento → TTS → render), e libera cada um antes do próximo. Isso permite dividir os 4 GB de VRAM da máquina-alvo. O núcleo fala com o worker por **JSON lines no stdin/stdout**, com versão do protocolo, progresso, cancelamento e erros tipados.

## Como cada peça chega na máquina

- O **Python não vai no instalador.** Ele é baixado sob demanda via `uv`, como um Python standalone com um ambiente isolado só do Clipes. As libs de CUDA só vêm se houver GPU NVIDIA. O Python do sistema nunca é usado. Segue a mesma lógica do FFmpeg ([ADR-0003](0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)).
- O **encoder do export** é detectado e testado na primeira execução, e o resultado vai para cache. A ordem é NVENC, QSV, AMF, VideoToolbox e, por fim, x264 como fallback garantido.

## Camada de Provedor com adaptadores próprios

Os adaptadores HTTP são nossos e ficam no Rust. A decisão original previa três formatos (ver a emenda ao final para o Ollama):
- Anthropic;
- compatível com OpenAI, que cobre OpenAI, OpenRouter, Ollama e qualquer endpoint compatível;
- Gemini.

O Codex entra como subprocesso. As chaves ficam no cofre e a UI nunca as lê. A validação do JSON e o teto de custo por lote ficam num lugar só, e as chamadas estruturadas e simples do [#13](https://github.com/GUSTAVOHOOO/clipes/issues/13) não precisam de uma biblioteca grande.

## Opções consideradas

- **Electron:** desnecessário depois do protótipo. Pesaria mais no instalador e na RAM.
- **Svelte ou Solid na UI:** são mais leves, mas o React tem mais componentes prontos para vídeo e timeline, e é onde os agentes de código erram menos.
- **Python empacotado no instalador (PyInstaller):** deixaria o instalador pesado e ainda levaria as libs de CUDA para quem não tem GPU NVIDIA.
- **Um processo Python por modelo:** isola melhor, mas multiplica runtimes e não resolve a VRAM, que já exige a fila sequencial.
- **AI SDK na UI:** exporia as chaves ao WebView.
- **LiteLLM no worker Python:** poria as chaves e o custo no processo de ML e traria uma dependência grande para três formatos de API.

## Emenda de 14/11/2026: adaptador nativo do Ollama como quarto formato HTTP

Decisão do dev em 14/11/2026, a partir da [pesquisa de lives longas e contexto (#115)](https://github.com/GUSTAVOHOOO/clipes/issues/115). A camada de Provedor passa a permitir **um quarto formato HTTP, exclusivo do Ollama**: `/api/chat` com `options.num_ctx` explícito por chamada. O padrão de 4 mil tokens na máquina-alvo pode cortar a Transcrição em silêncio; a API compatível com OpenAI não permite definir esse contexto por requisição.

O adaptador é próprio, no núcleo Rust, e usa o contexto efetivo do Perfil de Provedor para definir `num_ctx`. O máximo anunciado pelo modelo não prova quanto contexto foi carregado: o núcleo descobre e confere o limite da configuração usada. O tipo `ollama` estende a lista de tipos de Perfil de Provedor do [ADR-0010](0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md).

É uma exceção para controlar o contexto do Ollama, não uma abertura para formatos nativos de outros servidores. LM Studio, llama.cpp e os demais endpoints compatíveis continuam no formato OpenAI. Valem os mesmos contratos de saída e validação, custo, cancelamento, consentimento e "Somente local"; local continua sendo só loopback. Não há troca automática de Provedor.

## Emenda de 16/11/2026: Pocket TTS como Componente executável no lugar do Kokoro no worker

Decisão do dev em 16/11/2026, a partir do [spike #207](../research/2026-11-16-pocket-tts.md) (PR #212) e da [pesquisa de 24 camadas](../research/2026-11-16-tts-24-camadas.md) (PR #229). O TTS da Narração deixa de rodar como tarefa do worker Python (Kokoro/ONNX Runtime) e passa a usar o **binário Rust oficial `pocket-tts`** (MIT) como **Componente executável** chamado diretamente pelo núcleo via `core::process::spawn_managed` (sem shell), com pesos baixados do mirror sem gate `kyutai/pocket-tts-without-voice-cloning` (CC-BY-4.0) e embeddings de voz prontos em `.safetensors`.

Motivos:
- evita trazer PyTorch (~740 MiB–2,9 GiB) para o worker Python, preservando o ambiente enxuto do worker para `faster-whisper` e `onnxruntime` (YuNet);
- o binário oficial já inclui o modelo PT-BR (`portuguese_24l` padrão e `portuguese` 6L leve) e o modelo inglês (`english`), roda em CPU sem exigir GPU NVIDIA e aceita configuração e embeddings locais sem rede em tempo de geração;
- reutiliza o fluxo existente de Componentes (SHA-256 fixado, licença e termo de uso exibidos antes do download, sem login nem token HF).

O worker Python continua exclusivo para transcrição (`faster-whisper`), VAD/sonda e reenquadramento (`onnxruntime` / YuNet).

## Emenda de 17/11/2026: servidor HTTP loopback para mídia no Linux (WebKitGTK)

Decisão registrada a partir da [validação automatizada no Linux (#69)](../research/2026-11-17-validacao-linux.md) e do [#246](https://github.com/GUSTAVOHOOO/clipes/issues/246). O protocolo próprio `clipes-media` com suporte a `Range` continua válido no **Windows** (WebView2, onde `convertFileSrc` vira `http://clipes-media.localhost/...`) e no **macOS** (WKWebView). No **Linux**, o esquema customizado `clipes-media://` não é reproduzível pelo backend de vídeo do WebKitGTK:

- **Evidência (#69, `libwebkit2gtk-4.1-0` 2.52.6, GStreamer `1.28.2`):** com `gstreamer1.0-libav` e `gstreamer1.0-plugins-bad` instalados, `video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')` retorna `"probably"` e `fetch('clipes-media://localhost/proxy%2F...')` recebe HTTP `206` OK, mas `<video src="clipes-media://...">` falha imediatamente em `MediaPlayerPrivateGStreamer.cpp:1554:loadingFailed` com `FormatError` (`video.error.code = 4`, `MEDIA_ERR_SRC_NOT_SUPPORTED`).
- **Evidência com loopback:** servindo o mesmo `proxy.mp4` (960×540, 250 s, GOP 0,5 s) por `http://127.0.0.1:<porta>/...` com suporte a `Range` (HTTP `206`), o WebKitGTK reproduziu o vídeo normalmente e concluiu 100 buscas com **mediana de 16 ms** e **p95 de 18 ms** em `requestVideoFrameCallback` (`seeked`: mediana 7 ms, p95 13 ms).

Por isso, apenas no **Linux**, o adaptador Tauri (`src-tauri`) sobe um servidor HTTP loopback em processo para a mídia do preview e da timeline, mantendo as mesmas garantias de isolamento do núcleo:
- bind exclusivo em `127.0.0.1` e porta aleatória (`0`);
- token criptográfico aleatório por sessão na URL (requisições sem token válido respondem `403`);
- reuso de `clipes_core::media` (apenas IDs opacos `proxy/<chave>`, `thumbs/<chave>`, `source/<id>` e `narration/<id>` do Projeto aberto, com caminho canônico verificado e recusa de `..` e symlinks que escapem);
- sem listagem de diretórios e sem CORS aberto (`Access-Control-Allow-Origin: *` removido; CORS restrito à origem do app).
