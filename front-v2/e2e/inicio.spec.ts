import { expect, test } from '@playwright/test'

test.describe('Tela Início e Projetos (#/inicio)', () => {
  test('estados padrão, carregando, vazio, criação, abertura V1, nome inválido e newer_project em 1366x768', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')

    // Estado padrão: projetos disponíveis e indisponíveis
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()
    await expect(page.getByText('Meu Canal de Cortes')).toBeVisible()
    await expect(page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i })).toBeVisible()
    await expect(page.getByText('Indisponível no disco')).toBeVisible()
    await expect(page.getByRole('button', { name: /Localizar pasta/i })).toBeVisible()

    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/inicio-1366.png' })

    // ?estado=carregando
    await page.goto('/#/inicio?estado=carregando')
    await expect(page.getByRole('status', { name: /Carregando Projetos recentes/i })).toBeVisible()
    await expect(page.getByText('Nenhum Projeto recente ainda')).toHaveCount(0)

    // ?estado=vazio
    await page.goto('/#/inicio?estado=vazio')
    await expect(page.getByText('Nenhum Projeto recente ainda')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Criar primeiro Projeto' })).toBeVisible()
    await page.screenshot({ path: 'test-results/inicio-vazio-1366.png' })

    // Volta ao padrão e testa nome inválido "a/b" sem stack trace
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Novo Projeto/i }).click()
    const dialogoNovo = page.getByRole('dialog', { name: 'Novo Projeto' })
    await expect(dialogoNovo).toBeVisible()
    await expect(dialogoNovo).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'test-results/inicio-novo-1366.png', animations: 'disabled' })

    await dialogoNovo.getByRole('textbox', { name: 'Nome do Projeto' }).fill('a/b')
    await dialogoNovo.getByRole('textbox', { name: 'Pasta onde salvar' }).fill('/tmp/clipes')
    await dialogoNovo.getByRole('button', { name: 'Criar Projeto' }).click()

    await expect(dialogoNovo.getByText(/Escolha um nome válido/i)).toBeVisible()
    await expect(dialogoNovo).not.toContainText('invalid_project')
    await expect(dialogoNovo).not.toContainText('Error:')

    // Cria Projeto válido "Canal Teste" em "/tmp/clipes"
    await dialogoNovo.getByRole('textbox', { name: 'Nome do Projeto' }).fill('Canal Teste')
    await expect(dialogoNovo.getByText('/tmp/clipes/Canal Teste.clipes')).toBeVisible()
    await dialogoNovo.getByRole('button', { name: 'Criar Projeto' }).click()

    await expect(page).toHaveURL(/#\/projeto\/canal-teste\/fontes$/)
    await expect(page.getByRole('navigation', { name: 'Etapas do Projeto' })).toBeVisible()

    // Volta a #/inicio com Projeto ativo e fecha Projeto
    await page.goto('/#/inicio')
    await expect(page.getByRole('region', { name: 'Projeto ativo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continuar no Projeto' })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar Projeto' }).click()
    await expect(page.getByRole('region', { name: 'Projeto ativo' })).toBeHidden()

    // Abre pasta .clipes V1 existente
    await page.getByRole('button', { name: /Abrir pasta \.clipes/i }).click()
    const dialogoAbrir = page.getByRole('dialog', { name: 'Abrir pasta .clipes' })
    await expect(dialogoAbrir).toBeVisible()
    await dialogoAbrir.getByRole('textbox', { name: 'Pasta .clipes' }).fill('C:\\V1\\CanalLegado.clipes')
    await dialogoAbrir.getByRole('button', { name: 'Abrir Projeto' }).click()

    await expect(page).toHaveURL(/#\/projeto\/canallegado\/fontes$/)

    // Simula newer_project ao abrir /tmp/futuro.clipes
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir pasta \.clipes/i }).click()
    await expect(dialogoAbrir).toBeVisible()
    await dialogoAbrir.getByRole('textbox', { name: 'Pasta .clipes' }).fill('/tmp/futuro.clipes')
    await dialogoAbrir.getByRole('button', { name: 'Abrir Projeto' }).click()

    const alerta = page.getByRole('alert')
    await expect(alerta).toBeVisible()
    await expect(alerta).toContainText('Este Projeto foi salvo por uma versão mais nova do Clipes.')
    await expect(alerta.getByRole('button', { name: 'Verificar atualizações' })).toBeVisible()

    expect(erros).toEqual([])
  })

  test('layout e rolagem em 1440x900 sem scroll horizontal e sem pageerror', async ({ page }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#/inicio')

    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()
    await expect(page.getByText('Meu Canal de Cortes')).toBeVisible()

    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/inicio-1440.png' })

    expect(erros).toEqual([])
  })
})
