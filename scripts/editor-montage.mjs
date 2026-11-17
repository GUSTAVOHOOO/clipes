import assert from 'node:assert/strict';

export async function testEditorMontage(page, url) {
  await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
  await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1&montage-test=1`);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } }),
    ),
  );
  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  await editor.waitFor({ timeout: 10000 });
  const track = editor.locator('[data-row="narration"]');
  await track.waitFor();

  const b1 = track.locator('[data-narration-block="101"]');
  const b2 = track.locator('[data-narration-block="102"]');
  const b3 = track.locator('[data-narration-block="103"]');
  assert.equal(await b1.getAttribute('data-narration-start-us'), '0');
  assert.equal(await b2.getAttribute('data-narration-start-us'), '12300000');
  assert.equal(await b2.getAttribute('data-narration-pushed-us'), '2300000');
  assert.equal(await b3.getAttribute('data-narration-start-us'), '22600000');
  assert.equal(await b3.getAttribute('data-narration-mode'), 'automatic');

  // Arrasta o bloco 3 para o fim do Corte (+1315 px ≈ +27,4 s -> encaixa em 50 s da saída -> sobra de 5 s).
  await b3.scrollIntoViewIfNeeded();
  const box = await b3.boundingBox();
  const startX = box.x + 24;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 1315, startY, { steps: 10 });
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'manual',
  );
  assert.equal(await editor.getAttribute('data-undo-count'), '0', 'prévia do arrasto não cria passo no undo');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-undo-count="1"]'));
  assert.equal(await b3.getAttribute('data-narration-start-us'), '50000000');
  assert.equal(await editor.getAttribute('data-montage-freeze-tail-us'), '5000000');
  await editor.locator('[data-montage-warning="freeze_tail"]').waitFor();
  await track.locator('[data-montage-freeze-tail]').waitFor();
  await page.screenshot({ path: 'shots/editor-montage.png' });

  // Ctrl+Z desfaz o arrasto e Ctrl+Shift+Z refaz.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'automatic',
  );
  assert.equal(await editor.getAttribute('data-montage-freeze-tail-us'), '0');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'manual',
  );

  // Botão "Voltar ao automático" limpa o ajuste manual.
  await track.locator('[data-narration-reset="103"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'automatic',
  );
  assert.equal(await editor.getAttribute('data-montage-freeze-tail-us'), '0');

  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
}
