import { expect, test, type Page } from '@playwright/test'

async function verificarSemRolagemExterna(page: Page) {
  const rolagem = await page.evaluate(() => ({
    altura: document.documentElement.scrollHeight <= window.innerHeight,
    largura: document.documentElement.scrollWidth <= window.innerWidth,
  }))
  expect(rolagem).toEqual({ altura: true, largura: true })
}

test.describe('Tela Relatos e Diagnóstico (#/relatos)', () => {
  test('cobre ADR-0006 em 2 passos, tipos, detector de segredos, sonda de hardware, exportação editada, URL > 8 KB e 1366/1440', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/relatos')

    // 1. Tipo padrão é "Relatar problema", checkbox marcado
    await expect(page.getByRole('heading', { level: 1, name: 'Relatos e diagnóstico' })).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)

    const radioBug = page.getByRole('radio', { name: 'Relatar problema' })
    const radioIdeia = page.getByRole('radio', { name: 'Sugerir ideia' })
    const radioProvedor = page.getByRole('radio', { name: 'Propor Provedor ou modelo' })
    const checkDiag = page.getByRole('checkbox', { name: /Incluir diagnóstico técnico local/i })

    await expect(radioBug).toHaveAttribute('aria-checked', 'true')
    await expect(checkDiag).toBeChecked()

    // 3. Botões de saída não existem no DOM antes de revisar
    await expect(page.getByRole('button', { name: /Copiar texto/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Exportar diagnóstico/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Abrir no GitHub/i })).toHaveCount(0)

    // 2. Alternar para Ideia ou Provedor desmarca automaticamente
    await radioIdeia.click()
    await expect(checkDiag).not.toBeChecked()
    await radioProvedor.click()
    await expect(checkDiag).not.toBeChecked()
    await radioBug.click()
    await expect(checkDiag).toBeChecked()

    // 6. Sonda de hardware (Transcrição) exibe campos sem caminhos pessoais
    const summarySonda = page.getByText('Diagnóstico da sonda de hardware (Transcrição)')
    await summarySonda.click()
    await expect(page.getByText(/NVIDIA GeForce RTX 3050 Laptop GPU/i)).toBeVisible()
    await expect(page.getByText(/Placa de vídeo · precisão equilibrada/i)).toBeVisible()
    await expect(page.locator('details')).not.toContainText('int8_float16')
    await expect(page.getByText(/3962 MiB/i)).toBeVisible()

    // 4. Digitar "minha chave da openai" exibe role="alert" mantendo o foco no textarea
    await page.getByRole('textbox', { name: /Título/i }).fill('Falha na legenda')
    const campoDesc = page.getByRole('textbox', { name: /Descrição/i })
    await campoDesc.click()
    await campoDesc.fill('minha chave da openai')
    await expect(campoDesc).toBeFocused()
    await expect(page.getByRole('alert')).toContainText(/chave|token|segredo/i)
    await expect(campoDesc).toBeFocused()

    // Remove o segredo falso antes de seguir e tira screenshot Passo 1 (1366x768)
    await campoDesc.fill('Erro ao renderizar legenda em Corte aprovado.')
    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/relatos-passo1-1366.png' })

    // Passo 1 em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/relatos-passo1-1440.png' })
    await page.setViewportSize({ width: 1366, height: 768 })

    // Passo 2: Revisar relato antes de enviar
    await page.getByRole('button', { name: /Revisar relato antes de enviar/i }).click()
    await expect(page.getByRole('heading', { level: 2, name: /Revisar e editar relato antes de enviar/i })).toBeVisible()
    await expect(page.locator('button.bg-sinal')).toHaveCount(1)
    await expect(page.getByText(/quando há registros locais.*Etapa da falha: componente/i)).toBeVisible()

    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/relatos-passo2-1366.png' })

    // 1440x900 Passo 2 mostra painel auxiliar à direita
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole('complementary', { name: /Sonda de hardware e allowlist/i })).toBeVisible()
    await verificarSemRolagemExterna(page)
    await page.screenshot({ path: 'test-results/relatos-passo2-1440.png' })
    await page.setViewportSize({ width: 1366, height: 768 })

    // 5. Editar linha no diagnóstico e exportar .txt usando exatamente o texto editado
    const diagEditavel = page.getByRole('textbox', { name: /Diagnóstico técnico editável/i })
    await diagEditavel.fill('Etapa da falha: exportacao\nLinha editada no E2E')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Exportar diagnóstico/i }).click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    expect(stream).toBeTruthy()
    const decoder = new TextDecoder()
    let conteudoExportado = ''
    for await (const chunk of stream!) {
      conteudoExportado +=
        typeof chunk === 'string' ? chunk : decoder.decode(chunk as Uint8Array, { stream: true })
    }
    conteudoExportado += decoder.decode()
    expect(conteudoExportado).toBe('Etapa da falha: exportacao\nLinha editada no E2E')

    // 7. URL > 8.000 bytes copia diagnóstico e anuncia em role="status"
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => undefined },
        configurable: true,
      })
      window.open = () => null
    })
    await diagEditavel.fill('linha-grande-'.repeat(700))
    await page.getByRole('button', { name: /Abrir no GitHub/i }).click()
    await expect(page.getByRole('status').filter({ hasText: /8\.000 bytes|Diagnóstico copiado/i })).toBeVisible()

    // Sonda vazia (?estado=vazio)
    await page.goto('/?estado=vazio#/relatos')
    await page.getByText('Diagnóstico da sonda de hardware (Transcrição)').click()
    await expect(page.getByText('Nenhuma sonda de hardware gravada ainda.')).toBeVisible()

    expect(erros).toEqual([])
  })
})
