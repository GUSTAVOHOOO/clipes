---
status: accepted
---

# Tarefas de IA como workflows fixos no núcleo Rust, sem agente e sem tool calling

O Clipes executa cada **Tarefa de IA** (seleção de Cortes, Empacotamento, Roteiro e tradução) como um **workflow fixo escrito em Rust no núcleo**: uma sequência de chamadas estruturadas ao Provedor, com portões determinísticos entre elas. Nenhuma tarefa usa tool calling nem decide sozinha o próprio fluxo. Decisão do dev em 14/11/2026, a partir da [pesquisa do harness (#114)](https://github.com/GUSTAVOHOOO/clipes/issues/114), em continuidade ao [#13](https://github.com/GUSTAVOHOOO/clipes/issues/13) ("chamadas estruturadas, sem agente com ferramentas") e ao [ADR-0004](0004-stack-tauri-react-nucleo-rust-worker-python.md).

As fontes oficiais da Anthropic, da OpenAI e do Google convergem: comece pela solução mais simples e só suba de nível com evidência medida. As subtarefas do Clipes são previsíveis (as janelas da Fonte são enumeráveis pelo tamanho dela), então não há o que um agente decidiria.

## O que a decisão fixa

1. **Uma Tarefa de IA declara** entradas, prompt versionado, schema de saída, verificadores determinísticos e orçamento. Roda como **job da fila persistida** ([ADR-0005](0005-projeto-portatil-com-sqlite.md)), com uma unidade idempotente por job (por exemplo, uma janela da Fonte ou um Corte) e checkpoint entre as chamadas.
2. **O prompt é versionado no repositório**, e a versão da tarefa é gravada junto de cada execução. Mudar o texto sem subir a versão falha num teste.
3. **O modelo só devolve IDs de Frase e texto sob schema, e o núcleo decide tudo.** A saída do modelo nunca vira comando, caminho de arquivo, URL, argumento de processo ou SQL. A Transcrição é texto de terceiros e entra sempre como campo de dados, nunca dentro da instrução. É o padrão "action-selector" contra prompt injection, e as janelas isoladas funcionam como "LLM map-reduce".
4. **Os tempos nunca passam pelo modelo** (já valia no [glossário](../../GLOSSARY.md)). Ajuste de bordas, deduplicação e ordenação são código, não chamada de IA.
5. **A trava do Roteiro é estado no núcleo** (bloco `pendente` ou `aprovado`), verificada no comando que gera ou importa a Narração, e não uma instrução de prompt ([ADR-0001](0001-dois-tipos-de-video-e-regras-de-transformacao.md), regra 5).
6. **A tarefa é uma função pura** com o Provedor injetável. O benchmark de seleção ([#57](https://github.com/GUSTAVOHOOO/clipes/issues/57)) e os testes chamam o mesmo código que roda no app.
7. **O harness é próprio e pequeno**: tarefa nova é uma função Rust mais um registro, sem DSL de grafo. Não se adota framework de agentes.
8. **Os guarda-corpos de monetização ([#76](https://github.com/GUSTAVOHOOO/clipes/issues/76)) não fazem chamada de IA na v1.**

## Agente só depois, com eval e ADR próprio

Uma tarefa só passa a usar um agente com ferramentas depois de (1) um eval mostrar que o workflow fixo perde e (2) um ADR próprio aprovar as ferramentas, que serão somente leitura sobre a Transcrição do Projeto: nada de rede, arquivo ou processo. O caso que pode pedir isso é o futuro de compilação com narrativa ([#11](https://github.com/GUSTAVOHOOO/clipes/issues/11)). Esse ADR precisará revogar ou emendar a decisão de "sem agente com ferramentas" do #13.

## Opções consideradas

- **Cada feature chama `provider.structured` direto:** não precisa de abstração nova, mas espalha orçamento, auditoria e retomada por quatro lugares, e o risco de repetir às cegas uma chamada incerta fica espalhado também.
- **Framework pronto (OpenAI Agents SDK, Claude Agent SDK, LangGraph, DSPy):** os maduros são Python ou TypeScript e levariam chaves, custo e auditoria para fora do núcleo, o que o ADR-0004 já recusou com o LiteLLM. O DSPy pode servir offline, para achar prompts melhores; o resultado é copiado para o repositório com versão.
- **Crate Rust de agentes (`rig-core`, `genai`):** trazem cliente HTTP próprio, que pularia o endurecimento do `send` (DNS fixado, sem proxy nem redirecionamento, regra de loopback, consentimento). São 0.x.
- **Agente autônomo com ferramentas na v1:** custo e tempo imprevisíveis, superfície de prompt injection muito maior, tool calling fraco em modelo local pequeno, e os CLIs rodam com ferramentas desligadas ([#39](https://github.com/GUSTAVOHOOO/clipes/issues/39)).
