import assert from 'node:assert/strict';

export async function testPackagingChapters(page, url) {
  await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
  await page.goto(`${url}?source-test=1&transcript-test=1&packaging-chapters=1`);

  // Garante Vídeo transformado na seleção.
  const region = page.getByRole('region', { name: 'Seleção de Cortes' }).first();
  await region.getByRole('radio', { name: /Vídeo transformado/ }).check();
  await region.getByRole('button', { name: 'Selecionar Cortes' }).click();
  await region.getByText(/Seleção com janelas pendentes/).waitFor({ timeout: 15000 });

  const review = region.getByRole('group', { name: 'Revisão dos candidatos' });
  await review.focus();
  await page.keyboard.press('a');

  const pack = review.locator('[data-packaging]');
  await pack.locator('[data-packaging-chapters-warning="script_not_approved"]').waitFor();

  // Escolhe ângulo, gera Roteiro e aprova os 3 blocos -> aviso muda para narration_required.
  const script = review.locator('[data-script]');
  const angles = script.locator('[data-angles]');
  await angles.getByRole('button', { name: 'Sugerir ângulos', exact: true }).click();
  await angles.getByRole('button', { name: 'Escolher Custo da escolha', exact: true }).click();
  await script.getByRole('button', { name: 'Sugerir Roteiro' }).click();
  await script.locator('[data-script-block]').first().waitFor();
  for (let i = 0; i < 3; i += 1) {
    await script.locator('[data-script-block]').nth(i).getByRole('button', { name: 'Aprovar bloco' }).click();
  }
  await pack.locator('[data-packaging-chapters-warning="narration_required"]').waitFor();

  // Gera Narração com 12 s por bloco (36 s total) -> capítulos prontos.
  const narration = review.locator('[data-narration]');
  await narration.getByRole('button', { name: 'Gerar Narração', exact: true }).click();
  await narration.locator('[data-narration-total]').waitFor();
  await pack.locator('[data-packaging-chapters-warning]').waitFor({ state: 'detached' });

  // Gera Empacotamento -> descrição já traz o bloco delimitado editável.
  await pack.getByRole('button', { name: 'Gerar título, descrição e tags', exact: true }).click();
  const refreshBtn = pack.locator('[data-refresh-chapters]');
  await refreshBtn.waitFor();
  const desc = pack.getByLabel(/^Descrição/);
  const initialDesc = await desc.inputValue();
  assert.match(initialDesc, /--- Capítulos ---\n00:00 Bloco 1\n00:12 Bloco 2\n00:24 Bloco 3\n--- Fim dos capítulos ---/);

  // Quebrar regra do YouTube na edição salva normalmente e mostra aviso não-bloqueante.
  await desc.fill('Resumo inicial.\n\n--- Capítulos ---\n00:05 Bloco 1\n00:12 Bloco 2\n--- Fim dos capítulos ---');
  await pack.getByRole('button', { name: 'Salvar edições', exact: true }).click();
  await pack.getByRole('status').filter({ hasText: 'Edições salvas.' }).waitFor();
  await pack.locator('[data-chapter-edit-warning="first_chapter_not_zero"]').waitFor();
  await pack.locator('[data-chapter-edit-warning="too_few_chapters"]').waitFor();

  // Atualizar capítulos reescreve SÓ o bloco delimitado, preservando texto antes e depois.
  await desc.fill('Meu resumo editado.\n\n--- Capítulos ---\n00:05 Bloco 1\n--- Fim dos capítulos ---\n\nMeu rodapé.');
  await refreshBtn.click();
  await pack.getByRole('status').filter({ hasText: 'Capítulos atualizados.' }).waitFor();
  const refreshedDesc = await desc.inputValue();
  assert.match(refreshedDesc, /^Meu resumo editado\.\n\n--- Capítulos ---\n00:00 Bloco 1\n00:12 Bloco 2\n00:24 Bloco 3\n--- Fim dos capítulos ---\n\nMeu rodapé\.$/);
  await pack.locator('[data-packaging-chapters-edit-warnings]').waitFor({ state: 'detached' });

  // Se o usuário apagou os delimitadores, o botão avisa e não faz nada.
  await desc.fill('Resumo sem delimitadores.');
  await refreshBtn.click();
  await pack.getByRole('alert').filter({ hasText: /delimitadores de capítulos foram removidos/ }).waitFor();
  assert.equal(await desc.inputValue(), 'Resumo sem delimitadores.');

  await pack.screenshot({ path: 'shots/packaging-chapters-pt-BR.png' });
}
