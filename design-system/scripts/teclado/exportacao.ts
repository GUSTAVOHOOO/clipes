import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
page.setDefaultTimeout(5000)
try {
  await page.goto('http://localhost:5180/#/corte/c2/editar')
  await page.getByRole('button', { name: 'Exportar', exact: true }).click()
  await page.getByRole('heading', { name: 'Exportar em lote' }).waitFor()
  assert.equal(
    await page.getByText('Contagem regressiva para a ação', { exact: true }).count(),
    1,
    'Exportar no editor deve manter somente o Corte escolhido',
  )
  assert.equal(
    await page.getByText('O término no observatório', { exact: true }).count(),
    0,
    'Outros aprovados não entram numa exportação individual',
  )
  assert.equal(
    await page.getByRole('button', { name: 'Simular exportação', exact: true }).isDisabled(),
    true,
    'Corte em revisão precisa de aprovação explícita',
  )
  await page.getByRole('button', { name: 'Aprovar Corte para exportar' }).click()
  await page.getByRole('button', { name: 'Simular exportação', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar lote', exact: true }).click()
  await page.getByRole('link', { name: 'Cortes', exact: true }).click()
  await page.getByRole('button', { name: 'Rejeitar Contagem regressiva para a ação', exact: true }).click()
  await page.evaluate(() => {
    location.hash = '/exportar?corte=c2'
  })
  await page.getByRole('heading', { name: 'Exportar em lote' }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).count(),
    0,
    'Rejeição posterior deve invalidar nova tentativa de lote antigo',
  )
  assert.equal(await page.getByRole('button', { name: 'Simular exportação', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Aprovar Corte para exportar' }).click()
  await page.getByRole('link', { name: 'Cortes', exact: true }).click()
  const terceiro = page.getByRole('article', { name: 'Você me esqueceu na Terra' })
  await terceiro.getByRole('button', { name: 'Aprovar Você me esqueceu na Terra' }).click()
  await page.getByRole('link', { name: 'Exportar', exact: true }).click()
  await page.getByRole('heading', { name: 'Exportar em lote' }).waitFor()
  await page.getByText('Você me esqueceu na Terra', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('Cancelado', { exact: true }).count(),
    0,
    'Novo escopo não deve exibir fila obsoleta',
  )
  console.log('Exportação: Corte individual, aprovação explícita e atualização do escopo do lote passaram.')
} finally {
  await browser.close()
}
