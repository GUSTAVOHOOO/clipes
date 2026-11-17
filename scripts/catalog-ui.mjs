import assert from 'node:assert/strict';

export async function testCatalogComponents(page, url) {
  await page.goto(`${url}?catalog-test=update`);
  await page.getByRole('button', { name: 'Componentes' }).click();
  await page.getByRole('heading', { name: 'Componentes' }).waitFor();

  const card = page.locator('[data-model-catalog]');
  await card.waitFor();
  assert.match(await card.innerText(), /Versão 1 · embutido \(offline\)/);

  // Instala o TTS PT-BR 24L na v1 antes de atualizar o catálogo.
  const pt24 = page.locator('[data-tts-model="portuguese_24l"]');
  await pt24.getByRole('button', { name: 'Baixar modelo TTS', exact: true }).click();
  const ttsDialog1 = page.getByRole('alertdialog', { name: 'Baixar modelo TTS?' });
  await ttsDialog1.waitFor();
  await ttsDialog1.getByLabel('Li e aceito o termo de uso proibido do modelo').check();
  await ttsDialog1.getByRole('button', { name: 'Baixar modelo', exact: true }).click();
  await ttsDialog1.waitFor({ state: 'hidden' });
  await pt24.getByText(/Instalado/).waitFor();

  // Verifica atualização do catálogo assinado -> v2.
  await card.getByRole('button', { name: 'Verificar catálogo de modelos', exact: true }).click();
  await card.getByText('Catálogo de modelos atualizado para a versão 2.').waitFor();
  assert.match(await card.innerText(), /Versão 2 · remoto assinado/);

  // Atualiza Whisper small já instalado mediante confirmação explícita.
  const smallCard = page.getByRole('article', { name: /Whisper small/ });
  assert.match(await smallCard.innerText(), /Instalado · atualização disponível/);
  await smallCard.getByRole('button', { name: 'Atualizar modelo', exact: true }).click();
  const modelUpdateDialog = page.getByRole('alertdialog', { name: 'Atualizar o modelo?' });
  await modelUpdateDialog.waitFor();
  await modelUpdateDialog.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await modelUpdateDialog.waitFor({ state: 'hidden' });
  await smallCard.getByRole('button', { name: 'Baixar modelo de novo', exact: true }).waitFor();

  // Atualiza TTS PT-BR 24L já instalado mediante confirmação explícita + termos.
  assert.match(await pt24.innerText(), /Instalado · atualização disponível/);
  await pt24.getByRole('button', { name: 'Atualizar modelo TTS', exact: true }).click();
  const ttsUpdateDialog = page.getByRole('alertdialog', { name: 'Atualizar modelo TTS?' });
  await ttsUpdateDialog.waitFor();
  await ttsUpdateDialog.getByLabel('Li e aceito o termo de uso proibido do modelo').check();
  await ttsUpdateDialog.getByRole('button', { name: 'Atualizar modelo', exact: true }).click();
  await ttsUpdateDialog.waitFor({ state: 'hidden' });
  await pt24.getByRole('button', { name: 'Baixar de novo', exact: true }).waitFor();

  // Assinatura inválida recusa o catálogo remoto e mantém fallback embutido com aviso.
  await page.goto(`${url}?catalog-test=invalid-signature`);
  await page.getByRole('button', { name: 'Componentes' }).click();
  await page.getByRole('heading', { name: 'Componentes' }).waitFor();
  const invalidCard = page.locator('[data-model-catalog]');
  await invalidCard.getByRole('button', { name: 'Verificar catálogo de modelos', exact: true }).click();
  await invalidCard.getByRole('alert').getByText(/Assinatura do catálogo remoto inválida/).waitFor();
  assert.match(await invalidCard.innerText(), /Versão 1 · embutido \(offline\)/);
}
