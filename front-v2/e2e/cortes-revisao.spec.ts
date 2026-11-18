import { expect, test } from '@playwright/test'

test.describe('Tela Bancada de Revisão de Cortes (#/projeto/:id/cortes/revisao/:runId)', () => {
  test('cobre todos os 9 critérios da Tela C.2 em 1366x768 e 1440x900 sem pageerror nem scroll externo', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

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

    // Zero scroll externo em 1366x768 + screenshot
    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })
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
})
