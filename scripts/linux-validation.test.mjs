import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildEditorAvulsoHash,
  isLoopbackMediaUrl,
  redactUrl,
  summarizeSamples,
  validateLinuxReport,
} from './linux-validation.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

test('buildEditorAvulsoHash monta rota do Editor v2 usando id do Projeto ou fallback para name', () => {
  assert.equal(
    buildEditorAvulsoHash({ id: 'proj-uuid-1', name: 'ValidacaoLinux' }, 1, 1, 2),
    '#/projeto/proj-uuid-1/corte/avulso-1-1-2/editar',
  );
  assert.equal(
    buildEditorAvulsoHash({ name: 'Meu Projeto' }, 3, 2, 5),
    '#/projeto/Meu%20Projeto/corte/avulso-3-2-5/editar',
  );
  assert.throws(() => buildEditorAvulsoHash({}, 1, 1, 2));
});

test('isLoopbackMediaUrl aceita somente URL loopback 127.0.0.1 e redactUrl oculta token hex de 64 chars', () => {
  const token = 'a'.repeat(64);
  const url = `http://127.0.0.1:43210/${token}/proxy/chave`;
  assert.equal(isLoopbackMediaUrl(url), true);
  assert.equal(isLoopbackMediaUrl('clipes-media://localhost/proxy/chave'), false);
  assert.equal(isLoopbackMediaUrl(null), false);
  assert.equal(redactUrl(url), 'http://127.0.0.1:43210/<token>/proxy/chave');
});

test('summarizeSamples calcula mediana e p95 corretamente', () => {
  const samples = [10, 20, 30, 40, 50].map(v => ({ seekedMs: v }));
  assert.deepEqual(summarizeSamples(samples, 'seekedMs'), {
    n: 5,
    minMs: 10,
    medianMs: 30,
    p95Ms: 50,
    maxMs: 50,
  });
  assert.equal(summarizeSamples([], 'seekedMs'), null);
});

test('validateLinuxReport exige PalcoEditor v2 com playOk, loopback, 100 seeks, export e fallback x264', () => {
  const baseReport = {
    steps: {
      appLaunch: { ok: true },
      proxyGeneration: { ok: true },
      uiCutPreview: { mounted: true, hasVideo: true, playOk: true, transportLoopback: true },
      webkitPreviewBenchmark: {
        proxy: { playable: true, n: 100 },
        source: { playable: true, n: 100 },
      },
      mediaFetchDiag: {
        whole: { status: 200 },
        range0: { status: 206 },
        noToken: { status: 403 },
        wrongToken: { status: 403 },
        traversal: { status: 404 },
        listing: { status: 404 },
        rawSecurityDiag: {
          noToken: { status: 403, acao: null },
          wrongToken: { status: 403, acao: null },
          evilOrigin: { status: 403, acao: null },
          allowedOrigin: { status: 200, acao: 'tauri://localhost' },
          traversal: { status: 404 },
          listing: { status: 404 },
        },
      },
      exportWithCaptions: { ok: true },
      x264Fallback: { ok: true },
    },
  };

  assert.equal(validateLinuxReport(baseReport), true);

  const withoutLoopback = structuredClone(baseReport);
  withoutLoopback.steps.uiCutPreview.transportLoopback = false;
  assert.equal(validateLinuxReport(withoutLoopback), false);

  const withoutPlay = structuredClone(baseReport);
  withoutPlay.steps.uiCutPreview.playOk = false;
  assert.equal(validateLinuxReport(withoutPlay), false);
});

test('linux-validation.mjs não usa clipes-preview-open nem seletores V1 e usa Palco de prévia do Editor v2', () => {
  const source = readFileSync(path.join(THIS_DIR, 'linux-validation.mjs'), 'utf8');
  assert.equal(source.includes('clipes-preview-open'), false);
  assert.equal(source.includes('Preview do Corte'), false);
  assert.equal(source.includes('Transcrição pronta'), false);
  assert.equal(source.includes('Palco de prévia'), true);
  assert.equal(source.includes("window.location.hash = '#/inicio'"), true);
  assert.equal(source.includes('window.location.hash = targetHash;\n      location.reload();'), false);
});

test('linux-validation.mjs usa trecho >= 20s (MIN_CLIP_US) para abrir avulso-1-1-2 em editor.open', () => {
  const source = readFileSync(path.join(THIS_DIR, 'linux-validation.mjs'), 'utf8');
  const wordMatches = [...source.matchAll(/\[\d,\s*'[^']+',\s*([\d_]+),\s*([\d_]+)\]/g)];
  assert.ok(wordMatches.length >= 2, 'Deve semear palavras da transcrição sintética');
  const firstStart = Number(wordMatches[0][1].replaceAll('_', ''));
  const lastEnd = Number(wordMatches[wordMatches.length - 1][2].replaceAll('_', ''));
  assert.ok(
    lastEnd - firstStart >= 20_000_000,
    `Duração sintética (${(lastEnd - firstStart) / 1e6}s) deve ser >= 20s para editor.open`,
  );
  assert.equal(source.includes(`end_us: ${lastEnd.toLocaleString('en-US').replaceAll(',', '_')}`), true);
});
