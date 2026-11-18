import { expect, test } from '@playwright/test'

test.describe('Configurações: Aparência/Teclado e Projeto atual', () => {
  test('opera #/config/aparencia e #/config/projeto em 1366x768 e 1440x900 sem overflow nem pageerror', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    // 1) #/config/aparencia em 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/config/aparencia')
    await expect(page.getByRole('heading', { name: 'Aparência e Teclado' })).toBeVisible()

    // Tema Claro e volta para Escuro
    const grupoTema = page.getByRole('radiogroup', { name: 'Tema' })
    await grupoTema.getByRole('radio', { name: 'Claro' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro')
    await grupoTema.getByRole('radio', { name: 'Escuro' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro')

    // Screenshot baseline 1366x768 de Aparência
    await page.screenshot({ path: 'test-results/config-aparencia-1366.png' })

    // Alto Contraste e Escala 115% sem overflow horizontal em 1366x768
    await page.getByRole('switch', { name: /Modo Alto Contraste/i }).click()
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high')

    await page.getByRole('radiogroup', { name: 'Escala da interface' }).getByRole('radio', { name: /115%/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-escala', '115')

    const rolagem115 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem115).toEqual({ altura: true, largura: true })

    // Desligar teclas únicas WCAG 2.1.4 e confirmar que Ctrl+K segue funcionando
    await page
      .getByRole('radiogroup', { name: 'Modo de teclas únicas' })
      .getByRole('radio', { name: /Desligar todos os atalhos/i })
      .click()
    await expect(page.getByText('Desligado (WCAG 2.1.4)').first()).toBeVisible()

    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeHidden()

    // Buscar atalho e detectar conflito no remapeamento
    await page.getByRole('searchbox', { name: 'Buscar atalho' }).fill('Aprovar')
    await page.getByRole('button', { name: 'Remapear Aprovar candidato' }).click()
    await page.keyboard.press('r')
    const alertaConflito = page.getByRole('alert')
    await expect(alertaConflito).toContainText(/Conflito/)
    await expect(alertaConflito).toContainText(/Rejeitar candidato/)
    await page.getByRole('button', { name: 'Escolher outra tecla' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('searchbox', { name: 'Buscar atalho' }).fill('')

    // Restaurar todos via ConfirmDialog (foco inicial em Cancelar)
    await page.getByRole('button', { name: 'Restaurar padrões' }).click()
    const dialogoRestaurar = page.getByRole('alertdialog')
    await expect(dialogoRestaurar).toBeVisible()
    await expect(dialogoRestaurar.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dialogoRestaurar.getByRole('button', { name: 'Restaurar padrões' }).click()
    await expect(dialogoRestaurar).toBeHidden()

    // Voltar escala/contraste para padrão antes da próxima tela
    await expect(page.locator('html')).toHaveAttribute('data-escala', '115')
    await page.getByRole('radiogroup', { name: 'Escala da interface' }).getByRole('radio', { name: /100%/ }).click()
    await page.getByRole('switch', { name: /Modo Alto Contraste/i }).click()

    // 2) #/config/projeto com Projeto aberto (?source-test=1) em 1366x768
    await page.goto('/?source-test=1#/config/projeto')
    await expect(page.getByRole('heading', { name: /Projeto atual/i })).toBeVisible()
    await page.screenshot({ path: 'test-results/config-projeto-1366.png' })

    // Salvar Perfil de canal com 90 s
    const campoMax = page.getByLabel('Duração máxima (s)')
    await campoMax.fill('90')
    await page.getByRole('button', { name: 'Salvar Perfil' }).click()
    await expect(page.getByText('Perfil de canal salvo.')).toBeVisible()

    // Ativar Somente local e verificar selo na Barra Superior
    await page.getByRole('tab', { name: /Privacidade/i }).click()
    await page.getByRole('switch', { name: /Ativar veto Somente local/i }).click()
    await expect(page.locator('header').getByText('Somente local')).toBeVisible()

    // Backups e ConfirmDialog de restauração
    await page.getByRole('tab', { name: 'Backups do Projeto' }).click()
    const btnRestaurar = page.getByRole('button', { name: /Restaurar backup/i }).first()
    await btnRestaurar.click()
    const dialogoBackup = page.getByRole('alertdialog')
    await expect(dialogoBackup).toBeVisible()
    await expect(dialogoBackup.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dialogoBackup.getByRole('button', { name: 'Restaurar backup' }).click()
    await expect(dialogoBackup).toBeHidden()
    await expect(page.getByText('Pré-restauração').first()).toBeVisible()

    // 3) Conferência em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?source-test=1#/config/aparencia')
    await expect(page.getByRole('heading', { name: 'Aparência e Teclado' })).toBeVisible()
    const rolagemAparencia1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemAparencia1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/config-aparencia-1440.png' })

    await page.goto('/?source-test=1#/config/projeto')
    await expect(page.getByRole('heading', { name: /Projeto atual/i })).toBeVisible()
    const rolagemProjeto1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemProjeto1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/config-projeto-1440.png' })

    expect(erros).toEqual([])
  })
})
