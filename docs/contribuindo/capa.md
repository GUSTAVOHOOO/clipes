# Ideia de thumbnail e capa (#74)

A Tarefa de IA `thumbnail` (`core/src/thumbnail.rs`, prompt `core/src/thumbnail/prompt.md`, travado em `prompt-lock.json`) sugere **um momento** do Corte aprovado para servir de capa. Segue o `packaging` (#68): uma chamada por Corte, na fila (#121), com custo, confirmação de Provedor pago, orçamento, auditoria e o veto "somente local". Para rota e veto, `ai_task::routing_id("thumbnail")` vale como `packaging`: não há linha própria na tabela "Tarefas".

- **O Provedor só recebe texto.** A entrada é `#CAPA` mais as Frases do Corte no formato compacto (#140). Ele devolve `sentenceId` (o ID de uma Frase) e `why` (até 200 caracteres). Nunca recebe imagem, caminho, nome da Fonte ou do Projeto.
- **O núcleo converte o ID num instante**: o meio da Frase (`thumbnail::instant_of`), sempre dentro do Corte. Um ID que não é de uma Frase do Corte é rejeitado pelo verificador `sentence_outside_cut`; os outros códigos são `why_empty`, `why_too_long`, `forbidden_character` e `invented_url`.
- **O quadro é extraído localmente**, só na hora de exportar: `ffmpeg -ss <t> -i <Fonte> -map 0:v:0 -frames:v 1 -an -sn -c:v png`, com argumentos em lista, sem shell e sem filtros. A capa tem o tamanho nativo da Fonte, sem recorte e sem texto. Recorte vertical e texto na capa ficam fora deste ticket. O arquivo é escrito num temporário e publicado sem sobrescrever (`thumbnail_exists`). Fonte offline devolve `source_offline`; alterada, `source_changed`.
- **Persistência** (migração `0074_001_thumbnail`): `thumbnail_suggestions` guarda cada sugestão (Tarefa, versão, hash do prompt, perfil, ID da Frase, instante e justificativa) e `thumbnail_choices` é o histórico de escolhas; a última é a atual, de origem `provider` ou `user`. Sugerir de novo nunca apaga as anteriores.

## Decisões confirmadas pelo dev

- A capa segue a rota e o veto "somente local" do empacotamento (`routing_id` mapeia `thumbnail` para `packaging`).
- O export do PNG é síncrono, fora da fila de jobs.

## Comandos

- `thumbnail.estimate {candidate}`: se o Provedor é pago e o custo estimado. `thumbnail.suggest {candidate, confirmed?}`: enfileira a Tarefa; Provedor pago exige `confirmed` (`confirmation_required`).
- `thumbnail.get {candidate}`: escolha atual, limites do Corte (`cut`), último job, sugestões e histórico.
- `thumbnail.choose {candidate, instant_us}`: o usuário marca um instante do Corte (o do preview, `CutPreview`) como capa; fora do Corte, `instant_out_of_cut`.
- `thumbnail.export {candidate, output, instant_us?}`: grava o PNG em `output` (caminho do diálogo de salvar; `thumbnail_destination` se não for PNG absoluto em pasta existente).

O preview avisa o instante em que está pelo evento `clipes-preview-time`; a UI (`Thumbnail.tsx`) o usa no botão "Usar o instante do preview como capa". Testes: `core/tests/thumbnail.rs` (Provedor falso e vídeo sintético lavfi; ignorado sem `ffmpeg`/`ffprobe` no PATH) e `bun run test:ui`.
