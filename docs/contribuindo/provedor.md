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

`core/src/provider/cost.rs` calcula o custo sem alterar os adaptadores. A tabela de preços é o JSON versionado `core/src/provider/prices.json` (`updatedAt` e preço em US$ por milhão de tokens de entrada e de saída, por provedor e modelo, com correspondência exata); a UI mostra a data. O usuário pode sobrescrever o preço de um modelo (`provider.prices.set`, guardado em `provider-prices.json` no diretório de configuração ou em `CLIPES_DATA_DIR`) e a sobrescrita vence a tabela. Não há busca na rede; confira os valores embutidos ao atualizar a tabela.

- `provider.cost.estimate`: tokens de entrada = caracteres da instrução, do schema e da Transcrição ÷ 4 (arredondado para cima); o teto de saída é `maxOutputTokens` (Anthropic assume 8192). O resultado traz mínimo (só entrada) e máximo (com o teto de saída); sem teto, o máximo é nulo.
- `provider.cost.run`: roda `provider.structured`, devolve `cost` calculado pelo `usage` e o registra na tabela `provider_costs` do Projeto aberto (`task` obrigatório, o mesmo da rota por tarefa do assistente: `selection`, `packaging`, `script` ou `translation`; `batch` opcional; o lote real chega no #56). Saída truncada (`output_truncated`) também é registrada, pois foi cobrada.
- `provider.cost.list`: lê os registros, opcionalmente por `batch`.
- Tipos de custo: `usd`; `zero` (endpoint loopback); `plan_quota` (CLI, sem valor em dinheiro); `unknown` (modelo sem preço ou `usage` incompleto), nunca zero.

OpenAI (`finish_reason: length`) e Gemini (`finishReason: MAX_TOKENS`) também devolvem `output_truncated` com `usage`, sem reparo automático.
