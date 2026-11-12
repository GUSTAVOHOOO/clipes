// Timeline do editor de Cortes, desenhada num único <canvas>:
// régua, miniaturas, forma de onda, palavras/frases, alças do Corte e playhead.
//
// Tempos em segundos da Fonte. Coordenadas em px CSS relativas ao container.
// O desenho é sob demanda: só agenda um quadro (requestAnimationFrame) quando algo mudou.

const ALTURA_REGUA = 24;
const ALTURA_MINIATURAS = 54;
const ALTURA_ONDA = 46;
const ALTURA_PALAVRAS = 34;
const ESPACO = 4;                 // respiro entre trilhas
const RAIO = 4;                   // cantos das trilhas, blocos e rótulos
const ZOOM_MAXIMO = 400;          // px por segundo
const ZOOM_INICIAL = 50;
const TOLERANCIA_ALCA = 7;        // px de captura em torno da linha da alça
const LARGURA_ABA = 10;           // aba da alça, para dentro do Corte
const MARGEM_AUTOROLAGEM = 30;    // px da borda que dispara a rolagem durante arrasto
const VELOCIDADE_AUTOROLAGEM = 900; // px/s na borda do container
const DURACAO_MINIMA = 1;         // s, mínimo entre início e fim do Corte
const ESPACO_MINIMO_REGUA = 70;   // px mínimos entre rótulos da régua
// Passos da régua. Os últimos (acima de 60 s) cobrem zoom muito baixo sobre a janela inteira.
const PASSOS_REGUA = [1 / 24, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const MIN_TEXTO_PALAVRA = 14;     // px de largura para escrever uma palavra
const MIN_TEXTO_FRASE = 24;       // px de largura para escrever o texto da frase inteira
const MIN_SEPARADOR = 3;          // px por palavra para desenhar separadores
const PADDING_BLOCO = 3;          // respiro vertical dos blocos de Frase
const TRACEJADO = [4, 3];

const Y_MINIATURAS = ALTURA_REGUA + ESPACO;
const Y_ONDA = Y_MINIATURAS + ALTURA_MINIATURAS + ESPACO;
const Y_PALAVRAS = Y_ONDA + ALTURA_ONDA + ESPACO;
const Y_BASE = Y_PALAVRAS + ALTURA_PALAVRAS;

const TRILHA_MINIATURAS = { nome: 'miniaturas', y: Y_MINIATURAS, h: ALTURA_MINIATURAS };
const TRILHA_ONDA = { nome: 'onda', y: Y_ONDA, h: ALTURA_ONDA };
const TRILHA_PALAVRAS = { nome: 'palavras', y: Y_PALAVRAS, h: ALTURA_PALAVRAS };

// [chave interna, variável CSS, valor padrão escuro usado quando a variável está vazia]
const VARIAVEIS_COR = [
  ['fundo', '--tl-fundo', '#101216'],
  ['trilha', '--tl-trilha', '#1b1e25'],
  ['linha', '--tl-linha', '#2b303a'],
  ['texto', '--tl-texto', '#e8eaf0'],
  ['textoFraco', '--tl-texto-fraco', '#8b93a3'],
  ['fraseA', '--tl-frase-a', '#34456b'],
  ['fraseB', '--tl-frase-b', '#2a3857'],
  ['onda', '--tl-onda', '#4b5566'],
  ['ondaCorte', '--tl-onda-corte', '#7fb0ff'],
  ['alca', '--tl-alca', '#f5b041'],
  ['playhead', '--tl-playhead', '#ff4d5e'],
  ['silencio', '--tl-silencio', 'rgba(255, 90, 90, 0.6)'],
  ['fora', '--tl-fora', 'rgba(0, 0, 0, 0.55)'],
];
const FONTE_PADRAO = '"Segoe UI", system-ui, sans-serif';

// ---------------------------------------------------------------------------
// Funções puras (sem estado do canvas)
// ---------------------------------------------------------------------------

function limitar(valor, min, max) {
  return valor < min ? min : valor > max ? max : valor;
}

// Primeiro índice em `arr` (ordenado) com arr[i] >= valor, dentro de [lo, hi).
function primeiroIndiceGE(arr, valor, lo = 0, hi = arr.length) {
  while (lo < hi) {
    const meio = (lo + hi) >>> 1;
    if (arr[meio] < valor) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

// Primeiro índice em `arr` (ordenado) com arr[i] > valor.
function primeiroIndiceGT(arr, valor) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const meio = (lo + hi) >>> 1;
    if (arr[meio] <= valor) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

function ordenarPor(lista, campo) {
  const ordenada = lista.every((item, i) => i === 0 || lista[i - 1][campo] <= item[campo]);
  return ordenada ? lista : [...lista].sort((p, q) => p[campo] - q[campo]);
}

// Junta cada Frase às suas palavras pelo id (não pelos índices do contrato,
// que valem para a lista completa e não para a janela recebida).
function indexarFrases(frases, palavras) {
  const intervalos = new Map();
  palavras.forEach((p, i) => {
    const r = intervalos.get(p.frase);
    if (r) r.i1 = i;
    else intervalos.set(p.frase, { i0: i, i1: i });
  });
  return frases.map((f) => {
    const r = intervalos.get(f.id);
    return {
      start: f.start,
      end: f.end,
      texto: f.texto ?? '',
      i0: r ? r.i0 : -1,
      i1: r ? r.i1 : -1,
    };
  });
}

// Menor passo da lista que deixa pelo menos ESPACO_MINIMO_REGUA px entre rótulos.
function passoRegua(pps) {
  for (const passo of PASSOS_REGUA) {
    if (passo * pps >= ESPACO_MINIMO_REGUA) return passo;
  }
  return Math.ceil(ESPACO_MINIMO_REGUA / pps / 3600) * 3600;
}

// Tempo como m:ss (ou h:mm:ss); `casas` > 0 acrescenta decimais (ex.: 0:01.5).
function formatarTempo(t, casas = 0) {
  const total = Math.max(0, t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const segundos =
    casas > 0
      ? s.toFixed(casas).padStart(casas + 3, '0')
      : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${segundos}` : `${m}:${segundos}`;
}

// Tempo com quadro, m:ss.ff (ff = quadro dentro do segundo).
function formatarComQuadro(t, fps) {
  const total = Math.max(0, Math.round(t * fps));
  const segundos = Math.floor(total / fps);
  const quadro = total % fps;
  const h = Math.floor(segundos / 3600);
  const m = Math.floor(segundos / 60) % 60;
  const s = segundos % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const parteMinutos = h > 0 ? `${h}:${pad(m)}` : `${m}`;
  return `${parteMinutos}:${pad(s)}.${pad(quadro)}`;
}

// Maior amplitude da forma de onda entre t0 e t1 (pelo menos uma amostra).
function picoEntre(onda, t0, t1) {
  const n = onda.picos.length;
  let i0 = Math.floor((t0 - onda.inicio) * onda.porSegundo);
  let i1 = Math.ceil((t1 - onda.inicio) * onda.porSegundo);
  if (i1 <= i0) i1 = i0 + 1;
  i0 = Math.max(0, i0);
  i1 = Math.min(n, i1);
  let maximo = 0;
  for (let i = i0; i < i1; i++) {
    if (onda.picos[i] > maximo) maximo = onda.picos[i];
  }
  return maximo;
}

// Borda (início ou fim de Frase) mais próxima de `t` dentro de [lo, hi], ou null.
function bordaMaisProxima(bordas, t, lo, hi) {
  const iLo = primeiroIndiceGE(bordas, lo);
  const iHi = primeiroIndiceGT(bordas, hi);
  if (iLo >= iHi) return null;
  const k = primeiroIndiceGE(bordas, t, iLo, iHi);
  let melhor = k < iHi ? k : k - 1;
  if (k - 1 >= iLo && Math.abs(bordas[k - 1] - t) <= Math.abs(bordas[melhor] - t)) {
    melhor = k - 1;
  }
  return bordas[melhor];
}

// Velocidade de rolagem (px/s) enquanto o ponteiro está na borda do container.
function velocidadeNaBorda(x, largura) {
  if (x < MARGEM_AUTOROLAGEM) {
    return -VELOCIDADE_AUTOROLAGEM * Math.min(2, 1 - x / MARGEM_AUTOROLAGEM);
  }
  if (x > largura - MARGEM_AUTOROLAGEM) {
    return VELOCIDADE_AUTOROLAGEM * Math.min(2, 1 - (largura - x) / MARGEM_AUTOROLAGEM);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function criarTimeline(container, opcoes = {}) {
  const fps = opcoes.fps ?? 24;
  const aoBuscar = opcoes.aoBuscar ?? (() => {});
  const aoMudarBordas = opcoes.aoMudarBordas ?? (() => {});

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const cores = {};
  let fonteRotulo = `11px ${FONTE_PADRAO}`;
  let cursorAtual = '';
  let mudouPosicao = false;
  const posicaoOriginal = container.style.position;

  const estado = {
    largura: 0,
    altura: 0,
    dpr: 1,
    pps: ZOOM_INICIAL,           // px por segundo
    vistaInicio: 0,              // tempo da Fonte no x = 0
    zoomDefinido: false,
    precisaAjustar: false,       // ajustarAoCorte pedido antes de haver largura
    janela: { a: 0, b: 0 },
    frases: [],                  // { start, end, texto, i0, i1 } (i0/i1 em palavras; -1 se não há palavras)
    frIni: new Float64Array(0),
    frFim: new Float64Array(0),
    palTextos: [],
    palIni: new Float64Array(0),
    palFim: new Float64Array(0),
    inicio: 0,
    fim: 0,
    tempo: 0,
    silIni: new Float64Array(0),
    silFim: new Float64Array(0),
    miniaturas: null,
    onda: null,
    progresso: null,
    imagens: new Map(),          // url -> Image (uma por url)
    arrasto: null,               // { tipo: 'alca'|'busca', alca, id, x, alt, encaixou }
    rafId: 0,
    sujo: true,
    ultimoTs: 0,
    destruido: false,
  };

  // --- coordenadas --------------------------------------------------------

  function xDoTempo(t) {
    return (t - estado.vistaInicio) * estado.pps;
  }

  function tempoEmX(x) {
    return estado.vistaInicio + x / estado.pps;
  }

  function xDoEvento(e) {
    return e.clientX - canvas.getBoundingClientRect().left;
  }

  // --- agendamento do desenho --------------------------------------------

  function marcarSujo() {
    if (estado.destruido) return;
    estado.sujo = true;
    agendar();
  }

  function agendar() {
    if (!estado.rafId && !estado.destruido) {
      estado.rafId = requestAnimationFrame(quadro);
    }
  }

  function quadro(ts) {
    estado.rafId = 0;
    if (estado.destruido) return;
    if ((globalThis.devicePixelRatio || 1) !== estado.dpr) medir();
    rolarNaBorda(ts);
    if (estado.sujo) desenhar();
  }

  // --- medida, cores e zoom ----------------------------------------------

  function lerCores() {
    const estilo = getComputedStyle(container);
    for (const [chave, variavel, padrao] of VARIAVEIS_COR) {
      cores[chave] = estilo.getPropertyValue(variavel).trim() || padrao;
    }
    const fonte = estilo.getPropertyValue('--tl-fonte').trim() || FONTE_PADRAO;
    fonteRotulo = `11px ${fonte}`;
  }

  function medir() {
    const largura = container.clientWidth;
    const altura = container.clientHeight;
    const dpr = globalThis.devicePixelRatio || 1;
    estado.largura = largura;
    estado.altura = altura;
    estado.dpr = dpr;
    const pxLargura = Math.round(largura * dpr);
    const pxAltura = Math.round(altura * dpr);
    if (canvas.width !== pxLargura) canvas.width = pxLargura;
    if (canvas.height !== pxAltura) canvas.height = pxAltura;
    lerCores();
    if (estado.precisaAjustar) ajustarAoCorte();
    estado.pps = limitarZoom(estado.pps);
    prenderVista();
    marcarSujo();
  }

  // Zoom mínimo = janela inteira cabe na largura; máximo = ZOOM_MAXIMO.
  function zoomMinimo() {
    const duracao = estado.janela.b - estado.janela.a;
    if (duracao <= 0 || estado.largura <= 0) return 1e-3;
    return Math.min(estado.largura / duracao, ZOOM_MAXIMO);
  }

  function limitarZoom(pps) {
    return limitar(pps, zoomMinimo(), ZOOM_MAXIMO);
  }

  // Mantém a vista presa à janela.
  function prenderVista() {
    const { a, b } = estado.janela;
    const visivel = estado.largura / estado.pps;
    estado.vistaInicio = limitar(estado.vistaInicio, a, Math.max(a, b - visivel));
  }

  // Zoom mantendo `ancoraT` na posição x (px) que ela ocupa agora.
  function aplicarZoom(pps, ancoraT, x) {
    if (!Number.isFinite(pps)) return;
    estado.pps = limitarZoom(pps);
    estado.vistaInicio = ancoraT - x / estado.pps;
    estado.zoomDefinido = true;
    prenderVista();
    marcarSujo();
  }

  function definirZoom(pps, ancoraT) {
    const x = ancoraT === undefined ? estado.largura / 2 : xDoTempo(ancoraT);
    aplicarZoom(pps, ancoraT ?? tempoEmX(x), x);
  }

  // Zoom e rolagem para o Corte ocupar ~80% da largura, centralizado.
  function ajustarAoCorte() {
    if (estado.largura <= 0) {
      estado.precisaAjustar = true;
      return;
    }
    estado.precisaAjustar = false;
    const duracao = Math.max(estado.fim - estado.inicio, DURACAO_MINIMA);
    estado.pps = limitarZoom((0.8 * estado.largura) / duracao);
    estado.zoomDefinido = true;
    estado.vistaInicio = (estado.inicio + estado.fim) / 2 - estado.largura / (2 * estado.pps);
    prenderVista();
    marcarSujo();
  }

  // --- desenho: régua, trilhas, Corte, playhead ---------------------------

  function desenhar() {
    estado.sujo = false;
    const { largura, altura, dpr } = estado;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = fonteRotulo;
    ctx.textBaseline = 'middle';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = cores.fundo;
    ctx.fillRect(0, 0, largura, altura);

    desenharRegua();
    desenharTrilha(TRILHA_MINIATURAS, desenharMiniaturas);
    desenharTrilha(TRILHA_ONDA, desenharOnda);
    desenharTrilha(TRILHA_PALAVRAS, desenharPalavras);
    desenharBordasDoCorte();
    desenharAlca(Math.round(xDoTempo(estado.inicio)), true);
    desenharAlca(Math.round(xDoTempo(estado.fim)), false);
    desenharArrasto();
    desenharPlayhead();
  }

  function desenharRegua() {
    const pps = estado.pps;
    const passo = passoRegua(pps);
    const sub = passo >= 0.5 ? 5 : 1;     // marcações menores entre os rótulos
    const menor = passo / sub;
    const casas = passo >= 1 ? 0 : passo >= 0.5 ? 1 : 2;

    ctx.fillStyle = cores.linha;
    ctx.fillRect(0, ALTURA_REGUA - 1, estado.largura, 1);
    ctx.fillStyle = cores.textoFraco;
    // Limite de marcações visíveis: o laço nunca gira sem fim, mesmo com valor inválido.
    const maximo = Math.ceil(estado.largura / (menor * pps)) + 2;
    const primeiro = Math.ceil(estado.vistaInicio / menor);
    for (let i = 0; i < maximo; i++) {
      const k = primeiro + i;
      const t = k * menor;
      const pxX = Math.floor(xDoTempo(t));
      const maior = k % sub === 0;
      const altura = maior ? 8 : 4;
      ctx.fillRect(pxX, ALTURA_REGUA - altura, 1, altura);
      if (maior) ctx.fillText(formatarTempo(t, casas), pxX + 4, ALTURA_REGUA / 2);
    }
  }

  function caminhoTrilha(tr) {
    ctx.beginPath();
    ctx.roundRect(0, tr.y, estado.largura, tr.h, RAIO);
  }

  // Fundo arredondado da trilha, conteúdo recortado nele e, por cima, as sobreposições.
  function desenharTrilha(tr, conteudo) {
    caminhoTrilha(tr);
    ctx.fillStyle = cores.trilha;
    ctx.fill();
    ctx.save();
    caminhoTrilha(tr);
    ctx.clip();
    conteudo(tr);
    desenharForaDoCorte(tr);
    desenharSilencios(tr);
    ctx.restore();
  }

  function preencherFaixa(x0, x1, y, h) {
    const a = Math.max(0, x0);
    const b = Math.min(estado.largura, x1);
    if (b > a) ctx.fillRect(a, y, b - a, h);
  }

  function desenharForaDoCorte(tr) {
    const { a, b } = estado.janela;
    ctx.fillStyle = cores.fora;
    preencherFaixa(xDoTempo(a), xDoTempo(estado.inicio), tr.y, tr.h);
    preencherFaixa(xDoTempo(estado.fim), xDoTempo(b), tr.y, tr.h);
  }

  // --- trilha de miniaturas ----------------------------------------------

  function desenharProgresso(tr) {
    if (!estado.progresso) return;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = cores.textoFraco;
    ctx.fillText(estado.progresso, 12, tr.y + tr.h / 2);
    ctx.restore();
  }

  function desenharMiniaturas(tr) {
    const m = estado.miniaturas;
    if (!m || !m.imagem.complete || m.imagem.naturalWidth === 0) {
      desenharProgresso(tr);
      return;
    }
    // Ladrilhos de 16:9 com a altura da trilha, ancorados no início da janela.
    const lt = (tr.h * 16) / 9;
    const x0 = xDoTempo(estado.janela.a);
    const kIni = Math.max(0, Math.floor(-x0 / lt));
    const kFim = Math.ceil((estado.largura - x0) / lt);
    const total = m.colunas * m.linhas;
    for (let k = kIni; k <= kFim; k++) {
      const x = x0 + k * lt;
      // Célula do tempo no início do ladrilho.
      const idx = limitar(Math.floor((tempoEmX(x) - m.inicio) / m.intervalo), 0, total - 1);
      const sx = (idx % m.colunas) * m.larguraCelula;
      const sy = Math.floor(idx / m.colunas) * m.alturaCelula;
      ctx.drawImage(m.imagem, sx, sy, m.larguraCelula, m.alturaCelula, x, tr.y, lt, tr.h);
    }
  }

  // --- trilha de forma de onda -------------------------------------------

  function desenharOnda(tr) {
    const onda = estado.onda;
    if (!onda || onda.picos.length === 0 || onda.porSegundo <= 0) {
      desenharProgresso(tr);
      return;
    }
    const meio = tr.y + tr.h / 2;
    const amplitude = tr.h / 2 - 3;
    const xI = xDoTempo(estado.inicio);
    const xF = xDoTempo(estado.fim);
    let corAtual = '';
    for (let x = 0; x < estado.largura; x++) {
      const t0 = tempoEmX(x);
      const pico = picoEntre(onda, t0, t0 + 1 / estado.pps);
      const h = Math.max(1, pico * amplitude * 2);
      const cor = x >= xI && x <= xF ? cores.ondaCorte : cores.onda;
      if (cor !== corAtual) {
        ctx.fillStyle = cor;
        corAtual = cor;
      }
      ctx.fillRect(x, meio - h / 2, 1, h);
    }
  }

  // --- trilha de palavras e frases ---------------------------------------

  function desenharPalavras(tr) {
    const vB = estado.vistaInicio + estado.largura / estado.pps;
    const n = estado.frIni.length;
    for (
      let k = primeiroIndiceGE(estado.frFim, estado.vistaInicio);
      k < n && estado.frIni[k] < vB;
      k++
    ) {
      desenharFrase(k, tr);
    }
  }

  function desenharFrase(k, tr) {
    const frase = estado.frases[k];
    const x0 = xDoTempo(estado.frIni[k]);
    const x1 = xDoTempo(estado.frFim[k]);
    const y = tr.y + PADDING_BLOCO;
    const h = tr.h - 2 * PADDING_BLOCO;
    ctx.fillStyle = k % 2 === 0 ? cores.fraseA : cores.fraseB;
    ctx.beginPath();
    ctx.roundRect(x0, y, Math.max(1, x1 - x0), h, RAIO);
    ctx.fill();

    // Texto: palavras se alguma couber; senão o texto da frase; senão só o bloco.
    const comPalavra = frase.i0 >= 0 && desenharPalavrasDaFrase(frase, x0, x1, y, h);
    if (!comPalavra) desenharTextoFrase(frase.texto, x0, x1, y, h);
  }

  function desenharPalavrasDaFrase(frase, x0, x1, y, h) {
    const porPalavra = (x1 - x0) / (frase.i1 - frase.i0 + 1);
    const separar = porPalavra >= MIN_SEPARADOR;
    let algumTexto = false;
    let j = primeiroIndiceGE(estado.palFim, estado.vistaInicio, frase.i0, frase.i1 + 1);
    for (; j <= frase.i1; j++) {
      const px0 = xDoTempo(estado.palIni[j]);
      if (px0 > estado.largura) break;
      const px1 = xDoTempo(estado.palFim[j]);
      if (separar && j > frase.i0) desenharSeparador(px0, y, h);
      if (px1 - px0 >= MIN_TEXTO_PALAVRA && desenharTextoCortado(estado.palTextos[j], px0, px1, y, h)) {
        algumTexto = true;
      }
    }
    return algumTexto;
  }

  function desenharSeparador(x, y, h) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = cores.fundo;
    ctx.fillRect(Math.floor(x), y, 1, h);
    ctx.globalAlpha = 1;
  }

  // Só escreve a palavra se ela couber inteira: texto cortado no meio atrapalha a leitura.
  function desenharTextoCortado(texto, x0, x1, y, h) {
    if (ctx.measureText(texto).width + 6 > x1 - x0) return false;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y, x1 - x0, h);
    ctx.clip();
    ctx.fillStyle = cores.texto;
    ctx.fillText(texto, x0 + 3, y + h / 2);
    ctx.restore();
    return true;
  }

  function desenharTextoFrase(texto, x0, x1, y, h) {
    const vx0 = Math.max(x0, 0);
    const vx1 = Math.min(x1, estado.largura);
    if (!texto || vx1 - vx0 < MIN_TEXTO_FRASE) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx0, y, vx1 - vx0, h);
    ctx.clip();
    ctx.fillStyle = cores.texto;
    // Encurta com reticências para caber no bloco visível.
    const disponivel = vx1 - vx0 - 12;
    let linha = texto;
    const largura = ctx.measureText(linha).width;
    if (largura > disponivel) {
      let n = Math.max(1, Math.floor((linha.length * disponivel) / largura) - 1);
      linha = linha.slice(0, n).trimEnd() + '…';
      while (n > 1 && ctx.measureText(linha).width > disponivel) linha = linha.slice(0, --n).trimEnd() + '…';
      if (ctx.measureText(linha).width > disponivel) linha = '';
    }
    ctx.fillText(linha, vx0 + 6, y + h / 2);
    ctx.restore();
  }

  // --- silêncios removidos ------------------------------------------------

  function desenharSilencios(tr) {
    const n = estado.silIni.length;
    if (n === 0) return;
    const vA = estado.vistaInicio;
    const vB = vA + estado.largura / estado.pps;
    for (let k = primeiroIndiceGE(estado.silFim, vA); k < n && estado.silIni[k] < vB; k++) {
      const x0 = xDoTempo(estado.silIni[k]);
      const x1 = xDoTempo(estado.silFim[k]);
      // Listras diagonais recortadas ao trecho.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, tr.y, x1 - x0, tr.h);
      ctx.clip();
      ctx.beginPath();
      for (let x = x0 - tr.h; x < x1; x += 6) {
        ctx.moveTo(x, tr.y + tr.h);
        ctx.lineTo(x + tr.h, tr.y);
      }
      ctx.strokeStyle = cores.silencio;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      // Traço sólido fino na base da trilha de palavras.
      if (tr === TRILHA_PALAVRAS) {
        ctx.fillStyle = cores.silencio;
        ctx.fillRect(x0, tr.y + tr.h - 2, x1 - x0, 2);
      }
    }
  }

  // --- Corte: bordas, alças, arrasto e playhead ---------------------------

  function desenharBordasDoCorte() {
    const xI = Math.round(xDoTempo(estado.inicio));
    const xF = Math.round(xDoTempo(estado.fim));
    if (xF <= xI) return;
    ctx.fillStyle = cores.alca;
    ctx.fillRect(xI, Y_MINIATURAS, xF - xI, 2);
    ctx.fillRect(xI, Y_BASE - 2, xF - xI, 2);
  }

  // Barra de altura total com aba de LARGURA_ABA px para dentro do Corte.
  function desenharAlca(x, ehInicio) {
    const altura = estado.altura;
    const xAba = ehInicio ? x : x - LARGURA_ABA;
    ctx.fillStyle = cores.alca;
    ctx.beginPath();
    ctx.roundRect(xAba, 0, LARGURA_ABA, altura, RAIO - 1);
    ctx.fill();
    ctx.fillRect(x - 1, 0, 2, altura);
    // Dois risquinhos de pegada, centrados na aba.
    const cx = Math.round(ehInicio ? x + LARGURA_ABA / 2 : x - LARGURA_ABA / 2);
    const cy = (Y_MINIATURAS + Y_BASE) / 2;
    ctx.fillStyle = cores.fundo;
    ctx.fillRect(cx - 2, cy - 7, 1, 14);
    ctx.fillRect(cx + 1, cy - 7, 1, 14);
  }

  function desenharArrasto() {
    const arr = estado.arrasto;
    if (!arr || arr.tipo !== 'alca') return;
    const ehInicio = arr.alca === 'inicio';
    const t = ehInicio ? estado.inicio : estado.fim;
    const x = Math.round(xDoTempo(t));
    if (arr.encaixou) desenharMarcadorEncaixe(x);
    const y = (Y_MINIATURAS + Y_BASE) / 2 - 9;
    const rotulo = formatarComQuadro(t, fps);
    if (ehInicio) desenharRotulo(rotulo, x + LARGURA_ABA + 6, y, false);
    else desenharRotulo(rotulo, x - LARGURA_ABA - 6, y, true);
  }

  // Linha tracejada na altura total e losango na régua: o ponto encaixou numa Frase.
  function desenharMarcadorEncaixe(x) {
    ctx.save();
    ctx.strokeStyle = cores.alca;
    ctx.lineWidth = 1;
    ctx.setLineDash(TRACEJADO);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, estado.altura);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = cores.alca;
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x + 6, 12);
    ctx.lineTo(x, 18);
    ctx.lineTo(x - 6, 12);
    ctx.closePath();
    ctx.fill();
  }

  function desenharRotulo(texto, x, y, alinhadoDireita) {
    ctx.save();
    ctx.font = fonteRotulo;
    const largura = ctx.measureText(texto).width + 12;
    const altura = 18;
    const x0 = alinhadoDireita ? x - largura : x;
    ctx.beginPath();
    ctx.roundRect(x0, y, largura, altura, RAIO);
    ctx.fillStyle = cores.fundo;
    ctx.fill();
    ctx.strokeStyle = cores.alca;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = cores.texto;
    ctx.fillText(texto, x0 + 6, y + altura / 2);
    ctx.restore();
  }

  function desenharPlayhead() {
    const x = xDoTempo(estado.tempo);
    if (x < -6 || x > estado.largura + 6) return;
    ctx.fillStyle = cores.playhead;
    ctx.fillRect(Math.round(x) - 1, 0, 2, estado.altura);
    ctx.beginPath();
    ctx.moveTo(x - 6, 0);
    ctx.lineTo(x + 6, 0);
    ctx.lineTo(x + 6, 12);
    ctx.lineTo(x, 18);
    ctx.lineTo(x - 6, 12);
    ctx.closePath();
    ctx.fill();
  }

  // --- alças: detecção, encaixe e arrasto --------------------------------

  // Alça sob o ponteiro (x em px CSS), ou null.
  function alcaEm(x) {
    const xI = xDoTempo(estado.inicio);
    const xF = xDoTempo(estado.fim);
    const emInicio =
      Math.abs(x - xI) <= TOLERANCIA_ALCA || (x >= xI && x <= xI + LARGURA_ABA);
    const emFim =
      Math.abs(x - xF) <= TOLERANCIA_ALCA || (x <= xF && x >= xF - LARGURA_ABA);
    if (emInicio && emFim) return Math.abs(x - xI) <= Math.abs(x - xF) ? 'inicio' : 'fim';
    if (emInicio) return 'inicio';
    if (emFim) return 'fim';
    return null;
  }

  // Novo valor de uma alça para o tempo `t` do ponteiro.
  // Sem Alt: borda de Frase mais próxima válida. Com Alt: livre, arredondada ao quadro.
  // Sempre dentro da janela e com fim − início ≥ DURACAO_MINIMA.
  function resolverAlca(alca, t, alt) {
    const { a, b } = estado.janela;
    const ehInicio = alca === 'inicio';
    const lo = ehInicio ? a : Math.max(a, estado.inicio + DURACAO_MINIMA);
    const hi = ehInicio ? Math.min(b, estado.fim - DURACAO_MINIMA) : b;
    if (!alt) {
      const borda = bordaMaisProxima(ehInicio ? estado.frIni : estado.frFim, t, lo, hi);
      if (borda !== null) return { valor: borda, encaixou: true };
    }
    const alvo = alt ? Math.round(t * fps) / fps : t;
    return { valor: limitar(alvo, lo, hi), encaixou: false };
  }

  // Aplica a posição do ponteiro ao estado (alça ou playhead do scrub).
  function aplicarPonteiro(arr, x, alt) {
    arr.x = x;
    arr.alt = alt;
    const t = tempoEmX(x);
    if (arr.tipo === 'alca') {
      const r = resolverAlca(arr.alca, t, alt);
      arr.encaixou = r.encaixou;
      if (arr.alca === 'inicio') estado.inicio = r.valor;
      else estado.fim = r.valor;
    } else {
      estado.tempo = limitar(t, estado.janela.a, estado.janela.b);
    }
  }

  function emitirArrasto(arr, arrastando) {
    if (arr.tipo === 'alca') {
      aoMudarBordas(
        { inicio: estado.inicio, fim: estado.fim },
        { alca: arr.alca, arrastando, encaixou: arr.encaixou },
      );
    } else {
      aoBuscar(estado.tempo, { arrastando });
    }
  }

  // Rolagem automática enquanto o arrasto está a menos de MARGEM_AUTOROLAGEM da borda.
  function rolarNaBorda(ts) {
    const arr = estado.arrasto;
    const v = arr ? velocidadeNaBorda(arr.x, estado.largura) : 0;
    if (v === 0) {
      estado.ultimoTs = 0;
      return;
    }
    const dt = estado.ultimoTs ? Math.min(0.05, (ts - estado.ultimoTs) / 1000) : 1 / 60;
    estado.ultimoTs = ts;
    const antes = estado.vistaInicio;
    estado.vistaInicio += (v * dt) / estado.pps;
    prenderVista();
    if (estado.vistaInicio === antes) return;
    aplicarPonteiro(arr, arr.x, arr.alt);
    emitirArrasto(arr, true);
    marcarSujo();
  }

  function atualizarCursor(x) {
    const cursor = alcaEm(x) ? 'ew-resize' : '';
    if (cursor !== cursorAtual) {
      canvas.style.cursor = cursor;
      cursorAtual = cursor;
    }
  }

  function aoPressionar(e) {
    const x = xDoEvento(e);
    if (e.button !== 0 || !Number.isFinite(x)) return;
    const alca = alcaEm(x);
    const arr = {
      tipo: alca ? 'alca' : 'busca',
      alca,
      id: e.pointerId,
      x,
      alt: false,
      encaixou: false,
    };
    estado.arrasto = arr;
    canvas.setPointerCapture(e.pointerId);
    aplicarPonteiro(arr, x, e.altKey);
    emitirArrasto(arr, true);
    marcarSujo();
  }

  function aoMover(e) {
    const x = xDoEvento(e);
    if (!Number.isFinite(x)) return;
    const arr = estado.arrasto;
    if (!arr) {
      atualizarCursor(x);
      return;
    }
    if (e.pointerId !== arr.id) return;
    aplicarPonteiro(arr, x, e.altKey);
    emitirArrasto(arr, true);
    marcarSujo();
  }

  function aoSoltar(e) {
    const arr = estado.arrasto;
    if (!arr || e.pointerId !== arr.id) return;
    aplicarPonteiro(arr, xDoEvento(e), e.altKey);
    estado.arrasto = null;
    emitirArrasto(arr, false);
    marcarSujo();
  }

  // Roda: desloca a vista; Ctrl+roda: zoom ancorado no cursor.
  function aoRolar(e) {
    e.preventDefault();
    if (!Number.isFinite(xDoEvento(e))) return;
    const unidade = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? estado.largura : 1;
    const dx = e.deltaX * unidade;
    const dy = e.deltaY * unidade;
    if (e.ctrlKey) {
      const x = xDoEvento(e);
      aplicarZoom(estado.pps * Math.exp(-dy * 0.0015), tempoEmX(x), x);
    } else {
      estado.vistaInicio += (dx + dy) / estado.pps;
      prenderVista();
      marcarSujo();
    }
  }

  // --- API pública --------------------------------------------------------

  function definirDados({ janela, frases = [], palavras = [], inicio, fim }) {
    estado.janela = { a: janela[0], b: janela[1] };
    const palavrasOrdenadas = ordenarPor(palavras, 'start');
    const frasesOrdenadas = ordenarPor(frases, 'start');
    estado.palTextos = palavrasOrdenadas.map((p) => p.text ?? '');
    estado.palIni = Float64Array.from(palavrasOrdenadas, (p) => p.start);
    estado.palFim = Float64Array.from(palavrasOrdenadas, (p) => p.end);
    estado.frases = indexarFrases(frasesOrdenadas, palavrasOrdenadas);
    estado.frIni = Float64Array.from(estado.frases, (f) => f.start);
    estado.frFim = Float64Array.from(estado.frases, (f) => f.end);
    estado.inicio = inicio;
    estado.fim = fim;
    if (!estado.zoomDefinido) {
      ajustarAoCorte();
    } else {
      estado.pps = limitarZoom(estado.pps);
      prenderVista();
    }
    marcarSujo();
  }

  function definirBordas(inicio, fim) {
    estado.inicio = inicio;
    estado.fim = fim;
    marcarSujo();
  }

  function definirTempo(t) {
    if (t === estado.tempo) return;
    estado.tempo = t;
    marcarSujo();
  }

  function definirSilencios(trechosRemovidos) {
    const ordenados = [...(trechosRemovidos ?? [])].sort((p, q) => p[0] - q[0]);
    estado.silIni = Float64Array.from(ordenados, (p) => p[0]);
    estado.silFim = Float64Array.from(ordenados, (p) => p[1]);
    marcarSujo();
  }

  function definirMiniaturas(cfg) {
    if (!cfg) {
      estado.miniaturas = null;
      marcarSujo();
      return;
    }
    let imagem = estado.imagens.get(cfg.url);
    if (!imagem) {
      imagem = new Image();
      imagem.onload = () => marcarSujo();
      imagem.src = cfg.url;
      estado.imagens.set(cfg.url, imagem);
    }
    estado.miniaturas = { ...cfg, inicio: cfg.inicio ?? 0, imagem };
    marcarSujo();
  }

  function definirOnda(cfg) {
    estado.onda = cfg
      ? { picos: cfg.picos, porSegundo: cfg.porSegundo, inicio: cfg.inicio ?? 0 }
      : null;
    marcarSujo();
  }

  function definirProgressoMidia(texto) {
    estado.progresso = texto ?? null;
    marcarSujo();
  }

  function destruir() {
    estado.destruido = true;
    observador.disconnect();
    canvas.removeEventListener('pointerdown', aoPressionar);
    canvas.removeEventListener('pointermove', aoMover);
    canvas.removeEventListener('pointerup', aoSoltar);
    canvas.removeEventListener('pointercancel', aoSoltar);
    canvas.removeEventListener('wheel', aoRolar);
    cancelAnimationFrame(estado.rafId);
    estado.rafId = 0;
    estado.arrasto = null;
    estado.imagens.clear();
    canvas.remove();
    if (mudouPosicao) container.style.position = posicaoOriginal;
  }

  // --- montagem -----------------------------------------------------------

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
    mudouPosicao = true;
  }
  canvas.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;display:block;' +
    'touch-action:none;user-select:none';
  container.appendChild(canvas);
  canvas.addEventListener('pointerdown', aoPressionar);
  canvas.addEventListener('pointermove', aoMover);
  canvas.addEventListener('pointerup', aoSoltar);
  canvas.addEventListener('pointercancel', aoSoltar);
  canvas.addEventListener('wheel', aoRolar, { passive: false });
  const observador = new ResizeObserver(() => medir());
  observador.observe(container);
  medir();

  return {
    definirDados,
    definirBordas,
    definirTempo,
    definirSilencios,
    definirMiniaturas,
    definirOnda,
    definirProgressoMidia,
    definirZoom,
    obterZoom: () => estado.pps,
    ajustarAoCorte,
    xDoTempo,
    tempoEmX,
    destruir,
  };
}
