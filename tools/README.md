# Ferramentas de estudo funcional

Scripts usados para estudar o Opus Clip, o Vizard e o vidIQ em sala limpa: usar o produto normalmente com uma conta própria e gravar o tráfego de rede (HAR). Os resultados estão em `docs/research/*-runtime-evidence.md`.

> **Nunca versione os HARs nem os perfis do navegador.** Eles contêm tokens de sessão e, no caso do Vizard, credenciais temporárias da AWS. O `.gitignore` bloqueia `*.har` e `profile*/`. Trabalhe numa pasta fora do repo.

## `har-capture/`: navegador gravando um fluxo

Requer Node 22+ e o Chrome instalado. Na pasta de trabalho (fora do repo): `npm i playwright`, depois copie `driver.mjs` e `cdp.mjs` para lá.

1. **Login (uma vez):** abra o Chrome normal, sem automação, com o perfil dedicado, e faça login à mão. O login do Google recusa navegadores automatizados.
   `chrome.exe --user-data-dir="<pasta>\profile" --no-first-run <urls>`, depois feche a janela.
2. **Gravar um fluxo:** `node driver.mjs <produto>-NN-<fluxo>`. Isso abre o mesmo perfil com automação e expõe CDP em `127.0.0.1:9222`.
3. **Dirigir:** escreva um passo `steps/<x>.mjs` que exporte `default async ({ page, context }) => …` e rode `node cdp.mjs steps/<x>.mjs`.
4. **Encerrar:** crie o arquivo `stop` na pasta. O HAR é salvo em `hars/<fluxo>.har` (mídia e assets ficam de fora; as APIs são gravadas com o corpo).

Para rodar navegadores em paralelo, use `CLIPES_PORT=9223 CLIPES_PROFILE=profile-x` e o arquivo `stop-9223`. Copie antes a pasta do perfil já logado.

Regras do estudo: usar só contas próprias, nunca burlar paywall, captcha ou detecção de automação, não publicar nada e não responder questionários em nome do usuário.

## `har-analysis/`: ler os HARs

- `har-endpoints.mjs <har>`: lista os endpoints de API (IDs trocados por `:id`).
- `har-shape.mjs <har>`: mostra a forma (chaves e tipos) das requisições e respostas JSON.
- `har-json-keys.mjs <har> <regex-url>`: lista os caminhos JSON de uma resposta.
- `har-sse.mjs <har>`: inspeciona as respostas em streaming (SSE). O Playwright não guarda o corpo do stream.

Para análise aprofundada, use o [REA](https://github.com/morluto/rea) sobre os HARs (veja `docs/research/2026-11-12-opusclip-runtime-evidence.md`).
