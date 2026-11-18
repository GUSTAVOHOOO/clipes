# HANDOFF · design-system-v2

Rodadas 1, 2 e 3 prontas (tokens, primitivas, componentes, galeria, telas de prova, `DESIGN.md`, `README.md`). Sobra só conferência interativa, que captura headless não alcança.

## Estado verificado (18/11)

- `bun run typecheck` e `bun run build` limpos (build com `chunkSizeWarningLimit: 800`, porque a galeria embute tudo num pacote).
- `bun scripts/contraste.ts`: todos os pares passam nos dois temas.
- `impeccable detect --json design-system-v2/src`: `[]` (nenhum achado).
- Capturas Edge headless conferidas: Editor 1366×768 escuro e claro, Editor 1440×900 escuro, Editor com popover Legenda aberto, Bancada 1366×768 escuro e claro, Bancada 1440×900 escuro, Tokens, Primitivas (escuro e claro) e Componentes. Comparadas lado a lado com `prototipo/editor.html?variant=D` e `prototipo/revisao.html?variant=A`.

## Rodada 3: o que foi feito

- Galeria (`index.html`, `src/main.tsx`, `src/galeria/`): rotas `#/tokens`, `#/primitivas`, `#/componentes`, `#/tela/editor`, `#/tela/bancada`; tema por seletor, `Alt+T` ou `?tema=claro`; `?abrir=<ação>` abre uma ação da barra do Editor na carga.
- `src/galeria/galeria.css` redefine as variantes `hover` e `focus-visible` do Tailwind para também casarem `.demo-hover`/`.demo-foco`; assim os estados forçados usam as mesmas classes dos componentes. Só a galeria importa esse CSS.
- `TimelineEditor`: marcas em passos redondos (00:10, 00:20…) e a última no fim da janela, como no protótipo (antes eram 5 marcas equidistantes, 00:09/00:19…).

## Falta conferir à mão (com ponteiro e teclado)

- `Slider`: anel de foco via `has-focus-visible` no `Thumb`.
- `ConfirmDialog`: foco inicial no Cancelar; `Paleta` (cmdk dentro do Dialog): foco no input e setas.
- `Toast`: entrada e saída empilhando.
- `TimelineEditor`: arraste da agulha com pointer capture.
- Popover da `BarraAcoes`: ao abrir por teclado o foco vai para o botão Fechar (comportamento do Base UI); avaliar se deveria ir ao primeiro controle.

Se tudo isso passar, este arquivo pode ser apagado.
