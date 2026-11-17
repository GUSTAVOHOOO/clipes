import assert from 'node:assert/strict';

export async function testEditorMontage(page, url) {
  await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
  await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1&montage-test=1`);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } }),
    ),
  );
  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  await editor.waitFor({ timeout: 10000 });
  const track = editor.locator('[data-row="narration"]');
  await track.waitFor();

  const b1 = track.locator('[data-narration-block="101"]');
  const b2 = track.locator('[data-narration-block="102"]');
  const b3 = track.locator('[data-narration-block="103"]');
  assert.equal(await b1.getAttribute('data-narration-start-us'), '0');
  assert.equal(await b2.getAttribute('data-narration-start-us'), '12300000');
  assert.equal(await b2.getAttribute('data-narration-pushed-us'), '2300000');
  assert.equal(await b3.getAttribute('data-narration-start-us'), '22600000');
  assert.equal(await b3.getAttribute('data-narration-mode'), 'automatic');

  // Arrasta o bloco 3 para o fim do Corte (+1315 px ≈ +27,4 s -> encaixa em 50 s da saída -> sobra de 5 s).
  await b3.scrollIntoViewIfNeeded();
  const box = await b3.boundingBox();
  const startX = box.x + 24;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 1315, startY, { steps: 10 });
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'manual',
  );
  assert.equal(await editor.getAttribute('data-undo-count'), '0', 'prévia do arrasto não cria passo no undo');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-undo-count="1"]'));
  assert.equal(await b3.getAttribute('data-narration-start-us'), '50000000');
  assert.equal(await editor.getAttribute('data-montage-freeze-tail-us'), '5000000');
  await editor.locator('[data-montage-warning="freeze_tail"]').waitFor();
  await track.locator('[data-montage-freeze-tail]').waitFor();
  await page.screenshot({ path: 'shots/editor-montage.png' });

  // Ctrl+Z desfaz o arrasto e Ctrl+Shift+Z refaz.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'automatic',
  );
  assert.equal(await editor.getAttribute('data-montage-freeze-tail-us'), '0');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'manual',
  );

  // Botão "Voltar ao automático" limpa o ajuste manual.
  await track.locator('[data-narration-reset="103"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-narration-block="103"]')?.getAttribute('data-narration-mode') === 'automatic',
  );
  assert.equal(await editor.getAttribute('data-montage-freeze-tail-us'), '0');

  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
}

export async function testEditorDucking(page, url) {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), 'clipes-duck-82-'));
  const proxyPattern = '**/__clipes-media__/proxy/*';
  const narrationPattern = '**/__clipes-media__/narration/*';

  try {
    const proxyMp4 = join(dir, 'proxy.mp4');
    const narWav = join(dir, 'nar.wav');
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24:duration=200',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=200',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '1', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', proxyMp4,
    ]);
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=24000:duration=15',
      '-c:a', 'pcm_s16le', narWav,
    ]);
    const proxyBytes = await readFile(proxyMp4);
    const narBytes = await readFile(narWav);

    const serveBytes = (route, bytes, contentType) => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      return route.fulfill({
        status: match ? 206 : 200,
        contentType,
        headers: {
          'Accept-Ranges': 'bytes',
          ...(match ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
        },
        body: bytes.subarray(start, end + 1),
      });
    };

    await page.route(proxyPattern, route => serveBytes(route, proxyBytes, 'video/mp4'));
    await page.route(narrationPattern, route => serveBytes(route, narBytes, 'audio/wav'));

    await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
    await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1&montage-test=1&duck-test=1`);
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } }),
      ),
    );
    const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
    await editor.waitFor({ timeout: 10000 });
    const preview = editor.locator('[data-preview-state="ready"]');
    await preview.waitFor({ timeout: 10000 });
    const video = preview.locator('video');
    await page.waitForFunction(() => (document.querySelector('[data-preview-state="ready"] video')?.readyState ?? 0) >= 2);

    // O proxy começa em 3480 s; Corte cobre 3600..3660 s (proxy: 120..180 s).
    // Bloco 101 toca em output 0..12 s (proxy 120..132 s) -> ducking ativo (~ -12 dB = 0.251).
    await video.evaluate(v => { v.currentTime = 125; });
    await page.waitForFunction(() => document.querySelector('[data-ducking]')?.getAttribute('data-ducking') === 'true');
    const duckedVol = await video.evaluate(v => v.volume);
    assert.ok(Math.abs(duckedVol - 0.2512) < 0.02, `volume ducked esperado ~0.251, obtido ${duckedVol}`);
    assert.equal(await preview.getAttribute('data-narration-active-block'), '101');

    // Após o bloco 103 (output 37.6..60 s -> proxy 157.6..180 s), sem Narração -> volume volta a 1.0.
    await video.evaluate(v => { v.currentTime = 162; });
    await page.waitForFunction(() => document.querySelector('[data-ducking]')?.getAttribute('data-ducking') === 'false');
    const fullVol = await video.evaluate(v => v.volume);
    assert.equal(fullVol, 1);

    // Reprodução dentro do bloco 101 ativa o <audio> correspondente em sincronia com o vídeo.
    await video.evaluate(v => { v.currentTime = 122; void v.play(); });
    await page.waitForFunction(() => {
      const a = document.querySelector('[data-preview-narration-audio="101"]');
      return a && !a.paused && a.currentTime >= 1.8 && a.currentTime <= 4.0;
    }, null, { timeout: 5000 });
    await page.keyboard.press('k');

    await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
  } finally {
    await page.unroute(proxyPattern);
    await page.unroute(narrationPattern);
    await rm(dir, { recursive: true, force: true });
  }
}
