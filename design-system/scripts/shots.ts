// Screenshots reais com o Chrome do sistema (playwright-core, sem baixar navegador).
//
//   node scripts/shots.ts --porta 5180 --saida shots/tmp cortes "corte/c1/editar?painel=legenda"
//   node scripts/shots.ts --tamanhos 1440x900,1366x768 --temas escuro,claro fontes
//
// Rotas sem "#" nem "/" inicial (o Git Bash transforma "/x" em caminho do Windows).
//
// Cada rota vira <saida>/<nome>-<tema>-<largura>.png. Erros do console e da página são impressos:
// screenshot com erro no console não conta como verificado.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (n: string, padrao: string) => {
  const i = args.indexOf(`--${n}`)
  if (i < 0) return padrao
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const porta = opt('porta', process.env.PORT ?? '5180')
const saida = opt('saida', 'shots/tmp')
const tamanhos = opt('tamanhos', '1440x900').split(',').map(t => t.split('x').map(Number) as [number, number])
const temas = opt('temas', 'escuro').split(',')
const espera = Number(opt('espera', '500'))
const rotas = args.length ? args : ['fontes']

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
mkdirSync(saida, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
let falhas = 0
for (const [w, h] of tamanhos) {
  for (const tema of temas) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning') {
        falhas += m.type() === 'error' ? 1 : 0
        console.log(`  [${m.type()}] ${m.text()}`)
      }
    })
    page.on('pageerror', e => {
      falhas++
      console.log(`  [pageerror] ${e.message}`)
    })
    for (const rota of rotas) {
      const [h, q = ''] = rota.replace(/^.*?#?\/?(?=[a-z])/i, '').split('?')
      const hash = '/' + h
      // tema e query de rota vão no hash; ?tema= vai na URL real (lida antes do primeiro pinte)
      const url = `http://localhost:${porta}/?tema=${tema}#${hash}${q ? '?' + q : ''}`
      // Cada captura começa com estado de sessão limpo, inclusive quando só muda o hash.
      await page.goto('about:blank')
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(espera)
      const nome = (hash.replace(/^\//, '').replace(/[/?=&]/g, '-') || 'raiz') + (q ? '-' + q.replace(/[=&]/g, '-') : '')
      const arq = `${saida}/${nome}-${tema}-${w}.png`
      await page.screenshot({ path: arq })
      console.log(arq)
    }
    await ctx.close()
  }
}
await browser.close()
if (falhas) {
  console.log(`\n${falhas} erro(s) no console`)
  process.exitCode = 1
}
