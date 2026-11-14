# Como contribuir com um Provedor

Um **Provedor** recebe texto para escolher e pontuar Cortes, sugerir Empacotamento e Roteiros e traduzir legendas. Ele aponta trechos da Transcrição; não determina tempos por conta própria. Consulte o [glossário](../../GLOSSARY.md) e o [ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md).

O núcleo Rust será responsável pela camada de Provedor. Há três tipos previstos: assinatura via CLI, chave de API e modelo local. Os adaptadores HTTP próprios usam os formatos Anthropic, compatível com OpenAI e Gemini; Codex roda como subprocesso. A UI envia a chave uma única vez ao núcleo e nunca a lê de volta nem abre processos; as chaves ficam no cofre do sistema. Validação do JSON e teto de custo por lote ficam centralizados no núcleo. O núcleo chama executáveis sem shell.

## Propor e implementar

1. Abra uma proposta pelo formulário [Propor Provedor ou modelo](https://github.com/GUSTAVOHOOO/clipes/issues/new?template=provedor-modelo.yml), informando finalidade, documentação oficial, formato da API ou CLI, autenticação, custos e limites. Não inclua chaves ou dados privados.
2. Verifique se um dos formatos HTTP existentes atende antes de propor outro adaptador. Para modelos ou componentes baixados, informe licenças de código e pesos e permissão para uso comercial, conforme o [ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md).
3. Ao implementar, preserve os limites acima e cubra pelo núcleo os resultados estruturados, erros, custos e o tratamento de credenciais, sem chamadas pagas reais ou segredos nos testes. Uma chamada paga com resultado incerto não pode ser repetida às cegas ([ADR-0005](../adr/0005-projeto-portatil-com-sqlite.md)).
4. Descreva como testar e abra um PR seguindo [CONTRIBUTING.md](../../CONTRIBUTING.md).

O adaptador compatível com OpenAI fica em `core/src/provider.rs` e implementa a interface `Provider`. O núcleo registra os comandos `provider.*` no despacho compartilhado; `provider.structured` recebe instrução, Transcrição tratada como dado não confiável e JSON Schema. A opção de schema nativo é configurada no Provedor; o núcleo sempre valida a resposta e, sem schema nativo, tenta um reparo. Execute `cargo test -p clipes-core` para verificar o adaptador e o despacho headless com servidor HTTP e cofre simulados. Nunca use uma chave real em testes.

O campo `kind` de `provider.configure` seleciona `openai`, `anthropic` ou `gemini`; configuracoes anteriores sem o campo usam `openai`. Os endpoints sao bases de API (por exemplo, `https://api.anthropic.com/v1` ou `https://generativelanguage.googleapis.com/v1beta`); informe um modelo compativel com o schema nativo quando esta opcao estiver ativa.

`provider.structured` e `Provider::structured` retornam `{data, usage, calls}`: `data` e o JSON validado, `usage` e `{inputTokens, outputTokens}` com campos nulos quando nao informados, ou nulo quando nenhum foi informado. Os tokens de respostas de reparo sao somados; se uma resposta nao informar um campo, o total desse campo e nulo. `calls` conta tentativas HTTP e reparos. A requisicao aceita `maxOutputTokens` opcional: Anthropic usa 8192 quando omitido; os demais nao enviam limite nesse caso. Se a Anthropic informar `stop_reason: max_tokens`, o erro `output_truncated` nao dispara reparo e o campo `usage` do erro contem `{usage, calls}` para contabilizacao. O calculo de custo nao faz parte desta camada.

No Gemini, `outputTokens` inclui `candidatesTokenCount` e `thoughtsTokenCount` quando informado, conforme os metadados da API.
## Provedores por assinatura via CLI

Codex CLI e Claude Code CLI são experimentais e só são selecionados por escolha explícita; o usuário instala o CLI e faz login, e o Clipes não lê nem guarda seus tokens. Cada chamada exige confirmação prévia do envio de texto e consome a cota do plano. O Codex 0.169 não oferece opção comprovada para desligar todas as ferramentas: usa execução efêmera, sem configuração ou regras do usuário, sandbox somente leitura, diretório temporário e schema de saída, com ferramentas opcionais desligadas. Ainda pode executar comandos de leitura; uma Transcrição maliciosa pode causar leitura e envio de arquivos à OpenAI, portanto use Fontes confiáveis. O Claude Code usa modo de impressão, schema JSON, ferramentas embutidas e MCP desligados, sem comandos, persistência de sessão ou configurações de usuário/projeto/local. A Anthropic ainda não confirmou por escrito o uso por apps de terceiros. Se o Claude instalado não oferecer `--tools`, o núcleo recusa a execução. Ambos recebem o prompt pelo stdin e rodam sem shell, e a resposta é validada localmente. Os testes usam CLIs falsos, sem chamadas pagas.

Os adaptadores CLI retornam `usage: null` e `calls: 1`, pois nao informam tokens.

## Assistente de primeira execução e Provedor por tarefa

Na primeira execução, a UI abre um assistente que chama `assistant.detect` para listar o que já existe na máquina: Ollama (`GET /api/tags` em `127.0.0.1:11434`), LM Studio (`GET /v1/models` em `127.0.0.1:1234`), servidor do llama.cpp (`GET /v1/models` ou `/health` em `127.0.0.1:8080`) e os executáveis `codex` e `claude` no `PATH`. "Local" significa só loopback: a detecção recusa qualquer outro endereço, usa timeout curto (800 ms), não segue redirecionamentos nem proxy e não executa os CLIs, só procura o arquivo no `PATH`. Os testes injetam as URLs (`ollama`, `lmStudio`, `llamaCpp`) e o `path` como argumentos de `assistant.detect`, com servidores HTTP falsos em portas efêmeras; a UI não envia esses argumentos.

O assistente recomenda sem escolher: explica qualidade e custo de cada tipo de Provedor (API, assinatura via CLI e modelo local), e não existe Provedor padrão de fábrica. Os CLIs são experimentais e só ficam disponíveis depois do mesmo aviso e da confirmação do `provider.cli.confirm`; `assistant.default.set` e `assistant.task.set` recusam `codex` ou `claude` com `confirmation_required` antes disso.

As escolhas ficam em `assistant.json` nas configurações do app (`CLIPES_DATA_DIR`), nunca no Projeto nem no Perfil de canal: `assistant.status`, `assistant.default.set`, `assistant.task.set` e `assistant.complete` (com `skipped` para registrar o "pular"). Cada escolha é `endpoint` (a API ou o modelo local configurado em `provider.configure`), `codex`, `claude` ou vazio. As tarefas são `selection` (seleção de Cortes), `packaging` (Empacotamento), `script` (Roteiro) e `translation` (tradução); uma tarefa sem troca usa o padrão. `provider.structured` aceita o campo opcional `task`: com ele usa a troca da tarefa ou o padrão; sem ele, usa o padrão. Se nada foi escolhido pelo assistente, vale o comportamento anterior. Desativar o CLI esquece as escolhas que apontavam para ele.

## Custo do Provedor

`core/src/provider/cost.rs` calcula o custo sem alterar os adaptadores. A tabela de preços é o JSON versionado `core/src/provider/prices.json` (`updatedAt` e preço em US$ por milhão de tokens de entrada e de saída, por provedor e modelo, com correspondência exata); a UI mostra a data. O usuário pode sobrescrever o preço de um modelo (`provider.prices.set`, guardado em `provider-prices.json` no diretório de configuração ou em `CLIPES_DATA_DIR`) e a sobrescrita vence a tabela. Cada entrada tem `source` com a URL oficial de onde o preço foi lido (Anthropic: platform.claude.com/docs/en/about-claude/pricing; OpenAI: developers.openai.com/api/docs/pricing; Gemini: aistudio.google.com/docs/pricing), e `updatedAt` é a data em que a tabela foi conferida nessas páginas. Não há busca na rede. Ao atualizar, releia as três páginas oficiais; preço que não puder ser confirmado numa fonte oficial sai da tabela (vira `unknown`).

Limitações da tabela: usa só o preço base (Standard, sem cache, sem Batch, sem faixas). Preços por faixa de contexto (Claude Haiku 5.5 acima de 100 mil tokens, OpenAI acima de 272 mil, Gemini 3.1 Pro acima de 200 mil) e preço de áudio do Gemini usam a faixa base, então o custo real pode ser maior. Ficam de fora modelos com mudança de preço já anunciada (por exemplo `gemini-4-carbon`, `gemini-4-argon` e `gpt-5.6-sol`, que mudam em dezembro de 2026 ou antes) e modelos descontinuados; use a sobrescrita do usuário se precisar deles. O Gemini cobra o pensamento como saída, e o adaptador já o soma.

- `provider.cost.estimate`: tokens de entrada = caracteres da instrução, do schema e da Transcrição ÷ 4 (arredondado para cima); o teto de saída é `maxOutputTokens` (Anthropic assume 8192). O resultado traz mínimo (só entrada) e máximo (com o teto de saída); sem teto, o máximo é nulo.
- `provider.cost.run`: roda `provider.structured`, devolve `cost` calculado pelo `usage` e o registra na tabela `provider_costs` do Projeto aberto (`task` obrigatório, o mesmo da rota por tarefa do assistente: `selection`, `packaging`, `script` ou `translation`; `batch` opcional; o lote real chega no #56). Falhas que chegam depois de uma resposta (`output_truncated`, `invalid_json` após o reparo, resposta sem texto como recusa) carregam o `usage` acumulado no erro e também são registradas, pois foram cobradas; `timeout_uncertain` é registrado como custo desconhecido.
- `provider.cost.list`: lê os registros, opcionalmente por `batch`.
- Tipos de custo: `usd`; `zero` (endpoint loopback); `plan_quota` (CLI, sem valor em dinheiro); `unknown` (modelo sem preço ou `usage` incompleto), nunca zero.

OpenAI (`finish_reason: length`) e Gemini (`finishReason: MAX_TOKENS`) também devolvem `output_truncated` com `usage`, sem reparo automático.

## Contrato dos adaptadores: erros, cancelamento e timeout

Erros tipados dos adaptadores HTTP (`CoreError.code`, mensagem fixa em inglês, sem texto da resposta nem caminhos):

- `refusal`: a OpenAI respondeu com `message.refusal`. É a resposta do modelo, não um JSON malformado: não há reparo, e o erro carrega `usage`. Não é `invalid_response`. O texto da recusa não é copiado para o erro.
- `output_truncated`, `invalid_json` e `invalid_response` (sem texto) também carregam `usage`, como antes.
- `rate_limit` e `provider_http` carregam `{usage, calls}` quando o corpo da resposta de erro informa tokens de uso (mesmo formato de cada Provedor); sem uso no corpo, `usage` fica ausente, pois nada prova que a chamada foi cobrada. `calls` conta toda tentativa HTTP, e o uso de reparos anteriores é somado.
- `cancelled`: o chamador pediu o cancelamento. `timeout_uncertain`: o prazo estourou e a requisição pode ter sido processada; nunca é repetida às cegas.

**Cancelamento.** `Provider::structured_with(request, &CancelToken)` aceita um `CancelToken` (clones compartilham a mesma bandeira; `cancel()` a levanta). Ele é observado em fatias de 25 ms: na espera do `Retry-After` do 429, no recuo entre tentativas de conexão, com a requisição HTTP em voo (a resposta é lida numa thread auxiliar, que termina sozinha no timeout) e na espera de um CLI. Cancelar um CLI mata o processo e os filhos (grupo de processos no Unix, Job Object no Windows, como em `core/src/process.rs`) e recolhe o processo, sem zumbi. `Provider::structured` equivale a um token que nunca é cancelado. `provider::run_structured(args, &CancelToken)` é o mesmo que `provider.structured` com a rota por tarefa; é o ponto que o executor de jobs de IA (#121) usará: ele guarda um clone do token e cancela quando `jobs.cancel` marcar `cancel_requested`. O comando `provider.structured` do despacho usa um token que nunca cancela, e esta camada não cria fila.

**Timeout por tipo de Provedor.** Padrões: API remota 60 s, modelo local (endpoint em loopback) 300 s, CLI (Codex ou Claude Code) 300 s. Um modelo local em CPU pode ser lento, o que justifica o teto maior. Os valores aceitos vão de 1 a 3600 s.

- API: `provider.configure` aceita `timeouts: {remote?, local?}` em segundos (`null` ou campo ausente usa o padrão; `timeouts: {}` restaura os padrões; sem o campo `timeouts` os atuais ficam). Vai em `provider.json` e o `provider.json` antigo, sem o campo, continua válido. `provider.status` devolve os valores em vigor em `timeouts`. Quem usa os adaptadores direto pode chamar `with_timeouts(Timeouts)`.
- CLI: `provider.cli.configure` aceita `timeoutSeconds` (ausente mantém, `null` restaura o padrão); fica em `provider-cli.json` e `provider.cli.status` o devolve. Estourar o prazo mata o processo e os filhos e devolve `timeout_uncertain`.

Testes: `cargo test -p clipes-core --test provider_contract --test provider_cli_cancel`, com servidor HTTP falso (lê a requisição inteira antes de responder) e um CLI falso que nunca termina e cria um filho (`core/tests/fixtures/fake_slow_cli.rs`).
