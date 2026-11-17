import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBVIEW2_CLIENT_ID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
const WEBVIEW2_REG_KEYS = [
  `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_ID}`,
  `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_ID}`,
  `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_ID}`,
];

export function exeName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

export function cargoBinDir() {
  return path.join(os.homedir(), '.cargo', 'bin');
}

export function findExecutable(base, extraDirs = []) {
  const names = process.platform === 'win32' ? [`${base}.exe`, `${base}.cmd`, base] : [base];
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of [...extraDirs, ...pathDirs, cargoBinDir()]) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function readVersionOutput(binaryPath, args = ['--version']) {
  try {
    return execFileSync(binaryPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function detectWebView2Version() {
  const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  for (const key of WEBVIEW2_REG_KEYS) {
    try {
      const output = execFileSync(regExe, ['query', key, '/v', 'pv'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const match = /\bpv\s+REG_SZ\s+(\d+\.\d+\.\d+\.\d+)/i.exec(output);
      if (match && match[1] !== '0.0.0.0') return match[1];
    } catch {
      // chave ausente neste hive; tenta a próxima
    }
  }
  return null;
}

function decodeReleaseVersion(buffer) {
  const bytes = new Uint8Array(buffer);
  const isUtf16Le =
    (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes.length >= 4 && bytes[1] === 0x00 && bytes[3] === 0x00);
  const text = new TextDecoder(isUtf16Le ? 'utf-16le' : 'utf-8').decode(bytes);
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(cleaned)) {
    throw new Error(`Versão inválida recebida de LATEST_RELEASE: ${JSON.stringify(cleaned)}`);
  }
  return cleaned;
}

function edgeDriverArchiveName() {
  if (process.arch === 'arm64') return 'edgedriver_arm64.zip';
  if (process.arch === 'ia32') return 'edgedriver_win32.zip';
  return 'edgedriver_win64.zip';
}

async function resolveFallbackEdgeDriverVersion(major) {
  const url = `https://msedgedriver.microsoft.com/LATEST_RELEASE_${major}_WINDOWS`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao consultar ${url} (HTTP ${response.status})`);
  }
  return decodeReleaseVersion(await response.arrayBuffer());
}

async function downloadAndExtractEdgeDriver(version, cacheRoot) {
  const targetDir = path.join(cacheRoot, version);
  const targetBinary = path.join(targetDir, 'msedgedriver.exe');
  if (existsSync(targetBinary) && readVersionOutput(targetBinary)) {
    return targetBinary;
  }

  const archive = edgeDriverArchiveName();
  const url = `https://msedgedriver.microsoft.com/${version}/${archive}`;
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`Falha ao baixar ${url} (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }

  const stageDir = path.join(cacheRoot, `.stage-${version}-${process.pid}-${Date.now()}`);
  await mkdir(stageDir, { recursive: true });
  const zipPath = path.join(stageDir, archive);
  try {
    await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
    const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tarExe, ['-xf', zipPath, '-C', stageDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    const extracted = path.join(stageDir, 'msedgedriver.exe');
    if (!existsSync(extracted)) {
      throw new Error(`msedgedriver.exe não encontrado no pacote ${archive}`);
    }
    await mkdir(targetDir, { recursive: true });
    await rm(targetBinary, { force: true });
    await rename(extracted, targetBinary);
    if (!readVersionOutput(targetBinary)) {
      throw new Error(`msedgedriver.exe extraído em ${targetBinary} falhou ao iniciar`);
    }
    return targetBinary;
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

async function ensureWindowsNativeDriver(log) {
  if (process.env.MSEDGEDRIVER_BIN) {
    const ver = readVersionOutput(process.env.MSEDGEDRIVER_BIN);
    if (!ver) throw new Error(`MSEDGEDRIVER_BIN inválido: ${process.env.MSEDGEDRIVER_BIN}`);
    log(`msedgedriver (MSEDGEDRIVER_BIN): ${ver} (${process.env.MSEDGEDRIVER_BIN})`);
    return { nativeDriverPath: process.env.MSEDGEDRIVER_BIN, webview2Version: null };
  }

  const webview2Version = detectWebView2Version();
  if (!webview2Version) {
    throw new Error(
      'Microsoft Edge WebView2 Runtime não encontrado no registro do Windows. Instale o WebView2 Runtime antes de rodar a suíte E2E.',
    );
  }
  const cacheRoot = path.join(os.tmpdir(), 'clipes-webdriver');
  let driverPath;
  let resolvedVersion = webview2Version;
  try {
    driverPath = await downloadAndExtractEdgeDriver(webview2Version, cacheRoot);
  } catch (error) {
    if (error?.status !== 404) throw error;
    const major = webview2Version.split('.')[0];
    resolvedVersion = await resolveFallbackEdgeDriverVersion(major);
    driverPath = await downloadAndExtractEdgeDriver(resolvedVersion, cacheRoot);
  }
  const driverVersion = readVersionOutput(driverPath);
  log(`WebView2 Runtime: ${webview2Version}`);
  log(`msedgedriver (${resolvedVersion}): ${driverVersion} (${driverPath})`);
  return { nativeDriverPath: driverPath, webview2Version };
}

function ensureLinuxNativeDriver(log) {
  const candidate =
    process.env.WEBKIT_WEBDRIVER_BIN || findExecutable('WebKitWebDriver', ['/usr/bin', '/usr/local/bin']);
  if (!candidate || !existsSync(candidate)) {
    throw new Error(
      'WebKitWebDriver não encontrado. No Ubuntu/Debian, instale com: sudo apt-get install -y webkit2gtk-driver xvfb',
    );
  }
  const version = readVersionOutput(candidate) ?? 'instalado';
  log(`WebKitWebDriver: ${version} (${candidate})`);
  return { nativeDriverPath: candidate, webview2Version: null };
}

function checkTauriDriver(binaryPath) {
  const help = readVersionOutput(binaryPath, ['--help']);
  return help && help.includes('tauri-driver') ? 'instalado' : null;
}

function ensureTauriDriver({ installTauriDriver, log }) {
  let binary = process.env.TAURI_DRIVER_BIN || findExecutable('tauri-driver');
  if ((!binary || !checkTauriDriver(binary)) && installTauriDriver) {
    const cargo = findExecutable('cargo');
    if (!cargo) {
      throw new Error('Cargo não encontrado para instalar tauri-driver.');
    }
    log('Instalando tauri-driver via cargo install tauri-driver --locked…');
    execFileSync(cargo, ['install', 'tauri-driver', '--locked'], { stdio: 'inherit' });
    binary = findExecutable('tauri-driver');
  }
  const status = binary ? checkTauriDriver(binary) : null;
  if (!binary || !status) {
    const hint =
      process.platform === 'win32'
        ? '& "$env:USERPROFILE\\.cargo\\bin\\cargo.exe" install tauri-driver --locked'
        : 'cargo install tauri-driver --locked';
    throw new Error(`tauri-driver não encontrado. Instale com:\n  ${hint}`);
  }
  log(`tauri-driver: ${status} (${binary})`);
  return binary;
}

export async function ensureWebDriver({ installTauriDriver = false, quiet = false } = {}) {
  const log = quiet ? () => {} : message => console.log(`[e2e:setup] ${message}`);
  if (process.platform === 'darwin') {
    throw new Error('tauri-driver não é suportado no macOS (WKWebView não expõe WebDriver nativo).');
  }
  const tauriDriverPath = ensureTauriDriver({ installTauriDriver, log });
  const nativeInfo =
    process.platform === 'win32' ? await ensureWindowsNativeDriver(log) : ensureLinuxNativeDriver(log);
  return { tauriDriverPath, ...nativeInfo };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const installTauriDriver = process.argv.includes('--install-tauri-driver');
  ensureWebDriver({ installTauriDriver }).catch(error => {
    console.error(`[e2e:setup] Erro: ${error.message ?? error}`);
    process.exitCode = 1;
  });
}
