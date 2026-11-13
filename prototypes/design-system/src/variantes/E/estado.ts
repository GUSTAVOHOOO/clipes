// Variante E, "Estúdio + Comando": estado que sobrevive à troca de tela (o App remonta a variante a cada troca)
// e as ações que a paleta, os atalhos e os botões chamam. Um lugar só para cada comando funcionar igual em qualquer tela.
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { cortes, presets, type Corte, type Frase } from '../../dados'

export type Edicao = { inn: number; out: number; cx: number }
export type Aba = 'transcricao' | 'legenda' | 'enquadramento' | 'audio'
export type Situacao = 'aprovado' | 'rejeitado'
export type Escala = 'P' | 'M' | 'G'
export type FraseT = Frase & { fantasma?: boolean }

type S = {
  corte: number
  edicoes: Record<string, Edicao>
  preset: string; pos: number; escala: Escala; porVez: number
  semSilencio: boolean; minimo: number; normalizar: boolean
  status: Record<string, Situacao | undefined>
  aba: Aba; inspector: boolean; trilho: boolean
}

const q = new URLSearchParams(location.search)
const ABAS: Aba[] = ['transcricao', 'legenda', 'enquadramento', 'audio']
let s: S = {
  corte: 0,
  edicoes: {},
  preset: presets[0].id, pos: presets[0].pos, escala: 'M', porVez: presets[0].palavras,
  semSilencio: true, minimo: 0.5, normalizar: true,
  status: { c1: 'aprovado', c3: 'aprovado' },
  aba: ABAS.find(a => a === q.get('aba')) ?? 'transcricao',
  inspector: q.get('inspector') !== '0',
  trilho: q.get('trilho') !== '0',
}
const subs = new Set<() => void>()
export const loja = {
  get: () => s,
  set(p: Partial<S> | ((s: S) => Partial<S>)) { s = { ...s, ...(typeof p === 'function' ? p(s) : p) }; subs.forEach(f => f()) },
  sub(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}
export const useLoja = () => useSyncExternalStore(loja.sub, loja.get)

/* ---------------------------------------------------------------- formatação */

/** 8,0 */
export const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',')
export const usd = (v: number) => `US$ ${num(v, 2)}`
/** 22 s, 1 min 14 s */
export const dur = (x: number) => {
  const r = Math.round(x)
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/* ---------------------------------------------------------------- lógica do Corte */

export const LARG_CROP = (9 / 16) / (16 / 9) // largura do recorte 9:16 dentro do quadro 16:9
const LIMIAR = 0.1 // ~ −40 dB nos picos normalizados
export const CUSTO = 0.01 // Empacotamento pelo Provedor, por Corte

export const padrao = (c: Corte): Edicao => ({ inn: c.inicio, out: c.fim, cx: c.cx })
export const edicaoDe = (c: Corte, st: S = s) => st.edicoes[c.id] ?? padrao(c)
export const corteAtual = () => cortes[s.corte]
export const presetAtual = (st: S = s) => presets.find(p => p.id === st.preset)!

export function mudarEdicao(c: Corte, p: Partial<Edicao>) {
  loja.set(st => ({ edicoes: { ...st.edicoes, [c.id]: { ...edicaoDe(c, st), ...p } } }))
}

/** Frases vizinhas da Fonte, fora do Corte: o "Estender ±1 Frase" precisa ter para onde ir. */
function vizinhas(c: Corte): FraseT[] {
  const f = (id: string, a: number, b: number): FraseT => ({ id: `${c.id}-${id}`, s: a, e: b, texto: '', fantasma: true })
  return [
    f('a3', c.inicio - 11.2, c.inicio - 8.0), f('a2', c.inicio - 7.4, c.inicio - 4.1), f('a1', c.inicio - 3.5, c.inicio - 0.4),
    f('d1', c.fim + 0.5, c.fim + 3.6), f('d2', c.fim + 4.2, c.fim + 7.5), f('d3', c.fim + 8.1, c.fim + 11.0),
  ]
}
const cacheFrases = new Map<string, FraseT[]>()
export function todasFrases(c: Corte) {
  let r = cacheFrases.get(c.id)
  if (!r) { r = [...vizinhas(c), ...c.frases].sort((a, b) => a.s - b.s); cacheFrases.set(c.id, r) }
  return r
}

/** Silêncios pela onda: picos abaixo do limiar por pelo menos `minimo` segundos, recortados à edição. */
export function silenciosDe(c: Corte, minimo: number, e: Edicao) {
  const dt = (c.fim - c.inicio) / c.peaks.length
  const r: { s: number; e: number }[] = []
  let st = -1
  const fecha = (i: number) => { if ((i - st) * dt >= minimo) r.push({ s: c.inicio + st * dt, e: c.inicio + i * dt }); st = -1 }
  c.peaks.forEach((v, i) => { if (v < LIMIAR) { if (st < 0) st = i } else if (st >= 0) fecha(i) })
  if (st >= 0) fecha(c.peaks.length)
  return r.map(x => ({ s: Math.max(x.s, e.inn), e: Math.min(x.e, e.out) })).filter(x => x.e - x.s >= minimo * 0.6)
}

export function duracaoFinal(c: Corte, st: S = s) {
  const e = edicaoDe(c, st)
  const eco = st.semSilencio ? silenciosDe(c, st.minimo, e).reduce((a, x) => a + x.e - x.s, 0) : 0
  return e.out - e.inn - eco
}

/** Para onde cada borda iria com ±1 Frase (undefined: não há para onde ir). */
export function destinos(c: Corte, e: Edicao) {
  const todas = todasFrases(c)
  return {
    inicioMais: [...todas].reverse().find(f => f.s < e.inn - 0.05),
    inicioMenos: todas.find(f => f.s > e.inn + 0.05 && f.s < e.out - 1),
    fimMais: todas.find(f => f.e > e.out + 0.05),
    fimMenos: [...todas].reverse().find(f => f.e < e.out - 0.05 && f.e > e.inn + 1),
  }
}

/* ---------------------------------------------------------------- ações (paleta, atalhos e botões) */

const avisar = (t: string, description?: string) => toast(t, { duration: 2000, description })

export const acoes = {
  /** lado: borda do Corte; d = +1 estende (para fora), −1 encurta (para dentro). */
  estender(lado: 'inicio' | 'fim', d: 1 | -1) {
    const c = corteAtual(), e = edicaoDe(c), x = destinos(c, e)
    if (lado === 'inicio') {
      const f = d > 0 ? x.inicioMais : x.inicioMenos
      if (!f) return avisar(d > 0 ? 'O início já está no limite' : 'Não há outra Frase para tirar do início')
      mudarEdicao(c, { inn: f.s })
      avisar(d > 0 ? `Início estendido em 1 Frase (+${num(e.inn - f.s)} s)` : `Início encurtado em 1 Frase (−${num(f.s - e.inn)} s)`)
    } else {
      const f = d > 0 ? x.fimMais : x.fimMenos
      if (!f) return avisar(d > 0 ? 'O fim já está no limite' : 'Não há outra Frase para tirar do fim')
      mudarEdicao(c, { out: f.e })
      avisar(d > 0 ? `Fim estendido em 1 Frase (+${num(f.e - e.out)} s)` : `Fim encurtado em 1 Frase (−${num(e.out - f.e)} s)`)
    }
  },
  alternarSilencios() {
    const c = corteAtual(), v = !s.semSilencio
    const sil = silenciosDe(c, s.minimo, edicaoDe(c))
    loja.set({ semSilencio: v })
    avisar(v ? `${sil.length} silêncios removidos (−${num(sil.reduce((a, x) => a + x.e - x.s, 0))} s)` : 'Silêncios restaurados')
  },
  aplicarPreset(i: number) {
    const p = presets[i]
    loja.set({ preset: p.id, pos: p.pos, porVez: p.palavras })
    avisar(`Legenda ${p.nome} aplicada`)
  },
  enquadrar() { loja.set({ aba: 'enquadramento', inspector: true }) },
  centralizar() {
    const c = corteAtual()
    mudarEdicao(c, { cx: 0.5 })
    avisar('Recorte centralizado')
  },
  exportarCorte() {
    const c = corteAtual()
    avisar(`Exportando “${c.titulo}”`, `1080×1920, ${num(duracaoFinal(c))} s, legenda ${presetAtual().nome}`)
  },
  exportarAprovados() {
    const ap = cortes.filter(c => s.status[c.id] === 'aprovado')
    if (!ap.length) return avisar('Aprove ao menos um Corte para exportar o lote')
    avisar(`Exportando ${ap.length} ${ap.length === 1 ? 'Corte aprovado' : 'Cortes aprovados'}`, `Empacotamento pelo Provedor: ${usd(ap.length * CUSTO)}`)
  },
  marcar(c: Corte, v: Situacao) {
    const novo = s.status[c.id] === v ? undefined : v
    loja.set(st => ({ status: { ...st.status, [c.id]: novo } }))
    avisar(novo ? `“${c.titulo}” ${novo}` : `“${c.titulo}” voltou para sugerido`)
  },
  aprovarNota7() {
    const st = { ...s.status }
    let n = 0
    cortes.forEach(c => { if (c.nota.total >= 7 && !st[c.id]) { st[c.id] = 'aprovado'; n++ } })
    loja.set({ status: st })
    avisar(n ? `${n} ${n === 1 ? 'Corte aprovado' : 'Cortes aprovados'} com Nota 7 ou mais` : 'Nenhum Corte sugerido com Nota 7 ou mais')
  },
  irCorte(i: number) { loja.set({ corte: (i + cortes.length) % cortes.length }) },
}
