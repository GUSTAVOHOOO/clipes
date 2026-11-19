import { expect, test } from '@playwright/test'

test.describe('Tela Bancada de Revisão de Cortes (#/projeto/:id/cortes/revisao/:runId)', () => {
  test('cobre todos os 9 critérios da Tela C.2 em 1366x768 e 1440x900 sem pageerror nem scroll externo', async ({
    page,
  }) => {
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

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    // Abre C.1 e navega para C.2 pelo botão "Abrir bancada de revisão"
    await page.getByRole('link', { name: 'Cortes' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)
    await page.getByRole('button', { name: /Abrir bancada de revisão/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes\/revisao\/1(\?.*)?$/)

    await expect(page.getByRole('heading', { level: 1, name: /Execução #1/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeVisible()

    // Regra da Luz Única: exatamente 1 botão primário (bg-sinal) e eixos recolhidos por padrão
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Aprovar' })).toHaveClass(/bg-sinal/)
    const toggleEixos = page.getByRole('button', { name: /Ver os 5 eixos/i })
    await expect(toggleEixos).toHaveAttribute('aria-expanded', 'false')

    // Zero scroll externo em 1366x768 + layout (subheader 1 linha, Aprovar acima da dobra, Transporte e Slider sem esmagar)
    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })

    const layout1366 = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Controles da revisão"]')!
      const navRect = nav.getBoundingClientRect()
      const selectRev = nav.querySelector('[role="combobox"]')
      const statusCont = nav.querySelector('[role="status"]')
      const selectRevNaoSobrepoe =
        selectRev && statusCont
          ? selectRev.getBoundingClientRect().right <= statusCont.getBoundingClientRect().left + 1
          : true
      const toolbar = document.querySelector('[role="toolbar"][aria-label="Controles de reprodução"]')!
      const toolbarRect = toolbar.getBoundingClientRect()
      const timecode = toolbar.querySelector('[aria-label^="Posição "]')!
      const timecodeRect = timecode.getBoundingClientRect()
      const sliderThumb = document.querySelector('[aria-label="Nota mínima"]')!
      const track = sliderThumb.parentElement!.parentElement!
      const trackRect = track.getBoundingClientRect()
      const btnAprovar = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Aprovar'),
      )!
      const btnAprovarRect = btnAprovar.getBoundingClientRect()
      const imagensQuebradas = Array.from(document.querySelectorAll('img')).filter(
        (img) => img.complete && img.naturalWidth === 0,
      ).length
      const spansFocaveis = document.querySelectorAll('span[tabindex="0"]').length
      return {
        navHeight: Math.round(navRect.height),
        navOverflowX: nav.scrollWidth > nav.clientWidth + 1,
        navRightWithinViewport: navRect.right <= window.innerWidth,
        selectRevNaoSobrepoe,
        toolbarOverflowX: toolbar.scrollWidth > toolbar.clientWidth + 1,
        toolbarHeight: Math.round(toolbarRect.height),
        timecodeHeight: Math.round(timecodeRect.height),
        sliderTrackWidth: Math.round(trackRect.width),
        aprovarBottom: Math.round(btnAprovarRect.bottom),
        imagensQuebradas,
        spansFocaveis,
      }
    })
    expect(layout1366.navHeight).toBeLessThanOrEqual(48)
    expect(layout1366.navOverflowX).toBe(false)
    expect(layout1366.navRightWithinViewport).toBe(true)
    expect(layout1366.selectRevNaoSobrepoe).toBe(true)
    expect(layout1366.toolbarOverflowX).toBe(false)
    expect(layout1366.toolbarHeight).toBeLessThanOrEqual(40)
    expect(layout1366.timecodeHeight).toBeLessThanOrEqual(24)
    expect(layout1366.sliderTrackWidth).toBeGreaterThanOrEqual(80)
    expect(layout1366.aprovarBottom).toBeLessThanOrEqual(768)
    expect(layout1366.imagensQuebradas).toBe(0)
    expect(layout1366.spansFocaveis).toBe(0)

    // UI-54: nome da Fonte no sub-cabeçalho não trunca em 1366x768
    const fonteTruncada = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Controles da revisão"]')!
      const fonteEl = Array.from(nav.querySelectorAll('span')).find((s) =>
        s.textContent?.includes('Live_12_11_final.mp4'),
      )!
      return fonteEl.scrollWidth > fonteEl.clientWidth + 1
    })
    expect(fonteTruncada).toBe(false)

    // UI-50: Slider "Nota mínima" e Select "Ordenar candidatos" exibem outline-solid ao focar por teclado
    const sliderFoco = page.getByRole('slider', { name: /Nota mínima/i })
    const selectOrdemFoco = page.getByRole('combobox', { name: /Ordenar candidatos/i })
    await sliderFoco.focus()
    await page.keyboard.press('Tab')
    await expect(selectOrdemFoco).toBeFocused()
    const outlineOrdem = await selectOrdemFoco.evaluate((el) => {
      const st = getComputedStyle(el)
      return { style: st.outlineStyle, width: st.outlineWidth }
    })
    expect(outlineOrdem).toEqual({ style: 'solid', width: '2px' })

    await page.keyboard.press('Shift+Tab')
    await expect(sliderFoco).toBeFocused()
    const outlineSlider = await sliderFoco.evaluate((el) => {
      const st = getComputedStyle(el.parentElement!)
      return { style: st.outlineStyle, width: st.outlineWidth }
    })
    expect(outlineSlider).toEqual({ style: 'solid', width: '2px' })

    await page.screenshot({ path: 'test-results/cortes-revisao-1366.png' })

    // Critério 1: Tab foca role="listbox" (sem tabIndex=-1), ↓/↑ movem seleção, aria-activedescendant e ?corte=
    const selectOrdem = page.getByRole('combobox', { name: /Ordenar candidatos/i })
    await selectOrdem.focus()
    await page.keyboard.press('Tab')
    const listbox = page.getByRole('listbox', { name: /Candidatos a Corte/i })
    await expect(listbox).toBeFocused()
    await expect(listbox).toHaveAttribute('tabindex', '0')
    const adAntes = await listbox.getAttribute('aria-activedescendant')
    expect(adAntes).toBeTruthy()

    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveURL(/corte=102/)
    await expect(page.getByRole('heading', { level: 2, name: 'Sem título' })).toBeVisible()
    const adDepois = await listbox.getAttribute('aria-activedescendant')
    expect(adDepois).toBeTruthy()
    expect(adDepois).not.toBe(adAntes)

    await page.keyboard.press('ArrowUp')
    await expect(page).toHaveURL(/corte=101/)
    await expect(page.getByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeVisible()

    // Critério 2: Filtrar por Aprovados / Nota mínima 8,5 / "Limpar filtros"
    const grupoFiltro = page.getByRole('radiogroup', { name: /Filtrar por estado/i })
    await grupoFiltro.getByRole('radio', { name: /Aprov\./i }).click()
    await expect(listbox.getByRole('option')).toHaveCount(1)

    const sliderNota = page.getByRole('slider', { name: /Nota mínima/i })
    await sliderNota.focus()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(sliderNota).toHaveAttribute('aria-valuetext', 'Nota mínima 8,5 de 10')
    await expect(page.getByText('Nenhum candidato corresponde aos filtros atuais')).toBeVisible()
    // UI-53: detalhe esvazia quando o filtro zera a lista e mantém exatamente 1 bg-sinal
    await expect(
      page.getByRole('region', { name: /Detalhe do Corte/i }).getByText('Nenhum candidato selecionado'),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'A virada do jogo' })).toHaveCount(0)
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)

    await page.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(listbox.getByRole('option')).toHaveCount(3)

    // Critério 3 e 7: A aprova candidato, carrega ChecklistGuardaCorpos, habilita "Abrir no editor",
    // mantém único primário e permite confirmar ack_direct_notice
    await listbox.focus()
    await page.keyboard.press('a')
    const btnAprovado = page.getByRole('button', { name: 'Aprovado' })
    await expect(btnAprovado).toHaveAttribute('aria-pressed', 'true')
    const btnAbrirEditor = page.getByRole('button', { name: /Abrir no editor/i })
    await expect(btnAbrirEditor).toBeEnabled()
    await expect(btnAbrirEditor).toHaveClass(/bg-sinal/)
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)

    const checkDireto = page.getByRole('checkbox', {
      name: /Sei que Corte direto pode não monetizar por conteúdo reutilizado/i,
    })
    await expect(checkDireto).toBeVisible()
    await checkDireto.click()
    await expect(checkDireto).toBeHidden()

    // Critério 4: I/O ajustam bordas mantendo foco; Ctrl+Z desfaz decisão
    const btnRecuarFim = page.getByRole('button', { name: /Recuar fim 1 Frase/i })
    await btnRecuarFim.focus()
    await page.keyboard.press('o')
    await expect(page.getByText('Última frase 13 do Corte.')).toBeVisible()
    await expect(btnRecuarFim).toBeFocused()

    await page.keyboard.press('i')
    await expect(page.getByText('Primeira frase 9 do Corte.')).toBeVisible()

    // Ctrl+Z desfaz último ajuste (volta início para frase 10)
    await page.keyboard.press('Control+z')
    await expect(page.getByText('Primeira frase 10 do Corte.')).toBeVisible()

    // Critério 8: "Refazer com outro Perfil" abre ConfirmDialog com ResumoCustoPrivacidade e foco em Cancelar
    await page.getByRole('button', { name: /Refazer com outro Perfil/i }).click()
    const dlgRedo = page.getByRole('alertdialog')
    await expect(dlgRedo).toBeVisible()
    await expect(dlgRedo.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await expect(dlgRedo).toContainText(/Perfil/i)
    await dlgRedo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgRedo).toBeHidden()

    // Em ?estado=parcial com janela uncertain, "Refazer com outro Perfil" fica bloqueado
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1?estado=parcial'
    })
    await expect(page.getByText(/Esta execução está parcial \(3\/4 Janelas\)/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Refazer com outro Perfil/i })).toBeDisabled()

    // Volta à revisão limpa e verifica 1440x900 + screenshot + Critério 9 (Enter -> Editor)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(page.getByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeVisible()
    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/cortes-revisao-1440.png' })

    // Garante que o candidato selecionado está aprovado e pressiona Enter para abrir no Editor
    const btnAprovado1440 = page.getByRole('button', { name: /Aprovado|Aprovar/i })
    if ((await btnAprovado1440.getAttribute('aria-pressed')) !== 'true') {
      await page.keyboard.press('a')
      await expect(page.getByRole('button', { name: /Abrir no editor/i })).toBeEnabled()
    }
    await listbox.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/projeto\/demo\/corte\/\d+\/editar\?run=1/)

    expect(erros).toEqual([])
  })

  test('execução Vídeo transformado destaca Espaço para comentário (30%) em 1º e exibe próximo passo de Transformar após aprovar (Critério 6)', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?cenario-transformed=1#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(
      page.getByRole('region', { name: /Detalhe do Corte/i }).getByText('Vídeo transformado'),
    ).toBeVisible()

    const toggleEixos = page.getByRole('button', { name: /Ver os 6 eixos/i })
    await expect(toggleEixos).toHaveAttribute('aria-expanded', 'false')
    await toggleEixos.click()
    await expect(page.getByRole('button', { name: /Ocultar eixos/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    const primeiroTermo = page.getByRole('term').first()
    await expect(primeiroTermo).toContainText('Espaço para comentário (30%)')

    await page.keyboard.press('a')
    await expect(
      page.getByText(/Próximo passo no Editor: escolher Ângulo → aprovar Roteiro → gerar Narração/i),
    ).toBeVisible()

    expect(erros).toEqual([])
  })

  test('UI-32/UI-31: acompanha modo WCAG 2.1.4 nos <Kbd> e não vaza banner de redo de outro run após cancelar em C.1', async ({
    page,
  }) => {
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

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    // Seleciona WCAG 2.1.4 ("Exigir modificador Alt + tecla") e verifica <Kbd> na Bancada
    await page.evaluate(() => {
      window.location.hash = '#/config/aparencia'
    })
    await page.getByRole('radio', { name: /Exigir modificador Alt \+ tecla/i }).click()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(page.getByRole('heading', { level: 1, name: /Execução #1/i })).toBeVisible()
    const kbds = await page.locator('section[aria-label="Detalhe do Corte"] kbd').allInnerTexts()
    expect(kbds).toContain('Alt+A')
    expect(kbds).toContain('Alt+R')
    expect(kbds).toContain('Alt+I')
    expect(kbds).toContain('Alt+O')

    // Restaura modo padrão
    await page.evaluate(() => {
      window.location.hash = '#/config/aparencia'
    })
    await page.getByRole('radio', { name: /Ativos fora de campos de texto/i }).click()

    // Inicia seleção #2 em C.1 e cancela -> vai para Revisão #1 e confirma ausência do banner de redo
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes'
      ;(window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers = true
    })
    await page.getByRole('button', { name: 'Selecionar Cortes', exact: true }).click()
    const dlgConfirm = page.getByRole('alertdialog')
    await expect(dlgConfirm).toBeVisible()
    await dlgConfirm.getByRole('button', { name: 'Confirmar e selecionar Cortes' }).click()
    await expect(dlgConfirm).toBeHidden()
    await page.getByRole('button', { name: 'Cancelar seleção' }).click()
    const dlgCancel = page.getByRole('alertdialog')
    await expect(dlgCancel).toBeVisible()
    await dlgCancel.getByRole('button', { name: 'Cancelar seleção' }).click()
    await expect(dlgCancel).toBeHidden()
    await page.evaluate(() => {
      ;(window as unknown as { __releaseMockTimers?: () => void }).__releaseMockTimers?.()
    })

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(page.getByRole('heading', { level: 1, name: /Execução #1/i })).toBeVisible()
    await expect(
      page.getByText(/Gerando nova revisão da execução em segundo plano/i),
    ).not.toBeVisible()

    expect(erros).toEqual([])
  })
})
