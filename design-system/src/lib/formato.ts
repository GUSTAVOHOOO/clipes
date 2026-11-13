// Formatos de número e tempo em PT-BR. Timecodes sempre em fonte mono tabular (utilitário `timecode`).

/** 1:23:45 ou 0:41.2 (com décimos). Tempo da Fonte. */
export function tc(seg: number, decimos = false) {
  const neg = seg < 0
  seg = Math.abs(seg)
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  const ss = decimos ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return (neg ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`)
}

/** 8,0 */
export const num = (v: number, casas = 1) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

/** 22 s · 1 min 14 s · 2 h 05 min */
export function dur(seg: number) {
  const r = Math.round(seg)
  if (r < 60) return `${r} s`
  if (r < 3600) return `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`
  return `${Math.floor(r / 3600)} h ${String(Math.floor((r % 3600) / 60)).padStart(2, '0')} min`
}

/** US$ 0,04 */
export const usd = (v: number) => `US$ ${num(v, 2)}`

/** 1,2 GB · 340 MB */
export function bytes(b: number) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (b >= 1000 && i < u.length - 1) {
    b /= 1000
    i++
  }
  return `${num(b, b < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

/** "1 Corte" / "4 Cortes" */
export const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
