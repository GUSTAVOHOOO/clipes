// Smoke test multiplataforma para os instaladores gerados pelo Tauri (#376).
// Uso:
//   node scripts/smoke-package.mjs --platform windows-nsis [--artifact caminho.exe]
//   xvfb-run -a node scripts/smoke-package.mjs --platform linux-appimage [--artifact caminho.AppImage]
//   xvfb-run -a node scripts/smoke-package.mjs --platform linux-deb [--artifact caminho.deb] [--install]
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remote } from 'webdriverio';
import { ensureWebDriver } from './setup-webdriver.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID_PLATFORMS = new Set(['windows-nsis', 'linux-appimage', 'linux-deb']);
const REQUIRED_DEB_GSTREAMER_DEPS = [
  'gstreamer1.0-plugins-good',
  'gstreamer1.0-plugins-bad',
  'gstreamer1.0-libav',
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function logStep(message) {
  console.log(`[smoke-package] ${message}`);
}

export function parseSmokeArgs(argv) {
  let platform = null;
  let artifact = null;
  let bin = null;
  let install = false;
  let keepTemp = false;
  let timeoutMs = 60_000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--platform') {
      platform = argv[++i] ?? null;
    } else if (arg === '--artifact') {
      artifact = argv[++i] ?? null;
    } else if (arg === '--bin') {
      bin = argv[++i] ?? null;
    } else if (arg === '--install') {
      install = true;
    } else if (arg === '--keep-temp') {
      keepTemp = true;
    } else if (arg === '--timeout-ms') {
      const raw = Number(argv[++i]);
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new Error(`Valor inválido para --timeout-ms: ${raw}`);
      }
      timeoutMs = raw;
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  if (!platform) {
    throw new Error('Informe --platform <windows-nsis|linux-appimage|linux-deb>.');
  }
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(`Plataforma inválida: ${platform}. Esperado: ${[...VALID_PLATFORMS].join(', ')}.`);
  }

  return { platform, artifact, bin, install, keepTemp, timeoutMs };
}

export async function resolveExpectedVersion(repoRoot = REPO_ROOT) {
  const confPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
  const conf = JSON.parse(await readFile(confPath, 'utf8'));
  assert.ok(typeof conf.version === 'string' && conf.version.length > 0, 'Versão ausente em tauri.conf.json');
  return conf.version;
}

export function findSingleArtifact(dirPath, extension) {
  if (!existsSync(dirPath)) {
    throw new Error(`Diretório de artefatos não encontrado: ${dirPath}`);
  }
  const suffix = extension.toLowerCase();
  const matches = readdirSync(dirPath)
    .filter(name => name.toLowerCase().endsWith(suffix))
    .sort()
    .map(name => path.join(dirPath, name));
  if (matches.length === 0) {
    throw new Error(`Nenhum artefato ${extension} encontrado em ${dirPath}`);
  }
  if (matches.length > 1) {
    throw new Error(`Múltiplos artefatos ${extension} encontrados em ${dirPath}: ${matches.join(', ')}`);
  }
  return matches[0];
}

export function buildNsisInstallArgs(installDir) {
  // NSIS exige /D=<dir> como último argumento e sem aspas ao redor do caminho.
  return ['/S', `/D=${installDir}`];
}

export function buildNsisUninstallArgs() {
  return ['/S'];
}

export function validateDebDepends(dpkgInfoOutput) {
  const dependsLines = dpkgInfoOutput
    .split(/\r?\n/)
    .filter(line => /^\s*Depends:/i.test(line))
    .join(' ');
  const missing = REQUIRED_DEB_GSTREAMER_DEPS.filter(dep => !dependsLines.includes(dep));
  if (missing.length > 0) {
    throw new Error(
      `Dependências GStreamer ausentes no .deb (${missing.join(', ')}). Depends encontrado: ${dependsLines || '(vazio)'}`,
    );
  }
  return [...REQUIRED_DEB_GSTREAMER_DEPS];
}

export function validateWebViewSnapshot(snapshot, expectedVersion) {
  assert.equal(snapshot?.internalsReady, true, 'window.__TAURI_INTERNALS__.invoke não está disponível.');
  assert.equal(snapshot?.headerPresent, true, 'Cabeçalho <header> do front-v2 não renderizou.');
  assert.ok(
    typeof snapshot?.headerText === 'string' && snapshot.headerText.includes('Clipes'),
    `Texto "Clipes" ausente no cabeçalho: ${JSON.stringify(snapshot?.headerText)}`,
  );
  assert.ok(typeof snapshot?.href === 'string' && snapshot.href.length > 0, 'window.location.href vazio.');
  if (/^https?:\/\/(localhost|127\.0\.0\.1):(1420|1430)\b/i.test(snapshot.href)) {
    throw new Error(`Aplicativo instalado apontando para servidor dev (${snapshot.href}) em vez do bundle.`);
  }
  if (snapshot?.appVersion !== expectedVersion) {
    throw new Error(`Versão divergente no app instalado: recebido ${snapshot?.appVersion}, esperado ${expectedVersion}.`);
  }
  if (!Array.isArray(snapshot?.errors) || snapshot.errors.length > 0) {
    throw new Error(`Erros JS na WebView do pacote instalado: ${JSON.stringify(snapshot?.errors)}`);
  }
}

export function verifyUserDataPreserved(sentinelPath, expectedContent) {
  assert.equal(
    existsSync(sentinelPath),
    true,
    `Dados do usuário em CLIPES_DATA_DIR foram removidos pela desinstalação (#231): ${sentinelPath}`,
  );
  const actual = readFileSync(sentinelPath, 'utf8');
  assert.equal(actual, expectedContent, 'Conteúdo dos dados do usuário foi alterado durante a desinstalação.');
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

async function waitForTcpPort(port, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`tauri-driver encerrou prematuramente com código ${child.exitCode}`);
    }
    const connected = await new Promise(resolveConn => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolveConn(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolveConn(false);
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
  await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), sleep(3_000)]);
}

async function bootAndVerifyInstalledApp({ binaryPath, expectedVersion, dataDir, timeoutMs }) {
  assert.equal(existsSync(binaryPath), true, `Executável instalado não encontrado: ${binaryPath}`);
  const { tauriDriverPath, nativeDriverPath } = await ensureWebDriver();
  const driverPort = await getFreePort();
  const nativePort = await getFreePort();
  const args = ['--port', String(driverPort), '--native-port', String(nativePort)];
  if (nativeDriverPath) {
    args.push('--native-driver', nativeDriverPath);
  }

  const childEnv = {
    ...process.env,
    CLIPES_DATA_DIR: dataDir,
  };
  if (process.platform === 'linux') {
    childEnv.WEBKIT_DISABLE_DMABUF_RENDERER = '1';
    childEnv.WEBKIT_DISABLE_COMPOSITING_MODE = '1';
  }

  const driverLogs = [];
  const driverProc = spawn(tauriDriverPath, args, {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  driverProc.stdout?.on('data', chunk => driverLogs.push(chunk.toString()));
  driverProc.stderr?.on('data', chunk => driverLogs.push(chunk.toString()));

  let browser;
  try {
    await waitForTcpPort(driverPort, driverProc, Math.min(timeoutMs, 20_000));
    browser = await remote({
      hostname: '127.0.0.1',
      port: driverPort,
      logLevel: 'error',
      connectionRetryTimeout: Math.max(timeoutMs, 90_000),
      connectionRetryCount: 2,
      capabilities: {
        browserName: 'wry',
        'wdio:enforceWebDriverClassic': true,
        'tauri:options': {
          application: binaryPath,
        },
      },
    });

    await browser.execute(() => {
      window.__smokeErrors = [];
      window.addEventListener('error', event => window.__smokeErrors.push(String(event.message)));
      window.addEventListener('unhandledrejection', event =>
        window.__smokeErrors.push(String(event.reason?.message ?? event.reason)),
      );
    });

    let snapshot = null;
    await browser.waitUntil(
      async () => {
        snapshot = await browser.execute(() => {
          const header = document.querySelector('header[data-regiao="topo"], header');
          return {
            internalsReady: Boolean(window.__TAURI_INTERNALS__?.invoke),
            headerPresent: Boolean(header),
            hasV2Topo: Boolean(document.querySelector('header[data-regiao="topo"]')),
            headerText: (header?.textContent || '').replace(/\s+/g, ' ').trim(),
            href: window.location.href,
            hash: window.location.hash,
            errors: [...(window.__smokeErrors ?? [])],
          };
        });
        return snapshot.internalsReady && snapshot.headerPresent && snapshot.headerText.includes('Clipes');
      },
      { timeout: timeoutMs, interval: 250, timeoutMsg: 'front-v2 não carregou na WebView do pacote instalado.' },
    );

    const versionRes = await browser.executeAsync(done => {
      window.__TAURI_INTERNALS__
        .invoke('core_dispatch', { name: 'app.version', arguments: {} })
        .then(res => done({ ok: true, version: res?.version ?? null }))
        .catch(err => done({ ok: false, error: String(err) }));
    });
    assert.equal(versionRes?.ok, true, `app.version falhou: ${JSON.stringify(versionRes)}`);

    snapshot = {
      ...snapshot,
      appVersion: versionRes.version,
      errors: await browser.execute(() => [...(window.__smokeErrors ?? [])]),
    };

    validateWebViewSnapshot(snapshot, expectedVersion);
    logStep(
      `Boot validado: versao=${snapshot.appVersion}, headerV2=${snapshot.hasV2Topo}, href=${snapshot.href}, hash=${snapshot.hash}`,
    );

    // Fechamento coordenado (#291) sem jobs ativos
    await browser.execute(() => window.close());
    await sleep(1_000);
    return snapshot;
  } catch (error) {
    if (driverLogs.length > 0) {
      console.error('[smoke-package] Logs recentes do tauri-driver:\n' + driverLogs.slice(-20).join(''));
    }
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.deleteSession();
      } catch {
        // sessão já encerrada pelo window.close()
      }
    }
    await killProcessTree(driverProc);
  }
}

async function runWindowsNsisSmoke(opts, expectedVersion, tempRoot) {
  assert.equal(process.platform, 'win32', 'windows-nsis smoke deve rodar no Windows.');
  const installerPath =
    opts.artifact ?? findSingleArtifact(path.join(REPO_ROOT, 'target', 'release', 'bundle', 'nsis'), '.exe');
  const installDir = path.join(tempRoot, 'install');
  const dataDir = path.join(tempRoot, 'data');
  await mkdir(dataDir, { recursive: true });

  logStep(`Instalando NSIS silenciosamente em ${installDir}…`);
  const installRes = spawnSync(installerPath, buildNsisInstallArgs(installDir), {
    windowsVerbatimArguments: true,
    stdio: 'inherit',
  });
  assert.equal(installRes.status, 0, `Instalador NSIS falhou com código ${installRes.status}`);

  const installedExe = opts.bin ?? path.join(installDir, 'clipes.exe');
  assert.equal(existsSync(installedExe), true, `clipes.exe ausente após instalação em ${installDir}`);

  await bootAndVerifyInstalledApp({
    binaryPath: installedExe,
    expectedVersion,
    dataDir,
    timeoutMs: opts.timeoutMs,
  });

  const sentinelPath = path.join(dataDir, 'smoke-user-data.json');
  const sentinelContent = JSON.stringify({ ticket: 231, preserve: true });
  await writeFile(sentinelPath, sentinelContent, 'utf8');

  const uninstaller = path.join(installDir, 'uninstall.exe');
  assert.equal(existsSync(uninstaller), true, `Desinstalador não encontrado: ${uninstaller}`);
  logStep('Executando desinstalador NSIS silencioso…');
  const uninstallRes = spawnSync(uninstaller, buildNsisUninstallArgs(), { stdio: 'inherit' });
  assert.equal(uninstallRes.status, 0, `Desinstalador NSIS falhou com código ${uninstallRes.status}`);

  const deadline = Date.now() + 20_000;
  while (existsSync(installedExe) && Date.now() < deadline) {
    await sleep(250);
  }
  assert.equal(existsSync(installedExe), false, `clipes.exe permaneceu após desinstalação: ${installedExe}`);
  verifyUserDataPreserved(sentinelPath, sentinelContent);
  logStep('Windows NSIS smoke concluído (instalação, boot front-v2, #291 e preservação #231 OK).');
}

async function runLinuxAppImageSmoke(opts, expectedVersion, tempRoot) {
  assert.equal(process.platform, 'linux', 'linux-appimage smoke deve rodar no Linux.');
  const appImagePath =
    opts.artifact ?? findSingleArtifact(path.join(REPO_ROOT, 'target', 'release', 'bundle', 'appimage'), '.AppImage');
  const extractDir = path.join(tempRoot, 'appimage');
  const dataDir = path.join(tempRoot, 'data');
  await Promise.all([mkdir(extractDir, { recursive: true }), mkdir(dataDir, { recursive: true })]);

  const staged = path.join(extractDir, path.basename(appImagePath));
  await copyFile(appImagePath, staged);
  await chmod(staged, 0o755);

  logStep(`Extraindo AppImage (${path.basename(appImagePath)})…`);
  execFileSync(staged, ['--appimage-extract'], { cwd: extractDir, stdio: 'inherit' });

  const squashRoot = path.join(extractDir, 'squashfs-root');
  const appRun = path.join(squashRoot, 'AppRun');
  assert.equal(existsSync(appRun), true, `AppRun não encontrado em ${squashRoot}`);

  const usrBinDir = path.join(squashRoot, 'usr', 'bin');
  const bins = existsSync(usrBinDir) ? readdirSync(usrBinDir) : [];
  assert.ok(bins.length > 0, `Nenhum binário encontrado em ${usrBinDir}`);
  const lddOut = execFileSync('ldd', [path.join(usrBinDir, bins[0])], { encoding: 'utf8' });
  const missingLibs = lddOut
    .split(/\r?\n/)
    .filter(line => line.includes('not found'));
  assert.deepEqual(missingLibs, [], `Bibliotecas ausentes no AppImage: ${missingLibs.join('; ')}`);

  await bootAndVerifyInstalledApp({
    binaryPath: appRun,
    expectedVersion,
    dataDir,
    timeoutMs: opts.timeoutMs,
  });
  logStep('Linux AppImage smoke concluído (extração, ldd, boot front-v2 e #291 OK).');
}

async function runLinuxDebSmoke(opts, expectedVersion, tempRoot) {
  assert.equal(process.platform, 'linux', 'linux-deb smoke deve rodar no Linux.');
  const debPath =
    opts.artifact ?? findSingleArtifact(path.join(REPO_ROOT, 'target', 'release', 'bundle', 'deb'), '.deb');
  const dataDir = path.join(tempRoot, 'data');
  await mkdir(dataDir, { recursive: true });

  const debInfo = execFileSync('dpkg-deb', ['-I', debPath], { encoding: 'utf8' });
  const deps = validateDebDepends(debInfo);
  logStep(`.deb validado com dependências GStreamer: ${deps.join(', ')}`);

  if (opts.install) {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const cmd = isRoot ? 'apt-get' : 'sudo';
    const cmdArgs = isRoot ? ['install', '-y', debPath] : ['apt-get', 'install', '-y', debPath];
    logStep(`Instalando .deb (${debPath})…`);
    execFileSync(cmd, cmdArgs, { stdio: 'inherit' });
  }

  let binaryPath = opts.bin || process.env.CLIPES_BIN || null;
  if (!binaryPath) {
    const pkgName = execFileSync('dpkg-deb', ['-f', debPath, 'Package'], { encoding: 'utf8' }).trim();
    const pkgFiles = execFileSync('dpkg', ['-L', pkgName], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(line => line.startsWith('/usr/bin/'));
    binaryPath = pkgFiles[0] || '/usr/bin/clipes';
  }

  await bootAndVerifyInstalledApp({
    binaryPath,
    expectedVersion,
    dataDir,
    timeoutMs: opts.timeoutMs,
  });
  logStep('Linux .deb smoke concluído (dpkg-deb -I, boot front-v2 e #291 OK).');
}

async function main() {
  const opts = parseSmokeArgs(process.argv.slice(2));
  const expectedVersion = await resolveExpectedVersion(REPO_ROOT);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipes-376-smoke-'));

  try {
    if (opts.platform === 'windows-nsis') {
      await runWindowsNsisSmoke(opts, expectedVersion, tempRoot);
    } else if (opts.platform === 'linux-appimage') {
      await runLinuxAppImageSmoke(opts, expectedVersion, tempRoot);
    } else if (opts.platform === 'linux-deb') {
      await runLinuxDebSmoke(opts, expectedVersion, tempRoot);
    }
  } finally {
    if (!opts.keepTemp) {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error('[smoke-package] FALHA:', error);
    process.exitCode = 1;
  });
}
