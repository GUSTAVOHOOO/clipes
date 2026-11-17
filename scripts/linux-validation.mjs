// Validação automatizada no Linux (#69): .deb instalado + Xvfb + tauri-driver + WebKitGTK + export + fallback x264.
// Uso (no Linux, sob xvfb-run): bun scripts/linux-validation.mjs [--out caminho.json] [--screenshot dir]
import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'linux', 'Este script roda apenas no Linux.');

const args = process.argv.slice(2);
const argValue = flag => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const outPath = argValue('--out');
const screenshotDir = argValue('--screenshot');
const clipesBin = process.env.CLIPES_BIN || '/usr/bin/clipes';

const freePort = async () => {
  const srv = createServer();
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  await new Promise(resolve => srv.close(resolve));
  return port;
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const runCmd = (exe, cmdArgs) => {
  const res = spawnSync(exe, cmdArgs, { encoding: 'utf8' });
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
};

const runCmdChecked = (exe, cmdArgs, label) => {
  const res = spawnSync(exe, cmdArgs, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`${label} falhou (exit ${res.status}): ${res.stderr || res.stdout}`);
  }
  return (res.stdout || '').trim();
};

async function waitEndpoint(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Endpoint ${url} não respondeu em ${timeoutMs} ms.`);
}

class WebDriver {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
  }
  async req(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.value?.error) {
      throw new Error(`WebDriver ${method} ${path} falhou (${res.status}): ${JSON.stringify(json)}`);
    }
    return json.value;
  }
  async start(application) {
    const res = await this.req('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          'tauri:options': { application },
        },
      },
    });
    this.sessionId = res.sessionId || res.value?.sessionId;
    if (!this.sessionId) {
      throw new Error(`Sessão WebDriver sem sessionId: ${JSON.stringify(res)}`);
    }
    await this.req('POST', `/session/${this.sessionId}/timeouts`, { script: 300_000, pageLoad: 60_000 });
    return res;
  }
  exec(fn, fnArgs = []) {
    return this.req('POST', `/session/${this.sessionId}/execute/sync`, {
      script: `return (${fn.toString()}).apply(null, arguments);`,
      args: fnArgs,
    });
  }
  async execAsync(fn, fnArgs = []) {
    const wrapper = `
      const args = Array.from(arguments);
      const done = args.pop();
      const fn = ${fn.toString()};
      Promise.resolve()
        .then(() => fn.apply(null, args))
        .then(
          value => done({ ok: true, value }),
          error => done({
            ok: false,
            error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
          })
        );
    `;
    const res = await this.req('POST', `/session/${this.sessionId}/execute/async`, {
      script: wrapper,
      args: fnArgs,
    });
    if (!res || res.ok !== true) {
      throw new Error(`Erro no script WebDriver: ${JSON.stringify(res?.error ?? res)}`);
    }
    return res.value;
  }
  async screenshot(filePath) {
    const b64 = await this.req('GET', `/session/${this.sessionId}/screenshot`);
    await writeFile(filePath, Buffer.from(b64, 'base64'));
  }
  async close() {
    if (!this.sessionId) return;
    try {
      await this.req('DELETE', `/session/${this.sessionId}`);
    } finally {
      this.sessionId = null;
    }
  }
}

function summarizeSamples(samples, key) {
  const vals = samples.map(s => s[key]).filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
  const p95Idx = Math.min(vals.length - 1, Math.max(0, Math.ceil(vals.length * 0.95) - 1));
  return { n: vals.length, minMs: vals[0], medianMs: median, p95Ms: vals[p95Idx], maxMs: vals[vals.length - 1] };
}

function probeMedia(file) {
  const raw = runCmdChecked(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    `ffprobe ${file}`,
  );
  return JSON.parse(raw);
}

const root = await mkdtemp(join(tmpdir(), 'clipes-linux-val-'));
const dataDir = join(root, 'data');
const cacheDir = join(root, 'cache');
const sourcePath = join(root, 'source.mp4');
const exportPath = join(root, 'corte.mp4');
const fallbackExportPath = join(root, 'corte-fallback.mp4');
const driverLogs = [];
let driverProc = null;
let wd = null;

const report = {
  date: new Date().toISOString(),
  environment: {
    display: process.env.DISPLAY || null,
    cpu: cpus()[0]?.model || null,
    cpuCount: cpus().length,
    ramGiB: Number((totalmem() / 1024 ** 3).toFixed(2)),
    uname: runCmd('uname', ['-a']).stdout,
    osRelease: runCmd('sh', ['-c', '. /etc/os-release && echo "$PRETTY_NAME"']).stdout,
    clipesBin,
    debInfo: runCmd('dpkg', ['-s', 'clipes']).stdout,
    ffmpegVersion: runCmd('ffmpeg', ['-version']).stdout.split('\n')[0] || null,
    gstreamerInspect: {
      h264parse: runCmd('gst-inspect-1.0', ['h264parse']).status === 0,
      avdec_h264: runCmd('gst-inspect-1.0', ['avdec_h264']).status === 0,
      openh264dec: runCmd('gst-inspect-1.0', ['openh264dec']).status === 0,
      qtdemux: runCmd('gst-inspect-1.0', ['qtdemux']).status === 0,
      faad: runCmd('gst-inspect-1.0', ['faad']).status === 0,
      avdec_aac: runCmd('gst-inspect-1.0', ['avdec_aac']).status === 0,
      uridecodebin: runCmd('gst-inspect-1.0', ['uridecodebin']).status === 0,
      playbin: runCmd('gst-inspect-1.0', ['playbin']).status === 0,
    },
    gstreamerPackages: runCmd('sh', ['-c', "dpkg-query -W -f='${Package} ${Version}\\n' '*gstreamer*' '*webkit*' 2>/dev/null || true"]).stdout.split('\n').filter(Boolean),
  },
  steps: {},
  passed: false,
};

try {
  // 0. Gerar Fonte sintética (300 s, 960x540, 30 fps, GOP 300, AAC)
  const srcStart = performance.now();
  runCmdChecked(
    'ffmpeg',
    [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=s=960x540:r=30:d=300',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=300',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-g', '300', '-sc_threshold', '0',
      '-c:a', 'aac', '-movflags', '+faststart', '-y', sourcePath,
    ],
    'gerar source.mp4 sintético',
  );
  report.steps.syntheticSource = { ok: true, durationMs: Math.round(performance.now() - srcStart) };

  // 1. Iniciar tauri-driver e conectar WebDriver ao app instalado
  const driverPort = await freePort();
  const nativePort = await freePort();
  driverProc = spawn('tauri-driver', ['--port', String(driverPort), '--native-port', String(nativePort)], {
    env: {
      ...process.env,
      CLIPES_DATA_DIR: dataDir,
      CLIPES_FFPROBE: 'ffprobe',
      GST_DEBUG: 'webkit*:5,2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  driverProc.stdout.on('data', d => driverLogs.push(d.toString()));
  driverProc.stderr.on('data', d => driverLogs.push(d.toString()));
  await waitEndpoint(`http://127.0.0.1:${driverPort}/status`, 20_000);

  wd = new WebDriver(`http://127.0.0.1:${driverPort}`);
  await wd.start(clipesBin);

  // Aguarda WebView + __TAURI_INTERNALS__
  const readyDeadline = Date.now() + 30_000;
  let internalsReady = false;
  while (Date.now() < readyDeadline) {
    internalsReady = await wd.exec(() => Boolean(window.__TAURI_INTERNALS__?.invoke && document.querySelector('header')));
    if (internalsReady) break;
    await delay(250);
  }
  assert.ok(internalsReady, 'WebView/Tauri internals não ficou pronto.');

  const appInfo = await wd.execAsync(async () => {
    const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke('core_dispatch', { name, arguments: args });
    const version = await invoke('app.version');
    await invoke('assistant.complete', { skipped: true });
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent?.trim() === 'Agora não') btn.click();
    }
    return {
      version,
      userAgent: navigator.userAgent,
      headerText: document.querySelector('header')?.textContent?.trim() || '',
      hasRvfc: typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function',
    };
  });
  report.steps.appLaunch = { ok: true, ...appInfo };

  // 2. Configurar FFmpeg/cache, criar projeto, importar fonte e gerar proxy
  const setupRes = await wd.execAsync(
    async ({ dataDir, cacheDir, root, sourcePath }) => {
      const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke('core_dispatch', { name, arguments: args });
      await invoke('components.settings.set', {
        data_dir: dataDir,
        cache_dir: cacheDir,
        cache_limit_bytes: 2147483648,
        ffmpeg_path: 'ffmpeg',
      });
      const project = await invoke('projects.create', { parent: root, name: 'ValidacaoLinux' });
      const source = await invoke('sources.import', {
        project: project.path,
        path: sourcePath,
        permission: { status: 'none' },
        audio_track: 1,
      });
      const started = performance.now();
      const proxy = await invoke('proxy.request', {
        source_id: source.id,
        start_us: 150_000_000,
        end_us: 160_000_000,
      });
      for (;;) {
        const status = await invoke('proxy.status', { key: proxy.key });
        if (status.state === 'ready') {
          return {
            project,
            source,
            proxy,
            generationMs: performance.now() - started,
            proxyUrl: window.__TAURI_INTERNALS__.convertFileSrc(`proxy/${proxy.key}`, 'clipes-media'),
            sourceUrl: window.__TAURI_INTERNALS__.convertFileSrc(`source/${source.id}`, 'clipes-media'),
          };
        }
        if (status.state !== 'running' && status.state !== 'queued') {
          throw new Error(`Proxy falhou: ${JSON.stringify(status)}`);
        }
        if (performance.now() - started > 180_000) {
          throw new Error('Timeout ao gerar proxy.');
        }
        await new Promise(r => setTimeout(r, 200));
      }
    },
    [{ dataDir, cacheDir, root, sourcePath }],
  );
  report.steps.proxyGeneration = {
    ok: true,
    generationMs: Math.round(setupRes.generationMs),
    windowStartUs: setupRes.proxy.windowStartUs,
    windowEndUs: setupRes.proxy.windowEndUs,
    proxyUrl: setupRes.proxyUrl,
    sourceUrl: setupRes.sourceUrl,
  };

  // 3. Semear transcrição sintética no project.sqlite e segmentar Frases via núcleo
  await wd.execAsync(async () => {
    await window.__TAURI_INTERNALS__.invoke('core_dispatch', { name: 'projects.close', arguments: {} });
  });
  {
    const db = new Database(join(setupRes.project.path, 'project.sqlite'));
    db.run(
      "INSERT INTO transcripts(source_id, audio_track, engine, model, revision, compute_type, state, resume_us, duration_us) VALUES (?, 1, 'local', 'synthetic', 'r1', 'int8', 'complete', 300000000, 300000000)",
      [setupRes.source.id],
    );
    const transcriptId = db.query('SELECT last_insert_rowid() AS id').get().id;
    const words = [
      [0, ' Teste', 150_000_000, 151_500_000],
      [1, ' Linux', 151_500_000, 153_000_000],
      [2, ' legenda.', 153_000_000, 155_000_000],
      [3, ' Corte', 155_500_000, 157_500_000],
      [4, ' final.', 157_500_000, 160_000_000],
    ];
    const stmt = db.prepare(
      "INSERT INTO transcript_words(transcript_id, position, kind, text, start_us, end_us, language) VALUES (?, ?, 'word', ?, ?, ?, 'pt')",
    );
    for (const [pos, text, s, e] of words) stmt.run(transcriptId, pos, text, s, e);
    db.close();
  }
  await wd.execAsync(
    async (projectPath, sourceId) => {
      const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke('core_dispatch', { name, arguments: args });
      await invoke('projects.open', { path: projectPath });
      await invoke('transcription.segment', { source_id: sourceId });
    },
    [setupRes.project.path, setupRes.source.id],
  );

  // 4. Testar o componente CutPreview real da UI + busca (seek) no WebKitGTK
  await wd.exec(() => { location.reload(); });
  {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const ready = await wd.exec(() => {
        for (const btn of document.querySelectorAll('button')) {
          if (btn.textContent?.trim() === 'Agora não') btn.click();
        }
        return Boolean(window.__TAURI_INTERNALS__?.invoke && document.body.innerText.includes('Transcrição pronta'));
      });
      if (ready) break;
      await delay(250);
    }
  }
  const uiPreview = await wd.execAsync(
    async ({ sourceId }) => {
      window.dispatchEvent(
        new CustomEvent('clipes-preview-open', {
          detail: { sourceId, startUs: 150_000_000, endUs: 160_000_000 },
        }),
      );
      const deadline = performance.now() + 20_000;
      let section = null;
      while (performance.now() < deadline) {
        section = document.querySelector('section[aria-label="Preview do Corte"]');
        if (section?.getAttribute('data-preview-state') === 'ready') break;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!section || section.getAttribute('data-preview-state') !== 'ready') {
        return { mounted: Boolean(section), state: section?.getAttribute('data-preview-state') ?? null };
      }
      const video = section.querySelector('video');
      if (!video) return { mounted: true, state: 'ready', hasVideo: false };
      const outcome = await new Promise(resolve => {
        const timer = setTimeout(() => resolve({ loaded: false, reason: 'loadeddata_timeout', readyState: video.readyState, networkState: video.networkState }), 15_000);
        if (video.readyState >= 2) {
          clearTimeout(timer);
          resolve({ loaded: true, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight });
          return;
        }
        video.addEventListener('loadeddata', () => {
          clearTimeout(timer);
          resolve({ loaded: true, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight });
        }, { once: true });
        video.addEventListener('error', () => {
          clearTimeout(timer);
          resolve({
            loaded: false,
            reason: 'video_error',
            errorCode: video.error?.code ?? null,
            errorMessage: video.error?.message ?? null,
            readyState: video.readyState,
            networkState: video.networkState,
          });
        }, { once: true });
      });
      if (!outcome.loaded) {
        return { mounted: true, state: 'ready', hasVideo: true, src: video.currentSrc || video.src, ...outcome };
      }
      let playOk = false;
      let playError = null;
      const beforeTime = video.currentTime;
      try {
        video.muted = true;
        await video.play();
        await new Promise(r => setTimeout(r, 350));
        video.pause();
        playOk = video.currentTime > beforeTime;
      } catch (e) {
        playError = e instanceof Error ? e.message : String(e);
      }
      const notice = section.querySelector('[role="status"]')?.textContent || null;
      return {
        mounted: true,
        state: 'ready',
        hasVideo: true,
        src: video.currentSrc || video.src,
        ...outcome,
        playOk,
        playError,
        playedAdvanceSec: Number((video.currentTime - beforeTime).toFixed(3)),
        notice,
      };
    },
    [{ sourceId: setupRes.source.id }],
  );
  if (screenshotDir) {
    await wd.screenshot(join(screenshotDir, 'cut-preview-linux.png')).catch(() => {});
  }
  report.steps.uiCutPreview = uiPreview;

  // 5. Medir busca (seek) em Source e Proxy no WebKitGTK (mesmo protocolo do #58)
  const mediaFetchDiag = await wd.execAsync(
    async ({ proxyUrl }) => {
      const probeFetch = async (url, headers = {}) => {
        try {
          const res = await fetch(url, { headers });
          const buf = await res.arrayBuffer();
          return {
            ok: res.ok,
            status: res.status,
            headers: Object.fromEntries(res.headers.entries()),
            bytes: buf.byteLength,
          };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      };
      return {
        whole: await probeFetch(proxyUrl),
        range0: await probeFetch(proxyUrl, { Range: 'bytes=0-1023' }),
        plainPath: await probeFetch(proxyUrl.replace('%2F', '/')),
      };
    },
    [{ proxyUrl: setupRes.proxyUrl }],
  );
  report.steps.mediaFetchDiag = mediaFetchDiag;

  const seekEval = await wd.execAsync(
    async ({ proxyUrl, sourceUrl, windowStartUs }) => {
      const probe = document.createElement('video');
      const canPlayH264 = probe.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
      const hasRvfc = typeof probe.requestVideoFrameCallback === 'function';

      let seed = 58;
      const targets = Array.from({ length: 100 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return 1 + (seed / 4294967296) * 247;
      });

      async function measure(url, offsetSec) {
        document.body.replaceChildren();
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;
        video.style.cssText = 'width:270px;height:480px;object-fit:contain;background:black';
        video.src = url;
        document.body.append(video);

        const loadResult = await new Promise(resolve => {
          const timer = setTimeout(() => resolve({ ok: false, reason: 'loadeddata_timeout', readyState: video.readyState, networkState: video.networkState }), 15_000);
          video.onloadeddata = () => { clearTimeout(timer); resolve({ ok: true, videoWidth: video.videoWidth, videoHeight: video.videoHeight, duration: video.duration }); };
          video.onerror = () => {
            clearTimeout(timer);
            resolve({
              ok: false,
              reason: 'video_error',
              errorCode: video.error?.code ?? null,
              errorMessage: video.error?.message ?? null,
              readyState: video.readyState,
              networkState: video.networkState,
            });
          };
        });
        if (!loadResult.ok) return { playable: false, url, ...loadResult };

        try {
          await video.play();
          await new Promise(r => setTimeout(r, 100));
          video.pause();
        } catch (e) {
          return { playable: false, url, reason: 'play_rejected', playError: e instanceof Error ? e.message : String(e) };
        }

        function seekOne(target) {
          return new Promise((resolve, reject) => {
            const started = performance.now();
            let seekedMs = null;
            let rvfcHandle = null;
            let done = false;
            const finish = payload => {
              if (done) return;
              done = true;
              clearTimeout(timeout);
              if (rvfcHandle !== null && hasRvfc) video.cancelVideoFrameCallback(rvfcHandle);
              video.removeEventListener('seeked', onSeeked);
              resolve(payload);
            };
            const timeout = setTimeout(() => {
              if (done) return;
              done = true;
              if (rvfcHandle !== null && hasRvfc) video.cancelVideoFrameCallback(rvfcHandle);
              video.removeEventListener('seeked', onSeeked);
              reject(new Error(`Timeout no seek para ${target.toFixed(3)}s (currentTime=${video.currentTime.toFixed(3)}s)`));
            }, 10_000);

            const onSeeked = () => {
              seekedMs = performance.now() - started;
              if (!hasRvfc) {
                requestAnimationFrame(() => finish({
                  targetSeconds: target,
                  mediaTime: video.currentTime,
                  seekedMs,
                  rafMs: performance.now() - started,
                  rvfcMs: null,
                }));
              }
            };
            video.addEventListener('seeked', onSeeked, { once: true });

            if (hasRvfc) {
              const observe = (_, info) => {
                if (Math.abs(info.mediaTime - target) <= 0.05) {
                  finish({
                    targetSeconds: target,
                    mediaTime: info.mediaTime,
                    seekedMs,
                    rafMs: null,
                    rvfcMs: performance.now() - started,
                  });
                } else {
                  rvfcHandle = video.requestVideoFrameCallback(observe);
                }
              };
              rvfcHandle = video.requestVideoFrameCallback(observe);
            }
            video.currentTime = target;
          });
        }

        await seekOne(offsetSec + 0.5);
        const samples = [];
        for (const t of targets) samples.push(await seekOne(offsetSec + t));
        return {
          playable: true,
          url,
          videoWidth: loadResult.videoWidth,
          videoHeight: loadResult.videoHeight,
          duration: loadResult.duration,
          samples,
        };
      }

      const sourceRes = await measure(sourceUrl, windowStartUs / 1e6);
      const proxyRes = await measure(proxyUrl, 0);
      return { canPlayH264, hasRvfc, source: sourceRes, proxy: proxyRes };
    },
    [{ proxyUrl: setupRes.proxyUrl, sourceUrl: setupRes.sourceUrl, windowStartUs: setupRes.proxy.windowStartUs }],
  );

  const formatSeries = s => {
    if (!s.playable) return s;
    return {
      playable: true,
      url: s.url,
      videoWidth: s.videoWidth,
      videoHeight: s.videoHeight,
      duration: s.duration,
      n: s.samples.length,
      seeked: summarizeSamples(s.samples, 'seekedMs'),
      raf: summarizeSamples(s.samples, 'rafMs'),
      rvfc: summarizeSamples(s.samples, 'rvfcMs'),
    };
  };
  report.steps.webkitPreviewBenchmark = {
    canPlayH264: seekEval.canPlayH264,
    hasRvfc: seekEval.hasRvfc,
    source: formatSeries(seekEval.source),
    proxy: formatSeries(seekEval.proxy),
  };

  // Se clipes-media:// falhou no WebKitGTK, testa HTTP loopback para isolar codec vs URI scheme
  if (!seekEval.proxy.playable) {
    const http = await import('node:http');
    const fsSync = await import('node:fs');
    const proxyKey = setupRes.proxy.key;
    const proxyFile = join(cacheDir, 'proxies', proxyKey, 'proxy.mp4');
    const stat = fsSync.statSync(proxyFile);
    const srv = http.createServer((req, res) => {
      const range = req.headers.range;
      if (range && range.startsWith('bytes=')) {
        const [sStr, eStr] = range.slice(6).split('-');
        const start = Number(sStr || 0);
        const end = eStr ? Math.min(Number(eStr), stat.size - 1) : stat.size - 1;
        res.writeHead(206, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': end - start + 1,
          'Access-Control-Allow-Origin': '*',
        });
        fsSync.createReadStream(proxyFile, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
        });
        fsSync.createReadStream(proxyFile).pipe(res);
      }
    });
    await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
    const httpPort = srv.address().port;
    try {
      const httpSeek = await wd.execAsync(
        async ({ url }) => {
          document.body.replaceChildren();
          const video = document.createElement('video');
          video.muted = true;
          video.preload = 'auto';
          video.playsInline = true;
          video.src = url;
          document.body.append(video);
          const loaded = await new Promise(resolve => {
            const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 15_000);
            video.onloadeddata = () => { clearTimeout(timer); resolve({ ok: true, videoWidth: video.videoWidth, videoHeight: video.videoHeight, duration: video.duration }); };
            video.onerror = () => { clearTimeout(timer); resolve({ ok: false, reason: 'error', errorCode: video.error?.code ?? null, networkState: video.networkState }); };
          });
          if (!loaded.ok) return { playable: false, ...loaded };
          await video.play();
          await new Promise(r => setTimeout(r, 100));
          video.pause();
          const hasRvfc = typeof video.requestVideoFrameCallback === 'function';
          let seed = 58;
          const targets = Array.from({ length: 100 }, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return 1 + (seed / 4294967296) * 247;
          });
          const seekOne = target => new Promise((resolve, reject) => {
            const started = performance.now();
            let seekedMs = null;
            let rvfcHandle = null;
            let done = false;
            const finish = payload => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              if (rvfcHandle !== null && hasRvfc) video.cancelVideoFrameCallback(rvfcHandle);
              video.removeEventListener('seeked', onSeeked);
              resolve(payload);
            };
            const timer = setTimeout(() => reject(new Error(`Timeout seek ${target}`)), 10_000);
            const onSeeked = () => { seekedMs = performance.now() - started; };
            video.addEventListener('seeked', onSeeked, { once: true });
            const observe = (_, info) => {
              if (Math.abs(info.mediaTime - target) <= 0.05) {
                finish({ targetSeconds: target, mediaTime: info.mediaTime, seekedMs, rvfcMs: performance.now() - started });
              } else {
                rvfcHandle = video.requestVideoFrameCallback(observe);
              }
            };
            rvfcHandle = video.requestVideoFrameCallback(observe);
            video.currentTime = target;
          });
          await seekOne(0.5);
          const samples = [];
          for (const t of targets) samples.push(await seekOne(t));
          return { playable: true, ...loaded, samples };
        },
        [{ url: `http://127.0.0.1:${httpPort}/proxy.mp4` }],
      );
      report.steps.webkitHttpLoopbackDiag = httpSeek.playable
        ? {
            playable: true,
            videoWidth: httpSeek.videoWidth,
            videoHeight: httpSeek.videoHeight,
            duration: httpSeek.duration,
            n: httpSeek.samples.length,
            seeked: summarizeSamples(httpSeek.samples, 'seekedMs'),
            rvfc: summarizeSamples(httpSeek.samples, 'rvfcMs'),
          }
        : httpSeek;
    } finally {
      srv.close();
    }
  }

  // 6. Export de Corte com legenda + detecção de encoder (deve escolher libx264 sem NVENC)
  const encoderBefore = await wd.execAsync(async () => {
    const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke('core_dispatch', { name, arguments: args });
    const status = await invoke('export.encoder.status');
    const detectStarted = performance.now();
    const detected = await invoke('export.encoder.detect');
    return { status, detected, detectMs: performance.now() - detectStarted };
  });

  const exportRes = await wd.execAsync(
    async ({ sourceId, exportPath }) => {
      const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke('core_dispatch', { name, arguments: args });
      const captions = await invoke('export.captions', { source_id: sourceId, start_id: 1, end_id: 2 });
      const started = performance.now();
      const job = await invoke('export.start', {
        source_id: sourceId,
        start_id: 1,
        end_id: 2,
        output: exportPath,
      });
      for (;;) {
        const status = await invoke('export.status', { job: job.job });
        if (status.state === 'completed') {
          return { job: job.job, status, exportMs: performance.now() - started, assHasText: captions.ass.includes('Teste') };
        }
        if (status.state === 'failed' || status.state === 'cancelled') {
          throw new Error(`Export falhou: ${JSON.stringify(status)}`);
        }
        if (performance.now() - started > 120_000) {
          throw new Error(`Timeout no export: ${JSON.stringify(status)}`);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    },
    [{ sourceId: setupRes.source.id, exportPath }],
  );

  const probe1 = probeMedia(exportPath);
  const v1 = probe1.streams.find(s => s.codec_type === 'video');
  const a1 = probe1.streams.find(s => s.codec_type === 'audio');
  assert.equal(v1?.codec_name, 'h264');
  assert.equal(v1?.width, 1080);
  assert.equal(v1?.height, 1920);
  assert.equal(a1?.codec_name, 'aac');
  assert.equal(a1?.sample_rate, '48000');

  report.steps.exportWithCaptions = {
    ok: true,
    encoderDetected: encoderBefore.detected,
    detectMs: Math.round(encoderBefore.detectMs),
    exportMs: Math.round(exportRes.exportMs),
    assHasText: exportRes.assHasText,
    ffprobe: {
      sizeBytes: Number(probe1.format.size),
      durationSec: Number(probe1.format.duration),
      video: { codec: v1.codec_name, width: v1.width, height: v1.height, pixFmt: v1.pix_fmt },
      audio: { codec: a1.codec_name, sampleRate: Number(a1.sample_rate), channels: a1.channels },
    },
  };

  // 7. Exercitar fallback runtime x264 (forçando h264_nvenc no cache sem NVENC no runner)
  const encoderCachePath = join(dataDir, 'export-encoder.json');
  const cacheJson = JSON.parse(await readFile(encoderCachePath, 'utf8'));
  cacheJson.passed = ['h264_nvenc', 'libx264'];
  cacheJson.selected = 'h264_nvenc';
  cacheJson.manual = null;
  await writeFile(encoderCachePath, JSON.stringify(cacheJson, null, 2));

  const fallbackRes = await wd.execAsync(
    async ({ sourceId, fallbackExportPath }) => {
      const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke('core_dispatch', { name, arguments: args });
      const started = performance.now();
      const job = await invoke('export.start', {
        source_id: sourceId,
        start_id: 1,
        end_id: 2,
        output: fallbackExportPath,
      });
      for (;;) {
        const status = await invoke('export.status', { job: job.job });
        if (status.state === 'completed') {
          const encoderAfter = await invoke('export.encoder.status');
          await invoke('projects.close', {});
          return { job: job.job, status, encoderAfter, exportMs: performance.now() - started };
        }
        if (status.state === 'failed' || status.state === 'cancelled') {
          throw new Error(`Export fallback falhou: ${JSON.stringify(status)}`);
        }
        if (performance.now() - started > 120_000) {
          throw new Error(`Timeout no export fallback: ${JSON.stringify(status)}`);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    },
    [{ sourceId: setupRes.source.id, fallbackExportPath }],
  );

  const probe2 = probeMedia(fallbackExportPath);
  const v2 = probe2.streams.find(s => s.codec_type === 'video');
  assert.equal(v2?.codec_name, 'h264');
  assert.equal(v2?.width, 1080);
  assert.equal(v2?.height, 1920);

  const db = new Database(join(setupRes.project.path, 'project.sqlite'), { readonly: true });
  const exportRow = db
    .query('SELECT encoder, fallback_from, fallback_reason FROM exports WHERE job_id = ?')
    .get(fallbackRes.job);
  db.close();

  assert.equal(exportRow?.encoder, 'libx264');
  assert.equal(exportRow?.fallback_from, 'h264_nvenc');
  assert.equal(exportRow?.fallback_reason, 'encoder_failed');
  assert.deepEqual(fallbackRes.encoderAfter.passed, ['libx264']);
  assert.equal(fallbackRes.encoderAfter.effective, 'libx264');

  report.steps.x264Fallback = {
    ok: true,
    detectionSelected: encoderBefore.detected.effective,
    runtimeFallbackExportMs: Math.round(fallbackRes.exportMs),
    dbRecord: exportRow,
    encoderAfter: fallbackRes.encoderAfter,
    ffprobe: {
      sizeBytes: Number(probe2.format.size),
      durationSec: Number(probe2.format.duration),
      video: { codec: v2.codec_name, width: v2.width, height: v2.height },
    },
  };

  report.passed =
    Boolean(report.steps.uiCutPreview?.playOk) &&
    Boolean(report.steps.webkitPreviewBenchmark?.proxy?.playable) &&
    Boolean(report.steps.exportWithCaptions?.ok) &&
    Boolean(report.steps.x264Fallback?.ok);
} catch (error) {
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
} finally {
  await wd?.close().catch(() => {});
  if (driverProc && driverProc.exitCode === null) {
    driverProc.kill();
  }
  if (driverLogs.length > 0) {
    report.driverLogsTail = driverLogs.join('').slice(-4000);
  }
  const serialized = JSON.stringify(report, null, 2);
  if (outPath) {
    await writeFile(outPath, serialized);
  }
  console.log(serialized);
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
}

if (!report.passed) {
  process.exitCode = 1;
}
