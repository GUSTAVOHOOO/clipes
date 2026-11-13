import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
page.setDefaultTimeout(5000)
try {
  await page.goto('http://localhost:5180/#/config/provedor')
  await page.getByRole('heading', { name: 'Provedor', exact: true }).waitFor()
  await page.getByRole('tab', { name: 'API', exact: true }).click()
  await page.getByRole('textbox', { name: 'Endpoint da API' }).fill('https://example.com/v1')
  await page.getByLabel('Chave da API', { exact: true }).fill('chave-ficticia-de-teste')
  assert.equal(
    await page.getByRole('button', { name: 'Testar conexão' }).isDisabled(),
    true,
    'Consentimento deve preceder conexão externa',
  )
  await page.getByRole('switch', { name: 'Permitir envio de Transcrição ao Provedor' }).click()
  await page.getByRole('button', { name: 'Testar conexão' }).click()
  await page.getByText('Conexão simulada. Nenhuma Transcrição ou chave foi enviada.').waitFor()
  assert.equal(
    await page.evaluate(() => JSON.stringify(localStorage).includes('chave-ficticia')),
    false,
    'Chaves nunca devem ir ao armazenamento da página',
  )
  await page.getByRole('link', { name: 'Aparência', exact: true }).click()
  await page.getByRole('radio', { name: 'Claro', exact: true }).click()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
  await page.getByRole('link', { name: 'Diagnóstico', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar diagnóstico', exact: true }).click()
  const download = await downloadEvent
  assert.match(download.suggestedFilename(), /diagnostico.*\.json/)
  await page.getByRole('link', { name: 'Componentes', exact: true }).click()
  await page.getByRole('button', { name: 'Simular download', exact: true }).last().click()
  await page.waitForFunction(
    () => Number(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')) > 0,
  )
  await page.getByRole('button', { name: 'Pausar Kokoro', exact: true }).click()
  await page.getByRole('link', { name: 'Aparência', exact: true }).click()
  await page.getByRole('link', { name: 'Componentes', exact: true }).click()
  await page.getByText('Pausado', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Retomar simulação', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar Kokoro', exact: true }).click()
  await page.goto('http://localhost:5180/#/galeria/controles')
  await page.getByRole('textbox', { name: 'Volume', exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.getByRole('textbox', { name: 'Volume', exact: true }).inputValue(), '51')
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await page.getByRole('listbox').waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option')
  await page.keyboard.press('End')
  await page.getByRole('option', { name: 'English', exact: true }).waitFor()
  await page.keyboard.press('Enter')
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).filter({ hasText: 'English' }).waitFor()
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => document.querySelector('[role=dialog]')?.contains(document.activeElement))
  assert.equal(
    await page.getByRole('dialog').evaluate((el) => el.contains(document.activeElement)),
    true,
    'Tab deve permanecer na paleta modal',
  )
  await page.keyboard.press('Shift+Tab')
  await page.waitForFunction(() => document.querySelector('[role=dialog]')?.contains(document.activeElement))
  assert.equal(await page.getByRole('dialog').evaluate((el) => el.contains(document.activeElement)), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'combobox')
  await page.getByRole('link', { name: 'Listas e teclado', exact: true }).click()
  const lista = page.getByRole('listbox', { name: 'Frases de exemplo' })
  await lista.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('status').filter({ hasText: 'Frase 1000' }).waitFor()
  assert.ok((await lista.getByRole('option').count()) < 30, 'Lista longa deve virtualizar linhas')
  await page.getByRole('link', { name: 'Camadas', exact: true }).click()
  await page.getByRole('group', { name: 'Opções do item', exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Copiar título', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Abrir diálogo', exact: true }).click()
  const nomeEstilo = page.getByRole('textbox', { name: 'Nome do estilo', exact: true })
  await nomeEstilo.focus()
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: 'Paleta de comandos', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('aria-labelledby') !== null && document.activeElement?.tagName === 'INPUT',
  )
  assert.equal(
    await nomeEstilo.evaluate((el) => el === document.activeElement),
    true,
    'A paleta deve devolver foco ao campo do diálogo anterior',
  )
  await page.keyboard.press('Escape')
  console.log('Sistema: consentimento, segredo efêmero, tema, diagnóstico, scrub, select e paleta passaram.')
} finally {
  await browser.close()
}
