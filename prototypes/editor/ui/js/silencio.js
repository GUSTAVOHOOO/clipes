// Detecção de pausas (silêncios a remover) e mapeamento entre tempo da Fonte e tempo de saída.

const EPS = 1e-9;
// Duração mínima de um trecho removido para entrar no resultado.
const MINIMO_TRECHO = 0.05;

/** Índice do maior i com valores[i] <= x, ou -1. valores em ordem crescente. */
function ultimoIndiceAte(valores, x) {
  let lo = 0;
  let hi = valores.length - 1;
  let achado = -1;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if (valores[meio] <= x) {
      achado = meio;
      lo = meio + 1;
    } else {
      hi = meio - 1;
    }
  }
  return achado;
}

/**
 * Trechos SEM fala com duração > limiar, encolhidos de `folga` em cada lado que toca fala.
 * Nas bordas do Corte (início e fim) não encolhe do lado da borda.
 * @returns {[number, number][]} trechos removidos, em tempo da Fonte
 */
export function detectarPausas(palavras, inicio, fim, limiar = 0.5, folga = 0.12) {
  const lacunas = [];
  if (!palavras || palavras.length === 0) {
    lacunas.push({ a: inicio, b: fim, bordaEsq: true, bordaDir: true });
  } else {
    lacunas.push({ a: inicio, b: palavras[0].start, bordaEsq: true, bordaDir: false });
    for (let i = 0; i < palavras.length - 1; i++) {
      lacunas.push({ a: palavras[i].end, b: palavras[i + 1].start, bordaEsq: false, bordaDir: false });
    }
    lacunas.push({ a: palavras[palavras.length - 1].end, b: fim, bordaEsq: false, bordaDir: true });
  }

  const removidos = [];
  for (const lacuna of lacunas) {
    if (!(lacuna.b - lacuna.a > limiar)) continue;
    const a = Math.max(inicio, lacuna.bordaEsq ? lacuna.a : lacuna.a + folga);
    const b = Math.min(fim, lacuna.bordaDir ? lacuna.b : lacuna.b - folga);
    if (b - a >= MINIMO_TRECHO - EPS) removidos.push([a, b]);
  }
  return removidos;
}

/** Trechos mantidos: complementares dos removidos dentro de [inicio, fim]. */
export function trechosMantidos(inicio, fim, removidos) {
  const ordenados = (removidos || [])
    .map(([a, b]) => [Math.max(a, inicio), Math.min(b, fim)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  const mantidos = [];
  let cursor = inicio;
  for (const [a, b] of ordenados) {
    if (a > cursor) mantidos.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < fim) mantidos.push([cursor, fim]);
  return mantidos;
}

/**
 * Mapa entre tempo da Fonte e tempo de saída (linha do tempo do MP4 já sem os silêncios).
 * - paraSaida(t): antes do 1º trecho -> 0; dentro de um trecho -> soma anterior + deslocamento;
 *   num buraco -> início do próximo trecho; depois do último -> duracao.
 * - paraFonte(s): inverso de paraSaida (s limitado a [0, duracao]).
 * - pularSilencio(t): antes do 1º trecho -> início do 1º; dentro -> t; num buraco -> início do próximo;
 *   depois do último -> null.
 */
export function criarMapa(trechos) {
  const ts = (trechos || [])
    .map(([a, b]) => [a, b])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  const saidaInicio = [];
  let acumulado = 0;
  for (const [a, b] of ts) {
    saidaInicio.push(acumulado);
    acumulado += b - a;
  }
  const duracao = acumulado;
  const inicios = ts.map(([a]) => a);

  function paraSaida(t) {
    if (ts.length === 0) return 0;
    const i = ultimoIndiceAte(inicios, t);
    if (i < 0) return 0;
    const [, b] = ts[i];
    if (t <= b) return saidaInicio[i] + (t - ts[i][0]);
    return i + 1 < ts.length ? saidaInicio[i + 1] : duracao;
  }

  function paraFonte(s) {
    if (ts.length === 0) return 0;
    if (s <= 0) return ts[0][0];
    if (s >= duracao) return ts[ts.length - 1][1];
    const i = ultimoIndiceAte(saidaInicio, s);
    const [a, b] = ts[i];
    return Math.min(b, a + (s - saidaInicio[i]));
  }

  function pularSilencio(t) {
    if (ts.length === 0) return null;
    const i = ultimoIndiceAte(inicios, t);
    if (i < 0) return ts[0][0];
    if (t < ts[i][1]) return t;
    return i + 1 < ts.length ? ts[i + 1][0] : null;
  }

  return { duracao, paraSaida, paraFonte, pularSilencio };
}
