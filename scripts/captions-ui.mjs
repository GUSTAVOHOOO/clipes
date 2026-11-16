import assert from 'node:assert/strict';

export async function testCaptions(page, editor, language) {
  const en = language === 'en';
  const label = en ? 'Captions' : 'Legenda';
  await editor.getByRole('button', { name: new RegExp('^' + label) }).click();
  const panel = editor.getByRole('dialog', { name: label, exact: true });
  await panel.waitFor();
  const preset = panel.getByLabel(en ? 'Preset' : 'Preset');
  await preset.selectOption('cinema');
  await panel.getByText(en ? 'Saved' : 'Salvo', { exact: true }).waitFor();
  const size = panel.getByLabel(en ? 'Font size' : 'Tamanho da fonte', { exact: true });
  await size.fill('72');
  await size.press('Tab');
  await panel.getByText(en ? 'Saved' : 'Salvo', { exact: true }).waitFor();
  const word = panel.getByRole('button', { name: /Frase/ }).first();
  await word.click();
  const text = panel.getByLabel(en ? 'Word text' : 'Texto da palavra');
  await text.fill('Corrigida😀');
  await text.press('Enter');
  await panel.getByText(en ? /Color emoji/ : /Emoji colorido/).waitFor();
  await panel.getByLabel(en ? 'Highlight this word' : 'Destacar esta palavra', { exact: true }).uncheck();
  await panel.getByText(en ? 'Saved' : 'Salvo', { exact: true }).waitFor();
  await preset.selectOption('vertical');
  await panel.getByText(en ? 'Saved' : 'Salvo', { exact: true }).waitFor();
  assert.equal(await text.inputValue(), 'Corrigida😀', 'preset não apaga a correção');
  assert.equal(await panel.getByLabel(en ? 'Highlight this word' : 'Destacar esta palavra', { exact: true }).isChecked(), false, 'preset mantém override');
  await panel.getByRole('button', { name: en ? 'Use as default' : 'Usar como padrão' }).click();
  await panel.getByText(en ? 'Default saved' : 'Padrão salvo', { exact: true }).waitFor();
  await page.screenshot({ path: `shots/captions-${language}.png` });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
}
