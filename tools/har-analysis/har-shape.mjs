// Uso: node tools/har-shape.mjs hars/x.har <regex-path> [maxChars]  -> corpo de req/resp truncado (para estudo local)
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const re = new RegExp(process.argv[3]); const max = +(process.argv[4] || 1500);
const seen = new Set();
for (const e of har.log.entries) {
  const u = new URL(e.request.url); if (!re.test(u.pathname) || !/vidiq\.com$/.test(u.hostname)) continue;
  const k = e.request.method + u.pathname; if (seen.has(k) && !process.env.ALL) continue; seen.add(k);
  console.log(`\n=== ${e.request.method} ${u.hostname}${u.pathname}${u.search.slice(0, 300)}  -> ${e.response.status} ${e.response.content?.mimeType}`);
  if (e.request.postData?.text) console.log('REQ:', e.request.postData.text.slice(0, max));
  let t = e.response.content?.text || ''; if (e.response.content?.encoding === 'base64') t = Buffer.from(t, 'base64').toString('utf8');
  console.log('RESP:', t.slice(0, max));
}
