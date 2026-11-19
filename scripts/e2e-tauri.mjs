import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { remote } from 'webdriverio';
import { cargoBinDir, ensureWebDriver, exeName, findExecutable } from './setup-webdriver.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'shots-e2e');
const REMOTE_TEST_ENDPOINT = 'http://192.0.2.10/v1';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function logStep(message) {
  console.log(`[e2e] ${message}`);
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForTcpPort(port, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`tauri-driver encerrou prematuramente com código ${child.exitCode}`);
    }
    const connected = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await sleep(100);
  }
  throw new Error(`Tempo esgotado aguardando tauri-driver na porta ${port}`);
}

async function killProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    try {
      execFileSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // processo já encerrado
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // processo já encerrado
      }
    }
  }
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3_000)]);
}

function buildPathWith(...dirs) {
  const existing = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return [...dirs.filter(Boolean), ...existing].join(path.delimiter);
}

function ensureBuildArtifacts({ skipBuild }) {
  const appBinary = path.join(REPO_ROOT, 'target', 'debug', exeName('clipes'));
  const fakeWorkerBinary = path.join(REPO_ROOT, 'target', 'debug', exeName('fake-worker'));
  const cargo = findExecutable('cargo');
  const rustc = findExecutable('rustc');
  const bun = findExecutable('bun');
  const ffmpeg = findExecutable('ffmpeg');
  const ffprobe = findExecutable('ffprobe');
  if (!cargo || !rustc) throw new Error('cargo/rustc não encontrados.');
  if (!bun) throw new Error('bun não encontrado.');
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe são obrigatórios para a suíte E2E.');

  const envWithCargo = {
    ...process.env,
    PATH: buildPathWith(cargoBinDir()),
    VITE_E2E: '1',
  };
  delete envWithCargo.VITE_CORE_MOCK;
  delete envWithCargo.VITE_UPDATER_MOCK;

  if (!skipBuild || !existsSync(appBinary)) {
    logStep('Compilando binário debug do Tauri (VITE_E2E=1, --debug --no-bundle)…');
    execFileSync(bun, ['run', 'tauri', 'build', '--debug', '--no-bundle'], {
      cwd: REPO_ROOT,
      env: envWithCargo,
      stdio: 'inherit',
    });
  }
  if (!skipBuild || !existsSync(fakeWorkerBinary)) {
    logStep('Compilando fake-worker…');
    execFileSync(cargo, ['build', '-p', 'clipes-core', '--bin', 'fake-worker'], {
      cwd: REPO_ROOT,
      env: envWithCargo,
      stdio: 'inherit',
    });
  }
  if (!existsSync(appBinary)) throw new Error(`Binário não encontrado: ${appBinary}`);
  if (!existsSync(fakeWorkerBinary)) throw new Error(`fake-worker não encontrado: ${fakeWorkerBinary}`);
  return { appBinary, fakeWorkerBinary, rustc, ffmpeg };
}

async function prepareFixtures({ tempRoot, dataDir, fakeWorkerBinary, rustc, ffmpeg }) {
  const cliBinDir = path.join(tempRoot, 'cli-bin');
  const mediaDir = path.join(tempRoot, 'media');
  const projectsDir = path.join(tempRoot, 'projects');
  const downloadsDir = path.join(tempRoot, 'downloads');
  const componentsDir = path.join(dataDir, 'components');
  await Promise.all([
    mkdir(cliBinDir, { recursive: true }),
    mkdir(mediaDir, { recursive: true }),
    mkdir(projectsDir, { recursive: true }),
    mkdir(downloadsDir, { recursive: true }),
    mkdir(componentsDir, { recursive: true }),
    mkdir(SHOTS_DIR, { recursive: true }),
  ]);

  const fixturesDir = path.join(REPO_ROOT, 'core', 'tests', 'fixtures');
  const codexBin = path.join(cliBinDir, exeName('codex'));
  const claudeBin = path.join(cliBinDir, exeName('claude'));
  const opencodeBin = path.join(cliBinDir, exeName('opencode'));
  const fakeYtdlpBin = path.join(tempRoot, exeName('fake-ytdlp'));

  execFileSync(rustc, [path.join(fixturesDir, 'fake_provider_cli.rs'), '-o', codexBin], { stdio: 'inherit' });
  await copyFile(codexBin, claudeBin);
  execFileSync(rustc, [path.join(fixturesDir, 'fake_opencode.rs'), '-o', opencodeBin], { stdio: 'inherit' });
  execFileSync(rustc, [path.join(fixturesDir, 'fake_ytdlp.rs'), '-o', fakeYtdlpBin], { stdio: 'inherit' });

  await copyFile(fakeWorkerBinary, path.join(componentsDir, exeName('uv')));
  await writeFile(path.join(componentsDir, 'uv.version'), '0.13.8\n', 'utf8');

  const ytdlpComponent = path.join(componentsDir, exeName('yt-dlp'));
  await copyFile(fakeYtdlpBin, ytdlpComponent);
  const ytdlpSha256 = createHash('sha256').update(await readFile(ytdlpComponent)).digest('hex');
  await writeFile(
    path.join(componentsDir, 'yt-dlp.state.json'),
    JSON.stringify({
      version: '2027.01.01.000000',
      sha256: ytdlpSha256,
      origin: 'SHA2-256SUMS assinado por yt-dlp',
    }),
    'utf8',
  );

  const sourceMkv = path.join(mediaDir, 'source.mkv');
  execFileSync(
    ffmpeg,
    [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
      '-map', '0:v', '-map', '1:a', '-map', '2:a',
      '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-y',
      sourceMkv,
    ],
    { stdio: 'inherit' },
  );

  const urlFixtureMp4 = path.join(mediaDir, 'url-fixture.mp4');
  execFileSync(
    ffmpeg,
    [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=navy:s=64x64:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=520:duration=2',
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'mpeg4', '-c:a', 'aac', '-y',
      urlFixtureMp4,
    ],
    { stdio: 'inherit' },
  );

  return { cliBinDir, mediaDir, projectsDir, downloadsDir, sourceMkv, urlFixtureMp4 };
}

async function startFakeProviderServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization ?? null,
      body,
    });
    const payload = JSON.stringify({
      choices: [{ message: { content: '{"schemaVersion":1}' } }],
      usage: { prompt_tokens: 14, completion_tokens: 5 },
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
      Connection: 'close',
    });
    res.end(payload);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    endpoint: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

let targetCounter = 0;

function createUi(browser) {
  async function tagElement(spec, timeout = 15_000) {
    const tag = `t-${++targetCounter}`;
    await browser.waitUntil(
      async () =>
        browser.execute(
          (s, token) => {
            const norm = text => (text || '').replace(/\s+/g, ' ').trim();
            const isVisible = el => {
              if (!el || el.closest('[inert]')) return false;
              const style = getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                return false;
              }
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            };
            const nameOf = el => {
              const aria = el.getAttribute('aria-label');
              if (aria) return norm(aria);
              const labelledBy = el.getAttribute('aria-labelledby');
              if (labelledBy) {
                return norm(
                  labelledBy
                    .split(/\s+/)
                    .map(id => document.getElementById(id)?.textContent || '')
                    .join(' '),
                );
              }
              const clone = el.cloneNode(true);
              clone.querySelectorAll('kbd,svg').forEach(n => n.remove());
              return norm(clone.textContent || '');
            };
            const scope = s.scopeSelector ? document.querySelector(s.scopeSelector) : document;
            if (!scope) return false;
            const matchText = (actual, expected, exact) =>
              exact ? actual === expected : actual.includes(expected);

            const matchRow = el =>
              !s.rowContains || Boolean(el.closest('li,tr,article')?.textContent?.includes(s.rowContains));

            let candidates = [];
            if (s.kind === 'button') {
              const clickable =
                'button,[role="button"],[role="tab"],[role="radio"],[role="menuitem"],summary,a[href]';
              candidates = Array.from(scope.querySelectorAll(clickable)).filter(
                el =>
                  isVisible(el) &&
                  !el.disabled &&
                  el.getAttribute('aria-disabled') !== 'true' &&
                  matchRow(el) &&
                  matchText(nameOf(el), s.name, s.exact !== false),
              );
            } else if (s.kind === 'option') {
              candidates = Array.from(scope.querySelectorAll('[role="option"],[cmdk-item]')).filter(
                el => isVisible(el) && matchText(norm(el.textContent), s.name, false),
              );
            } else if (s.kind === 'field') {
              const controls = Array.from(
                scope.querySelectorAll('input:not([type="checkbox"]),textarea,select,[role="combobox"]'),
              ).filter(el => isVisible(el) && !el.disabled && matchRow(el));
              candidates = controls.filter(ctrl => {
                const aria = ctrl.getAttribute('aria-label');
                if (aria && matchText(norm(aria), s.label, s.exact !== false)) return true;
                if (ctrl.id) {
                  const explicit = document.querySelector(`label[for="${CSS.escape(ctrl.id)}"]`);
                  if (explicit && matchText(norm(explicit.textContent), s.label, s.exact !== false)) return true;
                }
                const labelledBy = ctrl.getAttribute('aria-labelledby');
                if (labelledBy) {
                  const text = norm(
                    labelledBy
                      .split(/\s+/)
                      .map(id => document.getElementById(id)?.textContent || '')
                      .join(' '),
                  );
                  if (matchText(text, s.label, s.exact !== false)) return true;
                }
                const wrapping = ctrl.closest('label');
                if (wrapping) {
                  const clone = wrapping.cloneNode(true);
                  clone.querySelectorAll('input,textarea,select,[role="combobox"]').forEach(n => n.remove());
                  if (matchText(norm(clone.textContent), s.label, s.exact !== false)) return true;
                }
                return false;
              });
            } else if (s.kind === 'switch') {
              candidates = Array.from(
                scope.querySelectorAll('[role="switch"],[role="checkbox"],input[type="checkbox"]'),
              ).filter(el => {
                if (!isVisible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
                if (el.tagName === 'INPUT' && el.closest('label')?.querySelector('[role="switch"],[role="checkbox"]')) {
                  return false;
                }
                const aria = el.getAttribute('aria-label');
                if (aria && matchText(norm(aria), s.label, false)) return true;
                const wrapping = el.closest('label');
                if (!wrapping) return false;
                const clone = wrapping.cloneNode(true);
                clone.querySelectorAll('input,[role="switch"],[role="checkbox"]').forEach(n => n.remove());
                return matchText(norm(clone.textContent), s.label, false);
              });
            }

            const chosen = candidates[s.index ?? 0];
            if (!chosen) return false;
            chosen.scrollIntoView({ block: 'center', inline: 'center' });
            chosen.setAttribute('data-e2e-target', token);
            return true;
          },
          spec,
          tag,
        ),
      { timeout, interval: 100, timeoutMsg: `Elemento não encontrado: ${JSON.stringify(spec)}` },
    );
    return browser.$(`[data-e2e-target="${tag}"]`);
  }

  // Toasts (role=dialog, não modal) podem cobrir o alvo: cai para click() programático.
  async function safeClick(el) {
    try {
      await el.click();
    } catch (error) {
      if (!/click intercepted|not clickable/i.test(String(error))) throw error;
      await browser.execute(target => target.click(), el);
    }
  }

  async function clickButton(name, options = {}) {
    const el = await tagElement({
      kind: 'button',
      name,
      exact: options.exact ?? true,
      scopeSelector: options.scopeSelector ?? null,
      rowContains: options.rowContains ?? null,
      index: options.index ?? 0,
    });
    await safeClick(el);
  }

  async function fillField(label, value, options = {}) {
    const el = await tagElement({
      kind: 'field',
      label,
      exact: options.exact ?? false,
      scopeSelector: options.scopeSelector ?? null,
    });
    if (String(value).length > 200 || options.bulk) {
      await browser.execute(
        (target, nextValue) => {
          const proto =
            target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          setter.call(target, nextValue);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        },
        el,
        String(value),
      );
      return;
    }
    await safeClick(el);
    await browser.execute(target => target.focus(), el);
    await browser.execute(target => {
      const proto =
        target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter.call(target, '');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }, el);
    if (String(value).length > 0) {
      await el.addValue(String(value));
    }
  }

  // Aceita <select> nativo (valor) ou gatilho Base UI role="combobox" (texto da opção).
  async function selectField(label, optionTextOrValue, options = {}) {
    const el = await tagElement({
      kind: 'field',
      label,
      exact: options.exact ?? false,
      scopeSelector: options.scopeSelector ?? null,
      rowContains: options.rowContains ?? null,
    });
    const tagName = await el.getTagName();
    if (tagName.toLowerCase() === 'select') {
      await el.selectByAttribute('value', optionTextOrValue);
      return;
    }
    await el.click();
    await browser.waitUntil(
      async () =>
        browser.execute(
          wanted => {
            const norm = t => (t || '').replace(/s+/g, ' ').trim();
            const visible = e => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            };
            const items = Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).filter(visible);
            const hit =
              items.find(i => norm(i.textContent) === wanted) ||
              items.find(i => norm(i.textContent).includes(wanted));
            if (!hit) return false;
            hit.setAttribute('data-e2e-option', 'pick');
            return true;
          },
          optionTextOrValue,
        ),
      { timeout: 10_000, interval: 100, timeoutMsg: `Opção não encontrada em "${label}": ${optionTextOrValue}` },
    );
    await browser.$('[data-e2e-option="pick"]').click();
    await browser.execute(() =>
      document.querySelectorAll('[data-e2e-option]').forEach(n => n.removeAttribute('data-e2e-option')),
    );
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('[role="listbox"]')).every(l => {
            const r = l.getBoundingClientRect();
            return r.width === 0 || r.height === 0;
          }),
        ),
      { timeout: 8_000, timeoutMsg: `A lista de opções de "${label}" não fechou` },
    );
  }

  async function clickTab(name, options = {}) {
    await clickButton(name, { ...options, exact: options.exact ?? true });
  }

  async function currentHash() {
    return browser.execute(() => window.location.hash);
  }

  async function waitForHash(expected, timeout = 15_000) {
    let last = '';
    await browser.waitUntil(
      async () => {
        last = await currentHash();
        return expected instanceof RegExp ? expected.test(last) : last.startsWith(expected);
      },
      { timeout, interval: 100, timeoutMsg: `Hash esperado ${expected}, atual: ${last}` },
    );
    return last;
  }

  // Recarrega a WebView (o núcleo mantém o Projeto aberto) para reler o estado do disco.
  async function reloadApp(hash, readyText = 'Fontes') {
    await browser.execute(h => {
      window.location.hash = h;
      window.location.reload();
    }, hash);
    await browser.pause(500);
    await waitForHash(hash.split('?')[0]);
    await waitForText(readyText, 'main', 20_000);
  }

  async function navigateHash(hash) {
    await browser.execute(h => {
      window.location.hash = h;
    }, hash);
    await waitForHash(hash.split('?')[0]);
  }

  async function fieldValue(label, options = {}) {
    const el = await tagElement({
      kind: 'field',
      label,
      exact: options.exact ?? false,
      scopeSelector: options.scopeSelector ?? null,
    });
    return el.getValue();
  }

  const readChecked = target =>
    browser.execute(el => {
      const aria = el.getAttribute('aria-checked');
      return aria !== null ? aria === 'true' : Boolean(el.checked);
    }, target);

  async function setChecked(label, desired, options = {}) {
    const el = await tagElement({
      kind: 'switch',
      label,
      scopeSelector: options.scopeSelector ?? null,
      index: options.index ?? 0,
    });
    if ((await readChecked(el)) !== desired) {
      await el.click();
      // O elemento pode ser recriado pelo React após a troca: procura de novo a cada tentativa.
      await browser.waitUntil(
        async () => {
          try {
            return (await isChecked(label, options)) === desired;
          } catch {
            return false;
          }
        },
        {
          timeout: 8_000,
          interval: 100,
          timeoutMsg: `Checkbox "${label}" não mudou para ${desired}`,
        },
      );
    }
  }

  async function isChecked(label, options = {}) {
    const el = await tagElement({
      kind: 'switch',
      label,
      scopeSelector: options.scopeSelector ?? null,
      index: options.index ?? 0,
    });
    return readChecked(el);
  }

  async function waitForDialog(title, role = 'any', timeout = 15_000) {
    let text = '';
    await browser.waitUntil(
      async () => {
        const found = await browser.execute(
          (expectedTitle, expectedRole) => {
            const norm = s => (s || '').replace(/\s+/g, ' ').trim();
            const selector =
              expectedRole === 'any' ? '[role="dialog"],[role="alertdialog"]' : `[role="${expectedRole}"]`;
            for (const el of document.querySelectorAll(selector)) {
              if (el.closest('[inert]')) continue;
              const aria = norm(el.getAttribute('aria-label'));
              const labelledBy = el.getAttribute('aria-labelledby');
              const heading = labelledBy
                ? norm(document.getElementById(labelledBy)?.textContent)
                : norm(el.querySelector('h1,h2,h3')?.textContent);
              if (aria === expectedTitle || heading === expectedTitle) {
                return norm(el.innerText || el.textContent);
              }
            }
            return null;
          },
          title,
          role,
        );
        if (found !== null) {
          text = found;
          return true;
        }
        return false;
      },
      { timeout, interval: 100, timeoutMsg: `Diálogo não abriu: ${title}` },
    );
    return text;
  }

  async function waitForDialogClosed(title, timeout = 15_000) {
    await browser.waitUntil(
      async () =>
        browser.execute(expectedTitle => {
          const norm = s => (s || '').replace(/\s+/g, ' ').trim();
          for (const el of document.querySelectorAll('[role="dialog"],[role="alertdialog"]')) {
            if (el.closest('[inert]')) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const aria = norm(el.getAttribute('aria-label'));
            const labelledBy = el.getAttribute('aria-labelledby');
            const heading = labelledBy
              ? norm(document.getElementById(labelledBy)?.textContent)
              : norm(el.querySelector('h1,h2,h3')?.textContent);
            if (aria === expectedTitle || heading === expectedTitle) return false;
          }
          return true;
        }, title),
      { timeout, interval: 100, timeoutMsg: `Diálogo não fechou: ${title}` },
    );
  }

  async function waitForText(expected, scopeSelector = 'body', timeout = 20_000) {
    let matched = '';
    let lastSeen = '';
    try {
      await browser.waitUntil(
        async () => {
          const text = await browser.execute(sel => {
            const root = document.querySelector(sel);
            return root ? (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim() : '';
          }, scopeSelector);
          lastSeen = text;
          const ok = expected instanceof RegExp ? expected.test(text) : text.includes(expected);
          if (ok) matched = text;
          return ok;
        },
        { timeout, interval: 100 },
      );
    } catch {
      throw new Error(
        `Texto não encontrado (${expected}) em ${scopeSelector}. Texto atual: ${lastSeen.slice(0, 500)}`,
      );
    }
    return matched;
  }

  async function waitForTextGone(unexpected, scopeSelector = 'body', timeout = 15_000) {
    await browser.waitUntil(
      async () => {
        const text = await browser.execute(sel => {
          const root = document.querySelector(sel);
          return root ? (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim() : '';
        }, scopeSelector);
        return unexpected instanceof RegExp ? !unexpected.test(text) : !text.includes(unexpected);
      },
      { timeout, interval: 100, timeoutMsg: `Texto permaneceu visível (${unexpected}) em ${scopeSelector}` },
    );
  }

  async function clickPaletteOption(label) {
    const el = await tagElement({ kind: 'option', name: label });
    await el.click();
  }

  async function queueDialog(...paths) {
    await browser.execute(items => {
      window.__CLIPES_E2E__.dialogQueue.push(...items);
    }, paths);
  }

  async function queueConfirm(...answers) {
    await browser.execute(items => {
      window.__CLIPES_E2E__.confirmQueue.push(...items);
    }, answers);
  }

  async function readE2EState() {
    return browser.execute(() => ({
      dialogCalls: window.__CLIPES_E2E__?.dialogCalls?.length ?? 0,
      confirmCalls: [...(window.__CLIPES_E2E__?.confirmCalls ?? [])],
      openedUrls: [...(window.__CLIPES_E2E__?.openedUrls ?? [])],
      copiedText: window.__CLIPES_E2E__?.copiedText ?? null,
    }));
  }

  async function shot(filename) {
    await browser.saveScreenshot(path.join(SHOTS_DIR, filename));
  }

  return {
    browser,
    clickButton,
    clickPaletteOption,
    fillField,
    selectField,
    clickTab,
    currentHash,
    waitForHash,
    navigateHash,
    reloadApp,
    fieldValue,
    setChecked,
    isChecked,
    waitForDialog,
    waitForDialogClosed,
    waitForText,
    waitForTextGone,
    queueDialog,
    queueConfirm,
    readE2EState,
    shot,
  };
}

async function withTauriSession(config, callback) {
  const driverPort = await getFreePort();
  const nativePort = await getFreePort();
  const args = ['--port', String(driverPort), '--native-port', String(nativePort)];
  if (config.nativeDriverPath) {
    args.push('--native-driver', config.nativeDriverPath);
  }
  const childEnv = {
    ...process.env,
    PATH: buildPathWith(config.cliBinDir, cargoBinDir()),
    CLIPES_DATA_DIR: config.dataDir,
    CLIPES_TEST_VAULT_FILE: config.vaultFile,
    CLIPES_FAKE_YTDLP_MEDIA: config.urlFixtureMp4,
    CLIPES_FAKE_WORKER_HOLD: config.holdFile,
    CLIPES_NVIDIA_SMI: config.noNvidiaSmi,
    CLIPES_TRANSCRIBE_BLOCK_SECONDS: '2',
    FAKE_LOG: config.fakeCliLog,
  };
  if (config.workerMode) {
    childEnv.CLIPES_FAKE_WORKER_MODE = config.workerMode;
  } else {
    delete childEnv.CLIPES_FAKE_WORKER_MODE;
  }

  const driverLogs = [];
  const driverProc = spawn(config.tauriDriverPath, args, {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  driverProc.stdout?.on('data', d => driverLogs.push(d.toString()));
  driverProc.stderr?.on('data', d => driverLogs.push(d.toString()));

  let browser;
  try {
    await waitForTcpPort(driverPort, driverProc);
    browser = await remote({
      hostname: '127.0.0.1',
      port: driverPort,
      logLevel: 'error',
      connectionRetryTimeout: 90_000,
      connectionRetryCount: 2,
      capabilities: {
        browserName: 'wry',
        'wdio:enforceWebDriverClassic': true,
        'tauri:options': {
          application: config.appBinary,
        },
      },
    });
    try {
      await browser.setWindowRect(null, null, 1366, 768);
    } catch {
      // gerenciador de janelas sem redimensionamento livre
    }
    await browser.execute(() => {
      window.__e2eErrors = [];
      window.addEventListener('error', event => window.__e2eErrors.push(String(event.message)));
      window.addEventListener('unhandledrejection', event =>
        window.__e2eErrors.push(String(event.reason?.message ?? event.reason)),
      );
    });

    const ui = createUi(browser);
    await callback(ui);

    const pageErrors = await browser.execute(() => window.__e2eErrors ?? []);
    assert.deepEqual(pageErrors, [], `Erros inesperados na WebView: ${JSON.stringify(pageErrors)}`);
  } catch (error) {
    if (browser) {
      try {
        await mkdir(SHOTS_DIR, { recursive: true });
        await browser.saveScreenshot(path.join(SHOTS_DIR, 'falha-ultima.png'));
        const visible = await browser.execute(() => ({
          hash: window.location.hash,
          texto: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500),
        }));
        console.error(`[e2e] Estado na falha: hash=${visible.hash}
[e2e] Texto visível: ${visible.texto}`);
      } catch {
        // WebView indisponível
      }
    }
    if (driverLogs.length > 0) {
      console.error('[e2e] Logs recentes do tauri-driver:\n' + driverLogs.slice(-20).join(''));
    }
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.deleteSession();
      } catch {
        // sessão já encerrada
      }
    }
    await killProcessTree(driverProc);
    await sleep(1_000);
  }
}

async function readAppVersion() {
  const conf = JSON.parse(await readFile(path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  return conf.version;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runSession1(ui, ctx) {
  const version = await readAppVersion();
  const versionRe = new RegExp(escapeRegExp(version));

  logStep('Sessão 1: Assistente de 1ª execução (#/assistente, 2 passos)…');
  await ui.waitForHash('#/assistente');
  await ui.waitForText('Passo 1: Essencial para transcrever e cortar', 'main');
  await ui.clickButton('Já tenho FFmpeg instalado no computador');
  await ui.clickButton('Validar caminho');
  await ui.waitForText('Pronto', 'section[aria-label="FFmpeg e FFprobe"]', 30_000);
  await ui.shot('01-assistant.png');
  await ui.clickButton('Próximo: Provedor de IA');
  await ui.waitForHash('#/assistente?passo=2');
  await ui.waitForText('Passo 2: Quem escolhe os Cortes e sugere títulos', 'main');
  const radios = await ui.waitForText('Codex CLI', '[role="radiogroup"][aria-label="Escolha de Provedor"]');
  assert.match(radios, /Claude Code CLI/);
  assert.match(radios, /OpenCode CLI/);
  await ui.clickButton('Codex CLI', { exact: false, scopeSelector: '[role="radiogroup"]' });
  await ui.setChecked('Concordo em enviar apenas texto de transcrições pela Codex CLI', true);
  await ui.clickButton('Concluir configuração');
  await ui.waitForHash('#/inicio');
  await ui.waitForText('Projetos', 'main');

  logStep('Sessão 1: Casca (Paleta Ctrl+K, Sobre, atualização mockada, Fila Ctrl+J, F6)…');
  await ui.browser.execute(() => {
    sessionStorage.setItem('clipes.e2e.updaterMode', 'available');
    location.reload();
  });
  await ui.waitForText('Projetos', 'main');
  await ui.browser.keys(['Control', 'k']);
  await ui.waitForDialog('Paleta de comandos', 'dialog');
  await ui.browser.keys('Sobre');
  await ui.shot('02-palette.png');
  await ui.clickPaletteOption('Sobre e atualizações');
  await ui.waitForDialogClosed('Paleta de comandos');
  await ui.waitForHash('#/sobre');
  const aboutText = await ui.waitForText(versionRe, 'main');
  assert.match(aboutText, /Apache-2\.0/);
  await ui.clickButton('Verificar atualizações');
  const updateText = await ui.waitForText('Nova versão disponível', 'main');
  assert.match(updateText, new RegExp(`${escapeRegExp(version)} → 0\\.2\\.0`));
  await ui.clickButton('Baixar e instalar', { exact: false });
  await ui.waitForText('Atualização instalada. Reinicie para aplicar.', 'main');
  await ui.browser.execute(() => sessionStorage.setItem('clipes.e2e.updaterMode', 'off'));
  await ui.shot('03-about.png');

  await ui.browser.keys(['Control', 'j']);
  await ui.browser.waitUntil(
    async () =>
      ui.browser.execute(() => {
        const el = document.querySelector('aside[aria-label="Fila de Jobs"]');
        return Boolean(el && el.getBoundingClientRect().width > 0);
      }),
    { timeout: 10_000, timeoutMsg: 'Fila de Jobs (Ctrl+J) não abriu' },
  );
  await ui.browser.keys(['Escape']);
  await ui.browser.waitUntil(
    async () =>
      ui.browser.execute(() => {
        const el = document.querySelector('aside[aria-label="Fila de Jobs"]');
        return !el || el.getBoundingClientRect().width === 0;
      }),
    { timeout: 10_000, timeoutMsg: 'Fila de Jobs não fechou com Esc' },
  );

  const regionBefore = await ui.browser.execute(
    () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
  );
  await ui.browser.keys(['F6']);
  const regionAfter = await ui.browser.execute(
    () => document.activeElement?.closest('[data-regiao]')?.getAttribute('data-regiao') ?? null,
  );
  assert.ok(regionAfter, 'F6 deve focar uma região macro');
  assert.notEqual(regionAfter, regionBefore, 'F6 deve mudar de região macro');

  logStep('Sessão 1: Componentes (diálogos de licença, yt-dlp, Worker de ML, Modelos, cache)…');
  await ui.navigateHash('#/config/componentes');
  await ui.waitForText('Hardware de Transcrição', 'main');
  await ui.clickTab('Componentes e Modelos');
  const ffmpegScope = 'section[aria-label="FFmpeg e FFprobe"]';
  await ui.waitForText('Pronto', ffmpegScope);
  await ui.clickButton('Reinstalar FFmpeg');
  const ffmpegDialog = await ui.waitForDialog('Baixar FFmpeg e FFprobe?', 'alertdialog');
  assert.match(ffmpegDialog, /GPL-3\.0-or-later/);
  await ui.clickButton('Cancelar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Baixar FFmpeg e FFprobe?');

  await ui.waitForText('2027.01.01.000000', 'section[aria-label="yt-dlp"]');
  await ui.clickButton('Atualizar yt-dlp');
  const ytdlpDialog = await ui.waitForDialog('Atualizar yt-dlp?', 'alertdialog');
  assert.match(ytdlpDialog, /Unlicense/);
  await ui.clickButton('Cancelar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Atualizar yt-dlp?');

  const workerScope = 'section[aria-label="Worker Python e Catálogo"]';
  await ui.clickButton('Instalar Worker');
  const workerDialog = await ui.waitForDialog('Instalar ambiente Python isolado (Worker)?', 'alertdialog');
  assert.match(workerDialog, /Apache-2\.0/);
  await ui.clickButton('Baixar agora', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Instalar ambiente Python isolado (Worker)?');
  await ui.waitForText('Pronto', workerScope, 60_000);
  await ui.clickButton('Detalhes técnicos', { scopeSelector: workerScope });
  await ui.waitForText(/protocol 1/, workerScope);

  const modelsScope = 'section[aria-label="Modelos de Transcrição e Enquadramento"]';
  await ui.waitForText('Whisper small', modelsScope);
  await ui.clickButton('Baixar', { scopeSelector: modelsScope, index: 0 });
  const modelDialog = await ui.waitForText(/Licença\s*MIT/, '[role="alertdialog"]');
  assert.match(modelDialog, /Tamanho/);
  await ui.clickButton('Cancelar', { scopeSelector: '[role="alertdialog"]' });
  await ui.shot('04-components.png');

  await ui.clickTab('Pastas e Armazenamento');
  await ui.browser.waitUntil(async () => (await ui.fieldValue('Limite do cache (GB)')) === '10', {
    timeout: 10_000,
  });
  await ui.fillField('Limite do cache (GB)', '12');
  await ui.clickButton('Salvar pastas e limite');
  await ui.navigateHash('#/config/provedores');
  await ui.navigateHash('#/config/componentes');
  await ui.clickTab('Pastas e Armazenamento');
  await ui.browser.waitUntil(async () => (await ui.fieldValue('Limite do cache (GB)')) === '12', {
    timeout: 10_000,
    timeoutMsg: 'Limite do cache (GB) não persistiu em 12',
  });

  logStep('Sessão 1: Relatos e diagnóstico (2 passos, exportação real em disco + abertura/cópia GitHub)…');
  await ui.navigateHash('#/relatos');
  await ui.waitForText('Relatos e diagnóstico', 'main');
  const forbiddenInStep1 = await ui.browser.execute(() => {
    const names = ['Copiar texto', 'Exportar diagnóstico (.txt)', 'Abrir no GitHub'];
    return Array.from(document.querySelectorAll('button')).filter(b =>
      names.some(n => (b.textContent || '').includes(n)),
    ).length;
  });
  assert.equal(forbiddenInStep1, 0, 'Ações de envio não podem existir no Passo 1 (ADR-0006)');
  assert.equal(await ui.isChecked('Incluir diagnóstico técnico local'), true);
  await ui.clickButton('Sugerir ideia');
  assert.equal(await ui.isChecked('Incluir diagnóstico técnico local'), false);
  await ui.clickButton('Relatar problema');
  assert.equal(await ui.isChecked('Incluir diagnóstico técnico local'), true);

  await ui.fillField('Título', 'Problema com chave');
  await ui.fillField('Descrição', 'Descrição detalhada do problema', { exact: true });
  await ui.waitForText(/menciona "token", "chave" ou "key"/i, 'main');
  await ui.clickButton('Revisar relato antes de enviar');
  await ui.waitForText('Passo 2 de 2', 'main');

  await ui.browser.waitUntil(
    async () => versionRe.test(await ui.fieldValue('Diagnóstico técnico editável')),
    { timeout: 10_000, timeoutMsg: 'Diagnóstico real sem a versão do app' },
  );
  const diagReal = await ui.fieldValue('Diagnóstico técnico editável');
  assert.match(diagReal, /FFmpeg do sistema/);

  const exportedDiagPath = path.join(ctx.tempRoot, 'diagnostico-clipes.txt');
  await ui.queueDialog(exportedDiagPath);
  await ui.clickButton('Exportar diagnóstico (.txt)');
  await ui.waitForText('Diagnóstico exportado em .txt.', 'main');
  const exportedContent = await readFile(exportedDiagPath, 'utf8');
  assert.equal(exportedContent, diagReal);
  await ui.shot('05-report.png');

  await ui.clickButton('Abrir no GitHub');
  await ui.waitForText('Abrindo issue pré-preenchida no GitHub.', 'main');
  let e2eState = await ui.readE2EState();
  assert.equal(e2eState.openedUrls.length, 1);
  const firstUrl = new URL(e2eState.openedUrls[0]);
  assert.equal(firstUrl.searchParams.get('template'), 'bug.yml');
  assert.match(firstUrl.searchParams.get('body') ?? '', versionRe);

  const hugeDiag = 'x'.repeat(9000);
  await ui.fillField('Diagnóstico técnico editável', hugeDiag, { bulk: true });
  await ui.clickButton('Abrir no GitHub');
  await ui.waitForText(/Diagnóstico copiado para a área de transferência/, 'main');
  e2eState = await ui.readE2EState();
  assert.equal(e2eState.openedUrls.length, 2);
  assert.equal(e2eState.copiedText?.length, 9000);
  assert.ok(e2eState.openedUrls[1].length < 8000);

  logStep('Sessão 1: Provedores (Groq no cofre isolado, Perfis HTTP, rotas por Tarefa, Somente local)…');
  await ui.navigateHash('#/config/provedores');
  const groqScope = 'section[aria-label="Transcrição remota (Groq)"]';
  await ui.waitForText('Chave não configurada', groqScope);
  await ui.fillField('Nova chave da API Groq', 'gsk-e2e-isolated-9876', { scopeSelector: groqScope });
  await ui.clickButton('Salvar chave', { scopeSelector: groqScope });
  await ui.waitForText('Chave no cofre: configurada', groqScope);
  assert.equal(await ui.fieldValue('Nova chave da API Groq', { scopeSelector: groqScope }), '');
  const vaultAfterGroq = JSON.parse(await readFile(ctx.vaultFile, 'utf8'));
  assert.equal(vaultAfterGroq['io.github.gustavohooo.clipes.transcription:groq'], 'gsk-e2e-isolated-9876');
  await ui.clickButton('Remover chave Groq', { scopeSelector: groqScope });
  await ui.waitForDialog('Remover chave Groq?', 'alertdialog');
  await ui.clickButton('Remover chave', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Remover chave Groq?');
  await ui.waitForText('Chave não configurada', groqScope);
  await ui.fillField('Nova chave da API Groq', 'gsk-e2e-ready-4321', { scopeSelector: groqScope });
  await ui.clickButton('Salvar chave', { scopeSelector: groqScope });
  await ui.waitForText('Chave no cofre: configurada', groqScope);

  await ui.clickButton('Novo Perfil');
  await ui.waitForDialog('Novo Perfil de Provedor', 'dialog');
  const profileDialog = '[role="dialog"]';
  await ui.fillField('Nome do Perfil', 'Local rápido', { scopeSelector: profileDialog });
  await ui.fillField('Endpoint', ctx.providerServer.endpoint, { scopeSelector: profileDialog });
  await ui.fillField('Modelo', 'qwen-local', { exact: true, scopeSelector: profileDialog });
  await ui.fillField('Chave de API no cofre', 'sk-own-9999', { scopeSelector: profileDialog });
  await ui.setChecked('Chave própria por perfil', true, { scopeSelector: profileDialog });
  await ui.clickButton('Salvar Perfil', { scopeSelector: profileDialog });
  await ui.waitForDialogClosed('Novo Perfil de Provedor');
  const localCard = 'section[aria-label="Perfil Local rápido"]';
  await ui.waitForText('••••9999', localCard);
  const pageHtml = await ui.browser.execute(() => document.documentElement.innerHTML);
  assert.equal(pageHtml.includes('sk-own-9999'), false);

  const requestsBefore = ctx.providerServer.requests.length;
  await ui.clickButton('Testar', { scopeSelector: localCard });
  await ui.browser.waitUntil(() => ctx.providerServer.requests.length > requestsBefore, {
    timeout: 20_000,
    timeoutMsg: 'O servidor HTTP local não recebeu a chamada de teste do Perfil',
  });
  assert.equal(ctx.providerServer.requests.at(-1)?.authorization, 'Bearer sk-own-9999');

  await ui.clickButton('Novo Perfil');
  await ui.waitForDialog('Novo Perfil de Provedor', 'dialog');
  await ui.fillField('Nome do Perfil', 'Nuvem remota', { scopeSelector: profileDialog });
  await ui.fillField('Endpoint', 'https://192.0.2.10/v1', { scopeSelector: profileDialog });
  await ui.fillField('Modelo', 'gpt-5', { exact: true, scopeSelector: profileDialog });
  await ui.clickButton('Salvar Perfil', { scopeSelector: profileDialog });
  await ui.waitForDialogClosed('Novo Perfil de Provedor');
  await ui.waitForText('Remoto', 'section[aria-label="Perfil Nuvem remota"]');

  const taskTable = 'section[aria-label="Roteamento por Tarefa de IA"]';
  await ui.selectField('Perfil para Roteiro', 'Local rápido', { exact: true, scopeSelector: taskTable });
  await ui.waitForText('Local (loopback) · US$ 0,00', taskTable);
  await ui.selectField('Perfil para Empacotamento', 'Nuvem remota', { exact: true, scopeSelector: taskTable });
  await ui.setChecked('Somente local (Empacotamento)', true, { scopeSelector: taskTable });
  await ui.waitForText('Bloqueado pelo modo Somente local', taskTable);
  await ui.setChecked('Somente local (Empacotamento)', false, { scopeSelector: taskTable });
  await ui.waitForTextGone('Bloqueado pelo modo Somente local', taskTable);
  await ui.shot('07-tasks-costs.png');

  await ui.clickButton('Remover', { scopeSelector: localCard });
  await ui.waitForDialog('Remover perfil "Local rápido"?', 'alertdialog');
  await ui.clickButton('Remover perfil', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Remover perfil "Local rápido"?');
  await ui.waitForText('Perfil anterior removido', taskTable);

  logStep('Sessão 1: Aparência (Tema, Contraste, Idioma) e reabertura do Assistente…');
  await ui.navigateHash('#/config/aparencia');
  await ui.waitForText('Aparência e Teclado', 'main');
  const themeGroup = '[role="radiogroup"][aria-label="Tema"]';
  const rootAttr = name => ui.browser.execute(n => document.documentElement.getAttribute(n), name);
  await ui.clickButton('Claro', { scopeSelector: themeGroup });
  await ui.browser.waitUntil(async () => (await rootAttr('data-tema')) === 'claro', {
    timeout: 5_000,
    timeoutMsg: 'data-tema não virou "claro"',
  });
  await ui.shot('06-preferences-light.png');
  await ui.setChecked('Modo Alto Contraste', true);
  await ui.browser.waitUntil(async () => (await rootAttr('data-contrast')) === 'high', {
    timeout: 5_000,
    timeoutMsg: 'data-contrast não virou "high"',
  });
  await ui.setChecked('Modo Alto Contraste', false);
  await ui.browser.waitUntil(async () => (await rootAttr('data-contrast')) === null, { timeout: 5_000 });
  await ui.clickButton('Escuro', { scopeSelector: themeGroup });
  await ui.browser.waitUntil(async () => (await rootAttr('data-tema')) === 'escuro', {
    timeout: 5_000,
    timeoutMsg: 'data-tema não virou "escuro"',
  });

  await ui.navigateHash('#/config/provedores');
  await ui.clickButton('Reabrir assistente inicial');
  await ui.waitForHash('#/assistente');
  await ui.clickButton('Pular por enquanto');
  await ui.waitForHash('#/config/provedores');
}

async function stageModelsInstalled(dataDir) {
  for (const [id, revision] of [
    ['whisper-turbo', '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf'],
    ['whisper-small', '536b0662742c02347bc0e980a01041f333bce120'],
  ]) {
    const dir = path.join(dataDir, 'models', id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'model.state.json'), JSON.stringify({ revision }), 'utf8');
  }
}

async function createProject(ui, ctx, name, firstProject) {
  await ui.navigateHash('#/inicio');
  await ui.waitForText('Projetos', 'main');
  await ui.clickButton(firstProject ? 'Criar primeiro Projeto' : 'Novo Projeto');
  await ui.waitForDialog('Novo Projeto', 'dialog');
  await ui.fillField('Nome do Projeto', name, { scopeSelector: '[role="dialog"]' });
  await ui.queueDialog(ctx.projectsDir);
  await ui.clickButton('Escolher pasta', { scopeSelector: '[role="dialog"]' });
  await ui.clickButton('Criar Projeto', { scopeSelector: '[role="dialog"]' });
  const hash = await ui.waitForHash(/^#\/projeto\/[^/]+\/fontes/);
  assert.equal(existsSync(path.join(ctx.projectsDir, `${name}.clipes`, 'project.sqlite')), true);
  return decodeURIComponent(hash.split('/')[2]);
}

async function openRecentProject(ui, name) {
  await ui.navigateHash('#/inicio');
  await ui.clickButton(`Abrir Projeto ${name}`);
  const hash = await ui.waitForHash(/^#\/projeto\/[^/]+\/fontes/);
  return decodeURIComponent(hash.split('/')[2]);
}

async function runSession2(ui, ctx) {
  logStep('Sessão 2: Persistência pós-reinício (Assistente não reabre, tema escuro preservado)…');
  await ui.waitForHash('#/inicio');
  await ui.waitForText('Projetos', 'main');
  const openDialogsOnBoot = await ui.browser.execute(
    () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
  );
  assert.equal(openDialogsOnBoot, 0, 'O Assistente não deve abrir novamente na segunda execução');
  assert.equal(await ui.browser.execute(() => document.documentElement.getAttribute('data-tema')), 'escuro');

  logStep('Sessão 2: Criação e alternância de Projetos reais (SQLite)…');
  await createProject(ui, ctx, 'Canal', true);
  await createProject(ui, ctx, 'Secundario', false);
  ctx.canalId = await openRecentProject(ui, 'Canal');

  logStep('Sessão 2: Veto "Somente local" do Projeto…');
  const vetoLabel = 'Ativar veto Somente local para este Projeto';
  await ui.navigateHash('#/config/projeto');
  await ui.clickTab('Privacidade (Somente local)');
  await ui.setChecked(vetoLabel, true);
  await ui.waitForText('Somente local', '[data-regiao="topo"]');
  await ui.navigateHash('#/config/provedores');
  await ui.waitForText('Bloqueado pelo modo Somente local', 'section[aria-label="Roteamento por Tarefa de IA"]');
  await ui.navigateHash('#/config/projeto');
  await ui.clickTab('Privacidade (Somente local)');
  await ui.setChecked(vetoLabel, false);

  logStep('Sessão 2: Fontes locais (ffprobe real, 2 faixas, permissão, onda/miniaturas, alteração e relocalização)…');
  const fontesHash = `#/projeto/${encodeURIComponent(ctx.canalId)}/fontes`;
  await ui.navigateHash(fontesHash);
  const entrada = 'aside[aria-label="Entrada de Fonte"]';
  await ui.queueDialog(ctx.sourceMkv);
  await ui.clickButton('Escolher arquivo', { scopeSelector: entrada });
  await ui.waitForText(/64\s*×\s*64/, entrada);
  await ui.selectField('Faixa de áudio (microfone)', '2 ·', { scopeSelector: entrada });
  await ui.clickButton('Tenho permissão do criador', { scopeSelector: entrada });
  await ui.fillField('Quem autorizou', 'Criadora Oficial', { scopeSelector: entrada });
  await ui.fillField('Onde foi autorizada', 'Contrato assinado', { scopeSelector: entrada });
  await ui.fillField('Escopo', 'Cortes e tradução', { scopeSelector: entrada });
  await ui.setChecked('Copiar vídeo para dentro do Projeto', false, { scopeSelector: entrada });
  await ui.clickButton('Importar Fonte', { scopeSelector: entrada });
  const mkvCard = 'article[aria-label="source.mkv"]';
  await ui.waitForText('Autorizada', mkvCard);

  const previewCacheRoot = path.join(ctx.dataDir, 'cache', 'previews');
  await ui.browser.waitUntil(
    async () => existsSync(previewCacheRoot) && (await readdir(previewCacheRoot)).length >= 1,
    { timeout: 40_000, interval: 500, timeoutMsg: 'Cache de prévia (onda/miniaturas) não foi criado' },
  );

  const pastDate = new Date(1_700_000_000_000);
  await utimes(ctx.sourceMkv, pastDate, pastDate);
  await ui.reloadApp(fontesHash);
  await ui.waitForText('Alterada', mkvCard);
  await ui.clickButton('Verificar identidade', { scopeSelector: mkvCard });
  await ui.waitForText('Disponível', mkvCard);

  const movedMkv = path.join(ctx.mediaDir, 'source-moved.mkv');
  await rename(ctx.sourceMkv, movedMkv);
  await ui.reloadApp(fontesHash);
  await ui.waitForText('Offline', mkvCard);
  await ui.clickButton('Relocalizar arquivo', { scopeSelector: mkvCard });
  await ui.waitForDialog('Relocalizar arquivo — source.mkv', 'dialog');
  await ui.queueDialog(movedMkv);
  await ui.clickButton('Escolher arquivo', { scopeSelector: '[role="dialog"]' });
  await ui.clickButton('Relocalizar', { scopeSelector: '[role="dialog"]', exact: true });
  await ui.waitForText('Disponível', 'article[aria-label="source-moved.mkv"]');

  logStep('Sessão 2: Importação por URL (Termos, troca de pasta, fake-ytdlp + ffprobe real)…');
  await ui.clickButton('URL (VOD)', { scopeSelector: entrada });
  await ui.queueDialog(ctx.downloadsDir);
  await ui.clickButton('Trocar pasta', { scopeSelector: entrada });
  await ui.waitForDialog('Pasta de downloads por URL', 'dialog');
  await ui.clickButton('Escolher pasta', { scopeSelector: '[role="dialog"]' });
  await ui.clickButton('Salvar pasta', { scopeSelector: '[role="dialog"]' });
  await ui.waitForText(ctx.downloadsDir, entrada);
  await ui.fillField('URL do vídeo (YouTube VOD)', 'https://example.com/watch?v=video123', { scopeSelector: entrada });
  await ui.clickButton('Baixar por URL', { scopeSelector: entrada });
  const termsText = await ui.waitForDialog('Termos de uso do YouTube', 'alertdialog');
  assert.match(termsText, /proíbem baixar conteúdo sem autorização/);
  await ui.clickButton('Aceitar e baixar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Termos de uso do YouTube');
  await ui.waitForText('video123.mp4', entrada, 30_000);
  await ui.clickButton('Sem permissão registrada', { scopeSelector: entrada });
  await ui.clickButton('Importar Fonte', { scopeSelector: entrada });
  await ui.waitForText('Sem permissão', 'article[aria-label="video123.mp4"]');
  await ui.shot('08-project-sources.png');

  logStep('Sessão 2: Transcrição local (cancelamento mantendo blocos, retomada e leitor)…');
  await ui.clickButton('Abrir', { scopeSelector: 'article[aria-label="source-moved.mkv"]' });
  await ui.waitForHash(/^#\/projeto\/[^/]+\/fontes\/[^/?]+/);
  await writeFile(ctx.holdFile, 'after-first', 'utf8');
  await ui.clickButton('Iniciar transcrição');
  await ui.waitForText(/Transcrevendo bloco 1 de 1 33%/, 'main', 30_000);
  await ui.clickButton('Pausar / Cancelar mantendo blocos salvos');
  await ui.waitForText(/Transcrição parcial salva até/, 'main', 20_000);
  await rm(ctx.holdFile, { force: true });
  await ui.clickButton('Retomar de', { exact: false });
  const timelineText = await ui.waitForText(
    /palavra[\s\S]*[Ss]ilêncio|[Ss]ilêncio[\s\S]*palavra/,
    'section[aria-label="Leitor da Transcrição"]',
    40_000,
  );
  assert.match(timelineText, /[Ss]ilêncio/);
  await ui.shot('09-transcription-timeline.png');

  logStep('Sessão 2: Backups (configuração, criação manual, alteração de estado e restauração real)…');
  // O fake yt-dlp não emite 100% e o app mantém o job de URL como "rodando" até recarregar a WebView;
  // com jobs ativos a restauração de backup fica (corretamente) bloqueada.
  await ui.reloadApp('#/config/projeto', 'Projeto atual');
  await ui.clickTab('Backups do Projeto');
  await ui.fillField('Intervalo (segundos)', '900');
  await ui.fillField('Cópias mantidas', '5');
  await ui.clickButton('Salvar configuração');
  await ui.clickButton('Criar backup agora');
  await ui.waitForText('Backups salvos (1)', 'main');
  await ui.clickTab('Privacidade (Somente local)');
  await ui.setChecked(vetoLabel, true);
  await ui.clickTab('Backups do Projeto');
  await ui.waitForTextGone(/tarefa\(s\) em andamento na Fila/, 'main', 60_000);
  await ui.clickButton('Restaurar backup de', { exact: false, index: 0 });
  await ui.waitForText(/Restaurar backup/, '[role="alertdialog"]');
  await ui.clickButton('Restaurar backup', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForText('Pré-restauração', 'main');
  await ui.shot('10-backups.png');
  await ui.clickTab('Privacidade (Somente local)');
  assert.equal(
    await ui.isChecked(vetoLabel),
    false,
    'Restauração do backup deve reverter Somente local para desligado no project.sqlite',
  );
}

async function prepareV1ProjectFixture({ tempRoot, ffmpeg }) {
  const mediaDir = path.join(tempRoot, 'media');
  const projectDir = path.join(tempRoot, 'projects', 'ProjetoV1.clipes');
  await mkdir(projectDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });
  const sourcePath = path.join(mediaDir, 'v1-source.mp4');
  execFileSync(
    ffmpeg,
    [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-y', sourcePath,
    ],
    { stdio: 'inherit' },
  );
  const probe = ffprobeJson(sourcePath);
  const audioIndex = probe.streams.find(s => s.codec_type === 'audio').index;
  const durationUs = Math.round(Number(probe.format.duration) * 1_000_000);

  // Hash parcial idêntico ao de core/src/sources.rs::partial (3 blocos de até 4 MiB).
  const bytes = await readFile(sourcePath);
  const block = 4 * 1024 * 1024;
  const tail = Math.max(bytes.length - block, 0);
  const hash = createHash('sha256');
  for (const offset of [0, Math.floor(tail / 2), tail]) {
    hash.update(bytes.subarray(offset, Math.min(offset + block, bytes.length)));
  }
  const modified = statSync(sourcePath, { bigint: true }).mtimeNs.toString();

  const dbPath = path.join(projectDir, 'project.sqlite');
  await copyFile(path.join(REPO_ROOT, 'core', 'tests', 'fixtures', 'project-pre-0104.sqlite'), dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('DELETE FROM sources; DELETE FROM project;');
    db.prepare('INSERT INTO project(name) VALUES (?)').run('ProjetoV1');
    db.prepare(
      `INSERT INTO sources(id,path,size,duration_us,partial_hash,metadata,permission,audio_track,modified)
       VALUES (1,?,?,?,?,?,?,?,?)`,
    ).run(
      sourcePath,
      bytes.length,
      durationUs,
      hash.digest('hex'),
      JSON.stringify(probe),
      JSON.stringify({ status: 'granted', who: 'Canal V1', where: 'Acordo interno', scope: 'Cortes verticais' }),
      audioIndex,
      modified,
    );
  } finally {
    db.close();
  }
  return { v1ProjectDir: projectDir, v1SourcePath: sourcePath };
}

/**
 * As tabelas de Transcrição e de seleção vêm de migrações Rust posteriores ao banco V1; só existem
 * depois que o app abre o Projeto (e grava `project.pre-migration.sqlite`). Por isso este seed roda
 * logo após a abertura: 4 Frases de 7,5 s e uma execução de seleção V1 com 2 candidatos pendentes.
 */
function seedV1Selection(projectDir) {
  const db = new DatabaseSync(path.join(projectDir, 'project.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout = 10000;');
    const sentenceUs = 7_500_000;
    const texts = [
      ['Bem-vindos ao canal', 'hoje vamos falar de cortes.'],
      ['O primeiro assunto', 'é como revisar cada trecho.'],
      ['Depois ajustamos', 'as bordas por Frase inteira.'],
      ['No final exportamos', 'o vídeo vertical pronto.'],
    ];
    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      `INSERT INTO transcripts(id,source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
       VALUES (1,1,1,'local','whisper-small','r','int8','complete',?1,?1)`,
    ).run(sentenceUs * 4);
    const word = db.prepare(
      `INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
       VALUES (1,?,'word',?,?,?,'pt')`,
    );
    const sentence = db.prepare(
      `INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
       VALUES (1,?,?,?,?,?,'pt',?)`,
    );
    texts.forEach(([a, b], i) => {
      const start = i * sentenceUs;
      word.run(i * 2, ` ${a}`, start, start + 3_600_000);
      word.run(i * 2 + 1, ` ${b}`, start + 3_800_000, start + sentenceUs);
      sentence.run(i + 1, i * 2, i * 2 + 1, start, start + sentenceUs, `${a} ${b}`);
    });
    db.prepare(
      `INSERT INTO selection_runs(id,transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,windows_completed,candidates_kept,video_kind,revision)
       VALUES (1,1,1,'h','Local rápido','completed','',20000000,180000000,'[]','full',1,1,2,'direct',1)`,
    ).run();
    db.prepare(
      `INSERT INTO selection_windows(run_id,idx,first_id,last_id,start_us,end_us,profile)
       VALUES (1,0,1,4,0,?,'Local rápido')`,
    ).run(sentenceUs * 4);
    const cand = db.prepare(
      `INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust,revision,profile)
       VALUES (1,?,?,?,?,?,'{}',?,?,'[0]',NULL,1,'Local rápido')`,
    );
    cand.run(1, 1, 3, 0, sentenceUs * 3, 825, 'Revisar cada trecho');
    cand.run(2, 2, 4, sentenceUs, sentenceUs * 4, 780, 'Ajustar e exportar');
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

function ffprobeJson(file) {
  return JSON.parse(
    execFileSync(findExecutable('ffprobe'), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  );
}

async function runSession3(ui, ctx) {
  logStep('Sessão 3: Projeto V1 → abrir → revisar → editar → exportar (MP4 real)…');
  await ui.waitForHash('#/inicio'); // exige a Sessão 1 antes (Assistente concluído e FFmpeg do sistema registrado)
  await ui.waitForText('Projetos', 'main');

  await ui.queueDialog(ctx.v1ProjectDir);
  await ui.clickButton('Abrir pasta .clipes');
  const hash = await ui.waitForHash(/^#\/projeto\/[^/]+\/fontes/);
  const projectId = hash.split('/')[2];
  assert.equal(
    existsSync(path.join(ctx.v1ProjectDir, 'project.pre-migration.sqlite')),
    true,
    'Migração do Projeto V1 deve gravar project.pre-migration.sqlite',
  );
  await ui.waitForText('v1-source.mp4', 'main');
  await ui.shot('s3-01-projeto-v1-fontes.png');

  seedV1Selection(ctx.v1ProjectDir);
  await ui.reloadApp(`#/projeto/${projectId}/cortes?fonte=1&run=1`, 'Abrir bancada de revisão');
  await ui.shot('s3-02-cortes-v1.png');

  logStep('Sessão 3: revisão na Bancada…');
  await ui.clickButton('Abrir bancada de revisão', { exact: false });
  await ui.waitForHash(/\/cortes\/revisao\/1/);
  await ui.waitForText('Revisar cada trecho', 'main');
  await ui.waitForText('Converter em Vídeo transformado', 'main');
  try {
    await ui.browser.waitUntil(
      () =>
        ui.browser.execute(() => {
          const b = Array.from(document.querySelectorAll('button')).find(x =>
            (x.textContent || '').includes('Converter em Vídeo transformado'),
          );
          return b?.getAttribute('aria-disabled') === 'true';
        }),
      {
        timeout: 15_000,
        timeoutMsg: 'A conversão individual (#292) deve continuar desabilitada em Corte direto',
      },
    );
  } catch (error) {
    const html = await ui.browser.execute(() =>
      Array.from(document.querySelectorAll('button'))
        .filter(x => (x.textContent || '').includes('Converter'))
        .map(x => ({ attrs: x.getAttributeNames().map(n => n + '=' + String(x.getAttribute(n)).slice(0, 40)).filter(s => !s.startsWith('class=')), text: x.textContent })),
    );
    console.log('[e2e] Botões Converter:', JSON.stringify(html));
    throw error;
  }
  await ui.clickButton('Avançar fim 1 Frase', { exact: false });
  await ui.waitForText('Duração atual: 30 s', 'main');
  await ui.clickButton('Recuar fim 1 Frase', { exact: false });
  await ui.waitForText('Duração atual: 23 s', 'main');
  await ui.clickButton('Aprovar');
  await ui.waitForText('Aprovado', 'main');
  await ui.shot('s3-03-revisao-aprovada.png');
  await ui.clickButton('Abrir no editor');
  await ui.waitForHash(/\/corte\/[^/]+\/editar/);

  logStep('Sessão 3: editor e salvar…');
  await ui.waitForText('Exportar Corte', 'body');
  await ui.browser.keys(['Control', 's']);
  await ui.waitForText('Salvo', 'body');
  await ui.shot('s3-04-editor.png');

  logStep('Sessão 3: exportar Corte em MP4…');
  const outputPath = path.join(ctx.tempRoot, 'corte-v1-exportado.mp4');
  await ui.clickButton('Exportar Corte');
  await ui.waitForDialog('Exportar Corte em MP4 (1080×1920)', 'dialog');
  await ui.queueDialog(outputPath);
  await ui.clickButton('Escolher arquivo', { scopeSelector: '[role="dialog"]' });
  await ui.clickButton('Iniciar exportação', { scopeSelector: '[role="dialog"]' });
  await ui.waitForText('Corte exportado com sucesso', '[role="dialog"]', 240_000);
  await ui.shot('s3-05-exportado.png');
  await ui.clickButton('Fechar', { scopeSelector: '[role="dialog"]' });

  const info = ffprobeJson(outputPath);
  const video = info.streams.find(s => s.codec_type === 'video');
  const audio = info.streams.find(s => s.codec_type === 'audio');
  assert.equal(video?.codec_name, 'h264');
  assert.equal(video?.width, 1080);
  assert.equal(video?.height, 1920);
  assert.equal(audio?.codec_name, 'aac');
  assert.equal(audio?.sample_rate, '48000');
  logStep(
    `Sessão 3: ffprobe do MP4: ${video.codec_name} ${video.width}x${video.height}, ${audio.codec_name} ${audio.sample_rate} Hz`,
  );

  await ui.navigateHash(`#/projeto/${projectId}/exportacao`);
  await ui.waitForText('Revisar cada trecho', 'main');
  await ui.shot('s3-06-exportacao.png');

  logStep('Sessão 3: fechamento coordenado (#291) sem jobs ativos…');
  await ui.browser.execute(() => window.close());
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build') || process.env.CLIPES_E2E_SKIP_BUILD === '1';
  const { tauriDriverPath, nativeDriverPath } = await ensureWebDriver();
  const { appBinary, fakeWorkerBinary, rustc, ffmpeg } = ensureBuildArtifacts({ skipBuild });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipes-e2e-'));
  const dataDir = path.join(tempRoot, 'data');
  const vaultFile = path.join(tempRoot, 'vault.json');
  const holdFile = path.join(tempRoot, 'worker.hold');
  const fakeCliLog = path.join(tempRoot, 'fake-cli.log');
  const noNvidiaSmi = path.join(tempRoot, 'no-nvidia-smi');
  let providerServer;

  try {
    const fixtures = await prepareFixtures({ tempRoot, dataDir, fakeWorkerBinary, rustc, ffmpeg });
    providerServer = await startFakeProviderServer();
    const sharedConfig = {
      appBinary,
      tauriDriverPath,
      nativeDriverPath,
      dataDir,
      vaultFile,
      holdFile,
      fakeCliLog,
      noNvidiaSmi,
      cliBinDir: fixtures.cliBinDir,
      urlFixtureMp4: fixtures.urlFixtureMp4,
    };
    const ctx = {
      tempRoot,
      dataDir,
      vaultFile,
      holdFile,
      providerServer,
      ...fixtures,
    };

    const sessions = (process.env.CLIPES_E2E_SESSIONS ?? '1,2,3').split(',').map(n => n.trim());
    if (sessions.includes('1')) {
      await withTauriSession({ ...sharedConfig, workerMode: '' }, ui => runSession1(ui, ctx));
    }
    await stageModelsInstalled(dataDir);
    if (sessions.includes('2')) {
      await withTauriSession({ ...sharedConfig, workerMode: 'transcribe' }, ui => runSession2(ui, ctx));
    }
    if (sessions.includes('3')) {
      const v1 = await prepareV1ProjectFixture({ tempRoot, ffmpeg });
      await withTauriSession({ ...sharedConfig, workerMode: '' }, ui => runSession3(ui, { ...ctx, ...v1 }));
    }

    logStep(`Suíte E2E Tauri (Sessões ${sessions.join(', ')}) concluída com sucesso: OK`);
  } finally {
    await providerServer?.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
  }
}

main().catch(error => {
  console.error('[e2e] FALHA:', error);
  process.exitCode = 1;
});
