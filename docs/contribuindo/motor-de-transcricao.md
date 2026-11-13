# Como contribuir com um Motor de transcrição

Um **Motor de transcrição** produz a Transcrição da Fonte no idioma falado, com timestamps por palavra. Ele pode ser local (o padrão) ou remoto via API paga escolhida pelo usuário. Consulte o [glossário](../../GLOSSARY.md).

O [ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md) prevê faster-whisper no worker de ML Python, sob demanda. O núcleo Rust controla a fila e se comunica com o worker por JSON lines em stdin/stdout, com versão de protocolo, progresso, cancelamento e erros tipados. O worker carrega um modelo por vez e o libera antes do próximo; não abre o banco do Projeto. O Python e componentes necessários são baixados sob demanda em ambiente isolado, sem usar o Python do sistema.

## Propor e implementar

1. Abra uma proposta pelo formulário [Propor Provedor ou modelo](https://github.com/GUSTAVOHOOO/clipes/issues/new?template=provedor-modelo.yml), identificando o Motor, seus modelos, finalidade, requisitos de hardware, documentação e se é local ou remoto.
2. Documente as licenças do código e dos pesos, inclusive permissão para uso comercial. Componentes e modelos baixados precisam atender ao [ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md); a licença e atribuições devem ser apresentadas conforme esse ADR.
3. Ao implementar, respeite a fila e o protocolo do núcleo e preserve os timestamps por palavra. Cubra resultados, progresso, cancelamento e erros pelo núcleo, sem usar credenciais ou serviços pagos reais nos testes. O worker entrega os resultados ao núcleo, que é o único escritor do banco ([ADR-0005](../adr/0005-projeto-portatil-com-sqlite.md)).
4. Descreva como testar e abra um PR seguindo [CONTRIBUTING.md](../../CONTRIBUTING.md).

O worker, o núcleo e o harness headless ainda não existem neste checkout. Não há interface, diretório de implementação ou comando de teste concreto para este Motor ainda; consulte o contrato vigente quando essas peças forem implementadas.
