import { expect, test } from '@playwright/test'

test.describe('Shell do front v2', () => {
  test('abre em #/inicio em 1366x768, abre/fecha Paleta com Ctrl+K/Esc e guarda rota de Projeto sem Projeto', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/')

    await expect(page).toHaveURL(/#\/inicio$/)
    await expect(page.getByText('Clipes', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Início e Projetos' })).toBeVisible()

    // Moldura externa não rola
    const rolagem = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem).toEqual({ altura: true, largura: true })

    await page.screenshot({ path: 'test-results/shell-1366.png' })

    // Ctrl+K abre a Paleta e Esc fecha
    await page.keyboard.press('Control+k')
    const paleta = page.getByRole('dialog', { name: 'Paleta de comandos' })
    await expect(paleta).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(paleta).toBeHidden()

    // Rota de Projeto sem Projeto aberto volta para #/inicio
    await page.goto('/#/projeto/x/cortes')
    await expect(page).toHaveURL(/#\/inicio$/)
    await expect(page.getByRole('heading', { name: 'Início e Projetos' })).toBeVisible()

    // ?estado=erro aciona BannerErroCore com role="alert"
    await page.goto('/#/inicio?estado=erro')
    await expect(page.getByRole('alert')).toBeVisible()

    expect(erros).toEqual([])
  })

  test('com Projeto aberto exibe etapas com aria-current e salva screenshot em 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?source-test=1#/projeto/test-project/cortes')

    await expect(page.getByText('Teste')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Etapas do Projeto' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Cortes' })).toHaveAttribute('aria-current', 'page')

    const rolagem = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem).toEqual({ altura: true, largura: true })

    await page.screenshot({ path: 'test-results/shell-1440.png' })
    expect(erros).toEqual([])
  })
})
