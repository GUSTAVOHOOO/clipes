# Protótipo descartável: 4 direções de design do Clipes (#22)

**Pergunta:** qual direção visual e qual hierarquia deixam o editor limpo, moderno, minimalista e de cores neutras? O protótipo v2 (#15) foi aprovado no fluxo, mas a UI ficou "muito, muito confusa".

**Como rodar:** `bun install` e depois `bun run dev`. A barra roxa no centro inferior troca a variante (`?variant=A..D`, Alt+←/→) e a tela (`?tela=importar|cortes|editor`, Alt+1/2/3). Ela não faz parte do design avaliado.

| | Direção | Ideia |
|---|---|---|
| A | **Estúdio** | Editor profissional clássico em grafite: trilho de Cortes, preview 9:16, inspector de uma aba por vez e timeline embaixo. |
| B | **Documento** | Tema claro, cor de papel. A Transcrição é a superfície principal e se edita pelo texto; o preview fica como um telefone à direita. |
| C | **Etapas** | Fluxo guiado: Importar → Revisar → Editar → Exportar, um Corte por vez na revisão, e um painel por vez no editor. |
| D | **Comando** | Monocromático claro, voltado ao teclado, com paleta Ctrl+K, quase sem chrome e Transcrição em fita. |

Os screenshots estão em `screenshots/`.

**Stack do protótipo:** React 19, Tailwind v4, lucide-react (ISC), cmdk e sonner (MIT), react-resizable-panels (MIT), e as fontes Inter, Geist e Geist Mono (OFL-1.1, via Fontsource).

**Atribuição:** os quadros, a onda e as falas vêm de *Tears of Steel*, (CC) Blender Foundation | mango.blender.org, sob a licença CC-BY 3.0.

Este é um código descartável. Ele nunca vai para o `master`: a direção escolhida é reescrita do zero na implementação.
