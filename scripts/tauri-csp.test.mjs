import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_CONF_PATH = path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json');

function parseCspDirectives(csp) {
  assert.ok(csp !== null && csp !== undefined, 'app.security.csp deve estar definido em tauri.conf.json');
  const map = new Map();

  if (typeof csp === 'string') {
    for (const rawDirective of csp.split(';')) {
      const tokens = rawDirective.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const [name, ...sources] = tokens;
      map.set(name.toLowerCase(), sources);
    }
    return map;
  }

  assert.equal(typeof csp, 'object', 'app.security.csp deve ser objeto ou string');
  assert.equal(Array.isArray(csp), false, 'app.security.csp não pode ser array');
  for (const [name, value] of Object.entries(csp)) {
    const sources = Array.isArray(value)
      ? value.map(v => String(v).trim()).filter(Boolean)
      : String(value).trim().split(/\s+/).filter(Boolean);
    map.set(name.toLowerCase(), sources);
  }
  return map;
}

function isBroadWildcard(token) {
  if (token === '*') return true;
  // Wildcard de porta em loopback (http://127.0.0.1:*) é exigido pelo servidor de mídia no Linux.
  if (token === 'http://127.0.0.1:*') return false;
  if (token.includes('*')) return true;
  if (/^(https?|wss?|ftp):$/i.test(token)) return true;
  return false;
}

test('src-tauri/tauri.conf.json define app.security.csp restritiva para Windows, Linux e IPC', () => {
  const conf = JSON.parse(readFileSync(TAURI_CONF_PATH, 'utf8'));
  const security = conf?.app?.security;
  assert.ok(security && typeof security === 'object', 'app.security deve existir em tauri.conf.json');
  assert.notEqual(
    security.dangerousDisableAssetCspModification,
    true,
    'dangerousDisableAssetCspModification não deve desabilitar a proteção do Tauri',
  );

  const directives = parseCspDirectives(security.csp);

  const requiredDirectives = [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'media-src',
    'font-src',
    'connect-src',
    'object-src',
    'base-uri',
    'form-action',
    'frame-ancestors',
  ];
  for (const name of requiredDirectives) {
    assert.ok(directives.has(name), `Diretiva obrigatória ausente na CSP: ${name}`);
    assert.ok(directives.get(name).length > 0, `Diretiva ${name} não pode ser vazia`);
  }

  // Sem unsafe-eval nem wildcard amplo em nenhuma diretiva.
  for (const [name, sources] of directives.entries()) {
    for (const token of sources) {
      assert.notEqual(
        token.toLowerCase(),
        "'unsafe-eval'",
        `Diretiva ${name} não pode conter 'unsafe-eval'`,
      );
      assert.notEqual(
        token.toLowerCase(),
        "'wasm-unsafe-eval'",
        `Diretiva ${name} não pode conter 'wasm-unsafe-eval'`,
      );
      assert.equal(
        isBroadWildcard(token),
        false,
        `Diretiva ${name} não pode conter wildcard ou esquema amplo (${token})`,
      );
      if (name !== 'style-src') {
        assert.notEqual(
          token.toLowerCase(),
          "'unsafe-inline'",
          `Diretiva ${name} não pode conter 'unsafe-inline'`,
        );
      }
    }
  }

  assert.deepEqual(directives.get('default-src'), ["'self'"]);
  assert.deepEqual(directives.get('script-src'), ["'self'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('base-uri'), ["'self'"]);
  assert.deepEqual(directives.get('form-action'), ["'self'"]);
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(directives.get('font-src'), ["'self'"]);

  assert.ok(directives.get('style-src').includes("'self'"), "style-src deve incluir 'self'");

  const connectSrc = directives.get('connect-src');
  for (const required of [
    "'self'",
    'ipc:',
    'http://ipc.localhost',
    'clipes-media:',
    'http://clipes-media.localhost',
    'http://127.0.0.1:*',
  ]) {
    assert.ok(connectSrc.includes(required), `connect-src deve incluir ${required}`);
  }

  for (const mediaDirective of ['img-src', 'media-src']) {
    const sources = directives.get(mediaDirective);
    for (const required of [
      "'self'",
      'clipes-media:',
      'http://clipes-media.localhost',
      'http://127.0.0.1:*',
      'blob:',
      'data:',
    ]) {
      assert.ok(sources.includes(required), `${mediaDirective} deve incluir ${required}`);
    }
  }
});
