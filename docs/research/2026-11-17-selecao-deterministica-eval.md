# Avaliação Offline da Seleção Determinística por Sinais (#286)

Experimento executado no harness do [#57](2026-11-17-benchmark-selecao.md) em `core/src/selection/deterministic_benchmark.rs` (`selection_benchmark deterministic-eval`) a partir da [pesquisa #283](2026-11-17-selecao-deterministica.md), sem GPU, sem chamadas a Provedor e com zero custo de API.

> **Privacidade e escopo:** este relatório registra exclusivamente **agregados estatísticos e contagens** sobre cópia isolada de `bench.clipes` (`25,82 h`, `22.350` Frases, `38` Cortes humanos / `33` cenas únicas), sem trechos de Transcrição, nomes de criadores, títulos de live, URLs ou IDs de vídeo. Os artefatos brutos agregados permanecem fora do repositório (`w286_deterministic_eval.json`).

---

## 1. Ambiente, Base e Referências

- **Base lida (cópia isolada via `CLIPES_DATA_DIR`):**
  - **Fonte 0** (`pt`, `3,64 h`, `4.412` Frases, `14` Cortes humanos / `2` `< 20 s`, `9` cenas): **sem chat**, **com `heatmap` do YouTube** (`100` segmentos via `yt-dlp --skip-download`, sem cookies).
  - **Fonte 1** (`en`, `11,17 h`, `9.134` Frases, `11` Cortes humanos / `5` `< 20 s`, `11` cenas): **com chat** (`4.023` buckets de `10 s`), **sem `heatmap`** (VOD sem gráfico público no `yt-dlp`).
  - **Fonte 2** (`en`, `11,01 h`, `8.804` Frases, `13` Cortes humanos / `8` `< 20 s`, `13` cenas): **com chat** (`3.964` buckets de `10 s`), **sem `heatmap`** (VOD sem gráfico público no `yt-dlp`).
  - **Disponibilidade do `heatmap` (A5):** `1 / 3` Fontes (`yt-dlp --skip-download` sem cookies e sem download de mídia; zero erros 403).
- **Linhas de base já medidas na amostra estratificada fixa (`seed = 57`, `24` janelas / `5,76 h`, `34` Cortes / `29` cenas, [#127](2026-11-17-experimento-roteamento.md)):**
  - `codex:gpt-6.1-sol`: **`20,6%`** `recall_min50` (`7/34`, `[10,3%, 36,8%]`), `17,6% IoU >= 0,30`, `5,9% IoU >= 0,50`, `24,1%` cenas (`7/29`), `53` candidatos (`9,2/h`, precisão `13,2%`), `78,2 s/h`, `507.687` tokens de entrada.
  - `openai/gpt-oss-120b` (Groq, `#57`): **`14,7%`** `recall_min50` (`5/34`), `17,2%` cenas (`5/29`).
  - `Bonsai-8B-Q1_0` (local 1-bit): **`2,6%`** nas `112` janelas (`1/38`), `0,0%` na amostra (`0/34`).

---

## 2. Modo A — Geração Direta de Cortes por Sinais (Sem IA)

Todos os braços geram Cortes alinhados exclusivamente a limites de Frase inteira via `cut::fit` + `cut::merge_duplicates` com supressão não-máxima temporal (`45 s`), atingindo **`0,0%` (`0`) de bordas no meio de Frase** em todas as execuções.

### 2.1 Ablações individuais e combinações (`@15/h`, comparável em `min_us = 20 s` vs `10 s`)

| Braço (orçamento `@15/h`, salvo indicado) | `min_us` | `recall_min50` 3 lives (`38`, IC 95%) | `gt_cov_50` | `IoU>=0,30` (IC 95%) | `IoU>=0,50` | Cenas `min50` (`33`) | Precisão / Ruído (`3 lives`) | `recall_min50` `seed=57` (`34`, IC 95%) | Subconjunto aplicável |
|---|---:|---|---:|---|---:|---|---:|---|---|
| **`A1_peak_sym`** (só `Peak`, sim.) | `20 s` | `21,1%` (`8/38`, `[11,1%, 36,3%]`) | `15,8%` | `13,2%` (`[5,8%, 27,3%]`) | `7,9%` | `24,2%` (`8/33`) | `2,5%` / `97,5%` (`322`) | `23,5%` (`8/34`, `[12,4%, 40,0%]`) | — |
| **`A1_peak_asym`** (só `Peak`, `[-25,+15]s`) | `20 s` | `26,3%` (`10/38`, `[15,0%, 42,0%]`) | `21,1%` | `18,4%` (`[9,2%, 33,4%]`) | `13,2%` | `30,3%` (`10/33`) | `3,1%` / `96,9%` (`322`) | `23,5%` (`8/34`, `[12,4%, 40,0%]`) | — |
| **`A1_high_peak_asym`** (`all`, `928` cands) | `20 s` | `60,5%` (`23/38`, `[44,7%, 74,4%]`) | `47,4%` | `42,1%` (`[27,9%, 57,8%]`) | **`21,1%`** | `63,6%` (`21/33`) | `3,1%` / `96,9%` (`928`) | `64,7%` (`22/34`, `[47,9%, 78,5%]`) | — |
| **`A1_high_peak_asym`** (`@15/h`) | `20 s` | `31,6%` (`12/38`, `[19,1%, 47,5%]`) | `21,1%` | `21,1%` (`[11,1%, 36,3%]`) | `13,2%` | `30,3%` (`10/33`) | `3,1%` / `96,9%` (`388`) | `23,5%` (`8/34`, `[12,4%, 40,0%]`) | — |
| **`A2_audio_derived`** (loud+ΔdB+silêncio+WPS) | `20 s` | `13,2%` (`5/38`, `[5,8%, 27,3%]`) | `7,9%` | `10,5%` (`[4,2%, 24,1%]`) | `2,6%` | `12,1%` (`4/33`) | `1,3%` / `98,7%` (`388`) | `14,7%` (`5/34`, `[6,4%, 30,1%]`) | — |
| **`A3_chat_current`** (`2,0× / 10m / 4p / 10s`) | `20 s` | `15,8%` (`6/38`, `[7,4%, 30,4%]`) | `15,8%` | `15,8%` (`[7,4%, 30,4%]`) | `2,6%` | `18,2%` (`6/33`) | `2,2%` / `97,8%` (`267`) | `17,6%` (`6/34`, `[8,3%, 33,5%]`) | `6/24` (`25,0%`, `[12,0%, 44,9%]`) |
| **`A3_chat_balanced_57`** (`1,75× / 20m / 12p / 20s`) | `20 s` | `23,7%` (`9/38`, `[13,0%, 39,2%]`) | `23,7%` | `23,7%` (`[13,0%, 39,2%]`) | `10,5%` | `27,3%` (`9/33`) | `3,1%` / `96,9%` (`292`) | `26,5%` (`9/34`, `[14,6%, 43,1%]`) | `9/24` (`37,5%`, `[21,2%, 57,3%]`) |
| **`A3_chat_enriched`** (`+aceleração +reações -paid`) | `20 s` | `28,9%` (`11/38`, `[17,0%, 44,8%]`) | `28,9%` | `21,1%` (`[11,1%, 36,3%]`) | `10,5%` | `33,3%` (`11/33`) | `3,3%` / `96,7%` (`333`) | `26,5%` (`9/34`, `[14,6%, 43,1%]`) | `11/24` (`45,8%`; `all`: `14/24 = 58,3%`) |
| **`A4_text_det`** (gatilhos PT/EN + `?`/`!` + TextTiling) | `20 s` | `31,6%` (`12/38`, `[19,1%, 47,5%]`) | `21,1%` | `18,4%` (`[9,2%, 33,4%]`) | `10,5%` | `33,3%` (`11/33`) | `3,1%` / `96,9%` (`388`) | `23,5%` (`8/34`, `[12,4%, 40,0%]`) | — |
| **`A5_heatmap`** (YouTube *Most Replayed*) | `20 s` | `21,1%` (`8/38`, `[11,1%, 36,3%]`) | `5,3%` | `10,5%` (`[4,2%, 24,1%]`) | `2,6%` | `15,2%` (`5/33`) | `18,2%` / `81,8%` (`55`) | `17,6%` (`6/34`, `[8,3%, 33,5%]`) | **`8/14` (`57,1%`**, `[32,6%, 78,6%]`) |
| **`C1_universal`** (`0,65·A2 + 0,35·A4`, local) | `20 s` | **`23,7%`** (`9/38`, `[13,0%, 39,2%]`) | `15,8%` | `13,2%` (`[5,8%, 27,3%]`) | `2,6%` | `24,2%` (`8/33`) | `2,3%` / `97,7%` (`388`) | **`26,5%`** (`9/34`, `[14,6%, 43,1%]`) | — |
| **`C2_live_full`** (`C1 + A3 + A5` renormalizado) | `20 s` | **`42,1%`** (`16/38`, `[27,9%, 57,8%]`) | **`31,6%`** | **`31,6%`** (`[19,1%, 47,5%]`) | **`15,8%`** | **`45,5%`** (`15/33`) | `4,4%` / `95,6%` (`388`) | **`44,1%`** (`15/34`, `[28,9%, 60,5%]`) | `seed=57` prec: `18,6%` |
| *Sensibilidade (`min_us = 10 s`):* **`A3_chat_enriched`** | `10 s` | `21,1%` (`8/38`, `[11,1%, 36,3%]`) | `18,4%` | `21,1%` (`[11,1%, 36,3%]`) | **`18,4%`** | `24,2%` (`8/33`) | `2,4%` / `97,6%` (`333`) | `23,5%` (`8/34`, `[12,4%, 40,0%]`) | `8/24` (`33,3%`, `[18,0%, 53,3%]`) |
| *Sensibilidade (`min_us = 10 s`):* **`C1_universal`** | `10 s` | `18,4%` (`7/38`, `[9,2%, 33,4%]`) | `10,5%` | `10,5%` (`[4,2%, 24,1%]`) | `7,9%` | `18,2%` (`6/33`) | `1,8%` / `98,2%` (`388`) | `20,6%` (`7/34`, `[10,3%, 36,8%]`) | — |
| *Sensibilidade (`min_us = 10 s`):* **`C2_live_full`** | `10 s` | `36,8%` (`14/38`, `[23,4%, 52,7%]`) | `18,4%` | `21,1%` (`[11,1%, 36,3%]`) | `10,5%` | `39,4%` (`13/33`) | `3,9%` / `96,1%` (`388`) | `38,2%` (`13/34`, `[23,9%, 55,0%]`) | `seed=57` prec: `16,3%` |

### 2.2 Curva `recall@K` (`K ∈ {5, 10, 15, 20}` Cortes/h, `min_us = 20 s`)

| Combinação | `K` | Candidatos (3 lives / `seed=57`) | `recall_min50` 3 lives (IC 95%) | `IoU >= 0,30` (3 lives) | Cenas `min50` (`33`) | Precisão (3 lives) | `recall_min50` `seed=57` (IC 95%) | `IoU >= 0,30` (`seed=57`) | Precisão (`seed=57`) |
|---|---:|---:|---|---:|---|---:|---|---:|---:|
| `C1_universal` | `5/h` | `129` / `29` | `7,9%` (`3/38`, `[2,7%, 20,8%]`) | `5,3%` | `9,1%` (`3/33`) | `2,3%` | `8,8%` (`3/34`, `[3,0%, 23,0%]`) | `5,9%` | `10,3%` |
| `C1_universal` | `10/h` | `258` / `58` | `21,1%` (`8/38`, `[11,1%, 36,3%]`) | `10,5%` | `21,2%` (`7/33`) | `3,1%` | `26,5%` (`9/34`, `[14,6%, 43,1%]`) | `14,7%` | `13,8%` |
| `C1_universal` | `15/h` | `388` / `86` | `23,7%` (`9/38`, `[13,0%, 39,2%]`) | `13,2%` | `24,2%` (`8/33`) | `2,3%` | `26,5%` (`9/34`, `[14,6%, 43,1%]`) | `14,7%` | `10,5%` |
| `C1_universal` | `20/h` | `516` / `115` | `31,6%` (`12/38`, `[19,1%, 47,5%]`) | `18,4%` | `33,3%` (`11/33`) | `2,3%` | `26,5%` (`9/34`, `[14,6%, 43,1%]`) | `14,7%` | `7,8%` |
| `C2_live_full` | `5/h` | `129` / `29` | `23,7%` (`9/38`, `[13,0%, 39,2%]`) | `18,4%` | `27,3%` (`9/33`) | `7,8%` | `20,6%` (`7/34`, `[10,3%, 36,8%]`) | `20,6%` | `24,1%` |
| `C2_live_full` | `10/h` | `258` / `58` | `36,8%` (`14/38`, `[23,4%, 52,7%]`) | `26,3%` | `39,4%` (`13/33`) | `5,8%` | `35,3%` (`12/34`, `[21,5%, 52,1%]`) | `26,5%` | `22,4%` |
| `C2_live_full` | `15/h` | `388` / `86` | **`42,1%`** (`16/38`, `[27,9%, 57,8%]`) | **`31,6%`** | **`45,5%`** (`15/33`) | `4,4%` | **`44,1%`** (`15/34`, `[28,9%, 60,5%]`) | **`35,3%`** | `18,6%` |
| `C2_live_full` | `20/h` | `516` / `115` | **`47,4%`** (`18/38`, `[32,5%, 62,7%]`) | **`34,2%`** | **`51,5%`** (`17/33`) | `3,7%` | **`47,1%`** (`16/34`, `[31,5%, 63,3%]`) | **`38,2%`** | `14,8%` |

### 2.3 Achados das ablações do Modo A

1. **Expansão assimétrica (`[-25 s, +15 s]`) supera a simétrica (`[-20 s, +20 s]`) em energia:** `A1_peak` sobe de `21,1%` para `26,3%` (`@15/h`) e `A1_high_peak` sobe de `21,1%` para `31,6%` (`@15/h`), confirmando que o pico acústico acontece no clímax e exige contexto anterior.
2. **Sinais derivados de áudio (`A2`) sofrem com falsos positivos de pausa:** mesmo exigindo salto `>= 8 dB` ou `Peak` após silêncio `>= 2 s`, ainda ocorrem `119–354` disparos por live; isolado, `A2` (`13,2% @15/h`) perde para `A1_peak_asym` (`26,3%`), indicando que `Peak` de `energy.rs` deve ter peso dominante em relação a saltos curtos e velocidade de fala.
3. **Texto determinístico (`A4`) surpreende isolado (`31,6% @15/h` nas 3 lives):** palavras-gatilho PT/EN + `?`/`!` + fronteiras TextTiling localizaram `12/38` Cortes humanos sem depender de áudio nem chat.
4. **Chat enriquecido (`A3_chat_enriched`) dobra o sinal atual (`25,0% -> 45,8% @15/h`, `58,3%` sem teto) nas Fontes com chat**, combinando a calibração equilibrada do `#57`, aceleração entre buckets, proporção de reações e penalização de `paid`.
5. **`heatmap` do YouTube (`A5`) é forte quando existe (`57,1% = 8/14` em `@10/h` na Fonte 0), mas falta em `2/3` das lives:** por isso a renormalização automática de `C2` é essencial.
6. **Sensibilidade `min_us = 10 s` vs `20 s`:** reduzir o mínimo de `20 s` para `10 s` melhora `IoU >= 0,50` em sinais bem localizados (ex.: `A3_chat_enriched`: `10,5% -> 18,4%`; `C1_universal`: `2,6% -> 7,9%`), porém derruba `recall_min50` (`C2`: `42,1% -> 36,8%`; `A3_chat_enriched`: `28,9% -> 21,1%`) porque janelas curtas (~16 s) toleram menos deslocamento temporal entre âncora e borda humana.
7. **Comparação justa contra a IA (`seed = 57`):** no mesmo orçamento de ~`10` candidatos/h do `codex:gpt-6.1-sol` (`9,2/h`, `20,6%`, precisão `13,2%`), `C1_universal @10/h` atinge `26,5%` (precisão `13,8%`) e `C2_live_full @10/h` atinge `35,3%` (precisão `22,4%`). Em `@15/h`, `C2` alcança `44,1%` (`15/34`). A contrapartida nas lives completas (`25,82 h`) é a taxa de ruído alta (`95,6%–97,7%`), exigindo revisão humana.

---

## 3. Modo B — Simulação do Pré-filtro para IA (`15%`, `25%`, `35%`, `50%`)

Avaliamos duas estratégias: **B1** (filtrar Janelas de `15 min` do planejador, somando os 3 melhores picos NMS por Janela) e **B2** (extrair regiões focadas de ~`105 s` ao redor dos melhores picos NMS, eliminando a sobreposição de `3 min` entre Janelas).

### 3.1 Estratégia B1 — Filtragem de Janelas do Planejador (`129` Janelas totais; `24` na amostra Codex)

| Pontuador | Orçamento | Janelas mantidas (3 lives / `s57`) | Duração mantida | Chars mantidos | Gabarito 3 lives (`38`) | Cenas (`33`) | Gabarito `s57` (`34`) | Acertos Codex sobreviventes (`7`) | Economia tokens Codex | Economia tempo Codex |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `C1_universal` | `15%` | `19/129` / `5/24` | `15,9%` | `14,9%` | `2/38` (`5,3%`) | `2/33` | `8/34` | `1/7` (`14,3%`) | `78,6%` | `77,3%` |
| `C1_universal` | `25%` | `33/129` / `7/24` | `28,7%` | `26,5%` | `5/38` (`13,2%`) | `5/33` | `10/34` | `1/7` (`14,3%`) | `70,3%` | `67,8%` |
| `C1_universal` | `35%` | `45/129` / `9/24` | `39,1%` | `36,6%` | `12/38` (`31,6%`) | `12/33` | `11/34` | `1/7` (`14,3%`) | `61,9%` | `60,2%` |
| `C1_universal` | `50%` | `65/129` / `12/24` | `54,7%` | `53,2%` | `15/38` (`39,5%`) | `15/33` | `12/34` | `1/7` (`14,3%`) | `49,1%` | `46,2%` |
| `C2_live_full` | `15%` | `19/129` / `5/24` | `17,6%` | `15,9%` | `16/38` (`42,1%`) | `11/33` | `17/34` | `4/7` (`57,1%`) | `79,1%` | `81,8%` |
| `C2_live_full` | `25%` | `33/129` / `7/24` | `29,4%` | `25,6%` | `19/38` (`50,0%`) | `14/33` | `18/34` | `4/7` (`57,1%`) | `70,8%` | `75,0%` |
| `C2_live_full` | `35%` | `45/129` / `9/24` | `40,5%` | `34,6%` | **`20/38` (`52,6%`)** | `15/33` | `20/34` | **`5/7` (`71,4%`)** | **`63,0%`** | **`66,7%`** |
| `C2_live_full` | `50%` | `65/129` / `12/24` | `55,1%` | `50,6%` | `23/38` (`60,5%`) | `18/33` | `22/34` | `5/7` (`71,4%`) | `49,9%` | `51,5%` |

### 3.2 Estratégia B2 — Regiões Focadas (`~105 s` por âncora, sem sobreposição de `3 min`)

| Pontuador | Orçamento | Regiões (3 lives) | Duração mantida | Tokens vs planejador | Economia vs planejador | Cobertura `gt>=50%` (`38`) | Cobertura `min50` (`38`) | Cenas (`33`) | Acertos Codex sobreviventes (`7`) | Tempo est. Codex (`s/h`) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `C1_universal` | `15%` | `138` | `15,2%` | `15,8%` | `84,2%` | `6/38` (`15,8%`) | `9/38` | `5/33` | `0/7` (`0,0%`) | `12,4 s/h` |
| `C1_universal` | `25%` | `207` | `25,2%` | `26,1%` | `73,9%` | `10/38` (`26,3%`) | `13/38` | `8/33` | `1/7` (`14,3%`) | `20,4 s/h` |
| `C1_universal` | `35%` | `267` | `35,1%` | `37,1%` | `62,9%` | `12/38` (`31,6%`) | `15/38` | `10/33` | `2/7` (`28,6%`) | `29,0 s/h` |
| `C1_universal` | `50%` | `325` | `50,2%` | `53,6%` | `46,4%` | `23/38` (`60,5%`) | `26/38` | `21/33` | `2/7` (`28,6%`) | `41,9 s/h` |
| `C2_live_full` | `15%` | `131` | `15,1%` | `15,2%` | `84,8%` | `11/38` (`28,9%`) | `14/38` | `10/33` | `4/7` (`57,1%`) | `11,9 s/h` |
| `C2_live_full` | `25%` | `206` | `25,1%` | `25,5%` | `74,5%` | `13/38` (`34,2%`) | `16/38` | `12/33` | `4/7` (`57,1%`) | `19,9 s/h` |
| `C2_live_full` | `35%` | `270` | `35,2%` | `36,2%` | `63,8%` | **`15/38` (`39,5%`)** | `18/38` | `14/33` | **`4/7` (`57,1%`)** | `28,3 s/h` |
| `C2_live_full` | `50%` | `333` | `50,2%` | `51,7%` | `48,3%` | `20/38` (`52,6%`) | `23/38` | `18/33` | `4/7` (`57,1%`) | `40,4 s/h` |

---

## 4. Decisão pelos Critérios da Seção 7.3 (#283)

1. **Modo A (Seleção por sinais, sem IA) — APROVADO para `Corte direto` na v1:**
   - **Critério (#283 §7.3):** adotar na v1 para `Corte direto` se `C1`/`C2` em `recall@15/h` atingir **`>= 20%`** (com `0%` de bordas no meio de Frase) ou superar claramente o modelo local pequeno (`2,6%` do `Bonsai-8B`).
   - **Evidência:** em `min_us = 20 s` e `@15/h`, **`C1_universal` atinge `23,7%`** nas 3 lives (`26,5%` em `seed = 57`) e **`C2_live_full` atinge `42,1%`** nas 3 lives (`44,1%` em `seed = 57`), com **`0,0%` de bordas no meio de Frase**, superando com folga tanto o critério mínimo (`20%`) quanto o `Bonsai-8B` (`2,6%`) e igualando/superando o `codex:gpt-6.1-sol` (`20,6%`) a custo **$0,00** e **0 tokens**.
   - **Restrições obrigatórias na UI/produto (ticket futuro):** aplicar apenas a `Corte direto` (bloquear ou exigir confirmação forte para `Vídeo transformado`), exibir rótulo explícito *"Gerado por sinais locais (sem IA)"* com badges explicáveis e alertar sobre a taxa de ruído (`95,6%–97,7%` fora do gabarito em 25,82 h, exigindo curadoria humana).

2. **Modo B (Pré-filtro para IA) — NÃO ativar por padrão; manter apenas como opção "Modo econômico":**
   - **Critério (#283 §7.3):** só ligar por padrão se, em **`<= 35%` dos tokens**, atingir cobertura **`>= 80%`** sobre os `38` Cortes humanos (ou **`>= 85%`** de retenção dos acertos do Codex). Caso a cobertura caia abaixo de **`70%`**, manter apenas como opção **"Modo econômico"** na UI.
   - **Evidência:** em `~35%` de orçamento, a melhor combinação (`C2_live_full`) cobre **`52,6%` (`20/38`)** na filtragem por Janelas (retendo **`5/7 = 71,4%`** do Codex, economia de `63,0%` tokens / `66,7%` tempo) e **`39,5%` (`15/38`)** em regiões focadas (retendo **`4/7 = 57,1%`** do Codex). `C1_universal` fica em `31,6%` (`12/38`) e `14,3%–28,6%` do Codex. Todas as variantes ficam abaixo de `70%` porque parte dos Cortes humanos ocorre em trechos calmos/conversacionais sem pico acústico ou de chat.
   - **Decisão:** **não ativar por padrão**; oferecer em ticket futuro apenas como opção **"Modo econômico"** na UI, informando explicitamente a economia estimada (`~63%–70%` de tokens/tempo) e o risco de perder Cortes sem pico evidente.

3. **Constantes de `chat.rs` e `energy.rs`:** permanecem inalteradas até validação em `>= 6` Fontes anotadas (`#57` / `#283 §7.3`).
