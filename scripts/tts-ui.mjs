import assert from 'node:assert/strict';

export async function testTtsComponents(page) {
  const pocketCard = page.getByRole('article', { name: /Pocket TTS \(motor de Narração\)/ });
  await pocketCard.waitFor();
  const initialCardText = await pocketCard.innerText();
  assert.match(initialCardText, /MIT/);
  assert.match(initialCardText, /Não instalado/);

  await pocketCard.getByRole('button', { name: 'Baixar Pocket TTS', exact: true }).click();
  const pocketDialog = page.getByRole('alertdialog', { name: 'Baixar o Pocket TTS?' });
  await pocketDialog.waitFor();
  assert.match(await pocketDialog.innerText(), /MIT/);
  await pocketDialog.getByRole('button', { name: 'Baixar', exact: true }).click();
  await pocketDialog.waitFor({ state: 'hidden' });
  await pocketCard.getByText(/Instalado/).waitFor();
  assert.match(await pocketCard.innerText(), /3\.3\.0/);

  const catalog = page.locator('[data-tts-catalog]');
  await catalog.waitFor();
  const pt24 = catalog.locator('[data-tts-model="portuguese_24l"]');
  const pt6 = catalog.locator('[data-tts-model="portuguese"]');
  const enModel = catalog.locator('[data-tts-model="english"]');
  assert.match(await pt24.innerText(), /Em uso como padrão/);
  assert.match(await pt24.innerText(), /CC-BY-4\.0/);
  assert.match(await pt24.innerText(), /13063/);
  assert.match(await enModel.innerText(), /alba/);
  assert.match(await enModel.innerText(), /marius/);
  assert.doesNotMatch(await catalog.innerText(), /\b(rafael|cosette|jean)\b/i);

  await pt24.getByRole('button', { name: 'Baixar modelo TTS', exact: true }).click();
  const modelDialog = page.getByRole('alertdialog', { name: 'Baixar modelo TTS?' });
  await modelDialog.waitFor();
  await modelDialog.locator('[data-tts-prohibited-use]').waitFor();
  const confirmBtn = modelDialog.getByRole('button', { name: 'Baixar modelo', exact: true });
  assert.equal(await confirmBtn.isDisabled(), true, 'exige aceitar o termo de uso proibido antes de baixar');
  await modelDialog.getByLabel('Li e aceito o termo de uso proibido do modelo').check();
  assert.equal(await confirmBtn.isEnabled(), true);
  await confirmBtn.click();
  await modelDialog.waitFor({ state: 'hidden' });
  await pt24.getByText(/Instalado/).waitFor();

  await pt6.getByRole('button', { name: 'Usar como padrão', exact: true }).click();
  await pt6.getByText(/Em uso como padrão/).waitFor();
  await pt24.getByRole('button', { name: 'Usar como padrão', exact: true }).click();
  await pt24.getByText(/Em uso como padrão/).waitFor();

  await catalog.screenshot({ path: 'shots/tts-components.png' });
}

export async function testTtsNarrationLocked(kindReview) {
  const narration = kindReview.locator('[data-narration]');
  await narration.waitFor();
  await narration.locator('[data-narration-locked]').waitFor();
  assert.equal(
    await narration.getByRole('button', { name: 'Gerar Narração', exact: true }).isDisabled(),
    true,
    'trava a Narração até aprovar todos os blocos do Roteiro',
  );
}

export async function testTtsNarrationUnlocked(page, kindReview) {
  const narration = kindReview.locator('[data-narration]');
  await narration.locator('[data-narration-locked]').waitFor({ state: 'detached' });
  const genBtn = narration.getByRole('button', { name: 'Gerar Narração', exact: true });
  assert.equal(await genBtn.isEnabled(), true);
  await genBtn.click();

  await narration.locator('[data-narration-total]').waitFor();
  assert.equal(await narration.locator('[data-narration-duration]').count(), 3);
  assert.match(await narration.locator('[data-narration-total]').innerText(), /9\.60 s/);
  assert.equal(await narration.locator('audio').count(), 3);
  assert.equal(await narration.locator('[data-narration-align-status="aligned"]').count(), 3);
  await narration.getByRole('button', { name: 'Realinhar Narração', exact: true }).click();
  assert.equal(await narration.locator('[data-narration-align-status="aligned"]').count(), 3);

  await narration.screenshot({ path: 'shots/narration-pt-BR.png' });
}

export async function testNarrationDeviationAndTrack(page, url) {
  // Desvio do Roteiro (>= 2 inserções seguidas): painel de revisão libera legenda só após escolha (#81).
  await page.goto(`${url}/?source-test=1&transcript-test=1&narration-deviation=1`);
  const sel = page.getByRole('region', { name: 'Seleção de Cortes' }).first();
  await sel.getByRole('group', { name: 'Tipo de vídeo' }).getByRole('radio', { name: /Vídeo transformado/ }).check();
  await sel.getByRole('button', { name: 'Selecionar Cortes' }).click();
  await sel.getByText(/Seleção com janelas pendentes/).waitFor({ timeout: 15000 });
  const review = sel.getByRole('group', { name: 'Revisão dos candidatos' });
  await review.focus();
  await page.keyboard.press('a');
  const script = review.locator('[data-script]');
  const angles = script.locator('[data-angles]');
  await angles.getByRole('button', { name: 'Sugerir ângulos', exact: true }).click();
  await angles.getByRole('button', { name: 'Escolher Custo da escolha', exact: true }).click();
  await script.getByRole('button', { name: 'Sugerir Roteiro' }).click();
  const blocks = script.locator('[data-script-block]');
  await blocks.nth(0).waitFor();
  for (let i = 0; i < 3; i++) {
    await blocks.nth(i).getByRole('button', { name: 'Aprovar bloco' }).click();
  }
  const narration = review.locator('[data-narration]');
  await narration.getByRole('button', { name: 'Gerar Narração', exact: true }).click();
  await narration.locator('[data-narration-align-status="needs_review"]').waitFor();
  const revBox = narration.locator('[data-narration-review]').first();
  await revBox.waitFor();
  await revBox.getByRole('button', { name: 'Usar texto falado', exact: true }).click();
  await narration.locator('[data-narration-align-status="approved"]').waitFor();

  // Alternância de faixa de legenda no Editor (#81): Narração <-> Original + palavra somente leitura.
  await page.goto(`${url}/?source-test=1&transcript-test=1&editor-test=1&narration-captions=1`);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } })));
  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  await editor.waitFor({ timeout: 10000 });
  await editor.getByRole('button', { name: /^Legenda/ }).click();
  const panel = editor.getByRole('dialog', { name: 'Legenda', exact: true });
  await panel.waitFor();
  const trackSel = panel.locator('[data-captions-track-selector] select');
  await trackSel.waitFor();
  assert.equal(await trackSel.inputValue(), 'narration');
  await panel.getByRole('button', { name: 'Texto', exact: true }).click();
  await panel.locator('[data-captions-readonly-word]').waitFor();
  await trackSel.selectOption('original');
  await panel.getByText('Salvo', { exact: true }).waitFor();
  await panel.getByRole('button', { name: /Frase/ }).first().click();
  await panel.getByLabel('Texto da palavra').waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
}
