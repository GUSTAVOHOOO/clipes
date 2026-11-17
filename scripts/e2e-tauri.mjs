import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
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
              return norm(el.innerText || el.textContent || '');
            };
            const scope = s.scopeSelector ? document.querySelector(s.scopeSelector) : document;
            if (!scope) return false;
            const matchText = (actual, expected, exact) =>
              exact ? actual === expected : actual.includes(expected);

            const matchRow = el =>
              !s.rowContains || Boolean(el.closest('li,tr,article')?.textContent?.includes(s.rowContains));

            let candidates = [];
            if (s.kind === 'button') {
              candidates = Array.from(scope.querySelectorAll('button,[role="button"]')).filter(
                el =>
                  isVisible(el) &&
                  !el.disabled &&
                  matchRow(el) &&
                  matchText(nameOf(el), s.name, s.exact !== false),
              );
            } else if (s.kind === 'option') {
              candidates = Array.from(scope.querySelectorAll('[role="option"],[cmdk-item]')).filter(
                el => isVisible(el) && matchText(norm(el.textContent), s.name, false),
              );
            } else if (s.kind === 'field') {
              const controls = Array.from(scope.querySelectorAll('input,textarea,select')).filter(
                el => isVisible(el) && !el.disabled && matchRow(el),
              );
              candidates = controls.filter(ctrl => {
                const aria = ctrl.getAttribute('aria-label');
                if (aria && matchText(norm(aria), s.label, s.exact !== false)) return true;
                if (ctrl.id) {
                  const explicit = document.querySelector(`label[for="${CSS.escape(ctrl.id)}"]`);
                  if (explicit && matchText(norm(explicit.textContent), s.label, s.exact !== false)) return true;
                }
                const wrapping = ctrl.closest('label');
                if (wrapping) {
                  const clone = wrapping.cloneNode(true);
                  clone.querySelectorAll('input,textarea,select').forEach(n => n.remove());
                  if (matchText(norm(clone.textContent), s.label, s.exact !== false)) return true;
                }
                return false;
              });
            } else if (s.kind === 'switch') {
              candidates = Array.from(scope.querySelectorAll('input[role="switch"],input[type="checkbox"]')).filter(
                el => {
                  if (!isVisible(el) || el.disabled) return false;
                  const aria = el.getAttribute('aria-label');
                  if (aria && matchText(norm(aria), s.label, false)) return true;
                  const wrapping = el.closest('label');
                  return wrapping ? matchText(norm(wrapping.textContent), s.label, false) : false;
                },
              );
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

  async function clickButton(name, options = {}) {
    const el = await tagElement({
      kind: 'button',
      name,
      exact: options.exact ?? true,
      scopeSelector: options.scopeSelector ?? null,
      rowContains: options.rowContains ?? null,
      index: options.index ?? 0,
    });
    await el.click();
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
    await el.click();
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

  async function selectField(label, optionValue, options = {}) {
    const el = await tagElement({
      kind: 'field',
      label,
      exact: options.exact ?? false,
      scopeSelector: options.scopeSelector ?? null,
      rowContains: options.rowContains ?? null,
    });
    await el.selectByAttribute('value', optionValue);
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

  async function setChecked(label, desired, options = {}) {
    const el = await tagElement({
      kind: 'switch',
      label,
      scopeSelector: options.scopeSelector ?? null,
    });
    const current = await browser.execute(target => Boolean(target.checked), el);
    if (current !== desired) await el.click();
  }

  async function isChecked(label, options = {}) {
    const el = await tagElement({
      kind: 'switch',
      label,
      scopeSelector: options.scopeSelector ?? null,
    });
    return browser.execute(target => Boolean(target.checked), el);
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
      connectionRetryTimeout: 60_000,
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
      await browser.setWindowRect(null, null, 1366, 840);
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
    await sleep(300);
  }
}

async function runSession1(ui, ctx) {
  logStep('Sessão 1: Assistente de 1ª execução…');
  await ui.waitForDialog('Escolha como o Clipes vai usar IA', 'dialog');
  await ui.waitForText('Codex CLI', '[aria-labelledby="assistant-detected"]');
  await ui.waitForText('Claude Code CLI', '[aria-labelledby="assistant-detected"]');
  await ui.waitForText('OpenCode CLI', '[aria-labelledby="assistant-detected"]');
  await ui.waitForText('Nenhum Provedor escolhido ainda.', '[role="dialog"]');
  await ui.shot('01-assistant.png');

  await ui.clickButton('Usar Codex CLI', { scopeSelector: '[role="dialog"]' });
  const cliWarn = await ui.waitForDialog('Enviar texto ao Provedor?', 'alertdialog');
  assert.match(cliWarn, /pode rodar comandos de leitura/);
  await ui.clickButton('Cancelar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Enviar texto ao Provedor?');

  await ui.clickButton('Usar Codex CLI', { scopeSelector: '[role="dialog"]' });
  await ui.waitForDialog('Enviar texto ao Provedor?', 'alertdialog');
  await ui.clickButton('Ativar e permitir envio', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Enviar texto ao Provedor?');
  await ui.waitForText('Provedor padrão escolhido: Codex CLI', '[role="dialog"]');
  await ui.clickButton('Concluir', { scopeSelector: '[role="dialog"]' });
  await ui.waitForDialogClosed('Escolha como o Clipes vai usar IA');

  logStep('Sessão 1: Casca (UpdateNotice mockado via hook E2E, Paleta Ctrl+K, Gavetas [ / ], Sobre)…');
  await ui.browser.execute(() => {
    sessionStorage.setItem('clipes.e2e.updaterMode', 'available');
    location.reload();
  });
  const updateText = await ui.waitForDialog('Atualização disponível', 'dialog');
  assert.match(updateText, /0\.1\.0/);
  assert.match(updateText, /0\.2\.0/);
  await ui.clickButton('Atualizar agora', { scopeSelector: '[role="dialog"]' });
  await ui.waitForText('Atualização instalada', '[role="dialog"]');
  await ui.browser.execute(() => sessionStorage.setItem('clipes.e2e.updaterMode', 'off'));
  await ui.clickButton('Fechar', { scopeSelector: '[role="dialog"]' });
  await ui.waitForDialogClosed('Atualização instalada');

  await ui.browser.keys(['Control', 'k']);
  await ui.waitForDialog('Paleta de comandos', 'dialog');
  await ui.shot('02-palette.png');
  await ui.clickPaletteOption('Sobre');
  await ui.waitForDialogClosed('Paleta de comandos');
  const aboutText = await ui.waitForText('0.1.0', 'main');
  assert.match(aboutText, /Apache-2\.0/);
  await ui.shot('03-about.png');

  await ui.browser.keys(['[']);
  await ui.waitForDialog('Gaveta esquerda', 'dialog');
  await ui.browser.keys(['Tab']);
  const insideLeftDrawer = await ui.browser.execute(() =>
    Boolean(document.querySelector('aside[aria-label="Gaveta esquerda"]')?.contains(document.activeElement)),
  );
  assert.equal(insideLeftDrawer, true);
  await ui.browser.keys(['Escape']);
  await ui.waitForDialogClosed('Gaveta esquerda');

  await ui.browser.keys([']']);
  await ui.waitForDialog('Gaveta direita', 'dialog');
  await ui.browser.keys(['Escape']);
  await ui.waitForDialogClosed('Gaveta direita');

  logStep('Sessão 1: Componentes (manifesto real, FFmpeg do sistema, yt-dlp, Worker de ML, Modelos)…');
  await ui.clickButton('Componentes');
  const compText = await ui.waitForText('GPL-3.0-or-later', 'main');
  assert.match(compText, /Unlicense/);
  await ui.waitForText('2027.01.01.000000', 'main');
  await ui.browser.waitUntil(async () => (await ui.fieldValue('Limite do cache (GB)')) === '10', {
    timeout: 10_000,
  });

  await ui.queueConfirm(false);
  await ui.clickButton('Baixar', { index: 0 });
  const afterCancelDownload = await ui.readE2EState();
  assert.equal(afterCancelDownload.confirmCalls.length, 1);

  await ui.clickButton('Atualizar yt-dlp');
  const ytdlpDialog = await ui.waitForDialog('Atualizar yt-dlp?', 'alertdialog');
  assert.match(ytdlpDialog, /2027\.01\.01\.000000/);
  await ui.clickButton('Cancelar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Atualizar yt-dlp?');

  await ui.clickButton('Validar e usar');
  await ui.waitForText(/ffmpeg version/i, 'main');
  await ui.fillField('Limite do cache (GB)', '12');
  await ui.clickButton('Salvar', { exact: true });
  await ui.waitForText('Configurações salvas.', 'main');

  await ui.waitForText('Instale o worker de ML antes de baixar um modelo.', '[aria-labelledby="models-title"]');
  await ui.clickButton('Instalar worker', { scopeSelector: '[aria-labelledby="worker-title"]' });
  const workerDialog = await ui.waitForDialog('Instalar o worker de ML?', 'alertdialog');
  assert.match(workerDialog, /uv: MIT OR Apache-2\.0/);
  assert.match(workerDialog, /Python gerenciado: PSF-2\.0/);
  await ui.clickButton('Instalar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Instalar o worker de ML?');
  await ui.waitForText('Worker instalado.', '[aria-labelledby="worker-title"]');
  const workerStatus = await ui.waitForText('Protocolo 1', '[aria-labelledby="worker-title"]');
  assert.match(workerStatus, /faster-whisper fake/);

  await ui.clickButton('Componentes');
  await ui.clickButton('Sobre');
  await ui.clickButton('Componentes');
  await ui.waitForText('Whisper small (CPU)', '[aria-labelledby="models-title"]');
  await ui.clickButton('Baixar modelo', { scopeSelector: '[aria-labelledby="models-title"]', index: 0 });
  const modelDialog = await ui.waitForDialog('Baixar o modelo?', 'alertdialog');
  assert.match(modelDialog, /Licença: MIT/);
  assert.match(modelDialog, /SHA-256/);
  await ui.clickButton('Cancelar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Baixar o modelo?');
  await ui.shot('04-components.png');

  logStep('Sessão 1: Relatos e diagnóstico (exportação real em disco + abertura/cópia GitHub)…');
  await ui.clickButton('Relatos');
  await ui.waitForText('Relatos e diagnóstico', 'main');
  assert.equal(await ui.isChecked('Incluir diagnóstico'), true);
  await ui.clickButton('Sugerir ideia');
  assert.equal(await ui.isChecked('Incluir diagnóstico'), false);
  await ui.clickButton('Relatar problema');
  assert.equal(await ui.isChecked('Incluir diagnóstico'), true);

  await ui.fillField('Título', 'Problema com chave');
  await ui.fillField('Relato', 'Descrição detalhada do problema', { exact: true });
  await ui.waitForText(/menciona token ou chave/i, 'main');
  await ui.clickButton('Revisar relato');

  await ui.browser.waitUntil(
    async () => /Clipes: 0\.1\.0/.test(await ui.fieldValue('Diagnóstico', { exact: true })),
    { timeout: 10_000 },
  );
  const diagReal = await ui.fieldValue('Diagnóstico', { exact: true });
  assert.match(diagReal, /FFmpeg do sistema/);

  const exportedDiagPath = path.join(ctx.tempRoot, 'diagnostico-clipes.txt');
  await ui.queueDialog(exportedDiagPath);
  await ui.clickButton('Exportar diagnóstico');
  await ui.waitForText('Diagnóstico exportado.', 'main');
  const exportedContent = await readFile(exportedDiagPath, 'utf8');
  assert.equal(exportedContent, diagReal);
  await ui.shot('05-report.png');

  await ui.clickButton('Abrir no GitHub');
  await ui.waitForText('Abrindo no navegador.', 'main');
  let e2eState = await ui.readE2EState();
  assert.equal(e2eState.openedUrls.length, 1);
  const firstUrl = new URL(e2eState.openedUrls[0]);
  assert.equal(firstUrl.searchParams.get('template'), 'bug.yml');
  assert.match(firstUrl.searchParams.get('body') ?? '', /Clipes: 0\.1\.0/);

  const hugeDiag = 'x'.repeat(9000);
  await ui.fillField('Diagnóstico', hugeDiag, { exact: true, bulk: true });
  await ui.clickButton('Abrir no GitHub');
  await ui.waitForText('Diagnóstico copiado. Cole-o no relato do GitHub.', 'main');
  e2eState = await ui.readE2EState();
  assert.equal(e2eState.openedUrls.length, 2);
  assert.equal(e2eState.copiedText?.length, 9000);
  assert.ok(e2eState.openedUrls[1].length < 8000);

  logStep('Sessão 1: Preferências (Groq cofre isolado, Tema/Idioma, Provedores HTTP/CLI, Perfis, Tarefas, Custos)…');
  await ui.clickButton('Preferências');
  await ui.waitForText('Chave não configurada.', '#transcription-settings');
  await ui.fillField('Chave Groq', 'gsk-e2e-isolated-9876', { scopeSelector: '#transcription-settings' });
  await ui.clickButton('Salvar chave', { scopeSelector: '#transcription-settings' });
  await ui.waitForText('Chave configurada.', '#transcription-settings');
  assert.equal(await ui.fieldValue('Chave Groq', { scopeSelector: '#transcription-settings' }), '');
  const vaultAfterGroq = JSON.parse(await readFile(ctx.vaultFile, 'utf8'));
  assert.equal(vaultAfterGroq['io.github.gustavohooo.clipes.transcription:groq'], 'gsk-e2e-isolated-9876');
  await ui.clickButton('Remover chave', { scopeSelector: '#transcription-settings' });
  await ui.waitForText('Chave não configurada.', '#transcription-settings');
  await ui.fillField('Chave Groq', 'gsk-e2e-ready-4321', { scopeSelector: '#transcription-settings' });
  await ui.clickButton('Salvar chave', { scopeSelector: '#transcription-settings' });
  await ui.waitForText('Chave configurada.', '#transcription-settings');

  await ui.selectField('Tema', 'claro');
  await ui.selectField('Idioma', 'en');
  await ui.waitForText('Preferences', 'main');
  const currentTheme = await ui.browser.execute(() => document.documentElement.getAttribute('data-theme'));
  assert.equal(currentTheme, 'light');

  const assistantSettingsScope = 'section[aria-labelledby="assistant-settings-title"]';
  assert.equal(await ui.fieldValue('Default for all tasks', { scopeSelector: assistantSettingsScope }), 'codex');
  await ui.selectField('Default for all tasks', '', { scopeSelector: assistantSettingsScope });
  await ui.waitForText('Choice saved.', assistantSettingsScope);

  const providerScope = 'section[aria-labelledby="provider-title"]';
  await ui.fillField('API endpoint', REMOTE_TEST_ENDPOINT, { scopeSelector: providerScope });
  await ui.fillField('Model', 'gpt-5.4', { exact: true, scopeSelector: providerScope });
  await ui.clickButton('Save provider', { scopeSelector: providerScope });
  await ui.waitForText('Settings saved.', providerScope);
  await ui.fillField('API key', 'sk-remote-test-5678', { exact: true, scopeSelector: providerScope });
  await ui.clickButton('Save key', { scopeSelector: providerScope });
  await ui.waitForText('Key saved, ending in 5678', providerScope);

  await ui.clickButton('Test connection', { scopeSelector: providerScope });
  const remoteConsent = await ui.waitForDialog('Send text to provider?', 'alertdialog');
  assert.match(remoteConsent, /192\.0\.2\.10/);
  await ui.browser.keys(['Tab']);
  const trappedInAlert = await ui.browser.execute(() =>
    Boolean(document.querySelector('[role="alertdialog"]')?.contains(document.activeElement)),
  );
  assert.equal(trappedInAlert, true);
  await ui.browser.keys(['Escape']);
  await ui.waitForDialogClosed('Send text to provider?');

  await ui.clickButton('Test connection', { scopeSelector: providerScope });
  await ui.waitForDialog('Send text to provider?', 'alertdialog');
  await ui.clickButton('Send text', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Send text to provider?');
  await ui.waitForText('Use an HTTPS address to send a key to a remote provider.', providerScope);

  const costsScope = 'section[aria-labelledby="costs-title"]';
  await ui.waitForText('Built-in table updated on 2026-11-15.', costsScope);
  await ui.fillField('Sample text (Transcript)', 'a'.repeat(80), { scopeSelector: costsScope });
  await ui.fillField('Output token ceiling (optional)', '100', { scopeSelector: costsScope });
  await ui.clickButton('Estimate cost', { scopeSelector: costsScope });
  await ui.waitForText(/Estimate \(ceiling, not the final amount\)/, costsScope);
  await ui.fillField('Sample text (Transcript)', 'a'.repeat(900_000), { scopeSelector: costsScope, bulk: true });
  await ui.clickButton('Estimate cost', { scopeSelector: costsScope });
  await ui.waitForText(/Higher tier above 272000 input tokens/, costsScope);

  await ui.fillField('Model to override', 'gpt-5.4', { scopeSelector: costsScope });
  await ui.fillField('Input (US$ per million)', '3', { scopeSelector: costsScope });
  await ui.fillField('Output (US$ per million)', '9', { scopeSelector: costsScope });
  await ui.clickButton('Save price', { scopeSelector: costsScope });
  await ui.waitForText('Your price', costsScope);
  await ui.clickButton('Remove price for gpt-5.4', { scopeSelector: costsScope });
  await ui.waitForTextGone('Your price', costsScope);

  await ui.fillField('API endpoint', ctx.providerServer.endpoint, { scopeSelector: providerScope });
  await ui.fillField('Model', 'local-e2e-model', { exact: true, scopeSelector: providerScope });
  await ui.clickButton('Save provider', { scopeSelector: providerScope });
  await ui.waitForText('Settings saved.', providerScope);
  await ui.fillField('API key', 'sk-local-server-1234', { exact: true, scopeSelector: providerScope });
  await ui.clickButton('Save key', { scopeSelector: providerScope });
  await ui.waitForText('Key saved, ending in 1234', providerScope);
  await ui.clickButton('Test connection', { scopeSelector: providerScope });
  await ui.waitForText('Connection tested successfully.', providerScope);
  assert.ok(ctx.providerServer.requests.length >= 1);
  assert.equal(ctx.providerServer.requests.at(-1)?.authorization, 'Bearer sk-local-server-1234');

  const cliScope = 'section[aria-labelledby="cli-provider-title"]';
  await ui.fillField('OpenCode model (provider/model)', 'opencode/big-pickle', { scopeSelector: cliScope });
  await ui.clickButton('Use OpenCode CLI', { scopeSelector: cliScope });
  const ocConsent = await ui.waitForDialog('Send text to provider?', 'alertdialog');
  assert.match(ocConsent, /opencode\/big-pickle/);
  await ui.clickButton('Enable and allow sending', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Send text to provider?');
  await ui.waitForText('Selected provider: OpenCode CLI', cliScope);

  await ui.clickButton('Test CLI', { scopeSelector: cliScope });
  await ui.waitForText('Connection tested successfully.', cliScope);

  const opencodeModeFile = path.join(ctx.cliBinDir, 'mode');
  await writeFile(opencodeModeFile, 'free-limit', 'utf8');
  await ui.clickButton('Test CLI', { scopeSelector: cliScope });
  await ui.waitForText('OpenCode free quota exhausted. Retry after 79181 seconds; no automatic retry.', cliScope);
  await rm(opencodeModeFile, { force: true });
  await ui.clickButton('Disable CLI', { scopeSelector: cliScope });
  await ui.waitForText('CLI disabled.', cliScope);

  await ui.shot('06-preferences-light.png');

  await ui.selectField('Language', 'pt-BR');
  await ui.selectField('Tema', 'escuro');
  await ui.waitForText('Preferências', 'main');

  const profilesScope = 'section[aria-labelledby="profiles-title"]';
  await ui.clickButton('Adicionar perfil', { scopeSelector: profilesScope });
  await ui.fillField('Nome do perfil', 'Local rápido', { scopeSelector: profilesScope });
  await ui.fillField('Endereço da API', ctx.providerServer.endpoint, { scopeSelector: profilesScope });
  await ui.fillField('Modelo', 'qwen-local', { exact: true, scopeSelector: profilesScope });
  await ui.setChecked('Usar uma chave própria para este perfil', true, { scopeSelector: profilesScope });
  await ui.clickButton('Salvar perfil', { scopeSelector: profilesScope });
  await ui.waitForText('Local rápido', profilesScope);

  await ui.fillField('Chave de API (Local rápido)', 'sk-own-9999', { exact: true, scopeSelector: profilesScope });
  await ui.clickButton('Salvar chave do perfil', { scopeSelector: 'article[aria-label="Local rápido"]' });
  await ui.waitForText('…9999', 'article[aria-label="Local rápido"]');
  const pageHtml = await ui.browser.execute(() => document.documentElement.innerHTML);
  assert.equal(pageHtml.includes('sk-own-9999'), false);

  await ui.clickButton('Adicionar perfil', { scopeSelector: profilesScope });
  await ui.fillField('Nome do perfil', 'Nuvem remota', { scopeSelector: profilesScope });
  await ui.fillField('Endereço da API', 'https://192.0.2.10/v1', { scopeSelector: profilesScope });
  await ui.fillField('Modelo', 'gpt-5', { exact: true, scopeSelector: profilesScope });
  await ui.clickButton('Salvar perfil', { scopeSelector: profilesScope });
  await ui.waitForText('Nuvem remota', profilesScope);

  const taskTableScope = '[aria-labelledby="task-table-title"]';
  await ui.selectField('Roteiro', 'profile:local-rapido', { exact: true, scopeSelector: taskTableScope });
  await ui.waitForText('Grátis (modelo local)', taskTableScope);
  await ui.selectField('Empacotamento', 'profile:nuvem-remota', { exact: true, scopeSelector: taskTableScope });
  await ui.setChecked('Somente local (Empacotamento)', true, { scopeSelector: taskTableScope });
  await ui.waitForText(/Empacotamento: Bloqueada: o perfil escolhido não é local/, taskTableScope);
  await ui.setChecked('Somente local (Empacotamento)', false, { scopeSelector: taskTableScope });
  await ui.waitForTextGone(/Bloqueada:/, taskTableScope);
  await ui.shot('07-tasks-costs.png');

  await ui.clickButton('Remover', { scopeSelector: 'article[aria-label="Local rápido"]' });
  await ui.waitForDialog('Remover este perfil?', 'alertdialog');
  await ui.clickButton('Remover', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Remover este perfil?');
  await ui.waitForText(/O perfil removido “local-rapido” não existe mais/, taskTableScope);

  await ui.clickButton('Reabrir assistente');
  await ui.waitForDialog('Escolha como o Clipes vai usar IA', 'dialog');
  await ui.clickButton('Pular por enquanto', { scopeSelector: '[role="dialog"]' });
  await ui.waitForDialogClosed('Escolha como o Clipes vai usar IA');
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

async function runSession2(ui, ctx) {
  logStep('Sessão 2: Persistência pós-reinício (Assistente não reabre, tema escuro e dados preservados)…');
  await ui.waitForText('Projetos', 'main');
  const openDialogsOnBoot = await ui.browser.execute(
    () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
  );
  assert.equal(openDialogsOnBoot, 0, 'O Assistente não deve abrir novamente na segunda execução');

  logStep('Sessão 2: Criação e alternância de Projetos reais (SQLite)…');
  await ui.fillField('Nome do Projeto', 'Canal');
  await ui.queueDialog(ctx.projectsDir);
  await ui.clickButton('Criar Projeto');
  await ui.waitForText('Projeto aberto: Canal', 'main');
  const canalPath = path.join(ctx.projectsDir, 'Canal.clipes');
  assert.equal(existsSync(path.join(canalPath, 'project.sqlite')), true);

  await ui.fillField('Nome do Projeto', 'Secundario');
  await ui.queueDialog(ctx.projectsDir);
  await ui.clickButton('Criar Projeto');
  await ui.waitForText('Projeto aberto: Secundario', 'main');

  await ui.clickButton('Abrir pasta', { rowContains: 'Canal.clipes' });
  await ui.waitForText('Projeto aberto: Canal', 'main');

  logStep('Sessão 2: Veto "Somente local" do Projeto…');
  await ui.setChecked('Somente local', true, { scopeSelector: '[aria-labelledby="project-privacy-title"]' });
  assert.equal(await ui.isChecked('Somente local', { scopeSelector: '[aria-labelledby="project-privacy-title"]' }), true);
  await ui.clickButton('Preferências');
  await ui.waitForText(/O Projeto aberto está em “somente local”/, '[aria-labelledby="task-table-title"]');
  await ui.clickButton('Início');
  await ui.setChecked('Somente local', false, { scopeSelector: '[aria-labelledby="project-privacy-title"]' });

  logStep('Sessão 2: Fontes locais (ffprobe real, 2 faixas, permissão, onda/miniaturas, alteração e relocalização)…');
  await ui.queueDialog(ctx.sourceMkv);
  await ui.clickButton('Escolher vídeo');
  await ui.waitForText(/64 × 64/, 'main');
  await ui.selectField('Faixa do microfone', '2');
  await ui.selectField('Permissão', 'granted');
  await ui.fillField('Quem autorizou', 'Criadora Oficial');
  await ui.fillField('Onde', 'Contrato assinado');
  await ui.fillField('Escopo (inclua tradução, se autorizada)', 'Cortes e tradução');
  await ui.clickButton('Importar Fonte');
  await ui.waitForText('Tenho permissão: Criadora Oficial · Contrato assinado · Cortes e tradução', 'main');

  await ui.waitForText('Onda e miniaturas', '[aria-labelledby="jobs-title"]');
  await ui.waitForText('Concluída', '[aria-labelledby="jobs-title"]', 30_000);
  const previewCacheRoot = path.join(ctx.dataDir, 'cache', 'previews');
  const previewDirs = await readdir(previewCacheRoot);
  assert.ok(previewDirs.length >= 1, 'Cache de prévia deve conter o diretório do projeto');

  const pastDate = new Date(1_700_000_000_000);
  await utimes(ctx.sourceMkv, pastDate, pastDate);
  await ui.clickButton('Preferências');
  await ui.clickButton('Início');
  await ui.waitForText(/Fonte alterada/, 'main');
  await ui.clickButton('Verificar identidade');
  await ui.waitForText(/Disponível · Tenho permissão/, 'main');

  const movedMkv = path.join(ctx.mediaDir, 'source-moved.mkv');
  await rename(ctx.sourceMkv, movedMkv);
  await ui.clickButton('Preferências');
  await ui.clickButton('Início');
  await ui.waitForText(/Fonte offline/, 'main');
  await ui.queueDialog(movedMkv);
  await ui.clickButton('Relocalizar');
  await ui.waitForText(/Disponível · Tenho permissão/, 'main');

  logStep('Sessão 2: Importação por URL (Termos, troca de pasta, fake-ytdlp + ffprobe real)…');
  await ui.queueDialog(ctx.downloadsDir);
  await ui.clickButton('Trocar pasta');
  await ui.waitForText(ctx.downloadsDir, 'main');
  await ui.fillField('URL do vídeo', 'https://example.com/watch?v=video123');
  await ui.clickButton('Baixar por URL');
  const termsText = await ui.waitForDialog('Aviso sobre os Termos', 'alertdialog');
  assert.match(termsText, /Termos do YouTube proíbem baixar conteúdo sem autorização/);
  await ui.clickButton('Entendi e continuar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Aviso sobre os Termos');
  await ui.waitForText('video123.mp4', 'main');
  await ui.selectField('Permissão', 'none');
  await ui.clickButton('Importar Fonte');
  await ui.waitForText(/video123\.mp4.*Sem permissão/s, 'main');
  await ui.shot('08-project-sources.png');

  logStep('Sessão 2: Transcrição local (progresso, cancelamento no bloco 2, diálogos Groq, retomada e Timeline)…');
  await writeFile(ctx.holdFile, 'after-first', 'utf8');
  await ui.clickButton('Transcrever', { rowContains: 'source-moved.mkv' });
  await ui.waitForText(/Transcrevendo: 33%/, 'main', 20_000);
  await ui.clickButton('Cancelar transcrição', { rowContains: 'source-moved.mkv' });
  await ui.waitForText(/Transcrição interrompida · 33%/, 'main', 15_000);

  await ui.selectField('Motor de transcrição', 'groq', { rowContains: 'source-moved.mkv' });
  await ui.waitForText(/Custo estimado: US\$/, 'main');
  await ui.clickButton('Trocar e transcrever', { rowContains: 'source-moved.mkv' });
  const replaceDialog = await ui.waitForDialog('Apagar Transcrição parcial?', 'alertdialog');
  assert.match(replaceDialog, /Blocos concluídos que serão apagados: 1/);
  await ui.clickButton('Confirmar e transcrever', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Apagar Transcrição parcial?');

  const groqConsent = await ui.waitForDialog('Enviar áudio ao Groq?', 'alertdialog');
  assert.match(groqConsent, /api\.groq\.com/);
  await ui.clickButton('Cancelar', { scopeSelector: '[role="alertdialog"]' });
  await ui.waitForDialogClosed('Enviar áudio ao Groq?');

  await ui.selectField('Motor de transcrição', 'local', { rowContains: 'source-moved.mkv' });
  await rm(ctx.holdFile, { force: true });
  await ui.clickButton('Retomar', { rowContains: 'source-moved.mkv' });
  await ui.waitForText(/Transcrição pronta · [23] palavras/, 'main', 25_000);
  const timelineText = await ui.waitForText('palavra', 'section[aria-label="Transcrição"]');
  assert.match(timelineText, /Silêncio/);
  assert.match(timelineText, /pt/);
  await ui.shot('09-transcription-timeline.png');

  logStep('Sessão 2: Backups (configuração, criação manual, alteração de estado e restauração real)…');
  const backupsScope = 'section[aria-labelledby="backups-title"]';
  await ui.fillField('Intervalo (minutos)', '15', { scopeSelector: backupsScope });
  await ui.fillField('Cópias mantidas', '5', { scopeSelector: backupsScope });
  await ui.clickButton('Salvar configuração', { scopeSelector: backupsScope });
  await ui.waitForText('Configuração salva.', backupsScope);

  await ui.clickButton('Criar backup agora', { scopeSelector: backupsScope });
  await ui.waitForText('Restaurar', backupsScope);

  await ui.setChecked('Somente local', true, { scopeSelector: '[aria-labelledby="project-privacy-title"]' });
  assert.equal(await ui.isChecked('Somente local', { scopeSelector: '[aria-labelledby="project-privacy-title"]' }), true);

  await ui.queueConfirm(true);
  await ui.clickButton('Restaurar', { scopeSelector: backupsScope, index: 0 });
  await ui.waitForText('Antes da restauração', backupsScope);
  await ui.shot('10-backups.png');

  await ui.clickButton('Preferências');
  await ui.waitForText('Preferências', 'main');
  await ui.waitForTextGone(/O Projeto aberto está em “somente local”/, '[aria-labelledby="task-table-title"]');
  await ui.clickButton('Início');
  await ui.waitForText('Projeto aberto: Canal', 'main');
  assert.equal(
    await ui.isChecked('Somente local', { scopeSelector: '[aria-labelledby="project-privacy-title"]' }),
    false,
    'Restauração do backup deve reverter Somente local para desligado no project.sqlite',
  );
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

    await withTauriSession({ ...sharedConfig, workerMode: '' }, ui => runSession1(ui, ctx));
    await stageModelsInstalled(dataDir);
    await withTauriSession({ ...sharedConfig, workerMode: 'transcribe' }, ui => runSession2(ui, ctx));

    logStep('Suíte E2E Tauri (Sessões 1 e 2) concluída com sucesso: OK');
  } finally {
    await providerServer?.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
  }
}

main().catch(error => {
  console.error('[e2e] FALHA:', error);
  process.exitCode = 1;
});
