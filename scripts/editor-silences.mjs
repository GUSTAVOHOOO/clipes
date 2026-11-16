import assert from 'node:assert/strict';

export async function testEditorSilencesPanel(page, editor, language) {
  const en = language === 'en';
  const label = en ? 'Silences' : 'Silêncios';
  await editor.getByRole('button', { name: new RegExp('^' + label) }).click();
  const panel = editor.getByRole('dialog', { name: label, exact: true });
  await panel.waitFor();

  const slider = panel.getByLabel(en ? 'Minimum silence (ms)' : 'Silêncio mínimo (ms)');
  assert.equal(await slider.inputValue(), '600');
  assert.equal(await slider.getAttribute('min'), '300');
  assert.equal(await slider.getAttribute('max'), '2000');

  await panel.getByRole('button', { name: en ? 'Apply silences' : 'Aplicar silêncios' }).click();
  await panel.locator('[data-silences-summary]').waitFor();
  const initialCount = await panel.locator('[data-silence-item]').count();
  assert.ok(initialCount >= 2, 'esperava trechos detectados em 600 ms');
  const removedAt600 = Number(await editor.getAttribute('data-silences-removed-us'));
  assert.ok(removedAt600 > 0, 'tempo removido > 0');

  // Ajustar limite para 400 ms inclui pausas de 450 ms.
  await slider.fill('400');
  await page.waitForFunction(n => document.querySelectorAll('[data-silence-item]').length > n, initialCount);
  const countAt400 = await panel.locator('[data-silence-item]').count();
  assert.ok(countAt400 > initialCount, 'limite menor encontra mais silêncios');

  // Ajustar limite para 1500 ms zera as detecções.
  await slider.fill('1500');
  await page.waitForFunction(() => document.querySelectorAll('[data-silence-item]').length === 0);

  // Volta a 600 ms para testar reversão parcial, total e Ctrl+Z.
  await slider.fill('600');
  await page.waitForFunction(n => document.querySelectorAll('[data-silence-item]').length === n, initialCount);
  const timelineCut = editor.locator('[data-silence-cut="1"]');
  await timelineCut.waitFor();
  assert.equal(await timelineCut.getAttribute('data-silence-status'), 'active');

  // Reverte só o primeiro trecho pelo botão da lista.
  const firstItem = panel.locator('[data-silence-item="1"]');
  await firstItem.getByRole('button', { name: en ? 'Revert' : 'Reverter' }).click();
  await page.waitForFunction(() => document.querySelector('[data-silence-item="1"]')?.getAttribute('data-silence-status') === 'reverted');
  assert.equal(await timelineCut.getAttribute('data-silence-status'), 'reverted');
  const removedAfterOne = Number(await editor.getAttribute('data-silences-removed-us'));
  assert.ok(removedAfterOne < removedAt600, 'reverter um trecho reduz o tempo removido');

  // Ctrl+Z desfaz a reversão do trecho.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('[data-silence-item="1"]')?.getAttribute('data-silence-status') === 'active');

  // Reverter tudo e reaplicar tudo.
  await panel.getByRole('button', { name: en ? 'Revert all' : 'Reverter tudo' }).click();
  await page.waitForFunction(() => document.querySelector('[data-silences-removed-us="0"]'));
  await panel.getByRole('button', { name: en ? 'Reapply all' : 'Reaplicar tudo' }).click();
  await page.waitForFunction(v => Number(document.querySelector('[data-silences-removed-us]')?.getAttribute('data-silences-removed-us')) === v, removedAt600);

  await page.screenshot({ path: `shots/editor-silences-${language}.png` });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await panel.getByRole('button', { name: 'Apply silences' }).count().catch(() => {});
  // Reverte tudo ao final para não interferir nos testes de bordas que vêm em seguida.
  await page.keyboard.press('s');
  await panel.waitFor();
  await panel.getByRole('button', { name: en ? 'Revert all' : 'Reverter tudo' }).click();
  await page.waitForFunction(() => document.querySelector('[data-silences-removed-us="0"]'));
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
}

export async function testEditorSilencesPreview(page, url) {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = await mkdtemp(join(tmpdir(), 'clipes-editor-77-'));
  const pattern = '**/__clipes-media__/proxy/*';
  try {
    const media = join(dir, 'frames.mp4');
    await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24:duration=300', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', media]);
    const bytes = await readFile(media);
    await page.route(pattern, route => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      return route.fulfill({ status: match ? 206 : 200, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
    });

    await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
    await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1`);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } })));
    const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
    await editor.waitFor({ timeout: 10000 });
    const video = editor.locator('[data-preview-state] video');
    await video.waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);

    await page.keyboard.press('s');
    const panel = editor.getByRole('dialog', { name: 'Silêncios', exact: true });
    await panel.waitFor();
    await panel.getByRole('button', { name: 'Aplicar silêncios' }).click();
    await panel.locator('[data-silences-summary]').waitFor();
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });

    // O primeiro corte ativo da Frase 361 está em [3605.120s, 3605.720s] (proxy: 125.120s..125.720s).
    await video.evaluate(v => { v.currentTime = 125.2; void v.play(); });
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) >= 125.7, null, { timeout: 5000 });
    await page.keyboard.press('k');
    await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
  } finally {
    await page.unroute(pattern);
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const { mkdir } = await import('node:fs/promises');
  const { chromium } = await import('playwright');
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_CORE_MOCK: '1' }, stdio: 'inherit' });
  let browser;
  try {
    for (let i = 0; ; i++) {
      try { await fetch(url); break; } catch { if (i === 100) throw Error('server did not start'); await new Promise(r => setTimeout(r, 200)); }
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(url);
    await mkdir('shots', { recursive: true });
    await testEditorSilencesPreview(page, url);
    console.log('Editor silences: OK');
  } finally { await browser?.close(); server.kill(); }
}
