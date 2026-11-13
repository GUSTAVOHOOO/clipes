---
status: accepted
---

# Projeto portátil com SQLite próprio; biblioteca só como índice

Cada **Projeto** do Clipes é uma pasta `.clipes` com um banco **SQLite próprio**, que é a fonte da verdade. Por padrão, há um Projeto por canal. A biblioteca do app só lista os Projetos conhecidos e pode ser reconstruída: se ela se perder, basta reabrir a pasta. Decisão do dev em 12/11/2026, com base na [pesquisa de persistência](https://github.com/GUSTAVOHOOO/clipes/blob/research/persistencia/docs/research/2026-11-12-persistencia.md) do [#23](https://github.com/GUSTAVOHOOO/clipes/issues/23).

## O que vem junto

- **Motor:** SQLite via `rusqlite` com `bundled`, ou seja, compilado junto com o app, com WAL e FTS5. O **núcleo Rust é o único escritor**. O worker Python nunca abre o banco: entrega tudo ao núcleo pelo protocolo de JSON lines ([ADR-0004](0004-stack-tauri-react-nucleo-rust-worker-python.md)).
- **Modelo de dados:**
  - Palavras e Frases da Transcrição são **linhas** com índices por ordem e por tempo. Uma live de 10 h tem centenas de milhares de palavras.
  - Nota, decisões, custos do Provedor e jobs também são tabelas.
  - Corte, estilo, Roteiro e Empacotamento são **documentos JSON** com `schemaVersion` e `revision`, validados pelo núcleo.
  - Os tempos são inteiros em µs.
- **Mídia referenciada:** a Fonte não é copiada para o Projeto, a menos que o usuário escolha copiar. Se o arquivo sumir, a Fonte fica offline e pode ser relocalizada. A Transcrição e a edição continuam acessíveis, mas o preview e o export ficam bloqueados. O app nunca troca a mídia sozinho.
- **Migrações:** migrações com identificadores textuais únicos por ticket, registrados no banco e aplicados em ordem, e uma migração própria por tipo de JSON. Antes de migrar, o app faz um backup verificado. Não há downgrade.
- **Backup:** automático e rotativo, pela Online Backup API do SQLite. A restauração é testada com `integrity_check`.
- **Desfazer:** pilha em memória por Corte, com arrastos agrupados, mais autosave e snapshots persistentes limitados. Sem event sourcing.
- **Fila de jobs:** persistida no Projeto, com tentativas e checkpoints, e reconciliada após crash. Uma chamada paga ao Provedor com resultado incerto nunca é repetida às cegas.
- **Cache** de proxies, miniaturas e ondas: fica fora do Projeto e do backup, com limpeza LRU por limite de tamanho.

## Opções consideradas

- **Um banco central para tudo:** é mais simples de consultar, mas o Projeto deixa de ser portátil, e um arquivo corrompido derruba todos os canais.
- **Um Projeto por Fonte:** espalharia o Perfil de canal e atrapalharia o controle de repetição por canal, que é uma melhoria futura.
- **Arquivo JSON ou pasta de JSON:** não tem transações, índices nem busca. Regravar centenas de milhares de palavras a cada edição não escala.
- **redb, DuckDB e SurrealDB embarcado:**
  - o redb não tem SQL nem busca;
  - o DuckDB é feito para análise de dados, não para edição transacional;
  - o SurrealDB usa licença BSL, que não é OSI.
- **SQLx:** usa o mesmo motor, mas traz macros e async que não precisamos.
- **Copiar a Fonte para o Projeto por padrão:** dezenas de GB por live.
