# Texto e estilo da legenda (#65)

**Objetivo:** editar palavras e estilos preservando a paridade CSS/libass.

**Arquitetura aprovada pelo coordenador:** documento por `clip_id` do #70, com
`schemaVersion` e `revision`; padrão do Projeto copiado ao abrir um Corte novo.
Overrides globais por `(transcript_id, position)`, separados do preset; texto
continua em `corrected_text`. Fontes Noto Sans Bold e Noto Serif Bold OFL.

## Restrições

- Só este worktree/branch; commits DCO; sem testes de rede.
- SQLite só por `projects::with_writer`, migração `0065_001_caption_styles`.
- Sem GSAP, brilho, caixa arredondada ou animações além de karaokê e fade.
- `CARGO_BUILD_JOBS=2`; dados headless isolados com `CLIPES_DATA_DIR`.
- Integração com #70 somente depois do merge em master.

## Execução inline

- [ ] Núcleo puro em `core/src/caption_style.rs` e `core/src/caption_style/layout.rs`:
  validação de estilos, presets vertical/cinema/simples, quebras únicas e ASS.
  Testar limites, texto hostil, cores, fade e overrides em `core/tests/caption_style.rs`.
  Executar `cargo test -p clipes-core --test caption_style`, verificar falha antes
  da implementação, implementar e repetir; commit assinado.
- [ ] Persistência em `core/src/caption_style/store.rs`: comandos inventory,
  revision otimista, padrão de Projeto, overrides e remapeamento por texto
  normalizado/início ±300 ms único. Integrar em `transcription.rs` e `export.rs`.
  Testes headless cobrem reabertura, independência entre Cortes, correções,
  troca de preset e remapeamento ambíguo; commit assinado.
- [ ] UI em `src/features/captions/`: gaveta Foco, edição por palavra e estilo,
  aviso de emoji, preview CSS usando os cues preparados pelo núcleo e os mesmos
  arquivos de fonte. Conectar ao `clip_id` no editor após merge de master.
  Testar interações e persistência em `scripts/ui.mjs`; commit assinado.
- [ ] Paridade: estender `export_parity` para todos os presets com lavfi e
  comparar o estado temporal/geométrico do preview CSS com quadros libass.
  Executar fmt, workspace, clippy, typecheck, build, contrast e UI.
- [ ] Atualizar PR draft com decisões/evidências, sincronizar master, aguardar
  CI verde e retirar draft. Limpar target e temporários próprios antes de reportar.
