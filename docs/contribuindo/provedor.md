# Como contribuir com um Provedor

Um **Provedor** recebe texto para escolher e pontuar Cortes, sugerir Empacotamento e Roteiros e traduzir legendas. Ele aponta trechos da Transcrição; não determina tempos por conta própria. Consulte o [glossário](../../GLOSSARY.md) e o [ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md).

O núcleo Rust será responsável pela camada de Provedor. Há três tipos previstos: assinatura via CLI, chave de API e modelo local. Os adaptadores HTTP próprios usam os formatos Anthropic, compatível com OpenAI e Gemini; Codex roda como subprocesso. A UI envia a chave uma única vez ao núcleo e nunca a lê de volta nem abre processos; as chaves ficam no cofre do sistema. Validação do JSON e teto de custo por lote ficam centralizados no núcleo. O núcleo chama executáveis sem shell.

## Propor e implementar

1. Abra uma proposta pelo formulário [Propor Provedor ou modelo](https://github.com/GUSTAVOHOOO/clipes/issues/new?template=provedor-modelo.yml), informando finalidade, documentação oficial, formato da API ou CLI, autenticação, custos e limites. Não inclua chaves ou dados privados.
2. Verifique se um dos formatos HTTP existentes atende antes de propor outro adaptador. Para modelos ou componentes baixados, informe licenças de código e pesos e permissão para uso comercial, conforme o [ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md).
3. Ao implementar, preserve os limites acima e cubra pelo núcleo os resultados estruturados, erros, custos e o tratamento de credenciais, sem chamadas pagas reais ou segredos nos testes. Uma chamada paga com resultado incerto não pode ser repetida às cegas ([ADR-0005](../adr/0005-projeto-portatil-com-sqlite.md)).
4. Descreva como testar e abra um PR seguindo [CONTRIBUTING.md](../../CONTRIBUTING.md).

O adaptador compatível com OpenAI fica em `core/src/provider.rs` e implementa a interface `Provider`. O núcleo registra os comandos `provider.*` no despacho compartilhado; `provider.structured` recebe instrução, Transcrição tratada como dado não confiável e JSON Schema. A opção de schema nativo é configurada no Provedor; o núcleo sempre valida a resposta e, sem schema nativo, tenta um reparo. Execute `cargo test -p clipes-core` para verificar o adaptador e o despacho headless com servidor HTTP e cofre simulados. Nunca use uma chave real em testes.

## Provedores por assinatura via CLI

Codex CLI e Claude Code CLI são experimentais e só são selecionados por escolha explícita; o usuário instala o CLI e faz login, e o Clipes não lê nem guarda seus tokens. Cada chamada exige confirmação prévia do envio de texto e consome a cota do plano. O Codex 0.169 não oferece opção comprovada para desligar todas as ferramentas: usa execução efêmera, sem configuração ou regras do usuário, sandbox somente leitura, diretório temporário e schema de saída, com ferramentas opcionais desligadas. Ainda pode executar comandos de leitura; uma Transcrição maliciosa pode causar leitura e envio de arquivos à OpenAI, portanto use Fontes confiáveis. O Claude Code usa modo de impressão, schema JSON, ferramentas embutidas e MCP desligados, sem comandos, persistência de sessão ou configurações de usuário/projeto/local. A Anthropic ainda não confirmou por escrito o uso por apps de terceiros. Se o Claude instalado não oferecer `--tools`, o núcleo recusa a execução. Ambos recebem o prompt pelo stdin e rodam sem shell, e a resposta é validada localmente. Os testes usam CLIs falsos, sem chamadas pagas.
