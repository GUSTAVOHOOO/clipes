// Servidor local dos wireframes: bun docs/produto/front-v2/wireframes/servir.ts
// Abre em http://localhost:5190 (ou PORTA=xxxx). Só arquivos desta pasta.
import { join, normalize } from 'node:path';

const raiz = import.meta.dir;
const porta = Number(process.env.PORTA ?? 5190);

Bun.serve({
  port: porta,
  async fetch(req) {
    let caminho = decodeURIComponent(new URL(req.url).pathname);
    if (caminho === '/') caminho = '/index.html';
    const alvo = normalize(join(raiz, caminho));
    if (!alvo.startsWith(raiz)) return new Response('fora da pasta', { status: 403 });
    const arquivo = Bun.file(alvo);
    return (await arquivo.exists()) ? new Response(arquivo) : new Response('não encontrado', { status: 404 });
  },
});
console.log(`Wireframes em http://localhost:${porta}`);
