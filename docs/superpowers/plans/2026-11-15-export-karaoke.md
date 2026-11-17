# Export karaokê (#59)

Desenho aprovado pelo coordenador em `msg_5ea7f4161de8`.

**Objetivo:** exportar a Fonte original, com bordas em Frase e texto efetivo da
Transcrição, em MP4 x264 Fit 1080×1920 com ASS/libass e áudio selecionado.

**Contrato:** `ExportRequest {source_id, start_id, end_id, candidate_id?}`;
`export.start` recebe também `output`, separado do Corte (contrato com #61).
Se houver candidato, a revisão precisa estar aprovada e as bordas atuais precisam
coincidir. Nenhum Provedor participa: a tarefa é local e respeita o veto local.
Tempos impossíveis são agrupados, preservando texto; tempos válidos não recebem
alinhamento extra nem deslocamento. O sanitizador e a quebra são funções únicas.

## Execução nesta sessão (sem subagentes)

- [ ] ASS puro (`core/src/export/captions.rs`, `core/tests/export_captions.rs`):
  testes primeiro para tempos válidos, sobreposição, inversão, mínimo 10 ms,
  injeção ASS, emoji, quebra e pausas; rodar `cargo test -p clipes-core --test export_captions`.
- [ ] Pipeline (`core/src/export/pipeline.rs`, `core/tests/export_pipeline.rs`):
  teste de inserção de etapa antes de implementar; vídeo, legenda, áudio e encoder
  compõem um plano; nenhuma etapa futura implementada.
- [ ] Job/dispatch (`core/src/export.rs`, `core/src/export/render.rs`,
  `core/tests/export.rs`): validar bordas/aprovação/texto corrigido, gravar job
  com migração `0059_001_exports`, usar CancelToken/processo gerenciado,
  publicar só o arquivo completo sem sobrescrever, apagar temporários em falha.
- [ ] Fonte OFL, harness real (`core/tests/export_parity.rs`) e instalação de
  FFmpeg com libass no CI: gerar testsrc2/sine, VFR/SAR/rotação, comparar pixels
  e quadros de referência, detectar fallback de fonte e tempos errados.
- [ ] UI Foco (`src/features/export/ExportButton.tsx`) com seletor Salvar,
  última pasta, nome sanitizado e ação disponível para candidato aprovado;
  testar seleção, erro tipado e estado da fila pelo mock headless da UI.
- [ ] Documentar encaixes em `docs/contribuindo/export.md` e fornecer example
  para o dev exportar N Cortes de Fonte local (PT e EN; revisão de 5 é humana).
- [ ] Commits DCO pequenos, draft cedo; rodar fmt, testes focados, clippy com
  um job, typecheck/build/UI. `cargo test --workspace` completo fica no CI,
  conforme a última regra do despacho. CI Ubuntu/Windows/licenças/DCO verde;
  tirar draft, manter `Refs #59` e não fechar a issue sem a revisão humana.
