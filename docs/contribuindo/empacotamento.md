# Empacotamento: idioma e crédito

O idioma do Corte segue a regra de 80% por caracteres das Frases. Para idioma desconhecido, misto ou diferente de português e inglês, a interface oferece PT-BR/EN, inicialmente no idioma da interface; sem escolha, a geração retorna `language_required`.

O schema exige que o Provedor devolva o idioma solicitado. Uma heurística local de stopwords em título e descrição só rejeita textos com pelo menos 12 palavras quando o outro idioma tem ao menos 3 e mais que o dobro das ocorrências; textos ambíguos passam. O reparo único cobre apenas JSON/schema; falhas dos verificadores encerram a tentativa, e o usuário pode gerar de novo manualmente.

O núcleo constrói o crédito com o nome (`who`) da Permissão e, quando houver, a URL pública de origem da Fonte. Os campos `where` e `scope` são privados e nunca são enviados ao Provedor nem incluídos no documento. Sem Permissão, não há crédito e a interface avisa.

Os limites seguem a [referência oficial de vídeos do YouTube](https://developers.google.com/youtube/data/reference/rest/v3/videos): título de 100 caracteres, descrição de 5000 bytes e tags de 500 caracteres, incluindo separadores e aspas quando aplicáveis.

## Fluxo e comandos (#68)

A Tarefa de IA `packaging` (`core/src/packaging.rs`, prompt `core/src/packaging/prompt.md`, travado em `prompt-lock.json`) faz uma chamada por Corte aprovado na revisão (#55), sobre o texto corrigido (#52) das Frases com as bordas atuais, em formato compacto, precedido da linha `#CORTE idioma=<pt-BR|en>`. A Transcrição é dado não confiável. Sem juiz, voting nem tool calling; roda na fila (#121) com custo, orçamento, auditoria e o veto "somente local" das outras Tarefas.

- `packaging.estimate {candidate, language?}`: idioma e custo estimado. `packaging.generate {candidate, language?, confirmed?}`: Provedor pago exige `confirmed` (`confirmation_required` traz a estimativa). `language` só vale quando o idioma do Corte não é pt nem en; sem ele, `language_required`.
- `packaging.get {candidate}`: documento do Corte (`schemaVersion` 1, `revision`), versão atual, crédito, último job e limites para os contadores. `packaging.edit {candidate, title?, description?, tags?, hashtags?}`: grava uma edição sobre a geração atual, com os mesmos limites (`edit_invalid` com os códigos das violações).
- Cada geração fica em `packaging_generations` (migração `0068_001_packaging`) com `task_version`, `prompt_sha256`, perfil e idioma; cada edição é uma linha em `packaging_edits`. Regenerar cria outra geração e nunca apaga as anteriores nem suas edições. O documento é validado por `documents.validate` (tipo `packaging`).
- Verificadores (códigos fixos): `language_mismatch`, `title_empty`, `title_too_long`, `description_empty`, `description_too_long` (a descrição conta o crédito reservado), `forbidden_character` (`<` e `>`), `invalid_tag`, `tag_too_long`, `tags_too_long`, `too_many_tags`, `invalid_hashtag`, `too_many_hashtags` e `invented_url`. Constantes em `core/src/packaging.rs`; tags, hashtags e seus máximos de contagem são limites do produto, não da API. A heurística de idioma só age com 12 ou mais palavras e ao menos 3 stopwords do outro idioma, mais que o dobro das do idioma pedido.
- O crédito é montado por `build_credit` só com o `who` e o link público da Fonte importada por URL (sem credenciais nem fragmento), em PT-BR ou EN, e é acrescentado depois da descrição na leitura (`fullDescription`). Ele não faz parte dos campos editáveis, então editar a descrição não o apaga. Testes: `core/tests/packaging.rs`.
