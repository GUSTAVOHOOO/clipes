# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

App de desktop (Tauri 2) com a interface em React numa WebView; Windows e Linux hoje, macOS depois. A interface também roda no navegador com o mock do núcleo (`VITE_CORE_MOCK=1`) para protótipos e testes E2E.

## Users

Pessoas que querem editar vídeos ou fazer Cortes a partir de lives e vídeos longos. Hoje o centro são os Canais de cortes (Corte direto) e os Canais dark (Vídeo transformado), que trabalham em volume, horas seguidas, muitas vezes num notebook Windows comum (tela de 1366 a 1920 px, GPU modesta ou nenhuma), e ficam rápidos pelo teclado. O público vai ser ampliado depois; a interface não deve exigir conhecimento técnico para o caminho principal.

## Product Purpose

O Clipes transforma lives e vídeos longos em vídeos curtos 9:16 prontos para postar, direto no computador de quem usa. Transcreve a Fonte localmente, pede a um Provedor escolhido pelo usuário os melhores trechos com uma Nota explicada, ajusta as bordas para não cortar Frases, sugere o enquadramento, gera legenda karaokê e exporta em lote com título, descrição, tags e capítulos. Sucesso é revisar, ajustar e exportar um Corte rápido, sem procurar onde fica cada coisa.

## Positioning

Gratuito e open source (Apache-2.0), roda na máquina do usuário e é agnóstico de Provedor (chave de API, modelo local ou assinatura que a pessoa já tem). Contra Opus Clip e Vizard: sem cobrança por minuto, sem subir o vídeo para a nuvem, sem marca d'água, Nota explicada em vez de nota opaca, custo estimado antes e real depois com teto que para o gasto.

## Operating Context

Fluxo em 3 macro-etapas por Projeto (um por canal): Fontes e Transcrição → Cortes (seleção e revisão; no Corte, Editar / Transformar / Empacotar) → Exportação (mesa de prontidão e lote). Lives de 2 a 10 h; jobs longos rodam numa fila que sobrevive ao fechar o app. Especificação completa em `docs/produto/funcionalidades.md` e `docs/produto/front-v2/`.

## Capabilities and Constraints

- Núcleo Rust completo (237 comandos via `core_dispatch` e evento `core-progress`); o front v2 é refeito do zero sobre ele.
- Transcrição sempre local; nada sai da máquina sem o usuário ver e confirmar; sem telemetria.
- Vídeo transformado nunca é 100% automático: Roteiro revisado e Narração (sintética, gravada ou importada).
- Vocabulário do `GLOSSARY.md` (Projeto, Fonte, Corte, Corte direto, Vídeo transformado, Transcrição, Frase, Nota, Narração, Empacotamento, Provedor). Nunca "clipe", "short", "input" nem "IA" como substantivo.
- PT-BR agora, EN depois: rótulos com folga para crescer ~30%, sem texto embutido em imagem.
- Em aberto (mencionado pelo dev, não decidido): ampliação do público e possível publicação direta em redes.

## Brand Commitments

Nome Clipes. Fala PT-BR direto e sem jargão de marketing. O design system antigo ("Foco") NÃO é base obrigatória: o visual do front v2 é escolhido de novo, a partir dos wireframes aprovados.

## Evidence on Hand

- Pesquisas de mercado e UX em `docs/research/` (Opus Clip, Vizard, vidIQ, canais dark, mapa total de UX de 17/11/2026).
- Benchmarks de transcrição e seleção em `benchmarks/` e `docs/research/2026-11-14-benchmark-transcricao.md`.
- Sem depoimentos, clientes ou números de uso: não inventar.

## Product Principles

1. **O vídeo e a fala na frente.** Preview, timeline e Transcrição são o conteúdo; o resto é ferramenta.
2. **O usuário decide.** Custo, privacidade e Provedor sempre visíveis antes de qualquer chamada paga ou saída de dados.
3. **Padrão certo, ajuste fino à mão.** Bordas em Frase, enquadramento sugerido e legenda pronta; o controle fino existe sem atrapalhar o caminho principal.
4. **Familiaridade ganha.** Quem já editou vídeo reconhece o editor; inventar só onde há confusão real.
5. **Teclado como caminho rápido.** Toda ação na paleta `Ctrl/Cmd+K`; as frequentes com atalho visível.

## Accessibility & Inclusion

WCAG 2.2 AA: contraste de texto ≥ 4,5:1, foco visível em todo controle, alvos ≥ 24 px, estado nunca só por cor, `prefers-reduced-motion` respeitado, teclas únicas desligáveis (WCAG 2.1.4), números tabulares em timecodes. Detalhes em `docs/produto/front-v2/01-arquitetura.md` §9.
