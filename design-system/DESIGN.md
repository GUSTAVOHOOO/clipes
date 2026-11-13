# Design: Clipes, padrão Foco

A direção foi escolhida pelo dev em 13/11/2026 (#22): a **Variante F, "Foco"**. O editor abre só com o preview e a timeline. O resto chega pelas bordas, sob demanda, com paleta Ctrl+K e atalhos visíveis. O visual é grafite levemente quente, com âmbar só no playhead, na seleção e no foco.

## Princípios do Foco

1. **O essencial na frente, o resto na borda.** Cada tela abre com o mínimo para a tarefa atual. As ferramentas ficam em **gavetas de borda** (`components/shell/Gaveta.tsx`), que abrem com o mouse perto da borda ou por tecla e flutuam sem empurrar o conteúdo.
2. **Toda ação é um comando.** Registre com `useComandos` (`lib/comandos.tsx`): o mesmo objeto vira item da paleta e tecla. Se a ação é frequente, ela ganha `atalho` e o atalho aparece em `<Kbd>` perto do controle.
3. **Uma ação primária por tela.** O botão primário é o texto invertido (`variante="primario"`), nunca âmbar.
4. **Estado sempre com texto ou ícone.** A cor só reforça (`<Status>`).
5. **Calma visual.** Não usamos gradiente decorativo, vidro, emoji, cartões aninhados, eyebrow em caixa-alta, borda lateral colorida nem métrica gigante. A separação vem de 1 px de linha e de um degrau de luminância.

## Tokens (`src/styles/tokens.css`)

Usamos OKLCH em três camadas: as escalas primitivas (`--n-1…12`, mais `--amber-*`, `--red`, `--orange`, `--green` e `--blue`), que mudam por tema; os tokens semânticos, que os componentes leem; e os utilitários do Tailwind, gerados por `@theme inline` em `src/styles/index.css`. **As cores padrão do Tailwind estão zeradas**: `bg-neutral-800` não existe. Use só os utilitários abaixo.

| Utilitário | Token | Uso |
|---|---|---|
| `bg-canvas` | `--canvas` | palco do preview, fundo do app, o mais fundo |
| `bg-surface` | `--surface` | barras, painéis, gavetas, timeline |
| `bg-field` | `--field` | campos, botão secundário |
| `bg-hover` | `--hover` | hover sobre surface ou field |
| `bg-selected` | `--selected` | item atual, aba ativa, segmento marcado |
| `bg-raised` | `--raised` | menu, popover, paleta e aviso (com `shadow-popover`, `shadow-overlay` ou `shadow-dialog`) |
| `border-line` | `--line` | divisórias de 1 px |
| `border-line-strong` | `--line-strong` | borda de controle e de camada flutuante |
| `border-control-border` | `--control-border` | contorno de checkbox, radio e interruptor desligado (≥ 3:1) |
| `text-fg` / `text-fg-2` / `text-fg-3` | `--fg*` | texto principal, secundário e terciário (todos ≥ 4,5:1 em canvas, surface, field e selected) |
| `text-fg-disabled` | `--fg-disabled` | só em controle desabilitado |
| `bg-primary text-primary-fg` | `--primary*` | botão primário (texto invertido) |
| `bg-accent`, `text-accent-text`, `bg-accent-subtle`, `border-accent-line` | `--accent*` | **só** playhead, seleção atual, palavra ativa e foco |
| `text-danger`, `bg-danger-subtle` (e `warning`, `success`, `info`) | estados | erro, atenção, sucesso, informação, sempre com ícone |
| `bg-track`, `bg-wave`, `bg-handle`, `bg-playhead`, utilitário `hachura` | timeline | trilhas, onda, alças, playhead, silêncio hachurado |
| `bg-scrim`, `bg-letterbox` | camadas | fundo de diálogo e da paleta; tarja atrás do vídeo |

**Temas.** O escuro é o padrão; o claro é completo e usa os mesmos nomes. O tema vem de `data-theme` no `<html>` (`lib/tema.ts`) e `?tema=claro` força o claro na URL. Nunca escreva cor fixa num componente: as cores de **legenda** (conteúdo do vídeo, que vai para o libass) são a única exceção e moram nos dados (`presets`).

**Tipografia.** Inter Variable na UI e Geist Mono em timecode, tecla e caminho (utilitário `timecode` ou `font-mono tabular`). A escala é fixa: `text-2xs` 11 · `text-xs` 12 · `text-sm` 13 (base) · `text-md` 14 · `text-lg` 15 · `text-xl` 18 · `text-2xl` 22. Os pesos são 400 e 500; o 600 fica para o título da tela e do diálogo. Prosa tem no máximo 68ch.

**Espaço.** A grade é de 4 px (o `--spacing` padrão do Tailwind). Os controles têm 28 (`sm`), 32 (`md`) ou 36 px (`lg`), e o alvo mínimo é de 24 px. A barra superior tem 44 px.

**Raio.** `rounded-xs` 3 · `sm` 4 · `md` 6 (controles) · `lg` 8 (camadas) · `xl` 10 (gaveta, diálogo, paleta).

**Sombra.** Só em camadas que flutuam: `shadow-popover` (menu, dica), `shadow-overlay` (gaveta, aviso) e `shadow-dialog` (diálogo, paleta).

**Movimento.** As durações são `--dur-fast` 120 ms (hover, cor), `--dur-base` 160 ms (troca de estado, entrada de camada) e `--dur-slow` 220 ms (gaveta). As curvas são `ease-out` (quart) e `ease-out-expo`, sem bounce. O movimento serve só para estado. Com `prefers-reduced-motion`, as durações caem e a gaveta entra só com fade.

**z-index** (`style={{ zIndex: 'var(--z-…)' }}`): `sticky` 10 · `edge` 20 (puxadores) · `drawer` 30 · `dropdown` 40 · `scrim` 50 · `dialog` 60 · `palette` 70 · `toast` 80 · `tooltip` 90. Nunca use 999.

**Foco.** O utilitário `foco` desenha um anel âmbar de 2 px em `:focus-visible`; todo controle custom o usa. O foco nunca some.

## Arquitetura (`design-system/`)

```
src/
  styles/        tokens.css (temas) · index.css (Tailwind v4, @theme inline, utilitários)
  lib/           comandos.tsx (paleta + teclas) · formato.ts (tc, num, dur, usd, bytes)
                 tema.ts · rota.ts (hash) · app.tsx (estado de demonstração) · cn.ts
  data/          dados.ts + dados.json + img/ (Tears of Steel, CC-BY 3.0)
  components/
    ui/          primitivas sobre Base UI: Button, IconButton, Kbd, Tip, Campo/Input/Textarea,
                 Switch, Segmented, Abas, Menu, Popover, Dialog/Confirmar, Toaster/avisar,
                 Progresso, Status, Spinner…
    shell/       Tela (barra superior), Paleta, Gaveta (gavetas de borda), ContextoCorte
    editor/      timeline, preview 9:16, quadro 16:9, estado do editor
    domain/      linha de Corte, Nota de 5 eixos, linha de fila…
  screens/       uma pasta ou arquivo por tela da v1
  gallery/       galeria do design system (#/galeria/…)
scripts/         shots.ts (screenshots) · teclado.ts (teste de teclado) · contraste.ts
```

- **Base:** usamos [Base UI](https://base-ui.com) (`@base-ui/react`, MIT) no padrão shadcn: o código do componente fica no repo e os tokens são nossos. A documentação local está em `node_modules/@base-ui/react/docs/react/components/*.md`. Completam a base: `cmdk` (paleta), `sonner` (aviso), `@tanstack/react-virtual` (lista longa), `react-colorful` (cor da legenda) e `lucide-react` (ícones a 14–16 px, traço 1,75).
- **Rotas** (hash): `#/fontes`, `#/cortes`, `#/corte/:id/editar|transformar|empacotar`, `#/legenda`, `#/exportar`, `#/config/:secao`, `#/galeria/:secao`. A query depois do hash define os estados de revisão: `?estado=vazio|erro|carregando` e `?paleta`.
- **Telas** usam `<Tela titulo meio direita>`. As telas do Corte põem `<ContextoCorte/>` no `meio`.
- **Idioma:** PT-BR, com os termos do `GLOSSARY.md` (Fonte, Corte, Transcrição, Frase, Nota, Narração, Roteiro, Empacotamento, Projeto, Perfil de canal, Provedor, Permissão). Nunca usamos "clipe", "short", "input" nem "IA" como substantivo.

## Verificação

- `bun run build` (tsc + vite) sem erro.
- `node scripts/shots.ts --tamanhos 1440x900,1366x768 --temas escuro,claro <rotas>`: screenshot real no Chrome, sem erro no console.
- `node scripts/teclado.ts`: o teste de teclado de verdade cobre a paleta, as gavetas, os atalhos e as alças.
- `node scripts/contraste.ts`: os pares de texto e fundo dos dois temas contra a WCAG 2.2 AA.
