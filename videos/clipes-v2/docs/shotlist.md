# Shotlist: Clipes v2.0.0 · 30 s · 120 BPM · 60 batidas · formatos 16:9 e 9:16

STATUS: RASCUNHO, aguardando o OK do coordenador (em nome do mantenedor). Nada será construído antes de constar APROVADO.

Batidas na grade medida (`beats.json`: 120,04 BPM, resíduo máx. 0 ms). 1 batida = 0,5 s; 1 compasso = 2 s. Cortes secos em linha de compasso (8, 12, 20, 28, 40, 48).
Regras: gancho legível no quadro 0, algo novo a cada 2–4 s, cartão final parado no máximo 2 s e nunca estático.
Capturas: `assets/cap/` (front-v2 real, mock, 2×; origem de cada uma em `brief.md`). Mídia de demonstração: `assets/demo/` (ffmpeg `life`).

## Tabela

| # | Batidas | Tempo (s) | Plano | Texto na tela (exato) | Movimento / transição | SFX (marca → papel earshot) | 9:16 |
|---|---|---|---|---|---|---|---|
| 1 | −0,4–8 | 0,0–4,0 | **Corte pronto.** Prévia 9:16 do Editor com o vídeo de demonstração e a legenda real "O chat simplesmente explodiu"; recua e se revela dentro do Editor | "Sua live virou **Corte.**" (0) · eyebrow "Com legenda. Pronto para postar." (2) | push 1,00→1,04; batida 4: dolly out `heavy` de ~2,4× para 1,05× com tilt 10°→2°; o entorno sai de blur 8 px→0; sai por **match cut** na textura do vídeo | hook→pop · hook_sub→land.light · 4,5→whoosh.short | o Corte ocupa a tela inteira (é o formato dele); texto na faixa 16–34 %; recua até mostrar Prévia + toolbar |
| 2 | 8–12 | 4,0–6,0 | **A Fonte.** O mesmo vídeo agora em 16:9 (a live), cabeçalho real da Fonte "Live_12_11_final.mp4 · 01:00:00 · 1080p · Disponível" assenta embaixo | "Tudo começa na **Fonte.**" | entra com zoom de 1,25→1,0 (o "rebobinar" do match cut); cabeçalho sobe `default` na batida 9; sai por corte seco | s2→swell (reverse, único) · s2_head→land | vídeo 16:9 no terço de cima da área segura, cabeçalho recortado em duas linhas abaixo |
| 3 | 12–20 | 6,0–10,0 | **Transcrição local.** Tela Fonte e Transcrição: Motor "Local — US$ 0,00 · não sai da máquina" e as falas | "Transcrição local," (13) · "**nada sai da sua máquina.**" (16) | tela entra em tilt 3D 14°→3° `heavy`; foco no Motor (falas em blur); batida 16: **rack focus** para as falas + truck à direita; falas surgem por máscara, uma por meia batida | s3→snap · s3_local→pop · s3_l1–l4→text (pluck) | dois recortes empilhados: Motor em cima, falas embaixo; o rack focus troca qual está nítido |
| 4 | 20–28 | 10,0–14,0 | **Revisão dos Cortes.** "3 Cortes sugeridos" com Notas 8,8 / 7,5 / 4,0; o cursor aperta **Aprovar** (estado real Aprovado capturado depois do clique) | "A IA sugere." (20,5) · eyebrow "Com o provedor de IA que você escolher." (22) · "**Você aprova.**" (26) | push-in diagonal 1,4→1,6×; Notas destacam `snappy` em meia batida; cursor desliza `default` e aperta (botão 0,96→1); troca para a captura "aprovado" no clique; sai por **whip pan** à direita | s4→land · n1–n3→pop · s4_click→click · s4_ok→click.confirm | lista e botão Aprovar em close (2,1×), texto em cima |
| 5 | 28–40 | 14,0–20,0 | **Edição de legenda.** Editor real: Transcrição do Corte à esquerda, Prévia 9:16 com o vídeo e a legenda real, que se revela palavra por palavra; depois o painel real **Legenda** abre | "Legenda **palavra por palavra.**" (29) · eyebrow "Estilo, fonte e posição no painel Legenda." (36) | pouso do whip; truck lento à direita, das falas para a Prévia; palavras da legenda real reveladas por máscara em 30/30,5/31/32; batida 34: **rack focus** para "O chat simplesmente explodiu nessa hora." (Frase 13); batida 36: clique em Legenda, troca para a captura com o painel aberto, push até o painel | s5→whoosh.short · w1–w3→text · w4→bell · s5_rack→tock · s5_leg→click | Prévia grande no centro da área segura; Transcrição em recorte acima; painel Legenda em close |
| 6 | 40–48 | 20,0–24,0 | **Exportação.** Prontidão e Lote com os cartões reais; o cursor aperta "Exportar 4 aprovados em lote" | "Exporte em **lote.**" (41) · eyebrow "MP4 1080×1920 · áudio a −14 LUFS" (42) | pouso do whip; plano aberto em tilt 12°→3°; push até o botão laranja (a única luz); clique na 44; o botão **cresce e cobre o quadro** (sai por "colapsar no que o substitui") enquanto a música faz stop-down na 47 | s6→whoosh.short · s6_sub→land.light · s6_click→click · logo→riser (pico) | cartões em coluna; o botão em close na faixa 50–75 % |
| 7 | 48–60 | 24,0–30,0 | **Cartão final.** Marca real (ícone Scissors laranja + "Clipes", reconstruída do `Tela.tsx`) e faixa de telas reais ao fundo em parallax | logo "Clipes" + "v2.0.0" (48) · "Interface nova. Mesmo núcleo." (50) · "Baixe grátis para **Windows e Linux.**" (52) · "github.com/GUSTAVOHOOO/clipes · Releases" (54) · eyebrow "Open source · Apache-2.0" (56) | a cobertura laranja recolhe e revela o logo `heavy` (drop); uma linha nova por segundo até a 56; depois 2 s de micro push 1,00→1,03 com a faixa de telas em parallax (nunca estático) | logo→drop (afinado em Ré) · tag→pop · cta→bell · url→pop · lic→land.light | logo e texto empilhados à esquerda na faixa 18–62 %; faixa de telas embaixo, acima dos 20 % inferiores |

Ritmo: os eventos novos caem em 0 · 2 · 4 · 8 · 9 · 12 · 13 · 16 · 20 · 21 · 22 · 25 · 26 · 28 · 29 · 30–32 · 34 · 36 · 40 · 41 · 42 · 44 · 48 · 50 · 52 · 54 · 56 (batidas). O maior intervalo é de 4 batidas (2 s).

## Jogo de câmera por plano

| # | Movimento | Lente (escala sobre a captura 1440×900) | Foco | Transição de saída | Razão narrativa |
|---|---|---|---|---|---|
| 1 | push lento, depois dolly out | 2,4× (só a Prévia) → 1,05× (Editor inteiro) | Prévia nítida; entorno de 8 px a 0 no recuo | match cut na textura do vídeo | Abre pelo resultado e só depois mostra onde ele nasceu |
| 2 | zoom de 1,25 a 1,0 ("rebobinar") | vídeo 16:9 a ~60 % da largura + cabeçalho a 1,5× | tudo nítido | corte seco no compasso 12 | A volta no tempo: o mesmo vídeo, agora a live inteira |
| 3 | tilt 3D assentando, truck à direita | 1,5× no Motor → 1,35× nas falas | rack focus Motor → falas | corte seco no compasso 20 | Duas verdades sem corte: transcreve no PC, e sai texto |
| 4 | push-in diagonal, cursor | 1,4× → 1,6× (lista + botão) | nítido; fora do quadro em blur leve | whip pan à direita | A decisão é humana: a Nota sugere, o clique decide |
| 5 | truck, rack focus, push | 1,3× → 1,7× na Prévia → 1,8× no painel | rack focus Prévia → Frase 13 | push-through/corte seco no compasso 40 | O texto vira legenda; a legenda tem controle de verdade |
| 6 | tilt 3D, push até o botão | 1,0× → 2,2× | nítido | o botão laranja cresce e cobre o quadro | Um clique exporta o lote inteiro: a única luz leva ao fim |
| 7 | parallax, micro push | marca grande; faixa de telas a 0,45× | nítido | fim (abre e fecha em grafite #0f1012) | Chamada clara: o que é, onde baixar, que é livre |

## Música
Trilha sintetizada (`music.py`, seed 2020), 120 BPM, Ré menor (Dm–Bb–F–C, um acorde por compasso). Seções: intro (0, já no corpo do volume) → full (8) → dark (28, abre espaço para os plucks da legenda) → full (34) → build (40) → gap (47, stop-down de uma batida) → drop (48, logo) → outro (54). Acentos de crash e bumbo grande no logo (48) e no CTA (52).

## Efeitos (earshot)
Kit `audio/kit.json` a partir do preset `launch` do earshot 0.4.1. Os papéis estão na tabela. Cada efeito é posicionado pelo `kit.lock.json` (onset ou pico medido) e tem o nível medido contra a música no segundo anterior (`bed_db`). O `drop` é afinado em Ré. Há um único reverse swell (plano 2) e um único riser (até o logo).

## Perguntas em aberto
- Nenhuma: o brief responde ao intake. Sem locução.
