---
status: accepted
---

# Perfis múltiplos de Provedor, tarefa para perfil por regra fixa e "somente local" como veto

O Clipes permite vários **Perfis de Provedor** cadastrados ao mesmo tempo. Cada Tarefa de IA aponta para um perfil por uma regra fixa que o usuário escolhe. Decisão do dev em 14/11/2026, a partir da [pesquisa de roteamento (#113)](https://github.com/GUSTAVOHOOO/clipes/issues/113). Generaliza o [#43](https://github.com/GUSTAVOHOOO/clipes/issues/43) (Provedor por tarefa) sem quebrar quem já configurou, e mantém o [#13](https://github.com/GUSTAVOHOOO/clipes/issues/13) ("sem fallback automático").

A literatura de roteamento (RouteLLM, FrugalGPT, AutoMix) exige dados rotulados ou um sinal de confiança confiável, e o dataset do #28 tem só 38 segmentos humanos em 3 lives. Em dólares, rotear ganha pouco por Fonte: o valor real aqui é privacidade, cota de assinatura e disponibilidade. Uma regra fixa escolhida pelo usuário é o melhor equilíbrio entre evidência e esforço.

## As regras

1. **Perfil de Provedor** é um conjunto salvo com nome livre, tipo (`openai`, `anthropic`, `gemini`, `codex` ou `claude`), endpoint, modelo, preço e chave no cofre do sistema ([ADR-0004](0004-stack-tauri-react-nucleo-rust-worker-python.md)). Os CLIs viram perfis do tipo `codex` ou `claude`, mantendo a regra de experimental e desligado por padrão.
2. **Sem Provedor padrão de fábrica.** O mapa tarefa → perfil sai vazio; o assistente do #43 só **sugere**, marcado como "ainda não medido".
3. **Compatível com quem já configurou.** O endpoint único vira um perfil sintetizado na leitura. **A conta no cofre continua sendo o endpoint**, então perfis no mesmo endpoint compartilham chave e consentimento (o usuário digita a chave uma vez), e uma chave antiga nunca fica órfã. Os valores antigos de escolha por tarefa continuam resolvendo.
4. **Sem troca automática de Provedor** (fallback) na v1. Se o perfil falha, vem erro claro e troca manual. O que existe é o botão **"refazer com o forte"**, que o usuário aciona e em que **vê, antes, o perfil, o custo estimado e se o texto sai da máquina**. Ele pede confirmação, respeita o "somente local" e o teto, registra no Projeto qual perfil gerou o resultado, não troca nenhum padrão e nunca atua sobre um job `uncertain` ([ADR-0005](0005-projeto-portatil-com-sqlite.md)). Escalada automática por falha validada fica para depois, com experimento e ADR próprio.
5. **"Somente local" existe por tarefa e como veto por Projeto.** Por tarefa, é uma restrição nas configurações do app. Por Projeto, é um sinalizador no `project.sqlite`: o **Projeto não escolhe Provedor, só proíbe** envio para fora da máquina, e o veto viaja com o Projeto portátil ([ADR-0005](0005-projeto-portatil-com-sqlite.md)). Isso refina a regra do #43 de que o Perfil de canal não escolhe Provedor: nem o Projeto nem o Perfil de canal escolhem. O núcleo aplica o veto ao resolver a rota: um perfil não local gera o erro `local_only_violation` **sem chamada de rede**, e o log e o diagnóstico não levam texto nem nome do Projeto ([ADR-0006](0006-relato-de-problemas-sem-telemetria.md)).
6. **Local é só loopback.** Servidor na LAN não conta como local na v1: é remoto e exige consentimento. CLIs também não são locais. A localidade é **calculada** a partir do endpoint, nunca guardada, para não mentir se o DNS mudar.
7. **Perfis têm nome livre na v1.** Papéis prontos "rápido" e "forte" ficam para depois.

## Opções consideradas

- **Manter um endpoint e dois CLIs:** para usar um modelo barato no Empacotamento e um forte na seleção, o usuário reconfigura tudo a cada troca.
- **Papéis "rápido/forte" já na v1:** sem escalada automática, o papel é só um apelido, e é mais um conceito na UI.
- **Escalada e fallback automáticos:** contradizem o #13 e a história 31 da spec ("saber quem processou o quê"), podem levar texto de um perfil local para um remoto e transformam o custo em faixa. Exigem experimento ([#57](https://github.com/GUSTAVOHOOO/clipes/issues/57)) e ADR novo.
- **Roteador aprendido (RouteLLM, Not Diamond):** sem dados rotulados, e coletar uso para treinar contraria o ADR-0006.
- **Agregador como roteador (OpenRouter Auto):** um terceiro lê tudo e o modelo muda sem o usuário saber. Pode entrar como **um perfil** explícito do formato OpenAI.
- **Chave por perfil:** o usuário redigita a mesma chave para dois modelos da mesma conta. Migrar a chave de conta arriscaria perdê-la.
