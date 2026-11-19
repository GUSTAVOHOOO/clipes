import { expect, test, type Page } from '@playwright/test'

async function verificarSemOverflow(page: Page) {
  const rolagem = await page.evaluate(() => ({
    altura: document.documentElement.scrollHeight <= window.innerHeight,
    largura: document.documentElement.scrollWidth <= window.innerWidth,
  }))
  expect(rolagem).toEqual({ altura: true, largura: true })
}

test.describe('Dock global do Console ao vivo no Shell e ligação com Fila', () => {
  test('cobre botão na BarraStatus, Paleta Ctrl+K, Esc com foco, ciclo F6, "Ver console" na Fila e layout sem overflow em 1366x768 e 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()

    // 1. Recolhido por padrão
    const dock = page.locator('[data-regiao="console"]')
    await expect(dock).toHaveCount(0)
    await verificarSemOverflow(page)

    // 2. Abre pelo botão discreto na BarraStatus e fecha com Esc devolvendo foco
    const rodape = page.locator('[data-regiao="rodape"]')
    const gatilhoConsole = rodape.getByRole('button', { name: /Console/i })
    await expect(gatilhoConsole).toHaveAttribute('aria-expanded', 'false')

    await gatilhoConsole.click()
    await expect(dock).toBeVisible()
    await expect(gatilhoConsole).toHaveAttribute('aria-expanded', 'true')
    const log = dock.getByRole('log', { name: /Registro de atividade ao vivo/i })
    await expect(log).toHaveAttribute('aria-live', 'off')

    // Ciclo F6 inclui [data-regiao="console"] entre conteúdo e rodapé
    await page.locator('[data-regiao="conteudo"]').focus()
    await page.keyboard.press('F6')
    await expect.poll(() =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[data-regiao="console"]'))),
    ).toBe(true)

    await page.keyboard.press('F6')
    await expect.poll(() =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[data-regiao="rodape"]'))),
    ).toBe(true)

    await page.keyboard.press('Shift+F6')
    await expect.poll(() =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[data-regiao="console"]'))),
    ).toBe(true)

    // Esc dentro do dock fecha e devolve o foco ao gatilho
    await page.keyboard.press('Escape')
    await expect(dock).toHaveCount(0)
    await expect(gatilhoConsole).toBeFocused()
    await expect(gatilhoConsole).toHaveAttribute('aria-expanded', 'false')

    // 3. Abre pela Paleta (Ctrl+K) -> "Alternar console ao vivo" e fecha pelo botão recolhível
    await page.keyboard.press('Control+k')
    const paleta = page.getByRole('dialog', { name: 'Paleta de comandos' })
    await expect(paleta).toBeVisible()
    await paleta.getByText('Alternar console ao vivo').click()
    await expect(dock).toBeVisible()

    await dock.getByRole('button', { name: 'Console ao vivo' }).click()
    await expect(dock).toHaveCount(0)

    // 4. Abre Projeto Demo, dispara exportação em lote no mock e usa "Ver console" na Fila
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    await page.getByRole('link', { name: /Exportação/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao$/)

    const btnExportarLote = page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i })
    await expect(btnExportarLote).toBeEnabled()
    await btnExportarLote.click()

    const dlgAvisoDireto = page.getByRole('alertdialog', { name: /Corte direto/i })
    await expect(dlgAvisoDireto).toBeVisible()
    await dlgAvisoDireto.getByRole('button', { name: /Entendi e continuar/i }).click()
    await expect(dlgAvisoDireto).toBeHidden()

    await page.keyboard.press('Control+j')
    const asideFila = page.getByRole('complementary', { name: 'Fila de Jobs' })
    await expect(asideFila).toBeVisible()

    const cardLote = asideFila
      .locator('div.rounded-area', { hasText: /Exportação em lote #/i })
      .first()
    await expect(cardLote).toBeVisible()
    const btnVerConsole = cardLote.getByRole('button', { name: 'Ver console' })
    await btnVerConsole.click()

    // Dock abre filtrado mantendo PainelFilaJobs aberto e exibindo linhas do mock (Simples e Técnico)
    await expect(dock).toBeVisible()
    await expect(asideFila).toBeVisible()
    const logDock = dock.getByRole('log', { name: /Registro de atividade ao vivo/i })
    await expect(logDock.getByText('Iniciando exportação em lote…')).toBeVisible()

    await dock.getByRole('button', { name: 'Técnico' }).click()
    await expect(logDock.getByText(/encoder=h264_nvenc/)).toBeVisible()

    // 5. Sem overflow com PainelFilaJobs + Dock abertos ao mesmo tempo em 1366x768 e 1440x900
    const rotas = [
      '#/projeto/demo/exportacao',
      '#/projeto/demo/cortes/revisao/1',
      '#/projeto/demo/corte/102/editar?run=1',
    ]

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      for (const hash of rotas) {
        await page.evaluate((destino) => {
          window.location.hash = destino
        }, hash)
        await expect(dock).toBeVisible()
        await expect(asideFila).toBeVisible()
        await verificarSemOverflow(page)
      }
    }

    // Esc no dock fecha apenas o dock e mantém a Fila aberta
    await dock.getByRole('log').focus()
    await page.keyboard.press('Escape')
    await expect(dock).toHaveCount(0)
    await expect(asideFila).toBeVisible()

    expect(erros).toEqual([])
  })
})
