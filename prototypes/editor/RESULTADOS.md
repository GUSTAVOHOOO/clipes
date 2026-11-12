# Protótipo de editor — resultados (12/11/2026)

**Veredito:** Tauri 2 serve como base **condicional** para este editor no Windows. Para a Fonte sintética de GOP de 10 s, use proxy de preview: a busca e o scrub foram substancialmente mais responsivos na medição; isso não prova que proxy seja obrigatório para toda Fonte. Electron não é necessário pela evidência disponível. O trim ainda precisa buscar o quadro da borda e ser avaliado interativamente; o teste também não estabelece desempenho em VODs reais nem em outras plataformas.

## Como executar no Windows

Pré-requisitos: Node, Python, FFmpeg com NVENC/libass, Rust stable e ferramentas C++ do Visual Studio com Windows SDK. No PowerShell, a partir da raiz do repositório:

```powershell
cd prototypes/editor
./gerar-fonte.ps1  # cria Fonte de 2 h e transcrição; demora alguns minutos
./gerar-proxy.ps1  # proxy de 2 h para ensaio; também demora alguns minutos
node server.mjs    # manter este terminal aberto; servidor somente em 127.0.0.1
```

Em outro PowerShell:

```powershell
cd prototypes/editor/src-tauri
cargo run --release
```

A UI permite iniciar/reproduzir Corte, alterar início e fim em segundos ou nas alças, selecionar Fonte/proxy, mover o crop, ajustar zoom e fazer scrub. O botão de medição executa 30 buscas e baixa JSON; é experimental. Para regenerar os renders, rode `./render.ps1` em `prototypes/editor`. Os arquivos `media/` e binários `target/` ficam fora do git. O proxy gerado integralmente cobre 2 horas para comparação, não é a estratégia recomendada de custo para produção.

## Medições e limites

Máquina: Windows 11, RTX 3050 Laptop 4 GB, FFmpeg 8.1.1; WebView2 157.0.4341.46. Fonte sintética: 1920×1080, 30 fps, H.264 NVENC, GOP 300 quadros, AAC, relógio por quadro, duração 7.200 s, 167.740.024 bytes. Proxy: 640×360, GOP 30, 147.722.705 bytes. Conteúdo praticamente estático e bitrate reduzido: não é representativo de uma live real.

| Medição | Resultado | Limite |
|---|---:|---|
| Tauri release `.exe` | 8.626.176 bytes (~8,23 MiB) | sem instalador nem runtime WebView2 |
| Render NVENC 60 s | 12,44 s | crop 608×1080 central, escala 1080×1920, ASS `\kf`, áudio AAC, preset p4 |
| Render x264 60 s | 13,02 s | mesmo filtro, preset medium; não é comparação de qualidade igual |
| Pico RAM FFmpeg NVENC / x264 | 473,5 / 885,5 MiB | working set amostrado a cada ~0,5 s, processo FFmpeg apenas |
| Pico VRAM total NVENC / x264 | 921 / 718 MiB | GPU inteira via `nvidia-smi`, inclui outros processos; base observada 718 MiB |
| Busca Fonte, primeira passagem sem cache HTTP | média 388,4 ms; p95 656,1 ms | 30 buscas; cache de arquivos do Windows não foi limpo |
| Busca Fonte, segunda passagem aquecida | média 377,8 ms; p95 654,8 ms | 30 buscas após uma passada de aquecimento |
| Busca proxy, primeira passagem sem cache HTTP | média 17,5 ms; p95 29,9 ms | 30 buscas; cache de arquivos do Windows não foi limpo |
| Busca proxy, segunda passagem aquecida | média 18,1 ms; p95 39,4 ms | 30 buscas após uma passada de aquecimento |
| Atraso de início da palavra no proxy | média 0,166 ms; p95 0 ms; máximo 33,333 ms | 201 palavras observadas em 1.800 callbacks; comparação DOM/transcrição, não pixels |
| Scrub Fonte, arrasto automatizado de 10 s | 74,2 rAF/s; 1,8 callbacks de vídeo/s | chamando handlers da timeline, sem mouse físico |
| Scrub proxy, arrasto automatizado de 10 s | 75,0 rAF/s; 44,0 callbacks de vídeo/s | callbacks durante seeks podem exceder os 30 fps da Fonte |
| Trim Fonte / proxy, arrasto automatizado de 10 s | 75,0 / 75,0 rAF/s; 0,1 / 0,1 callbacks de vídeo/s | mover a borda não solicita quadro novo; não mede preview de trim |

Os renders ocorreram em sequência, mas com compilação do Tauri em andamento; os valores são indicativos. Os MP4s resultantes têm H.264, AAC, 1080×1920 e 60 s, verificados com ffprobe. O uso de VRAM do x264 é a ocupação total da GPU, não atribuição ao processo. A Fonte sintética extremamente simples favorece ambos encoders.

## Método, dados e limitações

As quatro séries foram feitas sequencialmente na mesma janela Tauri/WebView2, viewport 1200×900, com `document.hasFocus()` verdadeiro e `visibilityState` visível nos 120 pares de início/fim de busca. Cada série usa os mesmos 30 alvos distribuídos pelas duas horas, em ordem pseudoaleatória e com fases fracionárias variadas. A latência vai de `currentTime = alvo` até o callback do primeiro quadro com `mediaTime` a menos de 50 ms do alvo; não inclui clique físico nem mede a apresentação ótica. Os erros de `mediaTime` foram de -32,3 a -20,7 ms em ambas as mídias, dentro de um quadro de 33,3 ms. A captura do navegador mostra o relógio `01:05:28:07` em pedido de 3928,254 s, coerente com o quadro em 3928,233 s, mas não houve OCR sistemático.

Para a primeira passagem, a URL recebeu identificador novo e o servidor retornou `Cache-Control: no-store`; o cache HTTP do navegador não foi reutilizado para essa URL. Isso **não é cache de disco frio**: Windows, driver e decoder podem ter dados aquecidos, inclusive por testes anteriores, e não foram esvaziados. A passagem aquecida usou URL estável e uma série prévia com os mesmos alvos; não se verificou se o WebView2 reteve as respostas Range no cache HTTP, de modo que aquecimento do SO pode dominar. Assim os números são úteis para esta máquina e material, mas não se deve extrapolá-los para uma primeira leitura após reinicialização.

No teste de legenda, cada `requestVideoFrameCallback` registrou `mediaTime`, texto e índice do elemento destacado, foco e visibilidade. A análise compara o primeiro callback em que cada índice apareceu com o `start` correspondente em `transcript.json`, para as 201 palavras de 0 a 60 s: média 0,166 ms e p95 0 ms; o único atraso de 33,333 ms ocorreu na primeira palavra, pois o primeiro callback observado foi em 0,033333 s. Houve 0 divergências entre índice destacado e palavra esperada nos 1.800 callbacks. A comparação usa timestamps de transcrição e leitura independente do DOM, mas não captura composição, áudio ou pixels: não mede atraso percebido por uma pessoa. Como os começos sintéticos são múltiplos de 300 ms e os quadros são de 30 fps, os limites coincidem com quadros, favorecendo o resultado; repetir com transcrição e Fonte reais, temporizações entre quadros e gravação visual independente.

Os arrastos de 10 s invocaram diretamente os mesmos handlers de ponteiro da timeline a cada `requestAnimationFrame`; contam tanto chamadas rAF quanto callbacks `requestVideoFrameCallback`. Foco e visibilidade foram mantidos em todos os rAFs. rAF mede a cadência da UI, não a fluidez do vídeo; o scrub pode produzir callbacks de quadros solicitados fora de ordem e acima da taxa nominal. O trim não busca a borda e, portanto, um callback inicial de vídeo não significa preview fluido. Não foi feita avaliação de sensação por uma pessoa nem arrasto físico. Antes de fechar a escolha de produto, implementar preview da borda e repetir com mouse, métricas de frames apresentados, leitura fria real e VOD complexo.

Os registros completos estão em [medicoes-controladas.json](medicoes-controladas.json); `frames` contém o log por callback, `drift.entries` os inícios por palavra, e `seeks`/`drags` contêm amostras e contagens. Para repetir, com a mídia gerada e o servidor encerrado, crie a flag com `New-Item media/executar-medicoes.flag -ItemType File`, inicie `node server.mjs` e depois `cargo run --release` em `src-tauri`; mantenha a janela visível e focada por cerca de três minutos. O resultado será gravado em `media/rodada-controlada.json`; remova a flag depois para não executar automaticamente de novo. O ensaio altera início/fim, posição e mídia na janela, sem alterar os arquivos de mídia.

![Preview no Chromium do Orca](screenshots/preview.png)

## HyperFrames e riscos de plataforma

Foi estudado o formato de lista normalizada `{text,start,end}`, o componente `caption-pill-karaoke`, os atributos de faixa e os métodos de seek/range do player no commit `5bf361f`; **nenhum código foi copiado**, nem GSAP foi usado. O controle HTML e a legenda são implementações próprias para o experimento.

Linux usa WebKitGTK; macOS usa WKWebView. Os codecs e a implementação de mídia dependem das versões e da plataforma, então resultados do WebView2 não generalizam. Precisam de testes próprios com formatos e seeking reais; não há testes nesses sistemas. Referências: [versões do WebView no Tauri](https://v2.tauri.app/reference/webview-versions/) e [pesquisa da stack](https://github.com/GUSTAVOHOOO/clipes/blob/research/stack/docs/research/stack.md).
