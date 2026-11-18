// Barra de ferramentas do wireframe: largura (1366/1440/1920) e anotações.
// Uso: ?w=1440 na URL. Sem ?w, mostra o que a página definir.
(function () {
  const p = new URLSearchParams(location.search);
  const w = p.get('w');
  if (w) {
    document.querySelectorAll('.wf-quadro').forEach((q) => {
      q.classList.remove('w1366', 'w1440', 'w1920');
      q.classList.add('w' + w);
    });
  }
  if (p.get('notas') === '0') document.body.classList.add('sem-notas');

  const barra = document.createElement('div');
  barra.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:99;display:flex;gap:6px;align-items:center;' +
    'background:#fff;border:1px solid #bdbdbd;border-radius:6px;padding:4px 8px;font:12px system-ui';
  const link = (rotulo, params) => {
    const u = new URL(location.href);
    Object.entries(params).forEach(([k, v]) => (v === null ? u.searchParams.delete(k) : u.searchParams.set(k, v)));
    const a = document.createElement('a');
    a.href = u.toString();
    a.textContent = rotulo;
    a.style.color = '#1f5fd6';
    return a;
  };
  const inicio = document.createElement('a');
  inicio.href = 'index.html';
  inicio.textContent = 'Índice';
  inicio.style.color = '#1f5fd6';
  barra.append(inicio, ' · ', link('1366', { w: '1366' }), link('1440', { w: '1440' }), link('1920', { w: '1920' }), ' · ',
    link(document.body.classList.contains('sem-notas') ? 'mostrar notas' : 'ocultar notas',
      { notas: document.body.classList.contains('sem-notas') ? null : '0' }));
  document.body.append(barra);
})();
