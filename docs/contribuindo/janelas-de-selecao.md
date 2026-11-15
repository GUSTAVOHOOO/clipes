# Planejador de Janelas de seleção

O planejador (`core/src/selection_windows.rs`, #144) dimensiona as **Janelas de seleção** que o #53 vai enviar ao Provedor. Ele só calcula: não seleciona, não pontua, não cria jobs e não tem UI. A pesquisa de origem é a #115, seção 6.2. Termos no [glossário](../../GLOSSARY.md).

## Duas camadas

- `plan(&PlanInput) -> Result<Plan, PlanError>` é **pura**: sem arquivo, sem rede e sem chamar o estimador. Recebe, por Frase, `id`, tempos e caracteres da linha compacta (com escape de JSON); o contexto efetivo com origem categórica; a razão de tokens por caractere (baixa e alta) já resolvida; os tokens fixos (envelope, instrução e schema); a saída e o raciocínio reservados; o maior Corte permitido; e o menor limiar de preço, se houver.
- `plan_for_profile(&ProfileRequest, &[Sentence])` é o wrapper fino. Lê o contexto efetivo do cache do #143 (`provider::effective_cached`, sem sondar a rede), chama `cost::planning_range` (razão, Transcrição inteira) e `cost::planning_fixed_tokens` (envelope vazio) **uma vez cada**, usa `compact_with_hint` do #49/#140 e toma o menor `aboveInputTokens` de `Price.tiers` (#141). Sem faixas, não há limite de preço. Nada sai da máquina, então o veto "somente local" (#123) não tem o que barrar aqui.

Quem chama informa a instrução, o schema, a saída e o raciocínio reservados (`DEFAULT_OUTPUT_RESERVE` e `DEFAULT_REASONING_RESERVE` são só valores de partida) e o maior Corte (`DEFAULT_OVERLAP_US`, 3 min, até o Perfil de canal do #72 existir).

## Regras numéricas

Todas são constantes públicas e documentadas no módulo:

| Regra | Constante | Valor |
|---|---|---|
| Teto de duração | `WINDOW_MAX_US` | 15 min |
| Sobreposição = maior Corte | `DEFAULT_OVERLAP_US` | 3 min |
| Mínimo planejado | `MIN_WINDOW_FACTOR` × sobreposição | 9 min |
| Maior Corte aceito | `MAX_CUT_US` = teto ÷ fator | 5 min |
| Margem do estimador | `CONTEXT_USABLE_PERCENT` | 85 % do contexto |
| Limite pelo preço | `PRICE_THRESHOLD_PERCENT` | 85 % do menor limiar |

Entrada máxima = `min(85 % do contexto − saída − raciocínio, 85 % do limiar)`; os tokens fixos saem dela antes da Transcrição. A janela usa a ponta **alta** da estimativa. O #57 só sobe o teto de 15 min com ganho medido.

## Como as janelas são formadas

Cada janela vai até a última Frase que respeita o teto de 15 min e o orçamento de tokens. A próxima começa na primeira Frase que começa depois de `fim − sobreposição`; assim todo Corte de até a sobreposição que cruza o fim de uma janela cabe inteiro na seguinte. A Frase nunca é dividida e não há lacuna entre janelas. Uma janela mais curta que a sobreposição, ou cuja sucessora não alcançaria a Frase seguinte (silêncio maior que o teto), recomeça depois dela; assim o planejador sempre avança.

Soma prefixada de caracteres e busca binária: uma live de 11 h (dezenas de milhares de Frases) planeja em milissegundos.

## Estados

- **cheia**: nenhuma janela foi encurtada por tokens;
- **reduzida**: cabe, mas ao menos uma janela termina antes do teto por limite de tokens;
- **bloqueada**: erro `context_too_small`. Em cada início de janela, a janela de `min(mínimo, o que existe até o teto)` tem que caber nos tokens; uma Frase maior que a janela possível também bloqueia. Uma Fonte mais curta que o mínimo vira uma única janela com a Fonte inteira, desde que caiba.

A mensagem é fixa e traz o contexto efetivo, a origem (usuário, carregado, servidor, catálogo, padrão, medido) e as saídas: aumentar o contexto no Perfil de Provedor ou escolher outro perfil. Não oferece forçar nem trocar sozinho.

Outros erros tipados: `max_cut_too_long` (Corte acima de `MAX_CUT_US`; o teto não cresce por configuração) e `invalid_selection_plan` (Frases fora de ordem, razão ou Corte inválidos).

Testes: unitários em `core/src/selection_windows/tests.rs` (4096, 8192, 16384, 32768 e 1 M; lives de 1, 4 e 11 h; raciocínio; durações de Corte; silêncio; Fonte curta) e `core/tests/selection_windows.rs` (wrapper com perfis, origem e limiar de preço, sem rede).

## Razão de planejamento antes da calibração (#173)

Uma só regra, em `cost::planning_range`, vale para `plan_for_profile` e, por ele, para `provider.selection_state` (#146):

- **Fala (Transcrição):** sem calibração (menos de `cost::CALIBRATION_MIN_SAMPLES` amostras da chave), ponto × `cost::PLANNING_UNCALIBRATED_FACTOR` (1,2). Com calibração, a ponta alta calibrada. O motivo: com a ponta alta sem calibração (ponto ×1,5), um perfil de 8192 tokens bloqueava e a calibração do formato compacto nunca acontecia nele.
- **Parte fixa (envelope, instrução, schema):** `cost::planning_fixed_tokens`, ponto ×1,0 sem calibração. É o mesmo texto em toda janela e o núcleo o conhece por inteiro; a margem ×1,2 existe para a variação da fala. O erro da estimativa continua coberto pela margem de 15 % do contexto.
- **Não muda:** o orçamento de custo e o teto antes de cada envio (#124/#141) seguem na ponta alta (`token_range().high`). Em servidor local, o #145 pega o truncamento se a estimativa errar para baixo.

**Fato medido** (Fonte sintética do #146, sem calibração, perfil `openai` sem limiar de preço): 7 936 tokens bloqueia e 7 968 reduz; portanto 4 096 bloqueia, 8 192 reduz e 16 384 é cheio. O teste `measured_threshold_sits_between_7936_and_7968` fixa os dois lados. Não ajuste constantes para acertar um número.
