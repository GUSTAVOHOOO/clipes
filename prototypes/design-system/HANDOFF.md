# Handoff: design system do Clipes (#22), com base na Variante F "Foco"

Data: 13/11/2026. Quem passa: o orquestrador do mapa wayfinder (#1). Quem recebe: um novo orquestrador Claude, que dispara agentes e usa a skill **impeccable**.

**Fale sempre com o dev em PT-BR.**

## 1. Decisão do dev
O dev viu 8 direções (A a H) neste protótipo e escolheu: **"a Foco tá linda demais, gostei muito da ideia dela, vamos fazer um design system com base nela"**.

- **Variante F, "Foco":** é o Estúdio com a densidade sob demanda. O editor abre só com o preview e a timeline. A gaveta de Cortes, na borda esquerda, e a de ferramentas, na direita (Transcrição, Legenda, Enquadrar, Áudio), abrem com o mouse perto da borda ou por tecla. Elas flutuam sem empurrar o preview e fecham quando você volta a editar.
- **Estilo:** grafite levemente quente (OKLCH, croma de 0,004 a 0,008), com âmbar só no playhead e na seleção. Paleta Ctrl+K com `cmdk` e atalhos visíveis em `kbd`.
- **Código:** branch `prototype/design-system`, commit `a88e05b`, pasta `prototypes/design-system/`:
  - `src/variantes/VarianteF.tsx` e `src/variantes/F/` (Editor, Cortes, Importar, comum);
  - `src/variantes/nucleo/`, a base comum de F, G e H: estado do editor, Timeline, Preview, Paleta e tokens;
  - `PRODUCT.md` e `DESIGN.md`: rascunhos que o agente da impeccable escreveu sem o dev, a partir do conhecimento abaixo. Revise e confirme com o dev;
  - screenshots: `screenshots/F-*.png`, mais as outras direções para comparação.
- **Para rodar o protótipo:** `bun install` e depois `bun run dev`. A barra roxa troca de variante e de tela (`?variant=F&tela=editor|cortes|importar`).
- **Ressalva:** a F foi conferida por screenshot, mas o teclado, o hover das bordas e a paleta **não foram testados clicando de verdade**.

## 2. Histórico de feedback do dev (o porquê)
1. Protótipo v1 do editor: o dev disse "tá uma merda".
2. Protótipo v2 (#15): o fluxo ficou "muito bom", mas a UI ficou **"muito, muito confusa"**, porque tudo aparecia ao mesmo tempo.
3. Ele pediu uma UI "bem moderna e minimalista, de cores neutras, bem clean".
4. Das direções A a D, gostou do **Estúdio (A)**, mas o quer **mais minimalista**, e achou os **comandos (D)** "uma ideia muito boa".
5. Das direções E a H, escolheu a **F, "Foco"**.
6. **Ele não quer Artifacts nem páginas publicadas.** Tudo roda **localmente no PC**: sirva com `bun run dev` e passe o `localhost`.

## 3. O que precisa ser entregue (o ticket #22)
O ticket está em `gh issue view 22 --repo GUSTAVOHOOO/clipes --comments`.

1. **Fundação:**
   - tokens em OKLCH para cor (escuro por padrão e uma versão clara completa), tipografia, espaçamento, raio, sombra, movimento e escala de z-index;
   - ícones Lucide;
   - estados (hover, foco, desabilitado, erro e carregando);
   - contraste AA medido.
2. **Componentes:**
   - botões, campos (inclusive campo numérico com scrub), toggles, segmentados, abas, menus, menu de contexto, tooltips e popovers, diálogos, toasts e listas virtualizadas;
   - `kbd` e paleta de comandos;
   - **gavetas de borda** do Foco;
   - **timeline**: régua, miniaturas, onda, Frases, alças com encaixe em Frase e Alt para soltar, playhead e silêncios hachurados;
   - preview 9:16 com legenda karaokê;
   - quadro 16:9 com crop e keyframes;
   - cartão ou linha de Corte com Nota e 5 eixos;
   - barra de progresso fina e linhas de fila.
3. **Telas da v1 no padrão Foco:**
   - Importar Fonte, com Permissão, Projeto e fila;
   - Cortes, com revisão, Nota, lote e custo;
   - editor do Corte;
   - estilo da legenda;
   - **Vídeo transformado** (Roteiro revisado, Narração por TTS, gravação com teleprompter ou áudio importado, e ducking);
   - **Empacotamento**;
   - export em lote;
   - configurações de **Provedor** (API, local ou Codex CLI, consentimento e chaves no cofre);
   - tela de **Componentes**, para downloads sob demanda com tamanho e licença;
   - "Exportar diagnóstico";
   - estados vazios e de erro.
4. **Aprovação do dev antes de fechar o #22.**

## 4. Conhecimento acumulado (leia antes de desenhar)
- **Produto, usuário e decisões da v1:** a fonte é o mapa (#1, `gh issue view 1`), o `GLOSSARY.md` e os ADRs 0001 a 0005 em `docs/adr/` no `master`. Use os termos do glossário: Fonte, Corte, Transcrição, Frase, Nota, Narração, Roteiro, Empacotamento, Projeto, Perfil de canal, Provedor, Permissão. Não use "clipe", "short", "input" nem "IA" como substantivo.
- **Stack (ADR-0004):** Tauri 2 com WebView2, WebKitGTK e WKWebView, mais React 19 + TS, **Bun** e Tailwind v4. A UI só exibe e edita; o núcleo Rust faz o resto.
- **Licença (ADR-0003):** Apache-2.0. Toda dependência, fonte ou ícone precisa ser compatível. Registre as atribuições em `THIRD_PARTY_NOTICES.md`.
- **Pesquisas de design** (em `git show origin/<branch>:docs/research/<arquivo>`):
  - `research/ds-bases-headless`, arquivo `2026-11-13-ds-bases-headless.md`: recomenda **shadcn/ui sobre Base UI**. As alternativas são Ark UI e React Aria.
  - `research/ds-bibliotecas-completas`, arquivo `2026-11-13-ds-bibliotecas-completas.md`: Chakra v3 e Mantine. A Joy UI está pausada.
  - `research/ds-pecas-de-editor`, arquivo `2026-11-13-ds-pecas-de-editor.md`:
    - layout: `react-resizable-panels`;
    - timeline: própria, com wavesurfer.js como opção para a onda;
    - utilitários: `cmdk`, `sonner`, TanStack Virtual, `react-colorful` e dnd-kit;
    - ícones e fontes: Lucide, Inter e Geist Mono;
    - cores: tokens semânticos sobre uma escala no estilo Radix Colors;
    - princípios de Linear, Geist, Raycast, Figma, DaVinci e CapCut, só como estudo.
  - O consenso das três: **a hierarquia resolve a confusão, não a biblioteca**.
- **O dev trabalha** num notebook Windows com RTX 3050, em telas de 1366 a 1920 px, muitas vezes à noite, produzindo Cortes em volume. Teclado e calma visual importam mais que enfeite.

## 5. Como trabalhar
- **Skill impeccable:** carregue-a com `Skill` (`impeccable`). Os scripts estão em `C:\Users\Windows 11\AppData\Roaming\orca\claude-profiles\8c293a5e-ccac-42d1-ae2c-0c81fc1ecbfa\home\skills\impeccable\scripts\`; rode-os com `node "<caminho absoluto>"`. O registro é **`product`**. Use os comandos `document`/`extract` (para tirar os tokens da F), `shape`, `craft`, `critique`, `polish` e `audit`. Rode o `detect.mjs` nos arquivos gerados.
- **Agentes:** dispare-os em paralelo para componentes e telas independentes, com subagentes Claude ou workers Orca, se precisar de workspace próprio. **Cada agente carrega a impeccable** e recebe este handoff. Você define os tokens e a arquitetura primeiro, integra e revisa tudo.
- **Onde:** uma branch nova `design-system` a partir de `origin/master`, com o código numa pasta própria (por exemplo, `design-system/`, um app Vite + React + Tailwind v4 + Bun, com uma galeria de componentes e as telas) e o `DESIGN.md` final. Pode reaproveitar e reescrever o código da F e do `nucleo/`, mas é código de protótipo: **reescreva com qualidade**.
- **Verificação com evidência:** `bun x vite build` sem erro, screenshots reais com o Chrome headless em 1440×900 e 1366×768, nos dois temas, olhando cada um, mais **teste real de teclado**: paleta, gavetas, atalhos e alças. Rode também um teste de contraste.
- **Para o dev ver:** sirva localmente e passe o `localhost`. **Sem Artifacts.**

## 6. Limites
- **Não faça merge no `master` e não abra PR** sem o dev pedir. Faça push só da branch `design-system`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sem segredos, e-mails ou tokens no repo. **Nunca leia nem comite** `C:\Users\Windows 11\clipes-hars\`.
- Nada de assets, marcas ou código de Opus Clip, Vizard, vidIQ, CapCut, Linear ou Vercel.
- Registre o progresso no #22 com comentários curtos. Ao fechar, poste a resolução e adicione uma linha em "Decisions so far" no corpo do #1: `gh issue view 1 --json body -q .body > map.md`, edite e rode `gh issue edit 1 --body-file map.md`.
- Use `py` para Python (`python` não existe). O cargo está em `C:\Users\Windows 11\.cargo\bin`. O Bun 1.3 está instalado.
