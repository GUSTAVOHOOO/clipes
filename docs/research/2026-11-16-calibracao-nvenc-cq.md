# Calibração do CQ do NVENC contra o x264 (#232)

**Status:** concluído. Novo padrão do `h264_nvenc`: **`-cq 25`** (substitui `-cq 23` do #62), mantendo `-preset p5 -tune hq -rc vbr -b:v 0 -pix_fmt yuv420p` em `core/src/export/encoder.rs`.

## Resumo executivo

A medição em 4 clipes verticais `1080×1920` de 45 s (jogo, rosto, texto/UI em tela e movimento rápido, todos de licença livre e fora do dataset #28) contra o baseline do Clipes (`libx264 -preset fast -crf 20 -threads 2`) mostrou que:

1. **O antigo `-cq 23` superestimava taxa e tamanho:** ficou **1,32×** maior na média das razões de tamanho (`1,34×` em rosto e `1,86×` em screencast de UI/texto), com ΔVMAF médio de `+0,61` pontos (e `+1,08` em rosto).
2. **Nenhum CQ inteiro em 19–29 cumpre simultaneamente `|ΔVMAF| ≤ 1,0` e `tamanho ≤ 1,30×` em todos os 4 clipes isolados:** o screencast estático de 60 fps (`texto`, apenas `690,4 kbps` no `libx264`) só cai abaixo de `1,30×` a partir de **CQ 27** (`1,26×`), ponto em que `jogo` já perde `-1,35` pontos de VMAF (`< -1,0`).
3. **`-cq 25` é o ponto de equilíbrio escolhido:**
   - **Qualidade:** ΔVMAF médio de **`+0,16`** pontos (faixa **`-0,29` a `+0,60`** nos 4 clipes — todos dentro de ±1,0 ponto de VMAF, e até dentro de ±0,60).
   - **Tamanho:** razão média de **`1,05×`** (`0,81×` em jogo, `1,02×` em rosto, `0,81×` em movimento rápido e `1,57×` no screencast estático de baixa taxa — apenas `+2,22 MB` absolutos em 45 s) e volume total agregado de **`0,86×`** (`131,7 MB` contra `153,2 MB` no x264).
   - **Velocidade na RTX 3050:** `29,13 s` no total para 180 s de vídeo contra `337,24 s` no `libx264` (**`11,6×` mais rápido** no agregado).
   - `CQ 26` também atende `|ΔVMAF| ≤ 1,0` nos 4 clipes (média `-0,17`), mas já derruba `jogo` para `-0,70` (perto do penhasco de `-1,35` em CQ 27), reduz o SSIM abaixo do `libx264` em todos os 4 clipes e ainda deixa `texto` em `1,41×` (`> 1,30×`). Por isso **CQ 25** é a escolha mais segura para não perder qualidade visível em conteúdo de jogo/movimento enquanto elimina o excesso de bitrate do CQ 23.

## Ambiente e configuração medida

- **GPU e driver:** NVIDIA GeForce RTX 3050 Laptop GPU (4 GB VRAM), driver `616.92` (`nvidia-smi`).
- **Sistema:** Windows 11, CPU AMD Ryzen 5 5600H (6 núcleos / 12 threads), sem outros encodes ou compilações em paralelo durante as medições.
- **FFmpeg:** `ffmpeg version 8.1.1-full_build-www.gyan.dev` (com `libx264`, `h264_nvenc`, `libvmaf` `vmaf_v0.6.1`, `ssim` e `psnr`).
- **Parâmetros medidos (idênticos aos de `core/src/export/encoder.rs` e `render.rs`):**
  - Baseline: `-c:v libx264 -threads 2 -preset fast -crf 20 -pix_fmt yuv420p`
  - Candidatos: `-c:v h264_nvenc -threads 2 -preset p5 -tune hq -rc vbr -cq <CQ> -b:v 0 -pix_fmt yuv420p` para `CQ ∈ {19..29}`
  - Saída vídeo puro (`-an -fps_mode vfr -movflags +faststart`) para que a razão de tamanho reflita estritamente o stream de vídeo, sem diluição por faixa AAC fixa de `192 kbps` (~1,08 MB em 45 s).

## Fontes e licenças da mídia

Nenhuma mídia entrou no repositório; os arquivos foram baixados temporariamente em `%TEMP%\clipes-232-media\` e apagados ao final. Nada do dataset #28 foi utilizado.

| Clipe | Tipo | Fonte (Wikimedia Commons) | Autor | Licença | Trecho e recorte para `1080×1920` (45 s) |
|---|---|---|---|---|---|
| `jogo` | Gameplay FPS com HUD e movimento | [File:Red Eclipse 1,5 Gameplay 1.webm](https://commons.wikimedia.org/wiki/File:Red_Eclipse_1,5_Gameplay_1.webm) | Premitre | CC BY 3.0 | `50s–95s`, `30 fps`, recorte central `675×1200` → `1080×1920` (`lanczos`) |
| `rosto` | Rosto em entrevista / estúdio | [File:Interview on extreme weather with physical geographer Hannah Cloke – The Royal Society.webm](https://commons.wikimedia.org/wiki/File:Interview_on_extreme_weather_with_physical_geographer_Hannah_Cloke_%E2%80%93_The_Royal_Society.webm) | The Royal Society | CC BY 3.0 | `40s–85s`, `25 fps`, recorte `608×1080` (`x=940`) → `1080×1920` (`lanczos`) |
| `texto` | Texto de UI, menus e letreiros | [File:Blender 3.4 New Features in LESS than 5 minutes.webm](https://commons.wikimedia.org/wiki/File:Blender_3.4_New_Features_in_LESS_than_5_minutes.webm) | Blender Foundation, SouthernShotty | CC BY 3.0 | `125s–170s`, `60 fps`, recorte `608×1080` (`x=1000`) → `1080×1920` (`lanczos`) |
| `movimento` | Movimento rápido e textura natural | [File:Horses running in a pasture.webm](https://commons.wikimedia.org/wiki/File:Horses_running_in_a_pasture.webm) | Field of Dreams | CC BY 3.0 | `15s–60s`, `29,97 fps`, recorte `608×1080` (`x=656`) → `1080×1920` (`lanczos`) |

### Metodologia de preparação e alinhamento

Cada trecho de 45 s foi convertido primeiro para uma referência lossless em CFR estrito (`-fps_mode cfr -c:v libx264 -crf 0 -preset ultrafast -pix_fmt yuv420p`) em `1080×1920` (`1350` quadros em `jogo`, `1125` em `rosto`, `2700` em `texto`, `1350` em `movimento`). Em testes piloto sem normalização CFR, timestamps VFR herdados do WebM causavam descasamento de quadros no `libvmaf` (puxando a média para baixo e o mínimo para `0,0`).

Na varredura final, todas as 48 execuções tiveram `nb_read_frames` conferido contra a referência e foram avaliadas quadro a quadro com `setpts=N` nos dois fluxos via `libvmaf` (`vmaf_v0.6.1`, `n_threads=12`, `n_subsample=1`), `ssim` e `psnr` simultâneos.

## Resultados agregados (4 clipes × 45 s = 180 s)

| Encoder / CQ | ΔVMAF médio | ΔVMAF mín | ΔVMAF máx | Razão tam. média | Razão tam. máx | Total (bytes) | Razão total | Tempo total (s) | Speedup |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `libx264` (`fast`, CRF 20) | 0,00 | — | — | 1,00× | 1,00× | 153.156.884 | 1,00× | 337,24 | 1,0× |
| `h264_nvenc` CQ 19 | +0,97 | +0,39 | +1,71 | 1,90× | 2,61× | 236.847.628 | 1,55× | 31,73 | 10,6× |
| `h264_nvenc` CQ 20 | +0,94 | +0,39 | +1,62 | 1,78× | 2,44× | 226.065.658 | 1,48× | 32,12 | 10,5× |
| `h264_nvenc` CQ 21 | +0,85 | +0,41 | +1,49 | 1,62× | 2,21× | 209.004.609 | 1,36× | 32,44 | 10,4× |
| `h264_nvenc` CQ 22 | +0,74 | +0,35 | +1,26 | 1,46× | 2,03× | 188.674.039 | 1,23× | 31,41 | 10,7× |
| `h264_nvenc` CQ 23 *(anterior)* | +0,61 | +0,20 | +1,08 | 1,32× | 1,86× | 168.253.927 | 1,10× | 32,61 | 10,3× |
| `h264_nvenc` CQ 24 | +0,43 | +0,00 | +0,83 | 1,18× | 1,73× | 148.893.322 | 0,97× | 33,03 | 10,2× |
| **`h264_nvenc` CQ 25 *(escolhido)*** | **+0,16** | **-0,29** | **+0,60** | **1,05×** | **1,57×** | **131.732.534** | **0,86×** | **29,13** | **11,6×** |
| `h264_nvenc` CQ 26 | -0,17 | -0,70 | +0,36 | 0,94× | 1,41× | 117.249.506 | 0,77× | 29,31 | 11,5× |
| `h264_nvenc` CQ 27 | -0,68 | -1,35 | -0,01 | 0,83× | 1,26× | 103.653.464 | 0,68× | 32,15 | 10,5× |
| `h264_nvenc` CQ 28 | -1,32 | -2,20 | -0,40 | 0,75× | 1,14× | 91.998.225 | 0,60× | 31,64 | 10,7× |
| `h264_nvenc` CQ 29 | -2,07 | -3,33 | -0,58 | 0,67× | 1,06× | 81.425.356 | 0,53× | 31,35 | 10,8× |

## Resultados por clipe

### 1. `jogo` — Red Eclipse 1.5 CTF (`1080×1920`, `30 fps`, 45 s)

| Encoder / Config | Tempo (s) | Speedup | Tamanho (B) | Bitrate (kbps) | Razão tam. | VMAF | ΔVMAF | VMAF mín | SSIM | PSNR (dB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `libx264` (`fast`, CRF 20) | 120,99 | 1,0× | 57.470.909 | 10214,1 | 1,00× | 98,85 | — | 90,85 | 0,99055 | 46,52 |
| `h264_nvenc` CQ 19 | 6,58 | 18,4× | 85.403.620 | 15179,6 | 1,49× | 99,39 | +0,54 | 90,89 | 0,99312 | 48,95 |
| `h264_nvenc` CQ 20 | 6,48 | 18,7× | 80.916.973 | 14382,0 | 1,41× | 99,37 | +0,52 | 91,26 | 0,99288 | 48,79 |
| `h264_nvenc` CQ 21 | 6,39 | 18,9× | 73.242.016 | 13017,6 | 1,27× | 99,30 | +0,45 | 89,97 | 0,99223 | 48,28 |
| `h264_nvenc` CQ 22 | 6,44 | 18,8× | 65.444.958 | 11631,5 | 1,14× | 99,20 | +0,35 | 88,90 | 0,99139 | 47,68 |
| `h264_nvenc` CQ 23 | 6,06 | 20,0× | 58.307.054 | 10362,5 | 1,01× | 99,05 | +0,20 | 87,48 | 0,99044 | 47,06 |
| `h264_nvenc` CQ 24 | 8,17 | 14,8× | 51.991.370 | 9239,7 | 0,90× | 98,85 | +0,00 | 85,91 | 0,98940 | 46,44 |
| **`h264_nvenc` CQ 25** | **7,88** | **15,4×** | **46.374.867** | **8241,3** | **0,81×** | **98,55** | **-0,29** | **84,48** | **0,98825** | **45,82** |
| `h264_nvenc` CQ 26 | 6,37 | 19,0× | 41.530.978 | 7380,1 | 0,72× | 98,14 | -0,70 | 84,27 | 0,98700 | 45,19 |
| `h264_nvenc` CQ 27 | 6,78 | 17,8× | 36.827.132 | 6543,9 | 0,64× | 97,50 | -1,35 | 79,05 | 0,98546 | 44,49 |
| `h264_nvenc` CQ 28 | 7,41 | 16,3× | 32.851.283 | 5837,1 | 0,57× | 96,65 | -2,20 | 76,39 | 0,98384 | 43,83 |
| `h264_nvenc` CQ 29 | 7,18 | 16,8× | 29.162.806 | 5181,4 | 0,51× | 95,52 | -3,33 | 73,90 | 0,98204 | 43,17 |

### 2. `rosto` — Entrevista Royal Society (`1080×1920`, `25 fps`, 45 s)

| Encoder / Config | Tempo (s) | Speedup | Tamanho (B) | Bitrate (kbps) | Razão tam. | VMAF | ΔVMAF | VMAF mín | SSIM | PSNR (dB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `libx264` (`fast`, CRF 20) | 72,87 | 1,0× | 23.082.223 | 4100,9 | 1,00× | 97,18 | — | 92,56 | 0,99355 | 48,85 |
| `h264_nvenc` CQ 19 | 5,82 | 12,5× | 50.702.827 | 9011,1 | 2,20× | 98,88 | +1,71 | 95,17 | 0,99563 | 51,80 |
| `h264_nvenc` CQ 20 | 6,72 | 10,8× | 45.073.333 | 8010,4 | 1,95× | 98,80 | +1,62 | 94,98 | 0,99533 | 51,39 |
| `h264_nvenc` CQ 21 | 6,13 | 11,9× | 39.265.369 | 6977,8 | 1,70× | 98,66 | +1,49 | 94,75 | 0,99496 | 50,94 |
| `h264_nvenc` CQ 22 | 5,04 | 14,5× | 34.548.552 | 6139,3 | 1,50× | 98,44 | +1,26 | 93,89 | 0,99459 | 50,55 |
| `h264_nvenc` CQ 23 | 6,01 | 12,1× | 30.834.715 | 5479,1 | 1,34× | 98,26 | +1,08 | 93,61 | 0,99426 | 50,19 |
| `h264_nvenc` CQ 24 | 5,71 | 12,8× | 26.991.819 | 4795,9 | 1,17× | 98,01 | +0,83 | 93,06 | 0,99381 | 49,71 |
| **`h264_nvenc` CQ 25** | **5,97** | **12,2×** | **23.461.468** | **4168,3** | **1,02×** | **97,64** | **+0,46** | **92,13** | **0,99324** | **49,20** |
| `h264_nvenc` CQ 26 | 5,63 | 12,9× | 20.896.587 | 3712,3 | 0,91× | 97,25 | +0,07 | 91,50 | 0,99270 | 48,74 |
| `h264_nvenc` CQ 27 | 5,76 | 12,7× | 18.532.655 | 3292,1 | 0,80× | 96,72 | -0,46 | 90,32 | 0,99205 | 48,22 |
| `h264_nvenc` CQ 28 | 4,90 | 14,9× | 16.333.900 | 2901,2 | 0,71× | 96,03 | -1,15 | 89,27 | 0,99126 | 47,65 |
| `h264_nvenc` CQ 29 | 5,64 | 12,9× | 14.452.368 | 2566,7 | 0,63× | 95,35 | -1,83 | 87,64 | 0,99054 | 47,15 |

### 3. `texto` — Screencast Blender 3.4 (`1080×1920`, `60 fps`, 45 s)

| Encoder / Config | Tempo (s) | Speedup | Tamanho (B) | Bitrate (kbps) | Razão tam. | VMAF | ΔVMAF | VMAF mín | SSIM | PSNR (dB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `libx264` (`fast`, CRF 20) | 37,53 | 1,0× | 3.916.574 | 690,4 | 1,00× | 95,82 | — | 92,67 | 0,99751 | 50,73 |
| `h264_nvenc` CQ 19 | 11,34 | 3,3× | 10.220.200 | 1811,0 | 2,61× | 97,08 | +1,26 | 96,68 | 0,99894 | 56,48 |
| `h264_nvenc` CQ 20 | 10,78 | 3,5× | 9.572.398 | 1695,8 | 2,44× | 97,03 | +1,21 | 96,52 | 0,99886 | 56,01 |
| `h264_nvenc` CQ 21 | 10,90 | 3,4× | 8.657.478 | 1533,2 | 2,21× | 96,87 | +1,05 | 96,19 | 0,99857 | 54,81 |
| `h264_nvenc` CQ 22 | 10,84 | 3,5× | 7.938.511 | 1405,4 | 2,03× | 96,80 | +0,98 | 96,16 | 0,99845 | 54,47 |
| `h264_nvenc` CQ 23 | 10,66 | 3,5× | 7.301.084 | 1292,0 | 1,86× | 96,71 | +0,89 | 95,90 | 0,99828 | 53,90 |
| `h264_nvenc` CQ 24 | 10,90 | 3,4× | 6.761.728 | 1196,2 | 1,73× | 96,61 | +0,79 | 95,75 | 0,99811 | 53,37 |
| **`h264_nvenc` CQ 25** | **9,58** | **3,9×** | **6.138.034** | **1085,3** | **1,57×** | **96,42** | **+0,60** | **95,48** | **0,99780** | **52,60** |
| `h264_nvenc` CQ 26 | 9,39 | 4,0× | 5.516.123 | 974,7 | 1,41× | 96,18 | +0,36 | 94,86 | 0,99742 | 51,75 |
| `h264_nvenc` CQ 27 | 12,42 | 3,0× | 4.929.884 | 870,5 | 1,26× | 95,81 | -0,01 | 94,30 | 0,99689 | 50,73 |
| `h264_nvenc` CQ 28 | 9,53 | 3,9× | 4.483.500 | 791,1 | 1,14× | 95,42 | -0,40 | 93,44 | 0,99641 | 49,93 |
| `h264_nvenc` CQ 29 | 9,47 | 4,0× | 4.155.180 | 732,8 | 1,06× | 95,24 | -0,58 | 92,82 | 0,99611 | 49,51 |

### 4. `movimento` — Cavalos correndo (`1080×1920`, `29,97 fps`, 45 s)

| Encoder / Config | Tempo (s) | Speedup | Tamanho (B) | Bitrate (kbps) | Razão tam. | VMAF | ΔVMAF | VMAF mín | SSIM | PSNR (dB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `libx264` (`fast`, CRF 20) | 105,84 | 1,0× | 68.687.178 | 12196,1 | 1,00× | 99,46 | — | 92,20 | 0,99033 | 43,36 |
| `h264_nvenc` CQ 19 | 7,98 | 13,3× | 90.520.981 | 16073,3 | 1,32× | 99,85 | +0,39 | 94,10 | 0,99150 | 44,67 |
| `h264_nvenc` CQ 20 | 8,13 | 13,0× | 90.502.954 | 16070,1 | 1,32× | 99,86 | +0,39 | 94,01 | 0,99150 | 44,68 |
| `h264_nvenc` CQ 21 | 9,01 | 11,7× | 87.839.746 | 15597,1 | 1,28× | 99,87 | +0,41 | 94,97 | 0,99125 | 44,60 |
| `h264_nvenc` CQ 22 | 9,10 | 11,6× | 80.742.018 | 14336,6 | 1,18× | 99,83 | +0,37 | 94,49 | 0,99056 | 44,16 |
| `h264_nvenc` CQ 23 | 9,88 | 10,7× | 71.811.074 | 12750,5 | 1,05× | 99,75 | +0,28 | 92,91 | 0,98956 | 43,56 |
| `h264_nvenc` CQ 24 | 8,25 | 12,8× | 63.148.405 | 11212,0 | 0,92× | 99,58 | +0,12 | 91,51 | 0,98836 | 42,93 |
| **`h264_nvenc` CQ 25** | **5,70** | **18,6×** | **55.758.165** | **9899,5** | **0,81×** | **99,36** | **-0,11** | **82,72** | **0,98710** | **42,32** |
| `h264_nvenc` CQ 26 | 7,91 | 13,4× | 49.305.818 | 8753,6 | 0,72× | 99,05 | -0,41 | 81,22 | 0,98575 | 41,77 |
| `h264_nvenc` CQ 27 | 7,19 | 14,7× | 43.363.793 | 7698,3 | 0,63× | 98,56 | -0,90 | 77,36 | 0,98406 | 41,18 |
| `h264_nvenc` CQ 28 | 9,79 | 10,8× | 38.329.542 | 6804,2 | 0,56× | 97,94 | -1,52 | 72,00 | 0,98223 | 40,60 |
| `h264_nvenc` CQ 29 | 9,06 | 11,7× | 33.655.002 | 5974,0 | 0,49× | 96,94 | -2,53 | 68,46 | 0,98033 | 40,02 |

## Justificativa do CQ 25 e limitações observadas

1. **Por que não manter CQ 23:** o `CQ 23` excedeu a tolerância de `1,3×` na média (`1,32×`), em `rosto` (`1,34×`) e em `texto` (`1,86×`), entregando `+0,61` de ΔVMAF médio às custas de ~28% mais bytes do que `CQ 25` (`168,3 MB` vs `131,7 MB`).
2. **Por que nenhum CQ único passa os dois limites nos 4 clipes simultaneamente:** o `libx264` em `fast` explora com muita eficiência quadros quase estáticos em `60 fps` (caso do screencast `texto`, que ficou em `690 kbps` / `3,92 MB`). Em H.264 por hardware (NVENC Turing/Ampere), o controle `vbr` com `-cq` preserva melhor a nitidez de texto pequeno sem gastar muito mais absoluto (+2,2 MB em 45 s no `CQ 25`, bitrate final de apenas `1,09 Mbps`), mas a razão relativa contra `690 kbps` só cai abaixo de `1,30×` em `CQ 27` (`1,26×`), onde o jogo `Red Eclipse` já cai `-1,35` pontos de VMAF (fora da tolerância `≤ 1` ponto).
3. **Por que `CQ 25` é preferível a `CQ 26`:** ambos cumprem `|ΔVMAF| ≤ 1,0` nos 4 clipes e falham `≤ 1,30×` somente em `texto` (`1,57×` vs `1,41×`). Contudo, `CQ 25` fica praticamente centrado no zero em VMAF (`+0,16` médio, pior clipe `-0,29`), iguala o tamanho em rosto (`1,02×`) e média geral (`1,05×`), e reduz o risco de bloqueio em cenas rápidas antes da queda acentuada observada a partir de `CQ 27`.
4. **Escopo não medido:** QSV, AMF e VideoToolbox continuam com os valores de referência do fabricante em `core/src/export/encoder.rs` (sem hardware correspondente nesta máquina).
