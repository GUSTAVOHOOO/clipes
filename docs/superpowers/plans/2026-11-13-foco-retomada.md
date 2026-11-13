# Retomada do design system Foco

> **For agentic workers:** usar as áreas abaixo como limites de edição; integração e verificação pelo orquestrador.

**Goal:** concluir a demonstração interativa de todas as telas e componentes do #22, segundo a direção Foco já aprovada.

**Architecture:** React com rotas hash, estado de sessão em AppProvider, comandos compartilhados pela paleta e pelo teclado. Primitivas Base UI usam os tokens OKLCH existentes. Operações do núcleo aparecem como demonstração; nenhum segredo é armazenado pela página.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 4, Base UI, Bun e Playwright com Chrome instalado.

## Restrições globais

- PT-BR e vocabulário do GLOSSARY; uma ação primária por tela.
- Preview e timeline em primeiro plano; ferramentas em gavetas sob demanda.
- Temas claro/escuro, texto AA, foco visível, alvos de pelo menos 24 px e movimento reduzido.
- Servir localmente na porta 5180; não abrir PR, não fazer merge e não fechar #22 sem aprovação.

## Entregas independentes

- [x] Editor: `src/components/editor/`, `screens/editor/`, `screens/legenda/`; preview, timeline, crop, keyframes, legendas e `scripts/teclado/editor.ts`.
- [x] Lote: `screens/Fontes.tsx`, `Cortes.tsx`, `Exportar.tsx`, `components/domain/`; Permissão, revisão, Nota, fila e `scripts/teclado/lote.ts`.
- [x] Transformação: `screens/transformar/`, `screens/empacotar/`; revisão de Roteiro, Narração, ducking, capa e `scripts/teclado/transformar.ts`.
- [x] Integração: `components/ui/`, `gallery/`, `screens/config/`; primitivas faltantes, galeria navegável, Provedor, downloads, aparência, diagnóstico e `scripts/teclado/sistema.ts`.

## Ciclo de validação

1. Escrever teste de interação real para o comportamento ausente e constatar a falha.
2. Implementar cada área usando os contratos existentes em `lib/app.tsx`, `lib/comandos.tsx`, `lib/rota.ts` e `DESIGN.md`.
3. Rodar `bun run typecheck`, `node scripts/teclado.ts`, `node scripts/contraste.ts` e `bun run build`.
4. Capturar as rotas, estados e gavetas em 1440×900 e 1366×768, nos dois temas; inspecionar as imagens e corrigir problemas.
5. Registrar atribuições e limites, revisar o diff, commitar na branch `design-system` e registrar progresso em #22. Entregar localhost para revisão do dev.

Evidência da implementação e dos ajustes de integração: [verificação](../verification/2026-11-13-foco.md). O fechamento do #22 depende da revisão e aprovação do dev.
