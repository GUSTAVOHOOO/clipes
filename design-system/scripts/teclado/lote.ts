import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
page.setDefaultTimeout(5000)
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto('http://localhost:5180/#/fontes')
  await page.getByRole('heading', { name: 'Fontes', exact: true }).waitFor()
  await page.keyboard.press('n')
  const url = page.getByRole('textbox', { name: 'URL da Fonte' })
  assert.equal(await url.evaluate((el) => el === document.activeElement), true, 'N deve levar ao campo de importação')
  await url.fill('javascript:alert(1)')
  const adicionar = page.getByRole('button', { name: 'Adicionar à fila', exact: true })
  assert.equal(await adicionar.isDisabled(), true, 'Importar exige registro de Permissão')
  await page.getByRole('textbox', { name: 'Origem da Permissão' }).fill('Autorização por escrito do criador')
  await page.getByRole('checkbox', { name: /Tenho Permissão/ }).check()
  await adicionar.click()
  await page.getByText('Cole uma URL válida que comece com https:// ou http://.', { exact: true }).waitFor()
  await url.fill('https://example.com/live-gravada')
  await adicionar.click()
  await page.getByText('live-gravada', { exact: true }).waitFor()
  await page
    .getByText('Permissão: Autorização por escrito do criador · Cortes e transformação', { exact: true })
    .waitFor()

  await page.getByRole('link', { name: 'Cortes', exact: true }).click()
  await page.getByRole('heading', { name: 'Cortes', exact: true }).waitFor()
  await page.keyboard.press('j')
  await page.keyboard.press('a')
  const segundo = page.getByRole('article', { name: 'Contagem regressiva para a ação' })
  assert.match(await segundo.innerText(), /Aprovado/, 'A deve aprovar o Corte atual')
  const terceiro = page.getByRole('article', { name: 'Você me esqueceu na Terra' })
  await terceiro.getByRole('button', { name: 'Aprovar Você me esqueceu na Terra' }).focus()
  await page.keyboard.press('Enter')
  assert.match(await terceiro.innerText(), /Aprovado/, 'Enter em Aprovar deve ativar o botão, sem abrir o editor')
  await terceiro.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  assert.equal(
    await terceiro.getByRole('checkbox').isChecked(),
    true,
    'Espaço deve selecionar a caixa focada uma única vez',
  )
  await terceiro.locator('summary').focus()
  await page.keyboard.press('Enter')
  assert.equal(await terceiro.locator('details').getAttribute('open'), '', 'Enter deve abrir a explicação da Nota')
  await segundo.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Exportar aprovados/ }).click()
  await page.getByRole('heading', { name: 'Exportar em lote' }).waitFor()
  assert.equal(
    await page.getByText('Contagem regressiva para a ação', { exact: true }).count(),
    1,
    'Aprovação deve sobreviver à troca de tela',
  )
  await page.getByRole('button', { name: 'Simular exportação', exact: true }).click()
  await page
    .getByText(/Renderizando · [1-9]/)
    .first()
    .waitFor()
  await page.getByRole('button', { name: 'Pausar lote', exact: true }).click()
  await page.getByText('Lote pausado', { exact: true }).waitFor()
  const progresso = page.getByRole('progressbar', { name: /^Renderização / }).first()
  const antes = await progresso.getAttribute('aria-valuenow')
  assert.ok(Number(antes) > 0, 'A simulação deve produzir progresso antes da pausa')
  await page.waitForTimeout(650)
  assert.equal(await progresso.getAttribute('aria-valuenow'), antes, 'Pausa deve manter o progresso estável')
  await page.getByRole('button', { name: 'Retomar lote', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar lote', exact: true }).click()
  await page.getByText('Lote cancelado', { exact: true }).waitFor()
  await page.goto('http://localhost:5180/#/exportar?estado=erro')
  await page.reload()
  await page.getByText('Falha na exportação', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click()
  await page.getByRole('button', { name: 'Pausar lote', exact: true }).waitFor()
  assert.equal(
    await page.getByText('Falha na exportação', { exact: true }).count(),
    0,
    'Nova tentativa deve substituir o estado de erro',
  )
  await page.getByText('Simulação concluída', { exact: true }).waitFor({ timeout: 20000 })
  assert.deepEqual(errors, [], 'Não deve haver erro React durante importação, revisão e lote')
  console.log(
    'Lote: Permissão e URL, N/J/A, Enter/Espaço nativos, Nota, aprovação persistente, pausa/retomada/cancelamento e retry passaram.',
  )
} finally {
  await browser.close()
}
