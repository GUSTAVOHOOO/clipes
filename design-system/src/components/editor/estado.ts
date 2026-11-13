import { useEffect, useMemo, useRef, useState } from 'react'
import { presets, type Corte, type Layout } from '@/data/dados'
import { useEdicao } from '@/lib/app'
import { clamp } from '@/lib/formato'

export const LARGURA_CROP = 9 / 16 / (16 / 9)
export type Keyframe = { t: number; cx: number }
export type EdicaoEditor = {
  inn: number
  out: number
  cx: number
  layout: Layout
  preset: string
  sil: boolean
  minimo: number
  pos: number
  palavras: number
  escala: 'P' | 'M' | 'G'
  textos: Record<string, string>
  keyframes: Keyframe[]
  cor?: string
  destaque?: string
  contorno?: number
  fonte?: 'Inter' | 'Geist'
}

export function padraoEditor(c: Corte): EdicaoEditor {
  return {
    inn: c.inicio,
    out: c.fim,
    cx: c.cx,
    layout: 'rosto',
    preset: 'classico',
    sil: false,
    minimo: 0.5,
    pos: presets[0].pos,
    palavras: presets[0].palavras,
    escala: 'M',
    textos: {},
    keyframes: [],
  }
}

export function detectarSilencios(c: Corte, minimo: number) {
  const dt = (c.fim - c.inicio) / c.peaks.length
  const trechos: { s: number; e: number }[] = []
  let inicio = -1
  for (let i = 0; i <= c.peaks.length; i++) {
    if (i < c.peaks.length && c.peaks[i] < 0.1) {
      if (inicio < 0) inicio = i
    } else if (inicio >= 0) {
      if ((i - inicio) * dt >= minimo) trechos.push({ s: c.inicio + inicio * dt, e: c.inicio + i * dt })
      inicio = -1
    }
  }
  return trechos
}

export function centroNoTempo(base: number, frames: Keyframe[], tempo: number) {
  if (!frames.length) return base
  const antes = [...frames].reverse().find((k) => k.t <= tempo) ?? frames[0]
  const depois = frames.find((k) => k.t > tempo)
  if (!depois || tempo <= antes.t) return antes.cx
  return antes.cx + ((depois.cx - antes.cx) * (tempo - antes.t)) / (depois.t - antes.t)
}

export function useEditor(c: Corte) {
  const [e, mudar] = useEdicao<EdicaoEditor>(c.id, 'editor', () => padraoEditor(c))
  const [t, setT] = useState(e.inn)
  const [tocando, setTocando] = useState(false)
  const silencios = useMemo(
    () =>
      detectarSilencios(c, e.minimo)
        .map((s) => ({ s: Math.max(s.s, e.inn), e: Math.min(s.e, e.out) }))
        .filter((s) => s.e > s.s),
    [c, e.minimo, e.inn, e.out],
  )
  const economia = silencios.reduce((a, s) => a + s.e - s.s, 0)
  const duracao = e.out - e.inn - (e.sil ? economia : 0)
  const vivo = useRef({ t, e, silencios })
  vivo.current = { t, e, silencios }
  useEffect(() => {
    if (!tocando) return
    let raf = 0
    let antes = performance.now()
    const passo = (agora: number) => {
      const { t, e, silencios } = vivo.current
      let novo = Math.max(e.inn, t) + (agora - antes) / 1000
      antes = agora
      if (e.sil) {
        const silencio = silencios.find((s) => novo >= s.s && novo < s.e)
        if (silencio) novo = silencio.e
      }
      if (novo >= e.out) {
        setT(e.out)
        setTocando(false)
        return
      }
      setT(novo)
      raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [tocando])

  const ir = (tempo: number) => {
    setT(clamp(tempo, c.inicio, c.fim))
    setTocando(false)
  }
  const alternar = () => {
    if (!tocando && (t >= e.out || t < e.inn)) setT(e.inn)
    setTocando((v) => !v)
  }
  const frase = c.frases.find((f) => t >= f.s && t < f.e)
  const palavrasTexto = c.palavras.map((w) => ({ ...w, t: e.textos[w.id] ?? w.t }))
  const daFrase = palavrasTexto.filter((w) => w.f === frase?.id)
  const ativa = daFrase.find((w) => t >= w.s && t < w.e) ?? [...daFrase].reverse().find((w) => w.s <= t)
  const indice = Math.max(
    0,
    daFrase.findIndex((w) => w.id === ativa?.id),
  )
  const grupo = daFrase.slice(
    Math.floor(indice / e.palavras) * e.palavras,
    (Math.floor(indice / e.palavras) + 1) * e.palavras,
  )
  const presetBase = presets.find((p) => p.id === e.preset) ?? presets[0]
  const preset = {
    ...presetBase,
    fonte: e.fonte ?? presetBase.fonte,
    cor: e.cor ?? presetBase.cor,
    destaque: e.destaque ?? presetBase.destaque,
    contorno: e.contorno ?? presetBase.contorno,
  }
  const aplicarPreset = (id: string) => {
    const p = presets.find((p) => p.id === id)
    if (p)
      mudar({
        preset: id,
        pos: p.pos,
        palavras: p.palavras,
        cor: undefined,
        destaque: undefined,
        contorno: undefined,
        fonte: undefined,
      })
  }
  const borda = (lado: 'in' | 'out', tempo: number, solto = false) => {
    const alvos = c.frases
      .map((f) => (lado === 'in' ? f.s : f.e))
      .filter((v) => (lado === 'in' ? v < e.out - 0.1 : v > e.inn + 0.1))
    const valor = solto
      ? tempo
      : alvos.reduce((a, b) => (Math.abs(b - tempo) < Math.abs(a - tempo) ? b : a), alvos[0] ?? tempo)
    if (lado === 'in') {
      const inn = clamp(valor, c.inicio, e.out - 0.1)
      mudar({ inn })
      if (t < inn) setT(inn)
    } else {
      const out = clamp(valor, e.inn + 0.1, c.fim)
      mudar({ out })
      if (t > out) setT(out)
    }
  }
  const passoBorda = (lado: 'in' | 'out', dir: number, fino = false) => {
    const atual = lado === 'in' ? e.inn : e.out
    if (fino) {
      borda(lado, atual + dir * 0.1, true)
      return
    }
    const alvos = c.frases.map((f) => (lado === 'in' ? f.s : f.e))
    const proximo = dir > 0 ? alvos.find((v) => v > atual + 0.001) : [...alvos].reverse().find((v) => v < atual - 0.001)
    if (proximo !== undefined) borda(lado, proximo)
  }
  const passoPalavra = (dir: number) => {
    const palavra =
      dir > 0 ? c.palavras.find((w) => w.s > t + 0.002) : [...c.palavras].reverse().find((w) => w.s < t - 0.002)
    if (palavra) ir(palavra.s + 0.001)
  }
  const cx = centroNoTempo(e.cx, e.keyframes, t)
  const definirCentro = (valor: number) => {
    const novo = clamp(valor, LARGURA_CROP / 2, 1 - LARGURA_CROP / 2)
    if (!e.keyframes.length) mudar({ cx: novo })
    else
      mudar({
        cx: novo,
        keyframes: [...e.keyframes.filter((k) => Math.abs(k.t - t) > 0.05), { t, cx: novo }].sort((a, b) => a.t - b.t),
      })
  }
  const adicionarKeyframe = () =>
    mudar({ keyframes: [...e.keyframes.filter((k) => Math.abs(k.t - t) > 0.05), { t, cx }].sort((a, b) => a.t - b.t) })
  const tRel = clamp(
    t - e.inn - (e.sil ? silencios.reduce((a, s) => a + Math.max(0, Math.min(t, s.e) - s.s), 0) : 0),
    0,
    duracao,
  )
  return {
    c,
    e,
    mudar,
    t,
    ir,
    tocando,
    alternar,
    silencios,
    economia,
    duracao,
    tRel,
    frase,
    ativa,
    grupo,
    palavrasTexto,
    preset,
    aplicarPreset,
    borda,
    passoBorda,
    passoPalavra,
    cx,
    definirCentro,
    adicionarKeyframe,
  }
}
export type EstadoEditor = ReturnType<typeof useEditor>
