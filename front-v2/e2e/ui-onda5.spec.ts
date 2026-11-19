import { expect, test, type Page } from '@playwright/test'

declare const process: { env: Record<string, string | undefined> }

const CAPTURAS_DIR = '../docs/produto/front-v2/ui/capturas/onda-5-aval'

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
  spanTabIndexZero: string[]
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
        el.tagName !== 'PRE' &&
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

    const spanTabIndexZero = Array.from(document.querySelectorAll('span[tabindex="0"]'))
      .filter(visivel)
      .map((el) => (el.textContent || el.getAttribute('aria-label') || 'span').trim().slice(0, 50))

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
    const ignorarEntidade = new Set<string>()
    const matchesEntidade = bodyText.match(/(?:Lote|job|Fonte|tarefa|incerta|Execução|Corte|Frase)\s*#\d+\b/gi)
    if (matchesEntidade) {
      for (const m of matchesEntidade) {
        const num = m.match(/#\d+/)?.[0]
        if (num) ignorarEntidade.add(num)
      }
    }
    const matchesTickets = bodyText.match(/#\d{2,4}\b/g)
    if (matchesTickets) {
      for (const m of matchesTickets) {
        if (!ignorarEntidade.has(m) && !ticketRefsVisiveis.includes(m)) {
          ticketRefsVisiveis.push(m)
        }
      }
    }

    const glossarioViolacoes: string[] = []
    const proibidos: Array<[RegExp, string]> = [
      [/\bclipes?\b/gi, 'clipe (exceto marca Clipes)'],
      [/\bshorts?\b/gi, 'short (exceto YouTube Shorts)'],
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
        let filtrados: string[] = Array.from(matches)
        if (nome.startsWith('clipe')) {
          filtrados = filtrados.filter((m) => m.toLowerCase() !== 'clipes')
        } else if (nome.startsWith('short')) {
          filtrados = filtrados.filter(() => !/YouTube Shorts|Shorts com/i.test(bodyText))
        }
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
      spanTabIndexZero,
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

async function irPara(page: Page, hash: string) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

async function alternarAltoContraste(page: Page, ativar: boolean) {
  const urlAnterior = page.url()
  await irPara(page, '#/config/aparencia')
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
  await page.waitForTimeout(200)
  const hashAnterior = new URL(urlAnterior).hash || '#/inicio'
  await irPara(page, hashAnterior)
}

async function esperarToastsSumirem(page: Page) {
  await expect(page.locator('[aria-label="Notifications"] [role="dialog"]')).toHaveCount(0, {
    timeout: 6_000,
  })
}

async function medirCicloF6(page: Page, passos = 7): Promise<Array<string | null>> {
  const regioes: Array<string | null> = []
  await page.locator('[data-regiao="topo"] a, [data-regiao="topo"] button').first().focus()
  for (let i = 0; i < passos; i++) {
    await page.keyboard.press('F6')
    const r = await page.evaluate(() => {
      const ae = document.activeElement
      if (!ae) return null
      return (
        ae.closest('[data-regiao]')?.getAttribute('data-regiao') ||
        ae.closest('nav[aria-label]')?.getAttribute('aria-label') ||
        ae.closest('aside[aria-label]')?.getAttribute('aria-label') ||
        ae.closest('section[aria-label]')?.getAttribute('aria-label') ||
        ae.closest('[role="region"][aria-label]')?.getAttribute('aria-label') ||
        ae.tagName.toLowerCase()
      )
    })
    regioes.push(r)
  }
  return regioes
}

test.describe('Avaliação UI independente — Onda 5 (Transformar e Empacotar)', () => {
  test.skip(
    !process.env.UI_BASELINE,
    'Execução manual de avaliação UI Onda 5 (defina UI_BASELINE=1)',
  )

  test('percorre fluxos (u)-(v) em 1366x768 e 1440x900, tema padrão e alto contraste', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(240_000)

    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    const relatorio: AchadoDom[] = []
    const checksExtras: Record<string, unknown> = {}
    const salvarCaptura = async (nome: string) => {
      await page.screenshot({ path: `${CAPTURAS_DIR}/${nome}`, animations: 'disabled' })
    }

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

    // ==================================================================
    // Abre Projeto Demo em 1366x768
    // ==================================================================
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    // ==================================================================
    // Fluxo (u.1) — Corte direto (102) sem aba Transformar e redirecionamento
    // ==================================================================
    await irPara(page, '#/projeto/demo/corte/102/transformar?run=1')
    await expect(page).toHaveURL(/#\/projeto\/demo\/corte\/102\/editar\?run=1/)
    const navAbasDireto = page.getByRole('navigation', { name: 'Etapas do Corte' })
    await expect(navAbasDireto.getByRole('link', { name: 'Transformar' })).toHaveCount(0)
    await salvarCaptura('10-transformar-corte-direto-redir-1366.png')
    relatorio.push(await auditarPagina(page, 'u-corte-direto-redir', '1366x768', 'padrao'))
    await esperarToastsSumirem(page)

    // ==================================================================
    // Fluxo (u.2) — Transformar ?estado=vazio / ?estado=carregando / ?estado=erro
    // ==================================================================
    await irPara(page, '#/projeto/demo/corte/201/transformar?run=2&estado=vazio')
    await expect(page.getByText('Nenhum ângulo sugerido ainda')).toBeVisible()
    relatorio.push(await auditarPagina(page, 'u-transformar-vazio', '1366x768', 'padrao'))

    await irPara(page, '#/projeto/demo/corte/201/transformar?run=2&estado=carregando')
    await expect(page.getByRole('status', { name: /Carregando Transformação do Corte/i })).toBeVisible()
    relatorio.push(await auditarPagina(page, 'u-transformar-carregando', '1366x768', 'padrao'))

    await irPara(page, '#/projeto/demo/corte/201/transformar?run=2&estado=erro')
    await expect(page.getByRole('alert')).toBeVisible()
    await salvarCaptura('11-transformar-estado-erro-1366.png')
    relatorio.push(await auditarPagina(page, 'u-transformar-erro', '1366x768', 'padrao'))

    // ==================================================================
    // Fluxo (u.3) — Passo 1 (Ângulo): ResumoCustoPrivacidade, sugestões e ângulo manual
    // ==================================================================
    await irPara(page, '#/projeto/demo/corte/201/transformar?run=2')
    await expect(page.getByText('Nenhum ângulo sugerido ainda')).toBeVisible()

    // Aciona "Sugerir ângulos" -> <ResumoCustoPrivacidade>
    await page.getByRole('button', { name: 'Sugerir ângulos' }).click()
    const dlgCustoAngulo = page.getByRole('alertdialog')
    await expect(dlgCustoAngulo).toBeVisible()
    await expect(dlgCustoAngulo.getByLabel(/Resumo de custo e privacidade/i)).toBeVisible()
    const focoInicialCustoAngulo = await page.evaluate(
      () => document.activeElement?.textContent?.trim() || null,
    )
    await salvarCaptura('02-transformar-angulo-custo-1366.png')
    relatorio.push(await auditarPagina(page, 'u-angulo-custo-dialog', '1366x768', 'padrao'))
    await dlgCustoAngulo.getByRole('button', { name: /Confirmar e sugerir/i }).click()
    await expect(dlgCustoAngulo).toBeHidden()
    await expect(page.getByRole('heading', { name: /Sugestões do Provedor/i })).toBeVisible({
      timeout: 10_000,
    })

    // Escolhe a 1ª sugestão e valida F6 normal + F6 com Fila aberta
    await page.getByRole('button', { name: 'Escolher este ângulo' }).first().click()
    await expect(page.getByRole('region', { name: 'Ângulo escolhido' })).toBeVisible()
    await esperarToastsSumirem(page)
    await salvarCaptura('01-transformar-angulo-1366.png')
    relatorio.push(await auditarPagina(page, 'u-angulo-sugestoes-1366', '1366x768', 'padrao'))

    const regioesF6Transformar = await medirCicloF6(page, 6)
    await page.keyboard.press('Control+j')
    const asideFila = page.getByRole('complementary', { name: 'Fila de Jobs' })
    await expect(asideFila).toBeVisible()
    const regioesF6TransformarComFila = await medirCicloF6(page, 7)
    await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
    await expect(asideFila).toBeHidden()

    // Testa ângulo manual (inclusive abrindo formulário)
    await page.getByText('Escrever meu próprio ângulo').click()
    await page.getByRole('textbox', { name: /Nome do ângulo/i }).fill('Decisão sob pressão')
    await page
      .getByRole('textbox', { name: /Promessa em uma frase/i })
      .fill('Mostra por que o risco calculado definiu o placar.')
    await page.getByRole('button', { name: 'Usar meu ângulo' }).click()
    const stepper = page.getByRole('navigation', { name: 'Etapas da Transformação' })
    await expect(stepper.getByText(/Definido: Decisão sob pressão/i)).toBeVisible()

    // ==================================================================
    // Fluxo (u.4) — Passo 2 (Roteiro em blocos), troca de ângulo e trava ADR-0001
    // ==================================================================
    await page.getByRole('button', { name: /Avançar para Roteiro/i }).click()
    await expect(page.getByRole('heading', { name: /2\. Roteiro em blocos/i })).toBeVisible()
    await page.getByRole('button', { name: 'Sugerir Roteiro' }).click()
    const dlgCustoRoteiro = page.getByRole('alertdialog')
    await expect(dlgCustoRoteiro).toBeVisible()
    await dlgCustoRoteiro.getByRole('button', { name: /Confirmar e sugerir/i }).click()
    await expect(dlgCustoRoteiro).toBeHidden()
    await expect(page.getByText('Bloco 1', { exact: true })).toBeVisible({ timeout: 10_000 })

    // Volta ao Passo 1 e troca o ângulo -> angle_change_confirmation
    await stepper.getByRole('button', { name: /1\.?\s*Ângulo/i }).click()
    await page.getByRole('button', { name: 'Escolher este ângulo' }).first().click()
    const dlgTroca = page.getByRole('alertdialog')
    await expect(dlgTroca).toBeVisible()
    await dlgTroca.getByRole('button', { name: 'Trocar ângulo' }).click()
    await expect(dlgTroca).toBeHidden()

    // Passo 2 em 1440x900 (Transcrição aberta à esquerda)
    await page.setViewportSize({ width: 1440, height: 900 })
    await stepper.getByRole('button', { name: /2\.?\s*Roteiro/i }).click()
    // Força abertura do painel se o estado inicial era 1366
    const painelTransc = page.getByRole('complementary', { name: 'Transcrição do Corte' })
    if (await painelTransc.isHidden()) {
      await page.keyboard.press('Control+[')
    }
    await expect(painelTransc).toBeVisible()
    await expect(page.getByText('Desatualizado — ângulo mudou').first()).toBeVisible()
    await esperarToastsSumirem(page)
    await salvarCaptura('03-transformar-roteiro-1440.png')
    relatorio.push(await auditarPagina(page, 'u-roteiro-1440', '1440x900', 'padrao'))

    // Passo 2 em Alto Contraste 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.keyboard.press('Control+[')
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('heading', { name: /2\. Roteiro em blocos/i })).toBeVisible()
    await esperarToastsSumirem(page)
    await salvarCaptura('04-transformar-roteiro-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'u-roteiro-hc-1366', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // Passo 3 travado (ADR-0001) antes de aprovar todos os blocos
    await stepper.getByRole('button', { name: /3\.?\s*Narração/i }).click()
    await expect(page.getByText(/Narração travada/i)).toBeVisible()
    await salvarCaptura('05-transformar-narracao-travada-1366.png')
    relatorio.push(await auditarPagina(page, 'u-narracao-travada-1366', '1366x768', 'padrao'))

    // Volta ao bloco pendente e aprova todos os blocos
    await page.getByRole('button', { name: 'Voltar ao próximo bloco pendente' }).click()
    const botoesAprovar = page.getByRole('button', { name: 'Aprovar bloco' })
    const totalBlocos = await botoesAprovar.count()
    for (let i = 0; i < totalBlocos; i += 1) {
      await botoesAprovar.nth(i).click()
    }
    await expect(page.getByText('Todos os blocos aprovados — Narração liberada')).toBeVisible()

    // Edita bloco 1 e testa Ctrl+S -> volta a Pendente e re-trava Passo 3, depois reaprova
    const primeiroBloco = page.locator('ol > li[data-bloco-id]').first()
    const campoTexto1 = primeiroBloco.getByRole('textbox', { name: 'Texto da Narração' })
    await campoTexto1.fill('Texto revisado pelo editor antes de narrar.')
    await campoTexto1.press('Control+s')
    await expect(primeiroBloco.getByText('Pendente')).toBeVisible()
    await primeiroBloco.getByRole('button', { name: 'Aprovar bloco' }).click()
    await expect(page.getByText('Todos os blocos aprovados — Narração liberada')).toBeVisible()

    // ==================================================================
    // Fluxo (u.5) — Passo 3 (Narração): TTS JIT, Gravador Teleprompter, Limpeza e needs_review
    // ==================================================================
    await page.getByRole('button', { name: /Avançar para Narração/i }).click()
    await page.getByRole('button', { name: /Gerar voz de todos os blocos \(TTS\)/i }).click()
    const secaoJit = page.getByRole('region', { name: 'Instalação necessária' })
    await expect(secaoJit).toBeVisible()
    await esperarToastsSumirem(page)
    await salvarCaptura('06-transformar-narracao-jit-tts-1366.png')
    relatorio.push(await auditarPagina(page, 'u-narracao-jit-tts-1366', '1366x768', 'padrao'))

    // Conclui TTS JIT
    await secaoJit.getByRole('checkbox', { name: /Li e concordo com os termos de uso/i }).click()
    await secaoJit.getByRole('button', { name: 'Baixar e continuar' }).click()
    await expect(secaoJit).toBeHidden({ timeout: 10_000 })

    // Abre Gravador com Teleprompter
    await page.getByRole('button', { name: 'Gravar no microfone' }).first().click()
    const dlgGravador = page.getByRole('dialog', { name: /Gravar Narração/i })
    await expect(dlgGravador).toBeVisible()
    await esperarToastsSumirem(page)
    await salvarCaptura('07-transformar-narracao-gravador-1366.png')
    const auditGravador = await auditarPagina(page, 'u-narracao-gravador-1366', '1366x768', 'padrao')
    relatorio.push(auditGravador)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    const escapeFechouGravador = await dlgGravador.isHidden()
    if (!escapeFechouGravador) {
      await dlgGravador.getByRole('button', { name: 'Fechar', exact: true }).click()
    }
    await expect(dlgGravador).toBeHidden()

    // Corte V1 (202) em 1440x900: limpeza Antes/Depois + importação gerando needs_review
    await page.setViewportSize({ width: 1440, height: 900 })
    await irPara(page, '#/projeto/demo/corte/202/transformar?run=2')
    const cardBloco1 = page.getByRole('article', { name: /Bloco 1: Abertura/i })
    await expect(cardBloco1).toBeVisible()
    await cardBloco1.getByRole('radio', { name: 'Depois (limpa)' }).click()
    await expect(cardBloco1.locator('audio')).toHaveAttribute('src', /narration-clean\/2021/)

    const cardBloco2 = page.getByRole('article', { name: /Bloco 2: Virada/i })
    await cardBloco2.getByRole('button', { name: 'Importar áudio' }).click()
    const dlgImportar = page.getByRole('dialog', { name: /Importar áudio/i })
    await dlgImportar.getByRole('textbox', { name: /Arquivo de áudio/i }).fill('/audio/virada-improviso.wav')
    await dlgImportar.getByRole('button', { name: 'Importar' }).click()
    const dlgSobrescrever = page.getByRole('alertdialog')
    await dlgSobrescrever.getByRole('button', { name: 'Substituir áudio' }).click()
    await expect(cardBloco2.getByText('Revisão necessária')).toBeVisible({ timeout: 10_000 })
    await cardBloco2.scrollIntoViewIfNeeded()
    await esperarToastsSumirem(page)
    await salvarCaptura('08-transformar-narracao-limpeza-revisao-1440.png')
    relatorio.push(await auditarPagina(page, 'u-narracao-limpeza-revisao-1440', '1440x900', 'padrao'))

    // Passo 3 em Alto Contraste 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('article', { name: /Bloco 1: Abertura/i })).toBeVisible()
    await esperarToastsSumirem(page)
    await salvarCaptura('09-transformar-narracao-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'u-narracao-hc-1366', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // Verifica prefers-reduced-motion no GravadorTeleprompter (contexto isolado)
    const pageReduced = await context.newPage()
    pageReduced.on('pageerror', (e) => erros.push(e.message))
    await pageReduced.emulateMedia({ reducedMotion: 'reduce' })
    await pageReduced.setViewportSize({ width: 1366, height: 768 })
    await pageReduced.goto('http://127.0.0.1:1430/#/inicio')
    await pageReduced.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(pageReduced).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await irPara(pageReduced, '#/projeto/demo/corte/202/transformar?run=2')
    await expect(pageReduced.getByRole('article', { name: /Bloco 1: Abertura/i })).toBeVisible()
    await pageReduced.getByRole('button', { name: 'Gravar no microfone' }).first().click()
    const radioPasso = pageReduced.getByRole('dialog').getByRole('radio', { name: 'Passo' })
    const teleprompterReducedPasso = (await radioPasso.getAttribute('aria-checked')) === 'true'
    await pageReduced.close()

    // ==================================================================
    // Fluxo (v) — Empacotar (#/projeto/:id/corte/:corteId/empacotar)
    // ==================================================================
    // v.1 — ?estado=vazio, ?estado=carregando, ?estado=erro, ?estado=offline
    await irPara(page, '#/projeto/demo/corte/201/empacotar?run=2&estado=vazio')
    await expect(page.getByText('Nenhum momento de capa escolhido ainda.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sugerir Empacotamento' })).toBeVisible()
    await esperarToastsSumirem(page)
    await salvarCaptura('19-empacotar-estado-vazio-1366.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-vazio-1366', '1366x768', 'padrao'))

    await irPara(page, '#/projeto/demo/corte/201/empacotar?run=2&estado=carregando')
    await expect(page.getByRole('status', { name: /Carregando Empacotamento do Corte/i })).toBeVisible()
    relatorio.push(await auditarPagina(page, 'v-empacotar-carregando-1366', '1366x768', 'padrao'))

    await irPara(page, '#/projeto/demo/corte/201/empacotar?run=2&estado=erro')
    await expect(page.getByRole('alert')).toBeVisible()
    await salvarCaptura('20-empacotar-estado-erro-1366.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-erro-1366', '1366x768', 'padrao'))

    await irPara(page, '#/projeto/demo/corte/202/empacotar?run=2&estado=offline')
    await expect(page.getByRole('textbox', { name: 'Título' })).toBeEditable({ timeout: 10_000 })
    await esperarToastsSumirem(page)
    await salvarCaptura('18-empacotar-fonte-offline-1366.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-offline-1366', '1366x768', 'padrao'))

    // v.2 — Sugestão do Provedor com aviso de custo (<ResumoCustoPrivacidade>)
    await irPara(page, '#/projeto/demo/corte/201/empacotar?run=2&thumbnail-paid&packaging-paid')
    await expect(page.getByRole('button', { name: 'Sugerir Empacotamento' })).toBeVisible()
    await page.getByRole('button', { name: 'Sugerir Empacotamento' }).click()
    const dlgCustoPacote = page.getByRole('alertdialog')
    await expect(dlgCustoPacote).toBeVisible()
    await expect(dlgCustoPacote.getByLabel(/Resumo de custo e privacidade/i)).toBeVisible()
    const focoInicialCustoPacote = await page.evaluate(
      () => document.activeElement?.textContent?.trim() || null,
    )
    await salvarCaptura('15-empacotar-custo-provedor-1366.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-custo-dialog-1366', '1366x768', 'padrao'))
    await dlgCustoPacote.getByRole('button', { name: /Confirmar e sugerir/i }).click()
    await expect(dlgCustoPacote).toBeHidden()
    await expect(page.getByRole('textbox', { name: 'Título' })).toBeVisible({ timeout: 10_000 })

    // v.3 — Corte V1 (202) em 1366x768 padrão, F6 e WCAG 2.1.4 em campo de texto
    await irPara(page, '#/projeto/demo/corte/202/empacotar?run=2')
    const campoTitulo = page.getByRole('textbox', { name: 'Título' })
    await expect(campoTitulo).toBeVisible({ timeout: 10_000 })
    await esperarToastsSumirem(page)
    await salvarCaptura('12-empacotar-padrao-1366.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-padrao-1366', '1366x768', 'padrao'))

    // Testa WCAG 2.1.4: digitar 'j', 'k', 'l', ' ' dentro do Título não deve mover o scrubber
    const sliderCapa = page.getByRole('slider', { name: 'Instante da capa' })
    const sliderAntes = await sliderCapa.getAttribute('aria-valuenow')
    await campoTitulo.click()
    await campoTitulo.press('j')
    await campoTitulo.press('k')
    await campoTitulo.press(' ')
    const sliderDepois = await sliderCapa.getAttribute('aria-valuenow')
    const wcag214Ok = sliderAntes === sliderDepois

    // Testa F6 em Empacotar (sem e com Fila aberta)
    const regioesF6Empacotar = await medirCicloF6(page, 6)
    await page.keyboard.press('Control+j')
    await expect(asideFila).toBeVisible()
    const regioesF6EmpacotarComFila = await medirCicloF6(page, 7)
    await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
    await expect(asideFila).toBeHidden()

    // Testa scrubber + Exportar PNG
    await sliderCapa.focus()
    await sliderCapa.press('PageUp')
    await page.getByRole('button', { name: 'Usar quadro atual como capa' }).click()
    await expect(page.getByText('Escolhido por você').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Salvar capa (PNG)' }).click()
    const dlgSalvarPng = page.getByRole('dialog', { name: /Salvar capa/ })
    await dlgSalvarPng.getByRole('textbox', { name: 'Arquivo PNG da capa' }).fill('/test/exports/capa-202.png')
    await dlgSalvarPng.getByRole('button', { name: 'Salvar capa' }).click()
    await expect(page.getByText('Capa salva').first()).toBeVisible({ timeout: 10_000 })

    // v.4 — 1440x900 padrão + validadores de capítulos e Guardrails rolados
    await page.setViewportSize({ width: 1440, height: 900 })
    await irPara(page, '#/projeto/demo/corte/202/empacotar?run=2')
    await expect(page.getByRole('textbox', { name: 'Título' })).toBeVisible({ timeout: 10_000 })
    await esperarToastsSumirem(page)
    await salvarCaptura('13-empacotar-padrao-1440.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-padrao-1440', '1440x900', 'padrao'))

    // Insere capítulo sem 00:00 para exibir validador não bloqueante e rola até Guardrails
    const campoDesc = page.getByRole('textbox', { name: 'Descrição' })
    await campoDesc.fill(
      'Texto do usuário.\n\n--- Capítulos ---\n00:05 Introdução\n00:20 Meio\n00:40 Fim\n--- Fim dos capítulos ---',
    )
    const secaoGuardrails = page.getByRole('heading', { name: 'Guardrails e saída' })
    await secaoGuardrails.scrollIntoViewIfNeeded()
    await esperarToastsSumirem(page)
    await salvarCaptura('16-empacotar-validadores-guardrails-1440.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-guardrails-1440', '1440x900', 'padrao'))

    // v.5 — Alto contraste 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('textbox', { name: 'Título' })).toBeVisible({ timeout: 10_000 })
    await esperarToastsSumirem(page)
    await salvarCaptura('14-empacotar-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-hc-1366', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // v.6 — Fonte sem Permissão (202?packaging-nopermission) + Corte direto (102) com ciência de monetização
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await irPara(page, '#/projeto/demo/corte/202/empacotar?run=2&packaging-nopermission')
    const alertaSemPerm = page.getByText(/sem Permissão registrada: nenhum crédito será incluído/i)
    await expect(alertaSemPerm).toBeVisible({ timeout: 10_000 })
    await alertaSemPerm.scrollIntoViewIfNeeded()
    await esperarToastsSumirem(page)
    await salvarCaptura('17-empacotar-sem-permissao-1366.png')
    relatorio.push(await auditarPagina(page, 'v-empacotar-noperm-1366', '1366x768', 'padrao'))

    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await irPara(page, '#/projeto/demo/corte/102/empacotar?run=1')
    const cienciaDireto = page.getByRole('checkbox', { name: /Sei que Corte direto/ })
    await expect(cienciaDireto).toBeVisible({ timeout: 10_000 })
    await cienciaDireto.scrollIntoViewIfNeeded()
    relatorio.push(await auditarPagina(page, 'v-empacotar-direto-1366', '1366x768', 'padrao'))

    checksExtras.onda5 = {
      focoInicialCustoAngulo,
      focoInicialCustoPacote,
      regioesF6Transformar,
      regioesF6TransformarComFila,
      regioesF6Empacotar,
      regioesF6EmpacotarComFila,
      teleprompterReducedPasso,
      escapeFechouGravador,
      wcag214Ok,
    }

    const jsonRelatorio = JSON.stringify(
      {
        erros,
        checksExtras,
        relatorio,
      },
      null,
      2,
    )
    await testInfo.attach('ui-onda5-audit.json', {
      body: jsonRelatorio,
      contentType: 'application/json',
    })
    console.log('UI_ONDA5_AUDIT_SUMMARY=' + jsonRelatorio)

    expect(erros).toEqual([])
  })
})
