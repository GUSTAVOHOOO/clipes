import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
page.setDefaultTimeout(5000)
const erros: string[] = []
page.on('pageerror', (e) => erros.push(e.message))
const trocar = async (nome: string) => {
  await page.getByRole('button', { name: /Trocar de Projeto/ }).click()
  await page.getByRole('menuitem', { name: nome, exact: true }).click()
}
try {
  await page.goto('http://localhost:5180/#/cortes')
  const segundo = page.getByRole('article', { name: 'Contagem regressiva para a ação' })
  await segundo.getByRole('button', { name: 'Aprovar Contagem regressiva para a ação' }).click()
  await page.evaluate(() => {
    location.hash = '#/corte/c1/empacotar'
  })
  const titulo = page.getByRole('textbox', { name: 'Título', exact: true })
  await titulo.fill('Título exclusivo do primeiro Projeto')
  await trocar('Canal de cortes')
  assert.notEqual(
    await titulo.inputValue(),
    'Título exclusivo do primeiro Projeto',
    'Edições não devem atravessar Projetos',
  )
  await page.evaluate(() => {
    location.hash = '#/cortes'
  })
  assert.doesNotMatch(await segundo.innerText(), /Aprovado/, 'Aprovação não deve atravessar Projetos')
  await trocar('Canal dark · Ficção')
  assert.match(await segundo.innerText(), /Aprovado/, 'Aprovação deve permanecer no Projeto original')
  await page.evaluate(() => {
    location.hash = '#/corte/c1/empacotar'
  })
  assert.equal(await titulo.inputValue(), 'Título exclusivo do primeiro Projeto')
  await page.evaluate(() => {
    location.hash = '#/fontes'
  })
  await page.getByRole('heading', { name: 'Fontes', exact: true }).waitFor()
  const destino = page.getByRole('combobox', { name: 'Projeto', exact: true })
  await trocar('Canal de cortes')
  assert.match(await destino.innerText(), /Canal de cortes/, 'Destino deve acompanhar a troca no cabeçalho')
  await destino.click()
  await page.getByRole('option', { name: 'Canal dark · Ficção' }).click()
  assert.match(await destino.innerText(), /Canal dark · Ficção/, 'Destino pode ser escolhido manualmente')
  await page.getByRole('button', { name: /Trocar de Projeto/ }).click()
  await page.getByRole('menuitem', { name: 'Abrir pasta de Projeto…' }).click()
  await page.getByText(/não há acesso às pastas do computador/).waitFor()
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: /Trocar de Projeto/ }).click()
  await page.getByRole('menuitem', { name: 'Novo Projeto…' }).click()
  await page.getByRole('textbox', { name: 'Nome do Projeto' }).fill('Projeto teste')
  await page.getByRole('textbox', { name: 'Caminho demonstrativo' }).fill('D:\\Clipes\\teste')
  await page.getByRole('button', { name: 'Criar Projeto' }).click()
  await page.getByRole('button', { name: /Projeto: Projeto teste/ }).waitFor()
  assert.match(await destino.innerText(), /Projeto teste/)
  await page.getByRole('link', { name: 'Exportar', exact: true }).click()
  await page.getByRole('heading', { name: 'Exportar em lote', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Simular exportação', exact: true }).isDisabled(),
    true,
    'Novo Projeto não começa com Cortes aprovados',
  )
  assert.deepEqual(erros, [])
  console.log('Projetos: isolamento, destino e criação passaram.')
} finally {
  await browser.close()
}
