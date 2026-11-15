# Busca no proxy do Corte (#58)

Medição local em 15/11/2026, com o núcleo e o protocolo `clipes-media` reais, em Tauri debug/WebView2 no Windows 11. A Fonte é inteiramente sintética (`testsrc` + `sine`); nenhuma mídia de terceiros ou chamada a Provedor foi usada. Dados, cache e Projeto foram isolados por `CLIPES_DATA_DIR` numa pasta temporária, removida ao terminar.

| Mídia | Buscas | Mediana | p95 |
|---|---:|---:|---:|
| Fonte sintética, GOP de 10 s | 100 | 159,95 ms | 311,80 ms |
| Proxy do núcleo, GOP de 0,5 s | 100 | 14,50 ms | 166,30 ms |

O proxy reduziu a mediana em aproximadamente 11 vezes. A mediana ficou abaixo dos **~33 ms** citados na [resolução do protótipo #15](https://github.com/GUSTAVOHOOO/clipes/issues/15), mas a cauda p95 ficou acima: esta rodada não demonstra que toda busca termine em 33 ms. O arquivo histórico `prototypes/editor/RESULTADOS.md`, na branch `prototype/editor`, também distingue passagens e condições de cache; os números históricos não são uma meta de latência universal.

## Configuração

- AMD Ryzen 5 5600H, aproximadamente 15,35 GiB de RAM utilizável; outros agentes compilavam no mesmo computador durante o ensaio.
- Windows 11, WebView2 reportando Edge/Chromium 157, FFmpeg `8.1.1-full_build-www.gyan.dev`.
- Fonte: 300 s, 960×540, 30 fps, H.264 x264 `ultrafast`, GOP 300 quadros, `yuv420p`, AAC, `faststart`. A criação limitou o x264 a dois threads.
- Corte solicitado: 150–160 s da Fonte. O núcleo gerou a janela **30–280 s** (±2 min), portanto um proxy de 250 s, em **17,49 s**, incluindo espera pelos jobs locais anteriores da importação.
- Proxy: parâmetros efetivos de `core/src/proxy.rs`: altura máxima 540, x264 `veryfast`, 2.500 kb/s, quadros-chave forçados a cada 0,5 s, sem B-frames, `yuv420p`, áudio AAC 128 kb/s e `faststart`.

## Método e reprodução

Com Rust, Bun/Node, FFmpeg e ffprobe no PATH, a partir da raiz do repo no Windows:

```powershell
$env:CARGO_BUILD_JOBS='2'
cargo build -p clipes
node scripts/benchmark-preview.mjs > docs/research/2026-11-15-busca-no-proxy.json
```

O script inicia uma instância própria do app com dados isolados, conecta o Playwright à porta CDP exclusiva do WebView2 e chama `core_dispatch`: configura FFmpeg/cache, cria Projeto, registra a Fonte e pede `proxy.request`. O updater fica simulado para não consultar a rede. A porta 1420 deve estar livre; o script usa o Vite local para carregar a UI do app debug.

O vídeo de medição usa a moldura 9:16 em Fit e **o protocolo Tauri real**, tanto para `source/<id>` quanto para `proxy/<chave>`. Cada série inicializa o decoder e faz uma busca de aquecimento, separada das 100 amostras. Os alvos vêm de um gerador pseudoaleatório com semente 58, espalhados entre 1 e 248 s do proxy; a série da Fonte usa exatamente os mesmos momentos, somando o deslocamento de 30 s.

A latência começa antes de atribuir `currentTime` e termina no primeiro `requestVideoFrameCallback` cujo `mediaTime` difere do alvo por no máximo 50 ms. O maior erro observado foi **32,83 ms**, menor que um quadro de 33,33 ms. A mediana é a média das duas amostras centrais; p95 é a 95ª amostra na ordem crescente (nearest rank). A visibilidade registrada ao fim do ensaio foi `visible`. As 200 amostras, seus alvos e tempos de quadro estão no [JSON bruto](2026-11-15-busca-no-proxy.json), sem caminhos pessoais.

## Limites

Uma Fonte de cinco minutos com padrão sintético simples não representa uma live real de duas horas. O teste exercita a geração por janela, a busca, a decodificação e o Range do núcleo; não mede clique físico, composição ótica, áudio percebido, scrub contínuo ou export. As séries rodam primeiro na Fonte e depois no proxy, sem limpar caches do SO/decoder, e só têm um aquecimento inicial por mídia. Compilações concorrentes e agendamento do WebView2 podem aumentar a cauda. O protocolo limita cada resposta a 8 MiB e responde `Cache-Control: no-store`; isso não equivale a disco frio. Linux/WebKitGTK e macOS não foram medidos aqui.
