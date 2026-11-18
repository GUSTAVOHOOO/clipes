import { expect, test, type Page } from '@playwright/test'

declare const process: { env: Record<string, string | undefined> }

const CAPTURAS_DIR = '../docs/produto/front-v2/ui/capturas/onda-2'

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
  botoesPrimariosSinal: number
  ticketRefsVisiveis: string[]
  glossarioViolacoes: string[]
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
      'a[href], button, input, select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
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

    const botoesPrimariosSinal = Array.from(document.querySelectorAll('button.bg-sinal')).filter(
      visivel,
    ).length

    const bodyText = document.body.innerText
    const ticketRefsVisiveis: string[] = []
    const matchesTickets = bodyText.match(/#\d{2,4}\b/g)
    if (matchesTickets) {
      for (const m of matchesTickets) {
        if (!ticketRefsVisiveis.includes(m)) ticketRefsVisiveis.push(m)
      }
    }

    const glossarioViolacoes: string[] = []
    const proibidos: Array<[RegExp, string]> = [
      [/\bclipes?\b/gi, 'clipe (exceto marca Clipes)'],
      [/\bshorts?\b/gi, 'short'],
      [/\binputs?\b/gi, 'input'],
      [/\bvoice-?over\b/gi, 'voice-over'],
      [/\blocu[çc][ãa]o\b/gi, 'locução'],
      [/\bworkspace\b/gi, 'workspace'],
      [/\bpreset(s)?\b/gi, 'preset'],
      [/\bsegmentos?\b/gi, 'segmento'],
      [/\bsenten[çc]as?\b/gi, 'sentença'],
      [/\bhighlights?\b/gi, 'highlight'],
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
      botoesPrimariosSinal,
      ticketRefsVisiveis,
      glossarioViolacoes,
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
  await page.waitForTimeout(300)
  const hashAnterior = new URL(urlAnterior).hash || '#/inicio'
  await page.evaluate((h) => {
    window.location.hash = h
  }, hashAnterior)
}

test.describe('Avaliação UI independente — Onda 2 (Fontes e Transcrição)', () => {
  test.skip(
    !process.env.UI_BASELINE,
    'Execução manual de avaliação UI Onda 2 (defina UI_BASELINE=1)',
  )

  test('percorre fluxos (e)-(h) em 1366x768 e 1440x900, tema padrão e alto contraste', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    const relatorio: AchadoDom[] = []
    const salvarCaptura = async (nome: string) => {
      await page.screenshot({ path: `${CAPTURAS_DIR}/${nome}`, animations: 'disabled' })
    }

    // ------------------------------------------------------------------
    // Fluxo (e): Lista de Fontes (#/projeto/:id/fontes)
    // ------------------------------------------------------------------
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)
    await expect(page.getByText('Live_12_11_final.mp4', { exact: true })).toBeVisible()
    await expect(page.getByText('offline.mp4', { exact: true })).toBeVisible()

    await salvarCaptura('01-fontes-lista-1366.png')
    relatorio.push(await auditarPagina(page, 'e-fontes-lista', '1366x768', 'padrao'))

    // Checa ciclo F6
    const regiaoAntesF6 = await page.evaluate(
      () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
    )
    await page.keyboard.press('F6')
    const regiaoDepoisF6 = await page.evaluate(
      () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
    )

    // Estado ?estado=vazio
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?estado=vazio'
    })
    await expect(page.getByText('Nenhuma Fonte importada ainda')).toBeVisible()
    await salvarCaptura('02-fontes-vazio-1366.png')
    relatorio.push(await auditarPagina(page, 'e-fontes-vazio', '1366x768', 'padrao'))

    // Volta à lista normal
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes'
    })
    await expect(page.getByText('Live_12_11_final.mp4', { exact: true })).toBeVisible()

    // Busca FTS5 sem resultado + Esc fecha devolvendo foco
    await page.keyboard.press('Control+f')
    const buscaGlobal = page.getByRole('searchbox', {
      name: /Buscar falas em todas as Transcrições do Projeto/i,
    })
    await expect(buscaGlobal).toBeFocused()
    await buscaGlobal.fill('zzznaoexiste')
    await buscaGlobal.press('Enter')
    const gaveta = page.getByRole('complementary', {
      name: /Resultados da busca nas Transcrições/i,
    })
    await expect(gaveta).toBeVisible()
    await expect(gaveta.getByText(/Nenhum trecho encontrado/i)).toBeVisible()
    relatorio.push(await auditarPagina(page, 'e-fontes-fts-vazio', '1366x768', 'padrao'))
    await gaveta.getByRole('button', { name: 'Fechar busca' }).focus()
    await page.keyboard.press('Escape')
    await expect(gaveta).toBeHidden()
    await expect(buscaGlobal).toBeFocused()

    // Busca FTS5 com resultado
    await buscaGlobal.fill('frase 142')
    await expect(gaveta).toBeVisible()
    await expect(gaveta.locator('mark')).toHaveText('Frase 142')
    await page.waitForTimeout(250)
    await salvarCaptura('03-fontes-fts-1366.png')
    relatorio.push(await auditarPagina(page, 'e-fontes-fts-resultado', '1366x768', 'padrao'))
    await gaveta.getByRole('button', { name: 'Fechar busca' }).click()
    await expect(gaveta).toBeHidden()

    // Excluir Fonte (ConfirmDialog com foco inicial em Cancelar)
    const cardOffline = page.locator('article', { hasText: 'offline.mp4' })
    await cardOffline.getByRole('button', { name: /Excluir Fonte/i }).click()
    const dlgExcluir = page.getByRole('alertdialog')
    await expect(dlgExcluir).toBeVisible()
    await expect(dlgExcluir.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await salvarCaptura('04-fontes-excluir-dialog-1366.png')
    relatorio.push(await auditarPagina(page, 'e-fontes-excluir-dialog', '1366x768', 'padrao'))
    await dlgExcluir.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlgExcluir).toBeHidden()

    // Relocalizar Fonte V1 offline com confirmation_required
    await cardOffline.getByRole('button', { name: /Relocalizar arquivo/i }).click()
    const dlgReloc = page.getByRole('dialog', { name: /Relocalizar arquivo/i })
    await expect(dlgReloc).toBeVisible()
    await dlgReloc.getByRole('textbox', { name: /Arquivo de vídeo/i }).fill('/videos/recuperado.mp4')
    await dlgReloc.getByRole('button', { name: /^Relocalizar$/i }).click()
    const dlgConfirmReloc = page.getByRole('alertdialog')
    await expect(dlgConfirmReloc).toBeVisible()
    await dlgConfirmReloc.getByRole('button', { name: /Confirmar relocalização/i }).click()
    await expect(page.getByText('recuperado.mp4', { exact: true })).toBeVisible()

    // Selecionar 2 Fontes e verificar em 1440x900
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('checkbox', { name: /Selecionar Live_12_11_final\.mp4 para lote/i }).click()
    await page.getByRole('checkbox', { name: /Selecionar recuperado\.mp4 para lote/i }).click()
    await expect(page.getByRole('button', { name: 'Processar 2 Fontes em lote' })).toBeEnabled()
    await salvarCaptura('05-fontes-lista-1440.png')
    relatorio.push(await auditarPagina(page, 'e-fontes-lista', '1440x900', 'padrao'))

    // Alto contraste em Lista de Fontes (1366x768)
    await page.setViewportSize({ width: 1366, height: 768 })
    await alternarAltoContraste(page, true)
    await expect(page.getByText('Live_12_11_final.mp4', { exact: true })).toBeVisible()
    await salvarCaptura('06-fontes-lista-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'e-fontes-lista-hc', '1366x768', 'high'))
    await alternarAltoContraste(page, false)
    await expect(page.getByText('Live_12_11_final.mp4', { exact: true })).toBeVisible()

    // ------------------------------------------------------------------
    // Fluxo (f): Entrada de Fonte (local, URL, JIT, erro, aviso antes de ação externa)
    // ------------------------------------------------------------------
    await page.getByRole('textbox', { name: /Arquivo de vídeo/i }).fill('/videos/live_obs_teste.mkv')
    await page.getByRole('button', { name: 'Inspecionar arquivo' }).click()
    await expect(page.getByText('live_obs_teste.mkv', { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: /Tenho permissão do criador/i }).click()
    await page.getByLabel(/Quem autorizou/i).fill('Streamer Teste')
    await page.getByLabel(/Onde foi autorizada/i).fill('Discord')
    await page.getByLabel(/Escopo/i).fill('cortes e tradução')
    await salvarCaptura('07-entrada-local-inspecao-1366.png')
    relatorio.push(await auditarPagina(page, 'f-entrada-local-inspecao', '1366x768', 'padrao'))
    await page.getByRole('button', { name: 'Importar Fonte' }).click()
    await expect(page.getByText('live_obs_teste.mkv', { exact: true })).toBeVisible()

    // URL (VOD): Termos do YouTube
    await page.getByRole('radio', { name: /URL \(VOD\)/i }).click()
    const campoUrl = page.getByRole('textbox', { name: /URL do vídeo/i })
    const btnBaixarUrl = page.getByRole('button', { name: 'Baixar por URL' })
    await campoUrl.fill('https://youtube.com/watch/js-test')
    await btnBaixarUrl.click()
    const dlgTermos = page.getByRole('alertdialog')
    await expect(dlgTermos).toBeVisible()
    await salvarCaptura('08-entrada-url-termos-1366.png')
    relatorio.push(await auditarPagina(page, 'f-entrada-url-termos', '1366x768', 'padrao'))
    await dlgTermos.getByRole('button', { name: /Aceitar e baixar/i }).click()
    await expect(dlgTermos).toBeHidden()

    // js_runtime_missing + InstaladorJustInTime inline
    const regiaoJit = page.getByRole('region', { name: /Instalação necessária/i })
    await expect(regiaoJit).toBeVisible()
    await salvarCaptura('09-entrada-url-jit-1366.png')
    relatorio.push(await auditarPagina(page, 'f-entrada-url-jit', '1366x768', 'padrao'))

    // JIT inline em 1440x900 (exibe tamanho, licença e origem antes de baixar deno)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(regiaoJit).toBeVisible()
    await salvarCaptura('11-entrada-jit-1440.png')
    relatorio.push(await auditarPagina(page, 'f-entrada-url-jit', '1440x900', 'padrao'))
    await regiaoJit.getByRole('button', { name: 'Agora não' }).click()

    // Erro age_restricted em 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await campoUrl.fill('https://youtube.com/watch/age-test')
    await btnBaixarUrl.click()
    const alertaIdade = page.getByRole('alert')
    await expect(alertaIdade).toContainText(/restrição de idade/i)
    await salvarCaptura('10-entrada-url-erro-idade-1366.png')
    relatorio.push(await auditarPagina(page, 'f-entrada-url-erro-idade', '1366x768', 'padrao'))
    await alertaIdade.getByRole('button', { name: 'Importar arquivo local' }).click()
    await expect(page.getByRole('radio', { name: /Arquivo local/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // ------------------------------------------------------------------
    // Fluxo (g): Lotes (#/projeto/:id/fontes?sub=lotes)
    // ------------------------------------------------------------------
    await page.getByRole('tab', { name: /Lotes de Fontes/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes\?sub=lotes$/)
    await expect(page.getByRole('heading', { name: 'Novo Lote de Fontes' })).toBeVisible()

    // Monta lote Groq (pago/remoto) -> ConfirmDialog com ResumoCustoPrivacidade
    await page.getByRole('checkbox', { name: /changed\.mp4/i }).click()
    await page.getByRole('checkbox', { name: /mismatch\.mp4/i }).click()
    await page.getByRole('checkbox', { name: /Live_12_11_final\.mp4/i }).click()
    await page.getByRole('radio', { name: /Groq \(remoto\)/i }).click()
    await page.getByRole('button', { name: 'Iniciar lote com 3 Fontes' }).click()
    const dlgCriarLote = page.getByRole('alertdialog')
    await expect(dlgCriarLote).toBeVisible()
    await salvarCaptura('12-lotes-montar-custo-1366.png')
    relatorio.push(await auditarPagina(page, 'g-lotes-montar-custo', '1366x768', 'padrao'))
    await dlgCriarLote.getByRole('button', { name: 'Confirmar e iniciar lote' }).click()
    await expect(dlgCriarLote).toBeHidden()

    const cardLote1 = page.getByRole('article', { name: 'Lote #1' })
    await expect(cardLote1).toBeVisible()
    await salvarCaptura('13-lotes-execucao-1366.png')
    relatorio.push(await auditarPagina(page, 'g-lotes-execucao', '1366x768', 'padrao'))

    // Somente local bloqueando Groq em Lotes
    await page.evaluate(() => {
      window.location.hash = '#/config/projeto'
    })
    await page.getByRole('tab', { name: /Privacidade/i }).click()
    await page.getByRole('switch', { name: /Somente local/i }).click()

    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes?sub=lotes'
    })
    await expect(page.getByText('Bloqueado por Somente local').first()).toBeVisible()
    await page.getByRole('checkbox', { name: /changed\.mp4/i }).click()
    await page.getByRole('radio', { name: /Groq \(remoto\)/i }).click()
    await page.getByRole('button', { name: 'Iniciar lote com 1 Fonte' }).click()
    const alertaLocalOnly = page
      .getByRole('region', { name: 'Construtor de Lote de Fontes' })
      .getByRole('alert')
    await expect(alertaLocalOnly).toBeVisible()
    await salvarCaptura('14-lotes-erro-local-only-1366.png')
    relatorio.push(await auditarPagina(page, 'g-lotes-erro-local-only', '1366x768', 'padrao'))

    // Desliga Somente local para testar budget_paused + uncertain em 1440x900
    await page.evaluate(() => {
      window.location.hash = '#/config/projeto'
    })
    await page.getByRole('tab', { name: /Privacidade/i }).click()
    await page.getByRole('switch', { name: /Somente local/i }).click()

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      window.location.hash =
        '#/projeto/meu-canal-de-cortes/fontes?sub=lotes&batch-unknown=1&batch-uncertain=1'
    })
    for (const rx of [/changed\.mp4/i, /mismatch\.mp4/i, /Live_12_11_final\.mp4/i]) {
      const chk = page.getByRole('checkbox', { name: rx })
      if ((await chk.getAttribute('aria-checked')) !== 'true') {
        await chk.click()
      }
    }
    await page.getByRole('radio', { name: /Local \(US\$ 0,00\)/i }).click()
    await page.getByRole('button', { name: /Iniciar lote com \d+ Fontes?/i }).click()
    const cardLote2 = page.getByRole('article', { name: 'Lote #2' })
    await expect(cardLote2).toBeVisible()
    await expect(cardLote2.getByText('Pausado por orçamento')).toBeVisible()
    await salvarCaptura('15-lotes-budget-uncertain-1440.png')
    relatorio.push(await auditarPagina(page, 'g-lotes-budget-uncertain', '1440x900', 'padrao'))

    // Alto contraste em Lotes (1440x900)
    await alternarAltoContraste(page, true)
    await expect(cardLote2).toBeVisible()
    await salvarCaptura('16-lotes-hc-1440.png')
    relatorio.push(await auditarPagina(page, 'g-lotes-hc', '1440x900', 'high'))
    await alternarAltoContraste(page, false)

    // ------------------------------------------------------------------
    // Fluxo (h): Detalhe da Fonte (#/projeto/:id/fontes/:fonteId)
    // ------------------------------------------------------------------
    await page.setViewportSize({ width: 1366, height: 768 })

    // Guarda de rota (:fonteId inexistente)
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/999'
    })
    await expect(page).toHaveURL(/#\/projeto\/meu-canal-de-cortes\/fontes$/)
    await expect(
      page.getByText(/A Fonte selecionada não foi encontrada neste Projeto\./i),
    ).toBeVisible()

    // ?estado=vazio: Motor Local + VAD #279
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4?estado=vazio'
    })
    await expect(page.getByText(/Esta Fonte ainda não foi transcrita\./i)).toBeVisible()
    await salvarCaptura('17-detalhe-vazio-motor-1366.png')
    relatorio.push(await auditarPagina(page, 'h-detalhe-vazio-motor', '1366x768', 'padrao'))

    // Groq selecionado -> ResumoCustoPrivacidade
    await page.getByRole('radio', { name: /Groq remoto/i }).click()
    await expect(
      page.getByRole('region', { name: /Resumo de custo e privacidade: Transcrição Groq/i }),
    ).toBeVisible()
    await salvarCaptura('18-detalhe-groq-custo-1366.png')
    relatorio.push(await auditarPagina(page, 'h-detalhe-groq-custo', '1366x768', 'padrao'))

    // Estado pronto (Leitor virtualizado + edição F2) em 1366x768
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await expect(page.getByRole('button', { name: /Silêncio ·/i }).first()).toBeVisible()
    const leitor = page.getByRole('region', { name: 'Transcrição da Fonte' })
    const primeiraPalavra = leitor.locator('button[data-word]').first()
    const boxPalavra = await primeiraPalavra.boundingBox()
    await primeiraPalavra.focus()
    await page.keyboard.press('F2')
    const inputPalavra = page.getByRole('textbox', { name: 'Corrigir palavra' })
    await inputPalavra.fill('CorrigidaUI')
    await inputPalavra.press('Enter')
    const palavraCorrigida = leitor.getByRole('button', { name: 'CorrigidaUI' })
    await expect(palavraCorrigida).toBeVisible()
    await expect(palavraCorrigida).toBeFocused()
    await salvarCaptura('20-detalhe-leitor-1366.png')
    relatorio.push(await auditarPagina(page, 'h-detalhe-leitor', '1366x768', 'padrao'))

    // 1440x900 + Alto contraste no Detalhe da Fonte
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(palavraCorrigida).toBeVisible()
    await salvarCaptura('22-detalhe-leitor-1440.png')
    relatorio.push(await auditarPagina(page, 'h-detalhe-leitor', '1440x900', 'padrao'))

    await alternarAltoContraste(page, true)
    await expect(page.getByRole('heading', { level: 1, name: 'Live_12_11_final.mp4' })).toBeVisible()
    await salvarCaptura('23-detalhe-hc-1440.png')
    relatorio.push(await auditarPagina(page, 'h-detalhe-hc', '1440x900', 'high'))
    await alternarAltoContraste(page, false)

    // Fonte offline/alterada (id 1 = changed.mp4 ou id 3 = mismatch.mp4; nota: id 2 foi relocalizada para recuperado.mp4)
    // Vamos usar mismatch.mp4 (id 3) ou offline? No fluxo acima, id 2 virou available! Então vamos forçar ?estado=offline em Fonte 4 ou usar Fonte 3 (changed)!
    // Melhor: usar ?estado=offline na Fonte 4 (suportado em DetalheFonte.tsx L183: forcado === 'offline')!
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4?estado=offline'
    })
    await expect(page.getByText(/Vídeo indisponível no disco/i)).toBeVisible()
    await expect(page.getByText(/O arquivo da Fonte não está disponível no disco/i)).toBeVisible()
    await salvarCaptura('21-detalhe-erro-offline-1366.png')
    relatorio.push(await auditarPagina(page, 'h-detalhe-erro-offline', '1366x768', 'padrao'))

    // Blocos de 10 min e progresso em andamento na Fonte 4
    await page.evaluate(() => {
      window.location.hash = '#/projeto/meu-canal-de-cortes/fontes/4'
    })
    await page.getByRole('button', { name: /Medir amostra 30 s/i }).click()
    await expect(page.getByText(/ETA estimado:/i)).toBeVisible()
    await page.getByRole('button', { name: /Refazer transcrição/i }).click()
    await expect(page.getByText(/Transcrição em andamento/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Pausar \/ Cancelar mantendo blocos salvos/i })).toBeVisible()
    await salvarCaptura('19-detalhe-blocos-progresso-1366.png')
    relatorio.push(await auditarPagina(page, 'h-detalhe-blocos-progresso', '1366x768', 'padrao'))

    await page.getByRole('button', { name: /Pausar \/ Cancelar mantendo blocos salvos/i }).click()
    await expect(page.getByText(/Transcrição parcial salva até/i)).toBeVisible()
    relatorio.push(await auditarPagina(page, 'h-detalhe-parcial', '1366x768', 'padrao'))

    await testInfo.attach('ui-onda2-audit.json', {
      body: JSON.stringify(
        {
          erros,
          f6Check: { regiaoAntesF6, regiaoDepoisF6 },
          boxPalavra,
          relatorio,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })

    expect(erros).toEqual([])
  })
})
