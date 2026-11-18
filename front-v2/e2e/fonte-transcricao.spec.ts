import { expect, test } from '@playwright/test'

test.describe('Tela Detalhe da Fonte e Transcrição (#/projeto/:id/fontes/:fonteId)', () => {
  test('guarda de rota, estados §6, Motor Local/Groq, blocos, Leitor F2/Enter, undo entre Fontes e Fonte offline em 1366x768 e 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)

    // 1) Guarda de rota: :fonteId inexistente redireciona com alerta humano
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/999'
    })
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)
    await expect(
      page.getByText(/A Fonte selecionada não foi encontrada neste Projeto\./i),
    ).toBeVisible()

    // 2) Abre Fonte 4 (available, transcrição completa) em 1366x768
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await expect(
      page.getByRole('heading', { level: 1, name: 'Live_12_11_final.mp4' }),
    ).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/fonte-transcricao-1366.png' })

    // 3) ?estado=vazio exibe aviso VAD #279 e CTA do Motor
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4?estado=vazio'
    })
    await expect(page.getByText(/Esta Fonte ainda não foi transcrita\./i)).toBeVisible()
    await expect(
      page.getByText(/ligado na CPU \(acelera em ~18%\) e desligado na GPU \(evita gastar ~1 GB extra de VRAM/i),
    ).toBeVisible()

    // Volta para estado pronto em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await expect(page.getByRole('button', { name: /Silêncio ·/i }).first()).toBeVisible()

    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/fonte-transcricao-1440.png' })

    // 4) Leitor: alvo >= 24x24, F2/Enter salvando correção e busca Ctrl+F
    const leitor = page.getByRole('region', { name: 'Transcrição da Fonte' })
    const primeiraPalavra = leitor.locator('button[data-word]').first()
    const boxPalavra = await primeiraPalavra.boundingBox()
    expect(boxPalavra).not.toBeNull()
    expect(boxPalavra!.width).toBeGreaterThanOrEqual(24)
    expect(boxPalavra!.height).toBeGreaterThanOrEqual(24)

    await primeiraPalavra.focus()
    await page.keyboard.press('F2')
    const inputPalavra = page.getByRole('textbox', { name: 'Corrigir palavra' })
    await expect(inputPalavra).toBeFocused()
    await inputPalavra.fill('CorrigidaE2E')
    await inputPalavra.press('Enter')

    const palavraCorrigida = leitor.getByRole('button', { name: 'CorrigidaE2E' })
    await expect(palavraCorrigida).toBeVisible()
    await expect(palavraCorrigida).toBeFocused()
    await expect(palavraCorrigida).toHaveAttribute('aria-description', 'Palavra corrigida')

    await page.keyboard.press('Control+f')
    const buscaLeitor = page.getByRole('searchbox', { name: 'Buscar na Transcrição' })
    await expect(buscaLeitor).toBeFocused()
    await buscaLeitor.fill('CorrigidaE2E')
    await buscaLeitor.press('Enter')
    const resultados = page.getByRole('region', { name: /Resultados da busca na Transcrição/i })
    await expect(resultados.locator('mark')).toHaveText('CorrigidaE2E')

    // Energia pode ser medida quando pronta e disponível
    await page.getByRole('button', { name: 'Medir energia agora' }).click()
    await expect(page.getByText(/Medida · 2 picos e 4 trechos altos/i)).toBeVisible()

    // 5) Fonte offline (id 2): player bloqueado, Leitor 100% editável e Ctrl+Z entre Fontes
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/2'
    })
    await expect(
      page.getByRole('heading', { level: 1, name: 'offline.mp4' }),
    ).toBeVisible()
    await expect(page.getByText(/Vídeo indisponível no disco/i)).toBeVisible()

    const leitorOffline = page.getByRole('region', { name: 'Transcrição da Fonte' })
    const palavraOffline = leitorOffline.locator('button[data-word]').first()
    await palavraOffline.focus()
    await page.keyboard.press('F2')
    const inputOffline = page.getByRole('textbox', { name: 'Corrigir palavra' })
    await inputOffline.fill('OfflineEdit')
    await inputOffline.press('Enter')
    await expect(leitorOffline.getByRole('button', { name: 'OfflineEdit' })).toBeVisible()

    // Primeiro Ctrl+Z desfaz na própria Fonte 2; segundo Ctrl+Z desfaz na Fonte 4 com toast
    await page.keyboard.press('Control+z')
    await expect(leitorOffline.getByRole('button', { name: 'OfflineEdit' })).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(page.getByRole('button', { name: 'Ir para Fonte afetada' })).toBeVisible()

    // 6) Volta para Fonte 4: amostra 30 s sem vazar int8_float16, Groq e Somente local
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await expect(
      page.getByRole('heading', { level: 1, name: 'Live_12_11_final.mp4' }),
    ).toBeVisible()

    await page.getByRole('button', { name: /Medir amostra 30 s/i }).click()
    await expect(page.getByText(/ETA estimado:/i)).toBeVisible()

    const motorSection = page.getByRole('region', { name: 'Motor de transcrição' })
    const textoVisivelMotor = await motorSection.evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement
      clone.querySelectorAll('details').forEach((d) => d.remove())
      return clone.textContent ?? ''
    })
    expect(textoVisivelMotor).not.toMatch(/int8_float16|handshake/i)

    // Verifica bloqueio Somente local no Groq via Configurações -> Projeto
    await page.evaluate(() => {
      window.location.hash = '#/config/projeto'
    })
    await page.getByRole('tab', { name: /Privacidade \(Somente local\)/i }).click()
    const switchSomenteLocal = page.getByRole('switch', { name: /Somente local/i })
    await expect(switchSomenteLocal).toBeVisible()
    await switchSomenteLocal.click()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await page.getByRole('radio', { name: /Groq remoto/i }).click()
    await expect(page.getByText(/Indisponível no modo Somente local/i)).toBeVisible()
    await expect(
      page.getByRole('region', { name: /Resumo de custo e privacidade: Transcrição Groq/i }),
    ).toBeVisible()

    // Desliga Somente local para testar fluxo de execução, cancelamento e troca de Motor parcial
    await page.evaluate(() => {
      window.location.hash = '#/config/projeto'
    })
    await page.getByRole('tab', { name: /Privacidade \(Somente local\)/i }).click()
    await page.getByRole('switch', { name: /Somente local/i }).click()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await page.getByRole('button', { name: /Refazer transcrição/i }).click()
    await expect(page.getByText(/Transcrição em andamento/i)).toBeVisible()

    const btnCancelar = page.getByRole('button', {
      name: /Pausar \/ Cancelar mantendo blocos salvos/i,
    })
    await expect(btnCancelar).toBeVisible()
    await btnCancelar.click()

    await expect(page.getByText(/Transcrição parcial salva até/i)).toBeVisible()

    // Troca de Motor para Groq em transcrição parcial exige ConfirmDialog (engine_change_confirmation)
    await page.getByRole('radio', { name: /Groq remoto/i }).click()
    await page.getByRole('link', { name: 'Configurar chave do Groq' }).click()
    await expect(page).toHaveURL(/#\/config\/provedores$/)
    await page.getByLabel('Nova chave da API Groq').fill('gsk_teste_123456')
    await page.getByRole('button', { name: 'Salvar chave' }).click()
    await expect(page.getByText(/Chave Groq salva/i)).toBeVisible()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await page.getByRole('radio', { name: /Groq remoto/i }).click()
    await page
      .getByRole('checkbox', { name: /Autorizo enviar o áudio com fala \(FLAC\)/i })
      .click()

    await motorSection.getByRole('button', { name: /Retomar de/i }).click()
    const dlgTroca = page.getByRole('alertdialog')
    await expect(dlgTroca).toBeVisible()
    await expect(dlgTroca).toContainText(/Trocar Motor e descartar progresso parcial/i)
    await dlgTroca.getByRole('button', { name: /Cancelar/i }).click()
    await expect(dlgTroca).toBeHidden()

    expect(erros).toEqual([])
  })
})
