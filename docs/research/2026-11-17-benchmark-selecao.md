# Benchmark de seleção de Cortes (#57)

Avaliação do pipeline de seleção (`core/src/selection.rs`), calibração offline da detecção de picos de chat (`core/src/chat.rs`), taxa de bordas no meio de Frase, tempo ativo e custo por hora em API compatível com OpenAI (Groq).

> **Escopo e anonimização:** este relatório registra apenas **agregados, métricas e distribuições estatísticas**, sem trechos de transcrição, nomes de criadores, títulos ou IDs de vídeo.
>
> **Nota sobre amostragem:** devido aos limites do tier gratuito (`on_demand`) da chave Groq (**8.000 TPM** e **200.000 TPD por modelo**), a comparação principal entre modelos foi executada sobre uma **amostra estratificada fixa de 24 janelas (`seed = 57`)**, cobrindo **34 de 38 Cortes humanos** (`5,76 h` de áudio amostrado), complementada pela medição completa das **112 janelas** no planejador e pela calibração offline integral das 2 Fontes com chat (`24` Cortes humanos). Todos os intervalos de confiança usam Wilson 95%.

---

## 1. Ambiente, Dataset e Preparo Local

- **Hardware e runtime local (transcrição e energia):** Windows 11, GPU RTX 3050 Laptop 4 GB, driver CUDA, modelo local `whisper-turbo` (`cuda`, `int8_float16`), FFmpeg local, execução headless isolada via `CLIPES_DATA_DIR`.
- **Ausência de LLM local:** nenhum servidor LLM local (`Ollama`, `LM Studio` ou `llama.cpp`) estava instalado ou ativo nesta máquina; foram avaliados os três modelos ativos na chave Groq (`openai/gpt-oss-120b`, `openai/gpt-oss-20b` e `qwen/qwen3.8-27b`). O suporte a Provedor local permanece como lacuna desta rodada para benchmark futuro.
- **Versão fixa da Tarefa de IA:** `selection` `taskVersion = 3`, `promptSha256 = e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a`, `max_output_tokens = 2.000`, `max_calls = 2`, faixa de duração alvo `20–60 s` (`MIN_CUT_US = 20 s`, teto `300 s`).

### Resumo das Fontes preparadas (25,82 h totais; 38 Cortes humanos / 33 cenas únicas)

| Fonte (anon.) | Idioma | Duração | Chat replay | Frases | RTF GPU | Tempo transcr. | Tempo energia | Marcas energia (`high` / `peak`) | Picos chat (brutos / planejador) | Cortes humanos (`< 20 s`) |
|---|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|
| Fonte A | `pt` | 3,64 h | Não | 4.411 | 0,148 | 1.935,9 s | 40,9 s | 670 / 211 | — | 14 (2; 9 cenas únicas) |
| Fonte B | `en` | 11,17 h | Sim | 9.134 | 0,107 | 4.299,2 s | 213,5 s | 1.373 / 451 | 423 / 306 (`976` frases) | 11 (5) |
| Fonte C | `en` | 11,01 h | Sim | 8.804 | 0,122 | 4.836,8 s | 374,3 s | 1.185 / 414 | 360 / 268 (`820` frases) | 13 (8) |
| **Total** | — | **25,82 h** | **2/3** | **22.349** | — | **11.071,9 s** | **628,7 s** | **3.228 / 1.076** | **783 / 574** | **38 (15; 39,5%)** |

> **Fato de distribuição do gabarito:** `15 / 38` (**39,5%**) dos Cortes humanos têm duração inferior a `20 s` (`2/14` em Fonte A, `5/11` em Fonte B com mediana `24,2 s`, e `8/13` em Fonte C com mediana `16,5 s`, mínimo `10,9 s`). Como o núcleo exige `MIN_CUT_US = 20 s`, candidatos válidos de `20–60 s` centrados no momento correto são estruturalmente penalizados em `IoU`; por isso reportamos `min_overlap >= 50%` (fração coberta do menor intervalo) ao lado de `IoU >= 0,30`, `IoU >= 0,50` e `gt_cov >= 50%`.

---

## 2. Achado de Produto: Limites do Groq Free Tier (8k TPM / 200k TPD) e Janelas > 8k Tokens

Na tentativa inicial completa (sem amostragem) com `openai/gpt-oss-20b --chat on` sobre as **112 janelas**, apenas **6 / 112** concluíram antes do esgotamento diário (`Used 199.247 / 200.000 TPD`; gasto `$0,0053`; `3/14 = 21,4%` recall `min50` em Fonte A; `0%` bordas no meio de Frase), acumulando `584 rate_limit (HTTP 429)`, `44 provider_http`, `17 budget_calls` e `1 output_truncated` em `2.000` tokens.

### Diagnóstico das 112 janelas planejadas (`core/src/selection_windows.rs`)

Sem encolher janelas manualmente, medimos a estimativa de entrada (`provider.cost.estimate`, heurística conservadora ~1,35–1,40× tokens BPE reais) e o teto de requisição (`estInputTokens + 2.000 max_output_tokens`) sobre todas as 112 janelas:

| Fonte | Janelas | Entrada est. (mín / med / p95 / máx) | `estInput > 8.000` | `estInput + 2.000 > 8.000` | Índices e tamanhos (`estInput`, chars, frases) com `estInput > 8.000` |
|---|---:|---:|---:|---:|---|
| Fonte A (`pt`) | 16 | 5.271 / 7.008 / 9.101 / 9.452 | **3** (18,8%) | **14** (87,5%) | `w=4` (`9.022t`, `10.027c`, `400f`), `w=7` (`9.452t`, `10.939c`, `405f`), `w=8` (`9.101t`, `10.246c`, `398f`) |
| Fonte B (`en`) | 48 | 3.590 / 5.675 / 7.343 / 8.265 | **1** (2,1%) | **18** (37,5%) | `w=38` (`8.265t`, `10.086c`, `338f`) |
| Fonte C (`en`) | 48 | 2.993 / 5.165 / 7.850 / 8.998 | **3** (6,3%) | **9** (18,8%) | `w=10` (`8.998t`, `10.278c`, `369f`), `w=11` (`8.740t`, `9.857c`, `419f`), `w=18` (`8.511t`, `10.011c`, `368f`) |
| **Total** | **112** | — | **7 (6,3%)** | **41 (36,6%)** | **7 janelas só na entrada; 41 considerando a reserva de saída (`+2.000`)** |

### Modos de falha observados nas chamadas reais

1. **Estouro de TPM por requisição (`HTTP 413 rate_limit_exceeded`):** confirmado por sonda controlada (`Limit 8000, Requested 8240`) e na amostra real (`source_2 w=11`, `estInput=8.740`, `419` frases, falha imediata em `134 ms`). O planejador atual (`selection_windows.rs`) dimensiona pelo `context_window` do modelo (`131.072`), ignorando o teto por minuto/requisição do tier (`8.000 TPM`), e `core/src/provider/adapters.rs:326-328` classifica `HTTP 413` como `provider_http` em vez de `rate_limit`.
2. **Truncamento de raciocínio com schema estrito (`HTTP 400 json_validate_failed` -> `provider_http`):** modelos de raciocínio (`gpt-oss-120b` e `gpt-oss-20b`) consomem ~70%+ dos tokens de saída em `reasoning_tokens`. Com `max_output_tokens = 2.000` (`core/src/selection.rs:196`) e `strict: true` em `json_schema`, quando a geração atinge `2.000` tokens antes de fechar o JSON, o Groq retorna `HTTP 400` após `2,8–5,4 s` (observado em `7/8` falhas de `gpt-oss-120b`, `3.656–5.436 ms`, e `5/5` `provider_http` de `gpt-oss-20b` na amostra, `2.831–3.083 ms`), consumindo cota diária no servidor sem retornar `usage`.
3. **Sem espaçamento entre janelas e colisão de `max_calls=2`:** `selection.start` enfileira todas as janelas sem pausa TPM; `adapters.rs:388` rejeita `Retry-After > 30 s`; e `SELECTION_BUDGET.max_calls = 2` (`selection.rs:194`) esgota em `budget_calls` quando `adapters.rs` tenta retentativas internas de 429 (`control::before_call`).

---

## 3. Desenho da Amostra Estratificada Fixa (`seed = 57`, `n = 24` janelas)

Para comparar os três modelos dentro de `<= 8.000 TPM` e `<= 190.000 TPD/dia/modelo` sem martelar 429, o runner (`core/examples/selection_benchmark.rs plan-sample`) selecionou deterministicamente `n = 24` janelas proporcionais às 3 lives (`16 / 48 / 48` -> `4 / 10 / 10`), estratificadas entre janelas que sobrepõem Cortes humanos (`17` janelas cobrindo **34 / 38 Cortes** / `29` cenas únicas) e janelas negativas de controle sem Corte (`7` janelas):

| Fonte | Janelas totais | Amostra (`clip` + `controle`) | Cortes humanos cobertos | Janelas na amostra com `estInput > 8k` (`+2k > 8k`) |
|---|---:|---:|---:|---:|
| Fonte A (`pt`) | 16 | **4** (`3 + 1`) | 14 / 14 (9 cenas) | 2 (4) |
| Fonte B (`en`) | 48 | **10** (`7 + 3`) | 7 / 11 (7 cenas) | 0 (4) |
| Fonte C (`en`) | 48 | **10** (`7 + 3`) | 13 / 13 (13 cenas) | 3 (6) |
| **Total** | **112** | **24 (`17 + 7`)** | **34 / 38 (`89,5%`, 29 cenas)** | **5 (14)** |

As chamadas na amostra foram espaçadas em janela móvel de `64 s` para não ultrapassar `7.600` tokens/min.

---

## 4. Resultados por Provedor na Amostra (`--chat on`)

Preços configurados via tabela oficial Groq (`openai/gpt-oss-120b`: `$0,15 / $0,60` por 1M; `openai/gpt-oss-20b`: `$0,075 / $0,30` por 1M; `qwen/qwen3.8-27b`: `$0,80 / $4,00` por 1M).

| Modelo | Janelas (`ok/tent.`) | Erros (`http`/`429`) | Candidatos | Bordas meio de Frase | Recall `min50` (IC 95%) | Recall `IoU>=0,30` (IC 95%) | Recall `IoU>=0,50` | Recall cenas `min50` (IC 95%) | Custo total (`$/h` amostrada) | Tempo ativo API (`s/h` amost.) | Relógio c/ pausa TPM |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `openai/gpt-oss-120b` | 16 / 24 | 8 / 0 | 48 | **0 / 48 (0,0%)** | **14,7%** (`5/34`, [6,4%, 30,1%]) | **8,8%** (`3/34`, [3,0%, 23,0%]) | 8,8% (`3/34`) | **17,2%** (`5/29`, [7,6%, 34,5%]) | **$0,0257** (`$0,00445/h`) | **98,3 s** (`17,1 s/h`; ok: `64,6 s` / `11,2 s/h`) | 1.593 s |
| `qwen/qwen3.8-27b` | **24 / 24** | **0 / 0** | 29 (`15` janelas `[]`) | **0 / 29 (0,0%)** | **0,0%** (`0/34`, [0,0%, 10,2%]) | **0,0%** (`0/34`, [0,0%, 10,2%]) | 0,0% (`0/34`) | **0,0%** (`0/29`, [0,0%, 11,7%]) | **$0,1181** (`$0,02050/h`) | **32,2 s** (`5,59 s/h`) | 1.592 s |
| `openai/gpt-oss-20b` (amostra parcial*) | 1 / 7 | 5 / 1 | 3 | **0 / 3 (0,0%)** | 0,0% (`0/17`, [0,0%, 18,4%]) | 0,0% (`0/17`) | 0,0% (`0/17`) | 0,0% (`0/12`, [0,0%, 24,3%]) | $0,0006 (`$0,00036/h`) | 17,1 s (`9,82 s/h`) | 473 s |
| `openai/gpt-oss-20b` (rodada inicial s/ pausa*) | 6 / 112 | 44 / 584 | 13 | **0 / 13 (0,0%)** | 7,9% (`3/38`, **PT: `3/14 = 21,4%`** [7,6%, 47,6%]) | 5,3% (`2/38`) | 2,6% (`1/38`) | 9,1% (`3/33`) | $0,0053 | — | 1.722 s |

*\*Nota sobre `openai/gpt-oss-20b`:* a rodada inicial completa esgotou a cota rolante de 24h (`199.247 / 200.000` TPD); horas depois, na amostra estratificada, o modelo voltou a falhar com `provider_http` em `5/7` janelas (`2,8–3,1 s`, `reasoning_tokens` em `max_tokens=2.000`), completou `1` janela pequena (`w=12`, `3.590` est_in) e parou em `rate_limit` persistente na janela `7` (`1/7` em `1,74 h` amostradas).

### Quebra por idioma (amostra com chat ligado)

- **`openai/gpt-oss-120b`:**
  - `pt` (Fonte A, `4/4` janelas concluídas): `12` candidatos, `0%` meio de Frase, **`21,4%`** `recall_min50` (`3/14`, IC 95% `[7,6%, 47,6%]`), **`33,3%`** por cenas únicas (`3/9`), `7,1% IoU>=0,30` (`1/14`), custo `$0,0076` (`23.390` in / `6.774` out).
  - `en` (Fontes B+C, `12/20` janelas concluídas, `8` falhas `provider_http`): `36` candidatos, `0%` meio de Frase, **`10,0%`** `recall_min50` (`2/20`, IC 95% `[2,8%, 30,1%]`), `10,0% IoU>=0,30` (`2/20`), custo `$0,0181` (`49.220` in / `17.854` out).
- **`qwen/qwen3.8-27b`:**
  - `pt` (`4/4` janelas concluídas): **todos os 4 pedidos retornaram `candidates: []`** (`13` tokens de saída cada), `0/14` recall (`0,0%`), custo `$0,0202`.
  - `en` (`20/20` janelas concluídas): `29` candidatos em `9` janelas (`11` retornaram `[]`), `0%` meio de Frase, `0/20` recall (`0,0%`), custo `$0,0980`.

### Integridade das bordas de Frase e ajustes do núcleo

- **Bordas no meio de Frase:** **0,0%** em absolutamente todos os modelos e execuções (`0/48` no `120b`, `0/29 + 0/9` no `qwen`, `0/13 + 0/3` no `20b`), atingindo a meta de `0%`.
- **Ajustes automáticos de `cut.rs`:** `0` candidatos descartados (`tooShort=0`, `tooLong=0`, `unknownId=0`); `27/48` (`56,3%`) dos candidatos de `120b` e `16/29` (`55,2%`) de `qwen` foram estendidos/aparados pelo ajustador respeitando limites de Frase.

### Custo total real acumulado no benchmark

`$0,0053` (`20b` inicial) + `$0,025668` (`120b` amostra) + `$0,118139` (`qwen --chat on`) + `$0,000635` (`20b` amostra) + `$0,056431` (`qwen --chat off`) = **`$0,2062` USD totais** (`10,3%` do teto de US$ 2,00).

---

## 5. Comparação: Com vs Sem Marcas de Chat

### 5.1 Experimento end-to-end `--chat on` vs `--chat off` (cota restante em `qwen/qwen3.8-27b`)

Com a cota diária restante de `qwen/qwen3.8-27b` (`~77k` tokens remanescentes de `200k` TPD), rodamos o braço `--chat off` até o teto seguro de `70k` tokens sobre as mesmas janelas com replay de chat (`10/10` janelas da Fonte B + `3` primeiras janelas `w=10, 11, 12` da Fonte C = **13 janelas idênticas**, cobrindo `12` Cortes humanos):

| Braço (`qwen/qwen3.8-27b`) | Janelas idênticas | Candidatos propostos | Janelas não vazias | Bordas meio Frase | Recall `min50` (IC 95%) | Custo (USD) |
|---|---:|---:|---:|---:|---:|---:|
| `--chat on` (subconjunto EN idêntico) | 13 / 13 | **24** (`16` Fonte B + `8` Fonte C) | **6 / 13** | 0,0% | 0,0% (`0/12`, [0,0%, 24,3%]) | — |
| `--chat off` (`max_tpd=70k`, usou `62.044t`) | 13 / 13 | **9** (`9` Fonte B + `0` Fonte C) | **3 / 13** | 0,0% | 0,0% (`0/12`, [0,0%, 24,3%]) | `$0,0564` |

As marcas de chat multiplicaram por **2,67×** a quantidade de candidatos propostos nas mesmas 13 janelas (especialmente na Fonte C, que caiu de `8` candidatos para `0` sem chat), mas o modelo não converteu essas propostas em acerto sobre o gabarito (`0/12` em ambos). Não havia cota TPD suficiente no mesmo dia para repetir o braço `--chat off` em `gpt-oss-120b` (~58k restantes) ou `gpt-oss-20b` (0k restante).

### 5.2 Avaliação e calibração offline do sinal de chat contra o gabarito (`24` Cortes em `2` Fontes)

Avaliamos diretamente `peaks_with` (`core/src/chat.rs`) nas 2 Fontes com chat replay (`24` Cortes humanos = `11` na Fonte B e `13` na Fonte C), testando uma grade de **576 combinações** (`atraso ∈ {0, 5, 10, 15, 20, 30} s`, `razão ∈ {1.5, 1.75, 2.0, 2.25, 2.5, 3.0}×`, `janela ∈ {5, 10, 15, 20} min`, `mín_pessoas ∈ {4, 6, 8, 12}`) em match exato e com tolerância de `±10 s`:

#### Baseline atual (`atraso = 10 s`, `razão = 2,0×`, `janela = 10 min`, `mín_pessoas = 4`)

| Critério | Cortes atingidos (recall) | Variância entre as 2 Fontes | Picos totais | Picos dentro de Corte | **Picos fora de Corte (ruído)** | Taxa de ruído | Precisão | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Exato `[início - atraso, fim - atraso)` | **8 / 24 (`33,3%`)** | `27,3%` — `38,5%` | 783 | 8 | **775** | **98,98%** | 1,02% | 0,0198 |
| Tolerância `±10 s` | **10 / 24 (`41,7%`)** | `38,5%` — `45,5%` | 783 | 17 | **766** | **97,83%** | 2,17% | 0,0413 |

> **Ruído de chat:** **98,98%** (`775 / 783`, ou `97,83%` com `±10 s`) dos picos brutos detectados caem **fora de todo Corte humano** (raids, sorteios, trens de subs, cumprimento a novos inscritos e picos de gameplay não clipados). Isso confirma a necessidade de o chat atuar apenas como reforço contextual junto com texto e energia de áudio, nunca como gatilho isolado.

#### Sensibilidade por parâmetro (exato, variando 1 parâmetro por vez sobre o padrão)

| Eixo variado | Valores testados | Recall agregado (exato) | Picos totais | Ruído (`%`) |
|---|---|---:|---:|---:|
| **Atraso de reação** (`2,0× / 10m / 4p`) | `0s` / `5s` / `10s` / `15s` / `20s` / `30s` | `4,2%` / `16,7%` / **`33,3%`** / `33,3%` / **`37,5%`** / **`37,5%`** | 783 | 99,7% → 97,7% |
| **Razão de pico** (`10s / 10m / 4p`) | `1,5×` / `1,75×` / `2,0×` / `2,25×` / `2,5×` / `3,0×` | **`62,5%`** / `54,2%` / `33,3%` / `25,0%` / `12,5%` / `8,3%` | 1.724 → 229 | 98,6% — 99,2% |
| **Janela da mediana** (`10s / 2,0× / 4p`) | `5 min` / `10 min` / `15 min` / `20 min` | `25,0%` / `33,3%` / **`37,5%`** / **`37,5%`** | 667 / 783 / 855 / 895 | 99,1% → 98,1% |

#### Configurações extremas vs equilibradas na grade

| Perfil na grade | `atraso` | `razão` | `janela` | `mín_pessoas` | Recall exato (por Fonte) | Recall `±10 s` | Ruído exato / `±10 s` | F1 exato / `±10 s` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Padrão atual (`core/src/chat.rs`) | 10 s | 2,0× | 10 min | 4 | **33,3%** (`27,3%–38,5%`) | **41,7%** | 98,98% / 97,83% | 0,0198 / 0,0413 |
| Maior F1 da grade (muito restritivo) | 30 s | 3,0× | 5 min | 12 | 20,8% (`18,2%–23,1%`) | 20,8% | 94,84% / 93,55% | **0,0827 / 0,0985** |
| Equilibrado p/ recall (menor variância) | 30 s | 1,75× | 20 min | 12 | **58,3%** (`54,5%–61,5%`) | **58,3%** | 96,37% / 95,30% | 0,0684 / 0,0870 |

#### Recomendação sobre `core/src/chat.rs`

**Não alterar as constantes de `core/src/chat.rs` nesta PR:** o conjunto tem apenas **2 Fontes com chat replay (`n = 24` Cortes)**, insuficiente para evitar *overfitting* ao ritmo específico dessas duas transmissões. Fica registrado como recomendação empírica para reavaliação quando houver >= 6 Fontes anotadas com chat replay:
- Manter **atraso >= `10 s`** (`0 s` acerta apenas `1/24 = 4,2%`), considerando `15–20 s` quando o objetivo for reduzir variância entre canais;
- Testar **`razão = 1,75×` com `janela = 15–20 min` e `mín_pessoas = 8–12`** como candidato principal em amostra maior (saltou de `33,3%` para `58,3%` sem explodir para os `1.724` picos de `1,5×`).

---

## 6. Síntese e Próximos Passos

1. **Meta de bordas (`0%` no meio de Frase):** atingida (**0 / 102** candidatos somando todas as execuções).
2. **Qualidade de seleção vs gabarito:** `openai/gpt-oss-120b` liderou (`14,7%` `min50` / `17,2%` por cena / `8,8% IoU>=0,30`), superando `qwen/qwen3.8-27b` (`0,0%`, excessivamente conservador com `15/24` janelas vazias), com `gpt-oss-20b` alcançando `21,4%` em PT na rodada inicial antes de esgotar o TPD. Parte estrutural da queda em `IoU` decorre de `39,5%` dos Cortes humanos serem mais curtos (`< 20 s`) que o mínimo atual (`20 s`).
3. **Ações recomendadas em produto (novos tickets):**
   - Dimensionamento de janelas e adaptação/tratamento de teto TPM/requisição por Provedor (evitar `413` nas janelas > 8k e classificar `413` como `rate_limit` ou código específico em `adapters.rs`);
   - Reservar `max_output_tokens > 2.000` (ou separar orçamento de raciocínio) para modelos *reasoning* sob `json_schema` estrito, evitando `HTTP 400 json_validate_failed`;
   - Separar contagem de `max_calls` das retentativas de `429` e respeitar `Retry-After > 30 s` / espaçamento TPM em fila paga;
   - Avaliar LLM local e `>= 6` lives com chat em máquina/tier sem gargalo de `8k TPM` / `200k TPD` para consolidar recalibração de `chat.rs` e comparar `--chat on` vs `--chat off` em todos os modelos.
