import { expect, test } from '@playwright/test'

test.describe('Configurações: Provedores e Custos', () => {
  test('redireciona #/config/projeto sem Projeto e opera #/config/provedores em 1366x768', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/config/projeto')

    await expect(page).toHaveURL(/#\/config\/provedores$/)
    await expect(
      page.getByText('Abra um Projeto para editar estas configurações.').first(),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Provedores e Tarefas de IA' })).toBeVisible()

    // Sem scroll na moldura externa
    const rolagem = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem).toEqual({ altura: true, largura: true })

    // Botão Remover desabilitado em legacy e timeouts globais desabilitados (pendência #305 em comentário)
    const cartaoLegacy = page.getByRole('region', { name: 'Perfil Principal' })
    await expect(cartaoLegacy).toBeVisible()
    await expect(cartaoLegacy.getByRole('button', { name: 'Remover' })).toBeDisabled()
    await expect(cartaoLegacy).toContainText(/disponível em breve/i)
    await expect(cartaoLegacy).not.toContainText('#305')

    const blocoTimeouts = page.getByRole('region', { name: 'Timeouts globais de provider.json' })
    await expect(blocoTimeouts.getByLabel('Timeout global remoto (s)')).toBeDisabled()
    await expect(blocoTimeouts.getByLabel('Timeout global local (s)')).toBeDisabled()

    // Criar novo Perfil de Provedor
    await page.getByRole('button', { name: 'Novo Perfil' }).click()
    const dialogoForm = page.getByRole('dialog', { name: 'Novo Perfil de Provedor' })
    await expect(dialogoForm).toBeVisible()
    await dialogoForm.getByLabel('Nome do Perfil', { exact: true }).fill('OpenAI Teste')
    await dialogoForm.getByLabel('Endpoint', { exact: true }).fill('https://api.openai.com/v1')
    await dialogoForm.getByLabel('Modelo', { exact: true }).fill('gpt-4o-mini')
    await dialogoForm.getByLabel(/Chave de API no cofre/).fill('sk-teste-4321')
    await dialogoForm.getByRole('checkbox', { name: /Concordo em enviar apenas texto/i }).check()
    await dialogoForm.getByRole('button', { name: 'Salvar Perfil' }).click()
    await expect(dialogoForm).toBeHidden()

    const cartaoNovo = page.getByRole('region', { name: 'Perfil OpenAI Teste' })
    await expect(cartaoNovo).toBeVisible()
    await expect(cartaoNovo).toContainText('••••4321')

    // Atribuir na Seleção de Cortes e ligar Somente local -> bloqueio explícito
    await page.getByRole('combobox', { name: 'Perfil para Seleção de Cortes' }).click()
    await page.getByRole('option', { name: /OpenAI Teste/ }).click()
    await page.getByRole('switch', { name: /Somente local \(Seleção de Cortes\)/i }).click()
    await expect(page.getByText('Bloqueado pelo modo Somente local')).toBeVisible()

    await page.screenshot({ path: 'test-results/config-provedores-1366.png' })

    // Remover perfil via ConfirmDialog (foco inicial em Cancelar)
    await cartaoNovo.getByRole('button', { name: 'Remover' }).click()
    const dialogoRemover = page.getByRole('alertdialog')
    await expect(dialogoRemover).toBeVisible()
    await expect(dialogoRemover.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dialogoRemover.getByRole('button', { name: 'Remover perfil' }).click()
    await expect(dialogoRemover).toBeHidden()
    await expect(cartaoNovo).toBeHidden()

    expect(erros).toEqual([])
  })

  test('opera #/config/custos sem Projeto na aba Preços e com Projeto aberto em Orçamentos e Auditoria em 1366x768 e 1440x900', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    // 1) Sem Projeto aberto em #/config/custos
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/config/custos')

    await expect(page.getByRole('heading', { name: 'Custos, Orçamentos e Auditoria' })).toBeVisible()
    await expect(page.getByText('Nenhum Projeto aberto')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ir para Início' })).toBeVisible()

    // Aba Preços e Estimador permanece 100% utilizável sem Projeto
    await page.getByRole('tab', { name: 'Tabela de Preços e Estimador' }).click()
    await page.getByRole('button', { name: 'Simular custo' }).click()
    await expect(page.getByLabel(/Resumo de custo e privacidade/i)).toBeVisible()

    // 2) Com Projeto aberto (?source-test=1)
    await page.goto('/?source-test=1#/config/custos')
    await expect(page.getByText(/Falha cobrada/)).toBeVisible()
    await page.screenshot({ path: 'test-results/config-custos-1366.png' })

    // Retomar orçamento pausado por cost_unknown
    const faixaPausa = page.getByRole('region', { name: 'Orçamento pausado' })
    await expect(faixaPausa).toBeVisible()
    await faixaPausa.getByRole('button', { name: 'Ajustar e continuar fila' }).click()

    const dialogoOrc = page.getByRole('dialog', { name: 'Ajustar orçamento e continuar fila' })
    await expect(dialogoOrc).toBeVisible()
    await expect(dialogoOrc.getByRole('button', { name: 'Confirmar e continuar' })).toBeDisabled()
    await dialogoOrc.getByRole('checkbox', { name: /custo é desconhecido/i }).check()
    await dialogoOrc.getByRole('button', { name: 'Confirmar e continuar' }).click()
    await expect(dialogoOrc).toBeHidden()
    await expect(faixaPausa).toBeHidden()

    // Aba Auditoria sem texto de Transcrição/Roteiro
    await page.getByRole('tab', { name: 'Auditoria' }).click()
    await expect(
      page.getByText(/Nenhum texto de Transcrição, Roteiro ou chave de API é salvo aqui/i),
    ).toBeVisible()
    await expect(page.getByText('api.openai.com').first()).toBeVisible()
    await page.getByRole('button', { name: 'Copiar hash de entrada da chamada 1' }).click()
    await expect(page.getByText('Hash copiado')).toBeVisible()

    // Conferência em 1440x900 sem scroll horizontal
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?source-test=1#/config/custos')
    await expect(page.getByRole('heading', { name: 'Custos, Orçamentos e Auditoria' })).toBeVisible()
    const rolagemCustos1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemCustos1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/config-custos-1440.png' })

    await page.goto('/?source-test=1#/config/provedores')
    await expect(page.getByRole('heading', { name: 'Provedores e Tarefas de IA' })).toBeVisible()
    const rolagemProv1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemProv1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/config-provedores-1440.png' })

    expect(erros).toEqual([])
  })

  test('UI-02 e UI-05: Testar CLI não confirmada exige ConfirmDialog (cancelar não testa) e pular assistente volta para provedores em 1366x768', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/config/provedores')
    await expect(page.getByRole('heading', { name: 'Provedores e Tarefas de IA' })).toBeVisible()

    const blocoCodex = page.getByRole('region', { name: 'Codex CLI' })
    await expect(blocoCodex.getByText('Aguarda confirmação')).toBeVisible()

    // Cancelar não chama provider.test nem confirma CLI
    await blocoCodex.getByRole('button', { name: 'Testar' }).click()
    const dialogoCli = page.getByRole('alertdialog')
    await expect(dialogoCli).toBeVisible()
    await expect(dialogoCli).toContainText(/apenas texto de transcrições/i)
    await expect(dialogoCli).toContainText(/Codex CLI/i)
    await expect(dialogoCli).toContainText(/cota do seu plano/i)
    await expect(dialogoCli.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dialogoCli.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogoCli).toBeHidden()
    await expect(blocoCodex.getByText('Aguarda confirmação')).toBeVisible()
    await expect(page.getByText('Codex CLI validado.')).toBeHidden()

    // Confirmar salva consentimento e executa teste
    await blocoCodex.getByRole('button', { name: 'Testar' }).click()
    await expect(dialogoCli).toBeVisible()
    await dialogoCli.getByRole('button', { name: /Concordo e testar/i }).click()
    await expect(dialogoCli).toBeHidden()
    await expect(blocoCodex.getByText('Confirmado')).toBeVisible()
    await expect(page.getByText('Codex CLI validado.')).toBeVisible()

    // Reabrir assistente e pular retorna para #/config/provedores
    await page.getByRole('button', { name: 'Reabrir assistente inicial' }).click()
    await expect(page).toHaveURL(/#\/assistente\?passo=1&retorno=config$/)
    await page.getByRole('button', { name: /Próximo: Provedor de IA/i }).click()
    await expect(page).toHaveURL(/#\/assistente\?passo=2&retorno=config$/)
    await page.getByRole('button', { name: /Pular por enquanto/i }).click()
    await expect(page).toHaveURL(/#\/config\/provedores$/)

    expect(erros).toEqual([])
  })
})
