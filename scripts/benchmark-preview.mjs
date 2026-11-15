// Medição manual local do #58: FFmpeg sintético, núcleo real e protocolo Tauri/WebView2.
// Pré-requisitos: cargo build -p clipes; bun install; FFmpeg/ffprobe no PATH.
// Execute: node scripts/benchmark-preview.mjs > docs/research/2026-11-15-busca-no-proxy.json
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'win32', 'Esta medição usa o WebView2 do Windows.');
const root = await mkdtemp(join(tmpdir(), 'clipes-preview-benchmark-'));
const source = join(root, 'source.mp4');
const processes = [];
const launch = (exe, args, env = {}) => {
  const child = spawn(exe, args, { env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  processes.push(child);
  return child;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function endpoint(url) {
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(200);
  }
  throw Error('O endpoint local da medição não iniciou.');
}
let browser;
try {
  const encoder = launch('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=960x540:r=30:d=300', '-f', 'lavfi', '-i', 'sine=duration=300', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-g', '300', '-sc_threshold', '0', '-c:a', 'aac', '-movflags', '+faststart', '-y', source]);
  await new Promise((resolve, reject) => { encoder.once('error', reject); encoder.once('exit', code => code === 0 ? resolve() : reject(Error('Falha ao gerar Fonte sintética.'))); });
  // Porta de depuração exclusiva desta execução; nenhum navegador pessoal é conectado.
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const debugPort = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1420', '--strictPort'], { VITE_CORE_MOCK: '0', VITE_UPDATER_MOCK: 'available' });
  await endpoint('http://127.0.0.1:1420');
  launch(resolve('target/debug/clipes.exe'), [], {
    CLIPES_DATA_DIR: join(root, 'data'),
    CLIPES_FFPROBE: 'ffprobe',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
  });
  await endpoint(`http://127.0.0.1:${debugPort}/json/version`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => window.__TAURI_INTERNALS__?.invoke);
  const dispatch = (name, args = {}) => page.evaluate(([name, args]) => window.__TAURI_INTERNALS__.invoke('core_dispatch', { name, arguments: args }), [name, args]);
  await dispatch('components.settings.set', { data_dir: join(root, 'data'), cache_dir: join(root, 'cache'), cache_limit_bytes: 2147483648, ffmpeg_path: 'ffmpeg' });
  const project = await dispatch('projects.create', { parent: root, name: 'Benchmark' });
  const registered = await dispatch('sources.import', { project: project.path, path: source, permission: { status: 'none' }, audio_track: 1 });
  const started = performance.now();
  const proxy = await dispatch('proxy.request', { source_id: registered.id, start_us: 150_000_000, end_us: 160_000_000 });
  for (;;) {
    const status = await dispatch('proxy.status', { key: proxy.key });
    if (status.state === 'ready') break;
    assert.ok(['running', 'queued'].includes(status.state), JSON.stringify(status));
    assert.ok(performance.now() - started < 180_000, 'Timeout ao gerar proxy.');
    await delay(200);
  }
  const generationMs = performance.now() - started;
  // O elemento usa o mesmo esquema, Range e estilo Fit do CutPreview; só o ensaio controla seeks.
  const result = await page.evaluate(async ({ proxy, sourceId }) => {
    document.body.replaceChildren();
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.style.cssText = 'width:270px;height:480px;object-fit:contain;background:black';
    document.body.append(video);
    let seed = 58;
    const targets = Array.from({ length: 100 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 1 + (seed / 4294967296) * 247; });
    async function measure(resource, offset) {
      video.src = `http://clipes-media.localhost/${resource}`;
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(Error('Mídia indisponível.')); });
      // Inicializa o decoder; a latência inclui seeked e o callback do quadro solicitado.
      await video.play();
      video.pause();
      async function seek(target) {
        return new Promise((resolve, reject) => {
          const started = performance.now();
          let callback;
          const timeout = setTimeout(() => { video.cancelVideoFrameCallback(callback); reject(Error('Timeout no seek.')); }, 10_000);
          const observe = (_, info) => {
            if (Math.abs(info.mediaTime - target) <= 0.05) {
              clearTimeout(timeout);
              resolve({ targetSeconds: target, mediaTime: info.mediaTime, ms: performance.now() - started });
            } else callback = video.requestVideoFrameCallback(observe);
          };
          callback = video.requestVideoFrameCallback(observe);
          video.currentTime = target;
        });
      }
      await seek(offset + 0.5); // aquecimento separado das N buscas
      const samples = [];
      for (const target of targets) samples.push(await seek(offset + target));
      const sorted = samples.map(s => s.ms).sort((a, b) => a - b);
      return { n: samples.length, medianMs: (sorted[49] + sorted[50]) / 2, p95Ms: sorted[94], samples };
    }
    return { userAgent: navigator.userAgent, visibility: document.visibilityState, proxyWindow: [proxy.windowStartUs, proxy.windowEndUs], source: await measure(`source/${sourceId}`, proxy.windowStartUs / 1e6), proxy: await measure(`proxy/${proxy.key}`, 0) };
  }, { proxy, sourceId: registered.id });
  console.log(JSON.stringify({ date: new Date().toISOString(), cpu: cpus()[0].model, ramGiB: totalmem() / 1024 ** 3, generationMs, ...result }, null, 2));
  await dispatch('projects.close');
} finally {
  await browser?.close();
  for (const child of processes.reverse()) if (child.exitCode === null) child.kill();
  await delay(1000);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
