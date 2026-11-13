# Product

## Register

product

## Users

Uma pessoa que produz Cortes em volume para um ou mais Canais dark ou Canais de cortes. Trabalha horas por dia, num notebook Windows (RTX 3050, tela de 1366 a 1920 px), muitas vezes à noite, com a luz do quarto baixa. O trabalho é repetitivo: importar uma Fonte longa (live de 2 a 10 h), revisar os Cortes que o Provedor sugeriu, acertar bordas, legenda e enquadramento, e exportar em lote. Ela usa mouse e teclado, e o teclado é o que a deixa rápida.

## Product Purpose

O Clipes é uma fábrica local e open source (Apache-2.0) de Cortes 9:16 com legenda karaokê. Transcreve a Fonte no próprio PC, pede a um Provedor de LLM as Frases dos melhores trechos com uma Nota de 5 eixos e entrega Cortes prontos para revisar, editar e exportar. Sucesso é revisar e ajustar um Corte em menos de um minuto, sem procurar onde fica cada coisa.

## Brand Personality

Calmo, preciso, de oficina (direção "Foco", escolhida pelo dev em 13/11/2026). A interface recua e deixa o vídeo e a fala na frente. Fala PT-BR direto, com o vocabulário do GLOSSARY (Fonte, Corte, Transcrição, Frase, Nota, Narração, Empacotamento, Projeto, Perfil de canal, Provedor). Nunca "clipe", "short", "input" nem "IA" como substantivo.

## Anti-references

- O protótipo v2 do próprio Clipes: tudo visível ao mesmo tempo (lista, Fonte 16:9, preview, Transcrição, 4 presets, timeline, alças, silêncios, export). "Muito, muito confuso."
- Editores de Cortes online cheios de selos, gradientes, cores saturadas e botões "AI magic".
- Dashboards SaaS com cards de métrica e gradiente.
- Glassmorphism, emojis, neon.

## Design Principles

1. **A hierarquia resolve a densidade.** Nada de alvos pequenos nem contraste baixo para caber mais: o que não é da tarefa atual recua ou sai.
2. **O teclado é a interface principal, o mouse é o atalho visível.** Toda ação tem um comando na paleta Ctrl+K e, se frequente, uma tecla mostrada em `kbd`.
3. **O vídeo e a fala na frente.** Preview, timeline e Transcrição são o conteúdo; o resto é ferramenta.
4. **Familiaridade ganha.** Um editor profissional (trilho, preview, timeline) que qualquer pessoa que já editou vídeo reconhece. Inventar só onde a confusão estava.
5. **Encaixe por padrão.** Bordas em Frase, legenda pelo texto: o padrão já é o certo, e o ajuste fino fica um modificador adiante (Alt).

## Accessibility & Inclusion

WCAG 2.2 AA nos dois temas: texto ≥ 4,5:1, foco visível em todo controle, alvos de no mínimo 24 px, nada transmitido só por cor (estado tem texto ou ícone). `prefers-reduced-motion` respeitado em toda animação. Números tabulares em timecodes. PT-BR agora, EN depois: rótulos sem texto embutido em imagem e com folga para crescer 30%.
