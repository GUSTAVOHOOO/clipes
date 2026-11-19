import { expect, test } from '@playwright/test'

test.describe('Tela Configurador e Acompanhamento de Seleção (#/projeto/:id/cortes)', () => {
  test('estados §6, duração > 60s, energia, seleção paga, parcial/uncertain #290 e revisões em 1366x768 e 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    // Navega para 2. Cortes pela Barra Superior
    await page.getByRole('link', { name: 'Cortes' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)

    // 1. Pré-preenchimento do Projeto Demo e único botão primário (bg-sinal)
    await expect(page.getByRole('heading', { level: 1, name: 'Seleção de Cortes' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Corte direto/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByLabel(/Duração mínima/i)).toHaveValue('20')
    await expect(page.getByLabel(/Duração máxima/i)).toHaveValue('60')
    await expect(page.getByText(/Janela de contexto: Completa \(15 min\)/i)).toBeVisible()
    await expect(page.getByText(/Remoto \(HTTPS\)/i)).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Selecionar Cortes' })).toHaveClass(/bg-sinal/)

    // Verifica ausência de rolagem externa em 1366x768 e salva screenshot
    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })

    // UI-51: em 1366x768, ResumoCustoPrivacidade e botão "Selecionar Cortes" cabem acima da dobra sem rolar
    const dobra1366 = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Configurador de Seleção"]')!
      const resumo = aside.querySelector('section[aria-label^="Resumo de custo e privacidade"]')!
      const btn = Array.from(aside.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Selecionar Cortes'),
      )!
      const ar = aside.getBoundingClientRect()
      const rr = resumo.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      return {
        resumoVisivel: rr.top >= ar.top - 1 && rr.bottom <= br.top + 1,
        botaoVisivel: br.top >= ar.top - 1 && br.bottom <= ar.bottom + 1,
      }
    })
    expect(dobra1366).toEqual({ resumoVisivel: true, botaoVisivel: true })

    // UI-36: F6 / Shift+F6 ciclam Topo -> Configurador -> Acompanhamento -> Rodapé
    await page.keyboard.press('F6')
    await expect(page.locator('[data-regiao="topo"] :focus')).toHaveCount(1)
    await page.keyboard.press('F6')
    await expect(page.locator('aside[aria-label="Configurador de Seleção"] :focus')).toHaveCount(1)
    await page.keyboard.press('F6')
    await expect(page.locator('section[aria-label="Acompanhamento de Seleção"] :focus')).toHaveCount(1)
    await page.keyboard.press('F6')
    await expect(page.locator('[data-regiao="rodape"]:focus, [data-regiao="rodape"] :focus')).toHaveCount(1)
    await page.keyboard.press('Shift+F6')
    await expect(page.locator('section[aria-label="Acompanhamento de Seleção"] :focus')).toHaveCount(1)

    // UI-50: foco visível com outline-solid em Select e Entrada
    const selectFonte = page.getByRole('combobox', { name: /Fonte transcrita/i })
    await selectFonte.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(selectFonte).toBeFocused()
    const outlineSelect = await selectFonte.evaluate((el) => {
      const st = getComputedStyle(el)
      return { style: st.outlineStyle, width: st.outlineWidth }
    })
    expect(outlineSelect).toEqual({ style: 'solid', width: '2px' })

    const inputMin = page.getByLabel(/Duração mínima/i)
    await inputMin.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(inputMin).toBeFocused()
    const outlineEntrada = await inputMin.evaluate((el) => {
      const st = getComputedStyle(el)
      return { style: st.outlineStyle, width: st.outlineWidth }
    })
    expect(outlineEntrada).toEqual({ style: 'solid', width: '2px' })

    // UI-35: não expõe identificador "legacy" no Acompanhamento
    await expect(page.locator('section[aria-label="Acompanhamento de Seleção"]')).not.toContainText(/\blegacy\b/i)

    await page.screenshot({ path: 'test-results/cortes-selecao-1366.png' })

    // 2. ?estado=vazio -> "Nenhuma Fonte transcrita ainda" e CTA navega para #/projeto/demo/fontes
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?estado=vazio'
    })
    await expect(page.getByText('Nenhuma Fonte transcrita ainda')).toBeVisible()
    await page.getByRole('button', { name: 'Ir para Fontes e Transcrição' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    // Volta para Cortes e confere ?estado=erro
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?estado=erro'
    })
    const alertaErro = page.getByRole('alert')
    await expect(alertaErro).toBeVisible()
    await expect(alertaErro).toContainText(/Somente local/i)
    await expect(alertaErro.getByRole('button', { name: 'Escolher Perfil local' })).toBeVisible()
    await expect(alertaErro.getByRole('button', { name: 'Ver veto do Projeto' })).toBeVisible()

    // 3. ?estado=parcial com janela uncertain -> bloqueia retomada sem expor ticket e resolve via DialogoResolverIncerteza
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?estado=parcial'
    })
    const bannerIncerta = page.getByRole('alert')
    await expect(bannerIncerta).toContainText(/Chamada paga incerta/i)
    await expect(bannerIncerta).not.toContainText(/#\d+/)
    const btnRetomar = page.getByRole('button', { name: 'Retomar janelas pendentes' })
    await expect(btnRetomar).toBeDisabled()
    await expect(btnRetomar).toHaveAttribute('aria-disabled', 'true')
    await btnRetomar.hover()
    const tooltipIncerta = page.getByText(/Há janela incerta nesta execução; resolva na Fila antes de retomar\./i)
    await expect(tooltipIncerta).toBeVisible()
    await expect(tooltipIncerta).not.toContainText(/#\d+/)

    await bannerIncerta.getByRole('button', { name: 'Resolver na Fila' }).click()
    const dlgIncerteza = page.getByRole('alertdialog')
    await expect(dlgIncerteza).toBeVisible()
    await expect(dlgIncerteza.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dlgIncerteza.getByRole('button', { name: 'Descartar chamada' }).click()
    await expect(dlgIncerteza).toBeHidden()
    await expect(page.getByRole('alert')).toHaveCount(0)

    // 4. Alternar Revisão Rev. 1 / Rev. 2 atualiza ?rev=
    const tablistRev = page.getByRole('tablist', { name: /Revisão da execução/i })
    await tablistRev.getByRole('tab', { name: /Rev\. 1/i }).click()
    await expect(page).toHaveURL(/rev=1/)
    await tablistRev.getByRole('tab', { name: /Rev\. 2/i }).click()
    await expect(page).toHaveURL(/rev=2/)

    // 5. Volta à rota limpa, altera duração para 30-90 s, mede energia e dispara seleção paga
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes'
    })
    await expect(page.getByRole('button', { name: 'Selecionar Cortes' })).toBeVisible()

    await page.getByLabel(/Duração mínima/i).fill('30')
    await page.getByLabel(/Duração máxima/i).fill('90')
    await expect(page.getByText(/acima de 60 s/i)).toBeVisible()

    // Medir energia do áudio
    await page.getByRole('button', { name: 'Medir energia do áudio' }).click()
    await expect(page.getByText(/4 altas · 2 picos/i)).toBeVisible()

    // Disparar seleção paga -> ConfirmDialog com foco em Cancelar -> selection:done
    await page.getByRole('button', { name: 'Selecionar Cortes' }).click()
    const dlgConfirm = page.getByRole('alertdialog')
    await expect(dlgConfirm).toBeVisible()
    await expect(dlgConfirm.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await expect(dlgConfirm).toContainText(/Remoto \(HTTPS\)/i)
    await dlgConfirm.getByRole('button', { name: 'Confirmar e selecionar Cortes' }).click()
    await expect(dlgConfirm).toBeHidden()

    await expect(page.getByRole('button', { name: /Abrir bancada de revisão/i })).toBeEnabled()

    // 6. Viewport 1440x900: grade de Janelas em 2 colunas, zero scroll externo e screenshot
    await page.setViewportSize({ width: 1440, height: 900 })
    const cols1440 = await page
      .getByRole('list')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    expect(cols1440).toBe(2)

    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/cortes-selecao-1440.png' })

    // 7. UI-30 / UI-51 / UI-52: ?selection-blocked=1 em 1366x768 exibe context_too_small sem selo CLI e sem cortar detalhe técnico
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?selection-blocked=1#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes'
    })
    await expect(page.getByRole('button', { name: 'Reduzir duração máxima' })).toBeVisible()
    await expect(page.getByText(/Configure um Perfil de Provedor para selecionar Cortes/i)).toHaveCount(0)
    await expect(page.getByText('Contexto gerenciado pelo CLI')).toHaveCount(0)
    await expect(page.getByText('Janela de contexto: Bloqueada')).toBeVisible()

    const dobraErro1366 = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Configurador de Seleção"]')!
      const summary = aside.querySelector('summary')!
      const btn = Array.from(aside.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Selecionar Cortes'),
      )!
      const ar = aside.getBoundingClientRect()
      const sr = summary.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      return {
        detalheTecnicoVisivel: sr.bottom <= ar.bottom + 1,
        botaoVisivel: br.bottom <= ar.bottom + 1,
      }
    })
    expect(dobraErro1366).toEqual({ detalheTecnicoVisivel: true, botaoVisivel: true })

    expect(erros).toEqual([])
  })
})
