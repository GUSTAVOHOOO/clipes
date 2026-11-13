import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_CORE_MOCK: '1' }, stdio: 'inherit' });
let browser;
try {
  for (let i = 0; ; i++) {
    try { await fetch(url); break; } catch { if (i === 100) throw Error('server did not start'); await new Promise(r => setTimeout(r, 200)); }
  }
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.getByRole('heading', { name: 'Nenhum Projeto aberto' }).waitFor();
  await mkdir('shots', { recursive: true });
  await page.screenshot({ path: 'shots/home-dark.png' });
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Paleta de comandos' }).waitFor();
  await page.screenshot({ path: 'shots/palette.png' });
  await page.getByRole('option', { name: /Sobre/ }).click();
  await page.getByRole('heading', { name: 'Sobre' }).waitFor();
  assert.match(await page.locator('main').innerText(), /0\.1\.0/);
  assert.match(await page.locator('main').innerText(), /Apache-2\.0/);
  await page.screenshot({ path: 'shots/about.png' });
  await page.getByRole('button', { name: 'Preferências' }).click();
  await page.getByLabel('Tema').selectOption('claro');
  await page.getByLabel('Idioma').selectOption('en');
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByRole('button', { name: 'Preferences' }).click();
  await page.getByRole('heading', { name: 'Preferences' }).waitFor();
  await page.keyboard.press('[');
  const drawer = page.getByRole('dialog', { name: 'Left drawer' });
  await drawer.waitFor();
  await page.screenshot({ path: 'shots/drawer.png' });
  await page.keyboard.press('Tab');
  assert.equal(await drawer.evaluate(e => e.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  assert.equal(await drawer.count(), 0);
  await page.getByRole('button', { name: /Left drawer/ }).hover();
  await page.locator('aside[aria-label="Left drawer"][data-aberta="true"]').waitFor();
  await page.mouse.move(600, 500);
  await page.screenshot({ path: 'shots/app-light.png' });
  await page.getByLabel('Theme').selectOption('escuro');
  await page.screenshot({ path: 'shots/app-dark.png' });
  assert.deepEqual(errors, []);
  console.log('UI keyboard, preferences, about, drawer and screenshots: OK');
} finally { await browser?.close(); server.kill(); }
