# Seleção de Cortes

A seleção (`core/src/selection.rs`, #53) escolhe candidatos a **Corte** numa Transcrição completa. Ela é uma [Tarefa de IA](tarefa-de-ia.md) (id `selection`) executada **uma vez por Janela de seleção** ([planejador do #144](janelas-de-selecao.md)), na fila de jobs, num lote próprio por execução. O Provedor só aponta IDs de Frase e dá notas; janelas, ajuste de bordas, junção de duplicatas e ordenação são código. Juiz e voting estão desligados. Termos no [glossário](../../GLOSSARY.md); decisões em [ADR-0007](../adr/0007-tarefas-de-ia-como-workflows-fixos-no-nucleo.md), [ADR-0008](../adr/0008-contrato-de-saida-estruturada-agnostico-de-provedor.md) e [ADR-0009](../adr/0009-custo-orcamento-e-auditoria-de-chamadas-de-ia.md).

## Fluxo

1. `selection.estimate {source_id, minUs?, maxUs?}` planeja as Janelas (`plan_for_profile`) e estima o custo (#40/#141) sem enviar nada. Janela bloqueada devolve o erro tipado do #144 (`context_too_small`, `max_cut_too_long`). Com `{run, windows?}` estima só as Janelas pendentes de uma execução.
2. `selection.start {source_id, minUs?, maxUs?, confirmed?}` repete o plano, aplica os vetos "somente local" (#123) e, se o Provedor é pago, exige `confirmed: true` (`confirmation_required` com `usage.estimate`). Cria a execução e enfileira um job `ai:selection` por Janela no lote `selection-<run>`; o orçamento e a pausa do #124 valem por esse lote.
3. Cada job valida a saída (schema completo e verificadores) e grava o resultado na própria linha. **O job concluído é o checkpoint**: retomar nunca repete Janela concluída.
4. Quando todas as Janelas se resolvem, o núcleo (`advance`, chamado pela fila depois de cada job e por `selection.get`) ajusta as bordas, junta as duplicatas, ordena e grava os candidatos numa só transação, uma única vez.
5. `selection.get {run}` devolve a execução, as Janelas (estado e código de erro fixo), os candidatos já ordenados e os pesos. `selection.list {source_id}`, `selection.cancel {run}`, `selection.redo {run, windows?, confirmed?}` e `selection.resume {run}` (as Janelas que falharam ou foram canceladas) completam a superfície.

Reexecutar cria uma execução nova (`selection_runs`) e **não apaga a anterior**. Migração `0053_001_selection`: `selection_runs` (Transcrição, `task_version`, `prompt_sha256`, perfil, estado, faixa, pesos usados, contagens e resumo), `selection_windows` (Janela, job atual e tentativas) e `selection_candidates` (IDs de Frase inicial e final, tempos derivados no núcleo, eixos com justificativas, Nota total, Janelas de origem e ajuste).

## Saída do Provedor

Schema fio com `schemaVersion` 1 e `candidates`: **lista que pode ser vazia**. O prompt diz que é melhor não devolver nada a forçar um Corte fraco. Cada candidato tem `startId`, `endId`, `title` (texto vazio quando não há) e um objeto `{score, why}` por eixo. **Nunca tempos**: o núcleo calcula os µs pelas Frases. A transcrição entra como dado não confiável (padrão do #119), com uma linha `#JANELA` escrita pelo núcleo antes dela (`max_candidatos`, faixa desejada e máximo).

Meta de candidatos: `CANDIDATES_PER_HOUR` = 10 por hora de Janela, proporcional à duração dela e no mínimo 1. É "até ~": o verificador só recusa mais de `CANDIDATE_HARD_FACTOR` × a meta.

### Verificadores (`selection.rs`)

IDs existem e pertencem à Janela; `startId` ≤ `endId`; notas inteiras de 0 a 10; justificativas não vazias (até `MAX_WHY_CHARS`); título até `MAX_TITLE_CHARS`; sem candidatos repetidos na mesma Janela; sem passar da meta com folga. Códigos fixos, sem texto da Transcrição nem da resposta.

### Falhas

O adaptador já faz **um** reparo para JSON ou schema fio inválido (ADR-0008). `verification_failed`, `output_invalid`, `invalid_json`, `context_truncated` (#145: a resposta foi calculada sobre Transcrição cortada e não é aceita) e qualquer outro erro derrubam **só aquela Janela**, com o código fixo no resumo; as outras seguem. Não há segunda chamada automática (decisão do coordenador, 15/11/2026): a UI oferece **Refazer janela** (com a estimativa antes e confirmação se paga, no mesmo lote, contando no orçamento) e **Retomar janelas**. Se o #57 mostrar taxa alta de `verification_failed`, um ticket futuro pode levar a mensagem fixa do verificador ao modelo.

## Nota total

Tabelas únicas em `cut::AXES` (Corte direto) e `cut::AXES_TRANSFORMED` (Vídeo transformado, #67): chave e peso em pontos percentuais. A Nota total é a média ponderada `Σ peso × nota`, calculada em centésimos (`total_centi(kind, notas)`, de 0 a 1000) para a comparação ser exata, com as notas na ordem da tabela do tipo. **Sem curva.** Cada tabela soma 100, e um teste confere isso, o total calculado à mão e que o schema (`wire.json`, `full.json` e as versões `_transformed`) tem exatamente os eixos da tabela. Cada candidato e cada execução devolvem os pesos usados.

| Eixo | Chave | Corte direto | Vídeo transformado |
|---|---|---|---|
| Espaço para comentário | `commentary` | n/a | 30 |
| Gancho | `hook` | 30 | 20 |
| Autossuficiência | `selfContained` | 20 | 10 |
| Emoção/energia | `energy` | 20 | 15 |
| Valor | `value` | 15 | 15 |
| Fechamento | `closing` | 15 | 10 |

Decisões do dev em **15/11/2026**: o Corte direto fica com os 5 eixos e os pesos 30/20/20/15/15; o Vídeo transformado ganha o 6º eixo e usa Espaço para comentário 30, Gancho 20, Emoção/energia 15, Valor 15, Autossuficiência 10 e Fechamento 10. O #57 pode comparar outras distribuições.

## Tipo de vídeo (#67)

O tipo (ADR-0001) é escolhido **antes** da seleção, por execução, e é um de `direct` (Corte direto, o padrão) ou `transformed` (Vídeo transformado). `selection.estimate` e `selection.start` aceitam `videoKind`; um valor desconhecido devolve `invalid_video_kind` sem criar nada. `batches.create` também aceita `videoKind` e cada Fonte do lote herda o tipo. A resposta de `selection.start`, `selection.estimate`, `selection.get`, `selection.list` e `batches.get` traz `videoKind`, e o resumo da execução também (`summary.videoKind`), para a revisão e o editor lerem o tipo sem adivinhar.

- **Duas Tarefas de IA, um roteamento.** O Corte direto segue na tarefa `selection` v2, **sem mudança de prompt, schema nem versão**. O Vídeo transformado é a tarefa `selection_transformed` v1 (`prompt_transformed.md`, `wire_transformed.json`, `full_transformed.json`, entrada nova em `prompt-lock.json`): o 6º eixo `commentary` entra no prompt e no schema **só nela**, e o verificador dela exige o eixo (o do Corte direto não o conhece). `ai_task::routing_id` faz `selection_transformed` usar a escolha de Provedor e o veto "somente local" de `selection`, então nada muda para quem já configurou. O job fica como `ai:selection_transformed`; `selection::is_job_kind` reconhece os dois.
- **Persistência.** Migração `0067_001_video_kind`: `selection_runs.video_kind` e `source_batches.video_kind` (`direct` por padrão). Execuções e lotes anteriores valem como Corte direto. Refazer e retomar leem o tipo da execução.
- **O que o tipo implica** (texto fixo na UI, PT/EN, baseado no ADR-0001): o Corte direto é o trecho com legenda e pode ter a monetização recusada pela política de conteúdo reutilizado do YouTube; o Vídeo transformado exige Narração ou comentário humano revisado e nunca é 100% automático. Esta tarefa só escolhe e mostra o tipo e muda a seleção; Roteiro e Narração são de outros tickets.
- **Testes.** `core/src/selection/cut.rs` e `core/src/selection/tests.rs` (tabelas, schema, verificador por tipo, roteamento) e `core/tests/selection_video_kind.rs` (headless, Provedor falso: os dois tipos, o 6º eixo exigido só no transformado, total com os pesos novos, ordem, retomada, lote e veto).

## Ajuste de bordas (só código, por Frase inteira)

Constantes em `cut.rs`; o Perfil de canal (#72) vai poder trocá-las (hoje são os parâmetros `minUs` e `maxUs`, com estes padrões):

| Regra | Constante | Valor |
|---|---|---|
| Mínimo | `MIN_CUT_US` | 20 s |
| Fim da faixa desejada (só informado ao modelo) | `PREFERRED_MAX_US` | 60 s |
| Máximo | `MAX_CUT_US` | 3 min |
| Duplicata | `DUPLICATE_OVERLAP_PERCENT` | 50 % |

- **Curto demais**: acrescenta a Frase seguinte até o mínimo, sem passar do máximo nem sair da Transcrição; se a seguinte não couber, acrescenta a anterior. Não chegando ao mínimo, o candidato é descartado (`tooShort`).
- **Longo demais** (acima do máximo; cortes entre 60 s e 3 min valem): tira Frases do **fim** até caber. Se nem uma Frase cabe, descarta (`tooLong`).
- Todo candidato leva `adjusted` e `adjust` (`extendedBefore`, `extendedAfter`, `trimmedEnd`, em Frases). Os descartes entram na contagem do resumo.

## Duplicatas

Depois do ajuste, dois candidatos cuja interseção em tempo é ≥ `DUPLICATE_OVERLAP_PERCENT` da duração do **menor** são o mesmo momento (vêm das sobreposições entre Janelas). Fica o de maior Nota total e, no empate, o mais curto; guarda a união das Janelas de origem. A ordem final é Nota total decrescente e início crescente.

## Energia do áudio (#54)

Os picos de volume da Fonte (gritos, risadas) entram na seleção como uma **marca por Frase** no texto enviado ao Provedor e alimentam o eixo `energy` (Emoção/energia). Código em `core/src/energy.rs`; testes em `core/src/energy/tests.rs`, `core/tests/energy.rs` e `core/tests/selection_energy.rs`.

- **Job `energy`** (local, na fila do Projeto, cancelável, com progresso). Roda sozinho ao fim da Transcrição (depois de segmentar as Frases) e por `energy.start {source_id}` (idempotente; `transcript_incomplete` se a Transcrição não está completa). `energy.status {source_id}` devolve `measured`, as contagens de marcas (`high`, `peak`) e o último job. **A seleção não espera por ele.**
- **Medida.** O FFmpeg (Componente baixado, ADR-0003) só decodifica a faixa de microfone da Fonte: mono, 16 kHz, `s16le` por `pipe:1`, o mesmo padrão da onda do #43. O núcleo mede blocos de 100 ms e, por Frase, usa o **maior momentâneo** (janela de 400 ms, como o `M` do EBU R128) que toca a Frase: um grito ou uma risada são curtos, e a média da Frase os diluiria. Escolhemos medir no núcleo, e não pelos filtros `ebur128` ou `astats`, para o resultado ser determinístico e testável com um FFmpeg falso (os filtros imprimem texto cujo formato varia entre versões). Não há ponderação K: o sinal é só relativo à própria Fonte. O áudio nunca sai da máquina; só um número por Frase (dBFS em centésimos, `sentence_energy`, migração `0054_001_sentence_energy`) fica no Projeto.
- **Rótulo, relativo à Fonte** (`energy::levels`, função pura; constantes nomeadas em `energy.rs`): `peak` passa do percentil 95 da Fonte (comparação estrita) e fica pelo menos 6 dB acima da mediana; `high` passa do percentil 80 e fica pelo menos 3 dB acima; `low` fica abaixo do percentil 20 e pelo menos 3 dB abaixo; o resto é `mid`. Frases mudas ficam fora das estatísticas e abaixo de 8 Frases medidas ninguém recebe marca. Uma Fonte sem variação nunca tem `peak`. Os rótulos são calculados na leitura, então mudar uma constante não exige remedir.
- **Formato no texto.** Só `high` e `peak` aparecem, e a Frase sem marca é normal: `123 [energia alta] texto` e `123 [energia pico] texto`, sem número de loudness e sem tempo. A marca mora numa função só, `energy::mark`, e a linha numa função só, `sentences::line`, usada pelo serializador compacto (`compact_marked`, `compact_with_hint_marked`), pelo planejador de Janelas (#144, `plan_for_profile_marked`) e, por consequência, pelo estimador de tokens (#140): as marcas são texto enviado e entram na contagem. O chat (#151) deve reaproveitar essas duas funções.
- **Uma decisão por execução.** `selection.start` carrega as marcas uma vez e guarda em `selection_runs.energy_marks` se a execução as usou. Refazer Janelas e o resumo seguem esse sinalizador: refazer uma execução sem energia depois que a medida ficou pronta continua sem marcas, para o texto enviado bater com o planejado e estimado. O resumo (`summary.energy`, também em `selection.estimate`) traz `{measured: false}` ou `{measured: true, high, peak}`, e a UI mostra uma linha dizendo qual dos dois ocorreu.
- **Prompt v2.** `prompt.md` explica que `[energia …]` é um sinal de áudio relativo à Fonte, entra no eixo `energy` e não decide sozinho; `version` 2 e entrada nova em `prompt-lock.json`.
- **Testes.** Áudio sempre sintético (tom com trechos altos e baixos gerado por código ou pelo FFmpeg), nunca o dataset #28. `core/tests/energy.rs` roda o job completo com um FFmpeg falso que entrega PCM sintético e, se `ffmpeg` e `ffprobe` estiverem no PATH, com o FFmpeg de verdade (o CI não instala FFmpeg, então ali só a parte falsa roda). Futuro, fora da v1: detector de eventos sonoros (risada, aplauso) como segundo sinal; checar a licença dos pesos pela política do ADR-0003.

## Testes

Unitários em `core/src/selection/cut.rs` e `core/src/selection/tests.rs`; headless em `core/tests/selection.rs` (Provedor falso na fila, sem rede, `CLIPES_DATA_DIR` isolado): bordas, faixa (curto estendido, longo encurtado, impossível descartado), duplicatas, ordem, Janela vazia, falha isolada e refeita, retomada sem repetir Janela concluída, bloqueio por contexto, pausa por orçamento do lote, cancelamento, `context_truncated`, confirmação de Provedor pago e veto "somente local". A UI está em `src/features/projects/Selection.tsx`, coberta por `bun run test:ui`.

## Revisão dos candidatos (#55)

`core/src/selection/review.rs` (migração `0055_001_selection_review`) guarda as decisões **só no Projeto**: `selection_decisions` tem a execução, a identidade do candidato, a decisão (`approved`, `rejected`, `adjusted`), as bordas (IDs de Frase) antes e depois e a data. Nada é calibrado, enviado ou lido para decidir: o núcleo só devolve o estado. O candidato do #53 não é alterado; a situação atual é a última decisão sobre ele.

- `selection.review {run}`: por candidato (na ordem da Nota), `status` (`pending`, `approved`, `rejected`), bordas atuais, trecho de cada borda, `adjusted` e `moves` (quais movimentos de uma Frase cabem na faixa). `canUndo` diz se há decisão a desfazer.
- `selection.decide {candidate, decision}`: `approved` ou `rejected`. Repetir a decisão vigente não grava nada.
- `selection.adjust {candidate, edge: "start"|"end", delta}`: move a borda `delta` Frases inteiras (negativo = mais cedo) para estender ou encurtar. O núcleo calcula os tempos pelos IDs de Frase e confere a faixa de duração **da própria execução** (`min_us`/`max_us`); fora dela, erro fixo (`adjust_out_of_transcript`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`) sem gravar. Ajustar não muda a situação aprovada ou rejeitada. Soltar o encaixe de Frase é do editor.
- `selection.undo {run}`: apaga a última decisão da execução, inclusive as de uma sessão anterior.

**Identidade do candidato.** Quando uma Janela é refeita, o #53 regrava os candidatos da execução e os `id` mudam. A decisão guarda por isso `(execução, Frase inicial, Frase final)` do candidato como foi proposto, e a leitura casa as duas coisas: decisões seguem o candidato regravado com as mesmas bordas. Uma nova execução (`selection.start`) é outra `run_id` e **não toca nas decisões da anterior**; decisões de candidatos que deixaram de existir ficam guardadas, sem aparecer.

**Tela** (`src/features/projects/CandidateReview.tsx`, Foco): lista pela Nota com a situação de cada candidato, detalhe com eixos, justificativas, pesos e total, botões de borda e Aprovar/Rejeitar. Atalhos, mostrados na própria tela (PT/EN), valem com a revisão em foco e fora de campos de texto: `↑`/`↓` navegam, `A` aprova, `R` rejeita, `[` `]` movem o começo, `{` `}` movem o fim, `Ctrl+Z` desfaz a última decisão. Dentro da revisão `[`/`]` não abrem as gavetas globais, e `Ctrl+Z` só vale ali; o F2 e o Ctrl+Z/Ctrl+Y da Transcrição (#52) continuam na Transcrição. O botão "Abrir preview" é o ponto de encaixe do preview do Corte (#58): desabilitado até ele entrar (`onOpenPreview`). Testes: `core/tests/selection_review.rs` (headless) e a seção "Revisão dos candidatos" de `bun run test:ui`, em PT e EN, com capturas em `shots/`.

## Refazer com outro perfil (#126)

`selection.redo {run, windows, profileId}` refaz Janelas, mesmo concluídas, com outro Perfil de Provedor escolhido pelo usuário, e os candidatos novos entram como uma nova revisão da execução. Veja [Refazer com outro perfil](refazer-com-outro-perfil.md).
