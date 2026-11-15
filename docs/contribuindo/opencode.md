# OpenCode isolado (experimental, #135)

O perfil OpenCode fica desligado por padrão e exige o aviso de envio de texto.
Decisão do coordenador em 14/11/2026: o Clipes roda o OpenCode isolado; só modelos
que funcionam sem login (gratuitos) estão disponíveis; seu login do OpenCode não
é usado. O Clipes nunca lê nem copia tokens. Modelos que exigem autenticação
recusam com erro tipado, sem fallback. Usar login salvo fica fora deste ticket.

## Contrato e isolamento

Versão mínima testada e única aceita: **2.2.7**. Outras versões recusam com
`unsupported_cli` até que suas garantias sejam verificadas. Foram lidos
`opencode --help`, `opencode run --help`, `opencode models --help`, a
[documentação oficial](https://opencode.ai/docs/cli/) e o código do
[tag v2.2.7](https://github.com/anomalyco/opencode/tree/v2.2.7).

| Opção | Motivo e evidência no tag v2.2.7 |
| --- | --- |
| `run`, prompt no stdin | Modo não interativo; `packages/cli/src/run/run.ts` lê o stdin inteiro quando não há mensagem em argv. |
| `--model provider/model` | Modelo explicitamente escolhido no perfil; sem escolha automática. |
| `--format json` | Eventos JSONL; só o texto da resposta entra na validação local do schema. Ferramenta, erro ou truncamento recusam. Não usa tool calling para obter JSON. |
| `--standalone` | Servidor privado, sem aproveitar o servidor compartilhado; `packages/cli/src/services/server-connection.ts` e `standalone.ts`. O processo e os descendentes ficam sujeitos ao CancelToken e timeout do núcleo. |
| `--archived`, `--title Clipes` | Sessão não aparece nas listas e não exige geração automática de título; nunca `--continue`, `--session`, `--fork`, `--auto` ou compartilhamento. |
| `OPENCODE_DB=:memory:` | Banco sem persistência, inclusive credenciais; `packages/cli/src/database-path.ts` e `packages/core/src/credential.ts`. |
| `OPENCODE_CONFIG_DIR` temporário | Não lê config/plugins/agentes globais do usuário; `packages/util/src/global.ts`. |
| `OPENCODE_CONFIG_PROJECT_DISABLE=1` | Não procura config em cwd nem ancestrais; `packages/cli/src/server-process.ts` e `packages/core/src/config/discovery.ts`. |
| `OPENCODE_DISABLE_CLAUDE_CODE=1` | Não lê compatibilidade com `.claude`; `server-process.ts`. |
| `OPENCODE_CONFIG_CONTENT` próprio | Agente `clipes` com `permissions: [{action:"*",resource:"*",effect:"deny"}]`, no nível global e do agente; `packages/core/src/config/plugin/agent.ts`. `packages/core/src/tool.ts` remove todas as ferramentas e Code Mode quando a última regra é deny para `*`. |
| `OPENCODE_DISABLE_MODELS_FETCH=1` | Usa o catálogo embutido na versão verificada, sem atualização remota; `packages/cli/src/server-process.ts`. |
| `OPENCODE_DISABLE_FILEWATCHER=1`, `OPENCODE_DISABLE_FFF=1` | Desliga watchers e o índice de arquivos, desnecessários para texto estruturado; `server-process.ts`. |
| `policies` deny | `tool.use`, `mcp.use`, `plugin.use`, `skill.use`, `websearch.use` e `integration.connect` negados para `*`; `packages/core/src/config/plugin/policy.ts` e [políticas oficiais](https://opencode.ai/docs/policies/). |
| `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `OPENCODE_TEST_HOME`, `TEMP`, `TMP`, `TMPDIR` temporários | Estado, cache, logs e diretório home isolados; `packages/util/src/global-roots.ts`, `global.ts`. Tudo removido ao recolher o processo. Cwd é um subdiretório vazio. |
| Ambiente por allowlist | Só variáveis de sistema necessárias para iniciar o executável, mais as opções acima. Não herda chaves, proxies, `OPENCODE_CONFIG`, hooks de runtime ou flags experimentais. |
| Config de sistema/MDM | `discovery.ts` também lê `/etc/opencode`, `/Library/Application Support/opencode`, `%ProgramData%/opencode` e preferências MDM no macOS. A CLI não expõe `global:false`: se houver essas fontes, ou não for possível verificar sua ausência, recusa `unsupported_cli` antes do subprocesso. |

Não há schema nativo em `opencode run` v2.2.7. O prompt descreve o schema e
encapsula a Transcrição como dado não confiável; o núcleo sempre valida o JSON
completo e `schemaVersion`, como os adaptadores do #39. Saída nunca vira comando.
O veto Somente local é aplicado pela mesma rota dos demais CLIs, antes de iniciar
o processo. Não cria fila própria: usa o seam `provider::run_structured` do #117.

## Modelo e custo

`opencode models --standalone` no ambiente isolado lista os modelos sem login.
Os IDs aceitos têm preço zero confirmado na
[tabela oficial](https://opencode.ai/docs/console/models/#pricing), consultada em
14/11/2026. A gratuidade é temporária, não inferida do sufixo `free`. Modelo fora
da lista confirmada tem custo desconhecido e recusa `cli_auth_required` antes de
enviar texto; não usa outro modelo. Revalidar fonte e isolamento ao atualizar a
lista ou a versão. Os modelos continuam remotos e podem ter políticas diferentes
de retenção/treinamento, descritas na página oficial.

Na fila, o OpenCode segue a regra de CLI do ADR-0009: só conta chamadas nos
orçamentos, mesmo quando o preço confirmado é zero (`callsOnly` na estimativa).
Tokens ficam nulos. Custo zero não indica loopback: um job `local` também recusa
o OpenCode com `not_local` antes de iniciar o processo.

## Verificação

Testes automáticos usam um executável falso e `CLIPES_DATA_DIR` temporário,
sem rede. O teste `real_opencode_isolated` é `#[ignore]`: execução manual única
com texto sintético, modelo gratuito explicitamente escolhido, banco em memória
e sem login; modelo, latência e validação são registrados no PR.

**Prova real pendente, autorizada pelo coordenador:** cota gratuita do OpenCode
esgotada (HTTP 429 `provider.free-limit`, ~22 h), isolamento confirmado com
`debug agents` e 3 tentativas fora do adaptador que chegaram ao serviço. Foram
testados `opencode/big-pickle` e `opencode/glm-5.3-flash-free` com banco em memória,
e `opencode/beam-free` com SQLite temporário apagado. Todos retornaram o mesmo
limite; nenhum produziu saída estruturada. O banco continua em memória. A prova
real passa ao #122, depois da reposição da cota, sem novas inferências neste PR.

`cli_free_limit` usa só o tipo do erro e o número `retryAfterMs` da CLI: mensagem
sob template fixo, em segundos arredondados para cima; sem prazo informado diz
para tentar mais tarde. Mensagem/corpo do serviço e stderr são descartados. A UI
traduz esse template PT-BR/EN e não repete a chamada automaticamente.
