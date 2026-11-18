import { expect, test } from '@playwright/test'

test.describe('Tela Lista e Entrada de Fontes (#/projeto/:id/fontes)', () => {
  test('estados §6, importação local, URL JIT/erros, relocalizar V1, lote e busca FTS5 em 1366x768 e 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    await expect(page.getByRole('heading', { name: 'Entrada de Fonte' })).toBeVisible()
    await expect(page.getByText('Live_12_11_final.mp4', { exact: true })).toBeVisible()
    await expect(page.getByText('offline.mp4', { exact: true })).toBeVisible()

    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/fontes-1366.png' })

    // ?estado=vazio
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?estado=vazio'
    })
    await expect(page.getByText('Nenhuma Fonte importada ainda')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Importar primeira Fonte' })).toBeVisible()

    // ?estado=carregando
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?estado=carregando'
    })
    await expect(
      page.getByRole('status', { name: /Carregando Fontes do Projeto/i }),
    ).toBeVisible()
    await expect(page.getByText('Nenhuma Fonte importada ainda')).toHaveCount(0)

    // ?estado=erro
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?estado=erro'
    })
    const alertaEstado = page.getByRole('alert')
    await expect(alertaEstado).toBeVisible()
    await expect(alertaEstado).toContainText(/Nenhum Projeto está aberto/i)

    // Volta ao estado normal para o fluxo interativo
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes'
    })
    await expect(page.getByText('Live_12_11_final.mp4', { exact: true })).toBeVisible()

    // Importação local com pré-inspeção e Permissão
    await page.getByRole('textbox', { name: /Arquivo de vídeo/i }).fill('/videos/live_obs_teste.mkv')
    await page.getByRole('button', { name: 'Inspecionar arquivo' }).click()
    await expect(page.getByText('live_obs_teste.mkv', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: /Faixa de áudio/i })).toContainText(/Mic OBS/)

    await page.getByRole('radio', { name: /Tenho permissão do criador/i }).click()
    await page.getByLabel(/Quem autorizou/i).fill('Streamer Teste')
    await page.getByLabel(/Onde foi autorizada/i).fill('Discord')
    await page.getByLabel(/Escopo/i).fill('cortes e tradução')
    await page.getByRole('button', { name: 'Importar Fonte' }).click()

    await expect(page.getByText('live_obs_teste.mkv', { exact: true })).toBeVisible()

    // Modo URL: Termos do YouTube -> js_runtime_missing + InstaladorJustInTime -> age_restricted
    await page.getByRole('radio', { name: /URL \(VOD\)/i }).click()
    const campoUrl = page.getByRole('textbox', { name: /URL do vídeo/i })
    const btnBaixarUrl = page.getByRole('button', { name: 'Baixar por URL' })
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(btnBaixarUrl).toHaveClass(/bg-sinal/)

    await campoUrl.fill('https://youtube.com/watch/js-test')
    await btnBaixarUrl.click()

    const dlgTermos = page.getByRole('alertdialog')
    await expect(dlgTermos).toBeVisible()
    await dlgTermos.getByRole('button', { name: /Aceitar e baixar/i }).click()
    await expect(dlgTermos).toBeHidden()

    await expect(page.getByRole('alert')).toContainText(/deno/i)
    const regiaoJit = page.getByRole('region', { name: /Instalação necessária/i })
    await expect(regiaoJit).toBeVisible()

    // UI-17 e UI-12/UI-18a em 1366x768: único primário laranja e zero refs #\d+ no JIT
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(regiaoJit.getByRole('button', { name: /Baixar e continuar/i })).toHaveClass(
      /bg-sinal/,
    )
    await expect(btnBaixarUrl).not.toHaveClass(/bg-sinal/)
    expect(await regiaoJit.innerText()).not.toMatch(/#\d+/)
    await page.screenshot({ path: 'test-results/fontes-jit-1366.png' })

    // Ao fechar o JIT inline com "Agora não", "Baixar por URL" volta a ser o único primário
    await regiaoJit.getByRole('button', { name: 'Agora não' }).click()
    await expect(regiaoJit).toBeHidden()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(btnBaixarUrl).toHaveClass(/bg-sinal/)

    await campoUrl.fill('https://youtube.com/watch/age-test')
    await btnBaixarUrl.click()
    const alertaIdade = page.getByRole('alert')
    await expect(alertaIdade).toContainText(/restrição de idade/i)
    await alertaIdade.getByRole('button', { name: 'Importar arquivo local' }).click()
    await expect(page.getByRole('radio', { name: /Arquivo local/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // Relocalizar Fonte V1 offline com confirmation_required
    const cardOffline = page.locator('article', { hasText: 'offline.mp4' })
    await expect(cardOffline.getByText('Offline', { exact: true })).toBeVisible()
    await expect(cardOffline.getByRole('button', { name: /^Abrir$/i })).toBeEnabled()
    await cardOffline.getByRole('button', { name: /Relocalizar arquivo/i }).click()

    const dlgReloc = page.getByRole('dialog', { name: /Relocalizar arquivo/i })
    await expect(dlgReloc).toBeVisible()
    await dlgReloc.getByRole('textbox', { name: /Arquivo de vídeo/i }).fill('/videos/recuperado.mp4')
    await dlgReloc.getByRole('button', { name: /^Relocalizar$/i }).click()
    await expect(dlgReloc).toBeHidden()

    const dlgConfirm = page.getByRole('alertdialog')
    await expect(dlgConfirm).toBeVisible()
    await dlgConfirm.getByRole('button', { name: /Confirmar relocalização/i }).click()
    await expect(dlgConfirm).toBeHidden()
    await expect(page.getByText('recuperado.mp4', { exact: true })).toBeVisible()

    // Selecionar 2 Fontes e navegar para ?sub=lotes
    await page.getByRole('checkbox', { name: /Selecionar Live_12_11_final\.mp4 para lote/i }).click()
    await page.getByRole('checkbox', { name: /Selecionar recuperado\.mp4 para lote/i }).click()
    const btnLote = page.getByRole('button', { name: 'Processar 2 Fontes em lote' })
    await expect(btnLote).toBeEnabled()
    await btnLote.click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes\?sub=lotes$/)

    // Volta para Fontes e testa layout 1440x900 + Busca global Ctrl+F
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('tab', { name: /^Fontes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    await page.keyboard.press('Control+f')
    const buscaGlobal = page.getByRole('searchbox', {
      name: /Buscar falas em todas as Transcrições do Projeto/i,
    })
    await expect(buscaGlobal).toBeFocused()
    await buscaGlobal.fill('frase 142')
    await buscaGlobal.press('Enter')

    const gaveta = page.getByRole('complementary', { name: /Resultados da busca/i })
    await expect(gaveta).toBeVisible()
    await expect(gaveta.locator('mark')).toHaveText('Frase 142')

    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/fontes-1440.png' })

    await gaveta.getByRole('button', { name: /changed\.mp4/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes\/1\?frase=142&row=142$/)

    expect(erros).toEqual([])
  })

  test('UI-17 e UI-12/UI-18a no fluxo URL/VOD + JIT em 1440x900', async ({ page }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    await page.getByRole('radio', { name: /URL \(VOD\)/i }).click()
    const campoUrl = page.getByRole('textbox', { name: /URL do vídeo/i })
    const btnBaixarUrl = page.getByRole('button', { name: 'Baixar por URL' })

    await campoUrl.fill('https://youtube.com/watch/js-test')
    await btnBaixarUrl.click()

    const dlgTermos = page.getByRole('alertdialog')
    await expect(dlgTermos).toBeVisible()
    await dlgTermos.getByRole('button', { name: /Aceitar e baixar/i }).click()
    await expect(dlgTermos).toBeHidden()

    const regiaoJit = page.getByRole('region', { name: /Instalação necessária/i })
    await expect(regiaoJit).toBeVisible()

    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(regiaoJit.getByRole('button', { name: /Baixar e continuar/i })).toHaveClass(
      /bg-sinal/,
    )
    await expect(btnBaixarUrl).not.toHaveClass(/bg-sinal/)
    expect(await regiaoJit.innerText()).not.toMatch(/#\d+/)

    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/fontes-jit-1440.png' })

    await regiaoJit.getByRole('button', { name: 'Agora não' }).click()
    await expect(regiaoJit).toBeHidden()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(btnBaixarUrl).toHaveClass(/bg-sinal/)

    expect(erros).toEqual([])
  })
})
