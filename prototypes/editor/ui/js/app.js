// Integrador do protótipo do editor de Cortes do Clipes.
// Estado, player (Fonte direta ou proxy), crop, atalhos, remoção de silêncios e exportação.
// É o único módulo que fala com o Tauri.

import { criarTimeline } from './timeline.js';
import { criarLegenda, agruparPalavras } from './legenda.js';
import { gerarAss } from './ass.js';
import { detectarPausas, trechosMantidos, criarMapa } from './silencio.js';
import { criarPainelTranscricao } from './transcricao.js';
import { criarPainelEstilo, PRESETS } from './painel-estilo.js';
import { criarListaCortes } from './lista-cortes.js';
import { criarMedidor } from './medicoes.js';

const tauri = window.__TAURI__;
const invocar = (cmd, args) => tauri.core.invoke(cmd, args);
const ouvir = (evento, fn) => tauri.event.listen(evento, (e) => fn(e.payload));

// Erros e logs do WebView vão para o terminal do `tauri dev`.
for (const nivel of ['error', 'warn', 'log']) {
  const original = console[nivel].bind(console);
  console[nivel] = (...a) => {
    original(...a);
    const texto = a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    invocar('registrar', { nivel, mensagem: texto }).catch(() => {});
  };
}
addEventListener('error', (e) => console.error('erro:', e.message, `${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => console.error('promessa rejeitada:', e.reason?.stack ?? String(e.reason)));

const FPS = 24;
const QUADRO = 1 / FPS;
const MARGEM_JANELA = 120; // ±2 min de contexto em volta do Corte (proxy, miniaturas, onda)
const ARQUIVO_FONTE = 'fonte-2h.mp4';

export const urlMidia = (caminho) =>
  `http://midia.localhost/${caminho.split('/').map(encodeURIComponent).join('/')}`;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const estado = {
  transcricao: null,
  cortes: [],
  bordas: {},            // id -> { inicio, fim, cx, modificado }
  ativo: null,
  janela: [0, 0],
  edicoes: new Map(),    // id da palavra -> texto
  estilo: structuredClone(PRESETS[0].estilo),
  silencio: { ativo: false, limiar: 0.7, removidos: [], mapa: null },
  midia: { tipo: 'fonte', offset: 0, url: '', chaveProxy: null, pct: 0 },
  proxies: new Map(),    // chave -> ProxyPronto
  tempo: 0,
  arrastandoBorda: null,
};

const fmt = (s, casas = 2) => {
  if (!Number.isFinite(s)) return '—';
  const neg = s < 0; s = Math.abs(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const seg = r.toFixed(casas).padStart(casas ? casas + 3 : 2, '0');
  return (neg ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${seg}` : `${m}:${seg}`);
};
const fmtCurto = (s) => fmt(s, 0);
const fmtVirgula = (n, c = 1) => n.toFixed(c).replace('.', ',');

const corteAtivo = () => estado.cortes.find((c) => c.id === estado.ativo);
const bordasAtivas = () => estado.bordas[estado.ativo];

// ---------------------------------------------------------------------------
// Frases e palavras
// ---------------------------------------------------------------------------
function indiceFraseEm(t) {
  const fr = estado.transcricao.frases;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (fr[m].start <= t) lo = m; else hi = m - 1;
  }
  return lo;
}

/** Borda de Frase mais próxima: `tipo` 'start' para início, 'end' para fim. */
function encaixar(t, tipo) {
  const fr = estado.transcricao.frases;
  const i = indiceFraseEm(t);
  let melhor = null, dist = Infinity;
  for (let k = Math.max(0, i - 2); k <= Math.min(fr.length - 1, i + 2); k++) {
    const d = Math.abs(fr[k][tipo] - t);
    if (d < dist) { dist = d; melhor = fr[k][tipo]; }
  }
  return melhor ?? t;
}

function itensNaJanela(lista, [a, b]) {
  return lista.filter((x) => x.end > a && x.start < b);
}

/** Palavras do Corte com o texto editado aplicado (as removidas ficam de fora). */
function palavrasDoCorte() {
  const { inicio, fim } = bordasAtivas();
  const out = [];
  for (const p of estado.transcricao.palavras) {
    if (p.start >= fim) break;
    if (p.start < inicio - 1e-6 || p.end > fim + 0.05) continue;
    const texto = estado.edicoes.has(p.id) ? estado.edicoes.get(p.id) : p.text;
    if (!texto.trim()) continue;
    out.push({ id: p.id, text: texto, start: p.start, end: Math.min(p.end, fim), frase: p.frase });
  }
  return out;
}

function palavrasDaJanela() {
  const [a, b] = estado.janela;
  return itensNaJanela(estado.transcricao.palavras, [a, b]).map((p) => ({
    ...p, text: estado.edicoes.get(p.id) ?? p.text,
  }));
}

// ---------------------------------------------------------------------------
// Player: um único <video>; Fonte direta até o proxy ficar pronto.
// ---------------------------------------------------------------------------
const video = $('video');
video.crossOrigin = 'anonymous'; // o protocolo midia responde com CORS; o canvas da Fonte não fica "sujo"
let buscaPendente = null;
let tocandoAte = null;
let shuttle = 0; // velocidade J/L: negativa = para trás

function tempoFonte() { return video.currentTime + estado.midia.offset; }

function buscar(t, { exato = true } = {}) {
  const b = bordasAtivas();
  const [ja, jb] = estado.janela;
  t = Math.min(Math.max(t, ja), jb);
  estado.tempo = t;
  // A busca pendente fica em tempo da Fonte: o deslocamento pode mudar se a mídia trocar antes de aplicá-la.
  if (video.seeking || video.readyState < 1) { buscaPendente = t; return; }
  buscaPendente = null;
  const alvo = t - estado.midia.offset;
  if (!exato && video.fastSeek) video.fastSeek(alvo); else video.currentTime = alvo;
  atualizarQuadro(t);
  void b;
}

video.addEventListener('loadeddata', () => desenharFonte());
video.addEventListener('seeked', () => {
  desenharFonte();
  if (buscaPendente != null) {
    const t = buscaPendente; buscaPendente = null;
    video.currentTime = t - estado.midia.offset;
  }
});

let trocaAtual = 0;
function trocarMidia(tipo, caminho, offset, chave = null) {
  const tocando = !video.paused;
  const minha = ++trocaAtual;
  estado.midia = { ...estado.midia, tipo, offset, url: urlMidia(caminho), chaveProxy: chave };
  video.src = estado.midia.url;
  video.addEventListener('loadedmetadata', () => {
    if (minha !== trocaAtual) return; // outra troca começou depois desta
    const t = buscaPendente ?? estado.tempo;
    buscaPendente = null;
    video.currentTime = Math.max(0, t - offset);
    if (tocando) video.play();
  }, { once: true });
  mostrarStatusMidia();
}

function tocar() {
  const { inicio, fim } = bordasAtivas();
  if (estado.tempo >= fim - QUADRO || estado.tempo < inicio - 0.01) buscar(inicio);
  shuttle = 0; video.playbackRate = 1; atualizarVelocidade();
  video.play();
}
function pausar() { shuttle = 0; video.pause(); video.playbackRate = 1; atualizarVelocidade(); }
function alternarTocar() { if (video.paused && shuttle >= 0) tocar(); else pausar(); }

video.addEventListener('play', () => $('tocar').classList.add('tocando'));
video.addEventListener('pause', () => $('tocar').classList.remove('tocando'));

// Laço por quadro apresentado
function aoQuadro(_agora, meta) {
  video.requestVideoFrameCallback(aoQuadro); // re-registra antes: um erro aqui não pode parar o laço
  // mediaTime vem arredondado pelo timescale do MP4 (ex.: 22,99935 para o quadro de 23,0): encaixa no quadro.
  const bruto = meta.mediaTime + estado.midia.offset;
  const q = Math.round(bruto * FPS) / FPS;
  const t = Math.abs(q - bruto) < 0.004 ? q : bruto;
  estado.tempo = t;
  if (!video.paused) {
    const { fim } = bordasAtivas();
    if (t >= fim) { pausar(); buscar(fim - QUADRO); }
    else if (estado.silencio.ativo && estado.silencio.mapa) {
      const prox = estado.silencio.mapa.pularSilencio(t);
      if (prox == null) { pausar(); buscar(fim - QUADRO); }
      else if (prox - t > QUADRO) video.currentTime = prox - estado.midia.offset;
    }
  }
  atualizarQuadro(t);
}
video.requestVideoFrameCallback(aoQuadro);

function atualizarQuadro(t) {
  timeline?.definirTempo(t);
  legenda?.atualizar(t);
  transcricao?.definirTempo(t);
  desenharFonte();
  const b = bordasAtivas();
  if (b) $('tempo-atual').textContent = fmt(Math.max(0, t - b.inicio));
  medidor?.quadro(t);
}

// J/K/L: para trás o vídeo HTML não toca, então o shuttle reverso é feito por buscas.
let ultimoShuttle = 0;
function laçoShuttle(agora) {
  if (shuttle >= 0) return;
  const dt = ultimoShuttle ? (agora - ultimoShuttle) / 1000 : 0;
  ultimoShuttle = agora;
  if (!video.seeking) {
    const { inicio } = bordasAtivas();
    const t = estado.tempo + shuttle * dt;
    if (t <= estado.janela[0]) { pausar(); return; }
    buscar(Math.max(t, Math.min(inicio, estado.tempo) - 30));
  }
  requestAnimationFrame(laçoShuttle);
}
function shuttleFrente() {
  video.pause();
  shuttle = shuttle <= 0 ? 1 : Math.min(shuttle * 2, 4);
  video.playbackRate = shuttle;
  video.play(); atualizarVelocidade();
}
function shuttleTras() {
  video.pause();
  shuttle = shuttle >= 0 ? -1 : Math.max(shuttle * 2, -4);
  ultimoShuttle = 0; atualizarVelocidade();
  requestAnimationFrame(laçoShuttle);
}
function atualizarVelocidade() {
  const el = $('velocidade');
  el.hidden = shuttle === 0 || shuttle === 1;
  el.textContent = shuttle < 0 ? `◀ ${-shuttle}×` : `${shuttle}×`;
}

function passoQuadro(dir) {
  pausar();
  const n = Math.round(estado.tempo * FPS) + dir;
  buscar(n / FPS + 0.001);
}

// ---------------------------------------------------------------------------
// Fonte 16:9 com crop arrastável; preview 9:16 por CSS sobre o mesmo vídeo
// ---------------------------------------------------------------------------
const canvasFonte = $('fonte-canvas');
const ctxFonte = canvasFonte.getContext('2d', { alpha: false });
const elCrop = $('crop');
const LARGURA_CROP = 9 / 16 / (16 / 9); // fração da largura da Fonte (608/1920 ≈ 0,316)

function desenharFonte() {
  if (video.readyState >= 2) ctxFonte.drawImage(video, 0, 0, canvasFonte.width, canvasFonte.height);
}

function aplicarCrop() {
  const b = bordasAtivas(); if (!b) return;
  const cx = Math.min(Math.max(b.cx, LARGURA_CROP / 2), 1 - LARGURA_CROP / 2);
  b.cx = cx;
  elCrop.style.left = `${(cx - LARGURA_CROP / 2) * 100}%`;
  elCrop.style.width = `${LARGURA_CROP * 100}%`;
  elCrop.setAttribute('aria-valuenow', String(Math.round(cx * 100)));
  // Preview: o vídeo tem a altura do quadro 9:16 e largura 16:9; desloca para mostrar o crop.
  const preview = $('preview');
  const h = preview.clientHeight, w = preview.clientWidth;
  const wv = h * 16 / 9;
  const esquerda = Math.min(0, Math.max(w - wv, w / 2 - cx * wv));
  video.style.width = `${wv}px`;
  video.style.height = `${h}px`;
  video.style.transform = `translateX(${esquerda}px)`;
  atualizarFicha();
}

(function crop() {
  let inicioX = 0, inicioCx = 0;
  elCrop.addEventListener('pointerdown', (e) => {
    elCrop.setPointerCapture(e.pointerId);
    inicioX = e.clientX; inicioCx = bordasAtivas().cx;
    elCrop.classList.add('arrastando');
  });
  elCrop.addEventListener('pointermove', (e) => {
    if (!elCrop.hasPointerCapture(e.pointerId)) return;
    const largura = canvasFonte.getBoundingClientRect().width;
    bordasAtivas().cx = inicioCx + (e.clientX - inicioX) / largura;
    bordasAtivas().modificado = true;
    aplicarCrop();
  });
  const soltar = (e) => {
    if (elCrop.hasPointerCapture(e.pointerId)) elCrop.releasePointerCapture(e.pointerId);
    elCrop.classList.remove('arrastando');
    lista.definir(estado.cortes, estado.ativo, estado.bordas);
  };
  elCrop.addEventListener('pointerup', soltar);
  elCrop.addEventListener('pointercancel', soltar);
  elCrop.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    bordasAtivas().cx += (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.05 : 0.01);
    bordasAtivas().modificado = true;
    aplicarCrop();
  });
  new ResizeObserver(aplicarCrop).observe($('preview'));
})();

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------
let timeline, legenda, transcricao, painelEstilo, lista, medidor;

function montarComponentes() {
  timeline = criarTimeline($('timeline'), {
    fps: FPS,
    aoBuscar(t, { arrastando }) {
      if (!video.paused) pausar();
      buscar(t, { exato: true });
      void arrastando;
    },
    aoMudarBordas({ inicio, fim }, { alca, arrastando, encaixou }) {
      mudarBordas(inicio, fim, { alca, arrastando, encaixou });
    },
  });

  legenda = criarLegenda($('legenda-palco'));

  transcricao = criarPainelTranscricao($('painel-transcricao'), {
    aoBuscar(t) { pausar(); buscar(t); },
    aoEditarPalavra(id, texto) {
      const original = estado.transcricao.palavras.find((p) => p.id === id)?.text;
      if (texto === original) estado.edicoes.delete(id); else estado.edicoes.set(id, texto);
      bordasAtivas().modificado = true;
      atualizarLegendaETimeline();
      lista.definir(estado.cortes, estado.ativo, estado.bordas);
    },
  });

  painelEstilo = criarPainelEstilo($('painel-estilo'), {
    aoMudar(estilo) {
      estado.estilo = estilo;
      legenda.definir({ palavras: palavrasDoCorte(), estilo });
      legenda.atualizar(estado.tempo);
    },
  });
  painelEstilo.definir(estado.estilo);

  lista = criarListaCortes($('lista-cortes'), { aoSelecionar: selecionarCorte });
}

// ---------------------------------------------------------------------------
// Bordas do Corte
// ---------------------------------------------------------------------------
let avisoTimer = 0;
function mudarBordas(inicio, fim, { alca, arrastando, encaixou } = {}) {
  const b = bordasAtivas();
  const [ja, jb] = estado.janela;
  inicio = Math.max(ja, inicio); fim = Math.min(jb, fim);
  if (fim - inicio < 1) return;
  b.inicio = inicio; b.fim = fim; b.modificado = true;
  timeline.definirBordas(inicio, fim);
  atualizarTemposBordas();
  if (alca) {
    // Mostra no preview o quadro exato da borda: no fim, o último quadro incluído.
    pausar();
    buscar(alca === 'inicio' ? inicio + 0.001 : fim - QUADRO + 0.001);
    mostrarAvisoBorda(alca, alca === 'inicio' ? inicio : fim, encaixou);
  }
  if (!arrastando) {
    recalcularSilencios();
    atualizarLegendaETimeline();
    lista.definir(estado.cortes, estado.ativo, estado.bordas);
    garantirJanela();
  }
}

function mostrarAvisoBorda(alca, t, encaixou) {
  const el = $('borda-aviso');
  el.hidden = false;
  el.dataset.alca = alca;
  $('borda-aviso-rotulo').textContent =
    (alca === 'inicio' ? 'Início' : 'Fim') + (encaixou === false ? ' · livre' : ' · borda de Frase');
  $('borda-aviso-tempo').textContent = fmt(t);
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, 1400);
}

function estender(lado, passo) {
  const b = bordasAtivas();
  const fr = estado.transcricao.frases;
  if (lado === 'inicio') {
    const i = fr.findIndex((f) => Math.abs(f.start - b.inicio) < 0.02);
    const atual = i >= 0 ? i : indiceFraseEm(b.inicio);
    const novo = fr[atual - passo];
    if (novo && novo.start < b.fim - 1) mudarBordas(novo.start, b.fim, { alca: 'inicio', arrastando: false, encaixou: true });
  } else {
    const i = fr.findIndex((f) => Math.abs(f.end - b.fim) < 0.02);
    const atual = i >= 0 ? i : indiceFraseEm(b.fim);
    const novo = fr[atual + passo];
    if (novo && novo.end > b.inicio + 1) mudarBordas(b.inicio, novo.end, { alca: 'fim', arrastando: false, encaixou: true });
  }
}

function marcar(lado, alt) {
  const b = bordasAtivas();
  let t = estado.tempo;
  if (!alt) t = encaixar(t, lado === 'inicio' ? 'start' : 'end');
  else t = Math.round(t * FPS) / FPS;
  if (lado === 'inicio' && t < b.fim - 1) mudarBordas(t, b.fim, { alca: 'inicio', encaixou: !alt });
  if (lado === 'fim' && t > b.inicio + 1) mudarBordas(b.inicio, t, { alca: 'fim', encaixou: !alt });
}

function atualizarTemposBordas() {
  const b = bordasAtivas();
  const dur = b.fim - b.inicio;
  $('tempo-inicio').textContent = fmt(b.inicio);
  $('tempo-fim').textContent = fmt(b.fim);
  const saida = estado.silencio.ativo && estado.silencio.mapa ? estado.silencio.mapa.duracao : dur;
  $('tempo-duracao').textContent = `/ ${fmt(dur, 1)}`;
  $('corte-detalhe').textContent =
    `${fmt(dur, 1)} na Fonte, de ${fmtCurto(b.inicio)} a ${fmtCurto(b.fim)}` +
    (estado.silencio.ativo ? ` · ${fmt(saida, 1)} sem silêncios` : '');
}

// ---------------------------------------------------------------------------
// Silêncios
// ---------------------------------------------------------------------------
function recalcularSilencios() {
  const s = estado.silencio;
  const b = bordasAtivas();
  if (!s.ativo) {
    s.removidos = []; s.mapa = null;
    timeline?.definirSilencios([]);
    $('silencio-resumo').textContent = '';
    atualizarTemposBordas();
    return;
  }
  const palavras = palavrasDoCorte();
  s.removidos = detectarPausas(palavras, b.inicio, b.fim, s.limiar);
  s.mapa = criarMapa(trechosMantidos(b.inicio, b.fim, s.removidos));
  timeline?.definirSilencios(s.removidos);
  const total = s.removidos.reduce((acc, [a, z]) => acc + (z - a), 0);
  $('silencio-resumo').textContent = s.removidos.length
    ? `−${fmtVirgula(total)} s em ${s.removidos.length} ${s.removidos.length === 1 ? 'pausa' : 'pausas'}`
    : 'Nenhuma pausa acima do limite';
  atualizarTemposBordas();
}

$('silencio-ativo').addEventListener('change', (e) => {
  estado.silencio.ativo = e.target.checked;
  recalcularSilencios();
});
$('silencio-limiar').addEventListener('change', (e) => {
  estado.silencio.limiar = Number(e.target.value);
  recalcularSilencios();
});

// ---------------------------------------------------------------------------
// Seleção de Corte, janela, proxy, onda
// ---------------------------------------------------------------------------
function atualizarLegendaETimeline() {
  const b = bordasAtivas();
  legenda.definir({ palavras: palavrasDoCorte(), estilo: estado.estilo });
  legenda.atualizar(estado.tempo);
  const frases = itensNaJanela(estado.transcricao.frases, estado.janela);
  const palavras = palavrasDaJanela();
  timeline.definirDados({ janela: estado.janela, frases, palavras, inicio: b.inicio, fim: b.fim });
  // O painel usa os índices globais i0/i1 das Frases: recebe a lista completa e aplica as edições sozinho.
  transcricao.definir({ frases, palavras: estado.transcricao.palavras, inicio: b.inicio, fim: b.fim, edicoes: estado.edicoes });
}

function definirJanela() {
  const b = bordasAtivas();
  const dur = estado.transcricao.fonte.duracao;
  estado.janela = [Math.max(0, Math.floor(b.inicio - MARGEM_JANELA)), Math.min(dur, Math.ceil(b.fim + MARGEM_JANELA))];
}

/** Se a borda chegou perto da beira da janela, recentra e gera outro proxy. */
function garantirJanela() {
  const b = bordasAtivas();
  const [a, z] = estado.janela;
  const dur = estado.transcricao.fonte.duracao;
  if ((b.inicio - a < 20 && a > 0) || (z - b.fim < 20 && z < dur)) {
    definirJanela();
    atualizarLegendaETimeline();
    carregarMidiaDaJanela();
  }
}

let geracao = 0;
function carregarMidiaDaJanela() {
  const minha = ++geracao;
  const [a, z] = estado.janela;
  timeline.definirMiniaturas(null);
  timeline.definirOnda(null);
  timeline.definirProgressoMidia('Gerando miniaturas…');

  invocar('gerar_onda', { inicio: a, fim: z }).then((onda) => {
    if (minha !== geracao) return;
    const picos = Float32Array.from(onda.picos, (v) => v / 1000);
    timeline.definirOnda({ picos, porSegundo: onda.porSegundo, inicio: onda.inicio });
  }).catch((e) => console.error('onda', e));

  const chave = chaveDe(a, z);
  const pronto = estado.proxies.get(chave);
  if (pronto) { usarProxy(pronto); return; }
  // Enquanto o proxy não fica pronto, o preview usa a Fonte direta.
  if (estado.midia.tipo !== 'fonte') trocarMidia('fonte', ARQUIVO_FONTE, 0);
  estado.midia.pct = 0; estado.midia.chaveEsperada = chave;
  mostrarStatusMidia();
  invocar('gerar_proxy', { inicio: a, fim: z }).then((p) => {
    estado.proxies.set(p.chave, p);
    if (minha === geracao) usarProxy(p);
  }).catch((e) => {
    console.error('proxy', e);
    if (minha === geracao) { estado.midia.erro = String(e); mostrarStatusMidia(); }
  });
}

function chaveDe(a, z) {
  const p = (n) => String(Math.floor(n)).padStart(5, '0');
  return `${p(Math.max(0, Math.floor(a)))}-${p(Math.ceil(z))}`;
}

function usarProxy(p) {
  console.log(`[proxy] ${p.chave} pronto: ${p.emCache ? "cache" : `${p.encoder}, ${p.segundos.toFixed(1)} s`}`);
  trocarMidia('proxy', p.proxy, p.inicio, p.chave);
  timeline.definirProgressoMidia(null);
  timeline.definirMiniaturas({ ...p.miniaturas, url: urlMidia(p.miniaturas.url) });
  mostrarStatusMidia();
}

ouvir('proxy-progresso', ({ chave, pct }) => {
  if (chave !== estado.midia.chaveEsperada || estado.midia.tipo === 'proxy') return;
  estado.midia.pct = pct;
  timeline.definirProgressoMidia(`Gerando proxy e miniaturas… ${Math.round(pct * 100)}%`);
  mostrarStatusMidia();
});

function mostrarStatusMidia() {
  const m = estado.midia;
  const el = $('midia-status');
  el.dataset.tipo = m.tipo;
  if (m.erro) {
    $('midia-status-texto').textContent = 'Falha no proxy · usando a Fonte direta';
  } else if (m.tipo === 'proxy') {
    $('midia-status-texto').textContent = 'Proxy 540p';
  } else {
    $('midia-status-texto').textContent = `Fonte direta · proxy ${Math.round((m.pct || 0) * 100)}%`;
  }
  $('midia-status-pct').style.width = `${Math.round((m.tipo === 'proxy' ? 1 : m.pct || 0) * 100)}%`;
}

function selecionarCorte(id) {
  if (estado.ativo === id) return;
  pausar();
  const c = estado.cortes.find((x) => x.id === id);
  if (!estado.bordas[id]) {
    estado.bordas[id] = {
      inicio: encaixar(c.inicio, 'start'), fim: encaixar(c.fim, 'end'), cx: c.crop?.cx ?? 0.5, modificado: false,
    };
  }
  estado.ativo = id;
  estado.midia.erro = null;
  const b = bordasAtivas();
  definirJanela();
  $('corte-nome').textContent = c.titulo;
  lista.definir(estado.cortes, estado.ativo, estado.bordas);
  recalcularSilencios();
  atualizarLegendaETimeline();
  timeline.definirBordas(b.inicio, b.fim);
  timeline.ajustarAoCorte();
  aplicarCrop();
  atualizarTemposBordas();
  estado.tempo = b.inicio;
  carregarMidiaDaJanela();
  buscar(b.inicio + 0.001);
}

function atualizarFicha() {
  const b = bordasAtivas(); if (!b) return;
  const x = Math.round(b.cx * 1920 - 304);
  const linhas = [
    ['Enquadramento', `x ${x} px de 1920 · 608 × 1080 → 1080 × 1920`],
    ['Fonte', `${estado.transcricao.fonte.largura} × ${estado.transcricao.fonte.altura}, ${FPS} fps, GOP de 10 s`],
  ];
  const ficha = $('ficha');
  ficha.replaceChildren(...linhas.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------
const dialogo = $('exportacao');
let exportando = false;
let ultimoExport = null;

async function exportar() {
  if (exportando) return;
  exportando = true;
  pausar();
  const c = corteAtivo(), b = bordasAtivas();
  const palavras = palavrasDoCorte();
  const grupos = agruparPalavras(palavras, estado.estilo.palavrasPorLinha)
    .map((g) => ({ ...g, end: Math.min(g.end, b.fim) }));
  const trechos = estado.silencio.ativo && estado.silencio.removidos.length
    ? trechosMantidos(b.inicio, b.fim, estado.silencio.removidos)
    : [[b.inicio, b.fim]];
  const mapa = criarMapa(trechos);
  const ass = gerarAss({ grupos, estilo: estado.estilo, mapearTempo: (t) => mapa.paraSaida(t) });

  $('exp-titulo').textContent = `Exportando “${c.titulo}”`;
  $('exp-detalhe').textContent =
    `1080 × 1920 · ${fmt(mapa.duracao, 1)}` + (trechos.length > 1 ? ` · ${trechos.length - 1} silêncios removidos` : '');
  $('exp-pct').textContent = '0%';
  $('exp-pct-barra').style.width = '0%';
  $('exp-encoder').textContent = '';
  $('exp-caminho').hidden = true;
  $('exp-abrir').hidden = true;
  $('exp-fechar').hidden = true;
  dialogo.dataset.estado = 'andamento';
  dialogo.showModal();
  try {
    const r = await invocar('exportar', {
      pedido: { id: c.id, titulo: c.titulo, inicio: b.inicio, fim: b.fim, trechos, cropCx: b.cx, ass },
    });
    ultimoExport = r;
    dialogo.dataset.estado = 'pronto';
    $('exp-titulo').textContent = 'Corte exportado';
    $('exp-pct').textContent = '100%';
    $('exp-pct-barra').style.width = '100%';
    $('exp-encoder').textContent =
      `${r.encoder === 'h264_nvenc' ? 'NVENC' : 'x264'} · ${fmtVirgula(r.segundos)} s para ${fmtVirgula(r.duracao)} s de vídeo`;
    $('exp-caminho').textContent = r.caminho;
    $('exp-caminho').hidden = false;
    $('exp-abrir').hidden = false;
    $('exp-fechar').hidden = false;
    $('exp-fechar').focus();
    if (!window.__semAbrirPasta) invocar('abrir_pasta', { caminho: r.caminho });
  } catch (e) {
    dialogo.dataset.estado = 'erro';
    $('exp-titulo').textContent = 'A exportação falhou';
    $('exp-caminho').textContent = String(e).slice(0, 600);
    $('exp-caminho').hidden = false;
    $('exp-fechar').hidden = false;
  } finally {
    exportando = false;
  }
}

ouvir('exportar-progresso', ({ pct, etapa }) => {
  if (dialogo.dataset.estado !== 'andamento') return;
  $('exp-pct').textContent = `${Math.round(pct * 100)}%`;
  $('exp-pct-barra').style.width = `${pct * 100}%`;
  $('exp-encoder').textContent = etapa === 'h264_nvenc' ? 'Codificando com NVENC' : 'Codificando com x264';
});
$('exportar').addEventListener('click', exportar);
$('exp-fechar').addEventListener('click', () => dialogo.close());
$('exp-abrir').addEventListener('click', () => ultimoExport && invocar('abrir_pasta', { caminho: ultimoExport.caminho }));

// ---------------------------------------------------------------------------
// Controles e atalhos
// ---------------------------------------------------------------------------
$('tocar').addEventListener('click', alternarTocar);
$('ir-inicio').addEventListener('click', () => { pausar(); buscar(bordasAtivas().inicio + 0.001); });
$('ir-fim').addEventListener('click', () => { pausar(); buscar(bordasAtivas().fim - QUADRO + 0.001); });
$('zoom-mais').addEventListener('click', () => timeline.definirZoom(timeline.obterZoom() * 1.5, estado.tempo));
$('zoom-menos').addEventListener('click', () => timeline.definirZoom(timeline.obterZoom() / 1.5, estado.tempo));
$('zoom-ajustar').addEventListener('click', () => timeline.ajustarAoCorte());
document.querySelectorAll('[data-estender]').forEach((bt) => {
  bt.addEventListener('click', () => {
    const [lado, passo] = bt.dataset.estender.split(':');
    estender(lado, Number(passo));
  });
});

for (const aba of document.querySelectorAll('.aba')) {
  aba.addEventListener('click', () => {
    for (const outra of document.querySelectorAll('.aba')) {
      const ativa = outra === aba;
      outra.setAttribute('aria-selected', String(ativa));
      $(outra.getAttribute('aria-controls')).hidden = !ativa;
    }
  });
}

function emEdicaoDeTexto(alvo) {
  return alvo.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(alvo.tagName);
}

document.addEventListener('keydown', (e) => {
  if (!estado.ativo || emEdicaoDeTexto(e.target) || dialogo.open) return;
  // Usa a tecla física (code) e cai para e.key quando o code vem vazio (teclados virtuais, automação).
  const tecla = e.code || ({ ' ': 'Space', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' }[e.key] ?? `Key${e.key.toUpperCase()}`);
  if (e.ctrlKey && e.shiftKey && tecla === 'KeyM') { e.preventDefault(); medidor.rodar(); return; }
  if (e.ctrlKey || e.metaKey) return;
  switch (tecla) {
    case 'Space': e.preventDefault(); alternarTocar(); break;
    case 'KeyK': pausar(); break;
    case 'KeyL': shuttleFrente(); break;
    case 'KeyJ': shuttleTras(); break;
    case 'ArrowLeft': e.preventDefault(); passoQuadro(-1); break;
    case 'ArrowRight': e.preventDefault(); passoQuadro(1); break;
    case 'KeyI': e.preventDefault(); marcar('inicio', e.altKey); break;
    case 'KeyO': e.preventDefault(); marcar('fim', e.altKey); break;
    default: return;
  }
});
// Alt sozinho abre o menu do sistema no Windows; impede para Alt+arrasto funcionar bem.
document.addEventListener('keyup', (e) => { if (e.key === 'Alt') e.preventDefault(); });

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
async function iniciar() {
  const info = await invocar('info');
  if (!info.fontePronta || !info.transcricaoPronta) {
    $('fonte-nome').textContent = 'Mídia ausente: rode npm run preparar';
    return;
  }
  const [transcricao, cortes] = await Promise.all([
    fetch(urlMidia('transcript.json')).then((r) => r.json()),
    fetch('dados/cortes.json').then((r) => r.json()),
  ]);
  estado.transcricao = transcricao;
  estado.cortes = cortes;
  const f = transcricao.fonte;
  $('fonte-nome').textContent = `Tears of Steel, repetido ${f.copias}× · ${fmtCurto(f.duracao)}`;
  montarComponentes();
  medidor = criarMedidor({ video, estado, buscar, timeline, invocar, mudarBordas, bordasAtivas, pausar });
  video.src = urlMidia(ARQUIVO_FONTE);
  estado.midia = { tipo: 'fonte', offset: 0, url: video.src, chaveProxy: null, pct: 0 };
  selecionarCorte(cortes[0].id);
  window.clipes = { estado, selecionarCorte, mudarBordas, exportar, buscar, medidor, timeline, painelEstilo, estender };
}

// Depuração do protótipo: se media/depurar.js existir, roda o conteúdo (quando muda) e loga o resultado.
let ultimoDepurar = '';
setInterval(async () => {
  try {
    const r = await fetch(urlMidia('depurar.js'), { cache: 'no-store' });
    if (!r.ok) return;
    const codigo = await r.text();
    if (codigo === ultimoDepurar) return;
    ultimoDepurar = codigo;
    const res = await new Function('clipes', `return (async () => { ${codigo} })()`)(window.clipes);
    console.log('[depurar]', res);
  } catch (e) { console.error('[depurar]', e); }
}, 1000);

iniciar().catch((e) => {
  console.error(e);
  $('fonte-nome').textContent = `Erro ao iniciar: ${e}`;
});
