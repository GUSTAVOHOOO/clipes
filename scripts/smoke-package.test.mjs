import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNsisInstallArgs,
  buildNsisUninstallArgs,
  findSingleArtifact,
  parseSmokeArgs,
  resolveExpectedVersion,
  validateDebDepends,
  validateWebViewSnapshot,
  verifyUserDataPreserved,
} from './smoke-package.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parseSmokeArgs valida --platform e flags opcionais', () => {
  assert.deepEqual(parseSmokeArgs(['--platform', 'windows-nsis']), {
    platform: 'windows-nsis',
    artifact: null,
    bin: null,
    install: false,
    keepTemp: false,
    timeoutMs: 60_000,
  });

  assert.deepEqual(
    parseSmokeArgs([
      '--platform',
      'linux-deb',
      '--artifact',
      '/tmp/clipes.deb',
      '--install',
      '--timeout-ms',
      '90000',
    ]),
    {
      platform: 'linux-deb',
      artifact: '/tmp/clipes.deb',
      bin: null,
      install: true,
      keepTemp: false,
      timeoutMs: 90_000,
    },
  );

  assert.throws(() => parseSmokeArgs([]), /--platform/);
  assert.throws(() => parseSmokeArgs(['--platform', 'macos-dmg']), /Plataforma inválida/);
});

test('resolveExpectedVersion lê versão dinamicamente de src-tauri/tauri.conf.json', async () => {
  const version = await resolveExpectedVersion(REPO_ROOT);
  assert.match(version, /^\d+\.\d+\.\d+/);
});

test('buildNsisInstallArgs coloca /D=<dir> por último sem aspas embutidas e buildNsisUninstallArgs usa /S', () => {
  const dir = 'C:\\Temp\\clipes smoke dir';
  const args = buildNsisInstallArgs(dir);
  assert.deepEqual(args, ['/S', `/D=${dir}`]);
  assert.equal(args[args.length - 1].startsWith('/D='), true);
  assert.equal(args[args.length - 1].includes('"'), false);
  assert.deepEqual(buildNsisUninstallArgs(), ['/S']);
});

test('findSingleArtifact localiza único instalador e falha para 0 ou múltiplos', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'clipes-376-smoke-art-'));
  try {
    assert.throws(() => findSingleArtifact(dir, '.exe'), /Nenhum artefato/);

    writeFileSync(path.join(dir, 'Clipes_setup.exe'), 'bin');
    assert.equal(findSingleArtifact(dir, '.exe'), path.join(dir, 'Clipes_setup.exe'));

    writeFileSync(path.join(dir, 'Clipes_other.exe'), 'bin');
    assert.throws(() => findSingleArtifact(dir, '.exe'), /Múltiplos artefatos/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateDebDepends exige gstreamer1.0-plugins-good, bad e libav no Depends do .deb', () => {
  const validDpkg = `
 Package: clipes
 Version: 1.0.0
 Depends: libwebkit2gtk-4.1-0, gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad, gstreamer1.0-libav
`;
  assert.deepEqual(validateDebDepends(validDpkg), [
    'gstreamer1.0-plugins-good',
    'gstreamer1.0-plugins-bad',
    'gstreamer1.0-libav',
  ]);

  const missingDpkg = `
 Package: clipes
 Version: 1.0.0
 Depends: libwebkit2gtk-4.1-0, gstreamer1.0-plugins-good
`;
  assert.throws(() => validateDebDepends(missingDpkg), /gstreamer1\.0-plugins-bad.*gstreamer1\.0-libav/);
});

test('validateWebViewSnapshot exige front-v2 sem :1430, versão correta e zero erros JS', () => {
  const ok = {
    internalsReady: true,
    headerPresent: true,
    headerText: 'Clipes Projetos',
    href: 'http://tauri.localhost/#/assistente?passo=1',
    appVersion: '1.0.0',
    errors: [],
  };
  assert.doesNotThrow(() => validateWebViewSnapshot(ok, '1.0.0'));

  assert.throws(
    () => validateWebViewSnapshot({ ...ok, href: 'http://127.0.0.1:1430/#/inicio' }, '1.0.0'),
    /servidor dev/,
  );
  assert.throws(
    () => validateWebViewSnapshot({ ...ok, appVersion: '0.9.0' }, '1.0.0'),
    /Versão/,
  );
  assert.throws(
    () => validateWebViewSnapshot({ ...ok, headerText: 'Outro' }, '1.0.0'),
    /Clipes/,
  );
  assert.throws(
    () => validateWebViewSnapshot({ ...ok, errors: ['ReferenceError: x'] }, '1.0.0'),
    /Erros JS/,
  );
});

test('verifyUserDataPreserved confirma que CLIPES_DATA_DIR e arquivo sentinela sobreviveram (#231)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'clipes-376-smoke-data-'));
  try {
    const sentinel = path.join(dir, 'sentinel.json');
    writeFileSync(sentinel, '{"preserve":true}', 'utf8');
    assert.doesNotThrow(() => verifyUserDataPreserved(sentinel, '{"preserve":true}'));
    assert.throws(() => verifyUserDataPreserved(path.join(dir, 'ausente.json'), '{"preserve":true}'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
