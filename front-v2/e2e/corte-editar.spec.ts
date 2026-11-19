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

    // UI-69: Transcrição abre rolada na 1ª frase ativa do Corte (não presa em fora do Corte)
    const painelDireto = page.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })
    const scrollTranscricao = await painelDireto
      .getByLabel('Frases do Corte')
      .evaluate((vp) => {
        const primeiraAtiva = vp.querySelector<HTMLElement>(
          'article[aria-label^="Frase "]:not([data-fora="true"])',
        )
        const vpRect = vp.getBoundingClientRect()
        const ativaRect = primeiraAtiva?.getBoundingClientRect()
        return {
          scrollTop: vp.scrollTop,
          ativaVisivel: Boolean(
            ativaRect && ativaRect.bottom > vpRect.top && ativaRect.top < vpRect.bottom,
          ),
        }
      })
    expect(scrollTranscricao.scrollTop).toBeGreaterThan(0)
    expect(scrollTranscricao.ativaVisivel).toBe(true)

    // UI-63: nenhum span[tabindex="0"] envolvendo botão desabilitado
    await expect(page.locator('span[tabindex="0"]')).toHaveCount(0)

    // UI-67: Segmentado "Enquadrar na Fonte 16:9" fica em 1 linha sem colidir com borda em alto contraste
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'))
    const segFonteDim = await page
      .getByRole('radio', { name: 'Enquadrar na Fonte 16:9' })
      .evaluate((el) => {
        const r = el.getBoundingClientRect()
        return {
          altura: Math.round(r.height),
          cortaH: el.scrollWidth > el.clientWidth + 1,
          cortaV: el.scrollHeight > el.clientHeight + 1,
        }
      })
    expect(segFonteDim.altura).toBeLessThanOrEqual(32)
    expect(segFonteDim.cortaH).toBe(false)
    expect(segFonteDim.cortaV).toBe(false)
    await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'))

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

    // 2. Ctrl+E abre diálogo de exportação individual (UI-62 foco inicial != Fechar (Esc))
    await page.keyboard.press('Control+e')
    const dlgExp = page.getByRole('dialog', { name: /Exportar Corte/i })
    await expect(dlgExp).toBeVisible()
    await expect(dlgExp.getByRole('button', { name: 'Fechar (Esc)' })).not.toBeFocused()
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
    // UI-71: o aviso de fallback quebra linha dentro do diálogo em 1366x768 e 1440x900
    for (const vp of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp)
      await page.keyboard.press('Control+e')
      const dlgFallback = page.getByRole('dialog', { name: /Exportar Corte/i })
      await expect(dlgFallback).toBeVisible()
      await dlgFallback.getByRole('button', { name: /Iniciar exportação/i }).click()
      const avisoFallback = dlgFallback.getByText(/A exportação usou a CPU/i)
      await expect(avisoFallback).toBeVisible({ timeout: 10000 })
      const caixaDlg = (await dlgFallback.boundingBox())!
      const caixaAviso = (await avisoFallback.boundingBox())!
      const caixas = {
        dlgRight: caixaDlg.x + caixaDlg.width,
        avisoRight: caixaAviso.x + caixaAviso.width,
      }
      expect(caixas.avisoRight).toBeLessThanOrEqual(caixas.dlgRight)
      await dlgFallback.getByRole('button', { name: /Fechar/i }).first().click()
      await expect(dlgFallback).toBeHidden()
    }

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

    // 4. Enquadrar: selecionar Rosto (9:16) exibe Instalador YuNet JIT (UI-66 1 bg-sinal), UI-62 Esc devolve foco ao gatilho
    await page.getByRole('radio', { name: 'Rosto (9:16)' }).click()
    await expect(page.getByText(/YuNet/i).first()).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Fechar (Esc)' })).not.toBeFocused()
    // Fecha o popover antes de interagir com o Segmentado fora dele (evita race de outside-press do Base UI)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Fechar (Esc)' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Enquadrar', exact: true })).toBeFocused()

    await page.getByRole('radio', { name: 'Enquadrar na Fonte 16:9' }).click()
    await expect(page.getByTestId('quadro-fonte-16-9')).toBeVisible()
    const cropRet = page.getByTestId('retangulo-crop-ativo')
    await cropRet.focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('radio', { name: 'Prévia 9:16' }).click()
    await expect(page.getByTestId('quadro-previa-9-16')).toBeVisible()

    // Reabre Enquadrar e verifica ConfirmDialog em Limpar edições manuais com foco em Cancelar
    await page.getByRole('button', { name: 'Enquadrar', exact: true }).click()
    const btnLimparEdits = page.getByRole('button', { name: /Limpar todas as edições manuais/i })
    await expect(btnLimparEdits).toBeVisible()
    await btnLimparEdits.click()
    const dlgLimpar = page.getByRole('alertdialog')
    await expect(dlgLimpar).toBeVisible()
    await expect(dlgLimpar.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dlgLimpar.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgLimpar).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Fechar (Esc)' })).toBeHidden()

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
    const btnIrBox = await painelEsq.getByRole('button', { name: 'Ir', exact: true }).first().boundingBox()
    expect(btnIrBox).not.toBeNull()
    expect(btnIrBox!.width).toBeGreaterThanOrEqual(24)
    expect(btnIrBox!.height).toBeGreaterThanOrEqual(24)
    await listboxIndice.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await painelEsq.getByRole('tab', { name: 'Transcrição' }).click()

    // 7. Popovers Legenda, Silêncios, Áudio (cc_by obrigatório) e Histórico (somente leitura) em 1366x768 (UI-65 / UI-68)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.getByRole('button', { name: 'Legenda', exact: true }).click()
    await expect(page.getByText(/salvos automaticamente/i)).toBeVisible()
    await expect(page.locator('[data-regiao="popover-editor"]')).not.toHaveText(/\bpreset\b/i)
    const boundsLegenda = await page.evaluate(() => {
      const pop = document.querySelector('[data-regiao="popover-editor"]')?.closest('[role="dialog"]')
      const ctx = document.querySelector('[data-regiao="contexto"]')
      const barra = document.querySelector('[role="toolbar"][aria-label="Ferramentas do Corte"]')
      const nar = Array.from(document.querySelectorAll('[role="radio"]')).find(
        (r) => r.textContent?.trim() === 'Narração',
      )
      return {
        topoOk:
          !pop || !ctx ? false : pop.getBoundingClientRect().top >= ctx.getBoundingClientRect().bottom - 1,
        baseOk:
          !pop || !barra
            ? false
            : pop.getBoundingClientRect().bottom <= barra.getBoundingClientRect().top + 1,
        narCorta: nar ? nar.scrollWidth > nar.clientWidth + 1 : true,
      }
    })
    expect(boundsLegenda).toEqual({ topoOk: true, baseOk: true, narCorta: false })
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Silêncios', exact: true }).click()
    await expect(page.getByText(/120 ms/)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Áudio', exact: true }).click()
    const btnImportarAudio = page.getByRole('button', { name: 'Importar áudio (até 500 MiB)' })
    const cortaImportar = await btnImportarAudio.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    )
    expect(cortaImportar).toBe(false)
    await btnImportarAudio.click()
    await page.getByRole('textbox', { name: /Arquivo de áudio/i }).fill('/audio/trilha.mp3')
    await page.getByRole('combobox', { name: /Origem \/ Licença/i }).click()
    await page.getByRole('option', { name: /CC-BY/i }).click()
    await page.getByRole('button', { name: 'Confirmar importação' }).click()
    await expect(page.getByText(/atribuição/i).first()).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Histórico', exact: true }).click()
    await expect(page.getByText(/Fora do Desfazer do Corte/i)).toBeVisible()
    await page.getByRole('button', { name: 'Salvar agora' }).click()
    await expect(page.locator('[data-regiao="popover-editor"]')).toContainText(/Layout: (Rosto \(9:16\)|Fit \/ Centro)/)
    await expect(
      page.locator('span[tabindex="0"]:not([data-base-ui-focus-guard])'),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 900 })

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

    // UI-61: ?estado=erro-flush + Ctrl+S exibe Falha ao salvar / Tentar novamente >= 24px e limpa após Ctrl+S sem erro
    await page.keyboard.press('Control+s')
    const dlgShellErro = page.getByRole('alertdialog')
    await expect(dlgShellErro).toBeVisible()
    await dlgShellErro.getByRole('button', { name: 'Continuar editando' }).click()
    const btnTentarRodape = page.locator('[data-regiao="rodape"]').getByRole('button', { name: 'Tentar novamente' })
    const boxTentar = await btnTentarRodape.boundingBox()
    expect(boxTentar).not.toBeNull()
    expect(boxTentar!.height).toBeGreaterThanOrEqual(24)

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/editar?run=2'
    })
    await page.keyboard.press('Control+s')
    await expect(page.locator('[data-regiao="rodape"]').getByText('Falha ao salvar')).toBeHidden()

    // ?estado=offline mantém Transcrição e bordas navegáveis com vídeo/export bloqueados
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/editar?run=2&estado=offline'
    })
    await expect(
      page.getByText(/O arquivo original da Fonte foi movido ou alterado/i),
    ).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)
    await expect(timeline.getByRole('button', { name: 'Recuar Entrada 1 Frase' })).toBeEnabled()

    // UI-60: F6 cicla todas as regiões do Editor (com popover aberto) sem Shell bloquear
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
    })
    await expect(page.getByRole('button', { name: 'Enquadrar', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Enquadrar', exact: true }).click()
    await expect(page.getByText('Rosto (9:16)')).toBeVisible()
    await page.locator('[data-regiao="topo"] a, [data-regiao="topo"] button').first().focus()
    const regioesF6: Array<string | null> = []
    const regiaoAtual = () =>
      page.evaluate(
        () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
      )
    for (let i = 0; i < 7; i++) {
      const anterior = await regiaoAtual()
      await page.keyboard.press('F6')
      await expect.poll(regiaoAtual).not.toBe(anterior)
      regioesF6.push(await regiaoAtual())
    }
    // UI-72: contexto é parada própria logo após o topo (ordem do Shell)
    expect(regioesF6).toEqual([
      'contexto',
      'painel-esquerdo',
      'palco',
      'popover-editor',
      'timeline',
      'rodape',
      'topo',
    ])
    await page.keyboard.press('Escape')

    // UI-64: Ctrl+] aparece na Paleta
    await page.keyboard.press('Control+k')
    const inputPaleta = page.locator('[cmdk-input]')
    await expect(inputPaleta).toBeVisible()
    await inputPaleta.fill('popover')
    await expect(page.locator('[cmdk-list]')).toContainText(/Ctrl\+\]|⌘\]/)
    await page.keyboard.press('Escape')

    // UI-66 / UI-68: ?estado=vazio mantém 1 bg-sinal e não duplica "Corte #201 · Corte #201"
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?estado=vazio'
    })
    await expect(page.getByText('Este Corte não está disponível para edição')).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Corte #201.*Corte #201/)

    expect(erros).toEqual([])
  })
})
