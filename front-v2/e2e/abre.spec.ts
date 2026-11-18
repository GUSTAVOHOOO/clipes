import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1366, height: 768 } })

test('abre o app em 1366x768 sem pageerror', async ({ page }) => {
  const erros: string[] = []
  page.on('pageerror', (erro) => {
    erros.push(erro.message)
  })

  await page.goto('/')
  await expect(page.getByText('Clipes', { exact: true })).toBeVisible()
  expect(erros).toEqual([])
})
