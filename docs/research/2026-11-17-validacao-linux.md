# Validação automatizada no Linux (#69)

Ensaio automatizado no GitHub Actions (`ubuntu-latest`, Ubuntu 26.04.1 LTS) com o pacote `.deb` real (`clipes 0.1.0`), `Xvfb` (`:99`), `tauri-driver` + `webkitgtk-webdriver` (`libwebkit2gtk-4.1-0 2.52.6`, GStreamer `1.28.2`) e FFmpeg do sistema (`8.0.1-3ubuntu2`). Toda mídia é sintética (`lavfi`: `testsrc` + `sine`), sem rede e com dados isolados por `CLIPES_DATA_DIR`.

## Resumo dos resultados

| Etapa | Resultado | Observação |
|---|---|---|
| Instalação do `.deb` e abertura sob `Xvfb` + `tauri-driver` | Passou | Binário `/usr/bin/clipes`, WebKitGTK `Version/60.5` |
| Geração do proxy (janela 30–280 s) | Passou | 11,68 s – 14,32 s para 250 s de vídeo |
| Preview do proxy via `clipes-media://` no WebKitGTK | **Falhou (2 achados)** | Ver achados abaixo |
| Busca (seek) de 100 amostras no WebKitGTK via HTTP loopback | Passou | Mediana **16 ms**, p95 **18 ms** (`rVFC`) |
| Export de Corte (10 s) com legenda ASS (`libx264`) | Passou | 3,26 s – 4,06 s; conferido com `ffprobe` (`h264` 1080×1920, `aac` 48 kHz) |
| Fallback `x264` (detecção e runtime sem NVENC) | Passou | Detecção < 1 s → `libx264`; fallback `h264_nvenc → libx264` gravado no SQLite |

## Achados no WebKitGTK / empacotamento `.deb`

### 1. Pacote `.deb` não declara dependências de codecs GStreamer H.264/AAC ([#247](https://github.com/GUSTAVOHOOO/clipes/issues/247))

- **Evidência (run `44012416223`, Ubuntu 26.04.1 limpo):** `dpkg -s clipes` declara apenas `Depends: libwebkit2gtk-4.1-0, libgtk-3-0`.
- Sem pacotes extras, `gst-inspect-1.0` reportou `qtdemux: true`, mas `h264parse: false`, `avdec_h264: false`, `openh264dec: false`, `faad: false` e `avdec_aac: false`.
- No WebKitGTK, `video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')` retornou `""` (vazio) e `<video>` falhou com `errorCode: 4` (`MEDIA_ERR_SRC_NOT_SUPPORTED`), `networkState: 3`.
- **Dependência necessária:** instalar `gstreamer1.0-libav` e `gstreamer1.0-plugins-bad` fez `gst-inspect-1.0` reconhecer todos os plugins e `canPlayType(...)` passar para `"probably"`.

### 2. Protocolo `clipes-media://` não toca em `<video>` no WebKitGTK (`FormatError`) ([#246](https://github.com/GUSTAVOHOOO/clipes/issues/246))

- **Evidência (run `44015808154`, já com `gstreamer1.0-libav 1.28.2-1` e `gstreamer1.0-plugins-bad 1.28.2-1ubuntu1.2`):**
  - `fetch('clipes-media://localhost/proxy%2F...')` funcionou normalmente e recebeu HTTP `206`, `Content-Type: video/mp4`, `8388608` bytes (e `1024` bytes com `Range: bytes=0-1023`).
  - Ainda assim, `<video src="clipes-media://...">` falhou imediatamente em `MediaPlayerPrivateGStreamer.cpp:1554:loadingFailed` com `Loading failed, error: FormatError` (`video.error.code = 4`, `networkState = 3`, `readyState = 0`), tanto para `source/1` quanto para `proxy/<chave>`.
  - Servindo o **mesmo arquivo `proxy.mp4`** via loopback `http://127.0.0.1:<porta>/proxy.mp4` (com `Range` / HTTP `206`), o mesmo `<video>` no WebKitGTK carregou (`960×540`, `250 s`), reproduziu e respondeu às 100 buscas.
- **Impacto no ADR-0004:** o ADR-0004 prevê mídia entregue por protocolo próprio com `Range`. No Windows WebView2 isso vira `http://clipes-media.localhost/...` e funciona, mas no Linux WebKitGTK o esquema customizado `clipes-media://` não é aceito pelo backend GStreamer do `<video>`.

## Medições

### Latência de busca (seek) no WebKitGTK (HTTP loopback, 100 amostras, semente 58)

Run `44015808154` (AMD EPYC 9V45 4 vCPU, 15,61 GiB RAM, Fonte sintética 300 s 960×540 30 fps GOP 300 gerada em 10.251 ms; proxy 250 s GOP 0,5 s gerado em 11.681 ms):

| Métrica | n | Mínimo | Mediana | p95 | Máximo |
|---|---:|---:|---:|---:|---:|
| Evento `seeked` | 100 | 3,0 ms | 7,0 ms | 13,0 ms | 17,0 ms |
| `requestVideoFrameCallback` (quadro) | 100 | 13,0 ms | 16,0 ms | 18,0 ms | 32,0 ms |

### Export com legenda e fallback `x264`

- **Detecção de encoder (`export.encoder.detect`):** 822–943 ms; `gpu: ""`, `passed: ["libx264"]`, `selected: "libx264"`, `effective: "libx264"`.
- **Export com legenda ASS (`NotoSans-Bold.ttf`, 10 s, 1080×1920):** 3.261–4.055 ms. `ffprobe`: `478.235` bytes, `duration: 10 s`, vídeo `h264` `1080×1920` `yuv420p`, áudio `aac` `48000 Hz` mono.
- **Fallback em runtime (`h264_nvenc` → `libx264`):** forçando `h264_nvenc` em `export-encoder.json` no runner sem NVENC, o export falhou com `h264_nvenc` e concluiu automaticamente com `libx264` em 3.586–4.357 ms, gravando `encoder = "libx264"`, `fallback_from = "h264_nvenc"` e `fallback_reason = "encoder_failed"` em `project.sqlite`, e removendo `h264_nvenc` de `export-encoder.json`.

## Reprodução

No Linux (ou pelo workflow `.github/workflows/linux-validation.yml` via `workflow_dispatch`):

```bash
xvfb-run -a -s "-screen 0 1366x768x24" \
  bun scripts/linux-validation.mjs --out result.json --screenshot shots
```

## Limites

- Os dados são de runners virtuais `ubuntu-latest` (CPU apenas, sem GPU nem servidor de áudio PipeWire/PulseAudio ativo) usando mídia sintética `lavfi`.
- A medição de busca no WebKitGTK usou HTTP loopback porque `clipes-media://` falhou com `FormatError` no GStreamer do WebKitGTK; a busca via `source/<id>` no loopback não foi medida separadamente.
