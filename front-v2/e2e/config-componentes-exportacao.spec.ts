import { expect, test } from '@playwright/test'

test.describe('Configurações: Componentes e Exportação', () => {
  test('opera sub-abas de #/config/componentes, VAD #279, progresso isolado e pastas em 1366x768 e 1440x900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/config/componentes')

    await expect(
      page.getByRole('heading', { name: 'Componentes e Armazenamento' }),
    ).toBeVisible()

    // Sem scroll na moldura externa em 1366x768
    const rolagemComp1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemComp1366).toEqual({ altura: true, largura: true })

    // Sub-aba 1: Aviso VAD #279 visível fora de <details>
    await expect(
      page.getByText(
        /No modo automático, fica ligado na CPU e desligado na GPU: na CPU acelera ~18%; na GPU usa ~1 GB a mais de VRAM sem ganho medido\./i,
      ),
    ).toBeVisible()

    await page.screenshot({ path: 'test-results/config-componentes-1366.png' })

    // Sub-aba 2: Componentes e Modelos + ConfirmDialog + progresso isolado de deno
    await page.getByRole('tab', { name: 'Componentes e Modelos' }).click()
    const cardYunet = page.getByRole('region', { name: /YuNet/i })
    await expect(cardYunet).toBeVisible()
    await cardYunet.getByRole('button', { name: /^Baixar$/i }).click()

    const dialogoModelo = page.getByRole('alertdialog')
    await expect(dialogoModelo).toBeVisible()
    await expect(dialogoModelo).toContainText(/MIT/i)
    await expect(dialogoModelo.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await dialogoModelo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogoModelo).toBeHidden()

    // Baixar deno via ConfirmDialog -> progresso isolado apenas no card do deno
    const cardDeno = page.getByRole('region', { name: /^deno$/i })
    await cardDeno.getByRole('button', { name: /Baixar deno/i }).click()
    const dialogoDeno = page.getByRole('alertdialog')
    await dialogoDeno.getByRole('button', { name: /Baixar agora/i }).click()
    await expect(cardDeno.getByText(/Instalado/i)).toBeVisible()

    // Sub-aba 3: Vozes TTS com termo de uso proibido
    await page.getByRole('tab', { name: /Vozes TTS/i }).click()
    await expect(
      page.getByText(/sem imitação ou clonagem de voz sem consentimento explícito/i),
    ).toBeVisible()

    // Sub-aba 4: Pastas e Armazenamento — aviso obrigatório e erro humano em caminho relativo
    await page.getByRole('tab', { name: 'Pastas e Armazenamento' }).click()
    await expect(
      page.getByText(
        /Alterar a pasta de componentes vale apenas para downloads futuros\. Arquivos já baixados não são movidos automaticamente/i,
      ),
    ).toBeVisible()

    const inputDataDir = page.getByLabel(/Pasta de componentes e modelos \(data_dir\)/i)
    await inputDataDir.fill('pasta-relativa')
    await page.getByRole('button', { name: 'Salvar pastas e limite' }).click()

    const alertaErro = page.getByRole('alert')
    await expect(alertaErro).toBeVisible()
    await expect(alertaErro).toContainText(
      /Informe pastas com caminho completo \(absoluto\) e limite de cache maior que zero\./i,
    )

    // Conferência em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('tab', { name: 'Componentes e Modelos' }).click()
    await expect(
      page.getByRole('heading', { name: 'Componentes e Armazenamento' }),
    ).toBeVisible()
    const rolagemComp1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemComp1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/config-componentes-1440.png' })

    expect(erros).toEqual([])
  })

  test('opera #/config/exportacao em 1366x768 e 1440x900 (erro ffmpeg:false, stale, detect e set)', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    // 1) ?estado=erro -> ffmpeg: false -> botão Ir para Componentes
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/config/exportacao?estado=erro')
    await expect(page.getByRole('alert')).toContainText(/FFmpeg não está instalado/i)
    await page.getByRole('button', { name: 'Ir para Componentes' }).click()
    await expect(page).toHaveURL(/#\/config\/componentes$/)

    // 2) ?estado=parcial -> stale: true mantendo encoders visíveis
    await page.goto('/#/config/exportacao?estado=parcial')
    await expect(
      page.getByText(/O FFmpeg ou o driver de vídeo mudou desde o último teste/i),
    ).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: /Escolha de encoder/i })).toBeVisible()

    // 3) Fluxo padrão: detect e set em 1366x768
    await page.goto('/#/config/exportacao')
    await expect(page.getByRole('heading', { name: 'Exportação e Encoder' })).toBeVisible()
    await page.getByRole('button', { name: 'Detectar encoders agora' }).click()

    const radioCpu = page.getByRole('radio', { name: /Processador \/ CPU \(x264\)/i })
    await expect(radioCpu).toBeVisible()
    await radioCpu.click()
    await expect(radioCpu).toHaveAttribute('aria-checked', 'true')

    const radioAuto = page.getByRole('radio', { name: /Automático/i })
    await radioAuto.click()
    await expect(radioAuto).toHaveAttribute('aria-checked', 'true')

    const rolagemExp1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemExp1366).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/config-exportacao-1366.png' })

    // 4) Conferência em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole('heading', { name: 'Exportação e Encoder' })).toBeVisible()
    const rolagemExp1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagemExp1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/config-exportacao-1440.png' })

    expect(erros).toEqual([])
  })
})
