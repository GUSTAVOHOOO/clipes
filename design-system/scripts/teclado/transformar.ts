import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-fake-device-for-media-stream'],
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const erros: string[] = []
page.on('pageerror', (e) => erros.push(e.message))
try {
  await page.goto('http://localhost:5180/#/corte/c1/transformar')
  await page.getByRole('heading', { name: 'Dê outro sentido à cena' }).waitFor()
  await page.keyboard.press('n')
  const narracao = page.getByRole('complementary', { name: 'Narração' })
  await narracao.getByRole('tab', { name: 'Voz do usuário' }).click()
  assert.equal(await narracao.getByRole('button', { name: 'Iniciar gravação' }).isDisabled(), true)
  await page.keyboard.press('Escape')
  await page
    .getByRole('textbox', { name: 'Roteiro' })
    .fill(
      'Nesta cena, o silêncio importa tanto quanto a discussão. O enquadramento aproxima os personagens, mas o diálogo revela o afastamento entre eles. É esse contraste que transforma a ruptura em uma escolha visual.',
    )
  await page.getByRole('checkbox', { name: 'Revisei o Roteiro e aprovo esta versão para Narração' }).check()
  await page.keyboard.press('Control+s')
  await page.getByRole('status', { name: 'Estado do Roteiro' }).getByText('Roteiro aprovado').waitFor()
  await page.getByRole('textbox', { name: 'Roteiro' }).press('End')
  await page.keyboard.type(' Uma nova observação.')
  assert.equal(
    await page.getByRole('checkbox', { name: 'Revisei o Roteiro e aprovo esta versão para Narração' }).isChecked(),
    false,
  )
  await page.getByRole('checkbox', { name: 'Revisei o Roteiro e aprovo esta versão para Narração' }).check()
  await page.getByRole('button', { name: 'Salvar Roteiro' }).click()
  await page.locator('main').click({ position: { x: 100, y: 60 } })
  await page.keyboard.press('n')
  await narracao.getByRole('tab', { name: 'Áudio importado' }).click()
  const wav = Buffer.alloc(44 + 1600)
  wav.write('RIFF')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(1600, 40)
  await narracao.locator('input[type=file]').setInputFiles({ name: 'narracao.wav', mimeType: 'audio/wav', buffer: wav })
  await narracao.getByText('narracao.wav', { exact: true }).waitFor()
  assert.equal(
    await narracao.getByRole('switch', { name: 'Reduzir áudio da Fonte durante a Narração' }).isChecked(),
    true,
  )
  await narracao.getByRole('tab', { name: 'TTS', exact: true }).click()
  await narracao.getByRole('button', { name: 'Demonstrar download' }).click()
  await narracao.getByText('Download demonstrado', { exact: true }).waitFor()
  await narracao.getByRole('button', { name: 'Demonstrar Narração' }).click()
  await narracao.getByText('Fluxo concluído · nenhum áudio gerado', { exact: true }).waitFor()
  await page.context().grantPermissions(['microphone'])
  await narracao.getByRole('tab', { name: 'Voz do usuário' }).click()
  await page.keyboard.press('Control+r')
  await narracao.getByRole('button', { name: 'Parar gravação' }).waitFor()
  await page.waitForTimeout(600)
  await narracao.getByRole('button', { name: 'Pausar', exact: true }).click()
  await narracao.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.keyboard.press('Control+r')
  await narracao.getByText('Minha Narração.webm', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+3')
  await page.getByRole('heading', { name: 'Prepare a apresentação do Corte' }).waitFor()
  const titulo = page.getByRole('textbox', { name: 'Título', exact: true })
  await titulo.fill('O que esta cena diz sem palavras')
  await page
    .getByRole('textbox', { name: 'Descrição' })
    .fill('Uma análise do contraste entre a composição e o diálogo em Tears of Steel.')
  const salvar = page.getByRole('button', { name: 'Salvar Empacotamento' })
  assert.equal(await salvar.isDisabled(), true)
  await page.getByRole('checkbox', { name: 'Revisei o título, a descrição e a capa' }).check()
  await page.keyboard.press('Control+s')
  await page.getByRole('status', { name: 'Estado do Empacotamento' }).getByText('Empacotamento salvo').waitFor()
  await titulo.fill('Outro título revisável')
  assert.equal(await page.getByRole('checkbox', { name: 'Revisei o título, a descrição e a capa' }).isChecked(), false)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Salvar PNG', exact: true }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'c1-capa.png')
  const png = await readFile((await download.path())!)
  assert.equal(png.readUInt32BE(16), 1080)
  assert.equal(png.readUInt32BE(20), 1920)
  const estados = await browser.newPage()
  estados.on('pageerror', (e) => erros.push(e.message))
  await estados.goto('http://localhost:5180/#/corte/c1/transformar?estado=vazio')
  await estados.getByRole('textbox', { name: 'Roteiro' }).waitFor()
  assert.equal(await estados.getByRole('textbox', { name: 'Roteiro' }).inputValue(), '')
  assert.equal(await estados.getByRole('button', { name: 'Salvar Roteiro' }).isDisabled(), true)
  await estados.goto('http://localhost:5180/#/corte/c1/transformar?estado=erro')
  await estados.getByText('O Roteiro não pôde ser carregado.', { exact: true }).waitFor()
  await estados.getByRole('button', { name: 'Tentar novamente' }).click()
  await estados.getByRole('textbox', { name: 'Roteiro' }).waitFor()
  await estados.goto('http://localhost:5180/#/corte/c1/empacotar?estado=vazio')
  await estados.getByRole('textbox', { name: 'Título', exact: true }).waitFor()
  assert.equal(await estados.getByRole('textbox', { name: 'Título', exact: true }).inputValue(), '')
  assert.equal(await estados.getByRole('button', { name: 'Salvar Empacotamento' }).isDisabled(), true)
  await estados.goto('http://localhost:5180/#/corte/c1/empacotar?estado=erro')
  await estados.getByText('O Empacotamento não pôde ser carregado.', { exact: true }).waitFor()
  await estados.getByRole('button', { name: 'Tentar novamente' }).click()
  await estados.getByRole('textbox', { name: 'Título', exact: true }).waitFor()
  await estados.close()
  assert.deepEqual(erros, [])
  console.log(
    'Transformar/Empacotar: aprovação, edição, áudio importado, TTS demonstrativo, gravação com dispositivo sintético, ducking, capa PNG e atalhos passaram.',
  )
} finally {
  await browser.close()
}
