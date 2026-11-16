# Bordas do Corte (#70)

Plano e contrato aprovados pelo coordenador: documento JSON com `schemaVersion`
e `revision`, identidade pelo candidato (ou par original Fonte + Frases quando
não há candidato), intervalo em µs e IDs de Frase, histórico por Corte limitado
a 100 passos e 20 snapshots. O documento mantém o pedido original para rastrear
a origem. O export recebe `clip_id` e continua exigindo um candidato aprovado.

- [ ] Harness headless: encaixe, quadro com Alt, limites da Fonte e duração,
  quatro ações ±1 Frase, arrasto agrupado, isolamento e persistência do histórico.
- [ ] Núcleo: comandos `editor.adjust`, `editor.undo`, `editor.redo`,
  `editor.flush`, `editor.snapshots`; migração `0070_001_clip_edits`.
- [ ] Autosave no núcleo: debounce de 1 s, escrita por `projects::with_writer`,
  flush antes de fechar/trocar/restaurar Projeto. Reusar os backups do #37.
- [ ] UI Foco: alças acessíveis, quadro da borda no CutPreview, botões e atalhos
  Alt+Shift+←/→ para entrada e Alt+Shift+↑/↓ para saída; Ctrl+Z e
  Ctrl+Shift+Z/Ctrl+Y para histórico, sem capturar campos de texto.
- [ ] Teste de arrasto na UI, verificações locais equivalentes ao CI, PR draft
  com DCO, CI verde, retirar do draft e limpar artefatos próprios.

O arrasto usa prévias sem mutação e confirma uma única edição no pointerup.
O cálculo de encaixe e validação pertence ao núcleo; Alt arredonda para o
quadro da Fonte. Sem Alt, a borda mais próxima dentre inícios e fins de Frase
vence (em empate, a anterior). Os limites de duração do #61 continuam valendo.
