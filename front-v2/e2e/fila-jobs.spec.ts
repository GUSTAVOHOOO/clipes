import { expect, test } from '@playwright/test'

test.describe('Painel Global da Fila de Jobs (Ctrl+J)', () => {
  test('cobre Ctrl+J, Esc com retorno de foco, uncertain, retry/discard, orçamento, redo (#304), result e sem Projeto em 1366×768 e 1440×900', async ({
    page,
  }) => {
    const erros: string[] = []
    page.on('pageerror', (erro) => erros.push(erro.message))

    // 1. Sem Projeto aberto em #/inicio -> Ctrl+J mostra estado sem Projeto (mantendo Operações Globais)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/#/inicio')
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible()

    const gatilhoFila = page.getByRole('button', { name: /Fila de jobs:/i })
    await gatilhoFila.focus()
    await page.keyboard.press('Control+j')

    const aside = page.getByRole('complementary', { name: 'Fila de Jobs' })
    await expect(aside).toBeVisible()
    await expect(aside.getByText('Nenhum Projeto aberto')).toBeVisible()
    await expect(page).toHaveURL(/#\/inicio$/)

    // Esc fecha e devolve o foco ao gatilho
    await page.keyboard.press('Escape')
    await expect(aside).toBeHidden()
    await expect(gatilhoFila).toBeFocused()

    // 2. Abre Projeto Demo (jobs realistas da Onda 6) e vai para Cortes
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await page.getByRole('link', { name: 'Cortes' }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)

    // Alerta prioritário no topo do Shell anuncia chamada incerta e pausa de orçamento
    await expect(page.getByText(/1 incerto/i)).toBeVisible()
    await expect(page.getByText(/Orçamento pausado/i)).toBeVisible()

    // Ctrl+J abre gaveta mantendo rota atual ativa à esquerda e sem scroll na janela
    await page.keyboard.press('Control+j')
    await expect(aside).toBeVisible()
    await expect(page).toHaveURL(/#\/projeto\/demo\/cortes$/)

    const rolagem1366 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1366).toEqual({ altura: true, largura: true })

    // Banner uncertain e banner de pausa de orçamento no topo da gaveta
    await expect(
      aside.getByText(/O Clipes nunca as repete automaticamente para evitar cobrança dupla/i),
    ).toBeVisible()
    await expect(aside.getByText(/Provedor sem preço conhecido/i)).toBeVisible()
    await expect(aside.getByText(/ETA indisponível/i)).toBeVisible()

    // #484 / #303: PainelFilaJobs e BarraStatus exibem targetLabel e tempo decorrido de startedAtMs
    const cardRunning = aside.getByTestId('fila-job-1')
    await expect(cardRunning).toContainText('changed.mp4')
    await expect(cardRunning).toContainText(/decorrido \d+/i)
    await expect(aside.getByTestId('fila-job-4')).toContainText('Melhor jogada da live')
    const rodape = page.locator('[data-regiao="rodape"]')
    await expect(rodape).toContainText('changed.mp4')
    await expect(rodape).toContainText(/\d+\s*(s|min|h)/)

    await page.screenshot({ path: 'test-results/fila-jobs-1366.png' })

    // 3. Ajustar orçamento e continuar (cost_unknown -> exige checkbox confirmed: true)
    await aside.getByRole('button', { name: /Ajustar orçamento e continuar/i }).click()
    const dlgOrcamento = page.getByRole('dialog', { name: /Ajustar orçamento e continuar fila/i })
    await expect(dlgOrcamento).toBeVisible()
    const btnSalvarOrc = dlgOrcamento.getByRole('button', {
      name: /Salvar orçamento e retomar fila/i,
    })
    await expect(btnSalvarOrc).toBeDisabled()
    await dlgOrcamento
      .getByRole('checkbox', { name: /preço conhecido/i })
      .click()
    await expect(btnSalvarOrc).toBeEnabled()
    await btnSalvarOrc.click()
    await expect(dlgOrcamento).toBeHidden()
    await expect(aside.getByText(/Orçamento pausou:/i)).toBeHidden()

    // 4. Ver resultado (jobs.result) em ai:script (#4) com JSON recolhido em <details>
    const cardScript = aside.getByTestId('fila-job-4')
    await cardScript.getByRole('button', { name: 'Ver resultado' }).click()
    const dlgResultado = page.getByRole('dialog', { name: /Resultado do job #4/i })
    await expect(dlgResultado).toBeVisible()
    await expect(dlgResultado.getByText(/Concluído com sucesso/i)).toBeVisible()
    await expect(dlgResultado.getByText('Consome a cota do plano', { exact: true })).toBeVisible()
    const summaryJson = dlgResultado.getByText('Expandir JSON completo')
    await expect(summaryJson).toBeVisible()
    await expect(dlgResultado.locator('pre')).toBeHidden()
    await dlgResultado.getByRole('button', { name: 'Fechar' }).last().click()
    await expect(dlgResultado).toBeHidden()

    // 5. Descartar job uncertain (#2 ai:selection) e depois Refazer com outro Perfil (#304)
    const cardIncerto = aside.getByTestId('fila-job-2')
    await cardIncerto.getByRole('button', { name: 'Descartar' }).click()
    const dlgDescartar = page.getByRole('alertdialog', { name: /Descartar chamada incerta #2/i })
    await expect(dlgDescartar).toBeVisible()
    await dlgDescartar.getByRole('button', { name: 'Descartar' }).click()
    await expect(dlgDescartar).toBeHidden()
    await expect(
      aside.getByText(/O Clipes nunca as repete automaticamente para evitar cobrança dupla/i),
    ).toBeHidden()

    // Agora #2 está cancelled e elegível para Refazer com outro Perfil (sem expor ticket #304)
    await aside.getByTestId('fila-job-2').getByRole('button', { name: /Refazer com outro Perfil/i }).click()
    const dlgRedo = page.getByRole('alertdialog', { name: /Refazer job #2 com outro Perfil/i })
    await expect(dlgRedo).toBeVisible()
    await expect(dlgRedo.getByText(/Refazer pela Fila não cria nova Revisão na Bancada/i)).toBeVisible()
    await expect(
      dlgRedo.getByRole('region', { name: /Resumo de custo e privacidade/i }),
    ).toBeVisible()
    await dlgRedo.getByRole('button', { name: /Confirmar e enfileirar/i }).click()
    await expect(dlgRedo).toBeHidden()

    // 6. Recarrega app e reabre Projeto Demo para restaurar job #2 uncertain e testar jobs.estimate -> jobs.retry
    await page.goto('/?reabrir=1#/inicio')
    await page.getByRole('button', { name: /Abrir Projeto Demo/i }).click()
    await expect(page).toHaveURL(/#\/projeto\/demo\/fontes$/)
    await page.getByRole('button', { name: /Fila de jobs:/i }).click()
    await expect(aside).toBeVisible()

    const cardIncertoNovo = aside.getByTestId('fila-job-2')
    await cardIncertoNovo.getByRole('button', { name: 'Ver estimativa e repetir' }).click()
    const dlgRetry = page.getByRole('alertdialog', { name: /Repetir tarefa #2/i })
    await expect(dlgRetry).toBeVisible()
    await expect(
      dlgRetry.getByRole('region', { name: /Resumo de custo e privacidade/i }),
    ).toBeVisible()
    await dlgRetry.getByRole('button', { name: /Repetir tentativa/i }).click()
    await expect(dlgRetry).toBeHidden()
    await expect(
      aside.getByText(/O Clipes nunca as repete automaticamente para evitar cobrança dupla/i),
    ).toBeHidden()

    // 7. Confirma layout 1440×900 sem rolagem horizontal nem vertical da janela e tira screenshot
    await page.setViewportSize({ width: 1440, height: 900 })
    const rolagem1440 = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight <= window.innerHeight,
      largura: document.documentElement.scrollWidth <= window.innerWidth,
    }))
    expect(rolagem1440).toEqual({ altura: true, largura: true })
    await page.screenshot({ path: 'test-results/fila-jobs-1440.png' })

    expect(erros).toEqual([])
  })
})
