import assert from 'node:assert/strict';

export async function testThumbnailPreview(page, url) {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = await mkdtemp(join(tmpdir(), 'clipes-thumb-249-'));
  const pattern = '**/__clipes-media__/proxy/*';
  try {
    const media = join(dir, 'frames.mp4');
    await promisify(execFile)('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24:duration=300',
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
    await exerciseThumbnailPreview(page, url);
  } finally {
    await page.unroute(pattern);
    await rm(dir, { recursive: true, force: true });
  }
}

async function exerciseThumbnailPreview(page, url) {
  await page.goto(`${url}?source-test=1&transcript-test=1`);
  await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
  await page.reload();

  const selection = page.getByRole('region', { name: 'Seleção de Cortes' }).first();
  await selection.getByRole('button', { name: 'Selecionar Cortes' }).click();
  await selection.getByText(/Seleção com janelas pendentes/).waitFor({ timeout: 15000 });

  const review = selection.getByRole('group', { name: 'Revisão dos candidatos' });
  await review.waitFor();
  await review.focus();
  await page.keyboard.press('a');

  const cover = review.locator('[data-thumbnail]');
  await cover.waitFor();
  const useBtn = cover.getByRole('button', { name: 'Usar o instante do preview como capa' });
  assert.equal(await useBtn.isDisabled(), true, 'botão fica desabilitado antes do preview emitir tempo');

  await page.evaluate(() => {
    window.__previewTimes = [];
    window.addEventListener('clipes-preview-time', e => {
      window.__previewTimes.push(e.detail);
    });
  });

  // 1. Carregar metadados: abre o preview a partir da Capa e emite o início do Corte (60 s).
  await cover.getByRole('button', { name: 'Abrir preview do Corte' }).click();
  const cutPreview = page.getByRole('region', { name: 'Preview do Corte' });
  await cutPreview.locator('video').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector('[aria-label="Preview do Corte"] video')?.readyState ?? 0) >= 2);
  await page.waitForFunction(() => window.__previewTimes.some(e => e.source_id === 1 && e.us === 60_000_000));
  await cover.locator('[data-thumbnail-preview-time]').getByText('01:00', { exact: true }).waitFor();
  assert.equal(await useBtn.isEnabled(), true, 'carregar metadados dentro do Corte habilita o botão');

  // 2. Seek fora do Corte (30 s, ainda na janela do proxy): emite o tempo e desabilita o botão.
  const slider = cutPreview.getByRole('slider', { name: 'Posição no preview' });
  await slider.fill('30');
  await page.waitForFunction(() => window.__previewTimes.at(-1)?.us === 30_000_000);
  await cover.locator('[data-thumbnail-preview-time]').getByText('00:30', { exact: true }).waitFor();
  assert.equal(await useBtn.isDisabled(), true, 'fora do Corte [60s, 120s] o botão fica desabilitado');

  // 3. Seek dentro do Corte (85 s): emite o tempo e reabilita o botão.
  await slider.fill('85');
  await page.waitForFunction(() => window.__previewTimes.at(-1)?.us === 85_000_000);
  await cover.locator('[data-thumbnail-preview-time]').getByText('01:25', { exact: true }).waitFor();
  assert.equal(await useBtn.isEnabled(), true);

  // 4. Reprodução e pausa dentro do Corte: timeupdate e pause emitem o instante atual.
  await cutPreview.getByRole('button', { name: 'Reproduzir' }).click();
  await page.waitForFunction(() => (window.__previewTimes.at(-1)?.us ?? 0) > 85_200_000, null, { timeout: 5000 });
  const countBeforePause = await page.evaluate(() => window.__previewTimes.length);
  await cutPreview.getByRole('button', { name: 'Pausar' }).click();
  await page.waitForFunction(n => window.__previewTimes.length > n, countBeforePause);
  const pausedEvent = await page.evaluate(() => window.__previewTimes.at(-1));
  assert.equal(pausedEvent.source_id, 1);
  assert.ok(Number.isInteger(pausedEvent.us), 'instante emitido é inteiro em microssegundos');
  assert.ok(pausedEvent.us > 85_200_000 && pausedEvent.us <= 120_000_000, `instante pausado dentro do Corte: ${pausedEvent.us}`);

  // 5. Escolher o instante do preview e exportar o PNG da capa.
  await useBtn.click();
  await cover.getByRole('status').getByText('Escolha registrada.', { exact: true }).waitFor();
  assert.equal(await cover.locator('[data-thumbnail-current]').getAttribute('data-thumbnail-current'), String(pausedEvent.us));
  await cover.getByRole('button', { name: 'Salvar capa (PNG)' }).click();
  await cover.getByRole('status').getByText('Capa salva.', { exact: true }).waitFor();

  // 6. Ir para fora do Corte e voltar ao momento escolhido via "Ver este momento no preview" (clipes-preview-seek).
  await slider.fill('30');
  await page.waitForFunction(() => window.__previewTimes.at(-1)?.us === 30_000_000);
  assert.equal(await useBtn.isDisabled(), true);
  await cover.getByRole('button', { name: 'Ver este momento no preview' }).click();
  await page.waitForFunction(expected => window.__previewTimes.at(-1)?.us === expected, pausedEvent.us);
  assert.equal(await useBtn.isEnabled(), true);
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const { chromium } = await import('playwright');
  const sock = createServer();
  await new Promise(r => sock.listen(0, '127.0.0.1', r));
  const port = sock.address().port;
  await new Promise(r => sock.close(r));
  const url = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_CORE_MOCK: '1' }, stdio: 'inherit' });
  let browser;
  try {
    for (let i = 0; ; i++) {
      try { await fetch(url); break; } catch { if (i === 100) throw Error('server'); await new Promise(r => setTimeout(r, 200)); }
    }
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await testThumbnailPreview(page, url);
    assert.deepEqual(errors, []);
    console.log('Thumbnail preview UI: OK');
  } finally {
    await browser?.close();
    srv.kill();
  }
}
