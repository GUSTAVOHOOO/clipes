# Bordas do Corte (#70)

Plano e contrato aprovados pelo coordenador: documento JSON com `schemaVersion`
e `revision`, identidade pelo candidato (ou par original Fonte + Frases quando
não há candidato), intervalo em µs e IDs de Frase, histórico por Corte limitado
a 100 passos e 20 snapshots. O documento mantém o pedido original para rastrear
a origem. O export recebe `clip_id` e continua exigindo um candidato aprovado.

- [x] Harness headless: encaixe, quadro com Alt, limites da Fonte e duração,
  quatro ações ±1 Frase, arrasto agrupado, isolamento e persistência do histórico.
- [x] Núcleo: comandos `editor.adjust`, `editor.undo`, `editor.redo`,
  `editor.flush`, `editor.snapshots`; migração `0070_001_clip_edits`.
- [x] Autosave no núcleo: debounce de 1 s, escrita por `projects::with_writer`,
  flush antes de fechar/trocar/restaurar Projeto. Reusar os backups do #37.
- [x] UI Foco: alças acessíveis, quadro da borda no CutPreview, botões e atalhos
  Alt+Shift+←/→ para entrada e Alt+Shift+↑/↓ para saída; Ctrl+Z e
  Ctrl+Shift+Z/Ctrl+Y para histórico, sem capturar campos de texto.
- [ ] Teste de arrasto na UI, verificações locais equivalentes ao CI, PR draft
  com DCO, CI verde, retirar do draft e limpar artefatos próprios.

O arrasto usa prévias sem mutação e confirma uma única edição no pointerup.
O cálculo de encaixe e validação pertence ao núcleo; Alt arredonda para o
quadro da Fonte. Sem Alt, a borda mais próxima dentre inícios e fins de Frase
vence (em empate, a anterior). Os limites de duração do #61 continuam valendo.

`editor.open` mantém a entrada do #61 e acrescenta `clipId`, `revision`,
`undoCount` e `redoCount` na resposta. `editor.adjust` recebe `clip_id`,
`edge` (`start`/`end`) e uma das entradas `time_us`, `sentence_id` ou
`sentence_delta` (`-1`/`1`). `free: true` quantiza por quadro; `preview: true`
calcula sem alterar histórico nem disparar autosave. Sair da primeira/última
Frase com `sentence_delta` mantém o Corte. Duração inválida gera erro tipado
e preserva o intervalo anterior.

O documento contém `original` (Fonte/candidato e Frases originais), `range`
(`startId`, `endId`, `startUs`, `endUs`), `undo` e `redo`. Uma edição nova limpa
`redo`; o total de estados do histórico nunca passa de 100. Os snapshots são
os 20 documentos salvos mais recentes, em ordem decrescente, devolvidos por
`editor.snapshots {clip_id}`. Não são backups adicionais do Projeto inteiro.

O estado pendente fica no núcleo. Troca e restauração de Projeto limpam o cache
somente depois do flush; uma falha de escrita mantém o documento em memória e
impede fechar. `editor_saved` e `editor_save_failed` usam `ProgressEvent` no
emissor global. O fechamento da janela Tauri também faz flush, antes de sair.

O export com `clip_id` verifica o vínculo à Fonte/candidato aprovado, resolve o
documento e congela o intervalo no job. Edições posteriores não mudam esse job.
Palavras que atravessam a borda são aparadas ao intervalo; texto corrigido
continua vindo de `corrections::EFFECTIVE_TEXT`.

Testes focados: `cargo test -p clipes-core --test editor_edits --test
editor_lifecycle --test export` e `node scripts/editor-borders.mjs`. O teste de
UI gera vídeo sintético com FFmpeg fora do repo, serve-o com Range e compara
o quadro decodificado pelo navegador com a borda durante o arrasto. A mídia
é apagada no `finally`; nenhum teste usa rede externa.
