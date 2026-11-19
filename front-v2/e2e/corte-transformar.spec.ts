import { expect, test } from '@playwright/test'

test.describe('Tela Transformar do Corte (#/projeto/:id/corte/:corteId/transformar)', () => {
  test('cobre todos os 10 critérios de aceite, 1366x768 e 1440x900, guarda Corte direto, trava ADR-0001, TTS JIT, limpeza e revisão needs_review', async ({
    page,
  }) => {
    test.setTimeout(90_000)
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

    // 1. Abre o Projeto Demo em 1366x768 e valida guarda de Corte direto (102, ?run=1)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/102/transformar?run=1'
    })
    await expect(page).toHaveURL(/#\/projeto\/demo\/corte\/102\/editar\?run=1/)
    const navAbas = page.getByRole('navigation', { name: 'Etapas do Corte' })
    await expect(navAbas.getByRole('link', { name: 'Transformar' })).toHaveCount(0)

    // 2. ?estado=vazio no Vídeo transformado (201): Passo 1 vazio e Passos 2-3 travados
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/transformar?run=2&estado=vazio'
    })
    await expect(page.getByText('Nenhum ângulo sugerido ainda')).toBeVisible()
    const stepper = page.getByRole('navigation', { name: 'Etapas da Transformação' })
    await expect(stepper.getByRole('button', { name: /2\.?\s*Roteiro/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(stepper.getByRole('button', { name: /3\.?\s*Narração/i })).toContainText(
      /Travado/i,
    )

    // 3. Em 201 normal (?run=2), "Sugerir ângulos" pago abre <ResumoCustoPrivacidade> + <ConfirmDialog>
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/transformar?run=2'
    })
    await expect(page.getByText('Nenhum ângulo sugerido ainda')).toBeVisible()
    await page.getByRole('button', { name: 'Sugerir ângulos' }).click()
    const dlgCustoAngulo = page.getByRole('alertdialog')
    await expect(dlgCustoAngulo).toBeVisible()
    await expect(
      dlgCustoAngulo.getByLabel(/Resumo de custo e privacidade/i),
    ).toBeVisible()
    await expect(dlgCustoAngulo.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dlgCustoAngulo.getByRole('button', { name: /Confirmar e sugerir/i }).click()
    await expect(dlgCustoAngulo).toBeHidden()
    await expect(page.getByRole('heading', { name: /Sugestões do Provedor/i })).toBeVisible({
      timeout: 10_000,
    })

    // 4. Escrever ângulo manual desbloqueia Passo 2; gerar Roteiro e trocar ângulo marca blocos Desatualizado
    await page.getByText('Escrever meu próprio ângulo').click()
    await page.getByRole('textbox', { name: /Nome do ângulo/i }).fill('Decisão sob pressão')
    await page
      .getByRole('textbox', { name: /Promessa em uma frase/i })
      .fill('Mostra por que o risco calculado definiu o placar.')
    await page.getByRole('button', { name: 'Usar meu ângulo' }).click()
    await expect(stepper.getByText(/Definido: Decisão sob pressão/i)).toBeVisible()
    await expect(stepper.getByRole('button', { name: /2\.?\s*Roteiro/i })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )

    // Vai ao Passo 2 e gera o Roteiro
    await page.getByRole('button', { name: /Avançar para Roteiro/i }).click()
    await expect(page.getByRole('heading', { name: /2\. Roteiro em blocos/i })).toBeVisible()
    await expect(page.getByText('Revisão humana obrigatória antes da Narração')).toBeVisible()
    await page.getByRole('button', { name: 'Sugerir Roteiro' }).click()
    const dlgCustoRoteiro = page.getByRole('alertdialog')
    await expect(dlgCustoRoteiro).toBeVisible()
    await dlgCustoRoteiro.getByRole('button', { name: /Confirmar e sugerir/i }).click()
    await expect(dlgCustoRoteiro).toBeHidden()
    await expect(page.getByText('Bloco 1', { exact: true })).toBeVisible({ timeout: 10_000 })

    // Volta ao Passo 1 e troca o ângulo por uma sugestão -> confirma angle_change_confirmation
    await stepper.getByRole('button', { name: /1\.?\s*Ângulo/i }).click()
    await page.getByRole('button', { name: 'Escolher este ângulo' }).first().click()
    const dlgTroca = page.getByRole('alertdialog')
    await expect(dlgTroca).toBeVisible()
    await expect(dlgTroca.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dlgTroca.getByRole('button', { name: 'Trocar ângulo' }).click()
    await expect(dlgTroca).toBeHidden()

    // 5 e 6. No Passo 2, blocos aparecem Desatualizado/Pendente; aprova todos, edita 1 e salva (Ctrl+S), depois aprova o último para destravar Passo 3
    await stepper.getByRole('button', { name: /2\.?\s*Roteiro/i }).click()
    await expect(page.getByText('Desatualizado — ângulo mudou').first()).toBeVisible()

    const botoesAprovar = page.getByRole('button', { name: 'Aprovar bloco' })
    const totalBlocos = await botoesAprovar.count()
    expect(totalBlocos).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < totalBlocos; i += 1) {
      await botoesAprovar.nth(i).click()
    }
    await expect(page.getByText('Todos os blocos aprovados — Narração liberada')).toBeVisible()

    // Edita bloco 1 e salva com Ctrl+S -> volta a Pendente e re-trava Passo 3
    const primeiroBloco = page.locator('ol > li[data-bloco-id]').first()
    const campoTexto1 = primeiroBloco.getByRole('textbox', { name: 'Texto da Narração' })
    await campoTexto1.fill('Texto revisado pelo editor antes de narrar.')
    await campoTexto1.press('Control+s')
    await expect(primeiroBloco.getByText('Pendente')).toBeVisible()
    await expect(stepper.getByRole('button', { name: /3\.?\s*Narração/i })).toContainText(
      /Travado/i,
    )

    // Clica em Passo 3 travado para conferir trava ADR-0001 e volta ao bloco pendente
    await stepper.getByRole('button', { name: /3\.?\s*Narração/i }).click()
    await expect(
      page.getByText(/Narração travada: ainda há 1 bloco\(s\) pendente\(s\)/i),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Voltar ao próximo bloco pendente' }).click()

    // Aprova o bloco pendente -> destrava Passo 3 imediatamente
    await primeiroBloco.getByRole('button', { name: 'Aprovar bloco' }).click()
    await expect(page.getByText('Todos os blocos aprovados — Narração liberada')).toBeVisible()
    await expect(page.getByRole('button', { name: /Avançar para Narração/i })).toBeEnabled()

    // 10 (parte 1366x768). Transcrição inicia recolhida, Ctrl+[ abre e fecha; zero scroll externo e único h1
    await expect(
      page.getByRole('complementary', { name: 'Transcrição do Corte recolhida' }),
    ).toBeVisible()
    await page.keyboard.press('Control+[')
    await expect(
      page.getByRole('complementary', { name: 'Transcrição do Corte' }),
    ).toBeVisible()
    await page.keyboard.press('Control+[')
    await expect(
      page.getByRole('complementary', { name: 'Transcrição do Corte recolhida' }),
    ).toBeVisible()

    // Aguarda toasts anteriores sumirem antes da captura 1366x768
    await expect(page.locator('[aria-label="Notifications"] [role="dialog"]')).toHaveCount(0, {
      timeout: 6_000,
    })
    const check1366 = await page.evaluate(() => ({
      alturaOk: document.documentElement.scrollHeight <= window.innerHeight,
      larguraOk: document.documentElement.scrollWidth <= window.innerWidth,
      h1Count: document.querySelectorAll('h1').length,
    }))
    expect(check1366).toEqual({ alturaOk: true, larguraOk: true, h1Count: 1 })
    await page.screenshot({ path: 'test-results/corte-transformar-1366.png' })

    // 7. Passo 3 -> <InstaladorJustInTime recurso="tts" /> com aceite de termo e cancelamento
    await page.getByRole('button', { name: /Avançar para Narração/i }).click()
    await page.getByRole('button', { name: /Gerar voz de todos os blocos \(TTS\)/i }).click()

    const secaoJit = page.getByRole('region', { name: 'Instalação necessária' })
    await expect(secaoJit).toBeVisible()
    await expect(secaoJit.getByText(/pocket-tts/i)).toBeVisible()
    await expect(secaoJit.getByText(/MIT|CC-BY-4\.0/i).first()).toBeVisible()
    const btnBaixar = secaoJit.getByRole('button', { name: 'Baixar e continuar' })
    await expect(btnBaixar).toBeDisabled()

    await secaoJit
      .getByRole('checkbox', { name: /Li e concordo com os termos de uso/i })
      .click()
    await expect(btnBaixar).toBeEnabled()

    // Testa cancelamento do download em andamento
    await page.evaluate(() => {
      ;(window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers = true
    })
    await btnBaixar.click()
    const btnCancelarJit = secaoJit.getByRole('button', { name: 'Cancelar' })
    await expect(btnCancelarJit).toBeVisible()
    await btnCancelarJit.click()
    await page.evaluate(() => {
      ;(window as unknown as { __releaseMockTimers?: () => void }).__releaseMockTimers?.()
    })
    await expect(btnCancelarJit).toBeHidden()
    await expect(secaoJit).toBeVisible()

    // Conclui instalação do pocket-tts + modelo TTS após aceite do termo
    const checkboxTermo = secaoJit.getByRole('checkbox', {
      name: /Li e concordo com os termos de uso/i,
    })
    if (!(await checkboxTermo.isChecked())) {
      await checkboxTermo.click()
    }
    await expect(btnBaixar).toBeEnabled()
    await btnBaixar.click()
    await expect(secaoJit).toBeHidden({ timeout: 10_000 })

    // 8 e 9. Navega para Corte V1 pré-populado (202, ?run=2) em 1440x900 (Transcrição acoplada à esquerda)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/transformar?run=2'
    })

    await expect(
      page.getByRole('complementary', { name: 'Transcrição do Corte' }),
    ).toBeVisible()

    // Bloco 1 (2021, recorded): alterna limpeza para Depois (limpa) -> narration.cleanup.prepare + src narration-clean/
    const cardBloco1 = page.getByRole('article', { name: /Bloco 1: Abertura/i })
    await expect(cardBloco1).toBeVisible()
    await cardBloco1.getByRole('radio', { name: 'Depois (limpa)' }).click()
    await expect(cardBloco1.locator('audio')).toHaveAttribute('src', /narration-clean\/2021/)

    // Bloco 2 (2022): importa arquivo com "improviso" para gerar needs_review -> resolve com "Usar texto falado"
    const cardBloco2 = page.getByRole('article', { name: /Bloco 2: Virada/i })
    await cardBloco2.getByRole('button', { name: 'Importar áudio' }).click()
    const dlgImportar = page.getByRole('dialog', { name: /Importar áudio/i })
    await expect(dlgImportar).toBeVisible()
    await dlgImportar
      .getByRole('textbox', { name: /Arquivo de áudio/i })
      .fill('/audio/virada-improviso.wav')
    await dlgImportar.getByRole('button', { name: 'Importar' }).click()

    const dlgSobrescrever = page.getByRole('alertdialog')
    await expect(dlgSobrescrever).toBeVisible()
    await dlgSobrescrever.getByRole('button', { name: 'Substituir áudio' }).click()
    await expect(dlgSobrescrever).toBeHidden()

    await expect(cardBloco2.getByText('Revisão necessária')).toBeVisible({ timeout: 10_000 })
    await expect(cardBloco2.getByText('Roteiro aprovado')).toBeVisible()
    await expect(cardBloco2.getByText('Detectado na fala')).toBeVisible()
    await cardBloco2.getByRole('button', { name: 'Usar texto falado' }).click()
    await expect(cardBloco2.getByText('Revisado')).toBeVisible()

    // Aguarda toasts sumirem antes do screenshot 1440x900 e valida zero scroll externo
    await expect(page.locator('[aria-label="Notifications"] [role="dialog"]')).toHaveCount(0, {
      timeout: 6_000,
    })
    const check1440 = await page.evaluate(() => ({
      alturaOk: document.documentElement.scrollHeight <= window.innerHeight,
      larguraOk: document.documentElement.scrollWidth <= window.innerWidth,
      h1Count: document.querySelectorAll('h1').length,
    }))
    expect(check1440).toEqual({ alturaOk: true, larguraOk: true, h1Count: 1 })
    await page.screenshot({ path: 'test-results/corte-transformar-1440.png' })

    expect(erros).toEqual([])
  })
})
