// Captura as telas REAIS do front-v2 (master, mock VITE_CORE_MOCK=1) para o filme.
// Uso: com `cd front-v2 && bun run dev` no ar (porta 1430):
//   node scripts/capture-app.mjs [--size 1440x900] [--only nome,nome]
// Saída: assets/app/<tamanho>/<nome>.png (2x, cru; vira JPEG em assets/cap/ por optimize).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:1430';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [W, H] = opt('--size', '1440x900').split('x').map(Number);
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const outDir = path.resolve('assets/app', `${W}x${H}`);
fs.mkdirSync(outDir, { recursive: true });

// Cada plano: projeto de demonstração do mock, hash e uma espera pelo conteúdo real.
const PLANOS = [
  { nome: 'inicio', abrir: null, hash: '#/inicio', espera: '[aria-label*="Abrir Projeto"], button:has-text("Demo")' },
  { nome: 'fontes', abrir: 'Meu Canal de Cortes', hash: '#/projeto/meu-canal-de-cortes/fontes', espera: 'h1' },
  { nome: 'fonte-transcricao', abrir: 'Meu Canal de Cortes', hash: '#/projeto/meu-canal-de-cortes/fontes/4', espera: 'h1:has-text("Live_12_11_final.mp4")' },
  { nome: 'cortes', abrir: 'Demo', hash: '#/projeto/demo/cortes', espera: 'h1' },
  { nome: 'revisao', abrir: 'Demo', hash: '#/projeto/demo/cortes/revisao/1', espera: 'h1' },
  { nome: 'corte-editar', abrir: 'Demo', hash: '#/projeto/demo/corte/201/editar?run=2', espera: 'nav[aria-label="Etapas do Corte"]' },
  { nome: 'corte-editar-102', abrir: 'Demo', hash: '#/projeto/demo/corte/102/editar?run=1', espera: 'nav[aria-label="Etapas do Corte"]' },
  { nome: 'corte-transformar', abrir: 'Demo', hash: '#/projeto/demo/corte/202/transformar?run=2', espera: 'nav[aria-label="Etapas do Corte"]' },
  { nome: 'corte-empacotar', abrir: 'Demo', hash: '#/projeto/demo/corte/202/empacotar?run=2', espera: 'nav[aria-label="Etapas do Corte"]' },
  { nome: 'exportacao', abrir: 'Demo', hash: '#/projeto/demo/exportacao', espera: 'h1' },
  // estados reais depois de uma interação (clique de verdade no app)
  { nome: 'revisao-aprovado', abrir: 'Demo', hash: '#/projeto/demo/cortes/revisao/1', espera: 'h1', clicar: /^Aprovar/ },
  { nome: 'corte-editar-painel', abrir: 'Demo', hash: '#/projeto/demo/corte/201/editar?run=2', espera: 'nav[aria-label="Etapas do Corte"]', clicar: /^Legenda$/ },
];

// Falas fictícias de uma live de jogo (texto de demonstração escrito para o filme).
const FALAS = {
  0: 'Boa noite, chat, bora pra mais uma live.',
  1: 'Boa noite, chat, bora pra mais uma live.',
  2: 'Hoje a gente fecha a campanha de vez.',
  3: 'Quem chegou agora, deixa o salve aí.',
  4: 'Primeiro mapa já começa complicado.',
  5: 'Calma, tem um caminho por cima.',
  6: 'Olha o tamanho desse chefe, gente.',
  7: 'Se eu cair aqui, volto tudo do início.',
  8: 'Segura a respiração que lá vamos nós.',
  9: 'Não acredito que deu certo de primeira.',
  10: 'E é aqui que começa a virada.',
  11: 'Faltando dois minutos, ninguém acreditava.',
  12: 'Ele segura, segura e solta tudo de uma vez.',
  13: 'O chat simplesmente explodiu nessa hora.',
  14: 'Foi a melhor jogada da live inteira.',
  15: 'Bom, agora deixa eu respirar um pouco.',
  16: 'Vou pegar uma água e já volto.',
  17: 'Enquanto isso, comenta o que achou.',
  18: 'Próximo mapa é o mais difícil.',
  19: 'Bora que bora.',
};
const rects = {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
// A legenda da Prévia 9:16 é desenhada em <canvas> pelo renderizador real
// (src/features/captions/render.ts); trocamos só a string de demonstração do mock.
await ctx.addInitScript(() => {
  const P = CanvasRenderingContext2D.prototype;
  for (const fn of ['fillText', 'strokeText', 'measureText']) {
    const orig = P[fn];
    P[fn] = function (txt, ...rest) {
      if (typeof txt === 'string') {
        const M = { 'Texto narrado alinhado.': 'O chat simplesmente explodiu', Texto: 'O chat', narrado: 'simplesmente', 'alinhado.': 'explodiu' };
        const k = txt.trim();
        if (M[k]) txt = txt.replace(k, M[k]);
      }
      return orig.call(this, txt, ...rest);
    };
  }
});
const page = await ctx.newPage();
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));

for (const p of PLANOS) {
  if (only.length && !only.includes(p.nome)) continue;
  await page.goto(`${BASE}/#/inicio`);
  if (p.abrir) {
    await page.getByRole('button', { name: new RegExp(`Abrir Projeto ${p.abrir}`, 'i') }).click();
    await page.waitForURL(/#\/projeto\//);
    await page.evaluate((h) => { window.location.hash = h; }, p.hash);
  }
  await page.locator(p.espera).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200); // deixa o mock assentar (listas, miniaturas)
  if (p.clicar) {
    await page.getByRole('button', { name: p.clicar }).first().click();
    await page.waitForTimeout(900);
  }
  await page.mouse.move(W - 4, H - 4); // ponteiro fora de qualquer hover
  // VESTIR (dados de demonstração): só TEXTO no DOM já renderizado pelo app real.
  // O mock fala "Frase 10"; aqui cada Frase recebe uma fala fictícia de live (FALAS).
  // As pílulas de falha/orçamento/incerto do cenário de teste do mock somem (num
  // Projeto limpo elas não aparecem). Nenhum componente é criado ou desenhado.
  const info = await page.evaluate((FALAS) => {
    for (const b of document.querySelectorAll('[data-word]')) {
      const id = Number(b.getAttribute('data-word'));
      const frase = Math.floor(id / 10), k = id % 10;
      const span = b.querySelector('span') || b;
      if (FALAS[frase] === undefined) continue;
      span.textContent = k === 0 ? FALAS[frase] : '';
      if (k !== 0) b.style.display = 'none';
    }
    const trocar = (de, para) => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) if (n.nodeValue.includes(de)) n.nodeValue = n.nodeValue.replace(de, para);
    };
    trocar('Texto narrado alinhado.', 'O chat simplesmente explodiu');
    const LEG = { Texto: 'O chat', narrado: 'simplesmente', 'alinhado.': 'explodiu' };
    for (const w of document.querySelectorAll('[data-caption-word], [data-caption-word] span')) {
      for (const n of w.childNodes) if (n.nodeType === 3 && LEG[n.nodeValue.trim()]) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), LEG[n.nodeValue.trim()]);
    }
    for (const el of document.querySelectorAll('button, a, div[role="status"]')) {
      const t = el.textContent || '';
      if (/tarefa(s)? falh|Orçamento pausado|^\s*\d+ incertos?\s*$/.test(t) && t.length < 40) el.style.display = 'none';
    }
    // retângulos das áreas de prévia (fundo preto puro) para compor a mídia de demonstração
    const previas = [];
    for (const el of document.querySelectorAll('div, video, canvas')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 150) continue;
      if (getComputedStyle(el).backgroundColor === 'rgb(0, 0, 0)') previas.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return { previas };
  }, FALAS);
  await page.waitForTimeout(150);
  // retângulos medidos (px CSS) para a câmera e as máscaras do filme
  Object.assign(info, await page.evaluate(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const frases = [...document.querySelectorAll('[aria-label^="Frase "]')].filter(vis).map((e) => ({ id: e.getAttribute('aria-label'), ...R(e) }));
    const botoes = {};
    for (const b of document.querySelectorAll('button, a')) {
      const t = (b.textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 50 && vis(b) && !(t in botoes)) botoes[t] = R(b);
    }
    const titulos = {};
    for (const h of document.querySelectorAll('h1, h2, h3')) if (vis(h)) titulos[h.textContent.trim()] = R(h);
    const legenda = [...document.querySelectorAll('[data-caption-word]')].filter(vis).map((e) => ({ t: e.textContent, ...R(e) }));
    return { frases, botoes, titulos, legenda };
  }));
  const arq = path.join(outDir, `${p.nome}.png`);
  await page.screenshot({ path: arq });
  rects[p.nome] = info;
  // camada só da legenda real (fundo transparente) sobre a área de prévia
  if (info.previas.length && (await page.locator('[data-caption-line]').count())) {
    const css = await page.addStyleTag({ content: 'html,body{background:transparent!important} body *{visibility:hidden!important} [data-caption-line],[data-caption-line] *{visibility:visible!important}' });
    const r = info.previas[0];
    await page.screenshot({ path: path.join(outDir, `${p.nome}.leg.png`), omitBackground: true, clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
    await css.evaluate((n) => n.remove());
  }
  console.log('ok', p.nome, JSON.stringify(info.previas));
}
fs.writeFileSync(path.join(outDir, 'rects.json'), JSON.stringify(rects, null, 1));
if (erros.length) console.log('pageerror:', erros.join(' | '));
await browser.close();
