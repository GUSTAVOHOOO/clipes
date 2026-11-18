import { expect, test } from '@playwright/test'

test.describe('Tela Editar do Corte (#/projeto/:id/corte/:corteId/editar)', () => {
  test('cobre ContextoCorte, Variante D em 1366x768 e 1440x900, atalhos, popovers, Timeline, guarda de saída e offline', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.addInitScript(() => {
      const origSetTimeout = window.setTimeout.bind(window)
      const pendentes: Array<() => void> = []
      ;(window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers = false
      ;(window as unknown as { __releaseMockTimers?: () => void }).__releaseMockTimers = () => {
        ;(window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers = false
        while (pendentes.length > 0) {
          const fn = pendentes.shift()
          if (fn) fn()
        }
      }
      window.setTimeout = ((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
        const d = typeof delay === 'number' ? delay : 0
        if (
          (window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers &&
          d >= 10 &&
          d <= 50 &&
          typeof fn === 'function'
        ) {
          pendentes.push(() => fn(...args))
          return 0 as unknown as number
        }
        return origSetTimeout(fn, delay, ...args)
      }) as typeof window.setTimeout
    })

    // 1. Abre o Projeto Demo em 1366x768 e navega para Corte direto 102 (?run=1)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/102/editar?run=1'
    })

    // Aguarda carregamento completo da tela Editar
    const navAbas = page.getByRole('navigation', { name: 'Etapas do Corte' })
    await expect(navAbas.getByRole('link', { name: 'Editar' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(navAbas.getByRole('link', { name: 'Transformar' })).toHaveCount(0)
    await expect(navAbas.getByRole('link', { name: 'Empacotar' })).toBeVisible()
    await expect(page.getByText('Corte direto')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Converter em Vídeo transformado' }),
    ).toBeDisabled()

    // Regra da Luz Única: exatamente 1 botão primário (Exportar Corte) e sem painel direito fixo
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Exportar Corte/i })).toHaveClass(/bg-sinal/)
    await expect(page.getByRole('complementary', { name: /Inspetor/i })).toHaveCount(0)

    // Zero scroll externo e único h1 em 1366x768
    const check1366 = await page.evaluate(() => ({
      alturaOk: document.documentElement.scrollHeight <= window.innerHeight,
      larguraOk: document.documentElement.scrollWidth <= window.innerWidth,
      h1Count: document.querySelectorAll('h1').length,
    }))
    expect(check1366).toEqual({ alturaOk: true, larguraOk: true, h1Count: 1 })
    await page.screenshot({ path: 'test-results/corte-editar-1366.png' })

    // Ctrl+[ recolhe e reabre Transcrição; Ctrl+] abre e fecha popover
    await page.keyboard.press('Control+[')
    await expect(page.getByRole('complementary', { name: 'Transcrição recolhida' })).toBeVisible()
    await page.keyboard.press('Control+[')
    await expect(
      page.getByRole('complementary', { name: 'Transcrição e Índice do Corte' }),
    ).toBeVisible()

    await page.keyboard.press('Control+]')
    const optRosto1366 = page.getByText('Rosto (9:16)')
    await expect(optRosto1366).toBeVisible()
    await page.waitForTimeout(220)
    await page.screenshot({ path: 'test-results/corte-editar-popover-1366.png' })
    await page.keyboard.press('Control+]')
    await expect(optRosto1366).toBeHidden()

    // 2. Ctrl+E abre diálogo de exportação individual (guardrails + ack + export.start)
    await page.keyboard.press('Control+e')
    const dlgExp = page.getByRole('dialog', { name: /Exportar Corte/i })
    await expect(dlgExp).toBeVisible()
    const btnEntendi = dlgExp.getByRole('button', { name: /Entendi o risco/i })
    if (await btnEntendi.isVisible()) {
      await btnEntendi.click()
    }
    const btnIniciarExp = dlgExp.getByRole('button', { name: /Iniciar exportação/i })
    await expect(btnIniciarExp).toBeEnabled()
    await page.evaluate(() => {
      ;(window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers = true
    })
    await btnIniciarExp.click()
    await expect(dlgExp.getByRole('button', { name: /Cancelar exportação/i })).toBeVisible()
    await page.evaluate(() => {
      ;(window as unknown as { __releaseMockTimers?: () => void }).__releaseMockTimers?.()
    })
    await expect(dlgExp.getByText(/Corte exportado com sucesso/i)).toBeVisible({ timeout: 10000 })
    await dlgExp.getByRole('button', { name: /Fechar/i }).first().click()
    await expect(dlgExp).toBeHidden()

    // ?estado=fallback exibe aviso de fallback para CPU
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/102/editar?run=1&estado=fallback'
    })
    await page.keyboard.press('Control+e')
    const dlgFallback = page.getByRole('dialog', { name: /Exportar Corte/i })
    await expect(dlgFallback).toBeVisible()
    await dlgFallback.getByRole('button', { name: /Iniciar exportação/i }).click()
    await expect(dlgFallback.getByText(/CPU|x264/i)).toBeVisible({ timeout: 10000 })
    await dlgFallback.getByRole('button', { name: /Fechar/i }).first().click()
    await expect(dlgFallback).toBeHidden()

    // 3. Navega para Vídeo transformado (201, ?run=2) e verifica 3 sub-abas + 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
    })
    await expect(navAbas.getByRole('link', { name: 'Editar' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(navAbas.getByRole('link', { name: 'Transformar' })).toBeVisible()
    await expect(navAbas.getByRole('link', { name: 'Empacotar' })).toBeVisible()
    await expect(page.getByText('Preparando prévia rápida…')).toBeHidden({ timeout: 10000 })

    // Aguarda toasts anteriores sumirem naturalmente antes da captura 1440x900
    await expect(page.locator('[aria-label="Notifications"] [role="dialog"]')).toHaveCount(0, {
      timeout: 6000,
    })

    const check1440 = await page.evaluate(() => ({
      alturaOk: document.documentElement.scrollHeight <= window.innerHeight,
      larguraOk: document.documentElement.scrollWidth <= window.innerWidth,
      h1Count: document.querySelectorAll('h1').length,
    }))
    expect(check1440).toEqual({ alturaOk: true, larguraOk: true, h1Count: 1 })
    await page.screenshot({ path: 'test-results/corte-editar-1440.png' })

    // Abre popover Enquadrar em 1440x900 para screenshot
    await page.getByRole('button', { name: 'Enquadrar', exact: true }).click()
    await expect(page.getByText('Rosto (9:16)')).toBeVisible()
    await page.waitForTimeout(220)
    await page.screenshot({ path: 'test-results/corte-editar-popover-1440.png' })

    // 4. Enquadrar: selecionar Rosto (9:16) exibe Instalador YuNet JIT, modo Fonte 16:9 e ConfirmDialog em Limpar edições
    await page.getByRole('radio', { name: 'Rosto (9:16)' }).click()
    await expect(page.getByText(/YuNet/i).first()).toBeVisible()
    await page.getByRole('radio', { name: 'Enquadrar na Fonte 16:9' }).click()
    await expect(page.getByTestId('quadro-fonte-16-9')).toBeVisible()
    const cropRet = page.getByTestId('retangulo-crop-ativo')
    await cropRet.focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('radio', { name: 'Prévia 9:16' }).click()

    // Limpar edições manuais abre ConfirmDialog com foco em Cancelar
    const btnLimparEdits = page.getByRole('button', { name: /Limpar todas as edições manuais/i })
    if (await btnLimparEdits.isVisible()) {
      await btnLimparEdits.click()
      const dlgLimpar = page.getByRole('alertdialog')
      await expect(dlgLimpar).toBeVisible()
      await expect(dlgLimpar.getByRole('button', { name: 'Cancelar' })).toBeFocused()
      await dlgLimpar.getByRole('button', { name: 'Cancelar' }).click()
      await expect(dlgLimpar).toBeHidden()
    }
    await page.keyboard.press('Escape')

    // 5. Timeline: +3 faixas (Narração visível em Vídeo transformado), Alt indicador e Ctrl+Z
    const timeline = page.getByRole('region', { name: 'Timeline compacta do Corte' })
    await expect(timeline.getByText('Encaixe em Frase')).toBeVisible()
    await page.keyboard.down('Alt')
    await expect(timeline.getByText('Livre por quadro (Alt)')).toBeVisible()
    await page.keyboard.up('Alt')

    await timeline.getByRole('button', { name: /\+3 faixas/i }).click()
    await expect(timeline.getByText('Narração')).toBeVisible()
    await expect(timeline.getByText('Trilha & SFX')).toBeVisible()

    // Ajusta borda Entrada e desfaz com Ctrl+Z
    await timeline.getByRole('button', { name: 'Recuar Entrada 1 Frase' }).click()
    await page.keyboard.press('Control+z')

    // 6. Transcrição (F2 edita palavra mantendo foco) e Índice do Corte (100% teclado)
    const painelEsq = page.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })
    const primeiraPalavra = painelEsq.locator('button[data-word]').first()
    const textoOriginal = (await primeiraPalavra.innerText()).trim()
    await primeiraPalavra.focus()
    await page.keyboard.press('F2')
    const inputCorrecao = painelEsq.getByRole('textbox', { name: 'Corrigir palavra' })
    await expect(inputCorrecao).toBeFocused()
    await inputCorrecao.fill(`${textoOriginal}X`)
    await page.keyboard.press('Enter')
    await expect(painelEsq.locator('button[data-word]').first()).toContainText(`${textoOriginal}X`)
    await expect(painelEsq.locator('button[data-word]').first()).toBeFocused()

    await painelEsq.getByRole('tab', { name: 'Índice do Corte' }).click()
    const listboxIndice = painelEsq.getByRole('listbox', { name: 'Índice do Corte' })
    await listboxIndice.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await painelEsq.getByRole('tab', { name: 'Transcrição' }).click()

    // 7. Popovers Legenda, Silêncios, Áudio (cc_by obrigatório) e Histórico (somente leitura)
    await page.getByRole('button', { name: 'Legenda', exact: true }).click()
    await expect(page.getByText(/salvos automaticamente/i)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Silêncios', exact: true }).click()
    await expect(page.getByText(/120 ms/)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Áudio', exact: true }).click()
    await page.getByRole('button', { name: 'Importar áudio (até 500 MiB)' }).click()
    await page.getByRole('textbox', { name: /Arquivo de áudio/i }).fill('/audio/trilha.mp3')
    await page.getByRole('combobox', { name: /Origem \/ Licença/i }).click()
    await page.getByRole('option', { name: /CC-BY/i }).click()
    await page.getByRole('button', { name: 'Confirmar importação' }).click()
    await expect(page.getByText(/atribuição/i).first()).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Histórico', exact: true }).click()
    await expect(page.getByText(/Fora do Desfazer do Corte/i)).toBeVisible()
    await page.keyboard.press('Escape')

    // 8. Próximo aprovado > navega 201 -> 202
    await page.getByRole('button', { name: /Próximo aprovado/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/corte\/202\/editar\?run=2/)

    // 9. ?estado=erro-flush ao sair abre ConfirmDialog de 3 ações
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/editar?run=2&estado=erro-flush'
    })
    await page.getByRole('link', { name: 'Empacotar' }).click()
    const dlgSaida = page.getByRole('alertdialog')
    await expect(dlgSaida).toBeVisible()
    await expect(dlgSaida.getByRole('button', { name: 'Tentar salvar novamente' })).toBeVisible()
    await expect(dlgSaida.getByRole('button', { name: 'Continuar editando' })).toBeVisible()
    await expect(
      dlgSaida.getByRole('button', { name: 'Sair descartando alterações não salvas' }),
    ).toBeVisible()
    await dlgSaida.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dlgSaida).toBeHidden()

    // ?estado=offline mantém Transcrição e bordas navegáveis com vídeo/export bloqueados
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/editar?run=2&estado=offline'
    })
    await expect(
      page.getByText(/O arquivo original da Fonte foi movido ou alterado/i),
    ).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)
    await expect(timeline.getByRole('button', { name: 'Recuar Entrada 1 Frase' })).toBeEnabled()

    // F6 cicla regiões sem pageerror
    await page.keyboard.press('F6')
    await page.keyboard.press('F6')

    expect(erros).toEqual([])
  })
})
