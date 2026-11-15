# Preview do Corte (#58)

O usuário abre um **Corte** (ou um candidato da seleção do [#53](selecao-de-cortes.md)) e o preview responde na hora, mesmo numa **Fonte** de 2 h. O motivo é o [protótipo do #15](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md): com a Fonte direta a busca fica em ~277 ms, e num proxy de GOP curto cai para ~33 ms. O núcleo gera esse proxy sozinho, só para a janela do Corte, e o serve por um protocolo de mídia próprio com `Range`.

## Proxy (`core/src/proxy.rs`)

- **Janela**: o Corte ±`MARGIN_US` (2 min), limitada a `[0, duração da Fonte]` (`proxy::window`). Corte acima de `MAX_CLIP_US` (10 min) é recusado (`clip_too_long`).
- **Arquivo** (parâmetros deste ticket): H.264 `libx264` com altura máxima `HEIGHT` = 540 (nunca amplia), quadro-chave a cada `KEYFRAME_SECONDS` = 0,5 s (por tempo, não por quadros: não depende da taxa da Fonte), sem quadros B, `VIDEO_KBPS` = 2500, AAC `AUDIO_KBPS` = 128, `yuv420p` explícito (o `testsrc` sai em 4:4:4 sem isso e o WebView pode não tocar) e `+faststart`. `-ss`/`-t` vão antes de `-i`: busca rápida e recorte exato ao recodificar. Não há detecção de encoder de vídeo no núcleo (a de `hardware.rs` é só da Transcrição), então é sempre x264; o FFmpeg baixado é a build GPL ([ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)). Se o FFmpeg do sistema não tiver `libx264`, o job falha com `proxy_failed`.
- **Cache fora do Projeto**: `<cache>/proxies/<chave>/proxy.mp4`, irmão de `previews/` (a limpeza das prévias não o toca). Chave = SHA-256 de impressão digital parcial da Fonte, faixa de áudio, início e fim da janela (µs) e a versão dos parâmetros (`PARAMS_VERSION` mais as constantes acima): mudar qualquer um muda a chave. Duas janelas iguais (por exemplo, dois Cortes numa Fonte curta) dividem o mesmo proxy.
- **LRU**: depois de cada geração, `evict` remove as pastas menos usadas até o total caber em `min(CACHE_MAX_BYTES = 2 GiB, cache_limit_bytes do usuário)`. O uso é o `mtime` do arquivo, renovado quando o proxy é pedido ou servido. O recém-gerado nunca sai, nem acima do limite; pasta que o sistema não deixa apagar (arquivo em uso no Windows) é pulada; `.part` só é apagado depois de 24 h.
- **Job local da fila** (`kind = 'proxy'`, `safety = 'local'`), cancelável por `jobs.cancel` (o FFmpeg é encerrado e o `.part` removido), com progresso (`-progress pipe:1`, `out_time_us`). Os dados do job (chave e janela) ficam em `proxy_jobs` (migração `0058_001_proxy_jobs`); o código de falha fixo vai em `proxy_jobs.error`. O proxy só é publicado por `rename` de `.<chave>.part`.

## Comandos

| Comando | Faz |
|---|---|
| `proxy.request {source_id, start_us, end_us}` | Valida a Fonte, calcula a janela e a chave. Devolve `{state, key, job, progress, error, windowStartUs, windowEndUs}`; se não há proxy nem job, enfileira um. Pedir de novo com job em curso devolve o mesmo job. |
| `proxy.status {key}` | `ready`, `queued`, `running`, `failed`, `cancelled` ou `missing` (nunca gerado ou já limpo pelo LRU). |
| `proxy.map_time {window_start_us, window_end_us, source_us \| proxy_us}` | Mapeia o tempo da Fonte para o do proxy e de volta; `null` fora da janela. |

**Fonte offline ou alterada** falha em `proxy.request` com `source_offline` ou `source_changed` (mensagens fixas, sem caminho), antes de qualquer job e mesmo com proxy em cache. Nada é gerado.

Nenhuma resposta traz caminho de arquivo ([ADR-0006](../adr/0006-relato-de-problemas-sem-telemetria.md)): o preview fala em chave.

## Protocolo de mídia (`core/src/media.rs`, `src-tauri/src/main.rs`)

O esquema `clipes-media` é registrado no Tauri como assíncrono (a leitura do disco sai da thread principal); o adaptador só traduz HTTP e chama `clipes_core::media::serve(recurso, range)`. A UI monta a URL com `convertFileSrc('proxy/<chave>', 'clipes-media')` (no Windows vira `http://clipes-media.localhost/…`).

- O recurso é um identificador opaco: `proxy/<64 hex minúsculos>` ou `source/<id>`. A barra pode vir como `%2F`. Qualquer outra forma é 404 **antes de tocar o disco**: `..`, `%2e%2e`, `\`, letra de unidade, caminho absoluto, segmentos extras. A chave resolve em `<cache>/proxies/<chave>/proxy.mp4` e o caminho canônico ainda precisa estar dentro de `proxies/`. `source/<id>` resolve pelo Projeto aberto, pela tabela `sources`.
- `Range`: `a-b`, `a-` e `-n` (fim limitado ao arquivo) respondem 206 com `Content-Range` e `Accept-Ranges: bytes`. Malformado, múltiplo, início depois do fim do arquivo ou arquivo vazio: 416 com `Content-Range: bytes */len`. Sem `Range`, 200 se o arquivo cabe em `MAX_RESPONSE_BYTES` (8 MiB); senão 206 com os primeiros 8 MiB. Esse teto vale em toda resposta, então `bytes=0-` numa Fonte de horas nunca vai inteiro para a memória; o `<video>` aceita 206 menor e pede de novo.

## Preview na UI (`src/features/projects/CutPreview.tsx`)

`CutPreview` recebe `{ sourceId, startUs, endUs }` (µs da Fonte) e serve a um Corte e a um candidato. Pede o proxy, mostra fila e progresso (com cancelar), e quando está pronto exibe o `<video>` numa moldura **9:16 em Fit** (`object-fit: contain`: barras, sem corte; o reenquadramento é do #60/#61), com Reproduzir/Pausar, a barra de posição (a janela inteira) e o tempo da Fonte. Fonte offline mostra a mensagem do núcleo, sem vídeo nem progresso.

Quem tiver um Corte ou candidato pode abrir o painel da Fonte com `openCutPreview({ sourceId, startUs, endUs })` (evento `clipes-preview-open`; o `CutPreviewPanel` de `Transcription.tsx` o recebe) ou montar `CutPreview` direto. A tela `CandidateReview.tsx` abre o preview pelo botão "Abrir preview", passando as bordas atuais da revisão (inclusive após ajustes por Frase).

**Clique na palavra**: cada palavra de `transcription.timeline` traz `start_us` (tempo da Fonte). Clicar numa palavra (ou Enter nela) dispara `clipes-preview-seek` com `{ source_id, us }`; o preview aberto da mesma Fonte mapeia `us − windowStartUs` e busca. Fora da janela do proxy, mostra um aviso em vez de ir a outro lugar. F2, setas e Ctrl+Z/Y da Transcrição seguem iguais.

## Testes

- Unitários em `core/src/media.rs` e `core/src/proxy.rs`: formato do recurso (traversal), formas do `Range`, janela, mapeamento de tempo, chave do cache, LRU e argumentos do FFmpeg.
- Headless em `core/tests/proxy.rs` (`CLIPES_DATA_DIR` isolado, sem rede, vídeo sintético `testsrc`/`sine`): Range (início, meio, fim, inválido, teto) e recusa de path traversal sem FFmpeg; com FFmpeg e `libx264` (pula se faltar), o ciclo completo: janela ±2 min limitada, job, GOP ≤ 0,5 s, `yuv420p`, AAC, chave por janela, LRU com o recém-gerado preservado, Fonte offline sem job novo e cancelamento no meio.
- Interface em `scripts/ui.mjs` (`bun run test:ui`): abrir do candidato, progresso, moldura 9:16 em Fit, clique na palavra, aviso fora da janela e Fonte offline.
- Medição de busca no WebView2: [docs/research/2026-11-15-busca-no-proxy.md](../research/2026-11-15-busca-no-proxy.md).
