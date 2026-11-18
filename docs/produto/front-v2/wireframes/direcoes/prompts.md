# Prompts das imagens de direção (rodada 1)

Cada bloco abaixo é UM prompt, a ser passado literalmente à ferramenta de geração de imagem, em paisagem (1536×1024 ou o formato paisagem mais próximo), qualidade alta. O nome do arquivo de saída está no título do bloco.

Telas: **editor** (sub-aba Editar do Corte, wireframe `D2-editar.html`, variante 1440) e **revisao** (Bancada de revisão de Cortes, wireframe `C2-revisao.html`, variante 1440).

---

## A-editor.png

A desktop app screen for Clipes, a free open-source app that turns long livestreams into vertical 9:16 Cortes with word-by-word captions. Windows app at 1440×900, rendered edge to edge with crisp readable Portuguese text, no browser window, no device, no desk.

The user is fine-tuning one Corte in the editor. Top bar: project "Canal Dark História", three stage tabs "1. Fontes e Transcrição", "2. Cortes · 8 aprovados" (current), "3. Exportação", a button "Fila · 2 ativos" and "Comandos Ctrl K". Below it the Corte header: "← Cortes", "Corte 2/8: Como o navegador bloqueou o vazamento", Anterior/Próximo, a tag "Vídeo transformado", tabs Editar (active) / Transformar / Empacotar, and a primary button "Exportar Corte  Ctrl E".

Three work areas plus a timeline: left, the Corte transcript with timestamps, the current word highlighted and a struck-through row "Silêncio · 2,8 s"; center, a 9:16 preview of a podcast guest speaking into a microphone with the caption "e foi EXATAMENTE ali que tudo mudou", transport controls and timecode 00:14,2 / 00:38,4; right, an Inspector with tabs Enquadramento, Legendas, Silêncios, Áudio, Histórico showing layout choices Rosto, Ajustar, Jogo+Câmera. Bottom: a timeline with five labelled tracks (Vídeo with thumbnails, Áudio with waveform and hatched silences, Frases, Narração blocks, Trilha/SFX) and a playhead. Status bar: "Salvo · Desfazer: 3 ações".

Visual law: a deep blue-black studio ground with charcoal panels and warm off-white text; a condensed broadcast grotesk for labels, figures and timecodes, a plain sans for transcript text. Colour works like studio tally lights: green means PRÉVIA (playing), red means NO AR (something exporting), amber means NA FILA. Signature: a thin lit tally bar on the top edge of whatever is live — the preview frame carries a green edge while playing, and the top bar shows a small red lamp "NO AR · 1 exportando".

## A-revisao.png

A desktop app screen for Clipes, a free open-source app that turns long livestreams into vertical 9:16 Cortes with word-by-word captions. Windows app at 1440×900, rendered edge to edge with crisp readable Portuguese text, no browser window, no device, no desk.

The user is reviewing Cortes the app suggested from a 3-hour podcast live, approving or rejecting each one by keyboard. Top bar: project "Canal de Cortes", stage tabs "1. Fontes e Transcrição", "2. Cortes" (current), "3. Exportação", "Fila · 1 ativo", "Comandos Ctrl K". Left column: a list of 12 suggested Cortes, each with start timecode (00:12:31), duration (0:48), title ("Ele contou como perdeu tudo em 2019") and a Nota (8,4 / 7,9 / 7,1 …); two rows marked Aprovado, one Rejeitado, one selected. Right: the selected Corte — a 9:16 preview with caption, its title, the Nota 8,4 explained on five named axes with short reasons (Gancho 30%, Autossuficiência 20%, Energia 20%, Valor 15%, Fechamento 15%), edge controls "−1 Frase / +1 Frase" for start and end, and buttons "Aprovar  A", "Rejeitar  R", "Abrir no editor". A small notice: "Revisão 2 de 2 · Perfil Groq".

Visual law: a deep blue-black studio ground with charcoal panels and warm off-white text; a condensed broadcast grotesk for labels, figures and timecodes, a plain sans for reading text. Colour works like studio tally lights: green means approved/PRÉVIA, red means NO AR (exporting), amber means NA FILA. Signature: a thin lit tally bar on the top edge of whatever is live — the selected Corte row and the playing preview carry a green edge.

## B-editor.png

(Mesmo texto de conteúdo de A-editor.png, do início até "Status bar: "Salvo · Desfazer: 3 ações".", trocando só o último parágrafo por este:)

Visual law: high-contrast panels — a near-black ground with crisp white type, a monospaced tabular voice for every number and timecode, and a single signal yellow reserved only for things that just changed. Signature: the Corte header is a segmented boarding-pass strip (Fonte · Entrada 00:14:31 · Saída 00:15:09 · Duração 0:38 · Nota 8,4) with tabular figures, and a value the user just edited (the new Entrada) stays lit in yellow until the user moves on.

## B-revisao.png

(Mesmo texto de conteúdo de A-revisao.png, do início até "Revisão 2 de 2 · Perfil Groq".", trocando só o último parágrafo por este:)

Visual law: high-contrast panels — a near-black ground with crisp white type, a monospaced tabular voice for every number and timecode, and a single signal yellow reserved only for things that just changed. Signature: the Cortes list reads like a departure board — a fixed column grid (Nota · Início · Duração · Título · Estado) ranked by Nota; a row whose Nota just changed after a border adjustment has moved in place and stays lit in yellow until noticed.

## C-editor.png

(Mesmo texto de conteúdo de A-editor.png, trocando só o último parágrafo por este:)

Visual law: a warm deep charcoal-brown ground like a dim podcast studio at night, panels one step lighter, warm off-white text, tungsten amber for the active word, the playhead and focus, and a muted teal for the second speaker. One warm humanist sans for everything, with tabular figures for timecodes. Signature: the transcript leads — speakers marked with coloured initials, and the spoken word under the playhead glows like a lamp, sweeping word by word in sync with the video and echoed on the Frases track.

## C-revisao.png

(Mesmo texto de conteúdo de A-revisao.png, trocando só o último parágrafo por este:)

Visual law: a warm deep charcoal-brown ground like a dim podcast studio at night, panels one step lighter, warm off-white text, tungsten amber for the active word and selection, a muted teal for the second speaker. One warm humanist sans for everything, with tabular figures for timecodes. Signature: each suggested Corte shows its opening line of speech with speaker initials, and the spoken word under the playhead in the preview's transcript glows like a lamp.

## D-editor.png

(Mesmo texto de conteúdo de A-editor.png, trocando só o último parágrafo por este:)

Visual law: the familiar professional video editor look, played straight and polished — neutral dark grey surfaces, one blue accent for selection and the primary action, a clean neutral sans, compact density, as well finished as DaVinci Resolve or CapCut for desktop. No special motif.

## D-revisao.png

(Mesmo texto de conteúdo de A-revisao.png, trocando só o último parágrafo por este:)

Visual law: the familiar professional video editor look, played straight and polished — neutral dark grey surfaces, one blue accent for selection and the primary action, a clean neutral sans, compact density, as well finished as DaVinci Resolve or CapCut for desktop. No special motif.
