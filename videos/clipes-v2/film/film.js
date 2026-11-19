// Clipes v2.0.0: filme de lançamento (30 s, 120 BPM). Shotlist APROVADO em docs/shotlist.md.
// A estrela é a interface real: capturas do front-v2 (assets/cap, ver brief.md) vistas por uma "janela" (.vp)
// onde uma câmera anda em coordenadas da captura (px CSS de 1440×900). Nada de UI é redesenhado: os destaques
// (Notas, botões, linhas da Transcrição) são cópias recortadas da MESMA captura, e os estados "Aprovado" e
// "painel Legenda" são capturas reais feitas depois de clicar de verdade no app.
// Função pura do tempo: sem timers, sem Math.random, nada mutado em run().
(() => {
  const { W, H, FMT, pick, put, reg, el, scene, sp, spHit, trk, seg, clamp, lerp, ease, bt, beatOf } = C;
  const { line, rise } = TYPE;
  C.fonts = ['600 72px Display', '500 34px UI'];
  const P = (wide, tall) => pick(wide, wide, tall);
  const TALL = FMT === '9x16';
  const CAP = '../assets/cap/1440x900/';
  const PAD = P(120, 80);
  // a janela padrão de cada formato (16:9: coluna da direita; 9:16: metade de baixo, fora das zonas da plataforma)
  const VP = P({ x: 780, y: 60, w: 1080, h: 960 }, { x: 48, y: 790, w: 984, h: 740 });
  const CAMSP = { response: 0.8, damping: 1 };
  const Z_END = P(3.62, 3.3), CY_END = 300;
  const LBLMAX = P(4.4, 2.6);                              // rótulo do botão no quadro laranja: ~57 px / 34 px de corpo               // fim do plano 1: só vídeo (legenda fora do quadro)            // câmera: crítica e pesada, sem quique
  const HS = P(92, 116), ES = P(48, 50);                   // display / eyebrow
  const HY = P(400, 290);
  const eyY = (n) => HY + n * HS * 1.12 + P(44, 40);           // eyebrow logo abaixo de n linhas de display               // topo do bloco de display / eyebrow
  const LEADB = C.leadFor('snappy') / (C.bt(1) - C.bt(0)); // lead de um hit snappy, em batidas

  // retângulos MEDIDOS no DOM real (assets/cap/1440x900/rects.json, scripts/capture-app.mjs)
  const R = {
    prevEd: { x: 790.5, y: 130, w: 305.4, h: 543 },      // Prévia 9:16 do Editor
    prevRev: { x: 557, y: 113, w: 260, h: 462.2 },       // Prévia da Revisão
    aprovar: { x: 557, y: 732.6, w: 115.1, h: 28 },
    legendaBtn: { x: 984.1, y: 685, w: 94.4, h: 28 },
    lote: { x: 1061, y: 808, w: 351, h: 36 },
    leg: [842.5, 885.8, 982.9, 1043.5],                  // bordas das palavras da legenda real: O chat | simplesmente | explodiu
    frase13: { x: 12, y: 407.9, w: 421.4, h: 60.3 },
    falas: [305.5, 412.5, 480.5, 548.5, 616.5, 684.5, 752.5, 820.5], // base de cada Frase na Fonte (topo + 59.7)
    notas: [263, 317, 371],                              // centro y das Notas 8,8 / 7,5 / 4,0 (x ≈ 476)
  };
  const ctr = (r) => [r.x + r.w / 2, r.y + r.h / 2];

  // ---------------------------------------------------------------- vídeo de demonstração (ffmpeg `life`, brief.md)
  const bank = el('div', { style: 'display:none' }, C.stage);
  const seq = (dir, n) => Array.from({ length: n }, (_, i) => el('img', { src: `../assets/demo/${dir}/${String(i + 1).padStart(3, '0')}.png` }, bank));
  const FH = seq('h', 150);
  // o Corte 9:16 é o recorte central (68×120) da MESMA Fonte 16:9 (214×120): por isso o match cut casa
  const CROP = { sx: 73, w: 68 };
  function foot(parent, w, h, css = '') {
    const cv = el('canvas', { class: 'foot', width: w, height: h, style: css }, parent);
    reg(cv);
    return { cv, crop: w === CROP.w };
  }
  function drawFoot(F, t) {
    const g = F.cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const i = ((Math.floor(t * 15) % FH.length) + FH.length) % FH.length;
    if (F.crop) g.drawImage(FH[i], CROP.sx, 0, CROP.w, 120, 0, 0, CROP.w, 120); else g.drawImage(FH[i], 0, 0);
  }
  const rectCss = (r, extra = '') => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;${extra}`;

  // ---------------------------------------------------------------- janela + câmera sobre uma captura real
  function screen(parent, name) {
    const S = { name };
    S.vp = reg(el('div', { class: 'vp' }, parent));
    S.cam = reg(el('div', { class: 'abs' }, S.vp));
    S.img = reg(el('img', { class: 'abs shot', src: CAP + name + '.jpg' }, S.cam));
    return S;
  }
  const clipOf = (r, rad = 0) => `inset(${r.y}px ${1440 - r.x - r.w}px ${900 - r.y - r.h}px ${r.x}px${rad ? ` round ${rad}px` : ''})`;
  function copy(S, name, r, base = {}) {        // a mesma captura, recortada (foco, linhas, botões)
    const i = el('img', { class: 'abs shot', src: CAP + name + '.jpg' }, S.cam);
    return reg(i, r ? { clip: clipOf(r), ...base } : base);
  }
  function frame(S, r, cx, cy, z, ry = 0, rx = 0, rad = 14) {
    put(S.vp, { css: { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', borderRadius: rad + 'px',
      transform: Math.abs(ry) + Math.abs(rx) > 0.02 ? `perspective(2600px) rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg)` : 'none' } });
    put(S.cam, { x: r.w / 2 - cx * z, y: r.h / 2 - cy * z, s: z });
    return { r, cx, cy, z };
  }
  const toStage = (f, X, Y) => [f.r.x + f.r.w / 2 + (X - f.cx) * f.z, f.r.y + f.r.h / 2 + (Y - f.cy) * f.z];
  const lerpR = (a, b, u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), w: lerp(a.w, b.w, u), h: lerp(a.h, b.h, u) });
  const zl = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));
  // keys: [[beat, cx, cy, z, preset?], ...]; retargets keep velocity; zoom interpolated in log space
  function camTrk(t, keys) {
    const k = (i, f = (v) => v) => keys.map((q) => [q[0], f(q[i]), q[4] || CAMSP]);
    return [trk(t, k(1)), trk(t, k(2)), Math.exp(trk(t, k(3, Math.log)))];
  }
  // escala de um elemento da captura em torno do seu centro (destaques "snappy")
  const scaleAbout = (cx, cy, s) => ({ s, x: cx * (1 - s), y: cy * (1 - s) });
  const whipBlur = (k) => (k > 0.01 && k < 0.99 ? `blur(${(14 * Math.sin(Math.PI * k)).toFixed(2)}px)` : 'none');
  const bump = (t, b, amp = 1) => amp * (spHit(t, b, 'snappy', 1 / 60) - sp(t, b + 0.45, 'default'));

  // ---------------------------------------------------------------- tipografia: '*' marca a palavra de acento
  // ênfase: as palavras com '*' ficam em --t1 e o resto do bloco em --t2 (o laranja fica para a UI e a tesoura)
  function head(root, rows, o = {}) {
    const size = o.size || HS, lh = o.lh || 1.12;
    const anyAcc = rows.some((r) => r.includes('*'));
    return rows.map((txt, i) => {
      const acc = [];
      const clean = txt.split(' ').map((w, j) => (w.startsWith('*') ? (acc.push(j), w.slice(1)) : w)).join(' ');
      return line(root, clean, { x: o.x ?? PAD, y: (o.y ?? HY) + i * size * lh, size, cls: o.cls || 'display', accent: acc, color: o.color || (anyAcc ? 'var(--t2)' : undefined) });
    });
  }
  const eyebrow = (root, rows, y = eyY(2)) => head(root, rows, { cls: 'eyebrow', size: ES, lh: 1.32, y });
  const SHIFT = { heavy: -0.2, snappy: -0.05, default: 0 };    // calibrado nas rodadas 1–2 (metrics.sync com roi16)
  function riseRows(t, rows, inAt, outAt = null, o = {}) {
    const pr = o.preset || 'heavy';
    rows.forEach((L, i) => rise(t, L, beatOf(inAt) + SHIFT[pr] + (o.rowGap ?? (pr === 'snappy' ? 0.04 : 0.22)) * i, outAt, { preset: pr, ...o }));
  }

  // ---------------------------------------------------------------- cursor (ponteiro de sistema simples, sem anel nem glow)
  function cursor(root) {
    const c = el('div', { class: 'abs cursor' }, root,
      '<svg viewBox="0 0 24 24" width="36" height="36"><path d="M4 2.5 L4 19.5 L8.6 15.2 L11.5 21.6 L14.3 20.4 L11.4 14 L17.8 13.8 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>');
    return reg(c, { o: 0 });
  }
  // o ponteiro anda em coordenadas da captura e é desenhado no palco: segue a câmera
  function moveCursor(t, c, f, keys, pressAt) {
    const b = C.beatAt(t);
    if (b < keys[0][0]) { put(c, { o: 0 }); return 0; }
    const X = trk(t, keys.map((k) => [k[0], k[1], 'default'])), Y = trk(t, keys.map((k) => [k[0], k[2], 'default']));
    const [x, y] = toStage(f, X, Y);
    const press = pressAt == null ? 0 : spHit(t, pressAt, 'snappy') - sp(t, beatOf(pressAt) + 0.3, 'snappy');
    const g = sp(t, keys[0][0], 'snappy');
    put(c, { o: g > 0.02 ? 1 : 0, x: x - 4, y: y - 3, s: (0.85 + 0.15 * g) * (1 - 0.14 * press) });
    return press;
  }

  // ================================================================= 1 · Corte pronto (0 → 8)
  scene({
    name: 'corte', from: 'hook', to: 's2',
    build(root, S) {
      S.scr = screen(root, 'corte-editar');
      S.F = foot(S.scr.cam, 68, 120, rectCss(R.prevEd, 'border-radius:6px'));
      S.leg = reg(el('img', { class: 'abs', src: CAP + 'corte-editar.leg.png', style: rectCss(R.prevEd) }, S.scr.cam));
      // 9:16: sombra superior de reel atrás da manchete enquanto o Corte ocupa a tela (legibilidade, rodada 1)
      S.scrim = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H * 0.47}px;background:linear-gradient(rgba(15,16,18,.95), rgba(15,16,18,.93) 80%, rgba(15,16,18,0))` }, root), { o: TALL ? 1 : 0 });
      S.h = head(root, ['Sua live', 'virou *Corte.']);
      S.e = eyebrow(root, ['Com legenda.', 'Pronto para postar.']);
    },
    run(t, b, S) {
      drawFoot(S.F, t);
      const r0 = P({ x: 1100, y: 40, w: 562, h: 1000 }, { x: 0, y: 0, w: 1080, h: 1920 });
      const [pcx, pcy] = ctr(R.prevEd);
      const z0 = (r0.h / R.prevEd.h) * (1 + 0.04 * seg(t, 0, 4));          // micro push no Corte
      const u = sp(t, 's1_pull', CAMSP);                                      // dolly out: revela o Editor
      const p = ease.expoIn(seg(t, 6.4, 7.85));                               // push de volta para dentro do vídeo (acaba antes do corte: célula igual à do plano 2)
      const pc = ease.out(seg(t, 6.4, 7.4));                                   // a câmera sobe antes: a legenda sai do quadro
      const z1 = P(0.82, 1.15), c1 = P([780, 420], [880, 430]);
      const zA = zl(z0, z1, u), zEnd = Z_END, cyEnd = CY_END;
      const z = zl(zA, zEnd, p);
      const cx = lerp(lerp(pcx, c1[0], u), pcx, p), cy = lerp(lerp(pcy, c1[1], u), cyEnd, pc);
      const ry = (-2 * u - 9 * Math.sin(Math.PI * clamp(u))) * (1 - p);
      frame(S.scr, lerpR(r0, TALL ? { ...VP, y: VP.y + 40 } : VP, u), cx, cy, z, TALL ? 0 : ry, TALL ? 0 : 2 * u * (1 - p), lerp(TALL ? 0 : 14, 14, u));
      put(S.scr.img, { filter: `blur(${(6 * (1 - u) + 4 * p).toFixed(2)}px)` });
      if (TALL) put(S.scrim, { o: 1 - clamp((u - 0.8) / 0.2), hide: u > 0.995 });  // entorno fora de foco no close
      // manchete legível no quadro 0: as palavras são soltas antes de t = 0; "Corte." assenta no beat 0
      // manchete inteira já no quadro 0 (soltas antes de t = 0); sai pela máscara antes do mergulho no vídeo
      rise(t, S.h[0], [-1.5, -1.42], 6.9);
      rise(t, S.h[1], [-1.34, -1.26], 6.9);
      riseRows(t, S.e, 'hook_sub', 6.9, { preset: 'snappy', stagger: 0.02, rowGap: 0.04 });
    },
  });

  // ================================================================= 2 · A Fonte (8 → 12): match cut na textura do vídeo
  scene({
    name: 'fonte', from: 's2', to: 's3',
    build(root, S) {
      S.card = reg(el('div', { class: 'vp' }, root));
      S.F = foot(S.card, 214, 120);
      S.hdr = screen(root, 'fonte-transcricao');
      S.h = head(root, ['Tudo começa', 'na *Fonte.']);
      S.e = eyebrow(root, ['A live inteira, de arquivo', 'local ou de uma URL.']);
    },
    run(t, b, S) {
      drawFoot(S.F, t);
      const rF = P({ x: 780, y: 120, w: 1080, h: 608 }, { x: 48, y: 790, w: 984, h: 554 });
      const u = sp(t, 8.15, CAMSP);
      const r = lerpR(VP, rF, u);
      put(S.card, { css: { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' } });
      // "rebobinar": começa no recorte do Corte, na mesma célula do fim do plano 1, e abre até a live inteira
      const c0 = (R.prevEd.w / CROP.w) * Z_END, c1 = Math.max(r.w / 214, r.h / 120) * (1 + 0.03 * seg(t, 9, 12));
      const c = zl(c0, c1, u);
      const sy0 = (CY_END - R.prevEd.y) / R.prevEd.h * 120;
      const ax = 107, ay = lerp(sy0, 60, u);
      put(S.F.cv, { css: { left: r.w / 2 - ax * c + 'px', top: r.h / 2 - ay * c + 'px', width: 214 * c + 'px', height: 120 * c + 'px' } });
      // cabeçalho real da Fonte sobe por baixo do vídeo
      const v = sp(t, beatOf('s2_head') + 0.05, 'default');
      const rH = P({ x: 780, y: 760, w: 1080, h: 124 }, { x: 48, y: 1372, w: 984, h: 118 });
      frame(S.hdr, { ...rH, y: rH.y + 70 * (1 - v) }, P(330, 318), 70, P(1.62, 1.9) * (1 + 0.02 * seg(t, 9, 12)));
      put(S.hdr.vp, { o: v > 0.02 ? 1 : 0 });
      riseRows(t, S.h, 8.1, 11.4);
      riseRows(t, S.e, 's2_head', 11.4, { preset: 'snappy', stagger: 0.02 });
    },
  });

  // ================================================================= 3 · Transcrição local (12 → 20)
  scene({
    name: 'transcricao', from: 's3', to: 's4',
    build(root, S) {
      S.scr = screen(root, 'fonte-transcricao');
      // as Frases surgem por máscara: a captura base tem um buraco na coluna das falas (fundo --chao, igual ao app)
      reg(S.scr.img, { clip: 'path(evenodd, "M0 0H1440V900H0Z M470 236H1432V832H470Z")' });
      S.rows = copy(S.scr, 'fonte-transcricao', null);
      S.A = head(root, ['*Transcrição', '*local.'], { x: P(1180, PAD) });
      S.B = head(root, ['Nada sai da', '*sua *máquina.'], { x: P(1180, PAD) });
      S.e = head(root, ['Motor local: US$ 0,00.', 'Ou Groq, se preferir.'], { cls: 'eyebrow', size: ES, lh: 1.32, y: eyY(2), x: P(1180, PAD) });
    },
    run(t, b, S) {
      const q = sp(t, 's3', 'heavy');
      const [cx, cy, z] = camTrk(t, P(
        [[12, 236, 200, 2.0], [16, 820, 470, 1.72]],
        [[12, 236, 205, 2.4], [16, 790, 470, 2.0]]));
      const f = frame(S.scr, P({ ...VP, x: 60 }, VP), cx + 40 * seg(t, 16, 20), cy, z * (1 + 0.03 * seg(t, 12, 16)), P(lerp(14, 3, q), lerp(-14, -3, q)), lerp(6, 1.5, q));
      // falas transcritas: uma por meia batida (s3_l1..l4), depois o resto da coluna
      const edge = trk(t, [[12, R.falas[0] + 40], [16.5 - 0.3 * LEADB, R.falas[1], 'snappy'], [17 - 0.3 * LEADB, R.falas[2], 'snappy'],
        [17.5 - 0.3 * LEADB, R.falas[3], 'snappy'], [18 - 0.3 * LEADB, R.falas[4], 'snappy'], [18.6, 832, 'default']]);
      put(S.rows, { clip: `inset(236px 8px ${(900 - edge).toFixed(1)}px 470px)` });
      // rack focus: do Motor ("Local — US$ 0,00 · não sai da máquina") para as falas
      const fo = sp(t, 's3_rack', 'default');
      put(S.scr.img, { filter: `blur(${(4.5 * fo).toFixed(2)}px)` });
      put(S.rows, { filter: `blur(${(3 * (1 - fo)).toFixed(2)}px)` });
      riseRows(t, S.A, 's3_local', 16 - 0.3);
      riseRows(t, S.B, 's3_rack');
      riseRows(t, S.e, 14, null, { preset: 'snappy', stagger: 0.02 });
      void f;
    },
  });

  // ================================================================= 4 · Revisão dos Cortes (20 → 28)
  scene({
    name: 'revisao', from: 's4', to: 's5',
    build(root, S) {
      S.scr = screen(root, 'revisao');
      S.notas = R.notas.map((y) => copy(S.scr, 'revisao', { x: 452, y: y - 14, w: 48, h: 28 }));
      S.btn = copy(S.scr, 'revisao', R.aprovar);
      S.ok = copy(S.scr, 'revisao-aprovado', null, { o: 0 });   // estado real depois do clique em Aprovar
      S.F = foot(S.scr.cam, 68, 120, rectCss(R.prevRev, 'border-radius:6px'));
      S.cur = cursor(root);
      S.h = head(root, ['A IA sugere.', '*Você *aprova.']);
      S.e = eyebrow(root, ['Com o provedor de IA', 'que você escolher.']);
    },
    run(t, b, S) {
      drawFoot(S.F, t);
      const [cx, cy, z] = camTrk(t, P(
        [[20, 520, 420, 1.4], [23, 600, 560, 1.62]],
        [[20, 500, 380, 1.75], [23, 600, 640, 2.0]]));
      const land = 1 + 0.05 * (1 - sp(t, 's4', 'heavy'));
      const f = frame(S.scr, VP, cx, cy, z * land * (1 + 0.02 * seg(t, 25, 28)), -2, 1);
      S.notas.forEach((n, i) => put(n, scaleAbout(476, R.notas[i], 1 + bump(t, 21 + 0.5 * i, 0.3))));
      const press = moveCursor(t, S.cur, f, [[22.6, 780, 860], [24.6, ...ctr(R.aprovar)]], 's4_click');
      put(S.btn, { filter: `brightness(${(1 - 0.2 * press).toFixed(3)})` });
      put(S.ok, { o: b >= 24.98 ? 1 : 0 });
      // whip pan de saída: o quadro inteiro corre para a esquerda (o blur do render faz o chicote)
      const wo = ease.expoIn(seg(t, 27.6, 28));
      put(S.root, { x: -P(700, 420) * wo, filter: whipBlur(seg(t, 27.6, 28) > 0 ? 0.5 * wo + 0.25 : 0) });
      riseRows(t, [S.h[0]], P(20.5, 20.08));
      riseRows(t, [S.h[1]], 's4_ok');
      riseRows(t, S.e, 's4_ia', null, { preset: 'snappy', stagger: 0.05 });
    },
  });

  // ================================================================= 5 · Edição de legenda (28 → 40)
  scene({
    name: 'legenda', from: 's5', to: 's6',
    build(root, S) {
      S.scr = screen(root, 'corte-editar');
      S.fr13 = copy(S.scr, 'corte-editar', R.frase13);
      S.btn = copy(S.scr, 'corte-editar', R.legendaBtn);
      S.pan = copy(S.scr, 'corte-editar-painel', null, { o: 0 }); // painel real Legenda, capturado depois do clique
      S.F = foot(S.scr.cam, 68, 120, rectCss(R.prevEd, 'border-radius:6px'));
      S.leg = reg(el('img', { class: 'abs', src: CAP + 'corte-editar.leg.png', style: rectCss(R.prevEd) }, S.scr.cam));
      S.cur = cursor(root);
      S.h = head(root, P(['Legenda *palavra *por *palavra.'], ['Legenda', '*palavra *por', '*palavra.']), { size: P(92, 96), y: P(800, 290) });
      S.e = TALL ? eyebrow(root, ['Estilo, fonte e posição', 'no painel Legenda.'], 290 + 3 * 96 * 1.12 + 36)
        : head(root, ['Estilo, fonte e posição no painel Legenda.'], { cls: 'eyebrow', size: ES, y: 925 });
    },
    run(t, b, S) {
      drawFoot(S.F, t);
      const [cx, cy, z] = camTrk(t, P(
        [[28, 700, 380, 1.3], [29.3, 700, 470, 1.6], [34, 720, 400, 1.25], [36.1, 990, 400, 1.95]],
        [[28, 300, 380, 1.8], [29.3, 943, 470, 2.6], [34, 540, 420, 1.0], [36.1, 1180, 390, 1.9]]));
      const f = frame(S.scr, P({ x: 60, y: 56, w: 1800, h: 700 }, VP), cx, cy, z * (1 + 0.025 * seg(t, 36, 40)), P(0, -2), 1);
      // a legenda real se revela palavra a palavra (mesma ordem do destaque do app)
      const edge = trk(t, [[28, R.leg[0] - 4], [beatOf('s5_w1') - 0.3 * LEADB, R.leg[1] + 2, 'snappy'], [beatOf('s5_w2') - 0.3 * LEADB, R.leg[2] + 2, 'snappy'], [beatOf('s5_w3') - 0.3 * LEADB, R.leg[3] + 8, 'snappy']]);
      put(S.leg, { clip: `inset(0px ${(R.prevEd.x + R.prevEd.w - edge).toFixed(1)}px 0px 0px)` });
      // rack focus: tudo fora de foco menos a Frase 13 ("O chat simplesmente explodiu nessa hora.") e a Prévia
      const fo = spHit(t, 's5_rack', 'default', 0.13) - sp(t, 35.6, 'default');
      put(S.scr.img, { filter: `blur(${(3.5 * fo).toFixed(2)}px)` });
      put(S.btn, { filter: `blur(${(3.5 * fo).toFixed(2)}px)` });
      put(S.fr13, { filter: `brightness(${(1 + 0.3 * fo).toFixed(3)})` });
      const press = moveCursor(t, S.cur, f, [[34.6, 1060, 560], [35.8, ...ctr(R.legendaBtn)]], 's5_leg');
      if (b < 35.86) put(S.btn, { filter: `blur(${(3.5 * fo).toFixed(2)}px) brightness(${(1 - 0.2 * press).toFixed(3)})` });
      put(S.pan, { o: b >= 35.86 ? 1 : 0 });
      // whip de entrada e de saída
      const wIn = 1 - ease.expoOut(seg(t, 28, 28.45)), wOut = ease.expoIn(seg(t, 39.6, 40));
      put(S.root, { x: P(700, 420) * wIn - P(700, 420) * wOut, filter: wIn > 0.01 ? whipBlur(1 - 0.5 * wIn) : wOut > 0.01 ? whipBlur(0.5 * wOut) : 'none' });
      riseRows(t, S.h, P(28.5, 28.1));
      riseRows(t, S.e, 36.4, null, { preset: 'snappy', stagger: 0.05 });
    },
  });

  // ================================================================= 6 · Exportação (40 → 48)
  scene({
    name: 'exportacao', from: 's6', to: 'logo',
    build(root, S) {
      S.scr = screen(root, 'exportacao');
      S.btn = copy(S.scr, 'exportacao', R.lote);
      S.cur = cursor(root);
      S.h = head(root, ['Exporte', 'em lote.'], { x: P(1180, PAD) });
      S.e = head(root, ['MP4 1080×1920', 'áudio a −14 LUFS'], { cls: 'eyebrow', size: ES, lh: 1.32, y: eyY(2), x: P(1180, PAD) });
      // a luz do botão real (Exportar 4 aprovados em lote) cresce; o rótulo é refeito aqui só para sair pela máscara
      S.cover = reg(el('div', { class: 'abs', style: 'background:var(--sinal);overflow:hidden' }, root), { o: 0 });
      S.lbl = reg(el('div', { class: 'abs', style: 'width:351px;height:36px;display:flex;align-items:center;justify-content:center;font:500 13px/1 UI;color:var(--no-sinal);white-space:nowrap' }, S.cover, 'Exportar 4 aprovados em lote'));
    },
    run(t, b, S) {
      const q = sp(t, 's6', 'heavy');
      const [cx, cy, z] = camTrk(t, P(
        [[40, 720, 450, 1.25], [41.2, 720, 450, 0.92], [42.4, 1220, 700, 2.2, { response: 1.2, damping: 1 }], [44.6, 1236, 760, 3.0, { response: 1.4, damping: 1 }]],
        [[40, 720, 450, 0.75], [41.2, 720, 450, 1.0], [42.4, 1215, 700, 2.4, { response: 1.2, damping: 1 }], [44.6, 1236, 760, 3.1, { response: 1.4, damping: 1 }]]));
      const wide = sp(t, 41.2, CAMSP);
      const f = frame(S.scr, lerpR(P({ x: 60, y: 60, w: 1800, h: 960 }, { x: 0, y: 640, w: 1080, h: 680 }), P({ ...VP, x: 60 }, VP), wide), cx, cy, z, lerp(-12, -1, q), lerp(5, 0.5, q));
      const press = moveCursor(t, S.cur, f, [[42, 900, 560], [43.8, ...ctr(R.lote)]], 's6_click');
      put(S.btn, { filter: `brightness(${(1 - 0.2 * press).toFixed(3)})` });
      // o botão (a única luz da tela) cresce e cobre o quadro: a saída colapsa no que vem depois
      // a luz do botão cresce levando o rótulo junto (até LBLMAX): o quadro laranja nunca fica vazio
      const g = ease.inOut(seg(t, 46.9, 47.62));
      const [bx, by] = toStage(f, R.lote.x, R.lote.y);
      const r = lerpR({ x: bx, y: by, w: R.lote.w * f.z, h: R.lote.h * f.z }, { x: -20, y: -20, w: W + 40, h: H + 40 }, g);
      put(S.cover, { o: b >= 46.9 ? 1 : 0, x: r.x, y: r.y, css: { width: r.w + 'px', height: r.h + 'px', borderRadius: lerp(8 * f.z, 0, g) + 'px' } });
      const sl = Math.min(r.w / 351, LBLMAX);
      put(S.lbl, { x: (r.w - 351 * sl) / 2, y: (r.h - 36 * sl) / 2, s: sl });
      const wIn = 1 - ease.expoOut(seg(t, 40, 40.45));
      put(S.root, { x: P(700, 420) * wIn, filter: wIn > 0.01 ? whipBlur(1 - 0.5 * wIn) : 'none' });
      riseRows(t, S.h, P(41.9, 40.4), 46.6);
      riseRows(t, S.e, 's6_sub', 46.6, { preset: 'snappy', stagger: 0.05 });
    },
  });

  // ================================================================= 7 · Cartão final (48 → 60)
  const SCISSORS = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--sinal)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
    + '<g class="bl1"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M14.8 14.8 20 20"/></g><g class="bl2"><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/></g></svg>';
  const XOUT = 58.9;   // beat em que o texto do cartão final começa a sair
  scene({
    name: 'final', from: 'logo', to: 'done', pre: 0.34, cut: true,   // entra quando a luz do botão completa: no máximo 1 quadro laranja chapado
    build(root, S) {
      root.style.background = 'var(--area)';
      // faixa de telas reais ao fundo (parallax), escurecida: profundidade sem gradiente
      S.strip = reg(el('div', { class: 'abs' }, root));
      S.shots = ['cortes', 'corte-editar', 'exportacao'].map((n, i) => {
        const d = el('div', { class: 'vp', style: `width:1440px;height:900px;border-radius:18px;transform-origin:0 0` }, S.strip);
        el('img', { class: 'shot', src: CAP + n + '.jpg' }, d);
        if (n === 'corte-editar') {   // a Prévia da captura é preta: o mesmo vídeo de demonstração e a legenda real por cima, para a faixa ler como o app
          S.F2 = foot(d, 68, 120, rectCss(R.prevEd, 'border-radius:6px'));
          el('img', { class: 'abs', src: CAP + 'corte-editar.leg.png', style: rectCss(R.prevEd) }, d);
        }
        return reg(d);
      });
      S.push = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;transform-origin:${PAD}px ${H / 2}px` }, root));
      // marca reconstruída do componente Marca (design-system-v2/src/componentes/Tela.tsx:100-105):
      // ícone lucide Scissors (stroke 1.75, --sinal) + "Clipes" em Inter 600, gap 8/13 do corpo
      const LS = P(80, 76);
      S.mask = el('div', { class: 'abs', style: `left:${PAD - 8}px;top:${P(150, 290)}px;overflow:hidden;padding:${LS * 0.2}px 8px;` }, S.push);
      S.lock = reg(el('div', { style: `display:flex;align-items:center;gap:${LS * 0.6}px;font:600 ${LS}px/1 Display;letter-spacing:-0.02em;color:var(--t1)` }, S.mask,
        `<span style="width:${LS * 1.23}px;height:${LS * 1.23}px;display:block">${SCISSORS}</span><span>Clipes</span>`));
      S.bl = [...S.lock.querySelectorAll('.bl1, .bl2')].map((g) => reg(g));
      S.pmask = el('div', { class: 'abs', style: `left:${PAD}px;top:${P(290, 420)}px;width:200px;height:60px;overflow:hidden` }, S.push);
      S.pill = reg(el('div', { class: 'pill', style: 'left:0;top:0' }, S.pmask, 'v2.0.0'), { y: 80 });
      const Y = P(380, 520);
      S.tag = head(S.push, ['Interface nova. Mesmo núcleo.'], { y: Y, size: P(60, 54) });
      S.cta = head(S.push, ['Baixe grátis para', 'Windows e Linux.'], { y: Y + P(100, 100), size: P(104, 96) });
      S.url = head(S.push, ['github.com/GUSTAVOHOOO/clipes'], { y: Y + P(360, 345), size: P(54, 50) });
      S.lic = head(S.push, P(['GitHub Releases · Open source · Apache-2.0'], ['GitHub Releases', 'Open source · Apache-2.0']), { y: Y + P(440, 415), cls: 'eyebrow', size: P(46, 46), lh: 1.3 });
      S.cover = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;background:var(--sinal);overflow:hidden` }, root));
      // o mesmo rótulo, no mesmo lugar e tamanho do fim do plano 6, sai junto com o wipe
      el('div', { class: 'abs', style: `width:351px;height:36px;display:flex;align-items:center;justify-content:center;font:500 13px/1 UI;color:var(--no-sinal);white-space:nowrap;transform:translate(${(W - 351 * LBLMAX) / 2}px, ${(H - 36 * LBLMAX) / 2}px) scale(${LBLMAX})` }, S.cover, 'Exportar 4 aprovados em lote');
    },
    run(t, b, S) {
      // a cobertura laranja do plano 6 recolhe para cima e revela o cartão
      // a cobertura recolhe para BAIXO: o logo (no alto) aparece primeiro e nunca é cruzado por ela
      const c = ease.inOut(seg(t, 47.70, 47.98));   // wipe de ~0,14 s: o topo (logo) é descoberto já em f717 e nada fica laranja depois de f720
      put(S.cover, { clip: `inset(${(100 * c).toFixed(3)}% 0 0 0)`, hide: c > 0.999 });
      drawFoot(S.F2, t);
      put(S.push, { s: 1 + 0.08 * seg(t, 48, 60) });   // linear: nunca para, nem no último quadro
      const LS = P(80, 76), lk = C.sp(t, 47.74, { response: 0.32, damping: 0.55 });   // cai de cima, pousa no beat 48 e assenta com overshoot visível
      put(S.lock, { y: -LS * 0.8 * (1 - lk) });
      const pl = spHit(t, 48.6, 'snappy');
      const pO = sp(t, beatOf(XOUT) - 0.14, 'snappy');   // saída do pílula junto com as linhas (emenda do loop)
      put(S.pill, { y: 80 * (1 - pl) - 80 * pO, hide: pl < 0.01 || pO > 0.995 });
      const sn = spHit(t, 'snip', 'snappy') - sp(t, beatOf('snip') + 0.35, 'default');
      S.bl.forEach((g, i) => put(g, { css: { transformOrigin: '12px 12px', transformBox: 'view-box', transform: `rotate(${((i ? -1 : 1) * 28 * sn).toFixed(3)}deg)` } }));
      // últimos 0,4 s: as linhas saem por máscara (de cima para baixo na ordem de leitura) e sobram marca + telas, perto do f0 (emenda do loop)
      riseRows(t, S.tag, 'tag', XOUT);
      riseRows(t, [S.cta[0]], beatOf('cta') - 0.6, XOUT + 0.1);   // a linha de ênfase (Windows e Linux.) é a que cai no cue
      riseRows(t, [S.cta[1]], 'cta', XOUT + 0.1, { stagger: 0.03 });
      riseRows(t, S.url, 'url', XOUT + 0.2, { stagger: 0.02 });
      riseRows(t, S.lic, 'lic', XOUT + 0.3, { preset: 'snappy', stagger: 0.02, rowGap: 0.05 });
      // parallax: as telas sobem/andam mais devagar que a tipografia e nunca param
      const e = sp(t, 48.3, CAMSP), d = seg(t, 48, 60);
      const stp = ['tag', 'cta', 'url', 'lic', 'snip'].reduce((a, m) => a + sp(t, beatOf(m) - 0.1, 'default'), 0);
      S.shots.forEach((s, i) => {
        const sc = P(0.4, 0.42);
        const x = P(1210 + i * 70, 40 + i * (1440 * 0.42 + 36)) - P(0, 300) * d - P(0, 150) * stp;
        const y = P(-120 + i * (900 * 0.4 + 36), 1090 + i * 30) - P(140, 0) * d - P(95, 0) * stp + 160 * (1 - e);
        put(s, { x, y, s: sc, css: { transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) perspective(2400px) rotateY(${P(-16, -10)}deg) rotateX(4deg) scale(${sc})`, filter: 'brightness(1.55) saturate(.25)' } });
      });
    },
  });

  C.start();
})();
