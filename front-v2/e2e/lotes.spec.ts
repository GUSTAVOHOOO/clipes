import { expect, test } from '@playwright/test'

test.describe('Tela Lotes de Fontes (#/projeto/:id/fontes?sub=lotes)', () => {
  test('estados §6, lote pago com ConfirmDialog, local_only_violation, pausar/retomar/cancelar, uncertain_job e budget_paused em 1366x768 e 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    // Navega para sub-aba Lotes de Fontes
    await page.getByRole('tab', { name: /Lotes de Fontes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes\?sub=lotes$/)

    // ?estado=vazio em ?sub=lotes
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?sub=lotes&estado=vazio'
    })
    await expect(page.getByText('Nenhum lote executado neste Projeto ainda.')).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Focar seleção de Fontes' })).not.toHaveClass(
      /bg-sinal/,
    )
    await page.getByRole('button', { name: 'Focar seleção de Fontes' }).click()

    // ?estado=carregando
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?sub=lotes&estado=carregando'
    })
    await expect(page.getByRole('status', { name: /Carregando Fontes para o lote/i })).toBeVisible()
    await expect(page.getByText('Nenhum lote executado neste Projeto ainda.')).toHaveCount(0)

    // ?estado=erro
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?sub=lotes&estado=erro'
    })
    const alertaEstado = page.getByRole('alert')
    await expect(alertaEstado).toBeVisible()
    await expect(alertaEstado).toContainText(/Somente local/i)

    // Volta ao normal
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?sub=lotes'
    })
    await expect(page.getByRole('heading', { name: 'Novo Lote de Fontes' })).toBeVisible()

    // Fonte offline fica desabilitada no construtor
    const chkOffline = page.getByRole('checkbox', { name: /offline\.mp4/i })
    await expect(chkOffline).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText(/Offline — não pode ser transcrita agora/i)).toBeVisible()

    // Seleciona 3 Fontes disponíveis e escolhe Groq (pago/remoto) -> ConfirmDialog com ResumoCustoPrivacidade
    await page.getByRole('checkbox', { name: /changed\.mp4/i }).click()
    await page.getByRole('checkbox', { name: /mismatch\.mp4/i }).click()
    await page.getByRole('checkbox', { name: /Live_12_11_final\.mp4/i }).click()
    await page.getByRole('radio', { name: /Groq \(remoto\)/i }).click()

    await page.getByRole('button', { name: 'Iniciar lote com 3 Fontes' }).click()
    const dlgCriar = page.getByRole('alertdialog')
    await expect(dlgCriar).toBeVisible()
    await expect(dlgCriar).toContainText(/Groq/i)
    await expect(dlgCriar).toContainText(/api\.groq\.com/i)
    await dlgCriar.getByRole('button', { name: 'Confirmar e iniciar lote' }).click()
    await expect(dlgCriar).toBeHidden()

    const cardLote1 = page.getByRole('article', { name: 'Lote #1' })
    await expect(cardLote1).toBeVisible()
    await expect(cardLote1.getByText(/Em execução/i)).toBeVisible()

    // Verifica viewport 1366x768 sem scroll externo e captura screenshot
    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/lotes-1366.png' })

    // Pausar e retomar lote
    await cardLote1.getByRole('button', { name: 'Pausar lote' }).click()
    await expect(cardLote1.getByText('Pausado pelo usuário')).toBeVisible()
    await cardLote1.getByRole('button', { name: 'Retomar lote' }).click()
    await expect(cardLote1.getByText(/Em execução/i)).toBeVisible()

    // Retomar item pausado (Groq exige confirmação)
    await cardLote1.getByRole('button', { name: 'Retomar item' }).click()
    const dlgRetomarItem = page.getByRole('alertdialog')
    await expect(dlgRetomarItem).toBeVisible()
    await dlgRetomarItem.getByRole('button', { name: 'Confirmar e retomar' }).click()
    await expect(dlgRetomarItem).toBeHidden()

    // Cancelar lote via ConfirmDialog
    await cardLote1.getByRole('button', { name: 'Cancelar lote' }).click()
    const dlgCancelar = page.getByRole('alertdialog')
    await expect(dlgCancelar).toBeVisible()
    await dlgCancelar.getByRole('button', { name: 'Cancelar lote' }).click()
    await expect(dlgCancelar).toBeHidden()
    await expect(cardLote1.getByText('Cancelado', { exact: true }).first()).toBeVisible()

    // Cenário budget_paused (cost_unknown) + item uncertain_job via flags de hash
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash =
        '#/projeto/meu-canal-de-cortes/fontes?sub=lotes&batch-unknown=1&batch-uncertain=1'
    })
    await page.getByRole('checkbox', { name: /changed\.mp4/i }).click()
    await page.getByRole('checkbox', { name: /mismatch\.mp4/i }).click()
    await page.getByRole('checkbox', { name: /Live_12_11_final\.mp4/i }).click()
    await page.getByRole('radio', { name: /Local \(US\$ 0,00\)/i }).click()
    await page.getByRole('button', { name: 'Iniciar lote com 3 Fontes' }).click()

    const cardLote2 = page.getByRole('article', { name: 'Lote #2' })
    await expect(cardLote2).toBeVisible()
    await expect(cardLote2.getByText('Pausado por orçamento')).toBeVisible()

    // Item com timeout_uncertain já oferece "Resolver na Fila de Jobs"
    await expect(cardLote2.getByRole('button', { name: 'Resolver na Fila de Jobs' })).toBeVisible()

    // Screenshot 1440x900 com lote budget_paused + item incerto + grid expandido
    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/lotes-1440.png' })

    // Ajustar orçamento e continuar com ciência de cost_unknown
    await cardLote2.getByRole('button', { name: 'Ajustar orçamento e continuar' }).click()
    const dlgOrc = page.getByRole('dialog', { name: /Ajustar orçamento/i })
    await expect(dlgOrc).toBeVisible()
    await dlgOrc.getByLabel(/Novo teto de custo/i).fill('4.00')
    await dlgOrc.getByRole('checkbox', { name: /custo.*desconhecido/i }).click()
    await dlgOrc.getByRole('button', { name: 'Continuar lote' }).click()
    await expect(dlgOrc).toBeHidden()
    await expect(cardLote2.getByText(/Em execução/i)).toBeVisible()

    // Ativa Somente local em Configurações do Projeto e verifica local_only_violation ao tentar Groq
    await page.evaluate(() => {
      window.location.hash = '#/config/projeto'
    })
    await page.getByRole('tab', { name: /Privacidade/i }).click()
    await page.getByRole('switch', { name: /Somente local/i }).click()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?sub=lotes'
    })
    await expect(page.getByText('Bloqueado por Somente local').first()).toBeVisible()
    await page.getByRole('checkbox', { name: /changed\.mp4/i }).click()
    await page.getByRole('radio', { name: /Groq \(remoto\)/i }).click()
    await page.getByRole('button', { name: 'Iniciar lote com 1 Fonte' }).click()

    const alertaLocalOnly = page
      .getByRole('region', { name: 'Construtor de Lote de Fontes' })
      .getByRole('alert')
    await expect(alertaLocalOnly).toBeVisible()
    await expect(alertaLocalOnly).toContainText(/Somente local/i)
    await expect(
      alertaLocalOnly.getByRole('button', { name: 'Escolher Perfil local' }),
    ).toBeVisible()

    expect(erros).toEqual([])
  })

  test('UI-22: rola até o BannerErroCore e move foco para o alerta quando falha após rolar em 1366x768', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    await page.evaluate(() => {
      window.location.hash = '#/config/projeto'
    })
    await page.getByRole('tab', { name: /Privacidade/i }).click()
    await page.getByRole('switch', { name: /Somente local/i }).click()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?sub=lotes'
    })
    await expect(page.getByText('Bloqueado por Somente local').first()).toBeVisible()
    await page.getByRole('checkbox', { name: /changed\.mp4/i }).click()
    await page.getByRole('radio', { name: /Groq \(remoto\)/i }).click()
    const btnIniciar = page.getByRole('button', { name: 'Iniciar lote com 1 Fonte' })
    await btnIniciar.scrollIntoViewIfNeeded()
    await btnIniciar.click()

    const alertaLocalOnly = page
      .getByRole('region', { name: 'Construtor de Lote de Fontes' })
      .getByRole('alert')
    await expect(alertaLocalOnly).toBeVisible()

    const visibilidadeErro = await alertaLocalOnly.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const parentScroll = el.closest('.overflow-y-auto')
      const pRect = parentScroll ? parentScroll.getBoundingClientRect() : null
      const active = document.activeElement
      return {
        naViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
        naColuna: pRect ? rect.top >= pRect.top - 1 && rect.bottom <= pRect.bottom + 1 : true,
        focado: Boolean(active && (active === el || el.contains(active) || active.contains(el))),
      }
    })
    expect(visibilidadeErro).toEqual({ naViewport: true, naColuna: true, focado: true })
  })
})
