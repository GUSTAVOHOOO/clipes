# Export de Corte com legenda karaokê

O export é local: não resolve Perfis de Provedor, não chama modelos nem rede e
continua disponível em Projeto com veto **Somente local**. Usa sempre a **Fonte
original**, sua faixa de áudio selecionada e o texto de
`corrections::EFFECTIVE_TEXT`, inclusive correções feitas enquanto o job esperava.
Nenhum proxy do preview participa do render (ADR-0002 e resolução do #15).

## Contrato do núcleo

`export::ExportRequest {source_id,start_id,end_id,candidate_id?}` é a fronteira
para o futuro documento Corte. O tipo TypeScript correspondente é exportado de
`src/lib/core.ts`. `export.start` recebe esses campos mais `output`, separado da
descrição do Corte:

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
`export_glyph_missing` (informa a palavra sem glifo da legenda, o codepoint e a
Frase, validado no `cmap` antes de chamar o FFmpeg), `export_failed`,
`source_changed`, `component_missing` e `cancelled`.

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
4. `Encoder` / `SelectedEncoder`: `libx264`, preset `fast`, CRF 20, yuv420p, sem marca d'água, ou o encoder de hardware escolhido (seção abaixo).

Para adicionar uma etapa, implemente `Stage` e insira-a na composição de
`standard()`. `export_pipeline` prova que uma etapa adicional entra entre vídeo
e legenda sem alterar nenhuma das etapas existentes.

| Trabalho futuro | Encaixe |
| --- | --- |
| Encoder de hardware | Feito no #62: `SelectedEncoder` substitui `Encoder`, mantendo o plano/runner. |
| Crop/reenquadramento (#61) | Etapa de vídeo antes de `Subtitle`, produzindo o canvas final 1080×1920. |
| Loudness (#63) | Feito: etapa `Loudness`, última do áudio. As etapas de áudio futuras entram antes dela. |
| Silêncios (#82) | Etapa de montagem anterior ao plano audiovisual; deve fornecer **um mapa de tempos compartilhado por vídeo, legenda e áudio**. Não basta acrescentar um filtro só de áudio. |
| Narração/ducking (#82) | Etapa de áudio com novos inputs e grafo de mixagem; ampliar o plano para inputs/labels e manter o runner gerenciado. |

Essas funcionalidades não são implementadas neste ticket. Uma extensão que
precise de grafo com várias entradas amplia o plano tipado; texto da Transcrição
jamais vira filtro, argumento de processo ou caminho.

## Encoder do export (#62)

`export/encoder.rs` detecta, guarda e troca o encoder H.264 (ADR-0004). A ordem é
`h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_videotoolbox` e, por fim, `libx264`, o fallback garantido.

- **Detecção:** `ffmpeg -hide_banner -encoders` lista os candidatos presentes; cada um faz um
  export real de 1 s (`testsrc2` 1080×1920 a 30 fps, com os mesmos argumentos de qualidade do
  export) num diretório temporário e o ffprobe confere `h264,1080,1920`. Quem passa entra na lista;
  o x264 também é testado e sempre fecha a lista. O primeiro da lista é o escolhido. Cada processo
  tem limite de tempo e respeita o `CancelToken`.
- **Cache:** `export-encoder.json` na pasta de dados do app (`CLIPES_DATA_DIR`), nunca no Projeto:
  versão do FFmpeg, nome e driver da GPU (só NVIDIA tem driver legível; AMD e Intel só mudam o
  cache pela versão do FFmpeg), lista aprovada, encoder escolhido, troca manual e data. Uma versão
  de FFmpeg ou driver diferente invalida o cache; o próximo export (ou "detectar de novo") refaz o teste.
- **Quando roda:** na primeira execução de um export (dentro do job, que já é cancelável) e quando
  o cache invalida. Sem conseguir detectar, o export usa o x264 sem erro.
- **Qualidade:** os argumentos de cada encoder são constantes nomeadas e comentadas em
  `encoder.rs`, mirando o ponto do x264 (CRF 20, preset `fast`), que fica exatamente como no #59.
- **Fallback:** se o encoder escolhido falhar no export (`export_failed`), o job repete a etapa
  com x264, tira o encoder da lista (o próximo export não repete a falha nem avisa de novo) e grava
  em `exports` (migração `0062_001_export_encoder`) `encoder`, `fallback_from` e
  `fallback_reason = "encoder_failed"`. Nunca se guarda stderr nem caminhos (ADR-0006).
  `export.status` devolve `encoder` e `encoder_fallback {from,reason}`; a UI avisa uma vez.
  Cancelamento e erros de entrada não disparam fallback.
- **Comandos:** `export.encoder.status` (cache, sem testar nada), `export.encoder.detect`
  (detectar de novo, mantém a troca manual se o encoder ainda passa) e
  `export.encoder.set {encoder}` (`null` volta ao automático; fora da lista: `encoder_invalid`).
  Preferências tem o seletor e o botão "Detectar de novo".
- **Testes:** `core/tests/export_encoder.rs` usa o FFmpeg falso `fake-encoders` (lista de encoders e
  falhas por variável de ambiente); `core/tests/export_encoder_real.rs` usa o FFmpeg do sistema e
  pula sem encoder de hardware (`cargo test --test export_encoder_real -- --nocapture` mostra o
  encoder escolhido e os tempos de um export de 30 s).

## Loudness do export (#63)

O áudio sai a **-14 LUFS integrado, true peak ≤ -1 dBTP e LRA 11 LU** (constantes `TARGET_*` em
`export/pipeline.rs`), com `loudnorm` em duas passagens e saída fixa em 48 kHz.

- **Ordem do áudio** (spec): limpeza da Narração → ducking → trilha → `amix` com `normalize=0` →
  `loudnorm`. Hoje só existe o áudio da Fonte (`Audio`); a etapa `Loudness` é a última e as etapas
  futuras (#82, #154, #155) entram **antes** dela em `with_loudness`.
- **Passagem 1** (`render::measure_loudness`): mede só o trecho do Corte com
  `loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, sem gravar arquivo (`-vn -f null -`). O `-t` vai
  **antes de `-i`**: como opção de saída, o `loudnorm` ainda mede áudio depois do Corte. Do stderr
  só se leem os cinco campos numéricos do JSON (`input_i`, `input_tp`, `input_lra`,
  `input_thresh`, `target_offset`); o stderr nunca é guardado (ADR-0006).
- **Passagem 2**: `loudnorm` com `measured_*`, `offset` e `linear=true`, seguido de
  `aresample=48000` (o `loudnorm` reamostra internamente), antes do AAC.
- **Áudio mudo** (medição `-inf`): não há o que normalizar; o export segue sem `loudnorm`. Falta
  total do JSON é `export_failed`.
- **Progresso**: a passagem 1 ocupa 1–10% da barra e a renderização 10–95%; cancelar vale nas duas.
- **Harness**: `core/tests/export_loudness.rs` gera áudio sintético (`sine` + `anoisesrc`, trecho
  baixo e trecho alto), exporta dois Cortes e mede o MP4 com `ebur128`: I = -14 ± 1 LU e
  true peak ≤ -1 dBTP (+0,1 dB de tolerância).

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

Texto de Transcrição é não confiável. `{`, `}` e `\` recebem equivalentes ASCII
seguros presentes nas fontes empacotadas (`(`, `)` e `/`); controles, quebras e
escapes de entrada não viram tags. Emoji e seletores de apresentação são removidos
antes da quebra. A cobertura de glifos das palavras visíveis é validada contra o
`cmap` das fontes empacotadas antes de chamar o FFmpeg.
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
sobrescrita. Use um Projeto sem outras tarefas enfileiradas e não o deixe aberto
no app ao rodar o exemplo. Se a
sincronia reprovar, abrir issue de alinhamento com o relatório
`docs/research/2026-11-14-bordas-mfa.md` e o kit do #102.
