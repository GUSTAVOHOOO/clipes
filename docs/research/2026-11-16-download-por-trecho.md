# Spike #152: confiabilidade do download por trecho (`--download-sections`)

Data: 16/11/2026. Ticket: [#152](https://github.com/GUSTAVOHOOO/clipes/issues/152). Relacionados: #28 (dataset), #58 (proxy ±2 min), #194 / #201 (detecção e erros do yt-dlp).
Nenhuma funcionalidade foi implementada no núcleo ou na UI; este relatório registra apenas o spike executado fora do repositório (mídia em `%TEMP%\clipes-152-*`, removida ao fim).

Convenção: **[fato]** = medido em execução real ou inspecionado diretamente no código/binário nesta sessão. **[inferência]** = conclusão técnica a partir dos fatos observados. **[não verificado]** = não executado nesta rodada por interrupção obrigatória no primeiro HTTP 403.

## Recomendação executiva

**O download por trecho com `yt-dlp --download-sections` NÃO é confiável para ser o caminho principal do #152 nas condições atuais (sem cookies, sem login e sem PO Token).**

Em execução controlada com os mesmos Componentes pinados do Clipes (`yt-dlp` `2026.11.04.232659`, `deno` `2.9.8`, `ffmpeg` `8.1.1`), espaçando as tentativas em mais de 2 minutos:

1. **[fato]** A tentativa 1 (`--download-sections` sem `--force-keyframes-at-cuts`, trecho de 252 s em 1080p60 AV1 via `https`) concluiu, mas levou **161,16 s** (~0,64× tempo real, ~0,82 MB/s) e gerou arquivo com **80 quadros de pré-roll descartáveis** (primeiro pacote em **`-1,333333 s`** antes do corte por alinhamento ao keyframe anterior em GOP de ~5,07 s).
2. **[fato]** A tentativa 2 (mesmo trecho, com `--force-keyframes-at-cuts`, iniciada **149 s** após o término da tentativa 1) falhou em **10,77 s** com `ERROR: ffmpeg exited with code 3436169992`, que corresponde exatamente a **`AVERROR_HTTP_FORBIDDEN`** (`FFERRTAG(0xF8, '4', '0', '3')` = **HTTP 403 Forbidden**).
3. **[fato]** Conforme a regra do spike (*parar tudo e reportar no primeiro 403 ou bloqueio*), as tentativas restantes (Live 2 e download da faixa de menor bitrate inteira) foram interrompidas imediatamente.

Somado ao histórico de 14/11/2026 no próprio #152 (dois travamentos até timeout seguidos de 403 geral) e ao relato do #60 (`impedimentos.md`: `--download-sections` trava), depender de `--download-sections` em cima de formatos `https` para baixar múltiplos trechos de candidatos tem alto risco de bloqueio 403 em produção.

---

## Ambiente e método

- **Sistema:** Windows 11.
- **Componentes testados** (versões idênticas às de `core/src/components.rs`):
  - `yt-dlp.exe` `2026.11.04.232659`
  - `deno.exe` `2.9.8` (passado com `--js-runtimes deno:<caminho>`)
  - `ffmpeg.exe` / `ffprobe.exe` `8.1.1-full_build-www.gyan.dev`
- **Amostra do dataset #28 (sem IDs nem títulos):**
  - **Live 1:** VOD de live gravada (`was_live`), duração **13.109 s** (~3h38m), 14 Cortes humanos anotados no manifesto.
  - **Live 2:** VOD de live gravada (`was_live`), duração **40.220 s** (~11h10m), 11 Cortes humanos anotados no manifesto, com `live_chat` disponível.
- **Restrições aplicadas:** sem cookies, sem login, sem troca de IP, mídia temporária apenas em `%TEMP%\clipes-152-spike` (apagada ao final), orçamento máximo de 6 tentativas por trecho espaçadas em ≥ 2 min, parada imediata no primeiro HTTP 403.
- **Flags base do `yt-dlp`:** `--ignore-config --no-playlist --color never --no-simulate --newline --js-runtimes deno:<caminho> --ffmpeg-location <dir> -f "bv*[height<=1080]"`.
- **Janela testada na Live 1:** `*3700-3952` (duração alvo **252,000 s** = 4m12s, equivalente a um Corte de ~12,5 s com margem de ±2 min ao redor de ~1h02m da live).

---

## Medições executadas

### 1. `--download-sections` (Live 1, seção de 252 s)

| Tentativa | Modo | Formato escolhido | Tempo | Resultado | Tamanho | Precisão de borda (`ffprobe`) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Sem `--force-keyframes-at-cuts` | `399` (`https`, 1080p60 AV1, vídeo apenas) | **161,16 s** | Sucesso (código `0`) | **132.499.410 B** (132,5 MB) | `start_time=0,000000 s`, `duration=252,000000 s`; **15.200 pacotes** (vs 15.120 esperados em 60 fps); 1º pacote em **`-1,333333 s`** (`KD_`, pré-roll descartável via edit list) |
| 2 (após 149 s) | Com `--force-keyframes-at-cuts` | `399` (`https`, 1080p60 AV1, vídeo apenas) | **10,77 s** | **Falha** (código `1`: `ffmpeg exited with code 3436169992` = **HTTP 403**) | — | Não gerado (interrompido por HTTP 403) |

- **Taxa de falha observada nesta rodada:** **50%** (1 falha por HTTP 403 em 2 tentativas).
- **Taxa de falha na Live 2 (~11h10m):** **[não verificado]** — execução cancelada após o 403 da tentativa 2.

### 2. Análise da precisão de borda (Tentativa 1, sem `--force-keyframes-at-cuts`)

- **[fato]** A inspeção de pacotes (`ffprobe -show_entries packet=pts_time,flags`) da tentativa 1 mostrou:
  - Total de pacotes: **15.200** (64 keyframes).
  - Primeiros 5 keyframes em: **`-1,333333 s`**, `3,733333 s`, `8,800000 s`, `13,866667 s`, `18,933333 s` → intervalo de GOP de **~5,067 s** (~304 quadros).
  - Os primeiros **80 pacotes** (`-1,333333 s` até `-0,016667 s`) vêm marcados com a flag **`D` (discard)** e ficam ocultos por edit list MP4 (`elst`), mantendo `format.start_time = 0.000000` e `format.duration = 252.000000`.
  - O primeiro pacote sem flag `D` está exatamente em **`0,000000 s`**, mas **não é um keyframe**; o último pacote está em **`251,983333 s`** (duração `0,016667 s`, fechando `252,000000 s`).
- **[inferência]** Se a margem de download for ±2 min ao redor do Corte (como o proxy do #58), um deslocamento de até 1 GOP (~5 s) antes da borda é absorvido pela margem sem cortar o Corte — **desde que** o pipeline do Clipes (FFmpeg/decodificador do proxy e export) respeite a edit list MP4 ou mapeie o `start_pts`/deslocamento real do arquivo baixado. Se algum muxer ou seek por pacote ignorar `elst`, o vídeo fica deslocado em ~1,33 s (até ~5 s dependendo do GOP).
- **[fato]** No código do `yt-dlp` (`yt_dlp.downloader.external.FFmpegFD._call_downloader`), usar `--force-keyframes-at-cuts` apenas **omite `-c copy`** da linha de comando do `ffmpeg`, sem especificar codec, preset ou CRF. **[inferência]** Mesmo quando não toma 403, `--force-keyframes-at-cuts` força recodificação completa dos ~4+ minutos da janela em CPU com o encoder padrão do container, perdendo velocidade e qualidade geracional antes do export final.

### 3. Por que o 403 passou silencioso pelo padrão atual do `yt-dlp`

- **[fato]** Na tentativa 2, o `yt-dlp` não imprimiu `"HTTP Error 403"` no stderr; imprimiu apenas `ERROR: ffmpeg exited with code 3436169992`.
- **[fato]** Em aritmética de 32 bits com sinal no Windows, `3436169992` = `-858797304` = `-(0x333034F8)` = `FFERRTAG(0xF8, '4', '0', '3')`, que é a constante **`AVERROR_HTTP_FORBIDDEN`** de `libavutil/error.h` do FFmpeg.
- **[fato]** Em `core/src/url_import.rs`, `stderr_pattern` hoje classifica `yt_dlp.http_403` procurando apenas a substring `"http error 403"` — portanto, um 403 ocorrido dentro do `FFmpegFD` em `--download-sections` seria hoje mascarado como `download_failed` genérico.

---

## Alternativa: baixar a faixa de vídeo inteira de menor bitrate

O download real da faixa inteira de menor bitrate **não foi executado** (**[não verificado]**) porque a tentativa 2 acionou a regra de parada imediata no primeiro 403. Porém, a coleta prévia de metadados (`--skip-download -J`) das duas lives do dataset mediu os tamanhos e bitrates exatos disponíveis para comparar a viabilidade da alternativa:

| Métrica / Formato | Live 1 (~3h38m / 13.109 s) | Live 2 (~11h10m / 40.220 s) |
| --- | --- | --- |
| Áudio original (`251` opus ~108–113 kbps) | **177,0 MB** | **565,9 MB** |
| Áudio leve (`249` opus ~46 kbps) | 75,4 MB | 232,2 MB |
| **Vídeo-only menor bitrate (`144p`)** | **111,2 MB** (`278` VP9, 67,9 kbps)<br>123,6 MB (`394` AV1) / 139,7 MB (`160` H.264) | **391,7 MB** (`394` AV1, 77,9 kbps)<br>458,2 MB (`160` H.264) / 510,5 MB (`278` VP9) |
| Vídeo-only `360p` (`396`/`243`/`134`) | 473,8 MB – 625,5 MB | 1.660,4 MB – 2.088,3 MB |
| Vídeo-only `480p` (`397`/`244`/`135`) | 858,8 MB – 973,1 MB | 3.020,4 MB – 3.906,4 MB |
| Vídeo-only `1080p60` (`399`/`303`/`299`) | **5.801,3 MB – 6.727,8 MB** | **13.446,6 MB – 19.368,6 MB** |
| Vídeo-only `2160p60` (`315`/`401`) | n/d | 63.621,6 MB – 70.921,7 MB |
| Formatos HLS (`m3u8_native`) presentes? | Sim (144p a 1080p60, ex.: `312`, `617`) | Sim (144p a 2160p60, ex.: `312`, `617`) |

### Análise da alternativa

- **[fato]** Em tamanho de arquivo, a faixa de menor bitrate (144p, ~68–78 kbps) pesa **111 MB** numa live de 3h38m e **392 MB** numa live de 11h10m — **menor até que o próprio áudio `251`** e ~50× menor que o 1080p60. Como é um download HTTP contínuo único (sem `FFmpegFD` abrindo seek `-ss` sobre URL assinada), evita o padrão que quebrou na tentativa 2.
- **[inferência]** Contudo, **144p não substitui o vídeo dos trechos para o pipeline completo**:
  - Serve para preview bruto ou checagem visual aproximada, mas **não serve para exportar Cortes em 1080p** (criterio do #152 exige que preview, reenquadramento e export usem o trecho baixado) e degrada detecção facial/cenário de gameplay com texto/HUD pequeno.
  - Subir para `480p` (útil para proxy/reenquadramento, que usa 480 px / 540 px) já consome **3,0–3,9 GB** numa live de 11h10m — e ainda não resolve o export 1080p sem baixar depois os trechos em 1080p (que sofrem do mesmo risco de 403) ou o arquivo 1080p inteiro (13,4–19,4 GB).

---

## Lacunas não testadas (por parada no primeiro 403)

1. **[não verificado]** Se selecionar explicitamente formatos **`m3u8_native`** (HLS, disponíveis nas duas lives) evita o 403 do `FFmpegFD` em URLs `https`: no HLS o `yt-dlp` baixa os segmentos de mídia diretamente em Python em vez de delegar a URL `https` com `-ss` ao `ffmpeg`.
2. **[não verificado]** Tempo real, taxa de falha e precisão de borda na **Live 2** (~11h10m), onde o seeks de `-ss 30691` no formato `https` pode ser ainda mais lento ou mais propenso a bloqueio.
3. **[não verificado]** Taxa de falha e velocidade do download completo da faixa `144p` (`278` / `394`).

---

## Opções para decisão do dev

1. **Pausar / adiar o download por trecho do #152 na v1 (recomendado):** manter o fluxo atual de download completo com aviso de tamanho estimado antes de baixar, ou entregar primeiro só a **seleção da faixa de áudio original** (evitar baixar dublagem) sem prometer vídeo sob demanda por trecho até que o caminho de download por seção seja confiável.
2. **Spike complementar só com `m3u8_native` (se quiser insistir no #152):** testar em uma nova rodada controlada se `--download-sections` forçando `protocol^=m3u8` (e sem `--force-keyframes-at-cuts`, absorvendo o GOP dentro da margem de ±2 min) elimina o 403 de `FFmpegFD` e reduz o tempo abaixo de 161 s para 4 min.
3. **Melhoria independente já identificada:** atualizar `stderr_pattern` em `core/src/url_import.rs` (ou capturar o exit code do ffmpeg) para reconhecer `3436169992` (`AVERROR_HTTP_FORBIDDEN`) como `yt_dlp.http_403` em vez de `download_failed` genérico.
