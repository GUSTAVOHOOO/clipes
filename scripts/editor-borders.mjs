import assert from 'node:assert/strict';

export async function testEditorBorders(page, url) {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = await mkdtemp(join(tmpdir(), 'clipes-editor-70-'));
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
    await exerciseEditorBorders(page, url);
  } catch (error) {
    await page.screenshot({ path: 'shots/editor-borders-failure.png' });
    console.error(await page.locator('[data-start-us]').evaluateAll(nodes => nodes.map(n => ({start:n.getAttribute('data-start-us'),time:n.getAttribute('data-source-us'),text:n.querySelector('[role="alert"]')?.textContent}))));
    throw error;
  } finally {
    await page.unroute(pattern);
    await rm(dir, { recursive: true, force: true });
  }
}

async function exerciseEditorBorders(page, url) {
  await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
  await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1`);
  const open = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } })));
  await open();
  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  const start = editor.locator('[data-edge="start"]');
  await start.waitFor({ timeout: 5000 });
  const preview = editor.locator('[data-preview-state]');
  const video = preview.locator('video');
  await video.waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await start.scrollIntoViewIfNeeded();
  await video.evaluate(v => {
    const frame = (_, metadata) => { v.dataset.decodedTime = String(metadata.mediaTime); v.requestVideoFrameCallback(frame); };
    v.requestVideoFrameCallback(frame);
  });
  const box = await start.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 480, box.y + box.height / 2, { steps: 8 });
  await page.waitForFunction(() => document.querySelector('[data-start-us="3610000000"]'));
  assert.equal(await editor.getAttribute('data-undo-count'), '0', 'prévias não criam passos');
  assert.equal(await editor.locator('[data-preview-state]').getAttribute('data-seek-us'), '3610000000', 'preview acompanha a borda durante o arrasto');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('video')?.dataset.decodedTime) - 130) < 0.001);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-undo-count="1"]'));
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('[data-start-us="3600000000"]'));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(() => document.querySelector('[data-start-us="3610000000"]'));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await page.waitForFunction(() => document.querySelector('[data-start-us="3610000000"]'));
  // Os quatro atalhos não acionam navegação J/K/L, I/O, gavetas ou playhead.
  for (const [key, attr, expected] of [
    ['Alt+Shift+ArrowLeft', 'data-start-us', '3600000000'],
    ['Alt+Shift+ArrowRight', 'data-start-us', '3610000000'],
    ['Alt+Shift+ArrowUp', 'data-end-us', '3650000000'],
    ['Alt+Shift+ArrowDown', 'data-end-us', '3660000000'],
  ]) {
    await page.keyboard.press(key);
    await page.waitForFunction(([attr, expected]) => document.querySelector(`[${attr}="${expected}"]`), [attr, expected]);
    assert.equal(await editor.getAttribute('data-rate'), '0');
    assert.equal(await editor.locator('aside[data-aberta="true"]').count(), 0);
  }
  await start.scrollIntoViewIfNeeded();
  const fineBox = await start.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(fineBox.x + fineBox.width / 2, fineBox.y + fineBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(fineBox.x + fineBox.width / 2 + 17, fineBox.y + fineBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => Number(document.querySelector('[data-start-us]')?.getAttribute('data-start-us')) > 3610000000);
  const fine = Number(await editor.getAttribute('data-start-us'));
  assert.ok(Math.abs(fine / (1e6 / 24) - Math.round(fine / (1e6 / 24))) < 0.0001, 'Alt usa um quadro da Fonte');
  assert.ok(fine < 3620000000, 'Alt solta o encaixe em Frase');
  await page.waitForFunction(fine => Math.abs(Number(document.querySelector('video')?.dataset.decodedTime) * 1e6 + 3480000000 - fine) < 2, fine);
  await page.screenshot({ path: 'shots/editor-borders.png' });
  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  await open();
  await start.waitFor();
  assert.equal(Number(await editor.getAttribute('data-start-us')), fine, 'reabrir restaura o Corte');
  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
}

// Execução focada durante o desenvolvimento; o CI chama a mesma função por ui.mjs.
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
    await testEditorBorders(page, url);
    console.log('Editor borders: OK');
  } finally { await browser?.close(); server.kill(); }
}
