# Montagem do Vídeo transformado (#204)

Define onde cada bloco da **Narração** entra no vídeo final, como os blocos interagem com
as bordas do **Corte** (#70) e cortes de **silêncios** (#77), e qual é a duração final com
congelamento de cauda (`tpad`).

## Regras fechadas (decisão de 16/11/2026)

1. **Voice-over (1A):** a Narração toca por cima do Corte em execução contínua (o ducking da
   Fonte entra no #82).
2. **Ancorado na Frase (2B):** cada bloco começa na 1ª Frase mantida de suas `refs` (do
   Roteiro, #73), remapeada pelo `SpliceMap` dos silêncios ativos. Se a borda do Corte
   recortou a 1ª Frase de `refs`, recua para a próxima Frase mantida; se nenhuma restou no
   Corte, emite `anchor_outside_clip`. Blocos sem `refs` entram em `0` (se o primeiro) ou
   após o bloco anterior com respiro de [`BLOCK_GAP_US`](../../core/src/montage.rs) (300 ms).
3. **Empurra e congela o fim (3A):** se um bloco colidir com o anterior, é empurrado adiante
   mantendo `BLOCK_GAP_US` (zero sobreposição) e emite `block_pushed`. Só a sobra do último
   bloco após `clip_duration_us` vira `freeze_tail_us` (congelamento do último quadro por
   `tpad`), emitindo `freeze_tail` (ou `long_freeze_tail` acima de `LONG_FREEZE_TAIL_US`, 5 s).
4. **Automático + arrasto (4B):** a posição automática é o padrão; o usuário pode arrastar o
   início de qualquer bloco na timeline do editor (encaixe em Frase, `Alt` livre por quadro,
   sem sobrepor o anterior) e voltar ao automático sem invalidar a aprovação do Roteiro (#73)
   nem regerar áudio (#79) ou alinhamento (#81).

## Duração estimada vs. real (#79)

Enquanto o #79 (TTS) não grava a duração real por `script_blocks.id`, o núcleo estima a
duração por caracteres em `montage::estimate_block_duration_us`:

- `ESTIMATED_CHARS_PER_SECOND = 15` (~150 palavras/min)
- `MIN_ESTIMATED_BLOCK_US = 500_000` (500 ms para texto não vazio; `0` para vazio)

Quando o #79/#83/#84 existirem, basta passar o mapa `block_id -> duration_us` real para
`montage::plan_for_clip` (ou diretamente para `montage::resolve`).

## Contrato para #79, #80, #81 e #82

Em `core/src/montage.rs`:

- `montage::resolve(&MontageInput) -> Result<MontagePlan, CoreError>`: função pura (sem banco
  nem I/O) que resolve `start_us`, `end_us`, `pushed_us`, `overflow_us`, `freeze_tail_us`,
  `total_duration_us` e `warnings` em µs do vídeo final.
- `montage::plan_for_clip(clip_id, candidate_id, &durations_by_block) -> Result<Option<MontagePlan>, CoreError>`:
  lê o documento `clip_edits` (bordas, silêncios e `narrationStarts`) + os blocos atuais do
  Roteiro e devolve o `MontagePlan`.
- `montage::audio_mix_plan(&MontagePlan) -> AudioMixPlan`: devolve apenas os segmentos
  `{ block_id, start_us, end_us, duration_us }`, `clip_duration_us`, `freeze_tail_us` e
  `total_duration_us` para consumo direto do #82 (`sidechaincompress`, `amix normalize=0` e
  `tpad`/`apad` final no export), #80 (capítulos usando `start_us` e `total_duration_us`) e
  #81 (somar `start_us` às palavras alinhadas em `0..duration_us`).

## Persistência e comandos do editor

Os inícios manuais ficam em `clip_edits.document` no campo opcional `narrationStarts`
(`BTreeMap<i64, i64>`, µs da Fonte) sem elevar `schemaVersion` (mantido em 2), e participam
do histórico de desfazer/refazer (`EditSnapshot.narration_starts`).

- `editor.montage.get { clip_id }`
- `editor.montage.set_start { clip_id, block_id, time_us?, free?, preview? }` (`time_us: null`
  ou omitido volta o bloco ao modo automático)
- `editor.open`, `editor.adjust`, `editor.silences.*`, `editor.undo` e `editor.redo` já
  devolvem o campo `montage` atualizado (`null` quando o Corte não tem Roteiro do Vídeo
  transformado).

Testes: `core/tests/montage.rs` e `scripts/editor-montage.mjs`.
