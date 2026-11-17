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

  await narration.screenshot({ path: 'shots/narration-pt-BR.png' });
}
