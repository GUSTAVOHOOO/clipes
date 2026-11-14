# Roteamento entre vários Provedores por dificuldade

Pesquisa da issue [#113](https://github.com/GUSTAVOHOOO/clipes/issues/113). Data: 2026-11-14. Pesquisa irmã: **#114** (harness de agentes dentro do app). Onde os temas se tocam, o texto diz "ver pesquisa #114". Este documento cuida de **qual modelo recebe a chamada**, da política de escalada e do modelo de dados. Verificação em profundidade, checkpoints, retomada e execução do orçamento ficam no #114.

Convenção de evidência:
- **Fato verificado (fonte)**: li a fonte primária e o link está ao lado.
- **Inferência**: conclusão minha a partir de fatos; não é fonte.
- **Hipótese a medir**: sem evidência publicada para o nosso caso; entra no experimento da seção 8.
- **Não verificado**: só vi o resumo de uma busca ou uma fonte secundária.

Nada aqui mexe em código. Nenhuma chave, segredo ou dado pessoal foi usado.

---

## 1. Resumo (10 linhas)

1. Hoje o Clipes tem **um** endpoint (`provider.json`) mais dois CLIs; o #43 deixa cada uma de 4 tarefas escolher entre `endpoint`, `codex` ou `claude`. O #113 pede N Provedores ao mesmo tempo.
2. A literatura de roteamento (RouteLLM, FrugalGPT, AutoMix, Hybrid LLM) mostra economia real, mas **todas exigem dados rotulados ou um sinal de confiança confiável**. Reavaliações de 2026 mostram que roteadores comerciais e vários aprendidos **não superam baselines simples** (com ressalvas de escopo, seção 3).
3. O Clipes tem ~50 Cortes rotulados (#28) e proíbe telemetria (ADR-0006): não dá para treinar roteador. **Regra fixa por tarefa, escolhida pelo usuário** é o caminho com melhor relação evidência/esforço.
4. Em dólares, o ganho de rotear é pequeno por Fonte (inferência na seção 4: uma live de 4 h custa centavos a poucos dólares mesmo num modelo forte). O valor real do roteamento aqui é **privacidade (local), cota de assinatura e disponibilidade**, não a fatura.
5. Recomendação v1: **vários perfis de Provedor** + **tarefa → perfil** (generaliza o #43) + restrição **"somente local"** + custo por perfil (#40) + botão **"refazer com o forte"** manual.
6. **Conflitos com decisões já tomadas** (seção 9): o #13 diz "sem fallback automático"; "somente local por Projeto" encosta no #43 ("o Perfil de canal não escolhe Provedor"). Nenhum dos dois é tratado como decidido: cada um pede grilling e, se aprovado, um ADR novo.
7. Cascata automática (barato primeiro, forte só se a validação falhar) é tecnicamente viável com os seams atuais (laço de reparo, `usage`, `uncertain`), mas **fica depois da v1** e só depois do experimento.
8. Só **seleção de Cortes** tem verdade de campo (#28/#57, provisória). Empacotamento, Roteiro e tradução de legenda **não têm nenhum gabarito** hoje; a tabela de níveis é, em maior parte, hipótese.
9. Experimento barato: rodar cada modelo candidato **uma vez** sobre todas as janelas do harness do #57, gravar por janela, e **reproduzir offline** qualquer política (sempre-barato, sempre-forte, oráculo, cascata) sem gastar de novo.
10. Seis tickets propostos (seção 10), nenhum criado no GitHub.

---

## 2. Contexto atual do Clipes

### 2.1 Decisões que limitam o desenho (fato verificado no repositório)

- **Provedor** só recebe texto, aponta Frases por ID e nunca define tempos (`GLOSSARY.md`; #19).
- **Três tipos**: assinatura via CLI, chave de API, modelo local (`GLOSSARY.md`).
- **Sem Provedor padrão de fábrica** (`core/src/assistant.rs`, cabeçalho do módulo; `docs/contribuindo/provedor.md`).
- **"Local" significa só loopback**: `is_local_endpoint` exige que todos os endereços resolvidos sejam loopback (`core/src/provider.rs`). Um servidor na LAN **não** é local; os dois CLIs também não.
- **CLIs são experimentais, com ferramentas desligadas** (#39; `docs/contribuindo/provedor.md`).
- **Camada de Provedor própria, no Rust**, com três formatos HTTP (Anthropic, compatível com OpenAI, Gemini) e Codex como subprocesso; **LiteLLM no worker Python foi recusado** ([ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md)).
- **Chave no cofre do sistema**, UI nunca lê a chave (ADR-0004).
- **Chamada paga com resultado incerto nunca é repetida às cegas** ([ADR-0005](../adr/0005-projeto-portatil-com-sqlite.md); `jobs.rs`: estado `uncertain`, `jobs.retry` exige `confirmed`).
- **Zero telemetria, nada sai sem revisão** ([ADR-0006](../adr/0006-relato-de-problemas-sem-telemetria.md)).
- **Modelos e componentes só com licença que permita uso comercial** ([ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)).
- **Do #13 (mapa #1)**: "Um Provedor padrão no app, trocável por tarefa. **Sem fallback automático.** Custo estimado antes, real depois, com teto por lote. Só texto é enviado, com consentimento na primeira vez."
- **Da spec #26**: história 31 ("sem o app mudar de Provedor sozinho, para saber quem processou o quê"), 32 (erro pausa só aquela Fonte), 33 (chamada incerta não se repete).

### 2.2 Estado do código (lido em 2026-11-14)

| Peça | Como é hoje | Onde |
|---|---|---|
| Config do endpoint | **Um** endpoint, `model`, `kind` (`openai`\|`anthropic`\|`gemini`), `nativeSchema`, e `providers{endpoint → {confirmed, keyLastFour}}` | `core/src/provider.rs` (`settings::Settings`, arquivo `provider.json`) |
| Cofre | Serviço `io.github.gustavohooo.clipes.provider`, **conta = string do endpoint** | `provider.rs` (`vault_set/get/remove`) |
| Consentimento | Por endpoint remoto; endpoint loopback dispensa | `provider.rs` (`call_inner`) |
| `provider.configure` | Sobrescreve o endpoint único e chama `provider_cli::clear()` | `provider.rs` (`configure`) |
| CLIs | `provider-cli.json`: `selected`, `codex_confirmed`, `claude_confirmed` | `core/src/provider_cli.rs` |
| Escolha por tarefa | `assistant.json`: `default` ∈ {"", `endpoint`, `codex`, `claude`}; `tasks` com 4 chaves (`selection`, `packaging`, `script`, `translation`) | `core/src/assistant.rs` |
| Resolução | `assistant::route(task)` → `Unset` (comportamento antigo) \| `Endpoint` \| `Cli(kind)` | `assistant.rs` |
| Chamada | `provider.structured` com `task` opcional; devolve `{data, usage, calls}` | `provider.rs`, `provider/adapters.rs` |
| Reparo de JSON | Sem `nativeSchema`: até **2 tentativas** com o **mesmo** modelo ("Repair the previous response…"); com `nativeSchema`: 1 tentativa só. Valida contra o schema e exige `schemaVersion` | `adapters.rs` (laço `for repair in 0..2`) |
| Uso e custo | `usage` soma tokens de todas as tentativas; CLIs devolvem `usage: null` | `adapters.rs`, `docs/contribuindo/provedor.md` |
| Timeout | `timeout_uncertain` (60 s) → job `uncertain` | `adapters.rs`, `jobs.rs` |
| Fila | `jobs` com `safety` ∈ {`local`,`paid`}; reconciliação marca `paid` interrompido como `uncertain` | `core/src/jobs.rs` |

### 2.3 O que existe e o que ainda não (estado dos tickets em 2026-11-14)

- Fechados: #13 (arquitetura), #28 (dataset), #38 (adaptadores Anthropic/Gemini), #39 (CLIs), #43 (assistente + Provedor por tarefa), #44 (fila).
- **Abertos**: **#40 (custo)** e **#56 (lote com teto)** e **#57 (benchmark de seleção)**. Ou seja: **ainda não existe** tabela de preços, custo registrado, teto por lote nem benchmark de seleção. Tudo o que esta pesquisa diz sobre custo e experimento depende desses três.
- Tarefas que **não** são chamadas ao Provedor hoje: o #76 (guarda-corpos) não tem nenhuma chamada ao Provedor nos critérios de aceite; `TASKS` em `assistant.rs` só tem 4 entradas. "Guarda-corpos", "juiz" e "reparo como tarefa" seriam **escopo novo**.

---

## 3. Estado da arte: roteamento e cascata

### 3.1 Famílias e o que cada uma exige

| Família | Ideia | Exige | Sinal de confiança | Latência extra | Fonte |
|---|---|---|---|---|---|
| **Roteador aprendido (antes de chamar)** | Um classificador decide forte × fraco por pergunta | Dados de preferência rotulados (RouteLLM usa votos do Chatbot Arena + aumento de dados) e um limiar calibrado | Probabilidade do forte vencer | Uma inferência do roteador (leve; o `mf` precisa de embeddings via API) | [RouteLLM](https://arxiv.org/abs/2406.18665) (2024-06-26) |
| **Cascata com parada por confiança** | Chama modelo barato, avalia a resposta, sobe se a nota < limiar | Dados para treinar o avaliador (FrugalGPT usa um DistilBERT de regressão) e orçamento | Nota do avaliador sobre a **resposta** | Pelo menos uma chamada barata a mais quando sobe | [FrugalGPT](https://arxiv.org/abs/2305.05176) (2023-05-09) |
| **Cascata por autoverificação** | O barato verifica a própria resposta e um POMDP decide subir | Poucos exemplos (few-shot), sem treino pesado; verificação ruidosa | Autoverificação | Chamada(s) extra(s) de verificação | [AutoMix](https://arxiv.org/abs/2310.12963) (2023-10-19) |
| **Roteador por dificuldade prevista** | Prevê a dificuldade e deixa o nível de qualidade ajustável em tempo de teste | Dados de qualidade por modelo | Dificuldade prevista | Uma inferência | [Hybrid LLM](https://arxiv.org/abs/2404.14618) (2024-04-22) |
| **Roteamento + cascata unificados** | Combina os dois com prova de otimalidade | Estimador de qualidade bom ("fator crítico") | Estimador de qualidade | Depende | [Cascade routing](https://arxiv.org/abs/2410.10347) (2024-10-14) |
| **Roteadores comerciais/agregadores** | Serviço escolhe o modelo | Conta e envio dos prompts a um terceiro | Interno | Uma chamada de decisão | ver 3.3 |
| **Regra fixa por tarefa** | Humano mapeia tarefa → modelo | Nada | Nenhum | Zero | (é o que o #43 já faz) |

**Fatos verificados:**
- RouteLLM reporta redução de custo de **mais de 2×** em certos casos sem perder qualidade e transferência quando se trocam os modelos no teste ([resumo do paper, v1 2024-06-26](https://arxiv.org/abs/2406.18665)). O README do repositório diz que o roteador `mf` ainda **exige uma chave da OpenAI para gerar embeddings** e recomenda **calibrar o limiar com amostra das suas consultas** ([README](https://github.com/lm-sys/RouteLLM), acessado em 2026-11-14). O repositório tem licença Apache-2.0 e o último push foi em **2024-08-10** (API do GitHub, acessada em 2026-11-14): é referência, não dependência viva.
- FrugalGPT reporta igualar o melhor modelo com **até 98% menos custo** ou ganhar 4% de precisão no mesmo custo; o avaliador do experimento é um DistilBERT treinado, e o exemplo percorre GPT-J → J1-L → GPT-4 parando quando a nota passa de 0,96 ([paper, 2023-05-09](https://arxiv.org/abs/2305.05176)). Os modelos são de 2023.
- AutoMix reporta **mais de 50% de economia** a desempenho comparável em 5 modelos e 5 conjuntos ([paper](https://arxiv.org/abs/2310.12963)).
- O trabalho unificado conclui que **bons estimadores de qualidade são o fator crítico** para roteamento e cascata funcionarem ([paper, última revisão 2026-10-26](https://arxiv.org/abs/2410.10347)).

**Reavaliações recentes (cuidado com o escopo):**
- LLMRouterBench (400 mil instâncias, 21 conjuntos, 33 modelos): confirma que há complementaridade entre modelos, mas **muitos métodos têm desempenho parecido e vários, incluindo roteadores comerciais, "não superam de forma confiável" um baseline simples**; resta uma grande distância para o oráculo ([paper, 2026-01-12](https://arxiv.org/abs/2601.07206)).
- Avaliação comum de 4 roteadores de código aberto em 4 benchmarks (290 tarefas congeladas): três emitem níveis constantes ou quase; o único que varia com o conteúdo não vence em nenhum benchmark; "Always-Mid" empata com um deles. Os autores **limitam a conclusão** a essas configurações, ao pool de candidatos e às amostras, **não a paradigmas de roteamento em geral** ([paper, 2026-07-28](https://arxiv.org/abs/2608.14641)).
- Levantamento sistemático de roteamento e cascata ([survey, 2026-02-23](https://arxiv.org/abs/2603.04445)) é a boa porta de entrada se o dev quiser ir além.

**Inferência:** esses benchmarks usam perguntas gerais (MMLU, GSM8K, MT-Bench, uso de ferramentas). Nenhum mede tarefas como "apontar Frases de uma transcrição de live", então **não temos evidência de que um roteador pré-treinado generalize para o Clipes**. Somado à falta de dados nossos, a conclusão prática é: não adotar roteador aprendido na v1.

### 3.2 O que cada uma exigiria do Clipes

- **Roteador aprendido**: dados de qualidade por (tarefa, modelo) que não temos. O #28 dá ~50 Cortes humanos, provisórios, só de seleção. O ADR-0006 e as aprovações "só locais" (#19) impedem coletar dados de uso. Treinar um roteador proprietário é **inviável hoje**; usar um pré-treinado (RouteLLM `mf`) traz dependência de embeddings da OpenAI, o que **quebra "local-first"** para quem quiser rotear localmente.
- **Cascata com juiz/avaliador**: precisa de um sinal confiável. Para JSON, o sinal existe e é barato: o validador de schema que já existe no adaptador. Para qualidade de conteúdo, não.
- **Regra fixa**: zero dados, auditável, o usuário entende. É a base recomendada.

### 3.3 Agregadores e roteadores comerciais

**OpenRouter** (acessado em 2026-11-14):
- **Fallback de modelos**: o parâmetro `models` tenta o próximo se o primeiro der erro (queda, limite de taxa, moderação, erro de contexto); **o preço é o do modelo que de fato respondeu**, informado em `model` na resposta ([docs: Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks.md)).
- **Preferências de provedor**: `allow_fallbacks`, `require_parameters`, `data_collection: allow|deny`, `zdr` (só endpoints sem retenção), `only`, `sort`, `max_price` ([docs: Provider Selection](https://openrouter.ai/docs/guides/routing/provider-selection.md)).
- **Auto Router** (`openrouter/auto`): primeiro estreita o conjunto por guardrails, ZDR e restrições; depois **um modelo de decisão avalia 11 aspectos do pedido em uma chamada** e a política escolhe modelo e esforço de raciocínio conforme preços, cache e desempenho; há "router metadata" opcional para ver por que escolheu ([docs: Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router.md)). **Isso é uma chamada extra e um terceiro lendo o texto.** Não verifiquei benchmarks independentes do Auto Router nesta pesquisa.

**Not Diamond** (docs com `updatedAt` 2026-05-15 e 2026-05-21):
- Roteador próprio treinado "nos seus dados de avaliação": precisa de **entradas, respostas de cada modelo candidato e nota de cada resposta** ([Training a custom router](https://docs.notdiamond.ai/docs/router-training-quickstart.md)). Há modos de compromisso custo/latência/qualidade ([Key concepts](https://docs.notdiamond.ai/docs/key-concepts.md)).
- O volume mínimo de amostras e o tempo de treino variam conforme a fonte; **não verifiquei** esses números nos docs oficiais.

**Martian**: a página "How the router works" que a busca indicou devolveu **404** em 2026-11-14. Os docs oficiais (docs.withmartian.com) falam de gateway e roteador, mas **não confirmei na fonte primária o método de seleção nem os parâmetros**. Marcado como **não verificado**.

**LiteLLM Router** (acessado em 2026-11-14): a documentação descreve fallbacks entre grupos de modelos, cooldown de deployment com falha, timeouts e roteamento por tag ([docs: Routing](https://docs.litellm.ai/docs/routing)). É boa **referência de semântica de fallback**, mas o ADR-0004 já decidiu **não** usar LiteLLM.

**Inferência sobre agregadores:** mandar tudo por um agregador contradiz a promessa de "só texto, e você sabe para onde vai": a Transcrição passaria por mais um terceiro. O caminho compatível com o ADR-0004 é **tratar o OpenRouter apenas como mais um perfil** do formato "compatível com OpenAI" (já suportado), e usar o `models[]`/`zdr` dele como recurso opcional **dentro daquele perfil**, nunca como o roteador do Clipes.

---

## 4. Estimar dificuldade antes; verificar depois; escalar só na falha

### 4.1 Sinais disponíveis **antes** de chamar (inferência: nenhum foi validado como preditor de dificuldade)

| Sinal | De onde vem hoje | Para que serve |
|---|---|---|
| Duração da Fonte e número de janelas | Transcrição/pipeline #19 | Custo e prazo (certo), dificuldade (fraco) |
| Tokens por janela e densidade (palavras/min) | Transcrição por palavra | Estimativa de custo (#40) e risco de contexto longo |
| Idioma por segmento, mistura PT/EN | Transcrição registra o idioma por segmento de VAD (#12) | Tradução e modelos locais fracos em PT |
| Qualidade da Transcrição | Benchmark local: WER agregado de 30,78% (turbo, CUDA, float16) e de 39,21% (small, CPU) nas amostras revisadas por agente ([benchmark](2026-11-14-benchmark-transcricao.md)) | Transcrição ruidosa tende a piorar a seleção: **hipótese** |
| Tipo de tarefa | Conhecido | Principal preditor, e de graça |
| Tipo de vídeo (Corte direto × Vídeo transformado) | ADR-0001 | Roteiro só existe no transformado |

Os papers de roteamento treinam um preditor de dificuldade sobre dados de qualidade ([Hybrid LLM](https://arxiv.org/abs/2404.14618)); sem esses dados, qualquer fórmula nossa seria chute. **Recomendação:** mostrar esses sinais como um **resumo de custo e risco** antes do lote, **não** como um roteador automático.

Em dinheiro (**inferência com conta explícita**): preços de API oficiais em 2026-11-14 — Sonnet 5.5 a $2 / $10 por milhão de tokens (entrada/saída) e Haiku 5.5 a $0,10 / $0,50 para prompts até 100 mil tokens; Batch API com 50% de desconto ([preços Anthropic](https://platform.claude.com/docs/en/about-claude/pricing.md)). Uma live de 4 h com ~150 palavras/min tem ~36 mil palavras/h; assumindo ~1,5 token por palavra e janelas com 30% de sobreposição, são **~280 mil tokens de entrada** por Fonte. No Sonnet 5.5 isso dá ≈ $0,56 de entrada; no Haiku 5.5 ≈ $0,03 (a saída é pequena: IDs de Frase e notas). A razão é ~20×, mas o valor absoluto é de **centavos a poucos dólares por live**. **Conclusão (inferência):** para API, o ganho em dinheiro de rotear a seleção é modesto. O argumento forte para ter Provedor barato/local é **privacidade, cota de assinatura (CLI) e usuário sem cartão**, e o argumento para ter forte é **qualidade onde o usuário revisa pouco**.

### 4.2 Verificação **depois** (do mais barato ao mais caro)

1. **Schema e `schemaVersion`** (já existe no adaptador). Para modelo local, a saída pode ser **forçada** por gramática: Ollama aceita `format` com JSON Schema ([docs Ollama](https://docs.ollama.com/capabilities/structured-outputs.md)), o llama.cpp tem GBNF ([guia](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)) e as APIs têm modo nativo (o Clipes já usa `nativeSchema`). Fato verificado: em modelos de 0,6B–4B, decodificação restrita levou a validade estrutural de 78,6–92,9% para **100%**, mas **erros semânticos persistem e dependem da escala**: "conformidade de schema é necessária, não suficiente" ([paper, 2026-09-20](https://arxiv.org/abs/2609.23742)). Um agregador de leaderboard citou 87–91% de conformidade sem restrição para modelos de 4–8B (fonte secundária, **não verificado**).
2. **Regras determinísticas de domínio** (inferência, todas baratas e já alinhadas ao #19): todo ID de Frase existe; as Frases formam um intervalo contíguo; a duração cabe na faixa do Perfil de canal; sem sobreposição com Corte já aprovado; nº de candidatos dentro do esperado; a Nota tem os 5 eixos e cada um traz justificativa; Roteiro cobre os blocos pedidos; legenda traduzida mantém o nº de Frases e o limite de caracteres por linha.
3. **Modelo juiz**. Fato verificado: juízes fortes chegam a >80% de concordância com humanos, mas têm **vieses de posição, verbosidade e autopreferência** ([MT-Bench/Chatbot Arena, 2023-06-09](https://arxiv.org/abs/2306.05685)). **Inferência:** o juiz deve ser outro modelo (não o autor) e **fica fora da v1**; é caro, enviesado e hoje não há como calibrá-lo.
4. **Humano**: o usuário já revisa tudo (Corte revisável, Roteiro bloco a bloco, ADR-0001 regra 5). Essa revisão é o melhor "sinal de confiança" que o produto tem, e ela gera o dado para o experimento (seção 8), **localmente**.

### 4.3 Quando escalar (política proposta)

Escalar **só** diante de falha **definida e validada**, nunca por palpite:
- falha de schema depois do reparo (hoje `invalid_json`, "failed validation after repair");
- violação de regra determinística do item 2;
- **nunca** em `timeout_uncertain` (ADR-0005: pode ter havido cobrança; só `jobs.retry` com confirmação);
- `rate_limit` e erro transitório: repetir no **mesmo** perfil (já tratado no adaptador), não subir de nível.

Escalar é **uma nova chamada paga**: o teto do #56 precisa ser checado antes de cada escalada, e a estimativa do #40 passa a ser uma **faixa** ("R$ x se tudo passar no barato; até R$ y se tudo escalar").

**Fato verificado de modelagem** que sustenta cobrar e registrar o modelo que de fato respondeu: o OpenRouter já cobra "pelo modelo usado de fato" e devolve qual foi ([Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks.md)). Em nossa tabela de custos (#40), cada chamada deve gravar `perfil`, `modelo` e `tentativa`, para o usuário ver "quem processou o quê" (história 31).

---

## 5. Tarefas do Clipes em níveis

Níveis usados: **local pequeno** (modelo em loopback, ~1–8B, cabe numa RTX 3050 de 4 GB quantizado; a Transcrição já roda sequencialmente na GPU, ADR-0004), **barato** (API de modelo pequeno), **forte**.

| Tarefa | Entrada / saída | Nível provável | Evidência | Status |
|---|---|---|---|---|
| **Seleção de Cortes** (#19) | Janelas de Frases com ID → IDs + Nota de 5 eixos com justificativa | **Forte** para a ordenação final; barato/local talvez sirva como **1º filtro** de janelas | Nenhum benchmark publicado de "apontar momentos em transcrição de live". Estudos de destaque em vídeo usam LLM sobre legendas, mas em outros domínios ([HIVE, 2025-07-03](https://arxiv.org/abs/2507.02790); [Minimal Clips, 2025-12-12](https://arxiv.org/abs/2512.11399)). Contexto longo degrada quando a informação está no meio ([Lost in the Middle, 2023-07-06](https://arxiv.org/abs/2307.03172)); as janelas curtas do #19 mitigam | **Hipótese a medir** no #57 (único com gabarito) |
| **Empacotamento** (#68) | Transcrição de um Corte (20–60 s) → título, descrição, tags, hashtags, ideia de thumbnail, PT-BR/EN | **Barato** ou até local médio; forte opcional | Sem evidência publicada para PT-BR. Entrada pequena, saída curta, o usuário edita tudo | **Hipótese a medir**; sem gabarito (subjetivo) |
| **Roteiro** (#73) | Transcrição do Corte + blocos vizinhos → blocos de Narração | **Forte** | Nenhuma. É a Transformação (ADR-0001), qualidade criativa; o texto vai para TTS, e o ADR-0001 (regra 7) pune roteiro genérico | **Hipótese**; custo absoluto é baixo (um Corte por vez), então errar para cima é barato |
| **Tradução de legenda** (#75) | Frases PT-BR ↔ EN → mesmas Frases traduzidas | **Local especializado é plausível** | Modelos pequenos de tradução reportam bons resultados no WMT25: [HY-MT1.5-1.8B/7B](https://arxiv.org/abs/2512.24092) (2025-12-30) e [TranslateGemma](https://arxiv.org/abs/2601.09012) (2026-01-13). **São números dos próprios autores, não medem legenda PT-BR↔EN, e não verifiquei a licença de pesos** (exigência do ADR-0003) | **Hipótese**; checar licença antes de qualquer menção em UI |
| **Guarda-corpos** (#76) | Avisos e checklist | **Nenhum LLM** | Os critérios de aceite do #76 não chamam Provedor | Não é tarefa de Provedor hoje; um "checador de originalidade por LLM" seria escopo novo e não recomendado |
| **Reparo de JSON** | Resposta inválida → JSON válido | **Não é tarefa à parte**: vive dentro de cada chamada | Já existe (2 tentativas, mesmo modelo, sem `nativeSchema`). Gramática/`nativeSchema` elimina falha estrutural; semântica não ([2026-09-20](https://arxiv.org/abs/2609.23742)) | Manter; escalar para o forte só se o reparo falhar (seção 4.3) |

**Inferência importante:** como o custo em dólares de Empacotamento, Roteiro e tradução por Corte é desprezível mesmo no modelo forte (entradas de ~100–300 tokens por Frase), **a decisão de nível dessas tarefas é de qualidade e privacidade, não de custo**. O único lugar onde o custo pesa é a **seleção sobre a Fonte inteira** (centenas de milhares de tokens por live).

**Ideia de custo para a seleção (hipótese a medir):** em duas passadas, o modelo barato/local filtra janelas e o forte reordena só os candidatos (~10 por hora, #19), com poucos tokens de entrada. Isso corta tokens do forte sem roteador aprendido. Só vale se o recall do #57 não cair.

---

## 6. Opções

Esforço em unidades relativas (P/M/G) sobre o código atual.

### Opção A: manter o status quo (um endpoint + CLIs, escolha por tarefa do #43)
- **Prós:** já existe; zero migração.
- **Contras:** só um modelo de API/local por vez; para usar "Haiku no Empacotamento e Sonnet na seleção" o usuário reconfigura `provider.configure` toda hora.
- **Custo:** zero. **Esforço:** zero.

### Opção B: vários perfis + tarefa → perfil (regra fixa) ⟵ recomendada para a v1
- **Prós:** atende o pedido do #113; zero dado de treino; auditável ("quem processou o quê"); encaixa no `assistant.route`; funciona com qualquer mistura de API/local/CLI; compatível com #13 (troca por tarefa já é decisão tomada, só passa a haver mais de uma API).
- **Contras:** o usuário precisa escolher (mitigação: assistente do #43 sugere, sem padrão de fábrica); sem proteção automática se o perfil cai (continua erro claro + troca manual, como no #13).
- **Custo:** o que o usuário escolher. **Esforço:** M (modelo de dados, migração, UI de perfis, resolução da rota).

### Opção C: B + "papéis" (rápido/barato e forte) como camada de apelido
- **Prós:** trocar o modelo forte em um lugar só; a UI fala a língua que o dev descreveu ("time de agentes").
- **Contras:** mais um conceito; sem escalada automática, o papel é só um apelido.
- **Esforço:** P sobre a B. Entra se o grilling confirmar; senão, B basta.

### Opção D: C + escalada automática por falha validada e fallback por indisponibilidade
- **Prós:** menos retrabalho manual; resiliência em lote noturno (#56).
- **Contras:** **contradiz o #13/história 31** ("sem fallback automático… saber quem processou o quê"); pode levar texto de um perfil local para um remoto (privacidade); cada escalada é gasto extra; custo vira faixa.
- **Esforço:** M–G (política, UI de consentimento, teto por escalada, registro de custo por tentativa, testes com Provedor falso).
- **Pré-requisito:** grilling + ADR novo que substitua a linha do #13.

### Opção E: roteador aprendido (RouteLLM/Not Diamond/FrugalGPT)
- **Prós:** em benchmarks gerais, economia comprovada.
- **Contras:** exige dados rotulados que não temos; calibração por limiar; reavaliações de 2026 mostram vantagem pouco confiável sobre baselines simples; RouteLLM `mf` depende de embeddings da OpenAI; comerciais mandam o texto a um terceiro.
- **Esforço:** G, benefício incerto. **Não recomendado**; rever só se o experimento da seção 8 mostrar uma lacuna grande entre sempre-barato e oráculo.

### Opção F: usar um agregador como roteador (OpenRouter Auto etc.)
- **Prós:** zero código de roteamento.
- **Contras:** terceiro lê tudo; o modelo escolhido muda sem o usuário saber (embora haja metadados); contradiz a promessa de transparência; custo extra da chamada de decisão.
- **Alternativa compatível:** OpenRouter como **um perfil** do formato OpenAI, com `zdr`/`data_collection: deny` do próprio serviço.

| Opção | Evidência a favor | Dados que exige | Privacidade | Esforço | ADR em conflito |
|---|---|---|---|---|---|
| A | n/a | nenhum | igual | 0 | não |
| **B** | regra fixa não precisa de evidência | nenhum | igual, controlada pelo usuário | M | não |
| C | idem | nenhum | igual | P | não |
| D | AutoMix/FrugalGPT (domínios gerais) | validador (já temos) | **muda** (escalada local→remoto) | M–G | **#13 "sem fallback automático"** |
| E | RouteLLM etc. (domínios gerais) | rótulos por tarefa (não temos) | depende | G | tensão com ADR-0006 se coletar uso |
| F | docs do serviço | nenhum | **terceiro extra** | P | tensão com "só texto, você sabe para onde" |

---

## 7. Recomendação

1. **v1: Opção B** (com C só se o grilling pedir). Perfis múltiplos; tarefa → perfil; custo por perfil; "somente local"; **"Refazer com o forte" manual** (um clique, nova chamada, confirmação de custo), que respeita "troca manual" do #13 e **gera o dado** para a escalada futura.
2. **Depois da v1:** Opção D, mas **só** depois de (a) o experimento da seção 8 mostrar ganho real e (b) grilling + ADR novo. Antes disso, nenhum fallback automático.
3. **Não fazer:** roteador aprendido (E) e agregador como roteador (F).
4. **Sem padrão de fábrica:** o mapeamento tarefa → perfil **sai vazio**. A tabela da seção 5 é **recomendação do assistente**, exibida como sugestão com o aviso "hipótese ainda não medida", nunca aplicada sozinha.
5. **Privacidade:** "somente local" entra na v1 como **restrição**, não como escolha (seção 7.3).

### 7.1 Modelo de dados: do atual ao proposto (sem quebrar quem já configurou)

**Hoje** (resumido):

```jsonc
// provider.json
{ "endpoint": "https://api.example.com/v1", "model": "m", "kind": "openai", "nativeSchema": false,
  "providers": { "https://api.example.com/v1": { "confirmed": true, "keyLastFour": "abcd" } } }
// provider-cli.json
{ "selected": "", "codex_confirmed": false, "claude_confirmed": false }
// assistant.json
{ "completed": true, "skipped": false, "default": "endpoint",
  "tasks": { "translation": "codex" } }
```

**Proposto** (versão 2; os campos antigos continuam sendo lidos):

```jsonc
// provider.json
{
  "schemaVersion": 2,
  "profiles": [
    { "id": "legacy",              // perfil sintetizado a partir do endpoint único
      "label": "Principal", "kind": "openai",
      "endpoint": "https://api.example.com/v1", "model": "m", "nativeSchema": false,
      "vaultAccount": "https://api.example.com/v1",   // PRESERVA a conta atual do cofre
      "price": { "inputPerMTok": 2.0, "outputPerMTok": 10.0, "currency": "USD", "source": "user" } },
    { "id": "ollama-qwen", "label": "Local rápido", "kind": "openai",
      "endpoint": "http://127.0.0.1:11434/v1", "model": "qwen-4b", "nativeSchema": true,
      "vaultAccount": null, "price": { "inputPerMTok": 0, "outputPerMTok": 0 } }
  ],
  "consent": { "https://api.example.com/v1": true },    // continua POR ENDPOINT
  "roles": { "fast": null, "strong": null }              // só na Opção C; vazio por padrão
}
// assistant.json (mesmos campos + valores novos aceitos)
{ "default": "endpoint",                  // "endpoint" == perfil "legacy"
  "tasks": { "selection": "profile:legacy", "translation": "profile:ollama-qwen", "packaging": "role:fast" } }
```

Regras de compatibilidade (todas verificáveis em teste headless):
- **Leitura preguiçosa**: se não há `profiles`, sintetizar o perfil `legacy` a partir de `endpoint/model/kind/nativeSchema`; **não reescrever** o arquivo até o usuário editar.
- **Valores antigos de `assistant.json`** (`""`, `endpoint`, `codex`, `claude`) continuam válidos; `endpoint` = `legacy`. `Route::Unset` continua dando o comportamento anterior.
- **Cofre**: a conta continua sendo a string do endpoint (`vaultAccount`); **migrar a chave seria perigoso** (perder a chave do usuário). Perfis novos usam uma conta própria (`profile:<id>`).
- **Consentimento por endpoint** continua; um perfil novo para um endpoint já confirmado herda; endpoint loopback dispensa (como hoje).
- **`provider.configure`** sem `profileId` mantém exatamente o comportamento atual (sobrescreve `legacy`, chama `provider_cli::clear()`); com `profileId` faz *upsert* de um perfil e **não** limpa o CLI.
- **CLIs viram perfis `kind: codex|claude`**, mantendo `provider-cli.json` (confirmações, "experimental, desligado por padrão"); `price: null` e a UI mostra "consome a cota do plano" (#40, #39).
- **Localidade é calculada, não guardada**: `isLocal = is_local_endpoint(endpoint)`. Guardar "local: true" seria um campo que o usuário poderia trocar e que **mente** se o DNS mudar.
- **Preço**: vem da tabela local atualizável do #40; o campo `price` do perfil é uma sobrescrita do usuário (necessário para endpoints compatíveis e locais). Sem preço conhecido, a UI mostra "custo desconhecido" e **não participa de nenhum teto automático** (inferência: um teto que ignora perfis sem preço seria falsa segurança; o lote deve pausar ou exigir confirmação).

### 7.2 UI (esboço)

- **Tela "Provedores"**: lista de cartões (rótulo, tipo, modelo, selo **Local / Remoto / Assinatura / Experimental**, "chave …abcd", preço, consentimento). Reaproveita o fluxo atual de chave e confirmação.
- **Tabela "Tarefas"**: linhas = seleção, Empacotamento, Roteiro, tradução; coluna = perfil (lista) ou papel; ao lado, **custo estimado por tarefa** quando existir o #40, e o selo de localidade. Sem valor padrão; o assistente do #43 só sugere.
- **Lote (#56)**: antes de iniciar, "estimativa: R$ x" (faixa só quando a Opção D existir) e teto opcional; depois, custo real por perfil e por tarefa.
- **Revisão de Corte**: botão "Refazer com [perfil forte]" mostra perfil, custo estimado e se sai da máquina.

### 7.3 Privacidade: "somente local"

**Fatos:** o assistente e a detecção só falam com loopback e "nunca enviam dados" (`assistant.rs`); a localidade já é testável por `is_local_endpoint`. Consentimento remoto já é exigido por endpoint.

**Proposta:** restrição `localOnly` que **só proíbe**, nunca escolhe:
- **Escopo por tarefa** (configuração do app, em `assistant.json`): "esta tarefa só roda em perfil local". Sem conflito com ADR.
- **Escopo por Projeto** (útil para um canal cujas Fontes não podem sair): um sinalizador no `project.sqlite`, portátil junto do Projeto. **Isso toca duas decisões**: `assistant.rs` afirma que as escolhas ficam "nunca no Projeto nem no Perfil de canal", e o #43 diz "o Perfil de canal não escolhe Provedor". Mitigação: o sinalizador **não escolhe Provedor**, só **veta remoto**. Mesmo assim, **é decisão do dev**: grilling antes de implementar.
- **Aplicação no núcleo**, no mesmo ponto que hoje resolve a rota: depois de resolver o perfil, se `localOnly` e o perfil não for loopback → erro `local_only_violation`, **sem chamada de rede**. CLIs contam como **não locais** (são subprocesso que fala com a nuvem da assinatura).
- **Nunca escalar para fora**: com `localOnly`, a escalada da Opção D só vale entre perfis locais; "refazer com o forte" manual recusa perfil remoto.
- **Sem vazamento por metadados**: o log e o diagnóstico (ADR-0006, allowlist) não devem incluir o texto nem o nome do Projeto ao registrar a recusa.
- **LAN não é local** (decisão atual): um servidor de modelo em outra máquina da casa será tratado como remoto e exigirá consentimento. Pergunta aberta 4.

---

## 8. Experimento barato (calibrar com dados nossos)

**Objetivo:** medir, no dataset do #28 e no harness do #57, a distância entre "sempre-barato", "sempre-forte", um **oráculo** e uma **cascata**, para decidir se vale a Opção D.

**Pré-requisito:** o #57 existir (hoje aberto) e o #28 revisado pelo dev (a referência é "provisória até a revisão"; a revisão de transcrição de amostras por agente já foi sinalizada como otimista no [benchmark de transcrição](2026-11-14-benchmark-transcricao.md)).

**Desenho (custo ≈ uma rodada por modelo):**
1. Escolher 3–4 candidatos: um local pequeno (loopback), um barato de API, um forte de API, e opcionalmente o Codex.
2. Para **cada janela** de **cada VOD** do #28, rodar **uma vez** por modelo, **gravando por janela**: saída bruta, validade de schema, regras do item 4.2, `usage` e latência. Sem reexecutar depois.
3. **Reproduzir offline** as políticas sobre os registros: sempre-barato; sempre-forte; **oráculo** (o melhor por janela, teto teórico); **cascata** (barato; se schema/regra falha, forte); **duas passadas** (barato filtra, forte reordena o top-K).
4. Métricas (as do #57): recall dos Cortes humanos, % de bordas no meio de Frase (meta 0%), tempo e custo por hora de Fonte, **mais**: taxa de escalada e custo médio com a cascata.
5. Decisão: se a cascata chega perto do forte com bem menos tokens do forte, e **o oráculo está muito acima de sempre-forte** (há o que ganhar), seguir para o ADR da escalada. Se sempre-forte ≈ oráculo, não rotear.

**Limites a declarar no relatório:** (a) só a **seleção** tem verdade de campo e ela é **provisória** (~50 Cortes, 5 Fontes); (b) Empacotamento, Roteiro e tradução **não** têm gabarito, então o relatório só pode registrar validade, custo e latência, e comparação cega **opcional** feita pelo próprio dev; (c) o conjunto é pequeno demais para estimativas com intervalo estreito: reportar como observação, como o #28 já faz; (d) o oráculo é otimista por construção.

**Dados que ficam locais:** as saídas por janela não vão para o repositório (as Fontes não são redistribuídas, #28); o repositório só recebe as métricas agregadas.

---

## 9. Conflitos com decisões tomadas (não tratar como decididos)

| # | Tema | O que está decidido | O que esta pesquisa tocaria | Caminho |
|---|---|---|---|---|
| 1 | **Fallback automático** | #13: "sem fallback automático"; história 31; #56 "troca manual" | Fallback por indisponibilidade e escalada por falha | **Grilling + ADR novo.** Na v1 só "refazer com o forte" manual |
| 2 | **Escalar × ADR-0005** | Chamada incerta não se repete às cegas | Escalada nunca em `timeout_uncertain`; só em falha validada e definitiva | Regra explícita no ADR da escalada |
| 3 | **"Somente local" por Projeto** | `assistant.rs`: escolhas nunca no Projeto; #43: Perfil de canal não escolhe Provedor | Sinalizador no Projeto que **veta** remoto | Grilling; tratar como restrição, não escolha |
| 4 | **O que é "local"** | Só loopback; CLIs não são locais | Hospedar modelo na LAN; agregadores | Manter loopback; revisar só com decisão do dev |
| 5 | **Sem padrão de fábrica** | #43 | Mapa tarefa→perfil/papel e recomendações | Sai vazio; recomendação só como sugestão |
| 6 | **Aprendizado de roteador** | ADR-0006 (sem telemetria); aprovações só locais (#19) | Coletar dados de uso para treinar | Não coletar. Só dados do dataset #28 e do uso local do próprio usuário, e nunca enviados |
| 7 | **Custo e teto** | #13: estimativa antes, real depois, teto por lote | Com cascata, a estimativa vira faixa; teto checado antes de cada escalada; perfil sem preço (CLI) não entra em decisão por custo | Ajustar #40 e #56 se a Opção D entrar |
| 8 | **Escopo de tarefas** | `TASKS` tem 4; #76 não chama Provedor | "Guarda-corpos", "juiz" e "reparo" como tarefas | Escopo novo; não incluir na v1 |
| 9 | **Agregador como terceiro extra** | "Só texto, você sabe para onde vai" | OpenRouter Auto/roteadores comerciais | Só como perfil explícito |
| 10 | **LiteLLM** | ADR-0004 recusou | Reaproveitar a semântica de fallback | Copiar a **ideia**, não a dependência |

---

## 10. Escopo sugerido

### Cabe na v1
- Perfis múltiplos + migração sem quebra (T1).
- Tarefa → perfil, mantendo "sem padrão de fábrica" (T2).
- Custo por perfil e preço editável, integrados ao #40 (T3).
- "Somente local" por tarefa; por Projeto **se o grilling aprovar** (T4).
- "Refazer com o forte" manual (T5).

### Fica depois
- Papéis "rápido/forte" (Opção C), se o grilling pedir.
- Escalada automática por falha validada e fallback (Opção D), com ADR.
- Duas passadas na seleção (barato filtra, forte reordena).
- Juiz (modelo avaliador).
- Estimador de dificuldade (só se o experimento mostrar lacuna).
- Qualquer roteador aprendido ou agregador como roteador.

---

## 11. Riscos e perguntas abertas para o dev

### Riscos
1. **Chave órfã na migração**: mudar a conta do cofre faria o usuário perder a chave. Mitigação: `vaultAccount` preserva a conta atual.
2. **Falsa segurança de teto**: perfis sem preço (CLI, modelos custom) ficam fora de tetos por custo.
3. **Vazamento por escalada**: um perfil local que escala para remoto envia texto que o usuário achava local. Mitigação: consentimento e `localOnly`.
4. **Qualidade local em PT-BR é desconhecida**: sem benchmark nosso, a tabela de níveis é hipótese.
5. **Medir com gabarito provisório**: revisão por agente tende ao otimismo (já visto no benchmark de transcrição).
6. **Preços e modelos mudam rápido**: tabela local atualizável (#40) é obrigatória; não gravar preços no código.
7. **Licença dos modelos de tradução locais**: ADR-0003 exige conferir antes de listar (não verifiquei).

### Perguntas para o dev
1. Você aceita **fallback automático** em algum caso (queda do Provedor, falha validada), ou a linha do #13 ("sem fallback automático") continua valendo na v1 e depois dela?
2. "Somente local por Projeto" pode viver no `project.sqlite` como **veto** (não escolha)? Ou prefere só por tarefa, no app?
3. Servidor de modelo na LAN conta como local? (hoje não.)
4. Quer **papéis** ("rápido", "forte") na UI, ou basta escolher perfil por tarefa?
5. Aceita que, por padrão, o assistente **sugira** (sem aplicar) a tabela da seção 5, marcada como "ainda não medida"?
6. Quer rodar o experimento da seção 8 já no #57, mesmo com gabarito provisório?
7. Que Provedores locais e modelos você quer cobrir primeiro no teste (Ollama com qual modelo)?
8. O Codex deve entrar no experimento como candidato "forte" (custo = cota, sem `usage`)?

---

## 12. Tickets propostos (não criados no GitHub)

**T1. Perfis de Provedor múltiplos com migração sem quebra**
- [ ] `provider.json` v2 com `profiles[]`; leitura preguiçosa sintetiza o perfil `legacy` do endpoint único.
- [ ] A conta do cofre do perfil `legacy` continua sendo a string do endpoint; perfis novos usam conta própria; teste prova que a chave antiga continua legível.
- [ ] `provider.configure` sem `profileId` se comporta como hoje (inclusive `provider_cli::clear()`); com `profileId` faz *upsert*.
- [ ] Consentimento continua por endpoint; endpoint loopback dispensa.
- [ ] Os valores `""`, `endpoint`, `codex`, `claude` de `assistant.json` seguem resolvendo; `Route::Unset` preservado.
- [ ] Nenhuma chave aparece em arquivo, log ou resposta; testes headless com cofre falso.

**T2. Tarefa → perfil (regra fixa) sem padrão de fábrica**
- [ ] `assistant.task.set` aceita `profile:<id>`; `assistant.default.set` idem.
- [ ] Sem escolha, nada é selecionado (como hoje); recomendação só aparece como sugestão marcada "ainda não medida".
- [ ] A chamada registra `perfil` e `modelo` usados.
- [ ] Teste: trocar o perfil de uma tarefa não altera as outras.

**T3. Preço por perfil e custo por perfil (integra #40)**
- [ ] Campo `price` por perfil com sobrescrita do usuário; tabela local atualizável.
- [ ] Custo gravado por tarefa, perfil, modelo e tentativa.
- [ ] Perfil sem preço mostra "custo desconhecido" e não entra em teto automático (o lote pede confirmação).
- [ ] CLI mostra "consome a cota do seu plano".

**T4. Restrição "somente local"**
- [ ] Por tarefa: perfil não-loopback recusado com `local_only_violation` antes de qualquer rede.
- [ ] CLIs contam como não locais.
- [ ] Por Projeto: **bloqueado até o grilling do dev**; se aprovado, sinalizador de veto no Projeto, sem escolher Provedor.
- [ ] Nada do texto ou do nome do Projeto vai para log/diagnóstico ao recusar (ADR-0006).

**T5. "Refazer com o forte" manual**
- [ ] Botão na revisão do Corte e do bloco do Roteiro; mostra perfil, custo estimado e se sai da máquina.
- [ ] Exige confirmação; respeita `localOnly` e o teto do lote (#56).
- [ ] Registra no Projeto qual perfil gerou o resultado; não troca o Provedor padrão.
- [ ] Nunca disponível sobre job `uncertain` (ADR-0005).

**T6. Experimento de roteamento sobre o #57**
- [ ] Rodar cada modelo candidato uma vez sobre todas as janelas e gravar por janela (saída, schema, regras, `usage`, latência).
- [ ] Reproduzir offline: sempre-barato, sempre-forte, oráculo, cascata, duas passadas.
- [ ] Relatório em Markdown em `docs/research/` com taxa de escalada e custo médio, declarando que só a seleção tem gabarito e que ele é provisório.
- [ ] Saídas por janela ficam locais e fora do git.

**Candidato a ADR (depois do experimento e do grilling):** "Escalada e fallback automáticos entre Provedores", que substituiria a linha "sem fallback automático" do #13 e fixaria: só falha validada, nunca em `timeout_uncertain`, nunca local→remoto sem consentimento, sempre registrada e contada no teto. Ver pesquisa #114 para onde a verificação e o orçamento vivem na arquitetura de harness.

---

## 13. Fontes

Todas acessadas em 2026-11-14. Datas: publicação da v1 (arXiv) ou `updatedAt`/"acessado em" quando a fonte não traz data.

**Papers (arXiv)**
- RouteLLM: Learning to Route LLMs with Preference Data. 2024-06-26. https://arxiv.org/abs/2406.18665
- FrugalGPT. 2023-05-09. https://arxiv.org/abs/2305.05176
- AutoMix. 2023-10-19. https://arxiv.org/abs/2310.12963
- Hybrid LLM: Cost-Efficient and Quality-Aware Query Routing. 2024-04-22. https://arxiv.org/abs/2404.14618
- A Unified Approach to Routing and Cascading for LLMs. v1 2024-10-14 (revisão de 2026-10-26). https://arxiv.org/abs/2410.10347
- RouterBench. 2024-03-18. https://arxiv.org/abs/2403.12031 (citado como base de comparação; não detalhado aqui)
- Dynamic Model Routing and Cascading: A Survey. 2026-02-23. https://arxiv.org/abs/2603.04445
- LLMRouterBench. 2026-01-12. https://arxiv.org/abs/2601.07206
- Task- and Session-Level Model Routing (4 roteadores, 4 benchmarks). 2026-07-28. https://arxiv.org/abs/2608.14641
- Constrained Decoding Eliminates Structural Failures in Small LLMs… 2026-09-20. https://arxiv.org/abs/2609.23742
- JSONSchemaBench. 2025-01-18. https://arxiv.org/abs/2501.10868 (citado só como referência de avaliação de saída estruturada; números não usados)
- Judging LLM-as-a-Judge (MT-Bench/Chatbot Arena). 2023-06-09. https://arxiv.org/abs/2306.05685
- Lost in the Middle. 2023-07-06. https://arxiv.org/abs/2307.03172
- HY-MT1.5 Technical Report. 2025-12-30. https://arxiv.org/abs/2512.24092
- TranslateGemma Technical Report. 2026-01-13. https://arxiv.org/abs/2601.09012
- HIVE (edição de vídeo com narrativa multimodal). 2025-07-03. https://arxiv.org/abs/2507.02790
- Minimal Clips, Maximum Salience. 2025-12-12. https://arxiv.org/abs/2512.11399

**Documentação e repositórios oficiais**
- RouteLLM (README e API do GitHub: licença Apache-2.0, último push 2024-08-10). https://github.com/lm-sys/RouteLLM
- OpenRouter: [Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks.md), [Provider Selection](https://openrouter.ai/docs/guides/routing/provider-selection.md), [Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router.md).
- Not Diamond: [Training a custom router](https://docs.notdiamond.ai/docs/router-training-quickstart.md) (updatedAt 2026-05-21), [Key concepts](https://docs.notdiamond.ai/docs/key-concepts.md) (2026-05-21), [What is Model Routing](https://docs.notdiamond.ai/docs/what-is-model-routing.md) (2026-05-15).
- Martian: https://docs.withmartian.com/ (**não verificado**: página "How the router works" devolveu 404).
- LiteLLM Router. https://docs.litellm.ai/docs/routing
- Preços da Claude API (Sonnet 5.5, Haiku 5.5, Batch). https://platform.claude.com/docs/en/about-claude/pricing.md
- Saída estruturada: [Ollama](https://docs.ollama.com/capabilities/structured-outputs.md), [llama.cpp GBNF](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md), [Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md).

**Fontes secundárias, usadas só como pista e marcadas como não verificadas**
- Leaderboard agregado e testes de terceiros sobre conformidade de schema em modelos de 4–8B (AscentCore, abril de 2026; agregador JSONSchemaBench). Não li as páginas; os números não sustentam nenhuma conclusão do documento.
- Post de blog "Do LLM Routers Actually Route?" (Hugging Face, 2026-10). Não é revisado por pares; não usado como evidência.

**Repositório do Clipes (lidos em 2026-11-14)**
- `AGENTS.md`, `GLOSSARY.md`, `CONTRIBUTING.md`, ADRs [0001](../adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md), [0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md), [0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md), [0005](../adr/0005-projeto-portatil-com-sqlite.md), [0006](../adr/0006-relato-de-problemas-sem-telemetria.md).
- Issues #1 (mapa), #13, #19, #26 (spec), #28, #39, #40, #43, #56, #57, #68, #72, #73, #75, #76, #113, #114.
- Código: `core/src/provider.rs`, `core/src/provider/adapters.rs`, `core/src/provider_cli.rs`, `core/src/assistant.rs`, `core/src/jobs.rs`; `docs/contribuindo/provedor.md`; [benchmark de transcrição](2026-11-14-benchmark-transcricao.md).
