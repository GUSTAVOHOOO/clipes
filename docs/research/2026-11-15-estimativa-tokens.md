# Estimativa de tokens e formato compacto (#140)

A estimativa inicial usa as razões medidas na pesquisa de lives longas e a faixa de 0,8 a 1,5 do ponto. O teto de orçamento usa a ponta superior; a estimativa não é uma contagem exata de tokenizer.

A calibração é global e separada por perfil, modelo, formato e idioma. O ponto usa a razão entre os tokens e os caracteres somados nas últimas 20 chamadas válidas. Com menos de três observações mantém-se a faixa inicial; a partir de três, a faixa usa 0,95 vezes a menor razão e 1,10 vezes a maior, sem ser mais estreita que 0,9 a 1,2 vezes o ponto. Erros, saída truncada, uso ausente e entradas suspeitas de truncamento (menos de 50% do limite inferior inicial) não alimentam a calibração. Esses números são parâmetros para futuras medições.

Os metadados de estimativa são internos e não são enviados ao Provedor. `generic` e `und` são os valores padrão de formato e idioma. A Transcrição continua sendo dado não confiável, e marcadores temporais não são tempos de Corte fornecidos pelo modelo.
