// Resume o SSE de /api/question: tipos de evento, contagem, exemplos curtos
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const e of har.log.entries.filter(e => e.request.url.includes('/api/question'))) {
  console.log('\n### REQ body:', (e.request.postData?.text || '').slice(0, 1200));
  console.log('timings(ms):', JSON.stringify(e.timings), 'time', e.time);
  let t = e.response.content?.text || ''; if (e.response.content?.encoding === 'base64') t = Buffer.from(t, 'base64').toString('utf8');
  console.log('resp len', t.length);
  const blocks = t.split(/\n\n+/).filter(Boolean); const types = {}; const ex = {};
  for (const b of blocks) {
    const ev = b.match(/^event: ?(.*)$/m)?.[1] || '(sem event)';
    const data = b.match(/^data: ?(.*)$/m)?.[1] || '';
    let k = ev; try { const j = JSON.parse(data); k = ev + ' / ' + (j.type || j.event || Object.keys(j).slice(0, 4).join(',')); } catch {}
    types[k] = (types[k] || 0) + 1; if (!ex[k]) ex[k] = b.slice(0, 350);
  }
  console.log(JSON.stringify(types, null, 1));
  for (const [k, v] of Object.entries(ex)) console.log('--', k, '::', v.replace(/\n/g, ' | '));
}
