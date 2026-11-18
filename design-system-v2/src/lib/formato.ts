// Formatos PT-BR usados pelos componentes. Números sempre exibidos com a classe `num` (tabulares).

/** 14_200_000 µs → "00:14,2" (minutos:segundos,décimo) */
export function tc(us: number): string {
  const neg = us < 0
  const d = Math.round(Math.abs(us) / 100_000)
  const s = Math.floor(d / 10)
  const txt = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},${d % 10}`
  return neg ? `−${txt}` : txt
}

/** 2_538_000_000 µs → "00:42:18" (posição na Fonte) */
export function tcLongo(us: number): string {
  const s = Math.floor(us / 1_000_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`
}

/** 48_000_000 µs → "48 s"; acima de 1 min, "1 min 12 s" */
export function duracao(us: number): string {
  const s = Math.round(us / 1_000_000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
}

/** micro-dólares → "US$ 0,04", "< US$ 0,01" (positivo < 1 centavo) ou "US$ 0,00" (zero) */
export function usd(micro: number): string {
  if (micro === 0) return 'US$ 0,00'
  if (micro > 0 && micro < 10_000) return '< US$ 0,01'
  return `US$ ${(micro / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** faixa de custo em micro-dólares (min..max) para estimativas */
export function faixaUsd(minMicro: number, maxMicro: number): string {
  const min = Math.min(minMicro, maxMicro)
  const max = Math.max(minMicro, maxMicro)
  if (min === 0 && max === 0) return 'US$ 0,00'
  if (min >= 0 && max < 10_000) return '< US$ 0,01'
  if (min === max) return usd(min)
  if (min > 0 && min < 10_000) return `< US$ 0,01 – ${usd(max)}`
  return `~${usd(min)} – ${usd(max)}`
}

/** 8.4 → "8,4" */
export const nota = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** bytes → "212 MB" */
export function tamanho(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
  return `${Math.round(bytes / 1e6)} MB`
}
