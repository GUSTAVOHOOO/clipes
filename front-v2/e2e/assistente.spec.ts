import { expect, test } from '@playwright/test'

test.describe('Tela Assistente de Primeiro Uso (#/assistente)', () => {
  test('fluxo completo a partir de #/inicio?assistant-test=1 em 1366x768 sem pageerror', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio?assistant-test=1')

    await expect(page).toHaveURL(/#\/assistente\?passo=1$/)
    await expect(
      page.getByRole('heading', { name: 'Passo 1: Essencial para transcrever e cortar' }),
    ).toBeVisible()

    // Camada principal não expõe termos internos fora de <details>
    const textoForaDetails = await page.evaluate(() => {
      const main = document.querySelector('main')
      if (!main) return ''
      const clone = main.cloneNode(true) as HTMLElement
      for (const d of clone.querySelectorAll('details')) d.remove()
      return clone.innerText
    })
    expect(textoForaDetails).not.toMatch(/int8_float16/i)
    expect(textoForaDetails).not.toMatch(/handshake/i)

    const rolagemPasso1 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemPasso1).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/assistente-passo1-1366.png' })

    // Baixar FFmpeg via ConfirmDialog
    await page.getByRole('button', { name: /Baixar FFmpeg/i }).click()
    const dialogo = page.getByRole('alertdialog')
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText(/GPL-3\.0-or-later/)
    await dialogo.getByRole('button', { name: /Confirmar download/i }).click()
    await expect(page.getByRole('region', { name: 'FFmpeg e FFprobe' }).getByText('Pronto')).toBeVisible()

    // Avançar para Passo 2
    await page.getByRole('button', { name: /Próximo: Provedor de IA/i }).click()
    await expect(page).toHaveURL(/#\/assistente\?passo=2$/)
    await expect(
      page.getByRole('heading', { name: 'Passo 2: Quem escolhe os Cortes e sugere títulos' }),
    ).toBeVisible()

    await expect(page.getByText(/Local · US\$ 0,00 · não sai do computador/i)).toBeVisible()
    const radioOllama = page.getByRole('radio', { name: /Ollama/i })
    await expect(radioOllama).toHaveAttribute('aria-checked', 'true')

    const rolagemPasso2 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemPasso2).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/assistente-passo2-1366.png' })

    // Concluir configuração com Ollama e retornar para #/inicio
    await page.getByRole('button', { name: /Concluir configuração/i }).click()
    await expect(page).toHaveURL(/#\/inicio$/)
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()

    expect(erros).toEqual([])
  })

  test('layout em 1440x900 e Pular por enquanto em Passo 2 sem pageerror', async ({ page }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#/assistente?passo=1')

    await expect(
      page.getByRole('heading', { name: 'Passo 1: Essencial para transcrever e cortar' }),
    ).toBeVisible()

    const rolagem1440P1 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440P1).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/assistente-passo1-1440.png' })

    await page.goto('/#/assistente?passo=2')
    await expect(
      page.getByRole('heading', { name: 'Passo 2: Quem escolhe os Cortes e sugere títulos' }),
    ).toBeVisible()

    // Testar exigência de consentimento na chave de API
    await page.getByRole('radio', { name: /Chave de API/i }).click()
    await expect(page.getByRole('button', { name: /Testar conexão/i })).toBeDisabled()

    const rolagem1440P2 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440P2).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/assistente-passo2-1440.png' })

    await page.getByRole('button', { name: /Pular por enquanto/i }).click()
    await expect(page).toHaveURL(/#\/inicio$/)

    expect(erros).toEqual([])
  })

  test('UI-03 e UI-05: consentimento de CLI começa desmarcado e reabrir de provedores retorna para #/config/provedores em 1366x768', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/config/provedores')
    await expect(page.getByRole('heading', { name: 'Provedores e Tarefas de IA' })).toBeVisible()

    await page.getByRole('button', { name: 'Reabrir assistente inicial' }).click()
    await expect(page).toHaveURL(/#\/assistente\?passo=1&retorno=config$/)

    await page.getByRole('button', { name: /Próximo: Provedor de IA/i }).click()
    await expect(page).toHaveURL(/#\/assistente\?passo=2&retorno=config$/)

    // UI-03: Codex CLI e OpenCode CLI iniciam sem consentimento marcado
    await page.getByRole('radio', { name: /Codex CLI/i }).click()
    const checkCodex = page.getByRole('checkbox', {
      name: /Concordo em enviar apenas texto de transcrições pela Codex CLI/i,
    })
    await expect(checkCodex).not.toBeChecked()
    const btnConcluir = page.getByRole('button', { name: /Concluir configuração/i })
    await expect(btnConcluir).toBeDisabled()

    await page.getByRole('radio', { name: /OpenCode CLI/i }).click()
    const checkOpencode = page.getByRole('checkbox', {
      name: /Concordo em enviar apenas texto de transcrições pela OpenCode CLI/i,
    })
    await expect(checkOpencode).not.toBeChecked()
    await expect(btnConcluir).toBeDisabled()

    await checkOpencode.check()
    await expect(btnConcluir).toBeEnabled()

    // UI-05: concluir retorna para #/config/provedores
    await btnConcluir.click()
    await expect(page).toHaveURL(/#\/config\/provedores$/)
    await expect(page.getByRole('heading', { name: 'Provedores e Tarefas de IA' })).toBeVisible()

    expect(erros).toEqual([])
  })
})
