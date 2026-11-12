// Mostra a árvore de chaves (com tipos e exemplos curtos) do JSON de resposta de um path
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const re = new RegExp(process.argv[3]); const pick = process.env.LAST ? 'at' : 'find';
const es = har.log.entries.filter(e => re.test(new URL(e.request.url).pathname) && e.response.content?.text);
const e = process.env.LAST ? es.at(-1) : es[0];
let t = e.response.content.text; if (e.response.content.encoding === 'base64') t = Buffer.from(t, 'base64').toString('utf8');
const out = [];
const walk = (v, p, d) => {
  if (d > 7) return;
  if (Array.isArray(v)) { out.push(`${p}[] (${v.length})`); if (v.length) walk(v[0], p + '[0]', d + 1); }
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`, d + 1);
  else out.push(`${p} = ${JSON.stringify(v)?.slice(0, +(process.env.W || 90))}`);
};
console.log(e.request.method, e.request.url.slice(0, 140)); if (e.request.postData?.text) console.log('REQ', e.request.postData.text.slice(0, 1500));
walk(JSON.parse(t), '$', 0); console.log(out.slice(0, +(process.env.N || 120)).join('\n'));
