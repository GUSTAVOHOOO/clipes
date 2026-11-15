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

## Matriz e resultados

Execução em andamento no PR draft; resultados medidos serão acrescentados antes
da conclusão. Esta seção não representa aprovação do contrato real.
