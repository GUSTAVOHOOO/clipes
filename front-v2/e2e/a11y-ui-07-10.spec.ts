import { expect, test } from '@playwright/test'

function parseRgba(str: string): [number, number, number, number] | null {
  const m = str.match(
    /rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i,
  )
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1]
}

function srgbToLin(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function lum(rgb: [number, number, number]): number {
  return 0.2126 * srgbToLin(rgb[0]) + 0.7152 * srgbToLin(rgb[1]) + 0.0722 * srgbToLin(rgb[2])
}

function razaoContraste(a: [number, number, number], b: [number, number, number]): number {
  const l1 = lum(a)
  const l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function extrairCorShadow(boxShadow: string): [number, number, number] | null {
  if (!boxShadow || boxShadow === 'none') return null
  const matches = boxShadow.match(/rgba?\([^)]+\)/gi)
  if (!matches) return null
  for (const m of matches) {
    const rgba = parseRgba(m)
    if (rgba && rgba[3] > 0.9) return [rgba[0], rgba[1], rgba[2]]
  }
  return null
}

test.describe('A11y AA — UI-07 a UI-10 (1366x768)', () => {
  test('UI-07: campos dentro de bg-elevado não se fundem com o fundo', async ({ page }) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/assistente?passo=2')
    await expect(page.getByRole('heading', { name: /Passo 2:/ })).toBeVisible()

    await page.getByRole('radio', { name: /Chave de API/i }).click()

    const modeloApi = page.getByLabel('Modelo da API')
    const selectApi = page.getByRole('combobox', { name: 'Provedor de API' })
    await expect(modeloApi).toBeVisible()
    await expect(selectApi).toBeVisible()
    await expect(modeloApi).toHaveCSS('background-color', 'rgb(15, 16, 18)')
    await expect(selectApi).toHaveCSS('background-color', 'rgb(15, 16, 18)')

    const estilos = await modeloApi.evaluate((el) => {
      const card = el.parentElement?.closest('.bg-elevado') ?? null
      const stEl = getComputedStyle(el)
      const stCard = card ? getComputedStyle(card) : null
      return {
        elBg: stEl.backgroundColor,
        cardBg: stCard?.backgroundColor ?? null,
        boxShadow: stEl.boxShadow,
      }
    })
    expect(estilos.cardBg).not.toBeNull()
    expect(estilos.elBg).not.toBe(estilos.cardBg)
    expect(estilos.boxShadow).not.toBe('none')

    const estilosSelect = await selectApi.evaluate((el) => {
      const card = el.parentElement?.closest('.bg-elevado') ?? null
      const stEl = getComputedStyle(el)
      const stCard = card ? getComputedStyle(card) : null
      return {
        elBg: stEl.backgroundColor,
        cardBg: stCard?.backgroundColor ?? null,
        boxShadow: stEl.boxShadow,
      }
    })
    expect(estilosSelect.elBg).not.toBe(estilosSelect.cardBg)
    expect(estilosSelect.boxShadow).not.toBe('none')

    // Também dentro de Dialogo (Novo Projeto) que usa bg-elevado
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Novo Projeto/i }).click()
    const dlg = page.getByRole('dialog', { name: 'Novo Projeto' })
    await expect(dlg).toBeVisible()
    const inputNome = dlg.getByRole('textbox', { name: 'Nome do Projeto' })
    const estilosDlg = await inputNome.evaluate((el) => {
      const d = el.closest('[role="dialog"]')
      const stEl = getComputedStyle(el)
      const stDlg = d ? getComputedStyle(d) : null
      return {
        elBg: stEl.backgroundColor,
        dlgBg: stDlg?.backgroundColor ?? null,
        boxShadow: stEl.boxShadow,
      }
    })
    expect(estilosDlg.elBg).not.toBe(estilosDlg.dlgBg)
    expect(estilosDlg.boxShadow).not.toBe('none')

    expect(erros).toEqual([])
  })

  test('UI-08: todos os alvos interativos em Passo 1, Passo 2, BannerErroCore e ConfigComponentes >= 24 px', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    await page.setViewportSize({ width: 1366, height: 768 })

    // Assistente Passo 1: Mudar pasta de instalação + summaries
    await page.goto('/#/assistente?passo=1')
    await expect(page.getByRole('heading', { name: /Passo 1:/ })).toBeVisible()

    const btnMudarPasta = page.getByRole('button', { name: 'Mudar pasta de instalação' })
    const boxPasta = await btnMudarPasta.boundingBox()
    expect(boxPasta).not.toBeNull()
    expect(boxPasta!.height).toBeGreaterThanOrEqual(24)
    expect(boxPasta!.width).toBeGreaterThanOrEqual(24)

    const summariesPasso1 = await page.locator('summary').evaluateAll((els) =>
      els.map((el) => ({
        texto: (el.textContent || '').trim(),
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height,
      })),
    )
    expect(summariesPasso1.length).toBeGreaterThanOrEqual(2)
    for (const s of summariesPasso1) {
      expect(s.h, `summary "${s.texto}"`).toBeGreaterThanOrEqual(24)
      expect(s.w, `summary "${s.texto}"`).toBeGreaterThanOrEqual(24)
    }

    // Assistente Passo 2: 4 role="radio" >= 24 px
    await page.goto('/#/assistente?passo=2')
    await expect(page.getByRole('heading', { name: /Passo 2:/ })).toBeVisible()
    const radiosPasso2 = await page.getByRole('radio').evaluateAll((els) =>
      els.map((el) => ({
        texto: (el.textContent || '').trim(),
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height,
      })),
    )
    expect(radiosPasso2.length).toBeGreaterThanOrEqual(4)
    for (const r of radiosPasso2) {
      expect(r.h, `radio "${r.texto}"`).toBeGreaterThanOrEqual(24)
      expect(r.w, `radio "${r.texto}"`).toBeGreaterThanOrEqual(24)
    }

    // BannerErroCore (?estado=erro em #/inicio)
    await page.goto('/#/inicio?estado=erro')
    const sumErro = page.getByRole('alert').locator('summary')
    await expect(sumErro).toBeVisible()
    const boxSumErro = await sumErro.boundingBox()
    expect(boxSumErro!.height).toBeGreaterThanOrEqual(24)

    // ConfigComponentes summaries
    await page.goto('/?source-test=1#/config/componentes')
    await expect(page.getByRole('heading', { name: 'Componentes e Armazenamento' })).toBeVisible()
    const sumComp1 = await page.locator('summary').evaluateAll((els) =>
      els.map((el) => ({ texto: (el.textContent || '').trim(), h: el.getBoundingClientRect().height })),
    )
    expect(sumComp1.length).toBeGreaterThan(0)
    for (const s of sumComp1) {
      expect(s.h, `summary "${s.texto}"`).toBeGreaterThanOrEqual(24)
    }

    await page.getByRole('tab', { name: 'Componentes e Modelos' }).click()
    const sumComp2 = await page.locator('summary').evaluateAll((els) =>
      els.map((el) => ({ texto: (el.textContent || '').trim(), h: el.getBoundingClientRect().height })),
    )
    expect(sumComp2.length).toBeGreaterThan(0)
    for (const s of sumComp2) {
      expect(s.h, `summary "${s.texto}"`).toBeGreaterThanOrEqual(24)
    }

    expect(erros).toEqual([])
  })

  test('UI-09: em [data-contrast="high"], Botao secundário, Segmentado, Select e Entrada têm contorno >= 3:1', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/?source-test=1#/config/aparencia')
    await page.getByRole('switch', { name: /Modo Alto Contraste/i }).click()
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high')
    await page.waitForTimeout(250)

    // Segmentado, Select, Entrada em Aparencia
    const infoAparencia = await page.evaluate(() => {
      const seg = document.querySelector('[role="radiogroup"][aria-label="Tema"]') as HTMLElement
      const sel = document.querySelector('[role="combobox"]') as HTMLElement
      const inp = document.querySelector('input[type="search"]') as HTMLElement
      const bgChao = getComputedStyle(document.body).backgroundColor
      return {
        bgChao,
        seg: { shadow: getComputedStyle(seg).boxShadow, bg: getComputedStyle(seg).backgroundColor },
        sel: { shadow: getComputedStyle(sel).boxShadow, bg: getComputedStyle(sel).backgroundColor },
        inp: { shadow: getComputedStyle(inp).boxShadow, bg: getComputedStyle(inp).backgroundColor },
      }
    })

    for (const [nome, item] of [
      ['Segmentado', infoAparencia.seg],
      ['Select', infoAparencia.sel],
      ['Entrada/Busca', infoAparencia.inp],
    ] as const) {
      const corBorda = extrairCorShadow(item.shadow)
      expect(corBorda, `${nome} boxShadow: ${item.shadow}`).not.toBeNull()
      const corFundo = parseRgba(item.bg) ?? parseRgba(infoAparencia.bgChao)!
      const r = razaoContraste(corBorda!, [corFundo[0], corFundo[1], corFundo[2]])
      expect(r, `${nome} contraste contorno`).toBeGreaterThanOrEqual(3)
    }

    // Botao secundário em #/config/provedores
    await page.goto('/?source-test=1#/config/provedores')
    const btnSec = page.getByRole('button', { name: 'Reabrir assistente inicial' })
    await expect(btnSec).toBeVisible()
    const infoBtn = await btnSec.evaluate((el) => ({
      shadow: getComputedStyle(el).boxShadow,
      bg: getComputedStyle(el).backgroundColor,
    }))
    const corBtnBorda = extrairCorShadow(infoBtn.shadow)
    expect(corBtnBorda, `Botao secundário boxShadow: ${infoBtn.shadow}`).not.toBeNull()
    const corBtnBg = parseRgba(infoBtn.bg)!
    expect(
      razaoContraste(corBtnBorda!, [corBtnBg[0], corBtnBg[1], corBtnBg[2]]),
    ).toBeGreaterThanOrEqual(3)

    expect(erros).toEqual([])
  })

  test('UI-10: um <h1> por tela (Assistente, PlaceholderTela) e headings <h2> reais em ConfigExportacao', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    await page.setViewportSize({ width: 1366, height: 768 })

    // Assistente passo 1 e 2
    await page.goto('/#/assistente?passo=1')
    await expect(
      page.getByRole('heading', { level: 1, name: /Passo 1: Essencial para transcrever e cortar/i }),
    ).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    await page.goto('/#/assistente?passo=2')
    await expect(
      page.getByRole('heading', { level: 1, name: /Passo 2: Quem escolhe os Cortes/i }),
    ).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    // PlaceholderTela: #/relatos, #/sobre e #/projeto/:id/fontes
    await page.goto('/#/relatos')
    await expect(page.getByRole('heading', { level: 1, name: 'Relatos e diagnóstico' })).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    await page.goto('/?source-test=1#/projeto/test-project/fontes')
    await expect(page.getByRole('heading', { level: 1, name: 'Fontes e Transcrição' })).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    // ConfigExportacao: h1 + h2 Status atual + h2 Escolha de encoder
    await page.goto('/?source-test=1#/config/exportacao?estado=parcial')
    await expect(page.getByRole('heading', { level: 1, name: 'Exportação e Encoder' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Status atual' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Escolha de encoder' })).toBeVisible()
    expect(await page.locator('h1').count()).toBe(1)

    expect(erros).toEqual([])
  })
})
