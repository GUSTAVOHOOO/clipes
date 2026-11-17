# Experimento de Roteamento Multi-Provedor sobre o #57 (#127)

Avaliação empírica das políticas de roteamento propostas na [pesquisa #113 (seção 8)](2026-11-14-roteamento-multi-provedor.md#8-experimento-barato-calibrar-com-dados-nossos) sobre o harness de seleção do [#57](2026-11-17-benchmark-selecao.md): execução por janela de um modelo local pequeno em GPU (`Bonsai-8B-Q1_0`), reuso dos agregados de API barata no Groq (#57) e execução por janela do modelo forte via Codex CLI (`gpt-6.1-sol`), com reprodução offline das políticas `sempre-barato`, `sempre-forte`, `oráculo`, `cascata` e `duas passadas`.

> **Escopo, anonimização e declarações obrigatórias:**
> 1. Este relatório registra apenas **agregados, métricas e distribuições estatísticas**, sem trechos de transcrição, nomes de criadores, títulos ou IDs de vídeo. Todas as saídas por janela permanecem fora do repositório (`clipes-bench/`), e nenhuma chave entra no Git.
> 2. **Apenas a seleção de Cortes tem gabarito** neste conjunto; Empacotamento, Roteiro e tradução não possuem verdade de campo.
> 3. **O gabarito é provisório**: **38 segmentos humanos em 3 lives** (`14` em `pt` na Fonte A; `11` em `en` na Fonte B; `13` em `en` na Fonte C; `33` cenas únicas ao unir sobreposições), sendo `15/38` (`39,5%`) mais curtos que `MIN_CUT_US = 20 s` (o que penaliza `IoU`; por isso reportamos `recall_min50` ao lado de `IoU >= 0,30`, `IoU >= 0,50` e `gt_cov >= 50%`).
> 4. **O oráculo é otimista por construção**: escolhe retrospectivamente por janela o braço com maior acerto sobre o gabarito e contabiliza apenas o custo/tempo do braço escolhido.

---

## 1. Braços Avaliados, Runtime e Amostragem

| Braço | Papel | Modelo e Runtime | Custo unitário | Cobertura neste experimento |
|---|---|---|---|---|
| **Local pequeno** | Barato / privacidade | `prism-ml/Bonsai-8B-gguf` (`Bonsai-8B-Q1_0.gguf`, Apache-2.0, `1.158.654.496` bytes, SHA-256 `284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54`) em `llama.cpp` upstream `b12475` (`67cf8967e`, Windows CUDA 12.4, `127.0.0.1`, `-c 16384 -ngl 99 -fa on -ctk q8_0 -ctv q8_0 --reasoning-budget 0`, `2.451 / 4.096 MiB` VRAM) | **US$ 0,00** (local) | **24 janelas** (amostra `seed = 57`) **+ 112 janelas completas** (`25,82 h`) |
| **Forte (assinatura)** | Forte | `codex exec -m gpt-6.1-sol` (`codex-cli 0.169.0`), adaptador restrito ao harness (`core/examples/routing_benchmark.rs`), prompt da Tarefa `selection` (`v3`) + `--output-schema` + verificadores do núcleo, ferramentas desabilitadas | **US$ 0,00 marginal** (assinatura do dev; consome janela de 5 h) | **24 janelas** (amostra estratificada `seed = 57`, `5,76 h`, `34/38` Cortes / `29` cenas)* |
| **API barata (referência #57)** | Barato API | Groq (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`) medidos no [#57](2026-11-17-benchmark-selecao.md) sobre a **mesma amostra (`seed = 57`, 24 janelas)** | `$0,15/$0,60`, `$0,075/$0,30` e `$0,80/$4,00` por 1M tok | **Reuso dos agregados do #57** (cota de `200k TPD` esgotada pelo #57 no mesmo dia) |

*\*Nota de escopo da amostra:* o braço Codex ficou restrito às mesmas **24 janelas estratificadas** do #57 (`seed = 57`: `4` na Fonte A, `10` na Fonte B, `10` na Fonte C; `--tpr 131072 --tpm 131072` no `plan-sample` para reproduzir exatamente a grade original de `112` janelas pré-#272) para dividir a janela de 5 h da assinatura com o experimento #148. O braço local sem cota diária (`Bonsai-8B-Q1_0`) foi ampliado para todas as **112 janelas**.

- **Tarefa de IA fixa:** `selection` `taskVersion = 3`, `promptSha256 = e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a`, `max_output_tokens = 2.000`, `MIN_CUT_US = 20 s`, `MAX_CUT_US = 180 s`.
- **Preparo local (RTX 3050 4 GB, `whisper-turbo` CUDA `int8_float16`):** Fonte A `4.412` Frases (`RTF 0,149`, `38,9 s` energia, sem chat); Fonte B `9.134` Frases (`RTF 0,110`, `129,5 s` energia, `423` picos chat); Fonte C `8.804` Frases (`RTF 0,097`, `124,5 s` energia, `359` picos chat).

---

## 2. Desempenho Individual dos Braços na Amostra Fixa (`seed = 57`, 24 janelas / 5,76 h)

Todos os intervalos de confiança usam **Wilson 95%**.

| Modelo / Braço | Janelas (`schema ok` / `regras ok` / tent.) | Falhas | Candidatos | Bordas meio de Frase | `recall_min50` (IC 95%) | `IoU >= 0,30` (IC 95%) | `IoU >= 0,50` | Recall cenas `min50` (IC 95%) | Tempo ativo (`s/h`) | Custo real (`$/h`) |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **`codex:gpt-6.1-sol`** (forte, assinatura) | **24 / 24 / 24** (`100%`) | 0 | 53 | **0 / 53 (0,0%)** | **20,6%** (`7/34`, `[10,3%, 36,8%]`) | **17,6%** (`6/34`, `[8,3%, 33,5%]`) | 5,9% (`2/34`) | **24,1%** (`7/29`, `[12,2%, 42,1%]`) | `78,2 s/h` (`med 20,5 s`, `p95 24,5 s`) | **$0,00** (assinatura) |
| **`openai/gpt-oss-120b`** (Groq, #57) | 16 / 16 / 24 (`66,7%`) | `8 provider_http` | 48 | **0 / 48 (0,0%)** | **14,7%** (`5/34`, `[6,4%, 30,1%]`) | 8,8% (`3/34`, `[3,0%, 23,0%]`) | **8,8%** (`3/34`) | 17,2% (`5/29`, `[7,6%, 34,5%]`) | `17,1 s/h` (`ok: 11,2 s/h`) | `$0,00445/h` |
| **`Bonsai-8B-Q1_0`** (local CUDA) | **21 / 3 / 24** (`87,5%` / **`12,5%`**) | `18 verification_failed`, `3 output_truncated` | 6 | **0 / 6 (0,0%)** | **0,0%** (`0/34`, `[0,0%, 10,2%]`) | 0,0% (`0/34`, `[0,0%, 10,2%]`) | 0,0% (`0/34`) | 0,0% (`0/29`, `[0,0%, 11,7%]`) | `133,6 s/h` (`med 31,1 s`, `p95 49,4 s`) | **$0,00** |
| **`qwen/qwen3.8-27b`** (Groq, #57) | 24 / 24 / 24 (`100%`) | 0 (`15` janelas `[]`) | 29 | **0 / 29 (0,0%)** | **0,0%** (`0/34`, `[0,0%, 10,2%]`) | 0,0% (`0/34`, `[0,0%, 10,2%]`) | 0,0% (`0/34`) | 0,0% (`0/29`, `[0,0%, 11,7%]`) | `5,59 s/h` | `$0,02050/h` |
| **`openai/gpt-oss-20b`** (Groq, #57 parcial) | 1 / 1 / 7 (`14,3%`) | `5 provider_http`, `1 rate_limit` | 3 | **0 / 3 (0,0%)** | 0,0% (`0/17`, `[0,0%, 18,4%]`) | 0,0% (`0/17`) | 0,0% (`0/17`) | 0,0% (`0/12`, `[0,0%, 24,3%]`) | `9,82 s/h` | `$0,00036/h` |

### Quebra por idioma na amostra (`pt` vs `en`)

- **`codex:gpt-6.1-sol`:**
  - `pt` (`4/4` janelas, `0,99 h`): `11` candidatos, `0%` meio de Frase, **`28,6%`** `recall_min50` (`4/14`), **`44,4%`** por cenas únicas (`4/9`), `21,4% IoU>=0,30` (`3/14`), `87,0 s/h`.
  - `en` (`20/20` janelas, `4,77 h`): `42` candidatos, `0%` meio de Frase, **`15,0%`** `recall_min50` (`3/20`), `15,0%` por cenas (`3/20`), `15,0% IoU>=0,30` (`3/20`), `76,4 s/h`.
- **`Bonsai-8B-Q1_0`:**
  - `pt` (`0/4` regras válidas: `3 verification_failed`, `1 output_truncated`): `0` candidatos, `0,0%` recall (`0/14`), `184,0 s/h`.
  - `en` (`3/20` regras válidas: `15 verification_failed`, `2 output_truncated`): `6` candidatos, `0,0%` recall (`0/20`), `123,1 s/h`.

### Ampliação do braço local (`Bonsai-8B-Q1_0`) para todas as 112 janelas (`25,82 h`)

| Métrica (`Bonsai-8B-Q1_0`, 112 janelas) | Fonte A (`pt`, 16 janelas) | Fonte B (`en`, 48 janelas) | Fonte C (`en`, 48 janelas) | **Total (112 janelas)** |
|---|---:|---:|---:|---:|
| Validade de schema (`full_schema`) | `9 / 16` (`56,3%`) | `36 / 48` (`75,0%`) | `37 / 48` (`77,1%`) | **`82 / 112` (`73,2%`)** |
| Validade de regras determinísticas | `2 / 16` (`12,5%`) | `3 / 48` (`6,3%`) | `8 / 48` (`16,7%`) | **`13 / 112` (`11,6%`)** |
| Erros (`verification_failed` / `output_truncated`) | `7` / `7` | `33` / `12` | `29` / `11` | **`69` / `30`** |
| Candidatos válidos gerados | `3` | `9` | `15` | **`27`** (`0 / 27 = 0,0%` meio de Frase) |
| `recall_min50` (IC 95%) | `0 / 14` (`0,0%`) | `1 / 11` (`9,1%`) | `0 / 13` (`0,0%`) | **`1 / 38` (`2,6%`**, `[0,5%, 13,5%]`) |
| `recall_iou30` / cenas `min50` | `0,0%` / `0,0%` | `0,0%` / `9,1%` | `0,0%` / `0,0%` | `0,0%` / **`3,0%` (`1/33`)** |
| Tokens (`entrada` / `saída`) | `94.276` / `24.277` | `202.956` / `63.451` | `194.211` / `59.206` | **`491.443` / `146.934`** |
| Latência (`med` / `p95` / `s/h`) | `214,0 s/h` | `176,9 s/h` | `148,7 s/h` | **`170,1 s/h`** (`med 35,3 s`, `p95 66,8 s`, `4.392,2 s` totais) |

**Diagnóstico qualitativo das falhas de regra no modelo 1-bit local:** apesar da gramática GBNF garantir JSON sintaticamente aderente ao `wire_schema` em `73,2%` das janelas (`87,5%` na amostra), o modelo 1-bit de 8B falhou nas regras determinísticas em **`69 / 112` janelas** e truncou em `2.000` tokens em outras **`30 / 112`** devido a ciclos repetitivos:
- `duplicate_candidate`: **`228`** ocorrências em **`61`** janelas (`15/24` na amostra); o modelo repete o mesmo par `(startId, endId)` até atingir `too_many_candidates` (`8` janelas) ou estourar `max_output_tokens = 2.000` (`30` janelas);
- `unknown_sentence_id`: **`58`** ocorrências em **`11`** janelas (`5/24` na amostra);
- `start_after_end`: **`7`** ocorrências em **`2`** janelas (`1/24` na amostra).

Esse comportamento confirma empiricamente a regra 2 do [ADR-0008](../adr/0008-contrato-de-saida-estruturada-agnostico-de-provedor.md) e a seção 4.2 do #113: **gramática/schema nativo não basta para garantir validade semântica em modelos locais pequenos**.

---

## 3. Reprodução Offline das Políticas de Roteamento (Amostra de 24 janelas, `seed = 57`)

Par avaliado: **barato** = `Bonsai-8B-Q1_0` (local CUDA) e **forte** = `codex:gpt-6.1-sol` (Codex CLI). Simulação executada sobre os registros pareados por `(sourceIndex, windowIndex)` com `core/src/selection/routing_benchmark.rs`, aplicando `cut::fit` e `cut::merge_duplicates` idênticos aos do produto.

| Política offline | Taxa de escalada | Janelas válidas no fim | Candidatos | Bordas meio de Frase | `recall_min50` (IC 95%) | `IoU >= 0,30` | Recall cenas `min50` | Tempo (`s/h`) | Tokens forte (`in` / `out`) | Custo real (`$/h`) | Custo API eq. s/ overhead CLI* (`$/h`) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`always_cheap`** (só Bonsai-8B) | `0,0%` (`0/24`) | `12,5%` (`3/24`) | 6 | `0,0%` | `0,0%` (`0/34`, `[0,0%, 10,2%]`) | `0,0%` | `0,0%` | `133,6 s/h` | `0` / `0` | **$0,00** | `$0,00000/h` |
| **`always_strong`** (só Codex) | `100,0%` (`24/24`) | **`100,0%`** (`24/24`) | 53 | `0,0%` | **`20,6%`** (`7/34`, `[10,3%, 36,8%]`) | **`17,6%`** | **`24,1%`** | **`78,2 s/h`** | `507.687` / `10.400` | **$0,00** | `$0,06016/h` (`$0,3467` total) |
| **`oracle`** (otimista por janela) | `70,8%` (`17/24`) | `75,0%` (`18/24`) | 38 | `0,0%` | **`20,6%`** (`7/34`, `[10,3%, 36,8%]`) | **`17,6%`** | **`24,1%`** | `91,9 s/h` | `359.358` / `7.109` | **$0,00** | — |
| **`cascade`** (escala se schema/regra falha) | **`87,5%`** (`21/24`) | **`100,0%`** (`24/24`) | 54 | `0,0%` | `17,6%` (`6/34`, `[8,3%, 33,5%]`) | `14,7%` | `20,7%` | **`203,6 s/h`** | `447.079` / `9.445` | **$0,00** | `$0,05451/h` (`$0,3141` total; `$0,0131/janela`) |
| **`cascade_or_empty`** (variante: escala tb em `[]`) | `87,5%` (`21/24`) | `100,0%` (`24/24`) | 54 | `0,0%` | `17,6%` (`6/34`, `[8,3%, 33,5%]`) | `14,7%` | `20,7%` | `203,6 s/h` | `447.079` / `9.445` | **$0,00** | `$0,05451/h` |
| **`two_pass`** (barato filtra -> forte analisa) | `12,5%` (`3/24`) | `12,5%` (`3/24`) | 5 | `0,0%` | `2,9%` (`1/34`, `[0,5%, 14,9%]`) | `2,9%` | `3,4%` | `141,7 s/h` | `60.608` / `955` | **$0,00** | `$0,00564/h` (`$0,0325` total) |

*\*Nota sobre tokens e custo equivalente de API:*
- O `codex exec` injeta ~`19k` tokens de sistema/harness por chamada (`507.687` entrada reportados, sendo `81.920` com cache de prompt; `10.400` saída com `2.045` de raciocínio) e tem **custo marginal real US$ 0,00** na assinatura.
- A coluna "Custo API eq. s/ overhead CLI" mostra quanto custaria chamar `gpt-6.1-sol` via API OpenAI (`$2,00 / $10,00` por 1M tokens em `core/src/provider/prices.json`) usando o volume real de entrada do prompt+transcrição (`121.326` tokens totais; `109.845` nas 21 janelas escaladas pela cascata) e a saída observada (`10.400` e `9.445` tokens). Com o overhead bruto do CLI incluído, os equivalentes seriam `$0,1943/h` (`always_strong`) e `$0,1716/h` (`cascade`, média `$0,0412/janela`).

### Quebra por idioma das políticas (`pt` vs `en`)

| Idioma | `always_cheap` (`min50` / `s/h`) | `always_strong` (`min50` / `s/h`) | `oracle` (`esc` / `min50`) | `cascade` (`esc` / `min50` / `s/h`) | `two_pass` (`esc` / `min50`) |
|---|---:|---:|---:|---:|---:|
| **`pt`** (`4` janelas, `14` Cortes) | `0,0%` (`0/14`) / `184,0 s/h` | **`28,6%`** (`4/14`) / `87,0 s/h` | `75,0%` / `28,6%` | `100,0%` / `28,6%` / `271,0 s/h` | `0,0%` / `0,0%` |
| **`en`** (`20` janelas, `20` Cortes) | `0,0%` (`0/20`) / `123,1 s/h` | **`15,0%`** (`3/20`) / `76,4 s/h` | `70,0%` / `15,0%` | `85,0%` / `10,0%` / `189,6 s/h` | `15,0%` / `5,0%` |

---

## 4. Análise e Decisão sobre Escalada Automática (#113, seção 8)

Aplicando exatamente o critério de decisão definido na [pesquisa #113 (seção 8)](2026-11-14-roteamento-multi-provedor.md#8-experimento-barato-calibrar-com-dados-nossos):

> *"Se a cascata chega perto do forte com bem menos tokens do forte, e o oráculo está muito acima de sempre-forte (há o que ganhar), seguir para o ADR da escalada. Se sempre-forte ≈ oráculo, não rotear."*

Os dados medidos dão uma resposta inequívoca:

1. **`sempre-forte == oráculo` (`20,6% == 20,6%` em `recall_min50`; `17,6% == 17,6%` em `IoU >= 0,30`; `24,1% == 24,1%` em cenas):** o modelo local 1-bit não acertou nenhum Corte que o modelo forte tenha perdido, então não há complementaridade a explorar por roteamento por janela.
2. **A `cascata` não economiza e piora tempo e recall:**
   - Como `Bonsai-8B-Q1_0` falhou nos verificadores determinísticos ou truncou em `87,5%` das janelas (`88,4%` em todas as 112), a cascata precisou escalar `21/24` janelas, economizando apenas **12,5%** das chamadas fortes (`$0,0057/h` no equivalente de API sem overhead de CLI);
   - Mesmo assim, perdeu 1 Corte (`20,6% -> 17,6%`) porque nas `3` janelas em que o Bonsai passou nas regras, seus candidatos não coincidiram com o Corte humano (ao contrário do `gpt-6.1-sol`);
   - Em tempo de relógio, a cascata foi **`2,60×` mais lenta** que chamar o forte direto (`203,6 s/h` vs `78,2 s/h`), pois pagou `133,6 s/h` de inferência local na RTX 3050 antes de escalar `87,5%` das janelas.
3. **`duas passadas` com filtro local pequeno é inviável neste nível de qualidade:** como `Bonsai-8B-Q1_0` só produziu janelas válidas com candidatos em `3/24` (`12,5%`), filtrar janelas por ele derrubou o recall de `20,6%` para `2,9%` (`1/34`).
4. **Limitações adicionais observadas em paralelo (#57):**
   - Na comparação entre modelos de API barata no #57, `qwen/qwen3.8-27b` também obteve `0,0%` (`0/34`) e custou `$0,02050/h`, enquanto `openai/gpt-oss-120b` obteve `14,7%` (`5/34`) a `$0,00445/h` com `8/24` erros `provider_http` por truncamento de raciocínio sob `max_output_tokens = 2.000`.
   - Mesmo um modelo forte (`codex:gpt-6.1-sol`, melhor marca até aqui: `20,6%` geral e `28,6%` / `44,4%` cenas em `pt`) tem `0,0%` de erros de borda (`0/53` no meio de Frase), mas ainda encontra o teto estrutural de `MIN_CUT_US = 20 s` diante de `39,5%` de Cortes humanos curtos.

### Recomendação

**Não implementar escalada automática nem cascata/duas passadas com modelos locais 1-bit de 8B na v1.** A decisão registrada no [ADR-0010](../adr/0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md) — **regra fixa por tarefa + troca manual ("refazer com o forte")** — permanece a melhor relação entre previsibilidade de custo, latência, privacidade ("somente local") e qualidade medida.
