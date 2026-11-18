// Confere o contraste WCAG 2.2 AA dos tokens nos dois temas (texto ≥ 4,5:1; gráfico e foco ≥ 3:1)
// e no modo [data-contrast='high'] (texto t2/t3 e linha-forte ≥ 7:1).
// Lê os valores direto de src/tokens/tokens.css, então não há segunda fonte da verdade.
// Uso: bun scripts/contraste.ts  (sai com código 1 se algum par falhar)
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/tokens/tokens.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function bloco(seletor: string): Record<string, string> {
  const ini = css.indexOf(seletor)
  if (ini < 0) throw new Error(`Seletor não encontrado em tokens.css: ${seletor}`)
  const corpo = css.slice(css.indexOf('{', ini) + 1, css.indexOf('}', ini))
  const vars: Record<string, string> = {}
  for (const m of corpo.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) vars[m[1]] = m[2]
  return vars
}

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const razao = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const fundos = ['chao', 'area', 'elevado', 'hover']
const paresBase: [string, string[], number][] = [
  ['t1', fundos, 4.5],
  ['t2', fundos, 4.5],
  ['t3', fundos, 4.5],
  ['sinal-texto', ['chao', 'area', 'elevado'], 4.5],
  ['erro', ['chao', 'area', 'elevado'], 4.5],
  ['no-sinal', ['sinal'], 4.5],
  ['sinal', ['chao', 'area', 'elevado'], 3],
  ['foco', ['chao', 'area', 'elevado', 'hover'], 3],
  ['linha-forte', ['chao', 'area', 'elevado'], 3],
]

const paresAltoContraste: [string, string[], number][] = [
  ['t1', fundos, 7],
  ['t2', fundos, 7],
  ['t3', fundos, 7],
  ['sinal-texto', ['chao', 'area', 'elevado'], 4.5],
  ['erro', ['chao', 'area', 'elevado'], 4.5],
  ['no-sinal', ['sinal'], 4.5],
  ['sinal', ['chao', 'area', 'elevado'], 3],
  ['foco', ['chao', 'area', 'elevado', 'hover'], 3],
  ['linha-forte', ['chao', 'area', 'elevado'], 7],
]

const escuro = bloco(":root,\n  [data-tema='escuro']")
const claro = bloco("[data-tema='claro']")
const escuroAlto = { ...escuro, ...bloco("[data-contrast='high']") }
const claroAlto = { ...claro, ...bloco("[data-tema='claro'][data-contrast='high']") }

let falhas = 0
for (const [nome, t, pares] of [
  ['escuro', escuro, paresBase],
  ['claro', claro, paresBase],
  ['escuro [data-contrast="high"]', escuroAlto, paresAltoContraste],
  ['claro [data-contrast="high"]', claroAlto, paresAltoContraste],
] as const) {
  console.log(`\nTema ${nome}`)
  for (const [frente, bases, minimo] of pares) {
    for (const base of bases) {
      const r = razao(t[frente], t[base])
      const ok = r >= minimo
      if (!ok) falhas++
      console.log(`${ok ? 'ok  ' : 'FALHA'} ${frente.padEnd(12)} sobre ${base.padEnd(8)} ${r.toFixed(2)}:1 (mín. ${minimo})`)
    }
  }
}
console.log(falhas ? `\n${falhas} par(es) abaixo do mínimo.` : '\nTodos os pares passam.')
process.exit(falhas ? 1 : 0)
