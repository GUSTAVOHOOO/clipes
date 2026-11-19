import { expect, test } from '@playwright/test'

test.describe('Shell do front v2', () => {
  test('abre em #/inicio em 1366x768, Paleta com rodapé (UI-14), Barra Superior + teclado F6/Ctrl+J/? (UI-04) e guarda de rota', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/')

    await expect(page).toHaveURL(/#\/inicio$/)
    await expect(page.getByText('Clipes', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()

    // Moldura externa não rola
    const rolagem = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem).toEqual({ altura: true, largura: true })

    await page.screenshot({ path: 'test-results/shell-1366.png' })

    // UI-14: Ctrl+K abre a Paleta com rodapé e Esc devolve o foco ao gatilho anterior
    const botaoComandos = page.getByRole('button', { name: /Abrir comandos/i })
    await botaoComandos.focus()
    await page.keyboard.press('Control+k')
    const paleta = page.getByRole('dialog', { name: 'Paleta de comandos' })
    await expect(paleta).toBeVisible()
    await expect(paleta.getByText('Enter para executar · Esc para fechar')).toBeVisible()
    await page.screenshot({ path: 'test-results/shell-paleta-1366.png' })
    await page.keyboard.press('Escape')
    await expect(paleta).toBeHidden()
    await expect(botaoComandos).toBeFocused()

    // UI-04: Botão Configurações e menu Mais (Relatos, Sobre, Ajuda de atalhos)
    await page.getByRole('button', { name: 'Configurações' }).click()
    await expect(page).toHaveURL(/#\/config\/provedores$/)

    await page.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: /Relatos e diagnóstico/i }).click()
    await expect(page).toHaveURL(/#\/relatos$/)

    await page.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: /Sobre e atualizações/i }).click()
    await expect(page).toHaveURL(/#\/sobre$/)

    await page.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: /Ajuda de atalhos/i }).click()
    const dialogoAtalhos = page.getByRole('dialog', { name: 'Atalhos de teclado' })
    await expect(dialogoAtalhos).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialogoAtalhos).toBeHidden()

    // UI-04: ? abre ajuda de atalhos e Ctrl+J aciona superfície de Fila
    await page.keyboard.press('?')
    await expect(dialogoAtalhos).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialogoAtalhos).toBeHidden()

    await page.keyboard.press('Control+j')
    const painelFila = page.getByRole('complementary', { name: 'Fila de Jobs' })
    await expect(painelFila).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(painelFila).toBeHidden()

    // UI-04: F6 / Shift+F6 ciclam entre Barra Superior -> conteúdo -> Barra de Status com foco visível
    await page.goto('/#/inicio')
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })

    await page.keyboard.press('F6')
    const focoTopo = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      const header = document.querySelector('header')
      const estilo = el ? getComputedStyle(el) : null
      return {
        dentro: Boolean(header && el && header.contains(el)),
        visivel: Boolean(el?.matches(':focus-visible')),
        borda: estilo?.outlineStyle !== 'none' && parseFloat(estilo?.outlineWidth ?? '0') >= 2,
      }
    })
    expect(focoTopo).toEqual({ dentro: true, visivel: true, borda: true })

    await page.keyboard.press('F6')
    const focoConteudo = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      const main = document.querySelector('main')
      return {
        dentro: Boolean(main && el && main.contains(el)),
        visivel: Boolean(el?.matches(':focus-visible')),
      }
    })
    expect(focoConteudo).toEqual({ dentro: true, visivel: true })

    await page.keyboard.press('F6')
    const focoRodape = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      const footer = document.querySelector('footer')
      const estilo = el ? getComputedStyle(el) : null
      return {
        dentro: Boolean(footer && el && footer.contains(el)),
        visivel: Boolean(el?.matches(':focus-visible')),
        borda: estilo?.outlineStyle !== 'none' && parseFloat(estilo?.outlineWidth ?? '0') >= 2,
      }
    })
    expect(focoRodape).toEqual({ dentro: true, visivel: true, borda: true })

    await page.keyboard.press('F6')
    const voltouTopo = await page.evaluate(() => {
      const el = document.activeElement
      const header = document.querySelector('header')
      return Boolean(header && el && header.contains(el))
    })
    expect(voltouTopo).toBe(true)

    await page.keyboard.press('Shift+F6')
    const voltouRodape = await page.evaluate(() => {
      const el = document.activeElement
      const footer = document.querySelector('footer')
      return Boolean(footer && el && footer.contains(el))
    })
    expect(voltouRodape).toBe(true)

    // Rota de Projeto sem Projeto aberto volta para #/inicio
    await page.goto('/#/projeto/x/cortes')
    await expect(page).toHaveURL(/#\/inicio$/)
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()

    // ?estado=erro aciona BannerErroCore com role="alert"
    await page.goto('/#/inicio?estado=erro')
    await expect(page.getByRole('alert')).toBeVisible()

    expect(erros).toEqual([])
  })

  test('UI-01 e UI-04: com Projeto aberto, menu do Projeto executa ações, Somente local é clicável e 1440x900 não rola', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?source-test=1#/projeto/test-project/cortes')

    const seletor = page.getByRole('button', { name: /Teste/i })
    await expect(seletor).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Etapas do Projeto' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Cortes' })).toHaveAttribute('aria-current', 'page')

    // Menu do Projeto -> Configurações do Projeto
    await seletor.click()
    await expect(page.getByRole('menuitem', { name: 'Fechar Projeto' })).toBeVisible()
    await page.screenshot({ path: 'test-results/shell-projeto-menu-1366.png' })
    await page.getByRole('menuitem', { name: 'Configurações do Projeto' }).click()
    await expect(page).toHaveURL(/#\/config\/projeto$/)

    // Habilitar Somente local e verificar selo clicável na Barra Superior
    await page.getByRole('tab', { name: /Privacidade/i }).click()
    await page.getByRole('switch', { name: /Ativar veto Somente local/i }).click()
    const seloLocal = page.getByRole('button', { name: /Somente local/i })
    await expect(seloLocal).toBeVisible()

    // Menu do Projeto -> Trocar Projeto… -> #/inicio, e clicar em Somente local volta para #/config/projeto
    await page.getByRole('button', { name: /Teste/i }).click()
    await page.getByRole('menuitem', { name: 'Trocar Projeto…' }).click()
    await expect(page).toHaveURL(/#\/inicio$/)

    await seloLocal.click()
    await expect(page).toHaveURL(/#\/config\/projeto$/)

    // Menu do Projeto -> selecionar outro Projeto recente
    await page.getByRole('button', { name: /Teste/i }).click()
    await page.getByRole('menuitem', { name: 'Meu Canal de Cortes' }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)
    await expect(page.getByRole('button', { name: /Meu Canal de Cortes/i })).toBeVisible()

    // Conferir 1440x900 sem rolagem
    await page.setViewportSize({ width: 1440, height: 900 })
    const rolagem = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/shell-1440.png' })

    // Menu do Projeto -> Fechar Projeto limpa etapas e navega para #/inicio
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.getByRole('button', { name: /Meu Canal de Cortes/i }).click()
    await page.getByRole('menuitem', { name: 'Fechar Projeto' }).click()
    await expect(page).toHaveURL(/#\/inicio$/)
    await expect(page.getByRole('navigation', { name: 'Etapas do Projeto' })).toBeHidden()

    expect(erros).toEqual([])
  })
})
