# Empacotamento: idioma e crédito

O idioma do Corte segue a regra de 80% por caracteres das Frases. Para idioma desconhecido, misto ou diferente de português e inglês, a interface oferece PT-BR/EN, inicialmente no idioma da interface; sem escolha, a geração retorna `language_required`.

O schema exige que o Provedor devolva o idioma solicitado. Uma heurística local de stopwords em título e descrição só rejeita textos com pelo menos 12 palavras quando o outro idioma tem mais que o dobro das ocorrências; textos ambíguos passam. O reparo único cobre apenas JSON/schema; falhas dos verificadores encerram a tentativa, e o usuário pode gerar de novo manualmente.

O núcleo constrói o crédito com o nome (`who`) da Permissão e, quando houver, a URL pública de origem da Fonte. Os campos `where` e `scope` são privados e nunca são enviados ao Provedor nem incluídos no documento. Sem Permissão, não há crédito e a interface avisa.

Os limites seguem a [referência oficial de vídeos do YouTube](https://developers.google.com/youtube/data/reference/rest/v3/videos): título de 100 caracteres, descrição de 5000 bytes e tags de 500 caracteres, incluindo separadores e aspas quando aplicáveis.

