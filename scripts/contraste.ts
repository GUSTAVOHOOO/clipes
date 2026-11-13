// Contraste WCAG 2.2 dos tokens, nos dois temas, lido direto de src/styles/tokens.css.
//   node scripts/contraste.ts
// Texto: ≥ 4,5:1. Elementos gráficos de controle (contorno de checkbox/interruptor, playhead, alça, foco): ≥ 3:1.
import { readFileSync } from 'node:fs'
import { converter, parse, wcagContrast, formatHex } from 'culori'

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

function bloco(seletor: RegExp) {
  const m = css.match(seletor)
  if (!m) throw new Error('bloco não encontrado: ' + seletor)
  const vars: Record<string, string> = {}
  for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[k] = v.trim()
  return vars
}
const escuro = bloco(/:root,\s*\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)
const claro = bloco(/\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)
const sem = bloco(/:root,\s*\[data-theme\]\s*\{([\s\S]*?)\n\}/)

const rgb = converter('rgb')
function resolver(nome: string, tema: Record<string, string>, fundo?: string): string {
  let v = tema[nome] ?? sem[nome]
  if (!v) throw new Error('token ausente: ' + nome)
  for (let i = 0; i < 10 && v.includes('var('); i++) v = v.replace(/var\(--([\w-]+)\)/g, (_, k) => tema[k] ?? sem[k])
  // color-mix(in oklch, X p%, transparent) sobre um fundo: compõe com alfa
  const mix = v.match(/color-mix\(in oklch,\s*(.+?)\s+(\d+)%,\s*transparent\)/)
  if (mix && fundo) {
    const a = rgb(parse(mix[1]))!, b = rgb(parse(fundo))!, p = Number(mix[2]) / 100
    return formatHex({ mode: 'rgb', r: a.r * p + b.r * (1 - p), g: a.g * p + b.g * (1 - p), b: a.b * p + b.b * (1 - p) })
  }
  return v
}

type Par = [frente: string, fundo: string, minimo: number, nota?: string]
const TEXTO = 4.5, GRAFICO = 3
const pares: Par[] = [
  ...['fg', 'fg-2', 'fg-3'].flatMap(f => ['canvas', 'surface', 'field', 'hover', 'selected'].map(b => [f, b, TEXTO] as Par)),
  ['primary-fg', 'primary', TEXTO, 'botão primário'],
  ['accent-text', 'canvas', TEXTO], ['accent-text', 'surface', TEXTO], ['accent-text', 'accent-subtle', TEXTO, 'palavra ativa'],
  ['accent-fg', 'accent', TEXTO, 'texto sobre âmbar'],
  ['danger', 'surface', TEXTO], ['danger', 'canvas', TEXTO], ['danger', 'danger-subtle', TEXTO],
  ['warning', 'surface', TEXTO], ['warning', 'warning-subtle', TEXTO],
  ['success', 'surface', TEXTO], ['success', 'success-subtle', TEXTO],
  ['info', 'surface', TEXTO], ['info', 'info-subtle', TEXTO],
  ['accent', 'surface', GRAFICO, 'playhead/foco'], ['accent', 'canvas', GRAFICO, 'foco no palco'], ['accent', 'track', GRAFICO, 'playhead na trilha'],
  ['control-border', 'surface', GRAFICO, 'contorno de controle'], ['control-border', 'field', GRAFICO],
  ['handle', 'track', GRAFICO, 'alça da timeline'], ['handle', 'surface', GRAFICO],
  ['wave', 'track', GRAFICO, 'onda'],
]

let falhas = 0
for (const [nomeTema, tema] of [['escuro', escuro], ['claro', claro]] as const) {
  console.log(`\n${nomeTema}`)
  for (const [f, b, min, nota] of pares) {
    const fundoBase = resolver('surface', tema)
    const fundo = resolver(b, tema, fundoBase)
    const frente = resolver(f, tema, fundo)
    const r = wcagContrast(parse(frente)!, parse(fundo)!)
    const ok = r >= min
    if (!ok) falhas++
    console.log(`${ok ? '  ok ' : '  FALHA'} ${r.toFixed(2).padStart(5)}:1  ${f} sobre ${b}${nota ? `  (${nota})` : ''}${ok ? '' : `  < ${min}`}`)
  }
}
console.log(falhas ? `\n${falhas} par(es) abaixo do mínimo` : '\nTodos os pares passam (WCAG 2.2 AA).')
process.exitCode = falhas ? 1 : 0
