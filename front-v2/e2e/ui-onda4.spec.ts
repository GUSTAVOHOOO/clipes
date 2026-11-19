import { expect, test, type Page } from '@playwright/test'

declare const process: { env: Record<string, string | undefined> }

const CAPTURAS_DIR = '../docs/produto/front-v2/ui/capturas/onda-4'

type AchadoDom = {
  tela: string
  viewport: string
  contraste: string
  alvosMenores24: Array<{ tag: string; texto: string; w: number; h: number }>
  textosBaixoContraste: Array<{
    tag: string
    texto: string
    ratio: number
    fg: string
    bg: string
    fontSize: number
  }>
  semNomeAcessivel: Array<{ tag: string; html: string }>
  headings: Array<{ level: number; text: string }>
  h1Count: number
  saltoHeading: string | null
  botoesPrimariosSinal: number
  botoesPrimariosSinalTextos: string[]
  ticketRefsVisiveis: string[]
  glossarioViolacoes: string[]
  imagensQuebradas: Array<{ src: string; alt: string }>
  overflowExterno: {
    largura: boolean
    altura: boolean
    scrollW: number
    innerW: number
    scrollH: number
    innerH: number
  }
  overflowTabelasInternas: number
  focusOutlineTeste: { focado: string; outline: string; boxShadow: string } | null
}

async function auditarPagina(
  page: Page,
  tela: string,
  viewport: string,
  contraste: string,
): Promise<AchadoDom> {
  const resultado = await page.evaluate(() => {
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
    function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
      const l1 = lum(fg)
      const l2 = lum(bg)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    function effectiveBg(el: Element): [number, number, number] {
      const layers: Array<[number, number, number, number]> = []
      let cur: Element | null = el
      while (cur) {
        const bg = parseRgba(getComputedStyle(cur).backgroundColor)
        if (bg && bg[3] > 0) layers.push(bg)
        cur = cur.parentElement
      }
      const tema = document.documentElement.getAttribute('data-tema')
      let r = tema === 'claro' ? 246 : 15
      let g = tema === 'claro' ? 246 : 16
      let b = tema === 'claro' ? 247 : 18
      for (let i = layers.length - 1; i >= 0; i--) {
        const [lr, lg, lb, la] = layers[i]
        r = lr * la + r * (1 - la)
        g = lg * la + g * (1 - la)
        b = lb * la + b * (1 - la)
      }
      return [r, g, b]
    }
    function visivel(el: Element): boolean {
      const st = getComputedStyle(el)
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) {
        return false
      }
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }

    const alvosMenores24: Array<{ tag: string; texto: string; w: number; h: number }> = []
    const semNomeAcessivel: Array<{ tag: string; html: string }> = []
    const interativos = document.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="slider"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
    )
    for (const el of interativos) {
      if (el.getAttribute('aria-hidden') === 'true') continue
      if (!visivel(el)) continue
      const labelPai = el.closest('label')
      const alvo =
        ((el.getAttribute('role') === 'switch' ||
          el.getAttribute('role') === 'checkbox' ||
          (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio')) &&
          labelPai) ||
        el
      const r = alvo.getBoundingClientRect()
      const ehNativeTextInput =
        el.tagName === 'INPUT' &&
        !['radio', 'checkbox', 'button', 'submit'].includes((el as HTMLInputElement).type)
      if (!ehNativeTextInput && (r.width < 24 || r.height < 24)) {
        alvosMenores24.push({
          tag: el.tagName.toLowerCase(),
          texto: (
            alvo.textContent ||
            el.getAttribute('aria-label') ||
            el.getAttribute('role') ||
            ''
          )
            .trim()
            .slice(0, 50),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        })
      }
      const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
      const txt = (el.textContent || '').trim()
      const title = el.getAttribute('title')
      const id = el.getAttribute('id')
      const hasLabel = id ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : false
      const parentLabel = Boolean(labelPai)
      const placeholder = el.getAttribute('placeholder')
      if (
        el.tagName !== 'DIV' &&
        !aria &&
        !txt &&
        !title &&
        !hasLabel &&
        !parentLabel &&
        !placeholder
      ) {
        semNomeAcessivel.push({
          tag: el.tagName.toLowerCase(),
          html: el.outerHTML.slice(0, 120),
        })
      }
    }

    const textosBaixoContraste: Array<{
      tag: string
      texto: string
      ratio: number
      fg: string
      bg: string
      fontSize: number
    }> = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    const seen = new Set<Element>()
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || '').trim()
      if (!txt) continue
      const el = node.parentElement
      if (!el || seen.has(el) || !visivel(el)) continue
      seen.add(el)
      const st = getComputedStyle(el)
      const fgRgba = parseRgba(st.color)
      if (!fgRgba) continue
      const bgRgb = effectiveBg(el)
      const fgRgb: [number, number, number] = [
        fgRgba[0] * fgRgba[3] + bgRgb[0] * (1 - fgRgba[3]),
        fgRgba[1] * fgRgba[3] + bgRgb[1] * (1 - fgRgba[3]),
        fgRgba[2] * fgRgba[3] + bgRgb[2] * (1 - fgRgba[3]),
      ]
      const ratio = Math.round(contrastRatio(fgRgb, bgRgb) * 100) / 100
      const fs = parseFloat(st.fontSize)
      const fw = parseInt(st.fontWeight, 10) || 400
      const large = fs >= 24 || (fs >= 18.66 && fw >= 700)
      const minRatio = large ? 3 : 4.5
      const disabled = Boolean(el.closest('[disabled], [aria-disabled="true"]'))
      if (!disabled && ratio < minRatio) {
        textosBaixoContraste.push({
          tag: el.tagName.toLowerCase(),
          texto: txt.slice(0, 50),
          ratio,
          fg: st.color,
          bg: `rgb(${Math.round(bgRgb[0])}, ${Math.round(bgRgb[1])}, ${Math.round(bgRgb[2])})`,
          fontSize: fs,
        })
      }
    }

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter(visivel)
      .map((h) => ({
        level: Number(h.tagName[1]),
        text: (h.textContent || '').trim().slice(0, 60),
      }))
    const h1Count = headings.filter((h) => h.level === 1).length
    let saltoHeading: string | null = null
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) {
        saltoHeading = `h${headings[i - 1].level} -> h${headings[i].level} (${headings[i].text})`
        break
      }
    }

    const botoesSinalVisiveis = Array.from(document.querySelectorAll('button.bg-sinal')).filter(
      visivel,
    )
    const botoesPrimariosSinal = botoesSinalVisiveis.length
    const botoesPrimariosSinalTextos = botoesSinalVisiveis.map((b) =>
      (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 40),
    )

    const bodyText = document.body.innerText
    const ticketRefsVisiveis: string[] = []
    const ignorarExecucao = new Set<string>()
    const matchesExec = bodyText.match(/Execução\s+#\d+\b/gi)
    if (matchesExec) {
      for (const m of matchesExec) {
        const num = m.match(/#\d+/)?.[0]
        if (num) ignorarExecucao.add(num)
      }
    }
    const matchesTickets = bodyText.match(/#\d{2,4}\b/g)
    if (matchesTickets) {
      for (const m of matchesTickets) {
        if (!ignorarExecucao.has(m) && !ticketRefsVisiveis.includes(m)) {
          ticketRefsVisiveis.push(m)
        }
      }
    }

    const glossarioViolacoes: string[] = []
    const proibidos: Array<[RegExp, string]> = [
      [/\bclipes?\b/gi, 'clipe (exceto marca Clipes)'],
      [/\bshorts?\b/gi, 'short (exceto nome da plataforma YouTube Shorts)'],
      [/\binputs?\b/gi, 'input'],
      [/\bvoice-?over\b/gi, 'voice-over'],
      [/\blocu[çc][ãa]o\b/gi, 'locução'],
      [/\bworkspace\b/gi, 'workspace'],
      [/\bpreset(s)?\b/gi, 'preset'],
      [/\bsegmentos?\b/gi, 'segmento'],
      [/\bsenten[çc]as?\b/gi, 'sentença'],
      [/\bhighlights?\b/gi, 'highlight'],
      [/\brodada(s)?\b/gi, 'rodada'],
    ]
    for (const [rx, nome] of proibidos) {
      const matches = bodyText.match(rx)
      if (matches) {
        const filtrados = nome.startsWith('clipe')
          ? matches.filter((m) => m.toLowerCase() !== 'clipes')
          : matches
        if (filtrados.length > 0) {
          glossarioViolacoes.push(`${nome}: ${filtrados.slice(0, 3).join(', ')}`)
        }
      }
    }

    const imagensQuebradas = Array.from(document.querySelectorAll('img'))
      .filter(visivel)
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => ({
        src: (img.getAttribute('src') || '').slice(0, 80),
        alt: img.getAttribute('alt') || '',
      }))

    const overflowExterno = {
      largura: document.documentElement.scrollWidth <= window.innerWidth,
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }

    const overflowTabelasInternas = Array.from(document.querySelectorAll('table')).filter((t) => {
      const p = t.parentElement
      return p ? t.scrollWidth > p.clientWidth + 1 : false
    }).length

    return {
      alvosMenores24,
      textosBaixoContraste,
      semNomeAcessivel,
      headings,
      h1Count,
      saltoHeading,
      botoesPrimariosSinal,
      botoesPrimariosSinalTextos,
      ticketRefsVisiveis,
      glossarioViolacoes,
      imagensQuebradas,
      overflowExterno,
      overflowTabelasInternas,
    }
  })

  await page.keyboard.press('Tab')
  const focusOutlineTeste = await page.evaluate(() => {
    const active = document.activeElement
    if (!active || active === document.body) return null
    const st = getComputedStyle(active)
    return {
      focado: `${active.tagName.toLowerCase()}:${(active.textContent || active.getAttribute('aria-label') || '').trim().slice(0, 40)}`,
      outline: `${st.outlineWidth} ${st.outlineStyle} ${st.outlineColor}`,
      boxShadow: st.boxShadow,
    }
  })

  return {
    tela,
    viewport,
    contraste,
    ...resultado,
    focusOutlineTeste,
  }
}

async function alternarAltoContraste(page: Page, ativar: boolean) {
  const urlAnterior = page.url()
  await page.evaluate(() => {
    window.location.hash = '#/config/aparencia'
  })
  const sw = page.getByRole('switch', { name: /Modo Alto Contraste/i })
  await expect(sw).toBeVisible()
  const checked = (await sw.getAttribute('aria-checked')) === 'true'
  if (checked !== ativar) {
    await sw.click()
  }
  if (ativar) {
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high')
  } else {
    await expect(page.locator('html')).not.toHaveAttribute('data-contrast', 'high')
  }
  await page.waitForTimeout(250)
  const hashAnterior = new URL(urlAnterior).hash || '#/inicio'
  await page.evaluate((h) => {
    window.location.hash = h
  }, hashAnterior)
}

async function esperarToastsSumirem(page: Page) {
  await expect(page.locator('[aria-label="Notifications"] [role="dialog"]')).toHaveCount(0, {
    timeout: 6000,
  })
}

test.describe('Avaliação UI independente — Onda 4 (Editor do Corte)', () => {
  test.skip(
    !process.env.UI_BASELINE,
    'Execução manual de avaliação UI Onda 4 (defina UI_BASELINE=1)',
  )

  test('percorre fluxos (m)-(p) em 1366x768 e 1440x900, tema padrão e alto contraste', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)

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

    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    const relatorio: AchadoDom[] = []
    const checksExtras: Record<string, unknown> = {}
    const salvarCaptura = async (nome: string) => {
      await page.screenshot({ path: `${CAPTURAS_DIR}/${nome}`, animations: 'disabled' })
    }

    // ==================================================================
    // Fluxo (m) e (n) — Corte direto 102 (?run=1) em 1366x768
    // ==================================================================
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/102/editar?run=1'
    })

    const navAbas = page.getByRole('navigation', { name: 'Etapas do Corte' })
    await expect(navAbas.getByRole('link', { name: 'Editar' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(navAbas.getByRole('link', { name: 'Transformar' })).toHaveCount(0)
    await expect(navAbas.getByRole('link', { name: 'Empacotar' })).toBeVisible()
    await expect(page.getByText('Preparando prévia rápida…')).toBeHidden({ timeout: 10000 })

    // Verifica Variante D: sem painel direito fixo
    const inspetorFixoCount = await page.getByRole('complementary', { name: /Inspetor/i }).count()
    const textoContextoDireto = await page.locator('[data-regiao="topo"]').innerText()
    const dimQuadroDireto1366 = await page
      .getByTestId('quadro-previa-9-16')
      .evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })
    checksExtras.contextoDireto = {
      inspetorFixoCount,
      dimQuadroDireto1366,
      temTransformar: await navAbas.getByRole('link', { name: 'Transformar' }).count(),
      textoContextoDireto: textoContextoDireto.slice(0, 200),
    }

    await salvarCaptura('01-editar-direto-1366.png')
    relatorio.push(await auditarPagina(page, 'n-editar-direto-1366', '1366x768', 'padrao'))

    // Verifica <span tabIndex={0}> envolvendo botão desabilitado no ContextoCorte
    const spanTabIndexContexto = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-regiao="topo"] span[tabindex="0"]')).map((el) =>
        el.textContent?.trim(),
      ),
    )
    checksExtras.spanTabIndexContexto = spanTabIndexContexto

    // ==================================================================
    // Fluxo (m) — Diálogo de Exportação Individual (Ctrl+E): foco inicial, retorno de foco, fallback
    // ==================================================================
    const btnExportar = page.getByRole('button', { name: /Exportar Corte/i })
    await btnExportar.focus()
    await page.keyboard.press('Control+e')
    const dlgExp = page.getByRole('dialog', { name: /Exportar Corte/i })
    await expect(dlgExp).toBeVisible()
    await expect(dlgExp.getByRole('button', { name: /Iniciar exportação/i })).toBeEnabled({
      timeout: 8000,
    })

    const focoInicialExport = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase(),
      texto: (
        document.activeElement?.textContent ||
        document.activeElement?.getAttribute('aria-label') ||
        ''
      ).trim(),
    }))
    await salvarCaptura('06-exportar-corte-dialog-1366.png')
    relatorio.push(await auditarPagina(page, 'm-exportar-dialog', '1366x768', 'padrao'))

    // Alto contraste no diálogo de exportação
    await dlgExp.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgExp).toBeHidden()
    const focoRetornoExport = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase(),
      texto: (
        document.activeElement?.textContent ||
        document.activeElement?.getAttribute('aria-label') ||
        ''
      ).trim(),
    }))

    await alternarAltoContraste(page, true)
    await expect(page.getByRole('button', { name: /Exportar Corte/i })).toBeEnabled()
    await page.keyboard.press('Control+e')
    await expect(dlgExp).toBeVisible()
    await expect(dlgExp.getByRole('button', { name: /Iniciar exportação/i })).toBeEnabled()
    await salvarCaptura('08-exportar-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'm-exportar-hc', '1366x768', 'high'))
    await dlgExp.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgExp).toBeHidden()
    await alternarAltoContraste(page, false)

    // Confirma ack + exporta em ?estado=fallback em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/102/editar?run=1&estado=fallback'
    })
    await page.keyboard.press('Control+e')
    const dlgFallback = page.getByRole('dialog', { name: /Exportar Corte/i })
    await expect(dlgFallback).toBeVisible()
    const btnEntendi = dlgFallback.getByRole('button', { name: /Entendi o risco/i })
    if (await btnEntendi.isVisible()) {
      await btnEntendi.click()
      await expect(dlgFallback.getByText(/confirmado para este canal/i)).toBeVisible()
    }
    await dlgFallback.getByRole('button', { name: /Iniciar exportação/i }).click()
    await expect(dlgFallback.getByText(/Corte exportado com sucesso/i)).toBeVisible({
      timeout: 10000,
    })
    await expect(dlgFallback.getByText(/CPU|libx264/i)).toBeVisible()
    await salvarCaptura('07-exportar-fallback-cpu-1440.png')
    relatorio.push(await auditarPagina(page, 'm-exportar-fallback', '1440x900', 'padrao'))
    await dlgFallback.getByRole('button', { name: 'Fechar' }).first().click()
    await expect(dlgFallback).toBeHidden()
    await esperarToastsSumirem(page)

    checksExtras.dialogoExportFoco = { focoInicialExport, focoRetornoExport }

    // ==================================================================
    // Fluxo (n) — Vídeo transformado 201 (?run=2), Painel Esquerdo, Timeline, Palco, F6, Atalhos, WCAG 2.1.4
    // ==================================================================
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
    })
    await expect(navAbas.getByRole('link', { name: 'Transformar' })).toBeVisible()
    await expect(page.getByText('Preparando prévia rápida…')).toBeHidden({ timeout: 10000 })
    await esperarToastsSumirem(page)

    // Painel esquerdo recolhido (Ctrl+[) em 1366x768
    await page.keyboard.press('Control+[')
    await expect(page.getByRole('complementary', { name: 'Transcrição recolhida' })).toBeVisible()
    await salvarCaptura('02-editar-recolhido-indice-1366.png')
    relatorio.push(await auditarPagina(page, 'n-editar-recolhido', '1366x768', 'padrao'))

    // Reabre Painel esquerdo (Ctrl+[), edita palavra (F2) mantendo foco e testa busca (Ctrl+F)
    await page.keyboard.press('Control+[')
    const painelEsq = page.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })
    await expect(painelEsq).toBeVisible()
    const primeiraPalavra = painelEsq.locator('button[data-word]').first()
    const textoOriginal = (await primeiraPalavra.innerText()).trim()
    await primeiraPalavra.focus()
    await page.keyboard.press('F2')
    const inputCorrecao = painelEsq.getByRole('textbox', { name: 'Corrigir palavra' })
    await expect(inputCorrecao).toBeFocused()
    await inputCorrecao.fill(`${textoOriginal}X`)
    await page.keyboard.press('Enter')
    await expect(painelEsq.locator('button[data-word]').first()).toContainText(`${textoOriginal}X`)
    const focoAposF2 = await page.evaluate(
      () => document.activeElement?.getAttribute('data-word') ?? null,
    )

    // Testa Ctrl+F na Transcrição e respeito a teclas únicas no input de busca
    await page.keyboard.press('Control+f')
    const buscaInput = painelEsq.getByRole('textbox', { name: /Filtrar fala do Corte/i })
    await expect(buscaInput).toBeFocused()
    await buscaInput.type('jil')
    const buscaValor = await buscaInput.inputValue()
    await painelEsq.getByRole('button', { name: 'Limpar filtro' }).click()

    // Modo Enquadrar na Fonte 16:9 + retângulo de crop por teclado em 1366x768
    await page.getByRole('radio', { name: 'Enquadrar na Fonte 16:9' }).click()
    await expect(page.getByTestId('quadro-fonte-16-9')).toBeVisible()
    const cropRet = page.getByTestId('retangulo-crop-ativo')
    await cropRet.focus()
    await page.keyboard.press('ArrowRight')
    await salvarCaptura('04-editar-fonte-16-9-crop-1366.png')
    relatorio.push(await auditarPagina(page, 'n-editar-fonte-16-9', '1366x768', 'padrao'))
    await page.getByRole('radio', { name: 'Prévia 9:16' }).click()
    await expect(page.getByTestId('quadro-previa-9-16')).toBeVisible()

    // Alto contraste na tela Editar em 1366x768
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })).toBeVisible()
    await salvarCaptura('05-editar-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'n-editar-hc', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // Em 1440x900: Índice do Corte (100% teclado) + Timeline +3 faixas (Narração + Trilha & SFX)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(painelEsq).toBeVisible()
    await painelEsq.getByRole('tab', { name: 'Índice do Corte' }).click()
    const listboxIndice = painelEsq.getByRole('listbox', { name: 'Índice do Corte' })
    await listboxIndice.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    const timeline = page.getByRole('region', { name: 'Timeline compacta do Corte' })
    await timeline.getByRole('button', { name: /\+3 faixas/i }).click()
    await expect(timeline.getByText('Narração')).toBeVisible()
    await expect(timeline.getByText('Trilha & SFX')).toBeVisible()
    await salvarCaptura('03-editar-transformado-3faixas-1440.png')
    relatorio.push(
      await auditarPagina(page, 'n-editar-transformado-3faixas-1440', '1440x900', 'padrao'),
    )
    await timeline.getByRole('button', { name: /Recolher faixas/i }).click()
    await painelEsq.getByRole('tab', { name: 'Transcrição' }).click()

    // Overlay de borda + Alt ("Livre por quadro (Alt)") em 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    const alcaEntrada = timeline.getByRole('slider', { name: 'Alça Entrada' })
    const boxAlca = await alcaEntrada.boundingBox()
    await page.keyboard.down('Alt')
    await expect(timeline.getByText('Livre por quadro (Alt)')).toBeVisible()
    if (boxAlca) {
      await page.mouse.move(boxAlca.x + boxAlca.width / 2, boxAlca.y + boxAlca.height / 2)
      await page.mouse.down()
      await page.mouse.move(boxAlca.x + 25, boxAlca.y + boxAlca.height / 2, { steps: 4 })
      await expect(page.getByText(/Livre por quadro \(Alt\)/i).first()).toBeVisible()
      await salvarCaptura('16-ciclo-overlay-borda-alt-1366.png')
      relatorio.push(await auditarPagina(page, 'n-overlay-borda-alt', '1366x768', 'padrao'))
      await page.mouse.up()
    }
    await page.keyboard.up('Alt')

    // Testa F6 ciclando todas as regiões (inclusive com popover aberto)
    await page.getByRole('button', { name: 'Enquadrar', exact: true }).click()
    await expect(page.getByText('Rosto (9:16)')).toBeVisible()
    const regioesF6: Array<string | null> = []
    await page.locator('[data-regiao="topo"] a, [data-regiao="topo"] button').first().focus()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('F6')
      const r = await page.evaluate(() => {
        const ae = document.activeElement
        if (!ae) return null
        return (
          ae.closest('[data-regiao]')?.getAttribute('data-regiao') ||
          ae.closest('aside')?.getAttribute('aria-label') ||
          ae.closest('section')?.getAttribute('aria-label') ||
          ae.tagName.toLowerCase()
        )
      })
      regioesF6.push(r)
    }
    await page.keyboard.press('Escape')

    // Testa atalhos de uma tecla (Espaço, J, K, L, I, O, +, -) + Paleta Ctrl+K + WCAG 2.1.4 (Alt+tecla)
    const tempoAntesAtalho = await page
      .locator('[aria-label^="Posição "]')
      .getAttribute('aria-label')
    await page.getByTestId('quadro-previa-9-16').click()
    await page.keyboard.press('l')
    await page.waitForTimeout(180)
    await page.keyboard.press('k')
    const tempoDepoisLK = await page
      .locator('[aria-label^="Posição "]')
      .getAttribute('aria-label')
    await page.keyboard.press('Equal') // +
    const zoomAposMais = await timeline.locator('span.num', { hasText: '%' }).first().innerText()
    await page.keyboard.press('Minus') // -
    const zoomAposMenos = await timeline.locator('span.num', { hasText: '%' }).first().innerText()

    // Paleta Ctrl+K bloqueia teclas únicas + verifica se Ctrl+] aparece na Paleta
    await page.keyboard.press('Control+k')
    const inputPaleta = page.locator('[cmdk-input]')
    await expect(inputPaleta).toBeVisible()
    await inputPaleta.fill('popover')
    const paletaPopoverTexto = await page.locator('[cmdk-list]').innerText()
    await inputPaleta.fill('jklio+- ')
    await expect(inputPaleta).toHaveValue('jklio+- ')
    await page.keyboard.press('Escape')
    await expect(inputPaleta).toBeHidden()

    // WCAG 2.1.4: Exigir Alt + tecla -> verifica se 'l' é ignorado, 'Alt+l' funciona, e se <Kbd> no Transporte/Rodapé muda
    await page.evaluate(() => {
      window.location.hash = '#/config/aparencia'
    })
    await page.getByRole('radio', { name: /Exigir modificador Alt \+ tecla/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
    })
    await expect(page.getByRole('button', { name: 'Enquadrar', exact: true })).toBeVisible()
    const kbdTransporteAlt = await page
      .getByRole('toolbar', { name: 'Controles de reprodução' })
      .evaluate((el) => Array.from(el.querySelectorAll('kbd')).map((k) => k.textContent))
    const statusBarKbdsAlt = await page
      .locator('[data-regiao="rodape"] kbd')
      .allInnerTexts()
    await page.keyboard.press('l')
    await page.waitForTimeout(150)
    const labelPlayAposLAltMode = await page
      .getByRole('toolbar', { name: 'Controles de reprodução' })
      .getByRole('button', { name: /Reproduzir|Pausar/i })
      .getAttribute('aria-label')
    // Restaura modo padrão
    await page.evaluate(() => {
      window.location.hash = '#/config/aparencia'
    })
    await page.getByRole('radio', { name: /Ativos fora de campos de texto/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
    })
    await expect(page.getByRole('button', { name: 'Enquadrar', exact: true })).toBeVisible()
    await expect(page.getByText('Preparando prévia rápida…')).toBeHidden({ timeout: 10000 })

    checksExtras.atalhosEditor = {
      focoAposF2,
      buscaValor,
      regioesF6,
      tempoAntesAtalho,
      tempoDepoisLK,
      zoomAposMais,
      zoomAposMenos,
      paletaPopoverTexto: paletaPopoverTexto.slice(0, 200),
      kbdTransporteAlt,
      statusBarKbdsAlt,
      labelPlayAposLAltMode,
    }

    // ==================================================================
    // Fluxo (o) — Os 5 Popovers (Enquadrar, Legenda+Tradução, Silêncios, Áudio, Histórico)
    // ==================================================================
    // 1. Popover Enquadrar (YuNet JIT + layouts + Limpar edições ConfirmDialog)
    await page.getByRole('button', { name: 'Enquadrar', exact: true }).click()
    const focoPopoverEnquadrarAbrir = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase(),
      texto: (
        document.activeElement?.textContent ||
        document.activeElement?.getAttribute('aria-label') ||
        ''
      ).trim(),
    }))
    await page.getByRole('radio', { name: 'Rosto (9:16)' }).click()
    await expect(page.getByText(/YuNet/i).first()).toBeVisible()
    await page.waitForTimeout(220)
    await salvarCaptura('09-popover-enquadrar-yunet-1366.png')
    relatorio.push(await auditarPagina(page, 'o-popover-enquadrar-yunet', '1366x768', 'padrao'))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Adicionar/Atualizar na agulha' }).click()
    await page.getByRole('button', { name: /Limpar todas as edições manuais/i }).click()
    const dlgLimpar = page.getByRole('alertdialog')
    await expect(dlgLimpar).toBeVisible()
    await expect(dlgLimpar.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await salvarCaptura('10-popover-enquadrar-limpar-dialog-1440.png')
    relatorio.push(await auditarPagina(page, 'o-popover-enquadrar-limpar', '1440x900', 'padrao'))
    await dlgLimpar.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgLimpar).toBeHidden()
    await page.keyboard.press('Escape')
    const focoPopoverEnquadrarEsc = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase(),
      texto: (
        document.activeElement?.textContent ||
        document.activeElement?.getAttribute('aria-label') ||
        ''
      ).trim(),
    }))

    // Alto contraste com popover aberto em 1440x900
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('button', { name: 'Enquadrar', exact: true })).toBeVisible()
    await page.keyboard.press('Control+]')
    await expect(page.getByText('Rosto (9:16)')).toBeVisible()
    await page.waitForTimeout(220)
    await salvarCaptura('24-estado-editar-hc-popover-1440.png')
    relatorio.push(await auditarPagina(page, 'o-editar-hc-popover', '1440x900', 'high'))
    await page.keyboard.press('Escape')
    await alternarAltoContraste(page, false)

    // 2. Popover Legenda + Tradução (?translation-paid=1 para ResumoCustoPrivacidade + ConfirmDialog)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.getByRole('button', { name: 'Legenda', exact: true }).click()
    await expect(page.getByText(/salvos automaticamente/i)).toBeVisible()
    await page.waitForTimeout(220)
    await salvarCaptura('11-popover-legenda-estilo-1366.png')
    relatorio.push(await auditarPagina(page, 'o-popover-legenda-estilo', '1366x768', 'padrao'))
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?translation-paid=1#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
    })
    await expect(page.getByRole('button', { name: 'Legenda', exact: true })).toBeVisible()
    await expect(page.getByText('Preparando prévia rápida…')).toBeHidden({ timeout: 10000 })
    await page.getByRole('button', { name: 'Legenda', exact: true }).click()
    await page.getByRole('button', { name: 'Calcular tradução' }).click()
    await expect(page.getByRole('button', { name: 'Traduzir Corte' })).toBeVisible()
    await page.getByRole('button', { name: 'Traduzir Corte' }).click()
    const dlgTraduzir = page.getByRole('alertdialog')
    await expect(dlgTraduzir).toBeVisible()
    await expect(dlgTraduzir.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await salvarCaptura('12-popover-legenda-traducao-custo-1440.png')
    relatorio.push(
      await auditarPagina(page, 'o-popover-legenda-traducao-custo', '1440x900', 'padrao'),
    )
    await dlgTraduzir.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgTraduzir).toBeHidden()
    await page.keyboard.press('Escape')

    // Volta para URL limpa (sem ?translation-paid=1)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
    })
    await expect(page.getByRole('button', { name: 'Silêncios', exact: true })).toBeVisible()
    await expect(page.getByText('Preparando prévia rápida…')).toBeHidden({ timeout: 10000 })

    // 3. Popover Silêncios
    await page.getByRole('button', { name: 'Silêncios', exact: true }).click()
    await expect(page.getByText(/120 ms/)).toBeVisible()
    await page.waitForTimeout(220)
    await salvarCaptura('13-popover-silencios-1366.png')
    relatorio.push(await auditarPagina(page, 'o-popover-silencios', '1366x768', 'padrao'))
    await page.keyboard.press('Escape')

    // 4. Popover Áudio (testa cc_by obrigatório + foco em Atribuição)
    await page.getByRole('button', { name: 'Áudio', exact: true }).click()
    await page.getByRole('button', { name: 'Importar áudio (até 500 MiB)' }).click()
    await page.getByRole('textbox', { name: /Arquivo de áudio/i }).fill('/audio/trilha.mp3')
    await page.getByRole('combobox', { name: /Origem \/ Licença/i }).click()
    await page.getByRole('option', { name: /CC-BY/i }).click()
    await page.getByRole('button', { name: 'Confirmar importação' }).click()
    await expect(page.getByText(/atribuição obrigatória/i)).toBeVisible()
    await expect(page.getByRole('textbox', { name: /Atribuição/i })).toBeFocused()
    await page.waitForTimeout(220)
    await salvarCaptura('14-popover-audio-ccby-1366.png')
    relatorio.push(await auditarPagina(page, 'o-popover-audio-ccby', '1366x768', 'padrao'))
    await page.getByRole('textbox', { name: /Atribuição/i }).fill('Autor X')
    await page.getByRole('button', { name: 'Confirmar importação' }).click()
    await expect(page.getByRole('button', { name: 'Excluir trilha da biblioteca' })).toBeVisible()
    await page.keyboard.press('Escape')

    // 5. Popover Histórico em 1440x900 (cria uma edição + Salvar agora para ter snapshot e undoCount)
    await page.setViewportSize({ width: 1440, height: 900 })
    await timeline.getByRole('button', { name: 'Recuar Entrada 1 Frase' }).click()
    await expect(page.getByText('Alterações pendentes…')).toBeVisible()
    await page.getByRole('button', { name: 'Histórico', exact: true }).click()
    await expect(page.getByText(/Fora do Desfazer do Corte/i)).toBeVisible()
    await page.getByRole('button', { name: 'Salvar agora' }).click()
    await expect(page.getByText(/Rev\. \d+/)).toBeVisible({ timeout: 5000 })
    await salvarCaptura('15-popover-historico-1440.png')
    relatorio.push(await auditarPagina(page, 'o-popover-historico', '1440x900', 'padrao'))
    await page.keyboard.press('Escape')

    checksExtras.popoversFoco = {
      focoPopoverEnquadrarAbrir,
      focoPopoverEnquadrarEsc,
    }

    // ==================================================================
    // Fluxo (p) — Ciclo de vida e estados
    // ==================================================================
    await page.setViewportSize({ width: 1366, height: 768 })

    // p.1: ?estado=erro-flush ao sair -> ConfirmDialog 3 ações
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/editar?run=2&estado=erro-flush'
    })
    await expect(page.getByRole('button', { name: 'Enquadrar', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Empacotar' }).click()
    const dlgSaida = page.getByRole('alertdialog')
    await expect(dlgSaida).toBeVisible()
    await expect(dlgSaida.getByRole('button', { name: 'Continuar editando' })).toBeFocused()
    await salvarCaptura('17-ciclo-erro-flush-saida-1366.png')
    relatorio.push(await auditarPagina(page, 'p-ciclo-erro-flush-saida', '1366x768', 'padrao'))
    await dlgSaida.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dlgSaida).toBeHidden()

    // p.2: ?estado=erro-flush com Ctrl+S -> editor_save_failed na Barra de Status + Shell ConfirmDialog
    await page.keyboard.press('Control+s')
    const dlgShellErro = page.getByRole('alertdialog')
    await expect(dlgShellErro).toBeVisible()
    await expect(page.locator('[data-regiao="rodape"]').getByText('Falha ao salvar')).toBeVisible()
    await salvarCaptura('18-ciclo-editor-save-failed-shell-1366.png')
    relatorio.push(await auditarPagina(page, 'p-ciclo-save-failed-shell', '1366x768', 'padrao'))
    await dlgShellErro.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dlgShellErro).toBeHidden()

    // Limpa estado erro-flush mantendo o mesmo Corte 202 e verifica se Ctrl+S limpa o erro de salvamento no Shell
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/editar?run=2'
    })
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(150)
    const statusRodapeAposCtrlSLimpo = await page.locator('[data-regiao="rodape"]').innerText()
    checksExtras.statusRodapeAposCtrlSLimpo = statusRodapeAposCtrlSLimpo
    // Se BarraStatus ainda estiver presa em "Falha ao salvar", recupera pelo botão "Tentar novamente"
    const btnTentarRodape = page.locator('[data-regiao="rodape"]').getByRole('button', { name: 'Tentar novamente' })
    if (await btnTentarRodape.isVisible()) {
      await btnTentarRodape.click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Tentar salvar novamente' }).click()
    }
    await expect(page.locator('[data-regiao="rodape"]').getByText('Salvo')).toBeVisible()

    // p.3: Guarda de entrada (Corte inválido 999999 -> redireciona para #/projeto/demo/cortes + toast)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/999999/editar'
    })
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)
    await expect(page.getByText('Este Corte não está disponível para edição.')).toBeVisible()
    await salvarCaptura('19-estado-guarda-entrada-toast-1366.png')
    relatorio.push(await auditarPagina(page, 'p-guarda-entrada-toast', '1366x768', 'padrao'))
    await esperarToastsSumirem(page)

    // p.4: Fonte offline (?estado=offline -> somente leitura + Relocalizar Fonte + Transcrição/±1F ativos)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/202/editar?run=2&estado=offline'
    })
    await expect(
      page.getByText(/O arquivo original da Fonte foi movido ou alterado/i),
    ).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)
    await expect(timeline.getByRole('button', { name: 'Recuar Entrada 1 Frase' })).toBeEnabled()
    await salvarCaptura('20-estado-fonte-offline-1366.png')
    relatorio.push(await auditarPagina(page, 'p-estado-fonte-offline', '1366x768', 'padrao'))

    // p.5: Corte V1 avulso (avulso-1-1-3) em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/avulso-1-1-3/editar'
    })
    await expect(page.getByText('Corte #avulso-1-1-3')).toBeVisible()
    await expect(navAbas.getByRole('link', { name: 'Transformar' })).toHaveCount(0)
    await expect(navAbas.getByRole('link', { name: 'Empacotar' })).toHaveCount(0)
    await salvarCaptura('21-estado-corte-avulso-v1-1440.png')
    relatorio.push(await auditarPagina(page, 'p-estado-corte-avulso-v1', '1440x900', 'padrao'))

    // p.6: Erro fatal (?estado=erro) em 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?estado=erro'
    })
    await expect(page.getByRole('alert')).toContainText(/Não foi possível gravar/i)
    await salvarCaptura('22-estado-erro-fatal-1366.png')
    relatorio.push(await auditarPagina(page, 'p-estado-erro-fatal', '1366x768', 'padrao'))

    // p.7: Vazio (?estado=vazio) em 1366x768
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?estado=vazio'
    })
    await expect(page.getByText('Este Corte não está disponível para edição')).toBeVisible()
    await salvarCaptura('23-estado-vazio-editar-1366.png')
    relatorio.push(await auditarPagina(page, 'p-estado-vazio-editar', '1366x768', 'padrao'))

    const jsonRelatorio = JSON.stringify(
      {
        erros,
        checksExtras,
        relatorio,
      },
      null,
      2,
    )
    await testInfo.attach('ui-onda4-audit.json', {
      body: jsonRelatorio,
      contentType: 'application/json',
    })
    console.log('UI_ONDA4_AUDIT_SUMMARY=' + jsonRelatorio)

    expect(erros).toEqual([])
  })
})
