// Uso: node tools/har-endpoints.mjs hars/x.har  -> endpoints de API (método host path:id contagem status)
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const norm = p => p
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  .replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, '/:id')
  .replace(/\/\d{3,}(?=\/|$)/g, '/:id')
  .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id');
const isApi = (u, e) => {
  const ct = e.response.content?.mimeType || '';
  if (/\.(js|css|map|html?)$/.test(u.pathname)) return false;
  if (/^(assets|static|cdn)\./.test(u.hostname)) return false;
  return /json|event-stream|text\/plain|grpc|x-www-form|protobuf/.test(ct) || e.request.method !== 'GET';
};
const first = /(^|\.)vidiq\.com$/;
const m = new Map(), third = new Map();
for (const e of har.log.entries) {
  let u; try { u = new URL(e.request.url); } catch { continue; }
  if (!isApi(u, e)) continue;
  if (!first.test(u.hostname)) { third.set(u.hostname, (third.get(u.hostname) || 0) + 1); continue; }
  const k = `${e.request.method} ${u.hostname} ${norm(u.pathname)}`;
  const o = m.get(k) || { n: 0, st: new Set(), q: new Set(), ct: new Set() };
  o.n++; o.st.add(e.response.status); for (const key of u.searchParams.keys()) o.q.add(key); o.ct.add((e.response.content?.mimeType || '').split(';')[0]);
  m.set(k, o);
}
const rows = [...m].sort((a, b) => a[0].split(' ')[2].localeCompare(b[0].split(' ')[2]));
console.log('| Método | Host | Path | Nº | Status | Tipo | Query (chaves) |\n|---|---|---|---|---|---|---|');
for (const [k, o] of rows) { const [mt, h, p] = k.split(' '); console.log(`| ${mt} | ${h} | \`${p}\` | ${o.n} | ${[...o.st].join(',')} | ${[...o.ct].filter(Boolean).join(',')} | ${[...o.q].join(', ')} |`); }
console.log('\nTerceiros (analytics/ads, contagem): ' + [...third].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} (${n})`).join(', '));
