// Abre o Chrome real (visível) com um perfil dedicado e expõe CDP na porta 9222.
// Uso: [CLIPES_PORT=9223 CLIPES_PROFILE=profile-x] node driver.mjs <fluxo>   (fluxo "login" não grava HAR)
// Cada fluxo grava hars/<fluxo>.har.zip quando o contexto fecha:
// crie o arquivo "stop" nesta pasta ou feche a janela.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const flow = process.argv[2] || 'login';
// Pasta temporária própria: a temp do Windows (caminho curto WINDOW~1) quebrou a gravação do HAR.
const tmp = path.join(root, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
process.env.TEMP = process.env.TMP = tmp;
// Grava a API com corpo completo; deixa de fora mídia e assets estáticos pesados.
const harFilter = /^(?!.*(googlevideo\.com|\.mp4|\.m4s|\.ts(\?|$)|\.m3u8|\.webm|\.woff2?|\.ttf|\.png|\.jpe?g|\.webp|\.gif|\.svg|\.ico)).*$/i;
const port = process.env.CLIPES_PORT || '9222';
const profile = process.env.CLIPES_PROFILE || 'profile';
const stopFile = path.join(root, port === '9222' ? 'stop' : `stop-${port}`);
fs.rmSync(stopFile, { force: true });

const ctx = await chromium.launchPersistentContext(path.join(root, profile), {
  channel: 'chrome',
  headless: false,
  viewport: null,
  args: [`--remote-debugging-port=${port}`, '--start-maximized'],
  ...(flow === 'login' ? {} : { recordHar: { path: path.join(root, 'hars', `${flow}.har`), content: 'embed', urlFilter: harFilter } }),
});
if (ctx.pages().length === 0) await ctx.newPage();
console.log(`[driver] fluxo=${flow} pronto em http://127.0.0.1:${port}`);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  try { await ctx.close(); } catch {}
  console.log(`[driver] fluxo=${flow} encerrado${flow === 'login' ? '' : `, HAR em hars/${flow}.har`}`);
  process.exit(0);
};
ctx.on('close', close);
setInterval(() => { if (fs.existsSync(stopFile)) close(); }, 1000);
