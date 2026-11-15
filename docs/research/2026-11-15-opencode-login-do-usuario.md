# Spike #156: login do usuário no OpenCode v2.2.7 com isolamento

Data: 15/11/2026. Versão: OpenCode 2.2.7 (a fixada no #135). Nenhum dado, banco,
config, sessão ou login reais do dev foi lido ou executado. Código lido no tag
[v2.2.7](https://github.com/anomalyco/opencode/tree/v2.2.7); a verificação
empírica usou só um diretório temporário e uma credencial FALSA
(`sk-FAKE-not-a-real-key`), sem nenhuma chamada de inferência.

## Decisão

Dev, 15/11/2026: encerrado só com o spike; modelos pagos seguem pelos Perfis de API.
Nenhuma das opções abaixo foi construída. O risco de rotação do refresh token (opção 2)
e a observação de que a opção 3 já é coberta pelos Perfis `openai` estão no fim do relatório.

## Onde fica a credencial

- Tabela `credential` do **mesmo SQLite** que guarda sessões e histórico:
  [`packages/core/src/credential.ts`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/credential.ts),
  tabela em `credential/sql.ts`. Valor é `oauth` (access/refresh/expires), `key` ou
  `external` ([`packages/schema/src/credential.ts`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/schema/src/credential.ts)).
- O caminho do banco vem de `OPENCODE_DB` (nome ou `:memory:`) ou `<XDG_DATA_HOME>/opencode/opencode.db`
  ([`packages/cli/src/database-path.ts`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/database-path.ts)).
- `auth.json` é só formato legado, importado uma vez na migração
  [`20260805200742_import_legacy_credentials`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts).
- Não existe variável ou caminho "só da credencial". Credenciais podem vir também
  de variáveis de ambiente do provedor (conexão do tipo `env`), mas isso é chave de
  API do usuário, não o login do OpenCode.
- OAuth renova o token e **grava de volta** no banco (`Credential.refresh`).

## Verificação empírica (XDG, home e config temporários, credencial falsa)

| Cenário | Resultado |
| --- | --- |
| `OPENCODE_DB=:memory:` | `auth list` → "No authenticated integrations"; `models` → 12 modelos (só gratuitos). |
| `OPENCODE_DB=<arquivo temp>` com a credencial falsa importada | `auth list` mostra a credencial (`--format json` não expõe o segredo, só id/label/método); `models` → 363 modelos, incluindo todos do OpenRouter. |
| `opencode run` com `OPENCODE_DB=<arquivo>` e modelo inexistente | O arquivo ganhou linhas em `session_v2` (1), `session_message` (2) e `project` (3), mesmo com `--archived`. |
| `opencode run` sem login (`:memory:`) com `anthropic/claude-sonnet-4-5` ou `foo/bar` | Erro JSON `provider.no-route` ("Model unavailable: ..."), antes de qualquer rede. |

Login expirado: o código mapeia falha de autorização para `provider.auth`
([`to-session-error.ts`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/session/to-session-error.ts));
não foi reproduzido, pois exigiria um provedor real.

Observações de ambiente: os subcomandos `auth` e `models` **sem `--standalone`**
falam com o serviço em segundo plano do usuário, então jamais devem ser chamados sem
a flag. Em Windows, `env -i` do Git Bash fez o servidor standalone falhar com "Failed
to start server. Is port 0 in use?"; com o ambiente normal mais variáveis XDG/home
temporárias funcionou (o adaptador do #135 usa lista própria e não foi afetado).

## Resposta à pergunta central

**Não dá para apontar só a credencial.** A credencial só chega ao OpenCode pelo
banco. As opções reais:

1. `OPENCODE_DB` apontando para o banco real: libera os modelos, mas o OpenCode grava
   sessão, projeto e refresh de token nele. Abre mão do isolamento do #135 e altera
   sessões/histórico do usuário (critério do ticket).
2. `auth export` do banco real, `auth import` no banco temporário: isolamento
   completo, mas é **copiar** a credencial (vetado pelo ticket) e o segredo passaria
   pelo Clipes.
3. Variáveis de ambiente de provedor (chave de API): mantém o isolamento, sem copiar
   para disco, mas não é "o login do OpenCode" e só cobre provedores com chave.
4. Cópia do arquivo do banco para temporário: também copia a credencial e junta
   histórico; pior que 2.

## Lista de modelos, custo e login ausente (se uma opção for aprovada)

- Modelos: `opencode models --standalone` no ambiente que contém a credencial.
- Login ausente: `auth list --standalone --format json` sem conexões, ou
  `provider.no-route` no `run`; expirado: `provider.auth`. Ambos viram erro tipado
  com a orientação "entre no OpenCode e tente de novo".
- Custo: sem tabela oficial por modelo, o texto seria "consome a cota do seu plano".

## Risco da opção 2: rotação do refresh token

A renovação **grava um refresh token novo**, então renovar dentro de um banco
temporário (cópia importada) invalida o login real: o token novo morre com o
diretório temporário e o antigo deixa de valer se o provedor o revoga a cada uso.
Evidência no tag v2.2.7:

- Provedor `opencode`: [`packages/core/src/plugin/provider/opencode.ts`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/plugin/provider/opencode.ts)
  linhas 142-160: `refresh` envia `grant_type: "refresh_token"` e devolve `refresh: token.refresh_token`;
  o comentário da linha 156 diz "Persist rotated tokens". `invalid_grant` vira `SignedOutError`.
- Provedor `openai`: [`packages/core/src/plugin/provider/openai.ts`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/plugin/provider/openai.ts)
  linhas 358-370 e 386-393: o POST de refresh responde um `refresh_token` e `credential()`
  grava `refresh: tokens.refresh_token`.
- Persistência: `Credential.refresh` ([`credential.ts`](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/credential.ts))
  atualiza a linha no banco em uso, com trava de arquivo só entre processos que
  **compartilham o mesmo banco**; um banco temporário não coordena com o real.
- Renovação ocorre quando faltam menos de 5 minutos (`expiring`). Com o real
  sendo usado em paralelo pelo OpenCode do usuário, os dois bancos disputam o mesmo
  refresh token.

Se o provedor rotaciona de fato não foi medido (exigiria login real), mas o código
trata a rotação como esperada. Isto pesa contra a opção 2.

## Opção 3 não acrescenta capacidade

Chaves de API de provedor via variável de ambiente já são cobertas pelos Perfis de
Provedor `openai` existentes (OpenRouter e Groq funcionaram no #122). Usá-las pelo
OpenCode só acrescentaria uma camada.
