import { expect, test, type Page } from '@playwright/test'

declare const process: { env: Record<string, string | undefined> }

const CAPTURAS_DIR = '../docs/produto/front-v2/ui/capturas/onda-6'

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
    const matchesEntidade = bodyText.match(/(?:Lote|job|Fonte|tarefa|incerta|Execução|Corte)\s+#\d+\b/gi)
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
  await page.waitForTimeout(200)
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

test.describe('Avaliação UI independente — Onda 6 (Exportação, Fila, Relatos e Sobre)', () => {
  test.skip(
    !process.env.UI_BASELINE,
    'Execução manual de avaliação UI Onda 6 (defina UI_BASELINE=1)',
  )

  test('percorre fluxos (q)-(t) em 1366x768 e 1440x900, tema padrão e alto contraste', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000)

    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    const relatorio: AchadoDom[] = []
    const checksExtras: Record<string, unknown> = {}
    const salvarCaptura = async (nome: string) => {
      await page.screenshot({ path: `${CAPTURAS_DIR}/${nome}`, animations: 'disabled' })
    }

    // ==================================================================
    // Fluxo (t.0) + (r.0) — Sem Projeto aberto (#/inicio + Ctrl+J)
    // ==================================================================
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()

    const gatilhoFilaInicio = page.getByRole('button', { name: /Fila de jobs:/i })
    await gatilhoFilaInicio.focus()
    await page.keyboard.press('Control+j')
    const asideFila = page.getByRole('complementary', { name: 'Fila de Jobs' })
    await expect(asideFila).toBeVisible()
    await expect(asideFila.getByText('Nenhum Projeto aberto')).toBeVisible()
    await salvarCaptura('24-estado-fila-sem-projeto-1366.png')
    const auditFilaSemProj = await auditarPagina(page, 't-fila-sem-projeto', '1366x768', 'padrao')
    relatorio.push(auditFilaSemProj)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const escapeFechouAposTab = await asideFila.isHidden()
    if (!escapeFechouAposTab) {
      await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
    }
    await expect(asideFila).toBeHidden()
    const focoRetornoFila = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || null,
    )
    checksExtras.filaSemProjeto = {
      focoAposTab: auditFilaSemProj.focusOutlineTeste,
      escapeFechouAposTab,
      focoRetornoFila,
    }

    // ==================================================================
    // Abre Projeto Demo -> Exportação (q)
    // ==================================================================
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await page.getByRole('link', { name: /Exportação/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Exportação' })).toBeVisible()
    await expect(page.getByRole('article').first()).toBeVisible()

    // Verifica "Atualizar prontidão em lote", cards direto × transformado, filtro Fonte e paginação
    const btnAtualizarProntidao = page.getByRole('button', { name: /Atualizar prontidão em lote/i })
    await expect(btnAtualizarProntidao).toBeEnabled()
    await btnAtualizarProntidao.click()
    await expect(page.getByRole('article').first()).toBeVisible()

    const qtdCardsTotal = await page.getByRole('article').count()
    const temCarregarMais = await page.getByRole('button', { name: /Carregar mais Cortes/i }).count()
    const diretoCount = await page.getByText('Corte direto').count()
    const transformadoCount = await page.getByText('Vídeo transformado').count()

    // Testa F6 em Exportação (fechado e com Fila aberta)
    const regioesF6Exportacao = await medirCicloF6(page, 6)
    await page.keyboard.press('Control+j')
    await expect(asideFila).toBeVisible()
    const regioesF6ExportacaoComFila = await medirCicloF6(page, 7)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const escapeFechouExportFila = await asideFila.isHidden()
    if (!escapeFechouExportFila) {
      await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
    }
    await expect(asideFila).toBeHidden()

    await salvarCaptura('01-exportacao-prontidao-1366.png')
    relatorio.push(await auditarPagina(page, 'q-exportacao-prontidao-1366', '1366x768', 'padrao'))

    // Filtro por Fonte (incl. offline.mp4)
    await page.getByRole('combobox', { name: /Filtrar por Fonte/i }).click()
    await page.getByRole('option', { name: 'offline.mp4' }).click()
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByText(/Fonte offline/i).first()).toBeVisible()
    const avisoOfflineZonaB = await page.getByText(/Fonte offline ou alterada e falharão/i).isVisible()
    await page.getByRole('combobox', { name: /Filtrar por Fonte/i }).click()
    await page.getByRole('option', { name: 'Todas as Fontes' }).click()
    await expect(page.getByRole('article').first()).toBeVisible()

    // 1440x900 Mesa de Prontidão
    await page.setViewportSize({ width: 1440, height: 900 })
    await salvarCaptura('02-exportacao-prontidao-1440.png')
    relatorio.push(await auditarPagina(page, 'q-exportacao-prontidao-1440', '1440x900', 'padrao'))

    // Alto contraste em Mesa de Prontidão 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('article').first()).toBeVisible()
    await salvarCaptura('03-exportacao-prontidao-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'q-exportacao-prontidao-hc', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // Disparo com ?estado=fallback e pasta /test/conflitos:
    // 1) Aviso monetização direta -> 2) Conflitos de sobrescrita -> 3) Lote em progresso -> 4) Cancelar / Concluir
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=fallback'
    })
    await expect(page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i })).toBeEnabled()
    await page.getByRole('textbox', { name: /Pasta de saída/i }).fill('/test/conflitos')
    await page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i }).click()

    const dlgDireto = page.getByRole('alertdialog')
    await expect(dlgDireto).toBeVisible()
    const focoInicialDlgDireto = await page.evaluate(
      () => document.activeElement?.textContent?.trim() || null,
    )
    await salvarCaptura('04-exportacao-aviso-direto-1366.png')
    relatorio.push(await auditarPagina(page, 'q-exportacao-aviso-direto', '1366x768', 'padrao'))
    await dlgDireto.getByRole('button', { name: /Entendi e continuar/i }).click()

    const dlgConflitos = page.getByRole('alertdialog')
    await expect(dlgConflitos).toBeVisible()
    await expect(dlgConflitos).toContainText('changed-01-01m30s.mp4')
    const focoInicialDlgConflitos = await page.evaluate(
      () => document.activeElement?.textContent?.trim() || null,
    )
    await salvarCaptura('05-exportacao-conflitos-dialog-1366.png')
    relatorio.push(await auditarPagina(page, 'q-exportacao-conflitos', '1366x768', 'padrao'))

    await dlgConflitos.getByRole('button', { name: /Sobrescrever e exportar/i }).click()
    await expect(dlgConflitos).toBeHidden()
    await expect(page).toHaveURL(/#\/projeto\/demo\/exportacao\?sub=lotes/)
    await expect(page.getByText('Caiu para x264').first()).toBeVisible({ timeout: 5000 })
    await esperarToastsSumirem(page)

    // Histórico de lotes parcial (#6399) + filtro "Mostrar apenas falhas" em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: /Lote #6399/i }).click()
    await expect(
      page.getByText(/Lote concluído parcialmente: 2 de 3 Cortes exportados e 1 com falha/i),
    ).toBeVisible()
    await page.getByRole('button', { name: /Mostrar apenas falhas/i }).click()
    await expect(page.getByRole('grid')).toContainText('Resumo final do jogo')
    await page.getByRole('button', { name: /Mostrar todos os itens/i }).click()
    await salvarCaptura('07-exportacao-lote-parcial-falhas-1440.png')
    relatorio.push(await auditarPagina(page, 'q-exportacao-lote-parcial-1440', '1440x900', 'padrao'))

    // Alto contraste em Histórico de Lotes 1440x900
    await alternarAltoContraste(page, true)
    await expect(page.getByRole('button', { name: /Lote #6399/i })).toBeVisible()
    await salvarCaptura('08-exportacao-lotes-hc-1440.png')
    relatorio.push(await auditarPagina(page, 'q-exportacao-lotes-hc', '1440x900', 'high'))
    await alternarAltoContraste(page, false)

    // Progresso em tempo real e cancelamento de lote via clock sintético em 1366x768 (contexto isolado para não pausar timers da página principal)
    const clockContext = await browser.newContext()
    const pageClock = await clockContext.newPage()
    pageClock.on('pageerror', (e) => erros.push(e.message))
    await pageClock.setViewportSize({ width: 1366, height: 768 })
    await pageClock.goto('http://127.0.0.1:1430/#/inicio')
    await pageClock.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(pageClock).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await pageClock.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao'
    })
    await expect(pageClock.getByRole('button', { name: /Exportar \d+ aprovados em lote/i })).toBeEnabled()
    await pageClock.clock.install()
    await pageClock.clock.pauseAt(Date.now())
    await pageClock.getByRole('button', { name: /Exportar \d+ aprovados em lote/i }).click()
    await pageClock.clock.runFor(20)
    const dlgDiretoClock = pageClock.getByRole('alertdialog')
    if (await dlgDiretoClock.isVisible()) {
      await dlgDiretoClock.getByRole('button', { name: /Entendi e continuar/i }).click()
      await pageClock.clock.runFor(40)
    }
    await expect(pageClock).toHaveURL(/#\/projeto\/demo\/exportacao\?sub=lotes$/)
    await pageClock.clock.runFor(100)
    await expect(pageClock.getByRole('grid')).toContainText('Exportando')
    await pageClock.screenshot({
      path: `${CAPTURAS_DIR}/06-exportacao-lote-progresso-1366.png`,
      animations: 'disabled',
    })
    relatorio.push(await auditarPagina(pageClock, 'q-exportacao-lote-progresso', '1366x768', 'padrao'))

    await pageClock.getByRole('button', { name: 'Cancelar lote' }).click()
    await pageClock.clock.runFor(20)
    const dlgCancelarLote = pageClock.getByRole('alertdialog')
    await expect(dlgCancelarLote).toBeVisible()
    await dlgCancelarLote.getByRole('button', { name: 'Cancelar lote' }).click()
    await pageClock.clock.runFor(60)
    await expect(dlgCancelarLote).toBeHidden()
    await expect(pageClock.getByRole('region', { name: 'Lista de lotes exportados' })).toContainText(
      'Cancelado',
    )
    await clockContext.close()

    checksExtras.exportacao = {
      qtdCardsTotal,
      temCarregarMais,
      diretoCount,
      transformadoCount,
      avisoOfflineZonaB,
      focoInicialDlgDireto,
      focoInicialDlgConflitos,
      regioesF6Exportacao,
      regioesF6ExportacaoComFila,
      escapeFechouExportFila,
    }

    // ==================================================================
    // Fluxo (r) — Painel Global da Fila de Jobs (Ctrl+J)
    // ==================================================================
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await page.getByRole('link', { name: 'Cortes' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)

    // Captura toast "Abrir Fila" disparado pelo mock ao iniciar seleção/export ou evento
    await page.keyboard.press('Control+j')
    await expect(asideFila).toBeVisible()
    await expect(
      asideFila.getByText(/O Clipes nunca as repete automaticamente para evitar cobrança dupla/i),
    ).toBeVisible()

    // Verifica F6 no shell com Fila aberta em Cortes
    const regioesF6CortesComFila = await medirCicloF6(page, 6)
    await expect(asideFila).toBeVisible()

    await salvarCaptura('09-fila-jobs-aberta-1366.png')
    relatorio.push(await auditarPagina(page, 'r-fila-aberta-1366', '1366x768', 'padrao'))

    // Testa filtros na Fila (Ativos, Atenção, Concluídos, Todos)
    await asideFila.getByRole('tab', { name: /Atenção/i }).click()
    await expect(asideFila.getByTestId('fila-job-2')).toBeVisible()
    await asideFila.getByRole('tab', { name: /Todos/i }).click()

    // 1440x900 Fila aberta
    await page.setViewportSize({ width: 1440, height: 900 })
    await salvarCaptura('10-fila-jobs-1440.png')
    relatorio.push(await auditarPagina(page, 'r-fila-aberta-1440', '1440x900', 'padrao'))

    // Alto contraste na Fila 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await alternarAltoContraste(page, true)
    if (!(await asideFila.isVisible())) {
      await page.keyboard.press('Control+j')
    }
    await expect(asideFila).toBeVisible()
    await salvarCaptura('11-fila-jobs-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'r-fila-hc', '1366x768', 'high'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    if (!(await asideFila.isHidden())) {
      await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
    }
    await expect(asideFila).toBeHidden()
    await alternarAltoContraste(page, false)
    if (!(await asideFila.isVisible())) {
      await page.keyboard.press('Control+j')
    }
    await expect(asideFila).toBeVisible()

    // Diálogo Retry (jobs.estimate -> ResumoCustoPrivacidade)
    await asideFila.getByTestId('fila-job-2').getByRole('button', { name: 'Ver estimativa e repetir' }).click()
    const dlgRetry = page.getByRole('alertdialog', { name: /Repetir tarefa #2/i })
    await expect(dlgRetry).toBeVisible()
    await expect(dlgRetry.getByRole('region', { name: /Resumo de custo e privacidade/i })).toBeVisible()
    const focoInicialRetry = await page.evaluate(
      () => document.activeElement?.textContent?.trim() || null,
    )
    await salvarCaptura('12-fila-dialog-retry-custo-1366.png')
    relatorio.push(await auditarPagina(page, 'r-fila-dialog-retry', '1366x768', 'padrao'))
    await dlgRetry.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgRetry).toBeHidden()

    // Diálogo Ajustar orçamento (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 })
    await asideFila.getByRole('button', { name: /Ajustar orçamento e continuar/i }).click()
    const dlgOrc = page.getByRole('dialog', { name: /Ajustar orçamento e continuar fila/i })
    await expect(dlgOrc).toBeVisible()
    await salvarCaptura('13-fila-dialog-orcamento-1440.png')
    relatorio.push(await auditarPagina(page, 'r-fila-dialog-orcamento', '1440x900', 'padrao'))
    await dlgOrc.getByRole('checkbox', { name: /preço conhecido/i }).click()
    await dlgOrc.getByRole('button', { name: /Salvar orçamento e retomar fila/i }).click()
    await expect(dlgOrc).toBeHidden()

    // Diálogo Resultado (#4) + Descartar (#2) + Refazer com outro Perfil (#2)
    await page.setViewportSize({ width: 1366, height: 768 })
    await asideFila.getByTestId('fila-job-4').getByRole('button', { name: 'Ver resultado' }).click()
    const dlgResult = page.getByRole('dialog', { name: /Resultado do job #4/i })
    await expect(dlgResult).toBeVisible()
    relatorio.push(await auditarPagina(page, 'r-fila-dialog-resultado', '1366x768', 'padrao'))
    await dlgResult.getByRole('button', { name: 'Fechar' }).last().click()
    await expect(dlgResult).toBeHidden()

    await asideFila.getByTestId('fila-job-2').getByRole('button', { name: 'Descartar' }).click()
    const dlgDescartar = page.getByRole('alertdialog', { name: /Descartar chamada incerta #2/i })
    await expect(dlgDescartar).toBeVisible()
    await dlgDescartar.getByRole('button', { name: 'Descartar' }).click()
    await expect(dlgDescartar).toBeHidden()

    await asideFila.getByTestId('fila-job-2').getByRole('button', { name: /Refazer com outro Perfil/i }).click()
    const dlgRedo = page.getByRole('alertdialog', { name: /Refazer job #2 com outro Perfil/i })
    await expect(dlgRedo).toBeVisible()
    await expect(dlgRedo.getByText(/Refazer pela Fila não cria nova Revisão na Bancada/i)).toBeVisible()
    await salvarCaptura('14-fila-dialog-redo-result-1366.png')
    relatorio.push(await auditarPagina(page, 'r-fila-dialog-redo', '1366x768', 'padrao'))
    await dlgRedo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgRedo).toBeHidden()

    // Fecha Fila e verifica toast "Abrir Fila" (que aparece sobre o canto inferior direito)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    if (!(await asideFila.isHidden())) {
      await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
    }
    await expect(asideFila).toBeHidden()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao'
    })
    await expect(page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i })).toBeEnabled()

    // Verifica se o toast anterior ainda está sobreposto ao botão primário da Zona B
    const toastPortal = page.locator('[aria-label="Notifications"] [role="dialog"]').first()
    const toastJaVisivel = await toastPortal.isVisible()
    if (!toastJaVisivel) {
      await page.getByRole('button', { name: /Exportar \d+ aprovados em lote/i }).click()
      const dlgDirToast = page.getByRole('alertdialog')
      if (await dlgDirToast.isVisible()) {
        await dlgDirToast.getByRole('button', { name: /Entendi e continuar/i }).click()
      }
      await expect(toastPortal).toBeVisible({ timeout: 8000 })
    }

    const temBotaoAbrirFila = await page
      .locator('[aria-label="Notifications"]')
      .getByRole('button', { name: 'Abrir Fila' })
      .count()
    const sobreposicaoToast = await page.evaluate(() => {
      const toast = document.querySelector('[aria-label="Notifications"] [role="dialog"]')
      const btns = Array.from(document.querySelectorAll('button.bg-sinal'))
      const btn = btns[0]
      if (!toast || !btn) return false
      const tr = toast.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      return !(tr.right < br.left || tr.left > br.right || tr.bottom < br.top || tr.top > br.bottom)
    })
    await salvarCaptura('15-fila-toast-abrir-fila-1366.png')
    relatorio.push(await auditarPagina(page, 'r-fila-toast', '1366x768', 'padrao'))

    // Testa clicar em "Abrir Fila" no toast
    if (temBotaoAbrirFila > 0) {
      await page.locator('[aria-label="Notifications"]').getByRole('button', { name: 'Abrir Fila' }).click()
      await expect(asideFila).toBeVisible()
      await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
      await expect(asideFila).toBeHidden()
    }
    // Fecha toasts remanescentes se houver botão de fechar no portal
    const closeToast = page.locator('[aria-label="Notifications"] button[aria-label], [aria-label="Notifications"] [data-close]').first()
    if (await closeToast.isVisible().catch(() => false)) {
      await closeToast.click().catch(() => {})
    }

    checksExtras.fila = {
      focoRetornoFila,
      focoInicialRetry,
      regioesF6CortesComFila,
      temBotaoAbrirFila,
      sobreposicaoToast,
    }

    // ==================================================================
    // Fluxo (s) — Relatos e Diagnóstico (#/relatos) e Sobre (#/sobre)
    // ==================================================================
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/relatos')
    await expect(page.getByRole('heading', { level: 1, name: 'Relatos e diagnóstico' })).toBeVisible()

    // Passo 1: verifica ausência dos botões de saída no DOM, sonda de hardware, detector de segredo
    const botoesSaidaPasso1 = await page
      .getByRole('button', { name: /Copiar texto|Exportar diagnóstico|Abrir no GitHub/i })
      .count()
    await page.getByText('Diagnóstico da sonda de hardware (Transcrição)').click()
    await expect(page.getByText(/NVIDIA GeForce RTX 3050/i)).toBeVisible()

    await page.getByRole('textbox', { name: /Título/i }).fill('Erro ao exportar corte')
    const campoDesc = page.getByRole('textbox', { name: /Descrição/i })
    await campoDesc.click()
    await campoDesc.fill('minha chave da openai expirou')
    const focoPermaneceuDesc = await page.evaluate(
      () => document.activeElement?.getAttribute('id') || document.activeElement?.tagName.toLowerCase(),
    )
    await expect(page.getByRole('alert')).toBeVisible()

    const regioesF6RelatosPasso1 = await medirCicloF6(page, 5)
    await salvarCaptura('16-relatos-passo1-segredo-1366.png')
    relatorio.push(await auditarPagina(page, 's-relatos-passo1', '1366x768', 'padrao'))

    await campoDesc.fill('Descrição limpa sem segredos para revisão.')
    await page.getByRole('button', { name: /Revisar relato antes de enviar/i }).click()
    await expect(
      page.getByRole('heading', { level: 2, name: /Revisar e editar relato antes de enviar/i }),
    ).toBeVisible()

    // Passo 2 em 1440x900 (60/40 com aside Sonda de hardware e allowlist) + F6
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole('complementary', { name: /Sonda de hardware e allowlist/i })).toBeVisible()
    const regioesF6RelatosPasso2_1440 = await medirCicloF6(page, 6)
    await salvarCaptura('17-relatos-passo2-revisao-1440.png')
    relatorio.push(await auditarPagina(page, 's-relatos-passo2-1440', '1440x900', 'padrao'))

    // Testa URL > 8 KB e alto contraste em #/relatos 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => undefined },
        configurable: true,
      })
      window.open = () => null
    })
    const diagEditavel = page.getByRole('textbox', { name: /Diagnóstico técnico editável/i })
    await diagEditavel.fill('linha-grande-'.repeat(700))
    await page.getByRole('button', { name: /Abrir no GitHub/i }).click()
    await expect(page.getByRole('status').filter({ hasText: /8\.000 bytes|Diagnóstico copiado/i })).toBeVisible()

    await alternarAltoContraste(page, true)
    await page.getByRole('button', { name: /Revisar relato antes de enviar/i }).click()
    await expect(
      page.getByRole('heading', { level: 2, name: /Revisar e editar relato antes de enviar/i }),
    ).toBeVisible()
    await salvarCaptura('18-relatos-hc-1366.png')
    relatorio.push(await auditarPagina(page, 's-relatos-hc', '1366x768', 'high'))
    await alternarAltoContraste(page, false)

    // Sobre e Atualizações (#/sobre)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/sobre')
    await expect(page.getByRole('heading', { level: 1, name: 'Sobre e atualizações' })).toBeVisible()
    const regioesF6Sobre = await medirCicloF6(page, 5)
    await salvarCaptura('19-sobre-padrao-1366.png')
    relatorio.push(await auditarPagina(page, 's-sobre-padrao-1366', '1366x768', 'padrao'))

    // ?updater-test=available + aba Atribuições em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?updater-test=available#/sobre')
    await page.getByRole('button', { name: 'Verificar atualizações' }).click()
    await expect(page.getByRole('button', { name: /Baixar e instalar 0\.2\.0/i })).toBeVisible()
    await page.getByRole('tab', { name: /Atribuições de terceiros/i }).click()
    await expect(page.getByLabel('Atribuições de terceiros')).toHaveAttribute('tabindex', '0')
    await salvarCaptura('20-sobre-atualizacao-atribuicoes-1440.png')
    relatorio.push(await auditarPagina(page, 's-sobre-atualizacao-1440', '1440x900', 'padrao'))

    // Sobre em alto contraste + reinício com job crítico em voo (contexto isolado com clock)
    const reinicioContext = await browser.newContext()
    const pageReinicio = await reinicioContext.newPage()
    pageReinicio.on('pageerror', (e) => erros.push(e.message))
    await pageReinicio.setViewportSize({ width: 1440, height: 900 })
    await pageReinicio.goto('http://127.0.0.1:1430/#/inicio')
    await pageReinicio.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(pageReinicio).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await pageReinicio.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao'
    })
    await expect(pageReinicio.getByRole('button', { name: /Exportar \d+ aprovados em lote/i })).toBeEnabled()
    await pageReinicio.clock.install()
    await pageReinicio.clock.pauseAt(Date.now())
    await pageReinicio.getByRole('button', { name: /Exportar \d+ aprovados em lote/i }).click()
    await pageReinicio.clock.runFor(20)
    const dlgDirReinicio = pageReinicio.getByRole('alertdialog')
    if (await dlgDirReinicio.isVisible()) {
      await dlgDirReinicio.getByRole('button', { name: /Entendi e continuar/i }).click()
      await pageReinicio.clock.runFor(40)
    }
    await expect(pageReinicio).toHaveURL(/#\/projeto\/demo\/exportacao\?sub=lotes$/)
    await pageReinicio.evaluate(() => {
      window.location.hash = '#/config/aparencia'
    })
    await pageReinicio.getByRole('switch', { name: /Modo Alto Contraste/i }).click()
    await expect(pageReinicio.locator('html')).toHaveAttribute('data-contrast', 'high')
    await pageReinicio.evaluate(() => {
      window.location.hash = '#/sobre?updater-test=available'
    })
    await pageReinicio.getByRole('button', { name: 'Verificar atualizações' }).click()
    await expect(pageReinicio.getByRole('button', { name: /Baixar e instalar 0\.2\.0/i })).toBeVisible()
    await pageReinicio.getByRole('button', { name: /Baixar e instalar 0\.2\.0/i }).click()
    await expect(pageReinicio.getByRole('button', { name: 'Reiniciar para aplicar' })).toBeVisible()
    await pageReinicio.getByRole('button', { name: 'Reiniciar para aplicar' }).click()
    const dlgReinicioCritico = pageReinicio.getByRole('alertdialog', {
      name: /Reiniciar o Clipes com operações em andamento/i,
    })
    await expect(dlgReinicioCritico).toBeVisible()
    await pageReinicio.clock.runFor(250)
    await pageReinicio.screenshot({
      path: `${CAPTURAS_DIR}/21-sobre-hc-reinicio-critico-1440.png`,
      animations: 'disabled',
    })
    relatorio.push(await auditarPagina(pageReinicio, 's-sobre-hc-reinicio', '1440x900', 'high'))
    await reinicioContext.close()

    checksExtras.relatosESobre = {
      botoesSaidaPasso1,
      focoPermaneceuDesc,
      regioesF6RelatosPasso1,
      regioesF6RelatosPasso2_1440,
      regioesF6Sobre,
    }

    // ==================================================================
    // Fluxo (t) — Estados de erro, vazios e carregamento (?estado=)
    // ==================================================================
    await page.setViewportSize({ width: 1366, height: 768 })

    // t.1: Exportação ?estado=vazio
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=vazio'
    })
    await expect(page.getByText('Nenhum Corte aprovado para exportar')).toBeVisible()
    await salvarCaptura('22-estado-exportacao-vazio-1366.png')
    relatorio.push(await auditarPagina(page, 't-exportacao-vazio', '1366x768', 'padrao'))

    // t.2: Exportação ?estado=erro
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=erro'
    })
    await expect(page.getByRole('alert')).toBeVisible()
    await salvarCaptura('23-estado-exportacao-erro-1366.png')
    relatorio.push(await auditarPagina(page, 't-exportacao-erro', '1366x768', 'padrao'))

    // t.3: Exportação ?estado=carregando
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/exportacao?estado=carregando'
    })
    await expect(page.getByRole('status', { name: /Carregando Mesa de Prontidão/i })).toBeVisible()
    relatorio.push(await auditarPagina(page, 't-exportacao-carregando', '1366x768', 'padrao'))

    // t.4: Fila ?estado=erro
    await page.evaluate(() => {
      window.location.hash = '#/projeto/demo/cortes?estado=erro'
    })
    await page.keyboard.press('Control+j')
    await expect(asideFila).toBeVisible()
    relatorio.push(await auditarPagina(page, 't-fila-erro', '1366x768', 'padrao'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    if (!(await asideFila.isHidden())) {
      await asideFila.getByRole('button', { name: /Fechar Fila/i }).click()
    }

    // t.5: Relatos ?estado=vazio e ?estado=erro
    await page.goto('/?estado=vazio#/relatos')
    await page.getByText('Diagnóstico da sonda de hardware (Transcrição)').click()
    await expect(page.getByText('Nenhuma sonda de hardware gravada ainda.')).toBeVisible()
    relatorio.push(await auditarPagina(page, 't-relatos-vazio', '1366x768', 'padrao'))

    await page.goto('/?estado=erro#/relatos')
    await page.getByText('Diagnóstico da sonda de hardware (Transcrição)').click()
    await expect(page.getByRole('alert')).toBeVisible()
    relatorio.push(await auditarPagina(page, 't-relatos-erro', '1366x768', 'padrao'))

    // t.6: Sobre ?updater-test=invalid-signature e ?estado=erro
    await page.goto('/?updater-test=invalid-signature#/sobre')
    await page.getByRole('button', { name: 'Verificar atualizações' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    relatorio.push(await auditarPagina(page, 't-sobre-invalid-sig', '1366x768', 'padrao'))

    await page.goto('/?estado=erro#/sobre')
    await expect(page.getByRole('alert')).toBeVisible()
    relatorio.push(await auditarPagina(page, 't-sobre-erro', '1366x768', 'padrao'))

    const jsonRelatorio = JSON.stringify(
      {
        erros,
        checksExtras,
        relatorio,
      },
      null,
      2,
    )
    await testInfo.attach('ui-onda6-audit.json', {
      body: jsonRelatorio,
      contentType: 'application/json',
    })
    console.log('UI_ONDA6_AUDIT_SUMMARY=' + jsonRelatorio)

    expect(erros).toEqual([])
  })
})
