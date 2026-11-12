// Executa um passo no Chrome aberto pelo driver.mjs, via CDP.
// Uso: node cdp.mjs <arquivo-de-passo.mjs>
// O arquivo de passo exporta: default async ({ page, context, browser }) => resultado
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CLIPES_PORT || '9222'}`);
const context = browser.contexts()[0];
const page = context.pages().at(-1) ?? await context.newPage();
const step = await import(pathToFileURL(path.resolve(process.argv[2])).href);
try {
  const out = await step.default({ page, context, browser });
  if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
} catch (e) {
  console.error('[cdp] erro no passo:', e.message);
  process.exitCode = 1;
} finally {
  // Sai sem chamar browser.close(), para não arriscar fechar o navegador do driver.
  process.exit(process.exitCode ?? 0);
}
