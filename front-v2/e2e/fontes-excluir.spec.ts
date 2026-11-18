import { expect, test } from '@playwright/test'

test.describe('Fontes — UI-15 (alvo Checkbox >= 24px), UI-16 (h1) e UI-18b (Excluir Fonte)', () => {
  test('alvo >= 24px, h1 em Fontes e Lotes, ConfirmDialog focado em Cancelar, source_busy e exclusão em 1366x768', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    // UI-16: exatamente 1 <h1> visível em Fontes e na sub-aba Lotes
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fontes e Transcrição' }),
    ).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    await page.getByRole('tab', { name: /^Lotes de Fontes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes\?sub=lotes$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fontes e Transcrição' }),
    ).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    await page.getByRole('tab', { name: /^Fontes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    // UI-15: cada checkbox sem rótulo visível tem alvo (<label>) >= 24x24 px
    const checkboxesLote = page.getByRole('checkbox', { name: /Selecionar .* para lote/i })
    const totalCheckboxes = await checkboxesLote.count()
    expect(totalCheckboxes).toBeGreaterThanOrEqual(3)

    const medidas = await checkboxesLote.evaluateAll((els) =>
      els.map((el) => {
        const alvo = el.closest('label') ?? el
        const rect = alvo.getBoundingClientRect()
        return {
          nome: el.getAttribute('aria-label') ?? alvo.textContent?.trim() ?? '',
          width: rect.width,
          height: rect.height,
        }
      }),
    )
    for (const m of medidas) {
      expect(m.width, `largura de "${m.nome}"`).toBeGreaterThanOrEqual(24)
      expect(m.height, `altura de "${m.nome}"`).toBeGreaterThanOrEqual(24)
    }

    // UI-18b (1): ConfirmDialog com foco inicial em Cancelar, texto sobre Cortes/edições e histórico de custos, sem ref de ticket
    const cardOffline = page.locator('article', { hasText: 'offline.mp4' })
    await expect(cardOffline).toBeVisible()
    await expect(cardOffline).not.toContainText(/#295/)

    await cardOffline.getByRole('button', { name: /Excluir Fonte/i }).click()
    const dlg = page.getByRole('alertdialog')
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText(/Cortes/i)
    await expect(dlg).toContainText(/edições/i)
    await expect(dlg).toContainText(/histórico de custos é mantido/i)
    await expect(dlg).not.toContainText(/#\d+/)

    const btnCancelar = dlg.getByRole('button', { name: 'Cancelar' })
    await expect(btnCancelar).toBeFocused()
    await btnCancelar.click()
    await expect(dlg).toBeHidden()
    await expect(cardOffline).toBeVisible()

    // UI-18b (2): source_busy quando há transcrição em andamento na Fonte
    const cardChanged = page.locator('article', { hasText: 'changed.mp4' })
    await cardChanged.getByRole('button', { name: /Verificar identidade/i }).click()
    const dlgHash = page.getByRole('alertdialog')
    await expect(dlgHash).toBeVisible()
    await dlgHash.getByRole('button', { name: /Confirmar verificação/i }).click()
    await expect(dlgHash).toBeHidden()
    await expect(cardChanged.getByText('Disponível', { exact: true })).toBeVisible()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/1'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'changed.mp4' })).toBeVisible()
    await page.getByRole('button', { name: 'Iniciar transcrição' }).click()
    await expect(
      page.getByRole('region', { name: 'Blocos de 10 min' }).getByText(/40%/),
    ).toBeVisible()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes'
    })
    await cardChanged.getByRole('button', { name: /Excluir Fonte/i }).click()
    const dlgBusy = page.getByRole('alertdialog')
    await expect(dlgBusy).toBeVisible()
    await dlgBusy.getByRole('button', { name: 'Excluir Fonte' }).click()
    await expect(dlgBusy).toBeHidden()

    const alertaBusy = page.getByRole('alert')
    await expect(alertaBusy).toBeVisible()
    await expect(alertaBusy).toContainText(
      /Há uma tarefa ativa ou incerta vinculada a esta Fonte; aguarde ou resolva na Fila de Jobs antes de excluir\./i,
    )
    await expect(cardChanged).toBeVisible()

    // UI-18b (3): exclusão com sucesso remove da lista e atualiza contador da aba
    await cardOffline.getByRole('button', { name: /Excluir Fonte/i }).click()
    const dlgExcluir = page.getByRole('alertdialog')
    await expect(dlgExcluir).toBeVisible()
    await dlgExcluir.getByRole('button', { name: 'Excluir Fonte' }).click()
    await expect(dlgExcluir).toBeHidden()

    await expect(page.locator('article', { hasText: 'offline.mp4' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Fontes (3)' })).toBeVisible()

    expect(erros).toEqual([])
  })
})
