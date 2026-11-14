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
