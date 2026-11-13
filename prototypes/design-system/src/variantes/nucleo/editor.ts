// Núcleo comum (F, G, H): estado do editor de um Corte. Playhead falso, bordas por Frase, silêncios, legenda.
import { useEffect, useMemo, useRef, useState } from 'react'
import { cortes, presets, type Corte, type Frase } from '../../dados'
import { clamp, grupoAtual, num, type Layout, type Memo } from './base'

export type FraseT = Frase & { fantasma?: boolean }
export type Edicao = {
  inn: number; out: number; cx: number; preset: string; sil: boolean; minimo: number
  pos: number; porVez: number; escala: 'P' | 'M' | 'G'; layout: Layout
  textos: Record<string, string> // correções de palavra feitas pelo texto
  keyframes: { t: number; cx: number }[]
}
export const LARG_CROP = (9 / 16) / (16 / 9) // largura do recorte 9:16 dentro do quadro 16:9
const LIMIAR = 0.1 // ~ −40 dB nos picos normalizados

export const padrao = (c: Corte): Edicao => ({
  inn: c.inicio, out: c.fim, cx: c.cx, preset: 'classico', sil: true, minimo: 0.5,
  pos: presets[0].pos, porVez: presets[0].palavras, escala: 'M', layout: 'rosto', textos: {},
  keyframes: [{ t: c.inicio, cx: c.cx }, { t: c.inicio + (c.fim - c.inicio) * 0.55, cx: clamp(c.cx + 0.06, LARG_CROP / 2, 1 - LARG_CROP / 2) }],
})

/** Frases vizinhas da Fonte, fora do Corte, para o "Estender ±1 Frase" ter para onde ir. */
export function vizinhas(c: Corte): FraseT[] {
  const f = (id: string, s: number, e: number, texto: string): FraseT => ({ id: `${c.id}-${id}`, s, e, texto, fantasma: true })
  return [
    f('a2', c.inicio - 7.4, c.inicio - 4.1, 'Frase anterior na Fonte'),
    f('a1', c.inicio - 3.5, c.inicio - 0.4, 'Frase anterior na Fonte'),
    f('d1', c.fim + 0.5, c.fim + 3.6, 'Próxima Frase na Fonte'),
    f('d2', c.fim + 4.2, c.fim + 7.5, 'Próxima Frase na Fonte'),
  ]
}

/** Silêncios pela onda: picos abaixo do limiar por pelo menos `minimo` segundos. */
export function detectarSilencios(c: Corte, minimo: number) {
  const dt = (c.fim - c.inicio) / c.peaks.length
  const r: { s: number; e: number }[] = []
  let st = -1
  const fecha = (i: number) => { if ((i - st) * dt >= minimo) r.push({ s: c.inicio + st * dt, e: c.inicio + i * dt }); st = -1 }
  c.peaks.forEach((v, i) => { if (v < LIMIAR) { if (st < 0) st = i } else if (st >= 0) fecha(i) })
  if (st >= 0) fecha(c.peaks.length)
  return r
}

/** Encaixa uma borda arrastada na Frase mais próxima (Alt solta o encaixe). */
export function encaixar(s: number, lado: 'in' | 'out', todas: FraseT[], solto: boolean) {
  if (solto) return s
  const alvos = todas.map(f => (lado === 'in' ? f.s : f.e))
  return alvos.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a), alvos[0])
}

export function useEditor(memo: Memo) {
  const [ci, setCi] = useState(memo.corte)
  const c = cortes[ci]
  const [eds, setEds] = useState<Record<string, Edicao>>(memo.edicoes as Record<string, Edicao>)
  useEffect(() => { memo.edicoes = eds }, [eds, memo])
  const e = eds[c.id] ?? padrao(c)
  const mudar = (p: Partial<Edicao>) => setEds(m => ({ ...m, [c.id]: { ...(m[c.id] ?? padrao(c)), ...p } }))

  const [t, setT] = useState(c.inicio + 0.01)
  const [tocando, setTocando] = useState(false)
  const preset = presets.find(p => p.id === e.preset) ?? presets[0]

  const todas = useMemo<FraseT[]>(() => [...vizinhas(c), ...c.frases].sort((a, b) => a.s - b.s), [c])
  const silencios = useMemo(
    () => detectarSilencios(c, e.minimo).map(s => ({ s: Math.max(s.s, e.inn), e: Math.min(s.e, e.out) })).filter(s => s.e - s.s >= e.minimo * 0.6),
    [c, e.minimo, e.inn, e.out])
  const economia = silencios.reduce((a, s) => a + s.e - s.s, 0)
  const duracaoFinal = e.out - e.inn - (e.sil ? economia : 0)

  const trocar = (i: number) => {
    const n = (i + cortes.length) % cortes.length
    memo.corte = n; setCi(n); setT(cortes[n].inicio + 0.01); setTocando(false)
  }

  // Playhead falso: avança em tempo real e pula silêncios quando a remoção está ligada.
  const vivo = useRef({ t, e, silencios }); vivo.current = { t, e, silencios }
  useEffect(() => {
    if (!tocando) return
    let raf = 0, antes = performance.now()
    const passo = (agora: number) => {
      const { t, e, silencios } = vivo.current
      let n = t + (agora - antes) / 1000
      antes = agora
      if (e.sil) { const s = silencios.find(x => n >= x.s && n < x.e); if (s) n = s.e }
      if (n >= e.out) { setT(e.out); setTocando(false); return }
      setT(n)
      raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [tocando])

  const alternar = () => {
    if (!tocando && (t >= e.out - 0.05 || t < e.inn)) setT(e.inn)
    setTocando(v => !v)
  }
  const ir = (s: number) => { setT(s); setTocando(false) }

  // Frase e palavra ativas no tempo t.
  const frase = c.frases.find(f => t >= f.s && t < f.e) ?? [...c.frases].reverse().find(f => f.s <= t && t - f.e < 1.2)
  const daFrase = frase ? c.palavras.filter(w => w.f === frase.id) : []
  const ativa = daFrase.find(w => t >= w.s && t < w.e) ?? [...daFrase].reverse().find(w => w.s <= t)
  const palavrasTexto = useMemo(() => c.palavras.map(w => (e.textos[w.id] ? { ...w, t: e.textos[w.id] } : w)), [c, e.textos])
  const grupo = grupoAtual(palavrasTexto, frase?.id, ativa?.id, e.porVez)

  const passoPalavra = (d: number) => {
    const k = Math.max(0, c.palavras.findIndex(p => p.id === ativa?.id))
    const p = c.palavras[clamp(k + d, 0, c.palavras.length - 1)]
    ir(p.s + 0.001)
  }

  /** Estender/encurtar uma borda em 1 Frase. Devolve o texto do aviso, ou null se não há para onde ir. */
  const estender = (lado: 'in' | 'out', d: 1 | -1): string | null => {
    if (lado === 'in') {
      const f = d > 0 ? [...todas].reverse().find(f => f.s < e.inn - 0.05) : todas.find(f => f.s > e.inn + 0.05 && f.s < e.out - 1)
      if (!f) return null
      mudar({ inn: f.s }); if (t < f.s) setT(f.s + 0.01)
      return d > 0 ? `Início estendido em 1 Frase (${num(e.inn - f.s)} s)` : `1 Frase a menos no início (${num(f.s - e.inn)} s)`
    }
    const f = d > 0 ? todas.find(f => f.e > e.out + 0.05) : [...todas].reverse().find(f => f.e < e.out - 0.05 && f.e > e.inn + 1)
    if (!f) return null
    mudar({ out: f.e }); if (t > f.e) setT(e.inn + 0.01)
    return d > 0 ? `Fim estendido em 1 Frase (${num(f.e - e.out)} s)` : `1 Frase a menos no fim (${num(e.out - f.e)} s)`
  }

  /** Tempo do Corte já sem os silêncios removidos. */
  const tRel = Math.max(0, t - e.inn - (e.sil ? silencios.filter(g => g.e <= t).reduce((a, g) => a + g.e - g.s, 0) : 0))

  return {
    ci, c, e, mudar, t, ir, tocando, alternar, setTocando, preset, todas, silencios, economia, duracaoFinal, trocar,
    frase, ativa, grupo, palavrasTexto, passoPalavra, estender, tRel,
  }
}
export type EstadoEditor = ReturnType<typeof useEditor>
