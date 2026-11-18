# Design system v2 do Clipes

Tokens, primitivas e componentes que todas as telas do front v2 usam. Grafite em degraus, um único laranja-sinal, separação por espaço. Regras e valores: [`DESIGN.md`](../DESIGN.md) na raiz.

## Galeria

```sh
cd design-system-v2
bun install
bun run dev        # http://127.0.0.1:5191
```

| Página | Endereço |
|---|---|
| Tokens (os dois temas lado a lado) | `#/tokens` |
| Primitivas com estados | `#/primitivas` |
| Componentes do catálogo | `#/componentes` |
| Tela de prova: Editor (variante D) | `#/tela/editor` |
| Tela de prova: Bancada (variante A) | `#/tela/bancada` |

Tema: seletor no topo ou `Alt+T`; `?tema=claro` força o claro (útil em captura headless). `?abrir=legenda#/tela/editor` abre uma ação da barra já na carga.

Verificação: `bun run typecheck`, `bun run build`, `bun run contraste` (contraste AA dos dois temas).

## No app

```css
/* CSS de entrada do app */
@import '../design-system-v2/src/estilos.css';
@source '../design-system-v2/src';
```

```ts
import { Botao, Tela, ContextoCorte, PlayerProxy } from '../design-system-v2/src'
```

Envolva a raiz em `<ProvedorDicas>` e `<ProvedorToast>`. O tema vai em `document.documentElement.dataset.tema` (`escuro`, o padrão, ou `claro`). `src/galeria/` é só da galeria e não faz parte da API.
