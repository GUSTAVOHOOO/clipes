---
status: accepted
---

# Custo, orçamento e auditoria de chamadas de IA: uma linha por chamada, hashes sem texto, teto checado antes de cada chamada

Cada chamada ao Provedor deixa no Projeto uma linha de custo e uma de auditoria, **inclusive as que falham depois de receber resposta**. Decisão do dev em 14/11/2026, a partir da [pesquisa do harness (#114)](https://github.com/GUSTAVOHOOO/clipes/issues/114) e da [pesquisa de roteamento (#113)](https://github.com/GUSTAVOHOOO/clipes/issues/113). Complementa o [#40](https://github.com/GUSTAVOHOOO/clipes/issues/40), o [ADR-0005](0005-projeto-portatil-com-sqlite.md) (custos e jobs são tabelas) e o [ADR-0006](0006-relato-de-problemas-sem-telemetria.md).

Uma resposta inválida já foi cobrada pelo Provedor. O núcleo guarda o custo agregado por tarefa e por lote, e as falhas de limite de taxa e HTTP ainda não carregam `usage`. Sem o número por chamada, não há como somar, auditar nem aplicar teto com honestidade.

## Custo e orçamento

1. **Uma linha por chamada** (e por reparo), com tarefa, versão da tarefa, perfil, modelo, tokens (nulos quando o Provedor não informa), resultado e custo estimado e real. Modelo local custa zero. CLI mostra "consome a cota do plano" e fica sem custo em moeda.
2. **O orçamento tem cinco limites:** chamadas, tokens, tempo, custo por tarefa e custo por lote. Ao estourar, **só a fila afetada pausa**, e o usuário decide continuar com um novo teto. Dentro da tarefa, os resultados parciais são preservados.
3. **O teto de custo checa a estimativa antes de cada chamada e para se ela passar do teto.** O teto não é "aproximado": nenhuma chamada começa se a estimativa já o ultrapassa. A estimativa de tokens de entrada é por caracteres, e o `usage` real ajusta a seguinte.
4. **CLIs contam só por número de chamadas**, porque não informam `usage`. **Um perfil sem preço conhecido não entra em teto por custo**: a UI mostra "custo desconhecido" e o lote pede confirmação, em vez de dar falsa segurança.

## Chamadas repetidas e verificação extra

5. **Timeout de modelo local pode ser repetido sem confirmação**, porque o custo é zero. O job de modelo local roda como `local`, e o timeout deve variar por tipo de Provedor, já que 60 s pode ser curto para CPU. **Chamada paga com resultado incerto continua nunca sendo repetida às cegas** ([ADR-0005](0005-projeto-portatil-com-sqlite.md)): vira `uncertain`, e repetir exige confirmação mostrando o custo estimado.
6. **Juiz e voting ficam desligados até o benchmark [#57](https://github.com/GUSTAVOHOOO/clipes/issues/57) provar ganho** que pague o custo de 2 a 5 chamadas por unidade. **Nunca rodam em CLI**, onde cada chamada exige confirmação e gasta cota. Se um dia existirem, só anotam: nunca aprovam Roteiro nem bloqueiam ([ADR-0001](0001-dois-tipos-de-video-e-regras-de-transformacao.md), regra 5).

## Auditoria

7. **A auditoria do Projeto guarda só hashes e metadados:** tarefa, versão, hash do prompt, hash da entrada, Provedor, host, modelo, tamanho enviado, hash da resposta e resultado. **Sem texto.** O texto da Transcrição já está no Projeto, e o hash da entrada mais os IDs de Frase enviados reconstroem o que foi enviado sem duplicá-lo.
8. **Guardar o corpo completo de prompts e respostas é um opcional futuro**, desligado por padrão, com opt-in e aviso ao compartilhar o Projeto. Hoje não entra.
9. **A trilha é do Projeto e é portátil:** ao compartilhar, os metadados de Provedor e modelo vão junto.
10. **Nada de texto de prompt, Transcrição ou Roteiro vai ao log ou ao diagnóstico.** O diagnóstico ganha só `task_version` e `prompt_sha256`, pela emenda ao [ADR-0006](0006-relato-de-problemas-sem-telemetria.md).

## Opções consideradas

- **Custo só por tarefa ou por lote, como no #40:** perde as falhas cobradas e impede saber o que cada perfil gastou.
- **Teto aproximado, com a última chamada em voo podendo passar:** é mais simples, mas o usuário veria um gasto maior que o teto que pôs. A checagem antes de cada chamada custa uma estimativa e dá um teto de verdade.
- **Guardar o corpo completo por padrão:** dobra o armazenamento e põe Roteiro e Transcrição num segundo lugar do Projeto, contra a privacidade do ADR-0006.
- **Repetir também chamada paga incerta, com confirmação genérica:** o ADR-0005 proíbe repetir às cegas, e o custo da repetição precisa estar visível.
- **Batch APIs dos Provedores (desconto, resultado em até 24 h):** conflita com o resultado imediato e com a regra do ADR-0005. Só com grilling próprio.
