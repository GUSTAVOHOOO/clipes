# Protótipo do editor: resultados (v2, 12/11/2026)

## Veredito da stack

**Tauri 2 + WebView2 + FFmpeg/libass chamado pelo Rust serve para o editor da v1 no Windows, desde que o preview use um proxy de GOP curto gerado por Corte.** Com uma Fonte real de 2 h e GOP de 10 s, a busca direta segue lenta (~277 ms; scrub a ~4 quadros/s). O proxy automático da janela do Corte (±2 min) fica pronto em 17 a 20 s, e com ele a busca cai para ~33 ms e o scrub sobe para ~46 quadros/s. Com isso, o arrasto de borda mostra o quadro exato a cada movimento. O render 1080×1920 com crop, ASS `\kf` e cortes de silêncio levou entre 0,14× e 0,2× o tempo real com NVENC. Electron continua desnecessário.

Fica em aberto: Linux e macOS (WebKitGTK e WKWebView) não foram testados; o fallback para x264 não chegou a ser exercitado (o NVENC funcionou em todos os exports); e a sensação do arrasto não foi avaliada por uma pessoa.

## O que mudou em relação à v1 do protótipo

| v1 (commit `f477541`) | v2 |
|---|---|
| Fonte sintética (fundo azul com relógio) | Tears of Steel real, com fala, repetido 10× (2:02:22) e transcrição por palavra a partir da legenda oficial |
| `node server.mjs` à parte e HTML duplicado | `npm run tauri dev`: protocolo `midia://` com Range servido pelo Rust; a UI fica em `ui/` |
| Proxy de 2 h gerado à mão por script | Proxy automático só da janela do Corte (±2 min), com progresso, cache e troca transparente |
| Início e fim em campos numéricos; timeline vazia | Timeline com miniaturas, forma de onda, Frases e palavras, alças que encaixam em Frase e mostram o quadro da borda |
| Sem transcrição nem estilo | Painel de Transcrição editável e painel de estilo com 4 presets |
| Trim sem preview | Arrasto da alça busca o quadro exato da borda a cada movimento |
| — | Remoção de silêncios com prévia na timeline e no play, refletida no export |
| — | Export com progresso, NVENC (com fallback x264 no código) e abertura da pasta |

## Medições (máquina e método)

Máquina: Windows 11, RTX 3050 Laptop 4 GB, FFmpeg 8.1.1 (gyan.dev), WebView2 do sistema, `tauri dev` (perfil dev, `opt-level=1`).
Fonte: `fonte-2h.mp4`, 1920×1080, 24 fps, H.264 NVENC, GOP fixo de 240 quadros (10 s), AAC 48 kHz, 7.341,7 s.
Proxy: 960×540, H.264 NVENC, GOP de 12 quadros (0,5 s), sem B-frames, ~2,5 Mb/s, AAC 128 kb/s.

### Busca e scrub no Corte 3 (janela 1:17:21 a 1:22:16)

Disparadas com Ctrl+Shift+M na janela real, com a janela focada e visível (`document.hasFocus()` verdadeiro). Cada série faz 30 buscas aleatórias na janela (latência entre `currentTime = alvo` e o primeiro `requestVideoFrameCallback` com `mediaTime` a menos de 50 ms do alvo), 10 s de scrub automático (ida e volta pelo Corte a cada `requestAnimationFrame`) e 10 s de arrasto automático da alça de início (±20 s, passando pelo mesmo `mudarBordas` da UI, que busca o quadro da borda). Dados brutos em [medicoes-v2/](medicoes-v2/).

| Medição | Proxy automático, rodada 1 | Proxy automático, rodada 2 | Fonte direta, rodada 1 | Fonte direta, rodada 2 |
|---|---:|---:|---:|---:|
| Busca: média | 32,6 ms | 33,4 ms | 278,0 ms | 276,6 ms |
| Busca: p95 | 50,7 ms | 40,9 ms | 457,5 ms | 443,1 ms |
| Busca: máximo | 52,7 ms | 41,9 ms | 495 ms | 509 ms |
| Scrub: quadros de vídeo apresentados/s | 46,6 | 46,5 | 3,9 | 4,1 |
| Arrasto da alça: quadros de borda apresentados/s | 59,3 | 19,2 | 1,3 | 1,2 |
| Cadência da UI (rAF/s) | 75 | 75 | 75 | 75 |

Comparação com a v1:
- O scrub no proxy ficou no mesmo nível (46,5 contra 44,0 quadros/s).
- A busca no proxy ficou mais lenta (33 ms contra 18 ms), mas segue uma ordem de grandeza abaixo da Fonte direta. As diferenças: o proxy agora é 960×540 em vez de 640×360, o conteúdo é um filme de verdade em vez de um quadro quase estático, e o build é de desenvolvimento.
- Na Fonte direta, a busca melhorou um pouco (277 contra 388 ms), provavelmente porque o GOP de 10 s a 24 fps tem 240 quadros, contra 300 na Fonte sintética.
- O arrasto de alça, que na v1 não buscava a borda (0,1 quadro/s), agora apresenta de 19 a 59 quadros de borda por segundo no proxy. A variação entre as rodadas vem das buscas que se acumulam quando o alvo anda mais rápido do que o decodificador. O código descarta as intermediárias e aplica só a última.

### Proxy, onda e export

| Medição | Resultado |
|---|---:|
| Proxy + miniaturas da janela do Corte 2 (267 s de Fonte) | 16,8 s (NVENC) |
| Proxy + miniaturas da janela do Corte 4 (315 s de Fonte) | 19,6 s (NVENC) |
| Proxy já em cache | imediato (troca de `src` e busca) |
| Tamanho do proxy | ~43 MB para 165 s; ~93 MB para 295 s |
| Export 1: "O término no observatório", 22,0 s, preset Clássico, crop central | 3,0 s (NVENC) |
| Export 2: "Você me esqueceu na Terra", 55 s na Fonte, 8 silêncios removidos (24,1 s) → 30,9 s, preset Impacto, crop deslocado (x = 1047) | 6,2 s (NVENC) |

`ffprobe` dos exports:

```text
o-termino-no-observatorio-….mp4   h264 1080x1920 24/1 · aac 48000 Hz 2 canais · 22,041 s · 20,9 MB
voce-me-esqueceu-na-terra-….mp4   h264 1080x1920 24/1 · aac 48000 Hz 2 canais · 31,000 s (áudio 30,957 s) · 26,7 MB
```

Extraí três quadros de cada export ([07](screenshots/07-export-1-quadros.png) e [08](screenshots/08-export-2-quadros.png)). Nos dois, a legenda saiu no preset escolhido, com a varredura `\kf` no meio da palavra ("DON'T", "LISTEN", "KNOW"), e o crop saiu na posição escolhida. No export 1, a quebra em linhas ("YOU'RE / A JERK,") é a mesma do preview.

## Verificação funcional na janela real

Feita com cliques, arrastos e teclas físicos (SendInput) na janela do Tauri, conferindo o estado pelo log `[ui:…]` e por capturas da janela:

- **Lista de Cortes:** troca entre os 4 Cortes, inclusive em 1:19 e 1:58 da Fonte. Enquanto o proxy é gerado, o preview fica na Fonte direta, e a troca para o proxy mantém o tempo. Um bug de corrida nessa troca foi achado e corrigido (o playhead pulava para o fim da janela).
- **Alças:** com o botão ainda pressionado, o preview mostra o quadro da borda e o aviso "Fim · borda de Frase 0:41.00" ([03](screenshots/03-arrasto-de-alca.png)). Com Alt, a borda ficou em 2.395,4167 s (quadro 57.490), fora de qualquer Frase.
- **Atalhos:** ←/→ andaram 1/24 s; L foi a 2×; J voltou; K parou; O marcou o fim em 4.802 s, a borda de Frase mais próxima.
- **Silêncios:** com o toggle ligado, o play pulou de 4.768,12 para 4.769,87 s, exatamente o primeiro trecho removido. Desligar limpa as marcas.
- **Transcrição:** o duplo clique em "ready?" mudou o texto para "ready, team?", que apareceu na legenda do preview na hora, e o Corte ganhou a marca "editado" ([02](screenshots/02-edicao-com-legenda.png)).
- **Export:** o botão gerou o MP4 e abriu o Explorer com o arquivo selecionado.

## Limitações e riscos

- **Plataformas:** só Windows/WebView2. WebKitGTK e WKWebView têm outra pilha de mídia e precisam de teste próprio ([versões do WebView no Tauri](https://v2.tauri.app/reference/webview-versions/)).
- **Transcrição sintética por palavra:** os tempos vêm da legenda oficial, divididos de forma proporcional entre as palavras, e não de um Motor de transcrição. Por isso as pausas dentro de uma legenda não aparecem, e a remoção de silêncios só corta entre legendas. Com Whisper/Parakeet, os vãos serão reais.
- **Paridade preview × libass:** foi calibrada para as quatro fontes do Windows. Diferenças de 1 a 2% de largura ainda aparecem. Fontes ausentes no sistema cairiam em substitutas diferentes nos dois lados.
- **Cache de proxy** sem limite nem limpeza: cada janela de ~5 min ocupa ~90 MB.
- **Silêncios no export** usam `select`/`aselect` por quadro e por pacote de áudio. Funciona, mas o áudio pode errar a borda em até ~21 ms. Na v1, `atrim`+`concat` com crossfade curto seria mais limpo.
- **Medições** foram feitas em build de desenvolvimento, com scrub e arrasto automatizados (não de mão humana) e cache de disco do SO aquecido. Não são uma leitura fria após reinicialização.

## Medições da v1

Os JSONs da rodada anterior (Fonte sintética) estão em [medicoes-v1/](medicoes-v1/), para comparação.
