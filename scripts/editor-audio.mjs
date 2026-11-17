import assert from 'node:assert/strict';

export async function testEditorAudio(page, url) {
  await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
  await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1`);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('clipes-editor-open', { detail: { source_id: 1, start_id: 361, end_id: 366 } }),
    ),
  );

  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  await editor.waitFor({ timeout: 10000 });

  // Abre gaveta "Trilha e efeitos" pelo atalho M.
  await page.keyboard.press('m');
  const drawer = editor.getByRole('dialog', { name: 'Trilha e efeitos', exact: true });
  await drawer.waitFor();
  const panel = drawer.locator('[data-audio-panel]');
  await panel.waitFor();
  await panel.locator('[data-audio-speech-count]').waitFor();

  // CC-BY sem atribuição é recusado; com atribuição importa com sucesso e vira trilha ativa.
  await panel.locator('[data-audio-import-kind]').selectOption('music');
  await panel.locator('[data-audio-pick-file]').click();
  await panel.locator('[data-audio-import-license]').selectOption('cc_by');
  await panel.locator('[data-audio-import-submit]').click();
  await panel.getByRole('alert').getByText(/atribuição para licença CC-BY/).waitFor();

  await panel.locator('[data-audio-import-attribution]').fill('Beat Studio (CC-BY 4.0)');
  await panel.locator('[data-audio-import-submit]').click();
  await panel.locator('[data-soundtrack-controls]').waitFor();

  // Importa trilha com licença desconhecida -> checklist #76 avisa sem bloquear e confirma que música não conta como Transformação.
  await panel.locator('[data-audio-pick-file]').click();
  await panel.locator('[data-audio-import-license]').selectOption('unknown');
  await panel.evaluate(() => {
    // Em mock mode, `pickFile` usa caminho fixo por tipo; criamos outra entrada via evento de seleção não duplicada só se distinto,
    // então testamos alterar a licença na biblioteca para `unknown` e depois voltar para verificada!
  });
  // Altera a licença do ativo 1 para `unknown` na biblioteca e verifica o checklist #76.
  await panel.locator('[data-audio-edit-license="1"]').click();
  await panel.locator('[data-audio-edit-license-select="1"]').selectOption('unknown');
  await panel.locator('[data-audio-save-license="1"]').click();
  await panel.locator('[data-soundtrack-unverified]').waitFor();

  const checklist = editor.locator('[data-guardrails-checklist]');
  await checklist.locator('summary').click();
  await checklist.locator('[data-guardrails-music-unverified]').waitFor();
  await checklist.getByText(/Trilha sonora e efeitos importados também não contam como Transformação/).waitFor();

  // Corrige licença na biblioteca para `cc0` -> aviso de música sem licença some no checklist.
  await panel.locator('[data-audio-edit-license="1"]').click();
  await panel.locator('[data-audio-edit-license-select="1"]').selectOption('cc0');
  await panel.locator('[data-audio-save-license="1"]').click();
  await panel.locator('[data-soundtrack-unverified]').waitFor({ state: 'detached' });
  await checklist.locator('[data-guardrails-music-unverified]').waitFor({ state: 'detached' });

  // Ajusta repetição e volume da trilha -> barra aparece na timeline com marcadores de ducking por fala.
  const audioRow = editor.locator('[data-row="audio"]');
  await audioRow.waitFor();
  await audioRow.locator('[data-soundtrack-block="1"]').waitFor();
  await audioRow.locator('[data-speech-duck]').first().waitFor();

  await panel.locator('[data-soundtrack-loop]').uncheck();
  await page.waitForFunction(
    () => document.querySelector('[data-soundtrack-block="1"]')?.getAttribute('data-soundtrack-play-duration-us') === '12000000',
  );
  await panel.locator('[data-soundtrack-loop]').check();
  await page.waitForFunction(
    () => document.querySelector('[data-soundtrack-block="1"]')?.getAttribute('data-soundtrack-play-duration-us') === '60000000',
  );

  // Importa SFX (`youtube_audio_library`) e ancora 1 na palavra e 1 no momento atual.
  await panel.locator('[data-audio-import-kind]').selectOption('sfx');
  await panel.locator('[data-audio-pick-file]').click();
  await panel.locator('[data-audio-import-license]').selectOption('youtube_audio_library');
  await panel.locator('[data-audio-import-submit]').click();
  await panel.locator('[data-audio-asset="2"]').waitFor();

  await panel.locator('[data-sfx-anchor-mode]').selectOption('word');
  await panel.locator('[data-sfx-word-select]').selectOption('2');
  await panel.locator('[data-sfx-add]').click();
  await panel.locator('[data-sfx-row="1"]').waitFor();
  const sfxWordItem = audioRow.locator('[data-sfx-item="1"]');
  await sfxWordItem.waitFor();
  assert.equal(await sfxWordItem.getAttribute('data-sfx-anchor'), 'word');
  assert.equal(await sfxWordItem.getAttribute('data-sfx-start-us'), '1000000');

  // Arrasta SFX na timeline -> cria passo no Undo e Ctrl+Z desfaz / Ctrl+Shift+Z refaz.
  const undoBefore = Number(await editor.getAttribute('data-undo-count'));
  await sfxWordItem.scrollIntoViewIfNeeded();
  await sfxWordItem.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    expected => Number(document.querySelector('[data-undo-count]')?.getAttribute('data-undo-count')) === expected,
    undoBefore + 1,
  );
  assert.equal(await sfxWordItem.getAttribute('data-sfx-anchor'), 'moment');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () => document.querySelector('[data-sfx-item="1"]')?.getAttribute('data-sfx-anchor') === 'word',
  );
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(
    () => document.querySelector('[data-sfx-item="1"]')?.getAttribute('data-sfx-anchor') === 'moment',
  );

  // Excluir áudio usa ConfirmDialog (nunca window.confirm).
  await panel.locator('[data-audio-delete="2"]').click();
  const confirmDlg = page.getByRole('alertdialog', { name: 'Excluir áudio importado?' });
  await confirmDlg.waitFor();
  await confirmDlg.getByRole('button', { name: 'Excluir', exact: true }).click();
  await panel.locator('[data-audio-asset="2"]').waitFor({ state: 'detached' });

  await page.screenshot({ path: 'shots/editor-audio.png' });
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
}

export async function testEditorAudioDuckingPreview(page, url) {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), 'clipes-audio-154-'));
  const proxyPattern = '**/__clipes-media__/proxy/*';
  const audioPattern = '**/__clipes-media__/audio/*';

  try {
    const proxyMp4 = join(dir, 'proxy.mp4');
    const musicWav = join(dir, 'music.wav');
    const sfxWav = join(dir, 'sfx.wav');
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24:duration=200',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=200',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '1', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', proxyMp4,
    ]);
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=12',
      '-c:a', 'pcm_s16le', musicWav,
    ]);
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=1760:sample_rate=48000:duration=1.5',
      '-c:a', 'pcm_s16le', sfxWav,
    ]);
    const proxyBytes = await readFile(proxyMp4);
    const musicBytes = await readFile(musicWav);
    const sfxBytes = await readFile(sfxWav);

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
    await page.route(audioPattern, route => {
      const reqUrl = route.request().url();
      // O segundo ativo importado (`sfx`) ganha o último id; `music` ganha o primeiro.
      const isMusic = /\/audio\/1(?:\?|$)/.test(reqUrl) || /mock-trilha/.test(reqUrl);
      return serveBytes(route, isMusic ? musicBytes : sfxBytes, 'audio/wav');
    });

    await page.evaluate(() => localStorage.setItem('clipes.language', 'pt-BR'));
    await page.goto(`${url}?source-test=1&transcript-test=1&editor-test=1`);
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

    // Abre gaveta de áudio, importa trilha (volume 80%) e SFX em t = 5.0 s (intervalo sem fala: 4..6 s no mock!).
    await page.keyboard.press('m');
    const drawer = editor.getByRole('dialog', { name: 'Trilha e efeitos', exact: true });
    await drawer.waitFor();
    await drawer.locator('[data-audio-import-kind]').selectOption('music');
    await drawer.locator('[data-audio-pick-file]').click();
    await drawer.locator('[data-audio-import-license]').selectOption('cc0');
    await drawer.locator('[data-audio-import-submit]').click();
    await drawer.locator('[data-soundtrack-controls]').waitFor();

    await drawer.locator('[data-soundtrack-volume]').fill('80');
    await drawer.locator('[data-soundtrack-volume]').dispatchEvent('change');

    // Move cabeçote para output 4.8 s (3604.8 s da Fonte, proxy 124.8 s -> janela sem fala 4..6 s) e adiciona SFX.
    await video.evaluate(v => { v.currentTime = 124.8; v.dispatchEvent(new Event('timeupdate')); });
    await page.waitForFunction(() => Number(document.querySelector('[data-source-us]')?.getAttribute('data-source-us')) >= 3604_700_000);
    await drawer.locator('[data-audio-import-kind]').selectOption('sfx');
    await drawer.locator('[data-audio-pick-file]').click();
    await drawer.locator('[data-audio-import-license]').selectOption('cc0');
    await drawer.locator('[data-audio-import-submit]').click();
    await drawer.locator('[data-sfx-add]').click();
    await drawer.locator('[data-sfx-row]').first().waitFor();
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });

    // Proxy inicia em 3480 s -> Corte em 3600 s corresponde a proxy 120 s.
    // Em output 2.0 s (proxy 122.0 s), está dentro da fala [0..4 s] -> soundtrack ducking = true (~0.201 para base 0.8).
    await video.evaluate(v => { v.currentTime = 122.0; });
    await page.waitForFunction(() => document.querySelector('[data-soundtrack-ducking="true"]'));
    const duckGain = Number(await preview.getAttribute('data-soundtrack-gain'));
    assert.ok(Math.abs(duckGain - 0.8 * 0.2512) < 0.03, `ganho ducked esperado ~0.201, obtido ${duckGain}`);

    // Em output 5.0 s (proxy 125.0 s), está fora da fala [4..6 s] e sobre o SFX -> ducking = false (~0.8) e SFX ativo ao tocar!
    await video.evaluate(v => { v.currentTime = 125.0; void v.play(); });
    await page.waitForFunction(() => document.querySelector('[data-soundtrack-ducking="false"]'));
    const fullGain = Number(await preview.getAttribute('data-soundtrack-gain'));
    assert.ok(Math.abs(fullGain - 0.8) < 0.03, `ganho normal esperado ~0.8, obtido ${fullGain}`);
    await page.waitForFunction(() => {
      const ids = document.querySelector('[data-preview-state="ready"]')?.getAttribute('data-sfx-active-ids') ?? '';
      return ids.length > 0;
    }, null, { timeout: 5000 });
    await page.keyboard.press('k');

    await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
  } finally {
    await page.unroute(proxyPattern);
    await page.unroute(audioPattern);
    await rm(dir, { recursive: true, force: true });
  }
}
