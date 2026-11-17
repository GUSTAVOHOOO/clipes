# Experimento de tamanho e formato das janelas de seleção (#148)

Data: 2026-11-17. Ticket: #148. Base: benchmark de seleção do #57 (`2026-11-17-benchmark-selecao.md`).

Este relatório traz só agregados. Não há trechos de transcrição, nomes de criadores, títulos de live nem IDs de vídeo.

## 1. Pergunta e resposta curta

**Pergunta.** A janela de 15 min com formato compacto (H) que o núcleo usa hoje é a melhor escolha? Comparamos janelas de 10, 15, 30 e 60 min, sobreposição de 0, 1 e 3 min e dois formatos de transcrição: H (compacto) e B (completo, com mais campos por linha).

**Resposta.** Com o gabarito disponível (34 Cortes humanos na amostra), nenhuma combinação se separa das outras. Todos os intervalos de confiança de 95% se sobrepõem de forma ampla. Mesmo a configuração do produto, medida em duas execuções independentes (esta e a do #127), deu 3/34 e 7/34. O ruído de execução é do tamanho das diferenças entre células.

**Recomendação para a v1:** manter janelas de 15 min com sobreposição de 3 min e formato H. Detalhes na seção 7.

## 2. Método e reprodutibilidade

- Provedor: Codex CLI, modelo `gpt-6.1-sol`, contexto de 500.000 tokens, `--chat on`, assinatura do dev (custo marginal US$ 0).
- `taskVersion = 3`; `promptSha256 = e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a`.
- Amostra estratificada fixa (`seed = 57`): 24 janelas de 15 min do plano de 112 janelas das 3 lives do dataset #28, cobrindo 34 dos 38 Cortes humanos (14 em PT, 20 em EN). Para janelas maiores, cada região amostrada é expandida até o tamanho da janela, então as horas de áudio processadas crescem com o tamanho (5,5 h em 10 min, 15,9 h em 60 min). O denominador do recall é o mesmo (34 Cortes) em todas as células da amostra. Tokens e tempo são normalizados por hora processada.
- Referência de live inteira (`full_ov0m_*`): 3 lives completas (25,8 h), denominador de 38 Cortes.
- Métricas: recall humano `min50` (candidato cobre pelo menos 50% do Corte), `IoU>=0,30`, `IoU>=0,50`, recall por cena (Cortes sobrepostos contam como uma cena), IC 95% de Wilson, PT e EN separados, bordas no meio de Frase, Cortes humanos que cruzam a borda de uma janela e validade da saída.
- Execução só no harness (`core/src/selection/benchmark.rs` e `core/examples/selection_benchmark.rs`). O produto não mudou: `WINDOW_MAX_US` continua 15 min, o formato B não existe no app. Os dados de #127 e #57 ficaram só para leitura; as saídas do #148 usam o prefixo `w148_`.
- Overhead fixo do `codex exec`: cada chamada carrega cerca de 14 mil a 19 mil tokens de prompt interno do Codex. A coluna "Tokens in" inclui esse overhead, então janelas pequenas parecem mais caras do que são. Não foi possível separar só a transcrição.

## 3. Matriz medida

Todas as células abaixo rodaram com `taskVersion = 3`, o mesmo prompt acima e 100% das janelas válidas, exceto onde indicado. `midSentenceBoundaries = 0` em todas (0% de bordas no meio de Frase). "Cruzam janela" são Cortes humanos que não cabem inteiros em nenhuma janela.

| Célula | Chamadas | Horas amostr. | Válidas | Cand. | Recall `min50` (IC 95%) | `IoU>=0,30` | `IoU>=0,50` | Cenas `min50` | PT | EN | Cruzam janela | Tokens in (1k/h) | Ativo s/h |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `10m_ov0m_H` | 34 | 5,5 | 34/34 | 51 | 7/34 (20,6%) [10,3%; 36,8%] | 14,7% | 5,9% | 7/29 | 3/14 | 4/20 | 3/34 | 125 | 86 |
| `10m_ov1m_H` | 43 | 6,53 | 43/43 | 54 | 7/34 (20,6%) [10,3%; 36,8%] | 17,6% | 5,9% | 7/29 | 3/14 | 4/20 | 1/34 | 133 | 90 |
| `10m_ov3m_H` | 50 | 6,56 | 50/50 | 60 | 11/34 (32,4%) [19,1%; 49,2%] | 20,6% | 8,8% | 9/29 | 7/14 | 4/20 | 0/34 | 154 | 108 |
| `10m_ov3m_B` | 50 | 6,56 | 50/50 | 73 | 12/34 (35,3%) [21,5%; 52,1%] | 20,6% | 5,9% | 10/29 | 7/14 | 5/20 | 0/34 | 167 | 107 |
| `15m_ov0m_H` | 25 | 5,97 | 25/25 | 49 | 7/34 (20,6%) [10,3%; 36,8%] | 17,6% | 5,9% | 7/29 | 4/14 | 3/20 | 1/34 | 88 | 71 |
| `15m_ov0m_B` | 25 | 5,97 | 25/25 | 57 | 7/34 (20,6%) [10,3%; 36,8%] | 14,7% | 5,9% | 7/29 | 4/14 | 3/20 | 1/34 | 98 | 67 |
| `15m_ov1m_H` | 24 | 5,76 | 24/24 | 51 | 6/34 (17,6%) [8,3%; 33,5%] | 14,7% | 5,9% | 6/29 | 3/14 | 3/20 | 0/34 | 88 | 76 |
| `15m_ov1m_B` | 24 | 5,76 | 24/24 | 58 | 8/34 (23,5%) [12,4%; 40,0%] | 17,6% | 8,8% | 8/29 | 4/14 | 4/20 | 0/34 | 99 | 71 |
| `15m_ov3m_H` | 24 | 5,61 | 24/24 | 41 | 3/34 (8,8%) [3,0%; 23,0%] | 8,8% | 0,0% | 3/29 | 3/14 | 0/20 | 0/34 | 89 | 80 |
| `15m_ov3m_B` | 24 | 5,61 | 24/24 | 45 | 4/34 (11,8%) [4,7%; 26,6%] | 8,8% | 2,9% | 4/29 | 3/14 | 1/20 | 0/34 | 99 | 82 |
| `30m_ov0m_H` | 21 | 10,48 | 21/21 | 81 | 9/34 (26,5%) [14,6%; 43,1%] | 23,5% | 5,9% | 9/29 | 4/14 | 5/20 | 1/34 | 47 | 46 |
| `30m_ov0m_B` | 21 | 10,48 | 21/21 | 95 | 8/34 (23,5%) [12,4%; 40,0%] | 17,6% | 5,9% | 8/29 | 3/14 | 5/20 | 1/34 | 56 | 51 |
| `30m_ov1m_H` | 20 | 9,51 | 20/20 | 70 | 5/34 (14,7%) [6,4%; 30,1%] | 11,8% | 2,9% | 5/29 | 2/14 | 3/20 | 0/34 | 49 | 48 |
| `30m_ov1m_B` (parcial, fora das conclusões) | 17 | 9,51 | 16/20 | 74 | 6/34 (17,6%) [8,3%; 33,5%] | 8,8% | 2,9% | 6/29 | 3/14 | 3/20 | 0/34 | 48 | 42 |
| `30m_ov3m_H` | 20 | 9,51 | 20/20 | 70 | 6/34 (17,6%) [8,3%; 33,5%] | 14,7% | 2,9% | 6/29 | 2/14 | 4/20 | 0/34 | 50 | 50 |
| `30m_ov3m_B` | 20 | 9,51 | 20/20 | 87 | 7/34 (20,6%) [10,3%; 36,8%] | 11,8% | 2,9% | 7/29 | 3/14 | 4/20 | 0/34 | 59 | 51 |
| `60m_ov0m_H` | 15 | 14,63 | 15/15 | 99 | 4/34 (11,8%) [4,7%; 26,6%] | 11,8% | 2,9% | 4/29 | 2/14 | 2/20 | 1/34 | 29 | 36 |
| `60m_ov1m_H` | 16 | 14,85 | 16/16 | 99 | 6/34 (17,6%) [8,3%; 33,5%] | 14,7% | 0,0% | 6/29 | 3/14 | 3/20 | 1/34 | 30 | 42 |
| `60m_ov3m_H` | 17 | 15,94 | 17/17 | 115 | 6/34 (17,6%) [8,3%; 33,5%] | 14,7% | 2,9% | 6/29 | 2/14 | 4/20 | 0/34 | 30 | 38 |
| `60m_ov3m_B` | 17 | 15,94 | 17/17 | 133 | 7/34 (20,6%) [10,3%; 36,8%] | 17,6% | 2,9% | 7/29 | 3/14 | 4/20 | 0/34 | 39 | 41 |
| `full_ov0m_H` | 3 | 25,82 | 3/3 | 77 | 5/38 (13,2%) [5,8%; 27,3%] | 10,5% | 2,6% | 5/33 | 2/14 | 3/24 | 1/38 | 12 | 12 |
| `full_ov0m_B` | 3 | 25,82 | 3/3 | 92 | 4/38 (10,5%) [4,2%; 24,1%] | 7,9% | 2,6% | 4/33 | 1/14 | 3/24 | 1/38 | 20 | 14 |

## 4. Efeito do tamanho da janela

Somando as três sobreposições no formato H (os mesmos 34 Cortes contados 3 vezes, então as taxas são descritivas, não independentes):

| Janela | Recall `min50` somado | Ativo s/h | Tokens in (1k/h) |
|---|---:|---:|---:|
| 10 min | 25/102 (24,5%) | 86 a 108 | 125 a 154 |
| 15 min | 16/102 (15,7%) | 71 a 80 | 88 a 89 |
| 30 min | 20/102 (19,6%) | 46 a 50 | 47 a 50 |
| 60 min | 16/102 (15,7%) | 36 a 42 | 29 a 30 |
| Live inteira (3 chamadas) | 5/38 (13,2%), outro denominador | 12 | 12 |

- O recall do formato H oscila entre 9% e 32% sem tendência clara. O melhor valor nominal é `10m_ov3m` (11/34 em H, 12/34 em B), mas `10m_ov0m` e `10m_ov1m` ficam em 7/34, e o IC de `10m_ov3m_H` ([19,1%; 49,2%]) se sobrepõe ao de todas as outras células.
- O custo por hora cai de forma monótona com a janela: em relação a 15 min, 30 min gasta cerca de 63% do tempo ativo e 55% dos tokens por hora, 60 min cerca de 50% e 34%, e a live inteira cerca de 16% e 14%. Parte disso é o overhead fixo do Codex diluído em menos chamadas.
- Janelas maiores devolvem mais candidatos (por exemplo 115 em `60m_ov3m_H` contra 41 em `15m_ov3m_H`), o que aumenta o trabalho de filtragem a jusante sem ganho de recall mensurável.

## 5. Efeito da sobreposição

Somando os tamanhos de janela em H: `ov0m` 27/136 (19,9%), `ov1m` 24/136 (17,6%), `ov3m` 26/136 (19,1%). Sem diferença.

Cortes humanos cruzando a borda de uma janela (de 34): 3 em `10m_ov0m`, 1 em `10m_ov1m`, 1 em cada `ov0m` de 15, 30 e 60 min, 1 em `60m_ov1m`, e 0 com `ov3m` em todos os tamanhos (também 0 em `15m_ov1m` e `30m_ov1m`). Em `full_ov0m` há 1/38 sem sobreposição possível: o Corte termina cerca de 40 s depois da última Frase falada, então a contenção estrita pelas Frases o deixa de fora. Ou seja, a sobreposição de 3 min elimina o cruzamento sem custo relevante, mas o recall não depende dela.

## 6. Formato H contra formato B

Só pares com os dois formatos completos na amostra (7 pares; `full_ov0m` tem outro denominador e fica de fora):

| Par | H | B | Tokens in B/H |
|---|---:|---:|---:|
| `10m_ov3m` | 11/34 | 12/34 | 1,08 |
| `15m_ov0m` | 7/34 | 7/34 | 1,11 |
| `15m_ov1m` | 6/34 | 8/34 | 1,12 |
| `15m_ov3m` | 3/34 | 4/34 | 1,11 |
| `30m_ov0m` | 9/34 | 8/34 | 1,19 |
| `30m_ov3m` | 6/34 | 7/34 | 1,19 |
| `60m_ov3m` | 6/34 | 7/34 | 1,30 |
| **Total** | **48/238 (20,2%)** | **53/238 (22,3%)** | |

B acerta 5 Cortes a mais em 238 (+2,1 pontos), melhor em 5 pares, igual em 1 e pior em 1, ao custo de 8% a 30% mais tokens de entrada. A diferença está muito abaixo do ruído e não justifica o formato B na v1. Em `full_ov0m` (n=38) o H teve 5/38 e o B 4/38.

PT e EN: na maioria das células o PT (14 Cortes) tem recall nominal maior que o EN (20 Cortes); com esses tamanhos de amostra não dá para tratar isso como efeito do idioma.

## 7. Recomendação

1. **Manter 15 min, sobreposição de 3 min e formato H na v1.** Não há evidência de que outra combinação recupere mais Cortes, e esta já é a que o núcleo implementa.
2. **Não adotar o formato B.** Ganho de cerca de 2 pontos dentro do ruído, custo de 8% a 30% mais tokens de entrada.
3. **Janelas maiores não pioram o recall de forma mensurável e cortam o tempo e os tokens por hora** (30 min gasta cerca de 63% do tempo e 55% dos tokens de 15 min; 60 min, 50% e 34%). Se o custo de API ou o tempo de espera virar problema, vale repetir esse teste com um gabarito maior antes de mexer no `WINDOW_MAX_US`. Isso também depende de modelos que aceitem contextos maiores (ver seção 8).
4. **`10m_ov3m` é a única candidata a ganho de recall** (32% a 35% nominal), mas custa cerca de 1,4 vez o tempo ativo por hora de 15 min, não se repete em `ov0m` e `ov1m` e o intervalo é compatível com as demais. Só valeria testar com mais Cortes.
5. A pré-seleção sem IA (picos de grito e chat, #283) pode tornar desnecessário ler a live inteira. Por isso não rodamos as lives completas nos braços principais (seção 9).

## 8. Viabilidade em modelos locais (plano de tokens, sem forçar)

Do planejamento da matriz (`fixedTokens = 1394`, reserva de saída 2000, margem de 85%, fator 1,2 sobre a estimativa):

- **Contexto 500 mil (Codex):** as 26 células são viáveis.
- **Contexto de 32.768 tokens:** janelas de 10, 15, 30 e 60 min são viáveis em H e B. A live inteira é inviável (`context_too_small_full_live`).
- **Contexto de 8.192 tokens:** H é viável em 10 e 15 min, com janelas mais densas reduzidas por tokens; 30 e 60 min ficam truncados; live inteira inviável. O formato B é inviável com `ov0m` e `ov3m` (`context_too_small`) e na fonte PT densa em `30m_ov1m_B` e `60m_ov1m_B` (`context_cannot_hold_target_window`).

Isso reforça o H: o formato B exige contextos maiores e cabe em menos configurações locais.

## 9. O que não foi rodado

- **Bonsai 8B 1-bit (perfis de 8k e 32k): não rodado.** O servidor local de inferência usa a GPU (3,0 GB de VRAM, cerca de 60 tokens/s), mas a RAM do processo cresce de 1,5 GB ao subir para 5,6 GB durante o uso, e a máquina não comporta isso junto com o Codex e os demais workers. O sistema encerrou duas vezes processos por falta de memória. Uma rodada de 8k começou e foi interrompida na primeira célula (`10m_ov3m_H`), com muitas falhas de verificação e truncamento de saída; esses dados parciais ficam fora das conclusões. A medição do #127 (`2026-11-17-experimento-roteamento.md`) já mostrou que esse modelo falha nas regras de saída em cerca de 88% das janelas, então o resultado esperado era negativo. SHA-256 do modelo usado: `284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54`. Esta build do `llama-server` não aceita `--no-mmap` nem `--mmap`.
- **Lives completas nos braços principais (wave 4): cancelada por decisão do dev.** A amostra `seed = 57` basta para escolher tamanho e formato, e o #283 vai pesquisar a pré-seleção sem IA. Só rodaram as lives inteiras em `full_ov0m_H` e `full_ov0m_B`, como referência.
- **Cinco células B da amostra: não rodadas por limite do Codex** (cota da janela de 5 h): `30m_ov1m_B` (parcial, 16/20 janelas; excluída das conclusões), `60m_ov0m_B`, `60m_ov1m_B`, `10m_ov0m_B` e `10m_ov1m_B`.
- **Segunda passada (`eval-two-pass`): sem medição.** O harness e a avaliação estão implementados e foram executados sobre `15m_ov3m_H` e `15m_ov3m_B`. Todas as chamadas da segunda passada deram `rate_limit` (Codex sem cota), então a ordenação final é idêntica à da primeira passada por construção, e não há conclusão. O cruzamento com as saídas do #127 (Bonsai e Codex) não foi refeito: as do #127 usam as janelas do planejador de produção (24 janelas, 5,76 h; a sobreposição efetiva pode diferir ligeiramente da `15m_ov3m_H` desta rodada, que tem 5,61 h). A referência do #127 para o Codex nessa amostra é 7/34 (20,6%, IC 95% `[10,3%; 36,8%]`) contra 3/34 em `15m_ov3m_H`. Mesmo modelo e janelas quase idênticas, resultados diferentes: é o melhor indicador do ruído de execução. O Bonsai do #127 (falha nas regras em 87,5% das janelas da amostra, 88,4% nas 112) não permite avaliar a segunda passada local.

## 10. Limitações

- Apenas 38 Cortes humanos em 3 lives (provisórios). Na amostra, 34 Cortes. Com n=34 o IC 95% de Wilson tem cerca de 25 pontos de largura. Diferenças menores que isso são indistinguíveis.
- Uma execução por célula, modelo não determinístico. A repetição da configuração do produto mostrou 3/34 contra 7/34.
- 15 dos 38 Cortes humanos têm menos de 20 s, abaixo de `MIN_CUT_US = 20 s`. O recall por `min50` conta esses Cortes mesmo assim.
- O overhead fixo do `codex exec` (14 mil a 19 mil tokens por chamada) distorce o custo de tokens a favor de janelas grandes.
- Custo em dinheiro: US$ 0 marginal no Codex (assinatura) e US$ 0 no local. Referência de API paga: os agregados do #57 em Groq.
- As horas processadas diferem entre tamanhos de janela, então comparações de tempo e tokens usam valores por hora, não totais.

## 11. Arquivos

Saídas brutas ficam fora do repositório (dataset #28 não entra em commit), em `clipes-bench\w148_*`: `w148_matrix_plan.json`, `w148_codex_wave1.json`, `w148_codex_wave2_H.json`, `w148_codex_wave3_B.json`, `w148_two_pass_15m_ov3m_H.json`, `w148_two_pass_15m_ov3m_B.json` e os checkpoints por janela em `w148_runs\`.
