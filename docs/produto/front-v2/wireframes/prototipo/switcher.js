// PROTÓTIPO DESCARTÁVEL. Barra flutuante para alternar variantes via ?variant=.
// Cada página declara: window.VARIANTES = [{ key: 'A', nome: 'Foco no palco' }, ...]
// e tem elementos <section data-variant="A">…</section>. Setas ← → também alternam
// (exceto com foco em campo de texto).
(function () {
  const vs = window.VARIANTES || [];
  if (!vs.length) return;
  const params = new URLSearchParams(location.search);
  let i = Math.max(0, vs.findIndex((v) => v.key === (params.get('variant') || vs[0].key)));

  function mostrar() {
    const atual = vs[i].key;
    document.querySelectorAll('[data-variant]').forEach((el) => {
      el.hidden = el.dataset.variant !== atual;
    });
    rotulo.textContent = `${atual} · ${vs[i].nome}`;
    const u = new URL(location.href);
    u.searchParams.set('variant', atual);
    history.replaceState(null, '', u);
    document.dispatchEvent(new CustomEvent('variante', { detail: atual }));
  }
  function ir(d) { i = (i + d + vs.length) % vs.length; mostrar(); }

  const barra = document.createElement('div');
  barra.setAttribute('role', 'toolbar');
  barra.setAttribute('aria-label', 'Alternar variante do protótipo');
  barra.style.cssText =
    'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:4px;' +
    'padding:4px;border-radius:999px;background:#fafafa;color:#111;font:600 12px/1 system-ui,sans-serif;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.5)';
  const botao = (txt, d, nome) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.setAttribute('aria-label', nome);
    b.style.cssText = 'border:0;background:#e6e6e6;color:#111;border-radius:999px;width:28px;height:28px;cursor:pointer;font:600 14px/1 system-ui,sans-serif';
    b.onclick = () => ir(d);
    return b;
  };
  const rotulo = document.createElement('span');
  rotulo.style.cssText = 'padding:0 12px;min-width:180px;text-align:center';
  const indice = document.createElement('a');
  indice.href = 'index.html';
  indice.textContent = 'protótipos';
  indice.style.cssText = 'color:#555;padding:0 10px 0 4px;font-weight:500;text-decoration:none';
  barra.append(botao('←', -1, 'Variante anterior'), rotulo, botao('→', 1, 'Próxima variante'), indice);
  document.body.append(barra);

  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.closest && t.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
    if (e.key === 'ArrowLeft' && !e.altKey && !e.ctrlKey) ir(-1);
    if (e.key === 'ArrowRight' && !e.altKey && !e.ctrlKey) ir(1);
  });
  mostrar();
})();
