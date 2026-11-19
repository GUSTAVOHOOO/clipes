import { expect, test, type Page } from '@playwright/test'

async function abrirProjetoDemo(page: Page) {
  await page.goto('/#/inicio')
  await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
  await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
  await page.getByRole('link', { name: /Exportação/i }).click()
  await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao$/)
}

async function verificarSemRolagemExterna(page: Page) {
  const rolagem = await page.evaluate(() => ({
    altura: document.documentElement.scrollHeight <= window.innerHeight,
    largura: document.documentElement.scrollWidth <= window.innerWidth,
  }))
  expect(rolagem).toEqual({ altura: true, largura: true })
}

test.describe('Tela Exportação — Mesa de Prontidão e Histórico de Lotes (#/projeto/:id/exportacao)', () => {
  test('cobre estados §6, cards V1, navegação, checklist, avisos/conflitos, fallback x264 e viewports 1366x768 e 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await abrirProjetoDemo(page)

    // 3. Estado padrão (ready): cards aprovados com tipo, duração tabular, Permissão e glifos
    await expect(page.getByRole('heading', { level: 1, name: 'Exportação' })).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)

    const cards = page.getByRole('article')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThanOrEqual(3)

    // Card V1 sem Empacotamento (candidate 102 — Corte direto)
    await expect(page.getByText(/Título sugerido \(sem Empacotamento\)/i).first()).toBeVisible()
    await expect(page.getByText('Corte direto').first()).toBeVisible()
    await expect(page.getByText('Vídeo transformado').first()).toBeVisible()
    await expect(page.getByText('Sem capa').first()).toBeVisible()

    // 5. Checklist informativo de guardrails.check visível sem bloquear o botão primário
    await expect(
      page.getByText('Checklist informativo — nenhum item bloqueia a exportação.'),
    ).toBeVisible()
    const btnDisparo = page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i })
    await expect(btnDisparo).toBeEnabled()

    // Atualizar prontidão em lote habilitado + filtro por Fonte via export.readiness
    const btnAtualizar = page.getByRole('button', { name: /Atualizar prontidão em lote/i })
    await expect(btnAtualizar).toBeEnabled()
    await btnAtualizar.click()
    await expect(cards.first()).toBeVisible()

    await page.getByRole('combobox', { name: /Filtrar por Fonte/i }).click()
    await page.getByRole('option', { name: 'offline.mp4' }).click()
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Exportar 1 da Fonte em lote/i })).toBeVisible()

    await page.getByRole('combobox', { name: /Filtrar por Fonte/i }).click()
    await page.getByRole('option', { name: 'Todas as Fontes' }).click()
    await expect(page.getByRole('article').first()).toBeVisible()
    expect(await page.getByRole('article').count()).toBeGreaterThanOrEqual(3)

    // #484 / #303: Salvar pasta padrão via export.settings.set e persistir entre rotas
    const campoPastaPadrao = page.getByRole('textbox', { name: /Pasta de saída/i })
    await expect(campoPastaPadrao).toHaveValue('/test/exports')
    await campoPastaPadrao.fill('/test/pasta-padrao-e2e')
    await page.getByRole('button', { name: 'Salvar pasta padrão' }).click()
    await expect(page.getByText('Pasta padrão de exportação salva.').first()).toBeVisible()

    // Caminho relativo é recusado sem sobrescrever a pasta padrão salva
    await campoPastaPadrao.fill('pasta/relativa')
    await page.getByRole('button', { name: 'Salvar pasta padrão' }).click()
    await expect(
      page.getByText('Informe uma pasta existente com caminho completo.'),
    ).toBeVisible()

    await page.getByRole('link', { name: /Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)
    await page.getByRole('link', { name: /Exportação/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao$/)
    await expect(page.getByRole('textbox', { name: /Pasta de saída/i })).toHaveValue(
      '/test/pasta-padrao-e2e',
    )
    await page.getByRole('textbox', { name: /Pasta de saída/i }).fill('/test/exports')
    await page.getByRole('button', { name: 'Salvar pasta padrão' }).click()
    await expect(page.getByText('Pasta padrão de exportação salva.').first()).toBeVisible()

    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/exportacao-prontidao-1366.png' })

    // 1440x900 sem rolagem externa + screenshot
    await page.setViewportSize({ width: 1440, height: 900 })
    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/exportacao-prontidao-1440.png' })
    await page.setViewportSize({ width: 1366, height: 768 })

    // 4. Clicar em "Empacotar" navega para a rota exata do Corte e voltar retorna à Mesa de Prontidão
    const cardTransformado = page.getByRole('article', { name: /A virada que mudou toda a partida/i })
    await cardTransformado.getByRole('button', { name: 'Empacotar' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/corte\/202\/empacotar\?run=2$/)
    await page.goBack()
    await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Exportação' })).toBeVisible()

    // 1. ?estado=carregando exibe Skeletons e nunca "Nenhum Corte aprovado"
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=carregando'
    })
    await expect(page.getByRole('status', { name: /Carregando Mesa de Prontidão/i })).toBeVisible()
    await expect(page.getByRole('status', { name: /Carregando configuração do lote/i })).toBeVisible()
    await expect(page.getByText('Nenhum Corte aprovado para exportar')).toHaveCount(0)

    // 2. ?estado=vazio exibe "Nenhum Corte aprovado para exportar" e CTA "Ir para Cortes"
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=vazio'
    })
    await expect(page.getByText('Nenhum Corte aprovado para exportar')).toBeVisible()
    await page.getByRole('button', { name: 'Ir para Cortes' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)

    // 10. ?estado=erro (component_missing) exibe role="alert" humano e botão para #/config/componentes
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=erro'
    })
    const alerta = page.getByRole('alert')
    await expect(alerta).toBeVisible()
    await expect(alerta).toContainText(/componente ou modelo necessário/i)
    await expect(alerta.locator('code')).toBeHidden()
    await alerta.getByRole('button', { name: /Instalar componente/i }).click()
    await expect(page).toHaveURL(/#\/config\/componentes$/)

    // 6 e 7. Volta à Mesa, preenche pasta com conflito ("/test/conflitos") e dispara lote:
    //        needsDirectNotice -> guardrails.ack_direct_notice -> confirmation_required (conflicts) -> confirmed: true
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=fallback'
    })
    await expect(page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i })).toBeEnabled()

    const campoPasta = page.getByRole('textbox', { name: /Pasta de saída/i })
    await campoPasta.fill('/test/conflitos')

    await page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i }).click()

    // Primeiro diálogo: Aviso único de Corte direto
    const dlgDireto = page.getByRole('alertdialog')
    await expect(dlgDireto).toBeVisible()
    await expect(dlgDireto).toContainText(/Corte direto/i)
    await dlgDireto.getByRole('button', { name: /Entendi e continuar/i }).click()

    // Segundo diálogo: Conflitos de sobrescrita (confirmation_required)
    const dlgConflitos = page.getByRole('alertdialog')
    await expect(dlgConflitos).toBeVisible()
    await expect(dlgConflitos).toContainText('changed-01-01m30s.mp4')
    await expect(dlgConflitos).toContainText('changed-02-06m30s.mp4')
    await dlgConflitos.getByRole('button', { name: /Sobrescrever e exportar/i }).click()
    await expect(dlgConflitos).toBeHidden()

    // Redireciona para ?sub=lotes e conclui com selo fallback x264
    await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao\?sub=lotes/)
    await expect(page.getByText('Caiu para x264').first()).toBeVisible({ timeout: 5000 })

    // Inspeciona também o lote histórico V1 parcial (#6399) com filtro "Mostrar apenas falhas"
    await page.getByRole('button', { name: /Lote #6399/i }).click()
    await expect(
      page.getByText(/Lote concluído parcialmente: 2 de 3 Cortes exportados e 1 com falha/i),
    ).toBeVisible()

    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/exportacao-lotes-1366.png' })

    await page.setViewportSize({ width: 1440, height: 900 })
    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/exportacao-lotes-1440.png' })

    expect(erros).toEqual([])
  })

  test('F6 alcança a Fila aberta, Esc a fecha depois de Tab e alvos têm >= 24 px (UI-80, UI-82)', async ({
    page,
  }) => {
    for (const tamanho of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(tamanho)
      await abrirProjetoDemo(page)
      await page.keyboard.press('Control+j')
      const fila = page.getByRole('complementary', { name: 'Fila de Jobs' })
      await expect(fila).toBeVisible()

      const regioes = new Set<string | null>()
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('F6')
        regioes.add(
          await page.evaluate(
            () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
          ),
        )
      }
      expect(regioes.has('fila')).toBe(true)

      await fila.getByRole('button', { name: /Fechar Fila/i }).focus()
      await page.keyboard.press('Escape')
      await expect(fila).toBeHidden()

      const alturas = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('footer button, main button'))
          .filter((b) => b.offsetParent !== null && !b.hasAttribute('disabled'))
          .map((b) => ({ n: b.textContent?.trim() ?? '', h: b.getBoundingClientRect().height }))
          .filter((b) => b.h < 24),
      )
      expect(alturas).toEqual([])
    }
  })

  test('cobre progresso core-progress em tempo real e cancelamento de lote via ConfirmDialog', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await abrirProjetoDemo(page)

    // Instala clock sintético pausado para controlar os timers do mock de export.batch.start
    await page.clock.install()

    await page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i }).click()
    const dlgDireto = page.getByRole('alertdialog')
    await expect(dlgDireto).toBeVisible()

    // Pausa o clock antes de confirmar o disparo para segurar t1 (120 ms) e t2 (260 ms)
    await page.clock.pauseAt(Date.now())
    await dlgDireto.getByRole('button', { name: /Entendi e continuar/i }).click()
    await page.clock.runFor(40)
    await expect(dlgDireto).toBeHidden()

    await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao\?sub=lotes$/)
    await expect(page.getByRole('button', { name: 'Cancelar lote' })).toBeVisible()

    // Avança 100 ms (total ~140 ms > 120 ms de t1, < 260 ms de t2) para disparar o evento intermediário core-progress
    await page.clock.runFor(100)
    await expect(page.getByRole('grid')).toContainText('Exportado')
    await expect(page.getByRole('grid')).toContainText('Exportando')

    // 9. Cancela o lote em andamento via ConfirmDialog -> estado Cancelado
    await page.getByRole('button', { name: 'Cancelar lote' }).click()
    await page.clock.runFor(20)
    const dlgCancelar = page.getByRole('alertdialog')
    await expect(dlgCancelar).toBeVisible()
    await dlgCancelar.getByRole('button', { name: 'Cancelar lote' }).click()
    await page.clock.runFor(40)
    await expect(dlgCancelar).toBeHidden()

    await expect(page.getByRole('button', { name: 'Cancelar lote' })).toBeHidden()
    await expect(page.getByRole('region', { name: 'Lista de lotes exportados' })).toContainText(
      'Cancelado',
    )

    expect(erros).toEqual([])
  })
})
