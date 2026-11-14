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
2. **UI React**, que só exibe e edita. Ela pode enviar a chave ao núcleo na entrada, mas nunca lê chaves e nunca abre processos. Fala com o núcleo por comandos do Tauri, e a mídia chega por um protocolo próprio com suporte a Range.
3. **Um único worker Python ("worker de ML")**, que roda:
   - o faster-whisper (transcrição);
   - o Kokoro (TTS), de preferência via ONNX Runtime e sem PyTorch, se o benchmark confirmar;
   - o YuNet (reenquadramento).

   Ele carrega **um modelo por vez**, numa fila fixa (transcrição → reenquadramento → TTS → render), e libera cada um antes do próximo. Isso permite dividir os 4 GB de VRAM da máquina-alvo. O núcleo fala com o worker por **JSON lines no stdin/stdout**, com versão do protocolo, progresso, cancelamento e erros tipados.

## Como cada peça chega na máquina

- O **Python não vai no instalador.** Ele é baixado sob demanda via `uv`, como um Python standalone com um ambiente isolado só do Clipes. As libs de CUDA só vêm se houver GPU NVIDIA. O Python do sistema nunca é usado. Segue a mesma lógica do FFmpeg ([ADR-0003](0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)).
- O **encoder do export** é detectado e testado na primeira execução, e o resultado vai para cache. A ordem é NVENC, QSV, AMF, VideoToolbox e, por fim, x264 como fallback garantido.

## Camada de Provedor com adaptadores próprios

Os adaptadores HTTP são nossos e ficam no Rust. Bastam três formatos:
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
