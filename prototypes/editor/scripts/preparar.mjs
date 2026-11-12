// Prepara a mídia do protótipo do editor: download, normalização, Fonte longa e transcrição.
// Idempotente: cada etapa pula quando a saída já existe e é válida.
// Uso (a partir de prototypes/editor): node scripts/preparar.mjs

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, stat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const execFileP = promisify(execFile);

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(RAIZ, 'media');
const DOWNLOAD = join(MEDIA, 'download');

const ARQ = {
  zip: join(DOWNLOAD, 'tears_of_steel_1080p.mov.zip'),
  mov: join(DOWNLOAD, 'tears_of_steel_1080p.mov'),
  srt: join(DOWNLOAD, 'TOS-en.srt'),
  filme: join(MEDIA, 'tos-1080p.mp4'),
  fonte: join(MEDIA, 'fonte-2h.mp4'),
  concat: join(MEDIA, 'concat.txt'),
  transcricao: join(MEDIA, 'transcript.json'),
};

const URL_ZIP = 'https://download.blender.org/demo/movies/ToS/tears_of_steel_1080p.mov.zip';
const URL_SRT = 'https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt';
const COPIAS = 10;
const TOL_FONTE_S = 2;
const PAUSA_FRASE_MS = 700;

const inicio = Date.now();

function log(msg) {
  console.log(`[preparar] ${msg}`);
}

function seg(s) {
  return `${Number(s).toFixed(3)} s`;
}

function mb(bytes) {
  return (bytes / 2 ** 20).toFixed(0);
}

function arred(x) {
  return Math.round(x * 1000) / 1000;
}

async function existe(caminho) {
  try {
    return await stat(caminho);
  } catch {
    return null;
  }
}

// Roda um executável com array de argumentos (sem shell). Se houver `duracao`,
// interpreta as linhas `out_time_us=` do -progress pipe:1 e loga a cada 10%.
function correr(cmd, args, { duracao, rotulo } = {}) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let saidaBuf = '';
    let erroTxt = '';
    let marco = -10;

    const reportar = (pct) => {
      const atual = Math.floor(Math.min(100, Math.max(0, pct)) / 10) * 10;
      if (atual > marco) {
        marco = atual;
        log(`${rotulo}: ${atual}%`);
      }
    };

    filho.stdout.setEncoding('utf8');
    filho.stdout.on('data', (pedaco) => {
      saidaBuf += pedaco;
      let nl;
      while ((nl = saidaBuf.indexOf('\n')) >= 0) {
        const linha = saidaBuf.slice(0, nl).trim();
        saidaBuf = saidaBuf.slice(nl + 1);
        const m = /^out_time_us=(\d+)$/.exec(linha);
        if (m && duracao) reportar((Number(m[1]) / 1e6 / duracao) * 100);
      }
    });

    filho.stderr.setEncoding('utf8');
    filho.stderr.on('data', (pedaco) => {
      erroTxt = (erroTxt + pedaco).slice(-4000);
    });

    filho.on('error', rejeitar);
    filho.on('close', (code) => {
      if (code === 0) {
        if (duracao && rotulo) reportar(100);
        resolver();
      } else {
        const ultimas = erroTxt.trim().split(/\r?\n/).slice(-3).join(' | ');
        rejeitar(new Error(`${cmd} terminou com código ${code}: ${ultimas}`));
      }
    });
  });
}

async function probe(arquivo) {
  const { stdout } = await execFileP(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function probeValido(arquivo) {
  try {
    return await probe(arquivo);
  } catch {
    return null;
  }
}

function duracaoDe(info) {
  return Number(info.format.duration);
}

function filmeValido(info) {
  if (!info) return false;
  const v = info.streams.find((s) => s.codec_type === 'video');
  return (
    !!v &&
    v.codec_name === 'h264' &&
    v.width === 1920 &&
    v.height === 1080 &&
    [v.r_frame_rate, v.avg_frame_rate].includes('24/1') &&
    duracaoDe(info) > 0
  );
}

function escaparConcat(caminho) {
  return resolve(caminho).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

// ---------------------------------------------------------------- download

async function baixar(url, destino, rotulo) {
  log(`baixando ${rotulo}...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`falha ao baixar ${rotulo}: HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const comProgresso = total > 5 * 2 ** 20;
  const parcial = `${destino}.parcial`;
  let lido = 0;
  let marco = 0;
  let proximoMB = 100 * 2 ** 20;

  const medidor = new Transform({
    transform(chunk, _enc, cb) {
      lido += chunk.length;
      if (comProgresso && total) {
        while (marco < 100 && lido * 100 >= (marco + 10) * total) {
          marco += 10;
          log(`${rotulo}: ${marco}% (${mb(lido)} de ${mb(total)} MB)`);
        }
      } else if (comProgresso && lido >= proximoMB) {
        proximoMB += 100 * 2 ** 20;
        log(`${rotulo}: ${mb(lido)} MB`);
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), medidor, createWriteStream(parcial));
    await rename(parcial, destino);
  } catch (e) {
    await rm(parcial, { force: true });
    throw e;
  }
  log(`${rotulo} baixado (${mb(lido)} MB)`);
}

async function extrairMov() {
  const tmp = join(DOWNLOAD, '.extraindo');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  log('extraindo o filme original do zip (tar)...');
  await correr('tar', ['-xf', ARQ.zip, '-C', tmp]);
  const achados = (await readdir(tmp, { recursive: true })).filter((n) =>
    n.endsWith('tears_of_steel_1080p.mov'),
  );
  if (!achados.length) throw new Error('o zip não contém tears_of_steel_1080p.mov');
  await rename(join(tmp, achados[0]), ARQ.mov);
  await rm(tmp, { recursive: true, force: true });
}

async function etapaDownload() {
  log('etapa 1/4: download');
  await mkdir(DOWNLOAD, { recursive: true });

  if (await existe(ARQ.mov)) {
    log('filme original já existe, pulando');
  } else {
    if (await existe(ARQ.zip)) {
      log('zip já baixado, reaproveitando');
    } else {
      await baixar(URL_ZIP, ARQ.zip, 'filme original (zip)');
    }
    await extrairMov();
    await rm(ARQ.zip, { force: true });
    log('filme original extraído; zip apagado');
  }

  if (await existe(ARQ.srt)) {
    log('legendas (TOS-en.srt) já existem, pulando');
  } else {
    await baixar(URL_SRT, ARQ.srt, 'legendas (SRT)');
  }
}

// ---------------------------------------------------------------- filme normalizado

async function etapaFilme() {
  log('etapa 2/4: normalização do filme (1920x1080, 24 fps, H.264 + AAC)');
  const atual = await probeValido(ARQ.filme);
  if (filmeValido(atual)) {
    log(`tos-1080p.mp4 já existe e é válido (${seg(duracaoDe(atual))}), pulando`);
    return duracaoDe(atual);
  }
  if (atual) log('tos-1080p.mp4 existe mas é inválido; refazendo');

  const origem = await probe(ARQ.mov);
  const duracao = duracaoDe(origem);
  const parcial = join(MEDIA, 'tos-1080p.parcial.mp4');

  const entrada = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', ARQ.mov];
  const filtro = ['-vf', 'scale=-2:1080,crop=1920:1080,fps=24,format=yuv420p'];
  const audio = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];
  const saida = ['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', parcial];
  const nvenc = [
    '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23',
    '-b:v', '6M', '-maxrate', '9M', '-bufsize', '12M',
    '-g', '240', '-bf', '2', '-no-scenecut', '1',
  ];
  const x264 = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
    '-g', '240', '-keyint_min', '240', '-sc_threshold', '0',
  ];

  await rm(parcial, { force: true });
  try {
    log('codificando com NVENC (h264_nvenc)...');
    await correr('ffmpeg', [...entrada, ...filtro, ...nvenc, ...audio, ...saida], {
      duracao,
      rotulo: 'normalização',
    });
  } catch (e) {
    log(`NVENC falhou (${e.message}); refazendo com libx264`);
    await rm(parcial, { force: true });
    await correr('ffmpeg', [...entrada, ...filtro, ...x264, ...audio, ...saida], {
      duracao,
      rotulo: 'normalização (libx264)',
    });
  }

  await rename(parcial, ARQ.filme);
  const final = await probe(ARQ.filme);
  if (!filmeValido(final)) throw new Error('tos-1080p.mp4 gerado não passou na validação');
  log(`tos-1080p.mp4 pronto (${seg(duracaoDe(final))})`);
  return duracaoDe(final);
}

// ---------------------------------------------------------------- Fonte longa

async function etapaFonte(filmeDur) {
  log(`etapa 3/4: Fonte longa (fonte-2h.mp4, ${COPIAS} cópias)`);
  const esperado = COPIAS * filmeDur;

  const atual = await probeValido(ARQ.fonte);
  if (atual && Math.abs(duracaoDe(atual) - esperado) <= TOL_FONTE_S) {
    log(`fonte-2h.mp4 já existe e é válido (${seg(duracaoDe(atual))}), pulando`);
    return;
  }
  if (atual) log('fonte-2h.mp4 existe mas tem duração errada; refazendo');

  const linhas = Array.from({ length: COPIAS }, () => `file '${escaparConcat(ARQ.filme)}'`);
  await writeFile(ARQ.concat, linhas.join('\n') + '\n', 'utf8');

  const parcial = join(MEDIA, 'fonte-2h.parcial.mp4');
  await rm(parcial, { force: true });
  await correr(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', ARQ.concat,
      '-c', 'copy', '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats', parcial,
    ],
    { duracao: esperado, rotulo: 'Fonte longa' },
  );

  await rename(parcial, ARQ.fonte);
  const final = await probe(ARQ.fonte);
  const dur = duracaoDe(final);
  if (Math.abs(dur - esperado) > TOL_FONTE_S) {
    throw new Error(`fonte-2h.mp4 com ${seg(dur)}; esperado ~${seg(esperado)}`);
  }
  log(`fonte-2h.mp4 pronta (${seg(dur)}, esperado ~${seg(esperado)})`);
}

// ---------------------------------------------------------------- transcrição

const RE_TEMPO = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function tempoDe(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

function parseSrt(texto) {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const legendas = [];
  for (const bloco of limpo.split(/\n\s*\n/)) {
    const linhas = bloco
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const idx = linhas.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const m = RE_TEMPO.exec(linhas[idx]);
    if (!m) throw new Error(`linha de tempo inválida no SRT: "${linhas[idx]}"`);
    const ini = tempoDe(m[1], m[2], m[3], m[4]);
    const fim = tempoDe(m[5], m[6], m[7], m[8]);
    const texto = linhas
      .slice(idx + 1)
      .map((l) =>
        l
          .replace(/<[^>]*>/g, '')
          .replace(/\{[^}]*\}/g, '')
          .replace(/^-\s+/, '')
          .trim(),
      )
      .filter((l) => l.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!texto) continue;
    legendas.push({ ini, fim, texto });
  }
  return legendas;
}

// Distribui a duração da legenda entre as palavras, proporcional a max(2, letras + 1).
function palavrasDaLegenda({ ini, fim, texto }) {
  const palavras = texto.split(' ').filter((p) => p.length > 0);
  const pesos = palavras.map((p) => Math.max(2, (p.match(/[\p{L}\p{N}]/gu) || []).length + 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  const dur = fim - ini;
  let acum = 0;
  return palavras.map((text, j) => {
    const start = j === 0 ? ini : ini + dur * (acum / total);
    acum += pesos[j];
    const end = j === palavras.length - 1 ? fim : ini + dur * (acum / total);
    return { text, start, end };
  });
}

const RE_FIM_FRASE = /[.!?…]$/;
const RE_FIM_LIMPEZA = /["')\]”’]+$/;

async function transcricaoValida() {
  const st = await existe(ARQ.transcricao);
  if (!st) return false;
  const [srt, fonte] = await Promise.all([stat(ARQ.srt), stat(ARQ.fonte)]);
  if (srt.mtimeMs > st.mtimeMs || fonte.mtimeMs > st.mtimeMs) {
    log('legenda ou Fonte mais nova que transcript.json; regerando');
    return false;
  }
  try {
    const t = JSON.parse(await readFile(ARQ.transcricao, 'utf8'));
    return (
      t?.fonte?.copias === COPIAS &&
      Array.isArray(t.palavras) && t.palavras.length > 0 &&
      Array.isArray(t.frases) && t.frases.length > 0
    );
  } catch {
    log('transcript.json inválido; regerando');
    return false;
  }
}

async function etapaTranscricao(filmeDur) {
  log('etapa 4/4: transcrição (transcript.json)');
  if (await transcricaoValida()) {
    log('transcript.json já existe e está atualizado, pulando');
    return;
  }

  const legendas = parseSrt(await readFile(ARQ.srt, 'utf8'));
  const base = legendas.flatMap(palavrasDaLegenda);

  const todas = [];
  for (let k = 0; k < COPIAS; k++) {
    const desloc = k * filmeDur;
    for (const p of base) {
      todas.push({
        text: p.text,
        start: arred(p.start + desloc),
        end: arred(p.end + desloc),
      });
    }
  }
  todas.sort((a, b) => a.start - b.start);

  const palavras = [];
  const frases = [];
  let i0 = 0;
  todas.forEach((p, n) => {
    const idFrase = `f${frases.length}`;
    palavras.push({ id: `w${n}`, text: p.text, start: p.start, end: p.end, frase: idFrase });

    const ultima = n === todas.length - 1;
    const pausaMs = ultima ? Infinity : Math.round((todas[n + 1].start - p.end) * 1000);
    const pontuacaoFim = RE_FIM_FRASE.test(p.text.replace(RE_FIM_LIMPEZA, ''));
    if (pontuacaoFim || pausaMs >= PAUSA_FRASE_MS || ultima) {
      const grupo = palavras.slice(i0, n + 1);
      frases.push({
        id: idFrase,
        start: grupo[0].start,
        end: grupo[grupo.length - 1].end,
        i0,
        i1: n,
        texto: grupo.map((g) => g.text).join(' '),
      });
      i0 = n + 1;
    }
  });

  const fonteInfo = await probe(ARQ.fonte);
  const transcricao = {
    fonte: {
      arquivo: 'fonte-2h.mp4',
      duracao: duracaoDe(fonteInfo),
      largura: 1920,
      altura: 1080,
      fps: 24,
      duracaoFilme: filmeDur,
      copias: COPIAS,
    },
    palavras,
    frases,
  };

  const parcial = join(MEDIA, 'transcript.parcial.json');
  await writeFile(parcial, JSON.stringify(transcricao), 'utf8');
  await rename(parcial, ARQ.transcricao);
  log(`transcript.json gerado: ${palavras.length} palavras, ${frases.length} frases`);
}

// ---------------------------------------------------------------- resumo

async function resumo() {
  const t = JSON.parse(await readFile(ARQ.transcricao, 'utf8'));
  log('resumo:');
  log(`  filme (tos-1080p.mp4, 1 cópia): ${seg(t.fonte.duracaoFilme)}`);
  log(`  Fonte (fonte-2h.mp4, ${t.fonte.copias} cópias): ${seg(t.fonte.duracao)}`);
  log(`  palavras: ${t.palavras.length}`);
  log(`  frases: ${t.frases.length}`);
  log('  5 primeiras frases:');
  for (const f of t.frases.slice(0, 5)) {
    log(`    ${f.id}  ${seg(f.start)} a ${seg(f.end)}  ${f.texto}`);
  }
}

async function main() {
  await etapaDownload();
  const filmeDur = await etapaFilme();
  await etapaFonte(filmeDur);
  await etapaTranscricao(filmeDur);
  await resumo();
  log(`concluído em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(`[preparar] ERRO: ${e.message}`);
  process.exitCode = 1;
});
