# Contrato real de Provedores (#122)

## Plano e método

Data da execução: 15/11/2026, Windows. O roteiro manual usa o crate
`clipes-core`, os adaptadores reais e o mesmo despacho headless da aplicação.
Os testes automáticos usam apenas servidores falsos, sem inferência nem rede externa.

1. Registrar capacidades como dados por adaptador e testar pelo despacho headless.
2. Substituir decisões de capacidades nos adaptadores pelo registro, preservando o contrato.
3. Executar o roteiro manual ignorado com prompts sintéticos próprios, contagem persistente
   de chamadas (incluindo reparos/retries), chaves somente por caminho e dados isolados.
4. Registrar matriz, limitações e pendências; verificar localmente e aguardar CI.

Nenhum prompt contém material do dataset #28 ou dados do usuário. O schema fio
contém objeto, campos obrigatórios, `additionalProperties: false`, tipos, enum e
array. O núcleo valida a resposta; aceitação HTTP não prova aplicação de gramática.
Uma amostra sem schema nativo mede JSON inválido antes/depois do único reparo.
Uma amostra com saída máxima de um token verifica o sinal de truncamento.
Recusa não é provocada com conteúdo nocivo: usa-se um pedido sintético de recusa,
cuja ausência de sinal não prova que o modelo nunca recusa.

Tetos autorizados: Groq 60; OpenRouter 150; Claude Code 5; Codex 5;
OpenCode uma tentativa. As consultas de descoberta também entram na contagem.
Não há retries ilimitados nem instalação de servidores locais.

## Descoberta inicial

OpenRouter: `/models` listou 14 IDs `:free`; `/key` informou somente para esta
medição a cota gratuita disponível de 1.000/dia. Nenhum identificador de conta,
saldo, chave, header ou resposta bruta foi guardado. O campo `rate_limit` dessa
API está obsoleto. O limite documentado é 20 requisições/minuto; 50/dia sem
compra acumulada de US$10, ou 1.000/dia após essa compra.
Fontes: [limites oficiais](https://openrouter.ai/docs/api_reference/limits),
[saída estruturada](https://openrouter.ai/docs/guides/features/structured-outputs).

Groq: `/models` confirmou `openai/gpt-oss-120b`, `openai/gpt-oss-20b` e
`qwen/qwen3.8-27b` (também havia um modelo safeguard, fora da matriz de geração).

Ollama, LM Studio e llama.cpp: **não testado: não instalado**. O roteiro fica
disponível para execução posterior pelo desenvolvedor, sem instalar serviços.

## Registro de capacidades

As capacidades descrevem o contrato implementado pelo adaptador; observações
reais por modelo são evidência separada, não uma garantia universal do serviço.
Contexto e saída máximos por modelo pertencem ao catálogo #141; o registro
aponta para o catálogo e para a descoberta #143, sem duplicar limites numéricos.

`provider.capabilities {}` devolve os sete registros. Com `{kind, model}` devolve
o registro resolvido e a observação datada desse modelo, quando existe; modelo
desconhecido mantém `model_dependent`. `accepted_and_validated` quer dizer que
uma requisição com schema nativo foi aceita e sua resposta passou na validação
local; **não prova** que o servidor aplicou gramática. `not_observed` não desativa
schema nem troca Provedor. O serviço da observação acompanha o dado: uma
observação no Groq não promete igual comportamento em outro host compatível.

O valor `model_catalog` em `contextSources` aponta para `provider::cost::price_for(kind, model)`
e para o despacho `provider.prices.get`: `contextWindow`, `maxOutput`,
`limitsSource` e `updatedAt` são os campos do catálogo #141. O registro não contém
esses números. Ausência no catálogo continua sendo desconhecida;
`server_discovery` aponta para a descoberta de contexto efetivo do #143, que
deve conferir a configuração carregada, especialmente no Ollama. `cli_runtime`
indica o limite do ambiente do CLI, sem assumir o máximo da API como efetivo.

| Adaptador | Schema enviado | Usage exposto pelo núcleo | Recusa tipada | Truncamento tipado |
| --- | --- | --- | --- | --- |
| `openai` | `response_format.json_schema` | prompt/completion tokens | `message.refusal` não vazio | `finish_reason` |
| `anthropic` | `output_config.format` | input/output tokens | não implementado | `stop_reason` |
| `gemini` | `generationConfig.responseJsonSchema` | prompt/candidates + thoughts | não implementado | `finishReason` |
| `ollama` | `format`, sempre, e schema no prompt | prompt/eval counts | não implementado | `done_reason` |
| `codex` | `--output-schema` | nulo (cota do plano) | não implementado | não implementado |
| `claude` | `--json-schema` | nulo (cota do plano) | não implementado | não implementado |
| `opencode` | schema no prompt isolado | nulo (contagem de chamadas) | não implementado | evento `step_finish`, `part.reason` |

Mantidos os comportamentos anteriores: um reparo quando schema nativo está
desligado; com schema nativo, erro de validação imediato em HTTP, exceto Ollama,
que continua podendo reparar uma vez. Truncamento e recusa não são reparados.
Não foram acrescentados adaptadores nem inferências automáticas.

## Matriz e resultados

Cada modelo HTTP recebeu três textos normais com schema nativo e três com schema
apenas no prompt, mais um teste de truncamento e um pedido sintético de recusa.
Os números `x/3` indicam respostas válidas, não apenas HTTP 200. A coluna de JSON
inválido usa somente respostas normais recebidas sem truncamento no modo prompt;
erros de serviço e truncamentos ficam separados e não viram JSON inválido.
Aqui “JSON inválido” corresponde ao erro `invalid_json` do núcleo: texto que não
é JSON válido **ou** JSON que falha no schema. O roteiro não exporta respostas
brutas para classificar esses dois casos separadamente.

| Serviço / ID exato | Válido nativo | Válido prompt | JSON inválido antes → depois do reparo | Usage completo¹ | Truncamento forçado | Mediana válida normal² |
| --- | ---: | ---: | --- | ---: | --- | ---: |
| Groq / `openai/gpt-oss-120b` | 3/3 | 3/3 | 0/3 → 0/3 | 8/8 | nativo: HTTP 400; prompt: `output_truncated` | 3.103 ms |
| Groq / `openai/gpt-oss-20b` | 3/3 | 3/3 | 1/3 (33,3%) → 0/3 | 8/8 | nativo: HTTP 400; prompt: `output_truncated` | 3.050 ms |
| Groq / `qwen/qwen3.8-27b` | 3/3 | 3/3 | 0/3 → 0/3 | 8/8 | nativo: HTTP 400; prompt: `output_truncated` | 3.067 ms |
| OpenRouter / `inclusionai/ling-3.2-flash:free` | 3/3 | 2/3 | 0/2 → 0/2 | 7/7 | `output_truncated` | 5.237 ms |
| OpenRouter / `baidu/ernie-5.5-flash-preview:free` | 3/3 | 3/3 | 0/3 → 0/3 | 8/8 | `output_truncated` | 2.780 ms |
| OpenRouter / `liquid/lfm-3-1.7b:free` | 2/3 | 2/3 | 0/2 → 0/2 | 5/5 | `output_truncated` | 11.017 ms |
| OpenRouter / `particle-ai/particle-1:free` | 3/3 | 3/3 | 0/3 → 0/3 | 8/8 | `output_truncated` | 2.982 ms |
| OpenRouter / `thinkingmachines/inkling-2-small:free` | 0/3 | 0/3 | não mensurável | não mensurável | erro HTTP | não mensurável |
| OpenRouter / `nvidia/nemotron-3.5-lightning:free` | 2/3 | 2/3 | 0/2 → 0/2 | 8/8 | `output_truncated` | 6.765 ms |
| Claude Code / `claude-opus-5-5` | 2/2 | não aplicável | 0/2; sem reparo no CLI | nulo | limite não exposto pelo adaptador | 5.001 ms |
| Codex / `gpt-6.1-sol` | 2/2 | não aplicável | 0/2; sem reparo no CLI | nulo | limite não exposto pelo adaptador | 6.158 ms |
| OpenCode / `opencode/big-pickle` | pendente: cota gratuita | pendente | não mensurável | nulo | não mensurável | não mensurável |
| Ollama, LM Studio, llama.cpp | não testado: não instalado | — | — | — | — | — |
| APIs Anthropic, Gemini e OpenAI direta | não testado: sem chave autorizada | — | — | — | — | — |

¹ Denominador: respostas recebidas com conteúdo ou sinal de truncamento, incluindo
o pedido sintético de recusa e o truncamento extra por prompt no Groq; exclui
erros HTTP/429. No reparo, o núcleo somou usage das duas chamadas. Usage completo
significa `inputTokens` e `outputTokens` numéricos, não uma auditoria da cobrança
do serviço. Respostas de erro sem usage continuam desconhecidas, nunca zero.

² Mediana das requisições normais válidas, incluindo reparo e o espaçamento de
3,1 s do roteiro quando necessário. É latência ponta a ponta do experimento,
não tempo puro de inferência nem benchmark de velocidade. Amostras pequenas,
sem inferência estatística sobre qualidade; nenhum dos resultados prova
capacidade universal do modelo. Dataset sintético fixo consta em
`core/src/provider/contract_probe.rs`.

Observações específicas:

- O Groq reparou exatamente uma resposta de `openai/gpt-oss-20b`; o resultado
  final passou no schema. Os três modelos devolveram HTTP 400 com schema nativo
  e `max_output_tokens=1`. A rodada complementar, com o mesmo teto e schema
  apenas no prompt, devolveu HTTP 200 e `output_truncated` nos três. Isso mede
  uma diferença entre os modos; não foi inventada uma causa para o HTTP 400.
- OpenRouter funcionou no adaptador `openai` existente: mesmo endpoint base,
  `response_format`, usage e erros tipados. O catálogo anunciava saída estruturada
  em quatro dos seis modelos escolhidos; `nemotron-3.5-lightning:free` não a
  anunciava, mas aceitou o pedido e produziu JSON validado em duas amostras.
  Isso não prova que o schema foi aplicado pelo servidor. O registro guarda
  observações por modelo, sem forçar ou desativar opções do Perfil de Provedor.
- `ling-3.2-flash:free` teve um 429 **sem `Retry-After`**, sem usage: o núcleo
  devolveu `rate_limit` e não repetiu. Não houve 429 no Groq. Não se provocou uma
  tempestade de requisições para esgotar cota. Retry com segundos e data HTTP,
  limite de tentativas e cancelamento continuam cobertos por servidor falso.
- `liquid/lfm-3-1.7b:free` teve três erros HTTP entre as oito amostras, incluindo
  o pedido de recusa. `nemotron-3.5-lightning:free` truncou uma amostra normal de
  cada modo mesmo com teto 1.024, e o núcleo preservou usage e sinalizou a falha.
- `inkling-2-small:free` falhou nas oito amostras. Duas sondagens complementares,
  uma de cada modo, confirmaram **HTTP 403** com e sem schema. Não se atribuiu o
  erro ao suporte a schema nem se alterou a privacidade da conta para contorná-lo.
- Nenhum pedido sintético produziu sinal de recusa nas respostas recebidas.
  Nos CLIs ambos os pedidos de recusa também validaram JSON. A detecção real de
  uma recusa continua não comprovada nesta matriz; o servidor falso confirma
  que o campo OpenAI vira erro `refusal`, sem reparo nem cópia do texto ao erro.
- OpenCode v2.2.7: a única tentativa levou 3,88 s no harness e retornou
  `cli_free_limit`, com espera indicada de 32.536 s. **Pendente: cota gratuita.**
  Nenhum login, chave ou outra tentativa foi usado para contornar a cota.
- Versões: Codex CLI **0.169.0**, Claude Code **2.1.325**, OpenCode **2.2.7**;
  Rust **1.100.0**. IDs dos dois CLIs foram observados na saída do processo
  capturada pelo núcleo, exportando somente o ID por allowlist em teste.

Contagem final, incluindo descoberta e reparo: **Groq 29/60**, **OpenRouter
52/150**, **Claude Code 3/5**, **Codex 3/5**, **OpenCode 1/1**. Foram 24 amostras
principais no Groq, um reparo, três truncamentos complementares e uma descoberta;
48 no OpenRouter, duas sondagens complementares e duas consultas de descoberta.
Todos os tetos foram respeitados. A chave do OpenRouter foi usada antes da
expiração informada de 21/11/2026. O ledger e os logs de metadados ficam fora do
repositório; o relatório não contém credenciais nem dados de conta.

## Reproduzir manualmente

O ponto de entrada é `scripts/provider-contract.ps1` (PowerShell 7), que executa
apenas o teste ignorado `provider::contract_probe::real_provider_contract` no
núcleo. Não roda no CI. Execute na raiz, com Cargo no PATH. O roteiro cria
`CLIPES_DATA_DIR` temporário, não altera os Perfis de Provedor reais nem grava
chaves no cofre. Para HTTP chama os mesmos adaptadores do núcleo com consentimento
explícito deste experimento; para CLI usa `provider.cli.*` e `provider.structured`
pelo despacho. Não cria jobs nem altera Projetos: mede somente o contrato.

```powershell
$env:CLIPES_OPENROUTER_KEY_FILE = Join-Path "$env:USERPROFILE/.clipes-keys" 'openrouter.txt'
./scripts/provider-contract.ps1 -Service openrouter -Models 'inclusionai/ling-3.2-flash:free,baidu/ernie-5.5-flash-preview:free,liquid/lfm-3-1.7b:free,particle-ai/particle-1:free,thinkingmachines/inkling-2-small:free,nvidia/nemotron-3.5-lightning:free'
$env:CLIPES_GROQ_KEY_FILE = Join-Path "$env:USERPROFILE/.clipes-keys" 'groq.txt'
./scripts/provider-contract.ps1 -Service groq -Models 'openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b'
./scripts/provider-contract.ps1 -Service claude -Models 'default'
./scripts/provider-contract.ps1 -Service codex -Models 'default'
```

`-Models default` nos CLIs significa o modelo escolhido pelo CLI, não um modelo
fixado pelo roteiro. A instrumentação só do teste exporta o ID observado em
`CONTRACT_CLI`, quando o CLI o expõe. Não introduz flags novas no adaptador.
Para repetir somente as sondagens complementares, há `-Case prompt-truncation`
(um pedido sem schema nativo e limite de um token por modelo) e
`-Case schema-smoke` (um pedido normal de cada modo). Ambos usam o mesmo ledger
e os mesmos tetos; não execute outra matriz completa para investigar um caso.

Para um servidor **já instalado e iniciado**, substitua `MODELO_INSTALADO` pelo
ID exato; os endpoints abaixo precisam ser loopback literal. Não instale nada
para reproduzir este ticket. Ollama usa `/api/chat` nativo com schema em `format`
e `num_ctx` do adaptador; LM Studio e llama.cpp usam o adaptador `openai`.

```powershell
./scripts/provider-contract.ps1 -Service ollama -Endpoint 'http://127.0.0.1:11434' -Models 'MODELO_INSTALADO'
./scripts/provider-contract.ps1 -Service lmstudio -Endpoint 'http://127.0.0.1:1234/v1' -Models 'MODELO_INSTALADO'
./scripts/provider-contract.ps1 -Service llamacpp -Endpoint 'http://127.0.0.1:8080/v1' -Models 'MODELO_INSTALADO'
```

O ledger fora do repo persiste entre execuções; conserve-o e inclua nele chamadas
de descoberta feitas à parte. O roteiro serializa suas execuções com mutex, e
registra cada tentativa antes do envio, mesmo se o processo cair. Não execute
duas invocações diretas do teste ignorado ao mesmo tempo. O espaçamento mínimo
de 3,1 s vale para cada envio HTTP, inclusive retries/reparos (menos de 20/min).
Cada requisição lógica tem teto de seis envios e há apenas um reparo; cada CLI
executa três amostras, sob o teto persistente de cinco. Nunca zere o ledger para
contornar tetos. Nenhuma chave, header ou resposta bruta aparece nas linhas
`CONTRACT`: somente resultado tipado, contagens, usage completo ou ausente,
latência e presença/segundos de `Retry-After`.
