import { expect, test, type Page } from '@playwright/test'

async function verificarSemRolagemExterna(page: Page) {
  const rolagem = await page.evaluate(() => ({
    altura: document.documentElement.scrollHeight <= window.innerHeight,
    largura: document.documentElement.scrollWidth <= window.innerWidth,
  }))
  expect(rolagem).toEqual({ altura: true, largura: true })
}

test.describe('Tela Sobre e Atualizações (#/sobre)', () => {
  test('cobre versão, abas legais por teclado, carregamento, atualização disponível, assinatura inválida, busca vazia e 1366/1440', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    // 1. Estado padrão em 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/sobre')

    await expect(page.getByRole('heading', { level: 1, name: 'Sobre e atualizações' })).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByText(/Versão instalada:/i)).toBeVisible()
    await expect(page.getByText(/Apache-2\.0/).first()).toBeVisible()

    const abaLicenca = page.getByRole('tab', { name: /Licença do Clipes \(Apache-2\.0\)/i })
    const abaAtribuicoes = page.getByRole('tab', { name: /Atribuições de terceiros/i })
    await expect(abaLicenca).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Texto integral da licença Apache-2.0')).toHaveAttribute(
      'tabindex',
      '0',
    )

    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/sobre-licenca-1366.png' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/sobre-licenca-1440.png' })
    await page.setViewportSize({ width: 1366, height: 768 })

    // Alterna abas via seta direita + Enter
    await abaLicenca.focus()
    await page.keyboard.press('ArrowRight')
    await expect(abaAtribuicoes).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(abaAtribuicoes).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Atribuições de terceiros')).toHaveAttribute('tabindex', '0')

    // 5. Busca sem resultado -> estado vazio + "Limpar busca"
    const busca = page.getByRole('searchbox', { name: /Buscar biblioteca ou componente/i })
    await busca.fill('biblioteca-inexistente-xyz')
    await expect(
      page.getByText(/Nenhuma atribuição encontrada para "biblioteca-inexistente-xyz"\./i),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Limpar busca' }).click()
    await expect(busca).toHaveValue('')

    // 2. ?estado=carregando exibe Skeleton na versão mantendo licenças visíveis
    await page.goto('/?estado=carregando#/sobre')
    await expect(page.getByRole('status', { name: /Carregando versão instalada/i })).toBeVisible()
    await expect(page.getByText(/Apache License/i)).toBeVisible()

    // 3. ?updater-test=available: verificar exibe versão 0.2.0 sem instalar automaticamente
    await page.goto('/?updater-test=available#/sobre')
    await page.getByRole('button', { name: 'Verificar atualizações' }).click()
    await expect(page.getByText(/Nova versão disponível:/i)).toBeVisible()
    await expect(page.getByText(/0\.2\.0/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Baixar e instalar 0\.2\.0/i })).toBeVisible()

    await page.setViewportSize({ width: 1440, height: 900 })
    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/sobre-atualizacao-1440.png' })
    await page.setViewportSize({ width: 1366, height: 768 })

    // 4. ?updater-test=invalid-signature: bloqueia instalação em role="alert"
    await page.goto('/?updater-test=invalid-signature#/sobre')
    await page.getByRole('button', { name: 'Verificar atualizações' }).click()
    const alerta = page.getByRole('alert')
    await expect(alerta).toBeVisible()
    await expect(alerta).toContainText(/assinatura digital.*falhou|bloqueada por segurança/i)
    await expect(page.getByRole('button', { name: /Baixar e instalar/i })).toHaveCount(0)

    // 6. Link "Componentes e Armazenamento" navega para #/config/componentes
    await page.getByRole('link', { name: /Componentes e Armazenamento/i }).click()
    await expect(page).toHaveURL(/#\/config\/componentes$/)

    expect(erros).toEqual([])
  })
})
