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

Tabela única `cut::AXES` (chave e peso em pontos percentuais); a Nota total é a média ponderada `Σ peso × nota`, calculada em centésimos (`total_centi`, de 0 a 1000) para a comparação ser exata. **Sem curva.** Pesos da v1, decisão do dev em 15/11/2026: Gancho (`hook`) 0,30; Autossuficiência (`selfContained`) 0,20; Emoção/energia (`energy`) 0,20; Valor (`value`) 0,15; Fechamento (`closing`) 0,15. O #57 pode comparar outras distribuições. O 6º eixo (Espaço para comentário, do Vídeo transformado) não entra aqui; a tabela é extensível, mas o schema (`wire.json`, `full.json`) e o prompt também precisam ganhar o eixo, com `version` nova e entrada na trava. Um teste confere que os eixos do schema seguem a tabela e que os pesos somam 100. Cada candidato e cada execução devolvem os pesos usados.

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
