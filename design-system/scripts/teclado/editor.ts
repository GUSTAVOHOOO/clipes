import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.setDefaultTimeout(6000)
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))
  await page.goto('http://localhost:5180/#/corte/c1/editar')
  const entrada = page.getByRole('slider', { name: 'Início do Corte', exact: true })
  await entrada.waitFor()
  assert.equal(await page.locator('aside[data-aberta="true"]').count(), 0, 'Foco começa com as gavetas fechadas')
  await entrada.focus()
  await page.keyboard.press('t')
  await page.getByRole('complementary', { name: 'Ferramentas do Corte' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => !!document.activeElement?.closest('aside[data-aberta="true"]'))
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('aside[data-aberta="true"]').count(), 0)
  assert.equal(await entrada.evaluate((el) => document.activeElement === el), true, 'Esc devolve foco à alça')
  const posicao = page.getByRole('slider', { name: 'Posição de reprodução' })
  const caixaPosicao = await posicao.boundingBox()
  assert.ok(caixaPosicao)
  const tempoInicial = Number(await posicao.getAttribute('aria-valuenow'))
  await page.mouse.move(caixaPosicao.x + caixaPosicao.width / 2, caixaPosicao.y + 12)
  await page.mouse.down()
  await page.mouse.move(caixaPosicao.x + caixaPosicao.width / 2 + 80, caixaPosicao.y + 12, { steps: 5 })
  await page.mouse.up()
  assert.ok(
    Number(await posicao.getAttribute('aria-valuenow')) > tempoInicial,
    'playhead continua arrastável pela régua',
  )
  await posicao.focus()
  await page.keyboard.press('Home')
  const caixaEntrada = await entrada.boundingBox()
  assert.ok(caixaEntrada)
  const inicioPointer = Number(await entrada.getAttribute('aria-valuenow'))
  await page.mouse.move(caixaEntrada.x + caixaEntrada.width / 2, caixaEntrada.y + 15)
  await page.mouse.down()
  await page.mouse.move(caixaEntrada.x + caixaEntrada.width / 2 + 160, caixaEntrada.y + 15, { steps: 8 })
  await page.mouse.up()
  assert.ok(
    Number(await entrada.getAttribute('aria-valuenow')) > inicioPointer,
    'arraste por ponteiro alcança alça sobreposta ao playhead',
  )
  await page.reload()
  await entrada.waitFor()
  const playhead = page.getByRole('slider', { name: 'Posição de reprodução' })
  const preview = page.getByLabel('Prévia do Corte em 9:16').locator('img').first()
  const quadroInicial = await preview.getAttribute('src')
  await playhead.focus()
  await page.keyboard.press('End')
  assert.notEqual(await preview.getAttribute('src'), quadroInicial, 'seek atualiza quadro da prévia')
  await playhead.focus()
  await page.keyboard.press('Home')
  await entrada.focus()
  const inicio = Number(await entrada.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowRight')
  const encaixado = Number(await entrada.getAttribute('aria-valuenow'))
  assert.ok(encaixado > inicio, 'seta encaixa na próxima Frase')
  await page.keyboard.press('Alt+ArrowLeft')
  assert.ok(
    Math.abs(Number(await entrada.getAttribute('aria-valuenow')) - (encaixado - 0.1)) < 0.001,
    'Alt ajusta em décimos',
  )
  await page.keyboard.press('Control+k')
  await page.locator('[cmdk-input]').waitFor()
  await page.keyboard.press('Escape')
  await page.keyboard.press('f')
  const crop = page.getByRole('slider', { name: 'Centro do recorte horizontal' })
  await crop.waitFor({ state: 'visible' })
  await crop.focus()
  const imagemFonte = page.getByAltText('Fonte em 16:9 com área do recorte')
  assert.equal(
    await imagemFonte.getAttribute('src'),
    await preview.getAttribute('src'),
    'quadro da Fonte acompanha a prévia',
  )
  const posicaoCrop = await preview.evaluate((el) => (el as HTMLElement).style.objectPosition)
  const centro = Number(await crop.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowRight')
  assert.ok(Number(await crop.getAttribute('aria-valuenow')) > centro)
  assert.notEqual(
    await preview.evaluate((el) => (el as HTMLElement).style.objectPosition),
    posicaoCrop,
    'recorte altera a prévia',
  )
  await page.getByRole('button', { name: 'Adicionar keyframe' }).click()
  await page
    .getByRole('button', { name: /Ir ao keyframe/ })
    .first()
    .waitFor()
  await page.keyboard.press('Escape')
  await page.keyboard.press('t')
  const primeira = page.locator('[data-palavra]').first()
  await primeira.focus()
  await page.keyboard.press('F2')
  const correcao = page.getByRole('textbox', { name: 'Corrigir palavra' })
  await correcao.fill('Revisada')
  await correcao.press('Enter')
  await page.getByRole('button', { name: 'Revisada', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  const titulo = await page.title()
  await page.keyboard.press(']')
  await page.waitForURL('**/corte/c2/editar')
  await page.waitForFunction((anterior) => document.title !== anterior, titulo)
  await page.keyboard.press('[')
  await page.waitForURL('**/corte/c1/editar')
  await page.keyboard.press('t')
  await page.getByRole('button', { name: 'Revisada', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.goto('http://localhost:5180/#/legenda')
  await page.getByRole('heading', { name: 'Estilo da legenda', exact: true }).waitFor()
  const previaLegenda = page.getByLabel('Prévia do Corte em 9:16').locator('img').first()
  const quadroLegenda = await previaLegenda.getAttribute('src')
  await page.getByRole('button', { name: 'Reproduzir prévia' }).click()
  await page.waitForFunction(
    (src) => document.querySelector('[aria-label="Prévia do Corte em 9:16"] img')?.getAttribute('src') !== src,
    quadroLegenda,
  )
  await page.getByRole('button', { name: 'Pausar prévia' }).click()
  await page.keyboard.press('2')
  assert.equal(
    await page.getByRole('button', { name: 'Legenda Impacto', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await page.keyboard.press('Control+Enter')
  await page.getByText('Estilo aplicado a 1 Corte aprovado', { exact: true }).waitFor()
  assert.deepEqual(erros, [])
  console.log('Editor: foco, gavetas, paleta, alças, encaixe/Alt, crop, keyframe e correção persistida passaram.')
} finally {
  await browser.close()
}
