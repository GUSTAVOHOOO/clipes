# Lives longas, janela de contexto e que modelo recomendar

Pesquisa da issue [#115](https://github.com/GUSTAVOHOOO/clipes/issues/115). Data: 2026-11-14. Só documento: nenhum código foi alterado e nenhum ticket foi criado no GitHub.

**Convenções.** *Fato (fonte)* tem link. *Inferência* é raciocínio meu a partir de fatos e vem marcada. *Sem fonte* quer dizer que procurei e não achei. Toda página oficial citada foi lida em 2026-11-14; quando a página não traz data, a data é a da leitura. Sem segredos, chaves ou dados pessoais neste documento.

Relacionadas: [#113](2026-11-14-roteamento-multi-provedor.md) (vários perfis de Provedor) e [#114](2026-11-14-harness-agentes-clipes.md) (harness de tarefas de IA). Este documento cita as duas e não repete o que dizem.

---

## 1. Resumo (10 linhas)

1. **Tamanho real.** Num formato plausível de Frases com ID e tempo (formato B, seção 3.2), uma hora de live PT ou EN dá **11 mil a 19 mil tokens** (o200k_base); 4 h dão 44–74 mil e 8 h dão 88–149 mil. As três lives do dataset (3,6 h, 11,0 h e 11,2 h) dão ≈68 mil, ≈122 mil e ≈206 mil. **Nenhuma passa de 272 mil.** Duas passam de 100 mil (limiar do Claude Haiku 5.5) e a maior fica rente a 200 mil (Gemini 3.1 Pro). **Ressalva de regime:** as três lives são *gameplay* (27–52 % de fala). Uma live de conversa (podcast, bate-papo) fica perto da fala densa dos vídeos editados do dataset: até ≈ 23 mil tokens/h no formato H e ≈ 51 mil/h no B, onde 8 h somam ≈ 185 mil (H) ou ≈ 410 mil (B) e **o B cruza 272 mil**.
2. **O overhead de ID e tempo é o maior desperdício.** No formato B, ID + `hh:mm:ss.d` custa ≈ **11 tokens por Frase** e vale **40–64 % dos tokens** (52–59 % nas lives). ID numérico + marcador de minuto (formato H) fica **+13–20 % sobre o texto puro**, **≈ 45 % menos** que o B.
3. **Contexto não é o gargalo na nuvem.** Claude 5.x, GPT-6.x e Gemini 4 anunciam ~1 M de contexto e uma live de 8 h cabe numa chamada. O gargalo está nos **modelos locais** (padrão do Ollama: 4 mil tokens abaixo de 24 GiB de VRAM, e o app não sabe disso hoje) e nos limites do código (saída padrão de 8192 tokens na Anthropic, timeout de 60 s).
4. **As janelas de 10–15 min do #19/#114 se sustentam, mas por outros motivos.** 15 min são só 1,4–4,7 mil tokens. O que justifica janela é modelo local pequeno, retomada por job, limites de saída/timeout e isolamento de injeção. **Não existe fonte** de que live inteira piore a seleção de Cortes: toda a literatura que achei mede recuperação e perguntas e respostas. Quem decide é o #57.
5. **O que a janela perde é pequeno e mensurável.** Dos 38 Cortes humanos do #28, janelas de 10 min **sem sobreposição** deixam 3 (8 %) cruzando a borda; com 1 min, 1; com 3 min, 0. *Callbacks* e calibragem da Nota entre janelas pedem uma segunda passada barata (~15 mil tokens para 8 h).
6. **Preço por faixa:** Anthropic (só Haiku 5.5, >100 mil) e OpenAI (>272 mil) cobram a **requisição inteira** na faixa alta. 8 h numa chamada no Haiku 5.5 saem **3,5× mais caras** que em janelas. Em dólares tudo fica entre centavos e ~US$ 1,6 por live: a faixa é questão de **erro de estimativa**, não de fatura.
7. **O estimador do #40 erra por baixo.** `chars / 4` dá 11,2 mil tokens/h onde o tokenizer real dá 18,6 mil (formato B): **subestima ≈ 40 %**; em texto puro PT, 17–28 %.
8. **Descobrir o limite do perfil é viável, mas "máximo treinado" não é "contexto carregado".** Ollama, LM Studio e llama.cpp expõem as duas coisas em lugares diferentes (6.1); o `/v1/models` da OpenAI não expõe contexto, e o Ollama só informa o contexto carregado em `/api/ps`, com o modelo na memória. Proposta: tabela embutida + sondagem + campo editável + **checagem de truncamento pelo `usage` em toda chamada**.
9. **Recomendação v1:** planejador de janelas **por orçamento de tokens** (teto de 15 min do #19, encolhe com o contexto efetivo do perfil), formato H, descoberta de contexto, avisos em três níveis que seguem o resultado do planejador (cheia / reduzida / bloqueada; em formato H e fala densa, ≈ 7 mil bloqueia e ≈ 10 mil libera janela cheia) e custo por faixa no #40. Live inteira e segunda passada ficam depois, sob benchmark.
10. **Conflitos para o grilling:** janela adaptativa (#19), `num_ctx` do Ollama só pelo `/api/chat` nativo (quarto formato de API, contra o ADR-0004) e glossário ("janela de contexto" x "janela de seleção"). Dez tickets propostos (seção 12), nenhum criado.

---

## 2. Contexto atual do Clipes

### 2.1 Decisões que limitam esta pesquisa (fato, no repo)

- **Provedor só recebe texto, aponta IDs de Frase e nunca define tempos** ([GLOSSARY.md](../../GLOSSARY.md), #19). Uma **Frase** termina em pontuação ou pausa ≥ ~700 ms e é quebrada se passar de ~25 s (#26).
- **Seleção de Cortes (#19, #26):** Frases com ID → **janelas de ~10 a 15 min com sobreposição** → Provedor propõe Frase inicial/final + Nota → app ajusta bordas → junta duplicatas → ordena. Até ~10 candidatos por hora. A energia do áudio entra como marca no texto.
- **Perfil de canal (#72):** faixa de Corte de 20–60 s por padrão, **máximo 3 min**.
- **ADR-0004:** três formatos de API (Anthropic, compatível com OpenAI, Gemini); Ollama, LM Studio e llama.cpp entram como "compatível com OpenAI". Codex como subprocesso.
- **ADR-0005:** chamada paga com resultado incerto nunca é repetida às cegas; job é a unidade de retomada.
- **ADR-0006:** o diagnóstico é uma allowlist (inclui o nome do Provedor; não inclui texto de Transcrição).
- Decididos pelo dev em 2026-11-14 (brief desta pesquisa): v1 com workflows fixos e sem agentes; vários perfis com cada tarefa apontando para um perfil escolhido pelo usuário; **sem troca automática**; "somente local" como veto por Projeto; "local" = loopback; CLIs experimentais, sem ferramentas (#39); o usuário pode usar **qualquer** modelo.

### 2.2 O que o código faz hoje (lido em 2026-11-14)

| Fato | Onde |
|---|---|
| `StructuredRequest` tem `instruction`, `transcript: String`, `schema`, `native_schema`, `max_output_tokens: Option<u64>`. **Não há** campo de contexto, de janela ou de limite de entrada. | `core/src/provider.rs:56-62` |
| A Transcrição vai como **uma string opaca** dentro de `{"untrustedTranscript": ...}`. O formato das Frases (ID, tempo) **ainda não existe no código**. | `core/src/provider/adapters.rs:171`, `core/src/provider_cli.rs:231` |
| Anthropic usa `max_tokens = 8192` quando o chamador não informa. | `adapters.rs:4`, `adapters.rs:184`, `cost.rs:9` |
| Timeout de 60 s por requisição, `timeout_uncertain` vira job `uncertain`. | `adapters.rs:34`, `jobs.rs` |
| Estimativa de entrada = caracteres ÷ 4. | `core/src/provider/cost.rs:11,160-164` |
| Tabela de preços só com preço base, por modelo, sem faixa, sem contexto, sem saída máxima. | `core/src/provider/prices.json`, `docs/contribuindo/provedor.md` ("Limitações da tabela") |
| Um endpoint em `provider.json` + dois CLIs; o #43 escolhe `endpoint`/`codex`/`claude` por tarefa. Ollama/LM Studio/llama.cpp só são **detectados** (`/api/tags`, `/v1/models`, `/health`). | `provider.rs`, `assistant.rs`, `provedor.md` |

**Inferência:** como o formato de Frases ainda não foi escrito, esta é a hora barata de escolhê-lo bem (seção 3.3).

---

## 3. Medição com dados nossos

### 3.1 Método e limites (leia antes dos números)

- **Dados.** `benchmarks/dataset/transcricoes/*.json` (faster-whisper large-v3, palavras com tempo, **provisórias**) do #28: 11 itens, 17 mil palavras, 4 em PT e 7 em EN. São **amostras de ~10 min por item**, escolhidas por critério (música, gritos, inglês, uniforme), **não** transcrições inteiras. Só **3 itens são lives** (PT: 3,6 h; EN: 11,0 h e 11,2 h); os outros 8 são vídeos editados (20–63 min), de fala muito mais densa.
- **Correção de densidade.** Como as amostras são enviesadas, calculei a fração de fala **da live inteira** com o VAD Silero (o mesmo do app, via `faster-whisper`, limiar 0,5, silêncio mínimo 300 ms) sobre o PCM em `%TEMP%\clipes-dataset` (8 kHz, reamostrado para 16 kHz por interpolação linear antes do VAD), e a comparei com a fração dentro das amostras. Fração de fala na live inteira: PT 52 %, EN 30 % e 27 %; nas amostras: 54 %, 29 % e 40 %. Os tokens/hora usam `tokens da amostra ÷ tempo da amostra × (fala da live ÷ fala da amostra)`. **n = 3 lives, uma em PT: leia como faixa, não como média.** As três são *gameplay*, com muita pausa de fala; **lives de conversa não foram medidas** e devem ficar perto do "regime denso" abaixo (vídeos editados: 8 itens, 20–63 min, amostras sem correção de fala).
- **Frases.** Reproduzi a regra do #26 (pontuação do Whisper ou pausa ≥ 0,7 s; quebra na maior pausa se > 25 s). **Os formatos de linha abaixo são minha leitura da spec**, não o que o núcleo envia hoje (seção 2.2). O envelope `{"untrustedTranscript": "..."}` do adaptador foi incluído em todas as contagens.
- **Tokenizers reais:** tiktoken `o200k_base` (OpenAI) e `cl100k_base`, e `tokenizer.json` públicos de Llama 3 (espelho `unsloth/Llama-3.2-1B-Instruct`), Qwen 2.5 (`Qwen/Qwen2.5-7B-Instruct`), Mistral Nemo e Gemma 2 (espelho `unsloth/gemma-2-2b-it`, proxy do Gemini, **não** o tokenizer do Gemini). **Claude e Gemini não têm tokenizer público**: para eles uso as razões publicadas, que são imprecisas (seção 3.5).
- **Privacidade da medição.** Os scripts baixaram só tokenizers e `config.json` públicos do Hugging Face e pacotes via `uv`, num diretório temporário fora do repo. Nenhum texto do dataset saiu da máquina. Scripts não commitados (a tarefa pede só o documento).

### 3.2 Formatos medidos

| Id | Linha enviada (exemplo) | Observação |
|---|---|---|
| A | `texto da frase` | linha de base: só texto |
| B | `[S123 01:02:03.4] texto` | ID com prefixo + tempo legível |
| F | `123 texto` | ID numérico, sem tempo |
| G | `123 4s texto` | ID + duração em segundos |
| H | `## 01:02` a cada minuto + `123 texto` | ID numérico + marcador de minuto |
| D | JSON `[{"id","start","end","text"}]` | o jeito "ingênuo" |

### 3.3 Resultados

**Tokens por palavra** (texto puro, com envelope; PT = 4 itens, 6 016 palavras; EN = 7 itens, 10 595 palavras):

| Tokenizer | PT | EN |
|---|---|---|
| o200k_base (OpenAI) | 1,48 | 1,38 |
| cl100k_base | 1,72 | 1,41 |
| Llama 3 | 1,72 | 1,41 |
| Qwen 2.5 | 1,71 | 1,42 |
| Mistral Nemo | 1,61 | 1,47 |
| Gemma 2 (proxy Gemini) | 1,48 | 1,52 |

*Leitura:* em PT, cl100k, Llama 3 e Qwen gastam ≈ 16 % mais tokens que o o200k, e o Mistral Nemo ≈ 9 %. Em EN a diferença é de 2–10 %.

**Tokens por hora de live, o200k_base, após correção de fala** (as três lives do dataset):

| Live | Formato A | **B** | F | G | **H** | D (JSON) |
|---|---|---|---|---|---|---|
| PT, 3,6 h | 8,8 mil | **18,6 mil** | 9,6 mil | 12,3 mil | **10,2 mil** | 36,1 mil |
| EN, 11,2 h | 8,4 mil | **18,4 mil** | 9,3 mil | 12,0 mil | **9,9 mil** | 35,9 mil |
| EN, 11,0 h | 4,5 mil | **11,1 mil** | 5,0 mil | 6,8 mil | **5,4 mil** | 23,1 mil |

Com Qwen 2.5 o formato B vai a 13,8–23,8 mil/h: os **dígitos viram um token cada**, e ID + tempo são quase só dígitos. **Frases por hora de live: 600–900**.

**Totais por duração** (formato B, o200k; faixa das 3 lives; entre parênteses, formato H):

| Duração | Tokens (B) | Tokens (H) |
|---|---|---|
| 1 h | 11 mil – 19 mil | 5 mil – 10 mil |
| 4 h | 44 mil – 74 mil | 22 mil – 41 mil |
| 8 h | 88 mil – 149 mil | 43 mil – 82 mil |
| **As três lives reais** | 3,6 h = **≈68 mil**; 11,0 h = **≈122 mil**; 11,2 h = **≈206 mil** | ≈37 mil; ≈60 mil; ≈111 mil |

Com Qwen 2.5 o B das mesmas lives vai a ≈87 mil, ≈152 mil e ≈252 mil.

**Regime denso (fala quase contínua; 8 vídeos editados do dataset, sem correção; limite superior para uma live de conversa):** formato H 8,7–23,1 mil tokens/h; formato B 16–51 mil/h. Em 1 h / 4 h / 8 h: **H 9–23 mil / 35–92 mil / 69–185 mil**; **B 16–51 mil / 65–206 mil / 129–412 mil**. A Frase tem 4–12 palavras e a pontuação do Whisper varia muito nesses vídeos, então o teto é incerto.

**Limiares de preço (seção 5.1):** em B/o200k, **122 mil e 206 mil passam de 100 mil** (Haiku 5.5). **206 mil encosta nos 200 mil** do Gemini 3.1 Pro (a incerteza do tokenizer cobre os dois lados). **Nenhuma live medida passa de 272 mil** (a maior fica em ≈252 mil no Qwen). Nas lives *gameplay* passar de 272 mil exigiria ~14 h no B; no **regime denso** (live de conversa), 8 h no B (≈ 129–412 mil) **já cruzam 272 mil**, e no H (≈ 69–185 mil) não.

**Quanto é overhead.** Overhead de B sobre A = **10,7–11,0 tokens por Frase**, praticamente constante. Participação nos tokens: 40–64 % nos 11 itens (52 %, 54 % e 59 % nas lives); varia com o tamanho da Frase (≈6 palavras nas lives, até ≈12 em PT editado). Ressalva: a granularidade das Frases depende da pontuação do Whisper, que varia muito (uma das amostras EN editadas veio quase sem pontuação), então o limite superior de 51 mil/h é incerto.

**Janela de 15 min** (o200k): **2,8–4,7 mil tokens no B** e **1,4–2,6 mil no H** (live); ~12,9 mil no B para fala densa.

### 3.4 Estimador `chars / 4` do #40

Caracteres por token medidos (o200k, com envelope): texto puro PT 3,3 (3,6–4,0 em EN); formato B 2,4–2,6; **formato H 3,3–3,8** (lives; 3,3–4,0 nos vídeos editados). O `cost.rs` usa **4**. Efeito: no B a estimativa de entrada fica **≈ 40 % abaixo** do tokenizer real; no H, **0–20 % abaixo**; em texto puro PT, 17–28 % abaixo. O que o documento do Gemini diz ("um token equivale a cerca de 4 caracteres", [tokens](https://ai.google.dev/gemini-api/docs/tokens)) vale para texto corrido em inglês; **não vale para linhas cheias de dígitos**.

### 3.5 Claude e Gemini (inferência, com faixa)

- **Claude:** a Anthropic informa que os modelos 4.7 em diante usam um tokenizer novo que "produz aproximadamente 30 % mais tokens para o mesmo texto" **em relação ao anterior** ([pricing, lido em 2026-11-14](https://platform.claude.com/docs/en/about-claude/pricing)). Não há razão publicada contra o o200k. *Inferência:* planejar Claude como **1,0–1,5× o o200k** e usar o `usage.inputTokens` real; a sondagem `count_tokens` da Anthropic não foi testada aqui (exige chave).
- **Gemini:** ~4 caracteres por token (fato, link acima), que **subestima** o nosso formato B em ≈ 40 % e o H em até ~20 % (seção 3.4). Usar o `usageMetadata` real e a contagem de `countTokens` quando houver chave.

---

## 4. Live inteira x janelas

### 4.1 O que a literatura mede (e o que não mede)

| Fonte | Data | Fato |
|---|---|---|
| [Lost in the Middle](https://arxiv.org/abs/2307.03172) (Liu et al.) | 2023-07-06, rev. 2023-11-20 | Desempenho costuma ser maior quando a informação relevante está no começo ou no fim e **cai bastante no meio**, mesmo em modelos de contexto longo. |
| [RULER](https://arxiv.org/abs/2404.06654) (Hsieh et al.) | 2024-04-09, rev. 2024-08-06 | 17 modelos; quase todos têm quedas grandes ao crescer o contexto; "só metade" mantém desempenho satisfatório a 32 mil, embora todos anunciem ≥ 32 mil. |
| [NoLiMa](https://arxiv.org/abs/2502.05167) (Modarressi et al.) | 2025-02-07, rev. 2025-07-09 | Sem coincidência literal entre pergunta e trecho, **11 de 13 modelos caem abaixo de 50 % do próprio desempenho curto a 32 mil**; o GPT-4o vai de 99,3 % a 69,7 %. "Comprimento efetivo" = maior tamanho que mantém ≥ 85 % da nota-base. |
| [Chroma, "Context Rot"](https://research.trychroma.com/context-rot) | 2025-07-14 | 18 LLMs (GPT-4.1, Claude 4, Gemini 2.5, Qwen3): o desempenho fica menos confiável com a entrada maior, **mesmo em tarefas simples**. |
| [Du et al.](https://arxiv.org/abs/2510.05381) | 2025-10-06 | Mesmo com recuperação perfeita, o desempenho cai 13,9–85 % com o aumento do tamanho da entrada, dentro do comprimento anunciado. |
| [LongBench Pro](https://arxiv.org/abs/2601.02872) | 2026-01-06 | 46 modelos, 8 mil–256 mil tokens: o comprimento efetivo costuma ser **menor que o anunciado**, com "desalinhamento entre idiomas" pronunciado (EN x ZH; **PT não foi medido**). |
| [Anthropic, Opus 4.6](https://www.anthropic.com/news/claude-opus-4-6) | 2026-02-05 | Medição **da própria Anthropic**: MRCR v2 8 agulhas a 1 M, Opus 4.6 = 76 % contra 18,5 % do Sonnet 4.5. Mostra que **modelos recentes melhoraram muito**; não é fonte independente. |
| [Gemini, long context](https://ai.google.dev/gemini-api/docs/long-context) | lido em 2026-11-14 | Recuperação de uma agulha chega a ~99 %, mas com **várias agulhas a precisão cai e varia muito**; recomenda pôr a pergunta **no fim** do prompt. |

**Sem fonte (declarado):**
- Nenhum desses trabalhos mede **seleção de trechos** ou "ache os melhores momentos numa transcrição de fala informal". Todos medem recuperação ou perguntas e respostas. **Não transfiro números de "comprimento efetivo" para o Clipes.**
- Não achei medição **independente** de MRCR/NoLiMa para Claude 5.x, GPT-6.x ou Gemini 4 (a busca só devolveu 4.6, 5.4 e Gemini 3).
- **Fiction.LiveBench:** só achei agregadores de terceiros, nenhuma página primária; **não verificado**, não usado.

*Inferência:* ainda assim, os resultados apontam na mesma direção: (a) qualidade de contexto longo varia por modelo e piora com a distância e com a ausência de pistas literais; (b) o que o modelo "anuncia" não é o que ele usa bem. A seleção de Cortes é mais parecida com NoLiMa (nada de coincidência literal: "ache o trecho engraçado") do que com agulha-no-palheiro.

### 4.2 Avaliando a proposta de janelas de ~10–15 min

A proposta vem do #19/#26 e foi mantida no #114 (tarefa T6). Com os dados da seção 3:

- **Cabe em qualquer contexto relevante, exceto o padrão do Ollama.** 15 min = 1,4–4,7 mil tokens de Frases. Somando instrução + schema (premissa de ≈ 1,5 mil, ainda não existe) e reserva de saída (≈ 1 mil), a chamada fica em **4–7 mil tokens**. Isso **não cabe** nos 4 mil do Ollama no formato B (5,3–7,2 mil) e **estoura ou fica no limite no H** (3,9–5,1 mil).
- **Não é o contexto que força janela na nuvem.** Uma live de 8 h (43–149 mil tokens) cabe com folga em 1 M. Quem justifica janelas é: modelo local pequeno; **retomada por job** ([#114](2026-11-14-harness-agentes-clipes.md) §5.2); teto de saída (Anthropic 8192 por padrão; 8 h pedem ≈ 12 mil tokens de saída, premissa de ~10 candidatos/h × ~150 tokens) e timeout de 60 s (#114 §8); isolamento de injeção (#114 §8.2).
- **O que janelas custam em tokens:** +50 % no total (sobreposição de 2 min e 1,5 mil de overhead por chamada): para 8 h no formato B, 37 chamadas e ≈ 228 mil tokens de entrada contra ≈ 150 mil numa chamada.
- **Qualidade:** **sem fonte** (4.1). Quem mede é o #57 (seção 12, T8).

**Conclusão.** Manter janelas como **padrão** (robustez, retomada, modelo local), mas tratar o tamanho como **consequência de orçamento de tokens**, não de um número mágico de minutos; e deixar "live inteira" como experimento do #57.

### 4.3 O que a janela perde num Corte

**Medido (só contenção, não detecção).** Dos 38 Cortes humanos localizados (3 lives; mediana 27,5 s; **máximo 269 s, acima dos 3 min do #72**), quantos cabem **inteiros** numa janela (posições alinhadas a partir do início da Fonte, sem sorte de alinhamento):

| Janela | sobreposição 0 | 1 min | 3 min |
|---|---|---|---|
| 5 min | 34/38 | 37/38 | 38/38 |
| 10 min | 35/38 | 37/38 | 38/38 |
| 15 min | 37/38 | 38/38 | 38/38 |
| 30 min | 37/38 | 38/38 | 38/38 |
| 60 min | 37/38 | 37/38 | 38/38 |

*Leitura:* sem sobreposição, **8 % dos Cortes de 10 min cruzam a borda**; com 3 min de sobreposição nenhum. Para ser seguro, **sobreposição ≥ maior Corte permitido** (3 min no Perfil de canal; o Corte de 269 s do dataset mostra que há exceções). 38 Cortes e 3 lives: indicativo, não estatística.

**Não medido (inferência):**
1. **Piada que começa na janela *N* e fecha em *N+1***: coberta pela sobreposição se o arco couber nela.
2. **Callbacks e arcos longos** (preparação minutos ou horas antes): sobreposição não cobre.
3. **Calibragem da Nota entre janelas:** cada janela é pontuada isoladamente, e a Nota 0–10 é relativa. Uma janela morna pode lançar 8 e uma janela ótima também. O "ordena pela Nota" do #19 pode misturar escalas.
4. **Começo de janela sem antecedente** (referências a quem falou antes).

### 4.4 Mitigações (da mais barata para a mais cara)

| Mitigação | Cobre | Custo (tokens) | Observação |
|---|---|---|---|
| Sobreposição ≥ maior Corte | 1 | +15–25 % de entrada | já no #19; falta amarrar ao Perfil (#72) |
| Pedir **1 frase de resumo da janela** como campo extra da saída | base da 2ª passada | ≈ +60 tokens por janela | sem custo de chamada |
| **Segunda passada** (janelas acham candidatos; um modelo forte **reordena e recalibra** com os resumos): entrada ≈ 80 candidatos × ~120 tokens + 32 resumos ≈ **~15 mil tokens para 8 h** | 3 e parte de 2 | 1 chamada barata | cabe até em contexto de 32 mil; é **workflow fixo**, não agente |
| **Resumo corrente** (cada janela recebe um resumo curto das anteriores; ideia do [Chain of Agents](https://arxiv.org/abs/2406.02818), 2024-06-04) | 2 e 4 | + ~300 tokens por janela | torna janelas **sequenciais** (já são na v1, #114 §5.2) e passa saída do modelo como contexto: risco de injeção (#114 §8.2) |

O Chain of Agents (Google) usa agentes trabalhadores com contexto curto e um gerente; reporta melhorias de **até 10 %** sobre RAG, contexto cheio e outros sistemas multiagente em tarefas de perguntas e respostas, resumo e código (abstract do paper). Não testa seleção de trechos.

---

## 5. Catálogo de modelos (fontes oficiais, lidas em 2026-11-14)

### 5.1 Nuvem

| Modelo | Contexto | Saída máx. | Entrada / saída por 1 M | Faixa por contexto | Fonte |
|---|---|---|---|---|---|
| Claude Fable 5.2 | 1 M | 128 mil | US$ 8 / 40 | não | [models](https://platform.claude.com/docs/en/about-claude/models/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Opus 5.5 | 1 M | 128 mil | 4 / 20 | não | idem |
| Claude Sonnet 5.5 | 1 M | 128 mil | 2 / 10 | não | idem |
| Claude Haiku 5.5 | 1 M | 128 mil | 0,10 / 0,50 até 100 mil; **0,50 / 2,50 acima de 100 mil** | **sim, 5×**, requisição inteira | idem |
| GPT-6 Astra | 1,05 M | 128 mil | 10 / 50 | **>272 mil: 2× entrada, 1,5× saída, requisição inteira** | [modelo](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| GPT-6.1 Sol | 1,05 M | 128 mil | 2 / 10 | idem | [modelo](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| GPT-6.1 Terra | 1,05 M | 128 mil | 1 / 5 | idem | [modelo](https://developers.openai.com/api/docs/models/gpt-6.1-terra) |
| GPT-6 Luna | 1,05 M | 128 mil | 0,10 / 0,50 | idem | [modelo](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| Gemini 4 Hydrogen | 1 M | 64 mil / 1 M | 1,50 / 7,50 | não | [models](https://ai.google.dev/gemini-api/docs/models), [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini 4 Carbon e Argon | 1 M | 64 mil / 1 M | 2 / 10 **até 30/11/2026**; 4 / 20 **a partir de 01/12/2026** | não | idem |
| Gemini 3.1 Pro Preview | (não lido) | (não lido) | 2 / 12 até 200 mil; **4 / 18 acima de 200 mil** | **sim** | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |

Fatos de redação: a Anthropic diz que a faixa conta "todos os tokens de entrada, **incluindo leituras e escritas de cache**" e que "cada requisição é precificada por si" ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). A OpenAI diz "para a requisição inteira" ([GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)). A página do Gemini escreve só "prompts <= 200k / > 200k"; **que seja a requisição inteira é inferência** (conservadora). A OpenAI informa que o GPT-6.1 Sol usa contexto padrão de **500 mil** no Codex e "sem sobretaxa de contexto longo" na assinatura; os CLIs não reportam `usage` (#39), então o app não vê tokens neles.

Os preços e limites acima batem com o `prices.json` do repo para os modelos que ele cobre. O `prices.json` **não tem contexto, saída máxima nem faixa**, e a data nele (2026-11-14) vale só para o preço.

*Pensamento:* Fable e Opus têm "thinking adaptativo sempre ligado" ([models](https://platform.claude.com/docs/en/about-claude/models/overview)); o GPT-6 tem esforço de raciocínio; o Gemini cobra o pensamento como saída (o adaptador já soma). **Tokens de raciocínio ocupam saída e contexto**: o `max_tokens` de 8192 padrão da Anthropic pode truncar mesmo uma saída curta (*inferência*; o #114 T1 já trata truncamento).

### 5.2 O que informam as APIs sobre o próprio limite (fato)

| API | Informa o limite de contexto? | Fonte |
|---|---|---|
| Anthropic `GET /v1/models` | **Sim**: `max_input_tokens` e `max_tokens` | [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| Gemini `models.get` | **Sim**: `inputTokenLimit` (o exemplo da doc só mostra este campo) | [tokens](https://ai.google.dev/gemini-api/docs/tokens) |
| OpenAI `GET /v1/models` | **Não**: o objeto traz `id`, `object`, `created`, `owned_by` | [referência](https://developers.openai.com/api/reference/resources/models/methods/list) |
| OpenRouter `/models` | **Sim**, `context_length` no exemplo | [doc](https://openrouter.ai/docs/api-reference/list-available-models) |

### 5.3 Modelos locais

**Padrão do Ollama (a armadilha).** A página de contexto diz: "Ollama usa por padrão: < 24 GiB de VRAM: **4 mil**; 24–48 GiB: 32 mil; ≥ 48 GiB: 256 mil" ([context-length](https://docs.ollama.com/context-length)). **A documentação se contradiz:** a página do Modelfile ainda diz `num_ctx` padrão **2048** ([modelfile](https://docs.ollama.com/modelfile)). **A máquina-alvo do projeto (RTX 3050, 4 GiB) cai no padrão de 4 mil.**

**Truncamento silencioso.** *Fato (relato, não doc):* a [issue #10368](https://github.com/ollama/ollama/issues/10368) (2025-04-22) mostra o log do servidor `WARN msg="truncating input prompt" limit=2048 prompt=5065 keep=5 new=2048` numa chamada a `/api/embeddings`. **Não está documentado para `/v1/chat/completions`, e não pude testar aqui (Ollama não está instalado)**: tratar como **risco a validar**, com a defesa da seção 6.3 (checar o `usage`). Mais um fato: a [API compatível com OpenAI do Ollama não tem como definir o tamanho do contexto](https://docs.ollama.com/api/openai-compatibility): é preciso um Modelfile com `PARAMETER num_ctx`, ou `OLLAMA_CONTEXT_LENGTH` / controle no app ([context-length](https://docs.ollama.com/context-length)). O `ollama ps` e o `GET /api/ps` mostram o contexto real do modelo carregado ([api/ps](https://docs.ollama.com/api/ps.md)). O parâmetro `truncate` documentado em docs.ollama.com é só do endpoint de embeddings; **para chat não achei na doc nenhum aviso de truncamento**.

**LM Studio.** `GET /api/v1/models` devolve `max_context_length` (máximo do modelo) e, em `loaded_instances[].config.context_length`, o contexto **da instância carregada** (exemplo da doc: 4096 carregado e 262144 máximo); `/api/v1/chat` permite escolher o contexto na requisição, e `/v1/chat/completions` **não** ([lista](https://lmstudio.ai/docs/developer/rest/list), [visão geral](https://lmstudio.ai/docs/developer/rest)).

**llama.cpp (`llama-server`).** `-c/--ctx-size` (padrão 0 = lido do modelo); `-np` slots (padrão automático); `--fit` ajusta ao que cabe na memória (padrão ligado, contexto mínimo 4096); `GET /props` traz `default_generation_settings.n_ctx` (contexto em execução); `GET /v1/models` traz `meta.n_ctx_train` (treinado); `-ctk` (e o par para V) quantizam o KV; a resposta de `/completion` traz `truncated` e `tokens_evaluated` ([README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), lido em 2026-11-14).

**Modelos locais com contexto "de verdade".** A [biblioteca do Ollama](https://ollama.com/library) (lida em 2026-11-14) anuncia: Gemma 4 128 mil (tamanhos pequenos) e 256 mil (maiores), Qwen 3.5 256 mil (vários tamanhos, de 1,2 GB a 81 GB nos arquivos listados), Ministral 3 256 mil, gpt-oss 128 mil (20 B: 14 GB), Llama 3.1 e Phi-4-mini 128 mil. **Atenção:** a página do Mistral Nemo mostra "1000K context window" enquanto o texto da mesma página diz "até 128k" e o `config.json` tem `max_position_embeddings` 131072: os metadados da biblioteca **não são confiáveis**. **Sem fonte** de qualidade a esses comprimentos para seleção de Cortes; "máximo treinado" não é "efetivo".

**KV cache (VRAM), cálculo meu.** Fórmula: `KV = 2 (K e V) × camadas com atenção completa × cabeças KV × dim. da cabeça × bytes × tokens`, com `config.json` oficial de cada modelo (Hugging Face, lido em 2026-11-14). fp16 = 2 B; q8_0 ≈ 1,06 B/elemento. **Só o KV; pesos e buffers de cálculo ficam de fora.**

| Modelo | KiB/token (fp16) | 8 mil | 32 mil | 128 mil | 128 mil em q8_0 |
|---|---|---|---|---|---|
| Llama 3.1 8B (32 camadas, 8 KV, dim 128) | 128 | 1,0 GiB | 4,0 | 16,0 | 8,5 |
| Qwen3 8B (36 camadas, 8 KV, dim 128) | 144 | 1,1 | 4,5 | 18,0 | 9,6 |
| Mistral Nemo 12B (40, 8, 128) | 160 | 1,3 | 5,0 | 20,0 | 10,6 |
| Qwen3 14B (40, 8, 128) | 160 | 1,3 | 5,0 | 20,0 | 10,6 |
| Qwen2.5 14B (48, 8, 128) | 192 | 1,5 | 6,0 | 24,0 | 12,8 |
| Qwen3.5 9B, **híbrido** (8 de 32 camadas com atenção completa, 4 KV, dim 256) | 32 | 0,25 | 1,0 | 4,0 | — |
| Gemma 3 12B, **janela deslizante** (8 camadas globais de 48, 8 KV, dim 256; locais limitadas a 1024) | 64 + 0,3 GiB fixo | 0,8 | 2,3 | 8,3 | — |

As duas últimas linhas são **teóricas**: assumem que o runtime aproveita a atenção linear e a janela deslizante, **não verificado** no llama.cpp/Ollama. Para os 7–14 B comuns, **8 mil custa ~1–1,5 GiB, 32 mil ~4–6 GiB e 128 mil ~16–24 GiB em fp16**. Na RTX 3050 de 4 GiB do projeto, os **pesos** de um 8 B em Q4 (≈ 4,9 GB no exemplo de `/v1/models` do llama.cpp: 8,03 B parâmetros, 4 912 898 304 bytes) já não cabem: o 8 B roda com offload para CPU, e mais contexto agrava isso. **Inferência:** em perfis locais de máquina modesta o contexto realista é **8–16 mil**, e o app precisa funcionar bem nele (seção 6.4).

---

## 6. Adaptação a qualquer modelo

### 6.1 Como descobrir o limite de cada perfil

Dois números diferentes, que **não podem ser confundidos**: **máximo suportado/treinado** e **contexto carregado/alocado agora**. O que importa para planejar é o menor dos dois (mais o que o usuário declarar).

| Perfil | Máximo treinado | Contexto carregado agora | Origem (fato) |
|---|---|---|---|
| Anthropic | `max_input_tokens` | = máximo | `/v1/models` |
| Gemini | `inputTokenLimit` | = máximo | `models.get` |
| OpenAI | **tabela embutida** | = máximo | `/v1/models` não informa |
| OpenRouter e similares | `context_length` em `/models`, se existir | idem | doc do OpenRouter; **inferência**: oportunista nos demais |
| Ollama | `POST /api/show` → `model_info["<arq>.context_length"]` (exemplo da doc: `gemma4.context_length: 131072`) | `GET /api/ps` → `context_length` "do modelo em execução" (exemplo da doc: 4096). **Só existe com o modelo carregado**: o app precisa carregá-lo antes (chamada mínima ou pré-carga) e ler `/api/ps` depois. `/api/show` também lista em `parameters` o `num_ctx` quando um Modelfile o define (exemplo: `num_ctx 2048`) | [api/ps](https://docs.ollama.com/api/ps.md), [show](https://docs.ollama.com/api-reference/show-model-details.md), [openapi.yaml](https://docs.ollama.com/openapi.yaml) (índice em [llms.txt](https://docs.ollama.com/llms.txt)) |
| LM Studio | `max_context_length` | `loaded_instances[].config.context_length` | `/api/v1/models` |
| llama.cpp | `meta.n_ctx_train` em `/v1/models` | `default_generation_settings.n_ctx` em `/props` | README |
| CLIs (Codex, Claude Code) | tabela embutida (Codex/GPT-6.1 Sol: 500 mil) | desconhecido; sem `usage` | #39 |

**Ordem de decisão proposta:** (1) valor **editado pelo usuário**; (2) valor carregado vindo do servidor; (3) máximo do servidor; (4) tabela embutida (formato `prices.json`, com `source` e `updatedAt`); (5) **padrão conservador de 4096** para Ollama (o padrão documentado abaixo de 24 GiB) e **8192** para o resto, **com aviso** "não consegui descobrir". Cada valor guarda a **origem** para a UI mostrar ("informado pelo LM Studio", "tabela de 2026-11-14", "editado por você").

*Nota de fonte:* o `api.md` do GitHub (`main`) está **defasado** em relação a docs.ollama.com (lá o `/api/ps` não traz `context_length`); vale a doc do site. A conferência feita aqui é só de documentação: **não testei contra um Ollama real** (não instalado).

**Conflito com o ADR-0004:** *metadados* (`/api/show`, `/api/v1/models`, `/props`) **não** são um quarto formato de *completion* e seguem o precedente de `/api/tags`, que já é lido pelo assistente. Mas **definir `num_ctx` por requisição só é possível pelo `/api/chat` nativo do Ollama**, o que seria um **quarto formato** de API: exige grilling e ADR (ver 9).

### 6.2 Como escolher o tamanho da janela

Planejador puro no núcleo (testável sem rede). Premissas marcadas:

```
ctx_ef        = menor(contexto carregado, máximo, declarado pelo usuário)
P             = instrução + schema                    # premissa ≈ 1,5 mil, ainda não existe
O             = reserva de saída = candidatos_esperados × 150 + folga   # premissa ≈ 1 mil por janela de 15 min
R             = reserva de raciocínio                 # 0 em modelos sem thinking; 2–4 mil se houver
entrada_max   = 0,85 × ctx_ef − P − O − R             # 15 % de margem: o estimador erra
tok_min       = tokens estimados por minuto do formato escolhido (ver abaixo)
W_min         = 3 × sobreposição                      # evita reprocessar > 1/3 da janela
sobreposição  = maior Corte permitido (Perfil de canal, 3 min)
W             = clamp(entrada_max / tok_min, W_min, 15 min)    # 15 min = teto do #19
se entrada_max / tok_min < W_min → bloqueia a seleção neste perfil (erro tipado)
```

`tok_min` inicial: o valor **conservador do regime denso** do formato escolhido (H: ≈ 0,385 mil tokens/min = 23,1 mil/h; B: ≈ 0,86 mil/min = 51 mil/h), **recalibrado com o `usage` real** a cada chamada (uma live *gameplay* cai para ≈ 0,17 mil/min no H e ≈ 0,31 mil/min no B). Teto adicional: **a janela nunca passa de 85 % do menor limiar de preço do perfil** (100 mil no Haiku 5.5; 200 mil no Gemini 3.1 Pro; 272 mil na OpenAI), o que é automático nas janelas de 15 min.

**Contexto efetivo necessário** `= (P + O + W × tok_min) ÷ 0,85`, com P = 1,5 mil, O = 1 mil e R = 0 (premissas), para janela cheia (15 min) e mínima (9 min):

| Regime e formato | tok/min | Janela cheia (15 min) | Janela mínima (9 min) |
|---|---|---|---|
| H, fala esparsa (*gameplay*) | 170 | 5,9 mil | 4,7 mil |
| **H, fala densa** (inicial, conservador) | 385 | **9,7 mil** | **7,0 mil** |
| B, fala esparsa | 310 | 8,4 mil | 6,2 mil |
| B, fala densa | 858 | 18,1 mil | 12,0 mil |

**Janela resultante por contexto** (planejador com o `tok_min` conservador do H denso; entre parênteses, após calibrar numa live esparsa):

| Contexto efetivo | `entrada_max` (0,85·ctx − 2,5 mil) | Janela (H denso) | Resultado |
|---|---|---|---|
| 4 096 (Ollama padrão) | ≈ 1,0 mil | ≈ 2,5 min (≈ 5,8 min esparso) | **bloqueada** (< 9 min) |
| 8 192 | ≈ 4,5 mil | ≈ 11,6 min (esparso: 15 min) | **reduzida** |
| 16 384 | ≈ 11,4 mil | 15 min | **cheia** |
| 32 768 | ≈ 25 mil | 15 min | **cheia** |

No formato B denso, 8 mil dá só ≈ 5,2 min e **bloqueia**: **o formato H é o que deixa 8 mil utilizável em fala densa**. Com sobreposição de 3 min e janela de 15 min, 3 h ficam em 15 chamadas. *Inferência:* abaixo desse mínimo as janelas ficam curtas demais e o modelo local pequeno ainda tende a falhar no JSON (#114 §6).

### 6.3 Sondagem e checagem de truncamento (inferência de desenho; **não testada**: sem Ollama aqui)

1. **Ollama: ler `GET /api/ps` → `context_length`** com o modelo carregado (documentado) e usar esse valor como contexto efetivo, com origem "informado pelo servidor".
2. **Comparação de `usage`, só em perfil local (custo zero).** Quando `usage.inputTokens` (no Ollama, `prompt_eval_count`, [documentado](https://docs.ollama.com/api/chat.md)) vier **colado no limite carregado** (≈ `num_ctx`) **e** abaixo do estimado, a chamada vira `context_truncated`. A comparação com a estimativa só vale **depois de calibrada** (a faixa de erro do tokenizer é ×0,8–1,5, seção 7); antes disso, usar só o critério "colado no limite". **Em perfil remoto pago nunca descartar uma resposta cobrada por esse critério**: as APIs remotas devolvem erro de contexto, não cortam em silêncio (*inferência*).
2b. **Sonda no "Testar Provedor" (só local, custo zero):** texto de tamanho conhecido (~6 mil tokens, `max_tokens = 1`) para confirmar o contexto em servidores que não o informam (OpenAI-compat genérico).
3. **llama-server:** ler `truncated` e `tokens_evaluated` na resposta (documentado).
4. O resultado atualiza o contexto efetivo do perfil com origem "medido".

### 6.4 Avisos e contexto mínimo para seleção de Cortes

Os níveis **seguem o resultado do planejador** (6.2), não números fixos:

| Resultado do planejador | Nível | Mensagem (exemplo) | Efeito |
|---|---|---|---|
| **Cheia** (W = 15 min) | ok | — | janelas de 15 min |
| **Reduzida** (9 min ≤ W < 15 min) | **aviso** | "Este modelo tem contexto de 8 192 tokens. A seleção vai usar janelas de ~12 min, mais chamadas, e pode perder Cortes. Aumente `num_ctx` ou escolha outro perfil." | permite continuar |
| **Bloqueada** (W < 9 min) | **bloqueio** da seleção neste perfil | "Contexto de 4 096 tokens: o padrão do Ollama. A seleção não cabe. Veja como aumentar." | uso permitido em outras tarefas (tradução, Empacotamento de Cortes curtos) |

**Rótulos de referência** (formato H, fala densa, de 6.2): **bloqueada abaixo de ≈ 7 mil**, **reduzida de ≈ 7 a ≈ 10 mil**, **cheia a partir de ≈ 10 mil**. Em linguagem de produto: **mínimo 8 mil, recomendado 16 mil, confortável 32 mil** (os dois últimos dão folga para raciocínio e para a calibragem do `tok_min`). Os valores dependem do formato e do regime (tabela de 6.2) e são **hipóteses**, a calibrar com o #57. A mesma lógica vale para as demais tarefas: Empacotamento, Roteiro e tradução trabalham com um Corte (≤ 3 min ≈ ≤ 1 mil tokens): **4 mil já bastam para Empacotamento de Corte curto**, mas a tradução da legenda de um VOD inteiro precisa de lotes (#75) e entra no mesmo planejador.

### 6.5 O que o assistente do #43 recomenda

O assistente já detecta Ollama, LM Studio, llama.cpp e Codex. Proposta de acréscimo, sem Provedor padrão de fábrica: ao detectar um servidor local, mostrar o **modelo carregado, o contexto efetivo e a origem do valor**, e recomendar assim:
- API barata com contexto grande (Haiku 5.5, Gemini 4 Hydrogen, GPT-6 Luna): qualidade e custo; sem limitação de contexto.
- CLI via assinatura: sem `usage`, contexto 500 mil no Codex (GPT-6.1 Sol); sem aviso de truncamento possível.
- Modelo local: se o planejador der janela **bloqueada**, **não recomenda para seleção** e explica como mudar (app do Ollama, `OLLAMA_CONTEXT_LENGTH`); se **reduzida**, recomenda "para Cortes curtos e Empacotamento; seleção com limitações".

---

## 7. Preço por faixa no custo do #40

Hoje: preço base apenas, `CHARS_PER_TOKEN = 4` e limitação declarada em `docs/contribuindo/provedor.md`. Proposta (a implementar num ticket novo, seção 12, T6):

1. **Esquema.** `Price` ganha `tiers: [{ aboveInputTokens, inputPerMillion, outputPerMillion }]`, opcional, e a tabela ganha `contextWindow` e `maxOutput` por modelo. Valores com `source` oficial. Entradas hoje: Haiku 5.5 (>100 mil: 0,50 / 2,50), OpenAI (>272 mil: 2× / 1,5× do base) e Gemini 3.1 Pro (>200 mil: 4 / 18).
2. **Regra.** A faixa se aplica à **requisição inteira**, escolhida pelo total de tokens de entrada da requisição (Anthropic e OpenAI explícitos; Gemini assumido, *inferência*).
3. **Custo real.** A faixa vem de `usage.inputTokens` da própria resposta. Se o `usage` vier incompleto, o custo continua `unknown`, nunca zero (regra atual do #40).
4. **Estimativa.** Com intervalo de tokens `[est × 0,8; est × 1,5]` (faixa de erro de tokenizer, seção 3.5): `mínimo` usa o limite inferior na faixa correspondente; `máximo` usa o limite superior e, se o intervalo **cruzar** o limiar, **cobra a faixa alta** e a UI diz: "esta chamada pode passar de 100 mil tokens: o preço sobe 5×". O estimador deixa de usar `/ 4` fixo: usa **razão por formato** (medido no o200k: 3,3–3,8 chars/token no H, 2,4–2,6 no B, 3,3–4,0 em texto) e **recalibra** com a razão `usage.inputTokens / caracteres` das chamadas anteriores do mesmo perfil.
5. **Planejador.** O limite de entrada por chamada nunca passa de 85 % do **menor** limiar do perfil, então o modo padrão (janelas) nunca cruza faixa; só o modo experimental "live inteira" pode, e nesse caso a estimativa mostra **os dois custos** (inteira e em janelas) antes de rodar.
6. **Teto de custo do lote (#56).** O teto usa o `máximo` com faixa alta; "perfil sem preço" continua sem teto automático (#113 §7.1).
7. **Cache.** A Anthropic conta leituras e escritas de cache no limiar; como os adaptadores atuais não usam cache, a regra fica anotada para quando usarem.

**Números (premissas na tabela):** instrução + schema 1,5 mil por chamada; saída ≈ 1,5 mil tokens por hora de live; janelas de 15 min com **2 min** de sobreposição (a recomendação é 3 min, que acrescenta ≈ 8 % de tokens em janelas); o200k como proxy (Claude pode ser até ×1,5). Custo em US$ por **live**:

| Live | Formato | Modelo | Numa chamada | Em janelas |
|---|---|---|---|---|
| 4 h | B (76 mil) | Sonnet 5.5 | 0,21 | 0,30 |
| 4 h | B | Haiku 5.5 | 0,011 | 0,015 |
| 8 h | B (150 mil) | Haiku 5.5 | **0,105** (faixa alta) | **0,030** |
| 8 h | B | Sonnet 5.5 | 0,42 | 0,59 |
| 8 h | H (83 mil) | Haiku 5.5 | 0,014 | 0,022 |
| 11 h | B (206 mil) | Opus 5.5 | 1,15 | 1,63 |
| 11 h | B | GPT-6.1 Terra | 0,29 | 0,41 |

*Regime *gameplay* (≈ 18,6 mil/h no B). No regime denso (≈ 51 mil/h no B) uma live de 8 h tem ≈ 410 mil tokens: numa chamada, o GPT-6.1 Terra cruza 272 mil e custa ≈ US$ 1,6 (contra ≈ US$ 0,8 sem faixa); em janelas, ≈ US$ 1,3.*

*Leitura:* o custo é de **centavos a ~US$ 1,6** por live em qualquer combinação. A faixa só **vira o jogo** no Haiku 5.5: 8 h numa chamada em B custa 3,5× mais que em janelas, e o formato H (menos tokens) evita a faixa. A conta que importa para o #40 não é o total, é **a estimativa não estar errada por 40 % nem do lado errado do limiar**.

---

## 8. Opções

| # | Opção | Prós | Contras | Custo | Esforço |
|---|---|---|---|---|---|
| **A** | **Status quo:** janelas fixas de 15 min (#19/#114), contexto desconhecido | já especificada; retomada fina | falha em silêncio no Ollama padrão; formato B desperdiça 40–64 %; estimador 40 % baixo; `max_tokens` 8192 | +50 % de tokens sobre uma chamada | nenhum |
| **B** | **Planejador por orçamento de tokens** + formato H + descoberta de contexto + avisos + custo por faixa (**recomendada**) | funciona em qualquer modelo; ~45 % menos tokens; falha com mensagem clara; cabe nos ADRs | mais código no núcleo; limiares são hipóteses até o #57 | menos tokens que A (H) e janelas mais curtas só quando preciso | médio (T1–T7) |
| **C** | **Live inteira numa chamada** (opt-in, perfis de contexto grande) | uma chamada; vê o arco todo; sem calibragem entre janelas | **sem fonte** que prove qualidade; timeout de 60 s e saída de 8192 do código; faixa de preço (Haiku 5.5); retomada grossa; risco de injeção em escala; modelos recentes melhoram, mas só sob medição | 8 h = 43–150 mil tokens: centavos a US$ 0,8 | médio, **depois do #57** |
| **D** | **Duas passadas:** janelas acham candidatos e resumem; um modelo (perfil escolhido pelo usuário) reordena e recalibra com os resumos | resolve calibragem e parte dos *callbacks*; passada 2 de ~15 mil tokens cabe em contexto de 32 mil; é workflow fixo | muda a Nota (decisão do #19: "média ponderada, sem curva"); mais um job; qualidade sem medir | + ≈ 1 chamada barata por live | médio, **depois** |
| **E** | **Resumo corrente** entre janelas | cobre *callbacks* | janelas sequenciais (já são); saída do modelo vira entrada (#114 §8.2) | + ~300 tokens por janela | médio, **depois** |
| **F** | **Pré-seleção por embeddings/RAG** | reduz tokens | precisa de modelo de embedding; busca por prompt é "melhoria futura"; mesmo risco de recall de RAG apontado pelo Chain of Agents | + modelo | alto; **não recomendada** |

---

## 9. Recomendação

1. **v1 = opção B.** Mantém o **teto de 15 min** do #19 e muda **como** o tamanho é decidido: por orçamento de tokens do perfil (6.2), com sobreposição ligada ao maior Corte do Perfil de canal.
2. **Formato H como padrão** de linha de Frase (`123 texto` + marcador `## hh:mm` por minuto). A duração e as bordas já são do app; o modelo não define tempos (glossário). **Precisa de benchmark**: o modelo deixa de ver a duração por Frase e pode errar o encaixe na faixa 20–60 s; o planejador tem o formato G (`id + duração`) como alternativa (+20 % de tokens).
3. **Descoberta de contexto, sondagem e erro `context_truncated`** antes de qualquer UI nova: é a parte que impede o pior caso (Ollama padrão cortando em silêncio).
4. **Avisos em três níveis** e bloqueio da seleção abaixo de 8 mil; outras tarefas seguem liberadas.
5. **Custo por faixa** (seção 7) e estimativa calibrada.
6. **Depois da v1 e sob o #57:** live inteira (C), segunda passada (D) e resumo corrente (E), nessa ordem de valor/risco. **Para o assistente do #43**, ver 6.5.

### Conflitos com decisões já tomadas (não tratados como decididos)

| Tema | Conflito | Caminho proposto |
|---|---|---|
| Janela "10–15 min" (#19/#26, não é ADR) | Torná-la adaptativa muda uma decisão fechada | Grilling curto; se aprovado, registrar no #19 ou ADR novo. O **teto** de 15 min **fica**: só o **mínimo** e a escolha por orçamento são novos |
| `num_ctx` por requisição | Só o `/api/chat` nativo do Ollama aceita; seria um **quarto formato de API**, contra "bastam três formatos" do ADR-0004 | Opção 1: **não fazer**, só avisar, sondar e instruir o usuário (sem conflito). Opção 2: grilling + ADR novo para o adaptador `ollama` |
| Glossário | "Janela" serve para o limite do modelo **e** para o trecho enviado por chamada | Propor **Janela de contexto** (limite do modelo) e **Janela de seleção** (trecho do #19); via `domain-modeling` |
| ADR-0006 (diagnóstico) | Útil registrar "contexto efetivo do perfil" no diagnóstico; não está na allowlist | Entrada explícita na allowlist (número, sem texto); decisão do dev |
| Provedores/perfis (#113) | Contexto é atributo **do perfil**, não do Projeto nem do Perfil de canal | Sem conflito com "o Perfil de canal não escolhe Provedor"; mas "somente local" por Projeto continua aberto no #113 |

---

## 10. Escopo sugerido

**Cabe na v1:** T1 (planejador), T2 (formato H e estimador), T3 (descoberta), T4 (truncamento), T5 (avisos e assistente), T6 (custo por faixa), T7 (limites de saída/timeout por perfil), T8 (benchmark de janelas, estendendo o #57).

**Fica depois:** T9 (segunda passada), T10 (live inteira opt-in), resumo corrente, sondagem de qualidade por modelo ("este modelo falhou X % na validação" já aparece no #114 §6), contagem de tokens exata por provedor (`count_tokens`/`countTokens`) e a opção de `/api/chat` nativo do Ollama.

---

## 11. Riscos e perguntas abertas para o dev

### Riscos

1. **Amostra pequena e de um só gênero:** 3 lives de *gameplay* (1 PT), ~10 min cada, transcrição provisória; **lives de conversa não medidas**. A faixa 11–19 mil tokens/h é indicativa. A fala densa (51 mil/h) vem de vídeos editados e é limite superior incerto.
2. **Tokenizers proxy:** Claude e Gemini sem tokenizer público (seção 3.5): a faixa 1,0–1,5× é inferência.
3. **Ollama não testado aqui:** conferi só a doc de docs.ollama.com. O comportamento de truncamento atual em chat e o `usage` são **a validar** (T4 tem isso como critério).
4. **Qualidade a janelas e contextos longos: sem fonte** para seleção de Cortes; os limiares de 8/16/32 mil são hipóteses.
5. **KV cache:** cálculo meu; Gemma 3 e Qwen 3.5 dependem do runtime aproveitar janela deslizante e atenção linear.
6. **Páginas oficiais mudam:** o Gemini 4 Carbon/Argon sobe de preço em 2026-12-01 e a tabela embutida precisa de data e `source` (já tem).
7. **Metadados do Ollama (biblioteca):** o Mistral Nemo aparece com 1000K e 128K na mesma página.
8. **Formato H** pode piorar a escolha de duração; só o benchmark diz.

### Perguntas para o dev

1. O **teto de 15 min** do #19 permanece, ou perfis de contexto grande poderiam usar janelas maiores antes de o #57 medir?
2. **Ollama:** aceitamos um **quarto adaptador** (`/api/chat` com `num_ctx`) ou só avisar e sondar?
3. **Bloquear** a seleção abaixo de 8 mil tokens de contexto efetivo, ou apenas avisar e deixar forçar?
4. Formato **H** como padrão (sem tempo por Frase) ou manter tempo/duração e pagar +20–100 % de tokens?
5. A **estimativa de custo** deve assumir a faixa alta quando o intervalo cruza o limiar (conservador)?
6. Posso propor ao #40 acrescentar `contextWindow` e `maxOutput` à `prices.json` (muda o esquema do arquivo versionado)?
7. Aceita **registrar o contexto efetivo no diagnóstico** (allowlist do ADR-0006)?
8. Aceita o par de termos **Janela de contexto / Janela de seleção** no glossário?

---

## 12. Tickets propostos (não criados no GitHub)

**T1. Planejador de janelas por orçamento de tokens**
- [ ] Função pura no núcleo: dado `ctx_ef`, formato, sobreposição e estimativas, devolve janelas (início, fim, tokens estimados) ou erro `context_too_small`.
- [ ] Teto de 15 min, mínimo = 3 × sobreposição, sobreposição = maior Corte do Perfil de canal (3 min por padrão), margem de 15 %.
- [ ] Nunca ultrapassa 85 % do menor limiar de preço do perfil.
- [ ] Testes headless: contextos de 4 096, 8 192, 16 384, 32 768 e 1 M; lives de 1, 4 e 11 h; perfil com `thinking`.

**T2. Formato de Frases compacto e estimador de tokens**
- [ ] Núcleo gera `123 texto` com `## hh:mm` por minuto; mapeia ID → tempo localmente.
- [ ] Estimador por formato (medido: H 3,3–3,8 chars/token, B 2,4–2,6), no lugar de `chars/4`, recalibrado com `usage.inputTokens / caracteres` por perfil.
- [ ] Testes com a regra de Frases do #26 sobre as transcrições do `benchmarks/`; relatório de tokens por hora (PT e EN).

**T3. Descoberta de contexto por perfil**
- [ ] Ollama `/api/show` e `/api/ps` (contexto carregado, com pré-carga do modelo), LM Studio `/api/v1/models`, llama.cpp `/props` e `/v1/models`, Anthropic `/v1/models`, Gemini `models.get`, OpenRouter `/models`.
- [ ] Tabela embutida `contextWindow`/`maxOutput` no formato do `prices.json`, com `source` e `updatedAt`.
- [ ] Campo editável pelo usuário; guarda **origem** de cada valor; ordem de decisão da seção 6.1.
- [ ] Só fala com loopback quando o perfil é local; nada de rede fora do endpoint do perfil.
- [ ] Testes com servidores falsos.

**T4. Detecção de truncamento e sondagem**
- [ ] Perfil **local**: `usage` colado no limite carregado e abaixo do estimado (após calibragem) → erro `context_truncated`, sem aceitar a resposta; perfil remoto nunca descarta resposta cobrada por esse critério.
- [ ] Sonda opcional no "Testar Provedor" local (texto de tamanho conhecido, `max_tokens = 1`).
- [ ] Leitura de `truncated`/`tokens_evaluated` no llama-server.
- [ ] Teste headless com servidor que corta o prompt em silêncio; nenhuma repetição às cegas de chamada paga (ADR-0005).

**T5. Avisos de contexto e assistente (#43)**
- [ ] Três níveis **derivados do resultado do planejador** (cheia / reduzida / bloqueada) com as mensagens da seção 6.4; rótulos 8/16/32 mil só como referência.
- [ ] O assistente mostra modelo, contexto efetivo e origem do valor, e instruções para aumentar o contexto no Ollama/LM Studio/llama.cpp.
- [ ] Nenhum Provedor padrão de fábrica; a recomendação só sugere.

**T6. Preço por faixa no #40**
- [ ] `tiers` em `Price` e `contextWindow`/`maxOutput` na tabela; entradas de Haiku 5.5, OpenAI e Gemini 3.1 Pro com `source`.
- [ ] Custo real escolhe a faixa por `usage.inputTokens`; estimativa com intervalo e faixa alta quando cruza o limiar.
- [ ] Teto de lote usa o `máximo`; modo "live inteira" mostra os dois custos.
- [ ] Testes com Provedor falso: abaixo, exatamente no limiar, acima e `usage` incompleto (`unknown`).

**T7. Limites de saída e timeout por perfil**
- [ ] `max_output_tokens` vem da tabela do perfil, não do padrão de 8192 da Anthropic; reserva de raciocínio.
- [ ] Timeout por perfil e por tamanho da entrada (relacionado ao #114 T1/§8); local com custo zero pode repetir sem confirmação.
- [ ] Testes: truncamento de saída vira `output_truncated` com `usage`.

**T8. Benchmark de janelas (extensão do #57)**
- [ ] Varia: janela 10/15/30/60 min e live inteira; sobreposição 0/1/3 min; formatos B e H; uma e duas passadas.
- [ ] Mede recall dos Cortes humanos, % de bordas no meio de Frase, % de Cortes cruzando janela, tempo e custo por hora, por Provedor e por idioma (PT e EN separados).
- [ ] Inclui ao menos um modelo local de 8 mil e um de 32 mil de contexto.
- [ ] Relatório Markdown em `docs/research/`.

**T9 (depois). Segunda passada de reordenação com resumo global**
- [ ] Cada janela devolve 1 frase de resumo; uma chamada final (perfil escolhido pelo usuário) reordena e recalibra a Nota.
- [ ] Entrada ≤ 15 mil tokens para 8 h; nunca muda IDs nem tempos; só entra se o #57 mostrar ganho; precisa de grilling por tocar a regra "Nota sem curva" do #19.

**T10 (depois). Modo "live inteira" opt-in**
- [ ] Só para perfis com contexto efetivo ≥ 4× a entrada estimada; mostra custo em dois cenários; avisa risco de faixa de preço e de qualidade; padrão desligado.
- [ ] Depende de T6, T7 e T8.

---

## 13. Fontes

**Repositório (leitura em 2026-11-14):** `AGENTS.md`, `GLOSSARY.md`, `docs/adr/0001`–`0006`, `CONTRIBUTING.md`, `docs/agents/impedimentos.md`, `docs/contribuindo/provedor.md`, `core/src/provider.rs`, `core/src/provider/{adapters.rs,cost.rs,prices.json}`, `core/src/provider_cli.rs`, `core/src/assistant.rs`, `core/src/jobs.rs`; issues #1, #19, #26, #28, #39, #40, #43, #56, #57, #68, #72, #73, #75, #76, #115; pesquisas [#113](2026-11-14-roteamento-multi-provedor.md) e [#114](2026-11-14-harness-agentes-clipes.md) (2026-11-14); dataset do #28 (`benchmarks/dataset/manifest.json` e `transcricoes/`, mais PCM e mídia em `%TEMP%\clipes-dataset`).

**Papers e relatórios**
- Liu et al., *Lost in the Middle*, arXiv 2307.03172, 2023-07-06, rev. 2023-11-20: https://arxiv.org/abs/2307.03172
- Hsieh et al., *RULER*, arXiv 2404.06654, 2024-04-09, rev. 2024-08-06: https://arxiv.org/abs/2404.06654
- Modarressi et al., *NoLiMa*, arXiv 2502.05167, 2025-02-07, rev. 2025-07-09: https://arxiv.org/abs/2502.05167
- Hong, Troynikov, Huber, *Context Rot*, Chroma, 2025-07-14: https://research.trychroma.com/context-rot
- Du et al., *Context Length Alone Hurts LLM Performance Despite Perfect Retrieval*, arXiv 2510.05381, 2025-10-06: https://arxiv.org/abs/2510.05381
- Chen et al., *LongBench Pro*, arXiv 2601.02872, 2026-01-06: https://arxiv.org/abs/2601.02872
- Zhang et al., *Chain of Agents*, arXiv 2406.02818, 2024-06-04: https://arxiv.org/abs/2406.02818
- Anthropic, *Claude Opus 4.6*, 2026-02-05: https://www.anthropic.com/news/claude-opus-4-6

**Docs oficiais de provedores (lidos em 2026-11-14)**
- Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview, https://platform.claude.com/docs/en/about-claude/pricing, https://platform.claude.com/docs/en/build-with-claude/context-windows
- OpenAI: https://developers.openai.com/api/docs/models/gpt-6-astra, …/gpt-6.1-sol, …/gpt-6.1-terra, …/gpt-6-luna, https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/reference/resources/models/methods/list
- Google: https://ai.google.dev/gemini-api/docs/models, https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/tokens, https://ai.google.dev/gemini-api/docs/long-context
- OpenRouter: https://openrouter.ai/docs/api-reference/list-available-models

**Runtimes locais (lidos em 2026-11-14)**
- Ollama: https://docs.ollama.com/context-length, https://docs.ollama.com/modelfile, https://docs.ollama.com/api/openai-compatibility, https://docs.ollama.com/api/ps.md, https://docs.ollama.com/api-reference/show-model-details.md, https://docs.ollama.com/api/chat.md, https://docs.ollama.com/openapi.yaml, https://docs.ollama.com/llms.txt (índice), `docs/api.md` do GitHub `main` (defasado em relação ao site), issue https://github.com/ollama/ollama/issues/10368 (2025-04-22), https://ollama.com/library
- LM Studio: https://lmstudio.ai/docs/developer/rest/list, https://lmstudio.ai/docs/developer/rest
- llama.cpp: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

**Configurações e tokenizers públicos (Hugging Face, lidos em 2026-11-14):** `config.json` de `unsloth/Llama-3.1-8B-Instruct`, `Qwen/Qwen3-8B`, `Qwen/Qwen3-14B`, `Qwen/Qwen2.5-14B-Instruct`, `mistralai/Mistral-Nemo-Instruct-2407`, `unsloth/gemma-3-12b-it`, `Qwen/Qwen3.5-9B`; `tokenizer.json` de `Qwen/Qwen2.5-7B-Instruct`, `unsloth/Llama-3.2-1B-Instruct`, `mistralai/Mistral-Nemo-Instruct-2407`, `unsloth/gemma-2-2b-it`; tiktoken `o200k_base` e `cl100k_base`.

**Não verificado / sem fonte:** Fiction.LiveBench (só agregadores); qualidade de seleção de Cortes por tamanho de contexto; testes independentes de contexto longo para Claude 5.x, GPT-6.x e Gemini 4; tokenizer exato de Claude e Gemini; comportamento atual do Ollama em truncamento de chat; aproveitamento de janela deslizante e atenção linear pelo llama.cpp/Ollama; páginas de modelo do Gemini 3.1 Pro (limites de contexto).
