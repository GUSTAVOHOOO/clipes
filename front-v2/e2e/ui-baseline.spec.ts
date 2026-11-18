import { expect, test, type Page } from '@playwright/test'

declare const process: { env: Record<string, string | undefined> }

const CAPTURAS_DIR = '../docs/produto/front-v2/ui/capturas/ondas-0-1'

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
  glossarioViolacoes: string[]
  overflowExterno: {
    largura: boolean
    altura: boolean
    scrollW: number
    innerW: number
    scrollH: number
    innerH: number
  }
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
        (el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox') && labelPai
          ? labelPai
          : el
      const r = alvo.getBoundingClientRect()
      if (el.tagName !== 'INPUT' && (r.width < 24 || r.height < 24)) {
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
      if (!aria && !txt && !title && !hasLabel && !parentLabel && !placeholder) {
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

    const bodyText = document.body.innerText
    const glossarioViolacoes: string[] = []
    const proibidos: Array<[RegExp, string]> = [
      [/\bclipes?\b/gi, 'clipe (exceto marca Clipes)'],
      [/\bshorts?\b/gi, 'short'],
      [/\binputs?\b/gi, 'input'],
      [/\bvoice-?over\b/gi, 'voice-over'],
      [/\blocu[çc][ãa]o\b/gi, 'locução'],
      [/\bworkspace\b/gi, 'workspace'],
      [/\bpreset(s)?\b/gi, 'preset'],
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

    return {
      alvosMenores24,
      textosBaixoContraste,
      semNomeAcessivel,
      headings,
      glossarioViolacoes,
      overflowExterno,
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

test.describe('Linha de base UI — Ondas 0+1 (Impeccable)', () => {
  test.skip(!process.env.UI_BASELINE, 'Execução manual de linha de base UI (defina UI_BASELINE=1)')

  test('executa cenário fixo em 1366x768 e 1440x900, tema padrão e alto contraste', async ({
    page,
  }, testInfo) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    const relatorio: AchadoDom[] = []
    const salvarCaptura = async (nome: string) => {
      await page.screenshot({ path: `${CAPTURAS_DIR}/${nome}`, animations: 'disabled' })
    }

    // 1. Onda 0 (Shell) + Fluxo (a): Projetos (#/inicio) em 1366x768
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()
    await salvarCaptura('01-shell-inicio-1366.png')
    relatorio.push(await auditarPagina(page, 'inicio-padrao', '1366x768', 'padrao'))

    // Verifica F6 e Ctrl+J no Shell
    const antesF6 = await page.evaluate(() => document.activeElement?.tagName ?? null)
    await page.keyboard.press('F6')
    const depoisF6 = await page.evaluate(() => document.activeElement?.tagName ?? null)
    await page.keyboard.press('Control+j')
    const urlAposCtrlJ = page.url()

    // Paleta Ctrl+K + Esc restaura foco
    const gatilhoPaleta = page.getByRole('button', { name: /Abrir comandos/i })
    await gatilhoPaleta.focus()
    await page.keyboard.press('Control+k')
    const dialogoPaleta = page.getByRole('dialog', { name: 'Paleta de comandos' })
    await expect(dialogoPaleta).toBeVisible()
    await expect(dialogoPaleta).toHaveCSS('opacity', '1')
    await salvarCaptura('02-shell-paleta-1366.png')
    await page.keyboard.press('Escape')
    await expect(dialogoPaleta).toBeHidden()

    // Estados ?estado=carregando, vazio, erro em #/inicio
    await page.goto('/#/inicio?estado=carregando')
    await expect(page.getByRole('status', { name: /Carregando Projetos recentes/i })).toBeVisible()
    relatorio.push(await auditarPagina(page, 'inicio-carregando', '1366x768', 'padrao'))

    await page.goto('/#/inicio?estado=vazio')
    await expect(page.getByText('Nenhum Projeto recente ainda')).toBeVisible()
    await salvarCaptura('04-inicio-vazio-1366.png')
    relatorio.push(await auditarPagina(page, 'inicio-vazio', '1366x768', 'padrao'))

    await page.goto('/#/inicio?estado=erro')
    await expect(page.getByRole('alert')).toBeVisible()
    await salvarCaptura('05-inicio-erro-1366.png')
    relatorio.push(await auditarPagina(page, 'inicio-erro', '1366x768', 'padrao'))

    // Criar Projeto e verificar Shell com Projeto aberto + SeletorProjeto
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: /Novo Projeto/i }).click()
    const dlgNovo = page.getByRole('dialog', { name: 'Novo Projeto' })
    await expect(dlgNovo).toBeVisible()
    await expect(dlgNovo).toHaveCSS('opacity', '1')
    await salvarCaptura('06-inicio-novo-projeto-1366.png')
    await dlgNovo.getByRole('textbox', { name: 'Nome do Projeto' }).fill('Canal Baseline')
    await dlgNovo.getByRole('textbox', { name: 'Pasta onde salvar' }).fill('/tmp/clipes')
    await dlgNovo.getByRole('button', { name: 'Criar Projeto' }).click()
    await expect(page).toHaveURL(/#\/projeto\/canal-baseline\/fontes$/)

    // Abre menu SeletorProjeto e registra efeito de clicar em "Fechar Projeto"
    await page.getByRole('button', { name: /Canal Baseline/i }).click()
    const menuProjeto = page.getByRole('menu')
    await expect(menuProjeto).toBeVisible()
    await expect(menuProjeto).toHaveCSS('opacity', '1')
    await salvarCaptura('03-shell-projeto-aberto-1366.png')
    await menuProjeto.getByRole('menuitem', { name: 'Fechar Projeto' }).click()
    const urlAposFecharMenu = page.url()
    await page.keyboard.press('Escape')
    relatorio.push(await auditarPagina(page, 'shell-com-projeto', '1366x768', 'padrao'))

    // Voltar a #/inicio, fechar Projeto e abrir Projeto V1
    await page.goto('/#/inicio')
    await page.getByRole('button', { name: 'Fechar Projeto' }).click()
    await page.getByRole('button', { name: /Abrir pasta \.clipes/i }).click()
    const dlgAbrir = page.getByRole('dialog', { name: 'Abrir pasta .clipes' })
    await dlgAbrir.getByRole('textbox', { name: 'Pasta .clipes' }).fill('C:\\V1\\CanalLegado.clipes')
    await dlgAbrir.getByRole('button', { name: 'Abrir Projeto' }).click()
    await expect(page).toHaveURL(/#\/projeto\/canallegado\/fontes$/)

    // 2. Fluxo (b): Assistente de primeiro uso (#/assistente)
    await page.goto('/#/inicio?assistant-test=1')
    await expect(page).toHaveURL(/#\/assistente\?passo=1$/)
    await expect(page.getByRole('heading', { name: /Passo 1:/ })).toBeVisible()
    await salvarCaptura('07-assistente-passo1-1366.png')
    relatorio.push(await auditarPagina(page, 'assistente-passo1', '1366x768', 'padrao'))

    await page.getByRole('button', { name: /Próximo: Provedor de IA/i }).click()
    await expect(page).toHaveURL(/#\/assistente\?passo=2$/)
    await expect(page.getByRole('heading', { name: /Passo 2:/ })).toBeVisible()
    relatorio.push(await auditarPagina(page, 'assistente-passo2-ollama', '1366x768', 'padrao'))
    await page.getByRole('radio', { name: /Chave de API/i }).click()
    await salvarCaptura('08-assistente-passo2-api-1366.png')
    relatorio.push(await auditarPagina(page, 'assistente-passo2-api', '1366x768', 'padrao'))

    await page.getByRole('button', { name: /Pular por enquanto/i }).click()
    await expect(page).toHaveURL(/#\/inicio$/)

    // 3. Fluxo (c): Provedores e Custos
    await page.goto('/#/config/provedores')
    await expect(page.getByRole('heading', { name: 'Provedores e Tarefas de IA' })).toBeVisible()
    await salvarCaptura('09-config-provedores-1366.png')
    relatorio.push(await auditarPagina(page, 'config-provedores', '1366x768', 'padrao'))

    // Novo Perfil com consentimento remoto
    await page.getByRole('button', { name: 'Novo Perfil' }).click()
    const dlgPerfil = page.getByRole('dialog', { name: 'Novo Perfil de Provedor' })
    await expect(dlgPerfil).toBeVisible()
    await expect(dlgPerfil).toHaveCSS('opacity', '1')
    await salvarCaptura('10-config-provedores-modal-1366.png')
    await dlgPerfil.getByLabel('Nome do Perfil', { exact: true }).fill('OpenAI Baseline')
    await dlgPerfil.getByLabel('Endpoint', { exact: true }).fill('https://api.openai.com/v1')
    await dlgPerfil.getByLabel('Modelo', { exact: true }).fill('gpt-4o-mini')
    await dlgPerfil.getByRole('checkbox', { name: /Concordo em enviar apenas texto/i }).check()
    await dlgPerfil.getByRole('button', { name: 'Salvar Perfil' }).click()
    await expect(dlgPerfil).toBeHidden()

    await page.goto('/#/config/custos')
    await expect(page.getByRole('heading', { name: 'Custos, Orçamentos e Auditoria' })).toBeVisible()
    relatorio.push(await auditarPagina(page, 'config-custos-sem-projeto', '1366x768', 'padrao'))

    await page.goto('/?source-test=1#/config/custos')
    await expect(page.getByText(/Falha cobrada/)).toBeVisible()
    await salvarCaptura('11-config-custos-orcamentos-1366.png')
    relatorio.push(await auditarPagina(page, 'config-custos-orcamentos', '1366x768', 'padrao'))

    await page.getByRole('tab', { name: 'Auditoria' }).click()
    await expect(page.getByText('api.openai.com').first()).toBeVisible()
    await salvarCaptura('12-config-custos-auditoria-1366.png')
    relatorio.push(await auditarPagina(page, 'config-custos-auditoria', '1366x768', 'padrao'))

    await page.getByRole('tab', { name: 'Tabela de Preços e Estimador' }).click()
    await page.getByRole('button', { name: 'Simular custo' }).click()
    await expect(page.getByLabel(/Resumo de custo e privacidade/i)).toBeVisible()
    await salvarCaptura('13-config-custos-precos-1366.png')
    relatorio.push(await auditarPagina(page, 'config-custos-precos', '1366x768', 'padrao'))

    // 4. Fluxo (d): Componentes, Exportação, Aparência e Projeto
    await page.goto('/?source-test=1#/config/componentes')
    await expect(page.getByRole('heading', { name: 'Componentes e Armazenamento' })).toBeVisible()
    await salvarCaptura('14-config-componentes-hardware-1366.png')
    relatorio.push(await auditarPagina(page, 'config-componentes-hardware', '1366x768', 'padrao'))

    await page.getByRole('tab', { name: 'Componentes e Modelos' }).click()
    await expect(page.getByText('FFmpeg e FFprobe')).toBeVisible()
    await salvarCaptura('15-config-componentes-modelos-1366.png')
    relatorio.push(await auditarPagina(page, 'config-componentes-modelos', '1366x768', 'padrao'))

    await page.getByRole('tab', { name: 'Vozes TTS (Narração)' }).click()
    relatorio.push(await auditarPagina(page, 'config-componentes-tts', '1366x768', 'padrao'))

    await page.getByRole('tab', { name: 'Pastas e Armazenamento' }).click()
    relatorio.push(await auditarPagina(page, 'config-componentes-armazenamento', '1366x768', 'padrao'))

    await page.goto('/?source-test=1#/config/exportacao')
    await expect(page.getByRole('heading', { name: 'Exportação e Encoder' })).toBeVisible()
    relatorio.push(await auditarPagina(page, 'config-exportacao-inicial', '1366x768', 'padrao'))
    await page.getByRole('button', { name: /Detectar encoders agora/i }).click()
    await expect(page.getByRole('radiogroup', { name: /Escolha de encoder H\.264/i })).toBeVisible()
    await salvarCaptura('16-config-exportacao-detectado-1366.png')
    relatorio.push(await auditarPagina(page, 'config-exportacao-detectado', '1366x768', 'padrao'))

    await page.goto('/?source-test=1#/config/projeto')
    await expect(page.getByRole('heading', { name: /Projeto atual/i })).toBeVisible()
    await salvarCaptura('19-config-projeto-1366.png')
    relatorio.push(await auditarPagina(page, 'config-projeto', '1366x768', 'padrao'))

    await page.goto('/?source-test=1#/config/aparencia')
    await expect(page.getByRole('heading', { name: 'Aparência e Teclado' })).toBeVisible()
    await salvarCaptura('17-config-aparencia-padrao-1366.png')
    relatorio.push(await auditarPagina(page, 'config-aparencia', '1366x768', 'padrao'))

    // Tema Claro + 1366x768 (aguarda transição de cor concluir antes de medir contraste)
    await page.getByRole('radiogroup', { name: 'Tema' }).getByRole('radio', { name: 'Claro' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro')
    await page.waitForTimeout(300)
    relatorio.push(await auditarPagina(page, 'config-aparencia-claro', '1366x768', 'claro'))
    await page.getByRole('radiogroup', { name: 'Tema' }).getByRole('radio', { name: 'Escuro' }).click()
    await page.waitForTimeout(300)

    // Alto contraste [data-contrast=high] + 1366x768 e 1440x900
    await page.getByRole('switch', { name: /Modo Alto Contraste/i }).click()
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high')
    await page.waitForTimeout(300)
    await salvarCaptura('18-config-aparencia-hc-1366.png')
    relatorio.push(await auditarPagina(page, 'config-aparencia-hc', '1366x768', 'high'))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?source-test=1#/config/provedores')
    await expect(page.getByRole('heading', { name: 'Provedores e Tarefas de IA' })).toBeVisible()
    await salvarCaptura('20-config-provedores-hc-1440.png')
    relatorio.push(await auditarPagina(page, 'config-provedores-hc', '1440x900', 'high'))

    // Restaura alto contraste desligado
    await page.goto('/?source-test=1#/config/aparencia')
    await page.getByRole('switch', { name: /Modo Alto Contraste/i }).click()

    await testInfo.attach('ui-baseline-audit.json', {
      body: JSON.stringify(
        {
          erros,
          shellChecks: { antesF6, depoisF6, urlAposCtrlJ, urlAposFecharMenu },
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
