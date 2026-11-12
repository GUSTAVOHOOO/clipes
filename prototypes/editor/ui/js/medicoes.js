// Medições rápidas de busca, scrub e arrasto de borda (Ctrl+Shift+M).
// Mede na mídia carregada (proxy automático) e na Fonte direta, na janela do Corte ativo.
// O resultado vai para media/medicoes/<carimbo>.json via comando Tauri.

const esperarQuadro = (video, alvo, limiteMs = 3000) => new Promise((ok) => {
  const t0 = performance.now();
  let encerrado = false;
  const fim = (r) => { if (!encerrado) { encerrado = true; ok(r); } };
  const laço = (_agora, meta) => {
    if (Math.abs(meta.mediaTime - alvo) < 0.05) fim({ ms: performance.now() - t0, erroMs: (meta.mediaTime - alvo) * 1000 });
    else if (!encerrado) video.requestVideoFrameCallback(laço);
  };
  video.requestVideoFrameCallback(laço);
  setTimeout(() => fim({ ms: null, erroMs: null }), limiteMs);
});

const resumo = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  return { n: v.length, media: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +v[v.length - 1].toFixed(1) };
};

// Gerador pseudoaleatório fixo, para repetir os mesmos alvos.
function alvos(n, a, b, semente = 7) {
  let s = semente;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, () => a + r() * (b - a));
}

export function criarMedidor({ video, estado, buscar, timeline, invocar, mudarBordas, bordasAtivas, pausar }) {
  let rodando = false;
  const status = (txt) => { document.title = `Clipes · ${txt}`; console.log('[medição]', txt); };

  async function buscas(rotulo) {
    const [a, b] = estado.janela;
    const res = [];
    for (const t of alvos(30, a + 2, b - 2)) {
      const alvo = t - estado.midia.offset;
      await new Promise((r) => setTimeout(r, 120));
      const espera = esperarQuadro(video, alvo);
      video.currentTime = alvo;
      res.push({ alvo: +t.toFixed(3), ...(await espera) });
    }
    return { rotulo, midia: estado.midia.tipo, amostras: res, resumo: resumo(res.map((x) => x.ms)) };
  }

  /** Conta rAF e quadros de vídeo apresentados enquanto `passo(fração)` roda a cada rAF por `ms`. */
  function arrasto(ms, passo) {
    return new Promise((ok) => {
      let raf = 0, quadros = 0, ativo = true;
      const contar = () => { quadros++; if (ativo) video.requestVideoFrameCallback(contar); };
      video.requestVideoFrameCallback(contar);
      const t0 = performance.now();
      const laço = (agora) => {
        const f = (agora - t0) / ms;
        if (f >= 1) {
          ativo = false;
          ok({ segundos: ms / 1000, rafPorS: +(raf / (ms / 1000)).toFixed(1), quadrosPorS: +(quadros / (ms / 1000)).toFixed(1) });
          return;
        }
        raf++; passo(f);
        requestAnimationFrame(laço);
      };
      requestAnimationFrame(laço);
    });
  }

  async function serie(rotulo) {
    const b = { ...bordasAtivas() };
    const scrub = await arrasto(10000, (f) => {
      // vai e volta pelo Corte, como a mão no scrub
      const ida = f < 0.5 ? f * 2 : 2 - f * 2;
      buscar(b.inicio + ida * (b.fim - b.inicio));
    });
    const trim = await arrasto(10000, (f) => {
      const ida = f < 0.5 ? f * 2 : 2 - f * 2;
      const t = b.inicio - 20 + ida * 40;
      mudarBordas(t, b.fim, { alca: 'inicio', arrastando: true, encaixou: false });
    });
    mudarBordas(b.inicio, b.fim, { alca: 'inicio', arrastando: false, encaixou: true });
    const seek = await buscas(rotulo);
    return { rotulo, midia: estado.midia.tipo, scrub, trim, buscas: seek };
  }

  async function rodar() {
    if (rodando) return;
    rodando = true;
    pausar();
    try {
      if (estado.midia.tipo !== 'proxy') { status('espere o proxy ficar pronto'); return; }
      const proxyUrl = video.src, proxyOffset = estado.midia.offset;
      status('medindo proxy…');
      const proxy = await serie('proxy automático');
      status('medindo Fonte direta…');
      const t = estado.tempo;
      estado.midia = { ...estado.midia, tipo: 'fonte', offset: 0 };
      video.src = proxyUrl.replace(/cache\/proxy_[^/]+\.mp4$/, 'fonte-2h.mp4');
      await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
      const fonte = await serie('Fonte direta');
      estado.midia = { ...estado.midia, tipo: 'proxy', offset: proxyOffset };
      video.src = proxyUrl;
      await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
      buscar(t);
      const relatorio = {
        quando: new Date().toISOString(),
        janela: estado.janela,
        corte: estado.ativo,
        foco: document.hasFocus(),
        visibilidade: document.visibilityState,
        viewport: [innerWidth, innerHeight],
        userAgent: navigator.userAgent,
        series: [proxy, fonte],
      };
      const nome = `medicao-${estado.ativo}-${Date.now()}`;
      const caminho = await invocar('salvar_medicao', { nome, conteudo: JSON.stringify(relatorio, null, 1) });
      status(`medição salva em ${caminho}`);
      window.__ultimaMedicao = relatorio;
    } finally {
      rodando = false;
    }
  }

  return { rodar, quadro() {} };
}
