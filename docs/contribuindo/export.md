# Export de Corte com legenda karaokê

O export é local: não resolve Perfis de Provedor, não chama modelos nem rede e
continua disponível em Projeto com veto **Somente local**. Usa sempre a **Fonte
original**, sua faixa de áudio selecionada e o texto de
`corrections::EFFECTIVE_TEXT`, inclusive correções feitas enquanto o job esperava.
Nenhum proxy do preview participa do render (ADR-0002 e resolução do #15).

## Contrato do núcleo

`export::ExportRequest` é a fronteira para o futuro documento Corte:

```json
{"source_id":1,"start_id":10,"end_id":14,"candidate_id":3,"output":"D:/exports/corte.mp4"}
```

`candidate_id` é opcional. Quando informado, o candidato precisa estar aprovado,
pertencer à Transcrição da Fonte/faixa selecionada e ter exatamente as bordas
atuais da revisão (#55). Os IDs são de Frase, nunca tempos escolhidos pela UI.
Sem candidato, o núcleo também exige Frases válidas de uma Transcrição completa.
O mesmo `dispatch` atende Tauri, testes e o exemplo headless.

- `export.start`: valida a entrada e o destino; grava `jobs` e `exports` na mesma
  transação (`projects::with_writer`, migração `0059_001_exports`), retorna
  `{job,state:"queued"}`. Tipo `export`, segurança `local` na fila do #44.
- `export.status {job}`: estado, progresso, destino e erro tipado persistido.
- `export.captions {source_id,start_id,end_id,candidate_id?}`: ASS e `lines`
  (`CaptionWord[][]` com texto seguro e µs relativos ao Corte), além das bordas
  absolutas; o preview pode reutilizar a mesma preparação/quebra, sem duplicá-la.
- `export.settings`: última pasta de saída válida, em preferência local fora do
  Projeto e isolada por `CLIPES_DATA_DIR`. A UI inicia nela o diálogo Salvar MP4.
- Progresso: `ProgressEvent` global com Projeto, job, etapa `export` e porcentagem;
  `jobs.list` recupera o estado. `jobs.cancel {id}` aciona o mesmo `CancelToken`
  usado pelo processo gerenciado e encerra também seus descendentes.

Se a Fonte mudou ou ficou offline, o export é bloqueado. A fila verifica de novo
Fonte, bordas, revisão e texto ao começar. Uma interrupção do app recoloca o job
local na fila; ele refaz o render inteiro. Não reaproveita MP4 parcial.

O destino deve ser um caminho absoluto `.mp4` em pasta existente. O diálogo do
sistema pode avisar sobre arquivo existente, mas **o núcleo sempre recusa
sobrescrita**, inclusive se outro processo criou o arquivo durante o render.
Um temporário exclusivo na mesma pasta só é publicado depois do sucesso de
FFmpeg/libass; falha, cancelamento e encerramento normal removem os temporários.
Erros usam códigos/mensagens fixos, sem stderr, Transcrição ou caminhos pessoais
(ADR-0006): `export_bounds`, `export_candidate`, `export_destination`,
`export_exists`, `export_timestamps`, `export_ass_missing`, `export_font_missing`,
`export_failed`, `source_changed`, `component_missing` e `cancelled`.

## Etapas e pontos de extensão

`export/pipeline.rs` contém `Stage::apply(&mut ExportPlan)`. Uma etapa só compõe o
plano: filtros de vídeo, filtros de áudio, encoder e argumentos. A execução e o
cancelamento ficam em `export/render.rs`. A ordem padrão é:

1. `Video`: Fit 1080×1920 com barras pretas, considerando DAR/SAR e a rotação da
   matriz de exibição aplicada pelo decoder, com SAR de saída 1:1.
2. `Subtitle`: libass sobre o vídeo final; nomes relativos fixos
   `captions.ass` e `fonts` num diretório privado, sem interpolar caminhos de
   usuário em filtergraphs.
3. `Audio`: passagem da faixa selecionada; AAC no contêiner MP4.
4. `Encoder`: `libx264`, preset `fast`, CRF 20, yuv420p, sem marca d'água.

Para adicionar uma etapa, implemente `Stage` e insira-a na composição de
`standard()`. `export_pipeline` prova que uma etapa adicional entra entre vídeo
e legenda sem alterar nenhuma das etapas existentes.

| Trabalho futuro | Encaixe |
| --- | --- |
| Encoder de hardware | Outra etapa de encoder substitui `Encoder`, mantendo o plano/runner. |
| Crop/reenquadramento (#61) | Etapa de vídeo antes de `Subtitle`, produzindo o canvas final 1080×1920. |
| Loudness (#63) | Etapa que acrescenta filtros de áudio antes do encode. |
| Silêncios (#82) | Etapa de montagem anterior ao plano audiovisual; deve fornecer **um mapa de tempos compartilhado por vídeo, legenda e áudio**. Não basta acrescentar um filtro só de áudio. |
| Narração/ducking (#82) | Etapa de áudio com novos inputs e grafo de mixagem; ampliar o plano para inputs/labels e manter o runner gerenciado. |

Essas funcionalidades não são implementadas neste ticket. Uma extensão que
precise de grafo com várias entradas amplia o plano tipado; texto da Transcrição
jamais vira filtro, argumento de processo ou caminho.

## ASS e fonte

`captions::sanitize`, `layout` e `ass` são funções puras. As constantes de duração,
largura e quantidade de palavras/linhas estão no mesmo módulo. O sanitizador
garante tokens com pelo menos 10 ms, em ordem e sem sobreposição. Tempos válidos
ficam intactos. Conforme decisão do coordenador (`msg_5ea7f4161de8`), palavras
sobrepostas, invertidas ou próximas demais para esse mínimo são **agrupadas** num
único token com todo o texto, separado por espaço, cobrindo a união dos tempos;
nunca se perde palavra. Uma palavra invertida isolada recebe duração mínima.

O ASS exige centésimos de segundo: os limites nativos são quantizados nessa
unidade para `\kf`, sem MFA, outro alinhamento ou deslocamento fixo (#102).
Pausas usam sílabas invisíveis `\k` e não alongam artificialmente o destaque.
`PlayResX/Y` são 1080/1920, `ScaledBorderAndShadow: yes`, `WrapStyle: 2`;
as quebras explícitas `\N` vêm exclusivamente de `layout`.

Texto de Transcrição é não confiável. `{`, `}` e `\` recebem equivalentes visuais
Unicode sem semântica ASS (`｛`, `｝`, `＼`); controles, quebras e escapes de entrada
não viram tags. Emoji e seletores de apresentação são removidos antes da quebra.
A fonte Noto Sans Bold está empacotada com licença OFL 1.1 e hash fixado em
`THIRD_PARTY_NOTICES.md`. O núcleo entrega os bytes por `fontsdir` e verifica o
carregamento/seleção da família pelo libass. Fallback vira erro tipado. Antes do
render, `ffmpeg -h filter=ass` precisa declarar o filtro e `fontsdir`; exit code
zero sozinho não prova suporte. FFmpeg continua separado e sob demanda (ADR-0003).

## Harness de paridade e CI

```powershell
$env:CARGO_BUILD_JOBS='2'
cargo test -p clipes-core --test export --test export_captions --test export_pipeline --test export_render
cargo test -p clipes-core --test export_parity -- --nocapture
```

O harness real requer `ffmpeg` e `ffprobe` no PATH (ou `CLIPES_TEST_FFMPEG` e
`CLIPES_TEST_FFPROBE`). Gera `testsrc2`/`sine` no diretório temporário: CFR, VFR
confirmado pelos PTS, SAR 2:1 e rotação por display matrix confirmados por
`ffprobe`. Confere dimensões, codec, SAR, áudio selecionado por frequência e
quadros em tempos conhecidos contra uma referência independente de Fit. Mede
erro médio dos pixels do fundo e presença de branco/amarelo na legenda antes,
durante e depois de cada palavra/pausa. O hash da fonte e um controle negativo
com família inexistente detectam troca silenciosa de fonte.

O CI instala o pacote `ffmpeg` do Ubuntu junto aos pré-requisitos já existentes e
o `ffmpeg` do Chocolatey no Windows. Ambos fornecem x264/libass. O teste roda no
`cargo test --workspace` normal, sem download feito pelo teste, sem mídia de
terceiros nem chamadas de Provedor. A etapa de instalação é só do runner; não
empacota FFmpeg no aplicativo. No FFmpeg 8, gerar o fixture com
`-metadata:s:v rotate=90` pode não produzir display matrix; usa-se
`-display_rotation 90` antes do input, com verificação posterior.

## Conferência humana obrigatória (#102)

O PR usa **Refs #59**. A issue só pode fechar depois de o dev assistir a pelo menos
cinco Cortes com fala em português **e** inglês e confirmar que o destaque parece
sincronizado. O harness sintético não substitui essa escuta.

Com uma Fonte local já importada e transcrita no Projeto, exporte N trechos
consecutivos de pelo menos 20 s, sempre com bordas de Frase:

```powershell
$env:CARGO_BUILD_JOBS='2'
cargo run -p clipes-core --example review_exports -- 'D:/Canal.clipes' 1 'D:/conferencia/pt' 3
cargo run -p clipes-core --example review_exports -- 'D:/Canal.clipes' 2 'D:/conferencia/en' 2
# Argumento opcional final: caminho do ffmpeg (com ffprobe ao lado).
```

Os IDs são os de `sources.list`. O exemplo isola automaticamente seu índice e
preferências com `CLIPES_DATA_DIR` temporário, usa o Projeto informado e a mesma
fila/dispatch do app. Não baixa nem transcreve nada, não pede chave e recusa
sobrescrita. Não deixe o mesmo Projeto aberto no app ao rodar o exemplo. Se a
sincronia reprovar, abrir issue de alinhamento com o relatório
`docs/research/2026-11-14-bordas-mfa.md` e o kit do #102.
