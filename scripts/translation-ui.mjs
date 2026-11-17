import assert from 'node:assert/strict';

export async function testTranslation(page, editor, language) {
  const en = language === 'en';
  const label = en ? 'Translation' : 'Tradução';
  await editor.getByRole('button', { name: new RegExp('^' + label) }).click();
  const panel = editor.getByRole('dialog', { name: label, exact: true });
  await panel.waitFor();

  const translateBtn = panel.getByRole('button', { name: en ? 'Translate captions' : 'Traduzir legenda' });
  await translateBtn.waitFor();
  await translateBtn.click();

  const firstInput = panel.locator('[data-translation-sentence="1"] input');
  await firstInput.waitFor();
  assert.equal(await firstInput.inputValue(), 'Translated sentence 1');

  const originalBtn = panel.getByRole('button', { name: en ? 'Original' : 'Original', exact: true });
  const translatedBtn = panel.getByRole('button', { name: en ? 'Translated (EN)' : 'Traduzida (EN)', exact: true });
  assert.equal(await originalBtn.getAttribute('aria-pressed'), 'true');

  await translatedBtn.click();
  assert.equal(await translatedBtn.getAttribute('aria-pressed'), 'true');

  await firstInput.fill('Edited line 1');
  await panel.locator('[data-translation-sentence="1"]').getByRole('button', { name: en ? 'Save' : 'Salvar' }).click();
  await panel.getByText(en ? 'Translation saved.' : 'Tradução salva.', { exact: true }).waitFor();
  await panel.locator('[data-translation-sentence="1"]').getByText(en ? 'Edited' : 'Editada', { exact: true }).waitFor();
  assert.match(await panel.locator('[data-translation-original="1"]').innerText(), /Frase 1 original/);

  await originalBtn.click();
  assert.equal(await originalBtn.getAttribute('aria-pressed'), 'true');

  await page.screenshot({ path: `shots/translation-${language}.png` });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
}

export async function testTranslationBlocked(page, url) {
  await page.goto(`${url}/?source-test=1&transcript-test=1&editor-test=1&translation-nopermission=1`);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } })));
  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  await editor.waitFor({ timeout: 10000 });
  await editor.getByRole('button', { name: /^Tradução/ }).click();
  const panel = editor.getByRole('dialog', { name: 'Tradução', exact: true });
  await panel.waitFor();
  await panel.locator('[data-translation-blocked]').waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Traduzir legenda' }).count(), 0);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
}
