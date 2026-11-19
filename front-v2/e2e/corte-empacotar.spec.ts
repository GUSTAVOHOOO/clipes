import { expect, test, type Page } from '@playwright/test'

const VIEWPORTS = [
  { largura: 1366, altura: 768 },
  { largura: 1440, altura: 900 },
] as const

async function irPara(page: Page, hash: string) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

/** Recarrega o app (zera o mock em memória) e abre o Projeto Demo antes de navegar para `hash`. */
async function recarregarDemo(page: Page, hash: string) {
  await page.goto('about:blank')
  await page.goto('/#/inicio')
  await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
  await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
  await irPara(page, hash)
}

async function semScrollHorizontal(page: Page) {
  const r = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    corpo: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(r.documento).toBeLessThanOrEqual(0)
  expect(r.corpo).toBeLessThanOrEqual(0)
}

for (const vp of VIEWPORTS) {
  test.describe(`Tela Empacotar do Corte · ${vp.largura}x${vp.altura}`, () => {
    test('cobre os 10 critérios de aceite da Tela 2 sem pageerror nem scroll horizontal externo', async ({
      page,
    }) => {
      test.setTimeout(120_000)
      const erros: string[] = []
      page.on('pageerror', (erro) => erros.push(erro.message))

      await page.setViewportSize({ width: vp.largura, height: vp.altura })
      await page.goto('/#/inicio')
      await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
      await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)

      // 1. ?estado=vazio: capa vazia e CTA "Sugerir Empacotamento"
      await irPara(page, '#/projeto/demo/corte/201/empacotar?run=2&estado=vazio')
      await expect(page.getByText('Nenhum momento de capa escolhido ainda.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sugerir Empacotamento' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Preencher manualmente' })).toBeDisabled()
      await expect(page.getByText('Preencher manualmente ainda não está disponível.')).toBeAttached()
      await semScrollHorizontal(page)

      // 2. "Sugerir momento da capa" pago: resumo de custo + confirmação antes de enviar
      await irPara(page, '#/projeto/demo/corte/201/empacotar?run=2&thumbnail-paid&packaging-paid')
      await expect(page.getByText('Nenhum momento de capa escolhido ainda.')).toBeVisible()
      await page.getByRole('button', { name: 'Sugerir momento da capa' }).click()
      const dialogoCusto = page.getByRole('alertdialog')
      await expect(dialogoCusto.getByLabel(/Resumo de custo e privacidade/i)).toBeVisible()
      await expect(dialogoCusto.getByRole('button', { name: 'Cancelar' })).toBeFocused()
      await dialogoCusto.getByRole('button', { name: /Confirmar e sugerir/i }).click()
      await expect(dialogoCusto).toBeHidden()
      await expect(page.getByText('Sugerido pelo Provedor').first()).toBeVisible({ timeout: 10_000 })

      // 3. Mover o scrubber e usar o quadro atual como capa
      const slider = page.getByRole('slider', { name: 'Instante da capa' })
      const antes = Number(await slider.getAttribute('aria-valuenow'))
      expect(Number(await slider.getAttribute('aria-valuemin'))).toBeLessThanOrEqual(antes)
      expect(Number(await slider.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(antes)
      await slider.focus()
      await slider.press('PageUp')
      await expect
        .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
        .toBeGreaterThan(antes)
      await page.getByRole('button', { name: 'Usar quadro atual como capa' }).click()
      await expect(page.getByText('Escolhido por você').first()).toBeVisible({ timeout: 10_000 })

      // 4. Salvar capa (PNG): toast "Capa salva"
      await page.getByRole('button', { name: 'Salvar capa (PNG)' }).click()
      const dialogoSalvar = page.getByRole('dialog', { name: /Salvar capa/ })
      await dialogoSalvar.getByRole('textbox', { name: 'Arquivo PNG da capa' }).fill('/test/exports/capa-201.png')
      await dialogoSalvar.getByRole('button', { name: 'Salvar capa' }).click()
      await expect(page.getByText('Capa salva').first()).toBeVisible({ timeout: 10_000 })
      await expect(dialogoSalvar).toBeHidden()

      // 5. Ficha: Sugerir Empacotamento (pago) e contador UTF-8 com crédito protegido
      await page.getByRole('button', { name: 'Sugerir Empacotamento' }).click()
      const dialogoPacote = page.getByRole('alertdialog')
      await expect(dialogoPacote.getByLabel(/Resumo de custo e privacidade/i)).toBeVisible()
      await dialogoPacote.getByRole('button', { name: /Confirmar e sugerir/i }).click()
      const titulo = page.getByRole('textbox', { name: 'Título' })
      await expect(titulo).toBeVisible({ timeout: 10_000 })
      const credito = page.getByRole('textbox', { name: /Crédito da Fonte/ })
      await expect(credito).toHaveAttribute('aria-readonly', 'true')
      const descricao = page.getByRole('textbox', { name: 'Descrição' })
      const [textoDescricao, textoCredito] = await Promise.all([
        descricao.inputValue(),
        credito.innerText(),
      ])
      const esperado = await page.evaluate(
        ([d, c]) => {
          const enc = new TextEncoder()
          return enc.encode(d).length + enc.encode(c).length + 2
        },
        [textoDescricao, textoCredito] as const,
      )
      await expect(page.getByText(`${esperado}/5000 bytes`)).toBeVisible()

      // 7. Capítulos sem 00:00 mostram aviso não bloqueante; salvar continua possível
      await descricao.fill(
        'Texto do usuário.\n\n--- Capítulos ---\n00:05 Introdução\n00:20 Meio\n00:40 Fim\n--- Fim dos capítulos ---',
      )
      await expect(
        page.getByRole('status').filter({ hasText: /primeiro capítulo precisa começar em 00:00/ }),
      ).toBeVisible()
      const salvar = page.getByRole('button', { name: 'Salvar alterações' })
      await expect(salvar).toBeEnabled()
      await descricao.press('Control+s')
      await expect(page.getByText('Alterações salvas').first()).toBeVisible({ timeout: 10_000 })

      // 8. "Atualizar capítulos" preserva o texto fora dos delimitadores (Corte V1 202 com Narração)
      await irPara(page, '#/projeto/demo/corte/202/empacotar?run=2')
      const descricao202 = page.getByRole('textbox', { name: 'Descrição' })
      await expect(descricao202).toBeVisible({ timeout: 10_000 })
      const original = await descricao202.inputValue()
      await descricao202.fill(`Meu texto novo fora dos capítulos.\n\n${original}`)
      await page.getByRole('button', { name: 'Atualizar capítulos' }).click()
      await expect(page.getByText('Capítulos atualizados').first()).toBeVisible({ timeout: 10_000 })
      await expect(descricao202).toHaveValue(/Meu texto novo fora dos capítulos\./)
      await expect(descricao202).toHaveValue(/--- Capítulos ---/)

      // 6. Fonte sem Permissão: alerta e link para a Fonte
      await recarregarDemo(page, '#/projeto/demo/corte/202/empacotar?run=2&packaging-nopermission')
      await expect(page.getByText(/sem Permissão registrada: nenhum crédito será incluído/)).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.getByRole('link', { name: 'Registrar Permissão na Fonte' })).toHaveAttribute(
        'href',
        /#\/projeto\/demo\/fontes\/\d+/,
      )

      // 9a. Corte direto com aviso único: confirmar ciência chama guardrails.ack_direct_notice
      await recarregarDemo(page, '#/projeto/demo/corte/102/empacotar?run=1')
      const ciencia = page.getByRole('checkbox', { name: /Sei que Corte direto/ })
      await expect(ciencia).toBeVisible({ timeout: 10_000 })
      await ciencia.click()
      await expect(ciencia).toHaveCount(0, { timeout: 10_000 })

      // 9b. ?estado=offline: bloqueia preview/PNG/MP4 mantendo a Ficha editável
      await irPara(page, '#/projeto/demo/corte/202/empacotar?run=2&estado=offline')
      await expect(page.getByRole('textbox', { name: 'Título' })).toBeEditable({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: 'Relocalizar Fonte' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Salvar capa (PNG)' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Exportar vídeo (MP4)' })).toBeDisabled()
      await expect(page.getByRole('img', { name: 'Quadro do Corte' })).toHaveCount(0)

      // 10. F6 / Shift+F6 e Tab entre regiões, alvos >= 24 px, sem scroll horizontal externo
      await irPara(page, '#/projeto/demo/corte/202/empacotar?run=2')
      await expect(page.getByRole('textbox', { name: 'Título' })).toBeVisible({ timeout: 10_000 })
      const colunaCapa = page.locator('[data-regiao="empacotar-capa"]')
      const colunaFicha = page.locator('[data-regiao="empacotar-ficha"]')
      await page.getByRole('slider', { name: 'Instante da capa' }).focus()
      await page.keyboard.press('F6')
      await expect
        .poll(() => colunaFicha.evaluate((el) => el.contains(document.activeElement)))
        .toBe(true)
      await page.keyboard.press('Shift+F6')
      await expect
        .poll(() => colunaCapa.evaluate((el) => el.contains(document.activeElement)))
        .toBe(true)
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)

      const pequenos = await page.evaluate(() => {
        const alvos = document.querySelectorAll<HTMLElement>(
          '[data-regiao="empacotar-capa"] button:not(:disabled), [data-regiao="empacotar-capa"] [role="slider"], [data-regiao="empacotar-ficha"] button:not(:disabled), [data-regiao="empacotar-ficha"] a[href]',
        )
        const lista: string[] = []
        for (const el of alvos) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.height < 24 - 0.5 || r.width < 24 - 0.5) {
            lista.push(`${el.textContent?.trim() || el.getAttribute('aria-label')}: ${r.width}x${r.height}`)
          }
        }
        return lista
      })
      expect(pequenos).toEqual([])
      await semScrollHorizontal(page)

      expect(erros).toEqual([])
    })
  })
}
