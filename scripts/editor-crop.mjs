import assert from 'node:assert/strict';

export async function testEditorCrop(page, url) {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = await mkdtemp(join(tmpdir(), 'clipes-editor-66-'));
  const pattern = '**/__clipes-media__/proxy/*';
  try {
    const media = join(dir, 'frames-16x9.mp4');
    await promisify(execFile)('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=1280x720:rate=24:duration=300,drawbox=x=640:y=0:w=640:h=720:color=blue:t=fill,drawbox=x=620:y=0:w=40:h=720:color=white:t=fill',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', media,
    ]);
    const bytes = await readFile(media);
    await page.route(pattern, route => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      return route.fulfill({
        status: match ? 206 : 200,
        contentType: 'video/mp4',
        headers: { 'Accept-Ranges': 'bytes', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) },
        body: bytes.subarray(start, end + 1),
      });
    });
    await exerciseEditorCrop(page, url);
  } catch (error) {
    await page.screenshot({ path: 'shots/editor-crop-failure.png' });
    throw error;
  } finally {
    await page.unroute(pattern);
    await rm(dir, { recursive: true, force: true });
  }
}

async function exerciseEditorCrop(page, url) {
  await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
  await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1&crop-test=1`);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } })));
  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  const preview = editor.locator('[data-preview-state="ready"][data-crop-active="true"]');
  await preview.waitFor({ timeout: 5000 });
  const video = preview.locator('video');
  await page.waitForFunction(() => (document.querySelector('[data-crop-active="true"] video')?.readyState ?? 0) >= 2 && Boolean(document.querySelector('[data-crop-active="true"] video')?.dataset.cropRect));

  const w = 9 / 16 / (16 / 9);
  const maxX = 1 - w;
  const checkAt = async (proxySeconds, expectedX, label) => {
    await video.evaluate((v, t) => { v.currentTime = t; }, proxySeconds);
    await page.waitForFunction(([target]) => {
      const raw = document.querySelector('[data-crop-active="true"] video')?.dataset.cropRect;
      if (!raw) return false;
      const x = Number(raw.split(',')[0]);
      return Math.abs(x - target) < 0.005;
    }, [expectedX]);
    const style = await video.evaluate(v => ({ transform: v.style.transform, rect: v.dataset.cropRect ?? '' }));
    assert.ok(style.transform.includes('translate3d(') && style.transform.includes('scale('), `${label}: CSS transform aplicado`);
  };

  // Segmento 1 (3600s..3630s): pan linear de x=0 até maxX*0.5 em 3624s (proxy 120s..144s).
  await checkAt(120, 0, 'início do segmento 1');
  await checkAt(132, maxX * 0.25, 'meio do pan linear');
  await checkAt(149.9, maxX * 0.5, 'mantém último keyframe antes do corte seco');
  // Segmento 2 (3630s..3660s): corte seco para x=maxX (proxy 150s).
  await checkAt(150.0, maxX, 'corte seco na troca de cena');

  // Abre a gaveta Enquadrar com F, arrasta o crop sobre a Fonte 16:9 e cria keyframes (#71).
  await page.keyboard.press('f');
  const cropDrawer = editor.getByRole('dialog', { name: 'Enquadrar', exact: true });
  await cropDrawer.waitFor();
  const sourceBox = cropDrawer.locator('[data-crop-source]');
  const handle = cropDrawer.locator('[data-crop-handle]');
  await handle.waitFor();

  // Posiciona no meio do segmento 1 (proxy 130s = 3610s) e arrasta o crop para a direita.
  await video.evaluate(v => { v.currentTime = 130; });
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('[data-source-us]')?.getAttribute('data-source-us')) - 3610_000_000) < 50_000);
  const srcRect = await sourceBox.boundingBox();
  const hRect = await handle.boundingBox();
  await page.mouse.move(hRect.x + hRect.width / 2, hRect.y + hRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(srcRect.x + srcRect.width * 0.72, hRect.y + hRect.height / 2, { steps: 6 });
  assert.equal(await editor.getAttribute('data-undo-count'), '0', 'prévia do arrasto de crop não cria passo');
  const previewRectX = await video.evaluate(v => Number((v.dataset.cropRect ?? '0').split(',')[0]));
  assert.ok(previewRectX > 0.35, `preview reflete o arrasto antes do mouseup (x=${previewRectX})`);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-undo-count="1"]'));
  assert.equal(await cropDrawer.locator('[data-crop-keyframe]').count(), 1, 'mouseup cria 1 keyframe manual');

  // Segmento 2 (não editado) mantém a sugestão automática (x = maxX).
  await checkAt(150.0, maxX, 'segmento 2 não editado preserva sugestão');

  // Segundo keyframe manual em 3620s (proxy 140s) + corte seco manual.
  await video.evaluate(v => { v.currentTime = 140; });
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('[data-source-us]')?.getAttribute('data-source-us')) - 3620_000_000) < 50_000);
  await handle.focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('[data-undo-count="2"]'));
  assert.equal(await cropDrawer.locator('[data-crop-keyframe]').count(), 2);
  await checkAt(135.0, previewRectX * 0.5, 'pan linear entre keyframes manuais');

  const secondKf = cropDrawer.locator('[data-crop-keyframe]').nth(1);
  await secondKf.getByRole('button', { name: 'Corte seco', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-undo-count="3"]'));
  await checkAt(139.9, previewRectX, 'corte seco manual segura valor anterior até o corte');
  await checkAt(140.0, 0, 'corte seco manual salta no limite');

  // Undo e redo pelo mecanismo do editor funcionam para crop.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('[data-undo-count="2"]'));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(() => document.querySelector('[data-undo-count="3"]'));

  // Refazer análise atualiza sugestão (segmento 2 passa a 0.75*maxX) sem apagar keyframes manuais.
  await cropDrawer.getByRole('button', { name: 'Refazer análise', exact: true }).click();
  await checkAt(150.0, maxX * 0.75, 'refazer análise atualiza segmento não editado');
  assert.equal(await cropDrawer.locator('[data-crop-keyframe]').count(), 2, 'refazer análise preserva correções manuais');
  await checkAt(140.0, 0, 'segmento editado mantém correção manual após refazer análise');

  await page.screenshot({ path: 'shots/editor-crop.png' });
  await page.keyboard.press('Escape');
  await cropDrawer.waitFor({ state: 'hidden' });
  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
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
    await testEditorCrop(page, url);
    console.log('Editor crop: OK');
  } finally { await browser?.close(); server.kill(); }
}
