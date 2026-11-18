import { expect, test, type Page } from '@playwright/test'

declare const process: { env: Record<string, string | undefined> }

const CAPTURAS_DIR = '../docs/produto/front-v2/ui/capturas/onda-3'

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

    const botoesPrimariosSinal = Array.from(document.querySelectorAll('button.bg-sinal')).filter(
      visivel,
    ).length

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

test.describe('Avaliação UI independente — Onda 3 (Seleção e Bancada de Revisão)', () => {
  test.skip(
    !process.env.UI_BASELINE,
    'Execução manual de avaliação UI Onda 3 (defina UI_BASELINE=1)',
  )

  test('percorre fluxos (i)-(l) em 1366x768 e 1440x900, tema padrão e alto contraste', async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000)

    // Controlador leve apenas para segurar timers curtos de mock (15-35ms) ao capturar estados "running"
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

    // ------------------------------------------------------------------
    // Fluxo (i): Configurador de Seleção (#/projeto/:id/cortes)
    // ------------------------------------------------------------------
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

    await page.getByRole('link', { name: 'Cortes' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Seleção de Cortes' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Corte direto/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await salvarCaptura('01-selecao-config-1366.png')
    relatorio.push(await auditarPagina(page, 'i-selecao-config', '1366x768', 'padrao'))

    // Testa F6 em C.1
    const regiaoC1Antes = await page.evaluate(
      () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
    )
    await page.keyboard.press('F6')
    const regiaoC1Depois = await page.evaluate(
      () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
    )
    checksExtras.f6Selecao = { regiaoC1Antes, regiaoC1Depois }

    // Alterna Tipo de vídeo via teclado (ArrowRight) para Vídeo transformado + altera duração 30-90 + mede energia + busca chat
    const radioDireto = page.getByRole('radio', { name: /Corte direto/i })
    await radioDireto.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: /Vídeo transformado/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByText('Sobrescrito só para esta execução')).toBeVisible()
    await expect(page.getByText(/Espaço para comentário \(30%\)/)).toBeVisible()

    await page.getByLabel(/Duração mínima/i).fill('30')
    await page.getByLabel(/Duração máxima/i).fill('90')
    await expect(page.getByText(/acima de 60 s/i)).toBeVisible()

    await page.getByRole('button', { name: 'Medir energia do áudio' }).click()
    await expect(page.getByText(/4 altas · 2 picos/i)).toBeVisible()
    await page.getByRole('button', { name: 'Buscar chat da live' }).click()
    await expect(page.getByText(/Disponível: 3 picos/i)).toBeVisible()

    await salvarCaptura('02-selecao-transformado-sinais-1366.png')
    relatorio.push(await auditarPagina(page, 'i-selecao-transformado-sinais', '1366x768', 'padrao'))

    // Validação inline (min >= max) + Restaurar padrão + ConfirmDialog de custo antes de ação externa
    await page.getByLabel(/Duração mínima/i).fill('100')
    await expect(
      page.getByText('A duração mínima deve ser menor que a duração máxima.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Selecionar Cortes' })).toBeDisabled()
    await page.getByRole('button', { name: /Restaurar padrão do canal/i }).click()
    await expect(page.getByLabel(/Duração mínima/i)).toHaveValue('20')
    await expect(page.getByLabel(/Duração máxima/i)).toHaveValue('60')

    await page.getByRole('button', { name: 'Selecionar Cortes' }).click()
    const dlgConfirm = page.getByRole('alertdialog')
    await expect(dlgConfirm).toBeVisible()
    await expect(dlgConfirm.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await salvarCaptura('03-selecao-custo-dialog-1366.png')
    relatorio.push(await auditarPagina(page, 'i-selecao-custo-dialog', '1366x768', 'padrao'))
    await dlgConfirm.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgConfirm).toBeHidden()

    // 1440x900 + troca para Fonte offline.mp4 no Select (mostra aviso offline + execução existente sem piscar semPerfilConfigurado)
    await page.setViewportSize({ width: 1440, height: 900 })
    const cols1440 = await page
      .locator('section[aria-label="Janelas de seleção"] ul[role="list"]')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    checksExtras.janelasCols1440 = cols1440

    await page.getByRole('combobox', { name: /Fonte transcrita/i }).click()
    await page.getByRole('option', { name: /offline\.mp4/i }).click()
    await expect(page.getByText('Fonte offline no disco')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /Execução #3/i })).toBeVisible()
    await expect(
      page.getByText(/Configure um Perfil de Provedor para selecionar Cortes/i),
    ).toHaveCount(0)
    await salvarCaptura('04-selecao-fonte-offline-1440.png')
    relatorio.push(await auditarPagina(page, 'i-selecao-fonte-offline', '1440x900', 'padrao'))

    // Volta para Live_12_11_final.mp4 em 1366x768 e testa Alto Contraste
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.getByRole('combobox', { name: /Fonte transcrita/i }).click()
    await page.getByRole('option', { name: /Live_12_11_final\.mp4/i }).click()
    await expect(page.getByText('Disponível no disco').first()).toBeVisible()

    await alternarAltoContraste(page, true)
    await expect(page.getByRole('heading', { level: 1, name: 'Seleção de Cortes' })).toBeVisible()
    await salvarCaptura('05-selecao-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'i-selecao-hc', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // ------------------------------------------------------------------
    // Fluxo (j): Acompanhamento de Seleção (progresso, cancelar, uncertain, redo)
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      ;(window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers = true
    })
    await page.getByRole('button', { name: 'Selecionar Cortes' }).click()
    await expect(dlgConfirm).toBeVisible()
    await dlgConfirm.getByRole('button', { name: 'Confirmar e selecionar Cortes' }).click()
    await expect(dlgConfirm).toBeHidden()
    await expect(page.getByRole('button', { name: 'Cancelar seleção' })).toBeVisible()
    await salvarCaptura('06-acompanhamento-progresso-1366.png')
    relatorio.push(await auditarPagina(page, 'j-acompanhamento-progresso', '1366x768', 'padrao'))

    // Cancela seleção paga em andamento -> ConfirmDialog -> vira parcial
    await page.getByRole('button', { name: 'Cancelar seleção' }).click()
    const dlgCancelRun = page.getByRole('alertdialog')
    await expect(dlgCancelRun).toBeVisible()
    await expect(dlgCancelRun.getByRole('button', { name: 'Voltar' })).toBeFocused()
    await dlgCancelRun.getByRole('button', { name: 'Cancelar seleção' }).click()
    await expect(dlgCancelRun).toBeHidden()
    await expect(page.getByText(/Seleção parcial:/i)).toBeVisible()
    await page.evaluate(() => {
      ;(window as unknown as { __releaseMockTimers?: () => void }).__releaseMockTimers?.()
    })

    // ?estado=parcial -> janela uncertain (#290) + Retomar bloqueado + DialogoResolverIncerteza
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?run=1&estado=parcial'
    })
    const bannerIncerta = page.getByRole('alert')
    await expect(bannerIncerta).toContainText(/Chamada paga incerta/i)
    const btnRetomar = page.getByRole('button', { name: 'Retomar janelas pendentes' })
    await expect(btnRetomar).toBeDisabled()
    await btnRetomar.hover()
    await expect(
      page.getByText(/Há janela incerta nesta execução; resolva na Fila antes de retomar\./i),
    ).toBeVisible()
    await salvarCaptura('07-acompanhamento-uncertain-1366.png')
    relatorio.push(await auditarPagina(page, 'j-acompanhamento-uncertain', '1366x768', 'padrao'))

    await bannerIncerta.getByRole('button', { name: 'Resolver na Fila' }).click()
    const dlgIncerteza = page.getByRole('alertdialog')
    await expect(dlgIncerteza).toBeVisible()
    await expect(dlgIncerteza.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await salvarCaptura('08-acompanhamento-resolver-incerteza-1366.png')
    relatorio.push(
      await auditarPagina(page, 'j-acompanhamento-resolver-incerteza', '1366x768', 'padrao'),
    )
    await dlgIncerteza.getByRole('button', { name: 'Descartar chamada' }).click()
    await expect(dlgIncerteza).toBeHidden()

    // Alterna Revisão + abre SeletorPerfilRedo em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?run=1'
    })
    const tablistRev = page.getByRole('tablist', { name: /Revisão da execução/i })
    await tablistRev.getByRole('tab', { name: /Rev\. 1/i }).click()
    await expect(page).toHaveURL(/rev=1/)
    await tablistRev.getByRole('tab', { name: /Rev\. 2/i }).click()
    await expect(page).toHaveURL(/rev=2/)

    await page
      .locator('section[aria-label="Resumo da execução"]')
      .getByRole('button', { name: /Refazer com outro Perfil/i })
      .click()
    const dlgRedo = page.getByRole('alertdialog')
    await expect(dlgRedo).toBeVisible()
    await expect(dlgRedo.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await expect(dlgRedo.getByRole('combobox', { name: /Novo Perfil de Provedor/i })).toBeVisible()
    await salvarCaptura('09-acompanhamento-redo-perfil-1440.png')
    relatorio.push(await auditarPagina(page, 'j-acompanhamento-redo-perfil', '1440x900', 'padrao'))
    await dlgRedo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgRedo).toBeHidden()

    // ------------------------------------------------------------------
    // Fluxo (k): Bancada de Revisão (#/projeto/:id/cortes/revisao/:runId)
    // ------------------------------------------------------------------
    await page.setViewportSize({ width: 1366, height: 768 })
    // Inicia nova sessão limpa para observar proxy em andamento (jobId 7 ainda não concluído) e limpar estado parcial/cancelado anterior
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await page.evaluate(() => {
      ;(window as unknown as { __holdMockTimers?: boolean }).__holdMockTimers = true
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(page.getByRole('heading', { level: 1, name: /Execução #1/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancelar preview' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Aprovar|Aprovado/i })).toBeEnabled()
    await salvarCaptura('11-revisao-proxy-progresso-1366.png')
    relatorio.push(await auditarPagina(page, 'k-revisao-proxy-progresso', '1366x768', 'padrao'))
    await page.getByRole('button', { name: 'Cancelar preview' }).click()
    await expect(page.getByText('Preview 9:16 cancelado.')).toBeVisible()
    await page.evaluate(() => {
      ;(window as unknown as { __releaseMockTimers?: () => void }).__releaseMockTimers?.()
    })
    await page.getByRole('button', { name: 'Gerar preview novamente' }).click()
    await expect(page.getByRole('img', { name: 'Quadro do Corte' })).toBeVisible()
    await salvarCaptura('10-revisao-bancada-1366.png')
    relatorio.push(await auditarPagina(page, 'k-revisao-bancada', '1366x768', 'padrao'))

    const listbox = page.getByRole('listbox', { name: /Candidatos a Corte/i })
    await listbox.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('heading', { level: 2, name: 'Sem título' })).toBeVisible()

    // Volta ao candidato 101, testa filtros/ordenação, expande eixos, ajusta bordas I/O, aprova (A) + Guardrails
    await listbox.focus()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeVisible()

    await page.getByRole('combobox', { name: /Ordenar candidatos/i }).click()
    await page.getByRole('option', { name: 'Ordem na Fonte' }).click()
    await page.getByRole('combobox', { name: /Ordenar candidatos/i }).click()
    await page.getByRole('option', { name: 'Maior Nota' }).click()

    await page.getByRole('button', { name: /Ver os 5 eixos/i }).click()
    await expect(page.getByRole('button', { name: /Ocultar eixos/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await listbox.focus()
    await page.keyboard.press('o')
    await expect(page.getByText('Última frase 13 do Corte.')).toBeVisible()
    await page.keyboard.press('i')
    await expect(page.getByText('Primeira frase 9 do Corte.')).toBeVisible()
    await page.keyboard.press('a')
    await expect(page.getByRole('button', { name: 'Aprovado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(
      page.getByRole('checkbox', {
        name: /Sei que Corte direto pode não monetizar por conteúdo reutilizado/i,
      }),
    ).toBeVisible()
    await salvarCaptura('12-revisao-eixos-bordas-aprovado-1366.png')
    relatorio.push(
      await auditarPagina(page, 'k-revisao-eixos-bordas-aprovado', '1366x768', 'padrao'),
    )

    // Transporte: J/L/←/→/Espaço/K + respeito a campos de texto (Paleta Ctrl+K) + Ctrl+Z
    const tempoAntes = await page
      .locator('[aria-label^="Posição "]')
      .getAttribute('aria-label')
    await listbox.focus()
    await page.keyboard.press('l')
    const tempoDepoisL = await page
      .locator('[aria-label^="Posição "]')
      .getAttribute('aria-label')
    await page.keyboard.press('ArrowRight')
    const tempoDepoisSeta = await page
      .locator('[aria-label^="Posição "]')
      .getAttribute('aria-label')
    await page.keyboard.press('j')
    const tempoDepoisJ = await page
      .locator('[aria-label^="Posição "]')
      .getAttribute('aria-label')
    await page.keyboard.press('Space')
    const rotuloPausar = await page
      .getByRole('toolbar', { name: 'Controles de reprodução' })
      .getByRole('button', { name: /Pausar|Reproduzir/i })
      .getAttribute('aria-label')
    await page.keyboard.press('k')

    // Abre Paleta (Ctrl+K) e digita "ariokjl " no input para provar que teclas únicas são ignoradas em campos de texto
    await page.keyboard.press('Control+k')
    const inputPaleta = page.locator('[cmdk-input]')
    await expect(inputPaleta).toBeVisible()
    await inputPaleta.fill('ariljk ')
    await expect(inputPaleta).toHaveValue('ariljk ')
    await page.keyboard.press('Escape')
    await expect(inputPaleta).toBeHidden()
    // Desfaz aprovação e depois ajuste com Ctrl+Z
    await page.keyboard.press('Control+z')
    await expect(page.getByRole('button', { name: 'Aprovar' })).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect(page.getByText('Primeira frase 10 do Corte.')).toBeVisible()

    // Testa F6 em C.2
    await listbox.focus()
    await page.keyboard.press('F6')
    const f6FocoDepois = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 30) || '',
    )

    // Testa WCAG 2.1.4 (modoTeclasUnicas = 'alt') e verifica se <Kbd> na Bancada acompanha
    await page.evaluate(() => {
      window.location.hash = '#/config/aparencia'
    })
    await page.getByRole('radio', { name: /Exigir modificador Alt \+ tecla/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(page.getByRole('heading', { level: 1, name: /Execução #1/i })).toBeVisible()
    const kbdLabelsAltMode = await page
      .locator('section[aria-label="Detalhe do Corte"] kbd')
      .allInnerTexts()
    await page.keyboard.press('r')
    const statusAposRComAltMode = await page
      .locator('section[aria-label="Detalhe do Corte"]')
      .getByRole('button', { name: /Aprovado|Aprovar/i })
      .getAttribute('aria-pressed')
    // Restaura teclas únicas ativas
    await page.evaluate(() => {
      window.location.hash = '#/config/aparencia'
    })
    await page.getByRole('radio', { name: /Ativos fora de campos de texto/i }).click()

    checksExtras.atalhosRevisao = {
      tempoAntes,
      tempoDepoisL,
      tempoDepoisSeta,
      tempoDepoisJ,
      rotuloPausar,
      f6FocoDepois,
      kbdLabelsAltMode,
      statusAposRComAltMode,
    }

    // 1440x900 + Vídeo transformado (Espaço para comentário 30% em 1º + próximo passo Transformar)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?cenario-transformed=1#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(
      page.getByRole('region', { name: /Detalhe do Corte/i }).getByText('Vídeo transformado'),
    ).toBeVisible()
    await page.getByRole('button', { name: /Ver os 6 eixos/i }).click()
    await page.keyboard.press('a')
    await expect(
      page.getByText(/Próximo passo no Editor: escolher Ângulo → aprovar Roteiro → gerar Narração/i),
    ).toBeVisible()
    await salvarCaptura('13-revisao-transformado-1440.png')
    relatorio.push(await auditarPagina(page, 'k-revisao-transformado', '1440x900', 'padrao'))

    // Alto contraste na Bancada (1366x768)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    await expect(page.getByRole('heading', { level: 1, name: /Execução #1/i })).toBeVisible()
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('heading', { level: 1, name: /Execução #1/i })).toBeVisible()
    await salvarCaptura('14-revisao-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'k-revisao-hc', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // ------------------------------------------------------------------
    // Fluxo (l): Estados de erro e vazios
    // ------------------------------------------------------------------
    // l.1: Erro Somente local em Seleção (?estado=erro)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?estado=erro'
    })
    await expect(page.getByRole('alert')).toContainText(/Somente local/i)
    await salvarCaptura('15-erro-selecao-local-only-1366.png')
    relatorio.push(await auditarPagina(page, 'l-erro-selecao-local-only', '1366x768', 'padrao'))

    // l.2: Contexto insuficiente (?selection-blocked=1 sem assistant-test)
    await page.goto('/?selection-blocked=1#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes'
    })
    await expect(
      page.getByText(/Configure um Perfil de Provedor para selecionar Cortes|Reduzir duração máxima/i),
    ).toBeVisible()
    await salvarCaptura('16-erro-selecao-contexto-1366.png')
    relatorio.push(await auditarPagina(page, 'l-erro-selecao-contexto', '1366x768', 'padrao'))

    // l.3: Vazio sem Fontes transcritas (?estado=vazio) — limpa ?selection-blocked=1 antes
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?estado=vazio'
    })
    await expect(page.getByText('Nenhuma Fonte transcrita ainda')).toBeVisible()
    await salvarCaptura('17-vazio-selecao-sem-fontes-1366.png')
    relatorio.push(await auditarPagina(page, 'l-vazio-selecao-sem-fontes', '1366x768', 'padrao'))

    // l.4: Filtro zerado na Bancada
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1'
    })
    const sliderNota = page.getByRole('slider', { name: /Nota mínima/i })
    await sliderNota.focus()
    await page.keyboard.press('End')
    await expect(page.getByText('Nenhum candidato corresponde aos filtros atuais')).toBeVisible()
    await salvarCaptura('18-vazio-revisao-filtro-zerado-1366.png')
    relatorio.push(
      await auditarPagina(page, 'l-vazio-revisao-filtro-zerado', '1366x768', 'padrao'),
    )
    await page.getByRole('button', { name: 'Limpar filtros' }).click()

    // l.5: Execução sem candidatos (?estado=vazio na Bancada)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1?estado=vazio'
    })
    await expect(page.getByText('Nenhum candidato gerado nesta execução')).toBeVisible()
    await salvarCaptura('19-vazio-revisao-sem-candidatos-1366.png')
    relatorio.push(
      await auditarPagina(page, 'l-vazio-revisao-sem-candidatos', '1366x768', 'padrao'),
    )

    // l.6: Proxy falhou / Fonte offline na Bancada (execução sobre Fonte 2 offline.mp4)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?fonte=2'
    })
    await expect(page.getByText('Fonte offline no disco')).toBeVisible()
    const btnSelecionarOffline = page.getByRole('button', { name: 'Selecionar Cortes', exact: true })
    await expect(btnSelecionarOffline).toBeEnabled()
    await btnSelecionarOffline.click()
    await expect(dlgConfirm).toBeVisible()
    await dlgConfirm.getByRole('button', { name: 'Confirmar e selecionar Cortes' }).click()
    await expect(dlgConfirm).toBeHidden()
    const btnAbrirBancadaOffline = page.getByRole('button', { name: /Abrir bancada de revisão/i })
    await expect(btnAbrirBancadaOffline).toBeEnabled()
    await btnAbrirBancadaOffline.click()
    await expect(page.getByText(/O arquivo da Fonte foi movido ou alterado/i)).toBeVisible()
    await salvarCaptura('20-erro-revisao-proxy-offline-1366.png')
    relatorio.push(
      await auditarPagina(page, 'l-erro-revisao-proxy-offline', '1366x768', 'padrao'),
    )

    // l.7: Erro fatal na Bancada (?estado=erro)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes/revisao/1?estado=erro'
    })
    await expect(page.getByRole('alert')).toContainText(/Somente local/i)
    await salvarCaptura('21-erro-revisao-fatal-1366.png')
    relatorio.push(await auditarPagina(page, 'l-erro-revisao-fatal', '1366x768', 'padrao'))

    const jsonRelatorio = JSON.stringify(
      {
        erros,
        checksExtras,
        relatorio,
      },
      null,
      2,
    )
    await testInfo.attach('ui-onda3-audit.json', {
      body: jsonRelatorio,
      contentType: 'application/json',
    })

    expect(erros).toEqual([])
  })
})
