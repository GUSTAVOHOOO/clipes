# Avisos de contexto por Perfil (#146)

`provider.selection_state {profileId?, task?}` (`core/src/context_notice.rs`) diz se o contexto efetivo de um Perfil de Provedor comporta a seleção de Cortes. Termos no [glossário](../../GLOSSARY.md); planejador em [janelas-de-selecao.md](janelas-de-selecao.md).

## O que é e o que não é

- É uma **estimativa do perfil**, não da Fonte: roda `plan_for_profile` (#144) sobre uma Fonte sintética de referência, **fala densa de 60 min**. A UI a mostra como "estimativa para fala densa", nunca como portão: nenhuma escolha de perfil é desativada por ela. O estado real de uma Fonte é do #53, na hora de selecionar.
- Reaproveita o planejador inteiro: contexto efetivo do cache (#143), calibração de tokens (#140), limiar de preço (#141), teto de 15 min e janela mínima de 9 min. Sem rede, sem job, sem escrita.
- Estados: `full` (janelas de até 15 min), `reduced` (janelas mais curtas, mais chamadas e possíveis limitações), `blocked` (a seleção não roda com este perfil; outras Tarefas de IA que couberem continuam disponíveis). Perfis de CLI (`codex`, `claude`, `opencode`) devolvem `{"applicable": false}`: não medem contexto nem uso.
- O núcleo devolve só categorias e números (`state`, `contextTokens`, `origin`, `reference`, `guides`). O texto PT-BR/EN fica em `src/features/provider/selectionTexts.ts`.

## A Fonte de referência

| Constante | Valor | Origem |
|---|---|---|
| `DENSE_TOKENS_PER_MINUTE` | 385 | pesquisa #115, seção 6.2: formato H, fala densa, "valor conservador do regime denso" |
| `H_CHARS_PER_TOKEN_TENTHS` | 33 (3,3 caracteres por token) | pesquisa #115, seção 3.4: formato H mede 3,3 a 3,8; vale o pior caso |
| `DENSE_CHARS_PER_MINUTE` | 1 271 | 385 × 3,3, arredondado para cima; inclui o marcador `## hh:mm` e o id de cada linha |
| Frases por minuto | 12 | Frase de 5 s (a pesquisa mede 600 a 900 por hora) |
| Instrução e schema | ≈ 1,5 mil tokens | premissa P da seção 6.2; a instrução real é do #53 |
| Saída e raciocínio reservados | `DEFAULT_OUTPUT_RESERVE` (1 000) e 0 | planejador (#144) |

**Resultado medido sem calibração** (perfil `openai` sem limiar de preço, regra do #173: fala ×1,2, parte fixa ×1,0): 4 096 bloqueia; 7 936 bloqueia e 7 968 reduz (limiar medido); 8 192 reduz; 16 384 e 32 768 são cheios. Antes do #173 o planejador usava a ponta alta (×1,5) e 8 192 bloqueava. Depois da calibração vale a ponta alta calibrada. Os números são só referência; o estado vem do planejador (ver `janelas-de-selecao.md`).

## Instruções práticas

Texto fixo, conferido nas páginas oficiais em 2026-11-15. A UI só mostra as que valem para o perfil: perfil `ollama` → só `ollama_profile`; perfil `openai` em loopback → `ollama_server`, `lmstudio` e `llamacpp` (o tipo não distingue o servidor); remoto → texto genérico, sem trocar de Provedor sozinho.

| Rota | Texto | Fonte |
|---|---|---|
| `ollama_profile` | aumentar o campo "Contexto em tokens" do perfil, que é o `num_ctx` que o núcleo envia ao Ollama; a VRAM cresce | [Modelfile](https://docs.ollama.com/modelfile) (`PARAMETER num_ctx`); [contexto](https://docs.ollama.com/context-length): "Setting a larger context length will increase the amount of memory required to run a model." |
| `ollama_server` | no app do Ollama, o controle de tamanho de contexto, ou `OLLAMA_CONTEXT_LENGTH` ao iniciar o servidor | [contexto](https://docs.ollama.com/context-length): "Change the slider in the Ollama app under settings to your desired context length." e `OLLAMA_CONTEXT_LENGTH=64000 ollama serve` |
| `lmstudio` | definir o tamanho do contexto ("Context size") ao carregar o modelo, ou nos padrões do modelo | [por modelo](https://lmstudio.ai/docs/app/advanced/per-model): "When you load a model, you can optionally change the default load settings."; [load](https://lmstudio.ai/docs/developer/rest/load): `context_length` |
| `llamacpp` | iniciar o servidor com `-c` (`--ctx-size`), por exemplo `-c 16384` | [README do servidor](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md): `-c, --ctx-size N`, "size of the prompt context (default: 0, 0 = loaded from model)" |

Ponto de atenção: o assistente (#43) cria o servidor detectado como perfil `openai`. Nesse tipo o núcleo **não** envia `num_ctx`; o contexto do Ollama é o do servidor, por isso a rota `ollama_server`. Só o tipo `ollama` envia o valor do perfil como `num_ctx` (#143).

## Onde aparece

- **Perfil de Provedor** (`ProviderProfiles`): ao lado de modelo, contexto efetivo e origem, o quadro "Seleção com este perfil" mostra o estado e o que fazer. Refaz a consulta quando o contexto, o modelo ou o endereço mudam.
- **Assistente** (`TaskTable`, Preferências): a linha da Tarefa "Seleção de Cortes" mostra modelo, contexto, origem e estado do perfil escolhido; a sugestão do assistente (#43) é exibida com o estado do perfil sugerido e, se estiver bloqueado, deixa de oferecer "Aplicar" para a seleção (continua sugerida às demais Tarefas).
- Nenhum Provedor padrão de fábrica e nenhuma troca automática.

## Diagnóstico (ADR-0006, emenda "contexto efetivo e sua origem")

O diagnóstico ganha só duas linhas: `Contexto efetivo (tokens)` e `Origem do contexto efetivo`, lidas do cache (`effective_cached`, nunca sondando) da rota da Tarefa `selection`. A origem é uma das categorias fechadas do #143 (`user`, `loaded`, `server`, `catalog`, `fallback`, `measured`). Sem perfil, com CLI ou com qualquer erro, as duas linhas dizem `indisponível`, nunca o texto do erro. Nome do perfil, endpoint, caminho, resposta bruta, Transcrição, prompt e dados de `call_audit` não saem, e a revisão editável antes do envio continua obrigatória. Testes: `core/tests/context_notice.rs`.
