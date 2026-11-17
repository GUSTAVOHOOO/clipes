import assert from 'node:assert/strict';

function installMediaMockScript() {
  const makeWav = () => {
    const sr = 24000;
    const frames = 2400; // 100 ms
    const dataBytes = frames * 2;
    const buf = new ArrayBuffer(44 + dataBytes);
    const v = new DataView(buf);
    const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    w(0, 'RIFF');
    v.setUint32(4, 36 + dataBytes, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, dataBytes, true);
    return new Blob([buf], { type: 'audio/wav' });
  };

  window.__mediaMock = {
    permissionGranted: false,
    denyNext: false,
    getUserMediaCalls: [],
  };

  const devices = [
    { deviceId: 'mic-1', kind: 'audioinput', label: 'Microfone USB Studio', groupId: 'g1', toJSON() { return this; } },
    { deviceId: 'mic-2', kind: 'audioinput', label: 'Headset Integrado', groupId: 'g2', toJSON() { return this; } },
  ];

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => devices.map(d => ({
        ...d,
        label: window.__mediaMock.permissionGranted ? d.label : '',
      })),
      getUserMedia: async (constraints) => {
        window.__mediaMock.getUserMediaCalls.push(constraints);
        if (window.__mediaMock.denyNext) {
          window.__mediaMock.denyNext = false;
          throw new DOMException('Permission denied', 'NotAllowedError');
        }
        window.__mediaMock.permissionGranted = true;
        return {
          getTracks: () => [{ stop() {} }],
        };
      },
    },
  });

  window.MediaRecorder = class MockMediaRecorder {
    constructor(stream) {
      this.stream = stream;
      this.state = 'inactive';
      this.mimeType = 'audio/wav';
      this.ondataavailable = null;
      this.onstop = null;
      this.onerror = null;
    }
    start() { this.state = 'recording'; }
    pause() { if (this.state === 'recording') this.state = 'paused'; }
    resume() { if (this.state === 'paused') this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const blob = makeWav();
      this.ondataavailable?.({ data: blob });
      this.onstop?.();
    }
  };
}

async function openTransformedApprovedNarration(page, urlQuery) {
  await page.addInitScript(installMediaMockScript);
  await page.goto(urlQuery);
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
  return review;
}

export async function testTeleprompterRecording(page, url) {
  // 1. Fluxo principal: permissão explícita, escolha do microfone, teleprompter rolável, aparo VAD e alinhamento.
  const review = await openTransformedApprovedNarration(page, `${url}/?source-test=1&transcript-test=1&editor-test=1`);
  const narration = review.locator('[data-narration]');
  await narration.waitFor();

  // Botão "Gravar bloco" abre o teleprompter sem ter chamado getUserMedia antes.
  await narration.locator('[data-record-block]').first().click();
  const rec = narration.locator('[data-teleprompter-recorder]');
  await rec.waitFor();
  assert.equal(await page.evaluate(() => window.__mediaMock.getUserMediaCalls.length), 0, 'permissão deve ser explícita');

  // Testa recusa de permissão no clique explícito.
  await page.evaluate(() => { window.__mediaMock.denyNext = true; });
  await rec.locator('[data-record-permission]').click();
  await rec.locator('[data-record-error]').waitFor();
  assert.match(await rec.locator('[data-record-error]').innerText(), /Permissão do microfone negada/);

  // Concede permissão explícita e escolhe o segundo microfone.
  await rec.locator('[data-record-permission]').click();
  await rec.getByRole('button', { name: 'Permissão concedida' }).waitFor();
  const micSel = rec.locator('[data-record-mic]');
  await micSel.selectOption('mic-2');
  assert.equal(await micSel.inputValue(), 'mic-2');

  // Ajusta rolagem do teleprompter e força conteúdo longo para comprovar rolagem real.
  const speedInput = rec.getByLabel('Velocidade da rolagem (px/s)');
  await speedInput.fill('90');
  assert.equal(await rec.locator('[data-scroll-speed-value]').innerText(), '90 px/s');

  const prompter = rec.locator('[data-teleprompter]').first();
  await prompter.evaluate(el => {
    el.style.height = '60px';
    el.textContent = Array.from({ length: 20 }, (_, i) => `Linha ${i + 1} do roteiro aprovado para leitura no teleprompter.`).join('\n');
  });

  await rec.locator('[data-record-start]').click();
  await rec.locator('[data-record-stop]').waitFor();

  // Aguarda o teleprompter rolar sozinho durante a gravação.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-teleprompter]');
    return el && el.scrollTop > 5;
  }, null, { timeout: 3000 });

  // Confirma que getUserMedia recebeu exatamente o microfone escolhido.
  const lastCall = await page.evaluate(() => window.__mediaMock.getUserMediaCalls.at(-1));
  assert.deepEqual(lastCall, { audio: { deviceId: { exact: 'mic-2' } } });

  // Pausa e continua antes de salvar.
  await rec.getByRole('button', { name: 'Pausar', exact: true }).click();
  await rec.getByRole('button', { name: 'Continuar', exact: true }).click();

  await rec.locator('[data-record-stop]').click();
  await narration.getByText('Áudio gravado', { exact: true }).first().waitFor();
  await narration.locator('[data-narration-duration="2400000"]').first().waitFor();
  await narration.locator('[data-narration-align-status="aligned"]').first().waitFor();

  // Limpeza de voz (#155) na gravação: ligada por padrão e prévia antes/depois.
  await narration.locator('[data-narration-cleanup]').first().waitFor();
  assert.equal(await narration.locator('[data-narration-cleanup-toggle]').first().isChecked(), true);
  await narration.locator('[data-narration-preview-after]').first().click();
  await narration.locator('[data-narration-audio="clean"]').first().waitFor();
  await narration.locator('[data-narration-preview-before]').first().click();
  await narration.locator('[data-narration-audio="original"]').first().waitFor();

  // Navega para o próximo bloco dentro do teleprompter.
  await rec.getByRole('button', { name: 'Próximo bloco', exact: true }).click();
  assert.match(await rec.locator('[data-teleprompter]').innerText(), /\S+/);

  // Narração humana NÃO dispara "Narração por TTS" no checklist de guarda-corpos do Editor.
  await review.locator('[data-editor-slot]').click();
  const editor = page.getByRole('region', { name: 'Editor do Corte', exact: true });
  await editor.waitFor({ timeout: 10000 });
  const guard = editor.locator('[data-guardrails-checklist]');
  await guard.waitFor();
  await guard.locator('summary').click();
  assert.match(await guard.innerText(), /Narração por TTS: nenhum áudio TTS gerado para este Corte/);
  await editor.getByRole('button', { name: 'Fechar editor', exact: true }).click();
  await editor.waitFor({ state: 'detached' });

  // 2. Sem worker instalado: grava sem aparo e exibe aviso.
  const reviewNoWorker = await openTransformedApprovedNarration(page, `${url}/?source-test=1&transcript-test=1&record-no-worker=1`);
  const narNoWorker = reviewNoWorker.locator('[data-narration]');
  await narNoWorker.locator('[data-record-block]').first().click();
  const recNoWorker = narNoWorker.locator('[data-teleprompter-recorder]');
  await recNoWorker.locator('[data-record-start]').click();
  await recNoWorker.locator('[data-record-stop]').click();
  await narNoWorker.locator('[data-narration-untrimmed]').waitFor();
  await narNoWorker.locator('[data-narration-record-notice]').waitFor();
  await narNoWorker.locator('[data-narration-cleanup-warning="vad_unavailable"]').waitFor();

  // 3. VAD sem fala detectada (`no_speech_detected`): exibe erro, preserva rascunho e descarta.
  const reviewNoSpeech = await openTransformedApprovedNarration(page, `${url}/?source-test=1&transcript-test=1&record-no-speech=1`);
  const narNoSpeech = reviewNoSpeech.locator('[data-narration]');
  await narNoSpeech.locator('[data-record-block]').first().click();
  const recNoSpeech = narNoSpeech.locator('[data-teleprompter-recorder]');
  await recNoSpeech.locator('[data-record-start]').click();
  await recNoSpeech.locator('[data-record-stop]').click();
  await recNoSpeech.locator('[data-record-error]').waitFor();
  assert.match(await recNoSpeech.locator('[data-record-error]').innerText(), /Nenhuma fala detectada/);
  await recNoSpeech.locator('[data-record-draft-audio]').waitFor();
  await recNoSpeech.getByRole('button', { name: 'Descartar rascunho', exact: true }).click();
  await recNoSpeech.locator('[data-record-draft]').waitFor({ state: 'detached' });
}
