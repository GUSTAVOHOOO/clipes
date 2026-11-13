# Como contribuir com um Provedor

Um **Provedor** recebe texto para escolher e pontuar Cortes, sugerir Empacotamento e Roteiros e traduzir legendas. Ele aponta trechos da Transcrição; não determina tempos por conta própria. Consulte o [glossário](../../GLOSSARY.md) e o [ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md).

O núcleo Rust será responsável pela camada de Provedor. Há três tipos previstos: assinatura via CLI, chave de API e modelo local. Os adaptadores HTTP próprios usam os formatos Anthropic, compatível com OpenAI e Gemini; Codex roda como subprocesso. A UI não recebe chaves nem abre processos; as chaves ficam no cofre do sistema. Validação do JSON e teto de custo por lote ficam centralizados no núcleo. O núcleo chama executáveis sem shell.

## Propor e implementar

1. Abra uma proposta pelo formulário [Propor Provedor ou modelo](https://github.com/GUSTAVOHOOO/clipes/issues/new?template=provedor-modelo.yml), informando finalidade, documentação oficial, formato da API ou CLI, autenticação, custos e limites. Não inclua chaves ou dados privados.
2. Verifique se um dos formatos HTTP existentes atende antes de propor outro adaptador. Para modelos ou componentes baixados, informe licenças de código e pesos e permissão para uso comercial, conforme o [ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md).
3. Ao implementar, preserve os limites acima e cubra pelo núcleo os resultados estruturados, erros, custos e o tratamento de credenciais, sem chamadas pagas reais ou segredos nos testes. Uma chamada paga com resultado incerto não pode ser repetida às cegas ([ADR-0005](../adr/0005-projeto-portatil-com-sqlite.md)).
4. Descreva como testar e abra um PR seguindo [CONTRIBUTING.md](../../CONTRIBUTING.md).

A camada de Provedor e o harness headless ainda não existem neste checkout. Portanto não há interface, diretório de adaptadores ou comando de teste concreto para registrar aqui; consulte a implementação vigente quando ela chegar, sem criar dependências da UI ou inventar um contrato antecipadamente.
