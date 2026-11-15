# Estimativa de tokens e formato compacto (#140)

A estimativa inicial usa as razões medidas na pesquisa de lives longas e a faixa de 0,8 a 1,5 do ponto. O teto de orçamento usa a ponta superior; a estimativa não é uma contagem exata de tokenizer.

A calibração é global e separada por perfil, modelo, formato e idioma. O ponto usa a razão entre os tokens e os caracteres somados nas últimas 20 chamadas válidas. Com menos de três observações mantém-se a faixa inicial; a partir de três, a faixa usa 0,95 vezes a menor razão e 1,10 vezes a maior, sem ser mais estreita que 0,9 a 1,2 vezes o ponto. Erros, saída truncada, uso ausente e entradas suspeitas de truncamento (menos de 50% do limite inferior inicial) não alimentam a calibração. Esses números são parâmetros para futuras medições.

Os metadados de estimativa são internos e não são enviados ao Provedor. `generic` e `und` são os valores padrão de formato e idioma. A Transcrição continua sendo dado não confiável, e marcadores temporais não são tempos de Corte fornecidos pelo modelo.

## Avaliação local PT/EN no dataset #28

Medição offline com `tiktoken` o200k_base em cache, usando os 110 trechos de transcrição disponíveis. Para cada trecho, um script local agrupou palavras por pontuação ou pausa de 700 ms, produziu linhas ID/texto e marcadores por minuto e contou o envelope, a instrução e um schema mínimo. Esta reconstrução aproxima a segmentação do núcleo: não reproduz a divisão recursiva de Frases longas, e os IDs são locais ao trecho; portanto os números não são validação de IDs nem contagem exata de uma chamada real. Não foi enviado texto a nenhum Provedor.

O conjunto foi ordenado por arquivo e dividido ao meio por idioma. As últimas 20 observações da primeira metade simulam `usage.inputTokens` e calibram o ponto; a segunda metade mede o erro absoluto somado dividido pelos tokens reais. O tokenizer é um proxy, não um usage de API. O ponto inicial usa 1 token por 3,3 caracteres para o formato compacto.

| Idioma | Trechos | Caracteres | Tokens proxy | Caracteres/token | Treino | Validação | Erro inicial | Erro calibrado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| EN | 70 | 69.996 | 16.890 | 4,144 | 20 | 35 | 24,33% | 7,16% |
| PT | 40 | 41.283 | 11.286 | 3,658 | 20 | 20 | 8,70% | 8,01% |

A amostra é pequena, formada por trechos e não por lives inteiras; a redução do erro não comprova a precisão para outros modelos, idiomas ou janelas. A faixa superior continua sendo usada para o orçamento.
