// Painel de Transcrição do Corte: mostra as Frases do Corte com contexto,
// acompanha o tempo de reprodução e permite corrigir o texto das palavras.

const FRASES_DE_CONTEXTO = 2;
const PAUSA_ROLAGEM_USUARIO_MS = 3000;
const DICA = 'Clique numa palavra para ir até ela. Clique duas vezes para corrigir o texto.';

/** Formata segundos da Fonte como m:ss, ou h:mm:ss a partir de 1 h. */
export function formatarTempo(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h >= 1 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function el(tag, { classe, texto, attrs } = {}) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  if (attrs) for (const [chave, valor] of Object.entries(attrs)) no.setAttribute(chave, valor);
  return no;
}

function sobrepoe(inicioA, fimA, inicioB, fimB) {
  return fimA > inicioB && inicioA < fimB;
}

function normalizarTexto(texto) {
  return texto.replace(/\s+/g, ' ').trim();
}

// Índices inclusivos das Frases que tocam [inicio, fim]. Se nenhuma toca, b < a.
function faixaDeFrases(frases, inicio, fim) {
  const n = frases.length;
  let a = 0;
  while (a < n && frases[a].end <= inicio) a++;
  let b = n - 1;
  while (b >= 0 && frases[b].start >= fim) b--;
  return { a, b };
}

export function criarPainelTranscricao(container, { aoBuscar = () => {}, aoEditarPalavra = () => {} } = {}) {
  const entradas = new Map(); // id da palavra -> { palavra, el, fraseEl, dentro, atual, dita }
  let frases = [];
  let palavras = [];
  let inicio = 0;
  let fim = 0;
  let edicoes = new Map(); // cópia local: id -> texto editado ('' = palavra removida)
  let edicaoAtiva = null; // { entrada, controle }
  let suprimirClique = false;
  let ultimaRolagemUsuario = -Infinity;
  let fraseAcompanhada = null;
  let tempo = null;

  const marcarRolagemUsuario = () => {
    ultimaRolagemUsuario = performance.now();
  };
  container.addEventListener('pointerdown', marcarRolagemUsuario, { passive: true });
  container.addEventListener('wheel', marcarRolagemUsuario, { passive: true });
  container.addEventListener('touchmove', marcarRolagemUsuario, { passive: true });

  // Um clique que só encerra a edição (blur) não deve também buscar o tempo.
  container.addEventListener('mousedown', (ev) => {
    suprimirClique = Boolean(edicaoAtiva && !edicaoAtiva.entrada.el.contains(ev.target));
  });

  container.addEventListener('click', (ev) => {
    if (suprimirClique) {
      suprimirClique = false;
      return;
    }
    if (edicaoAtiva) return;
    const entrada = entradaDoEvento(ev);
    if (entrada) aoBuscar(entrada.palavra.start);
  });

  container.addEventListener('dblclick', (ev) => {
    const entrada = entradaDoEvento(ev);
    if (entrada) iniciarEdicao(entrada);
  });

  container.addEventListener('keydown', (ev) => {
    const entrada = entradaDoEvento(ev);
    if (!entrada || edicaoAtiva) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      aoBuscar(entrada.palavra.start);
    } else if (ev.key === 'F2') {
      ev.preventDefault();
      iniciarEdicao(entrada);
    }
  });

  function entradaDoEvento(ev) {
    const span = ev.target instanceof Element ? ev.target.closest('span.palavra') : null;
    return span ? (entradas.get(span.dataset.id) ?? null) : null;
  }

  // Texto que vale para a legenda: a edição, ou o original quando não há edição.
  function textoEfetivo(palavra) {
    return edicoes.has(palavra.id) ? edicoes.get(palavra.id) : palavra.text;
  }

  // Palavra removida mostra o original riscado, para continuar visível e corrigível.
  function textoExibido(palavra) {
    const texto = textoEfetivo(palavra);
    return texto === '' ? palavra.text : texto;
  }

  function aplicarVisual(entrada) {
    const { palavra, el: span } = entrada;
    const editada = edicoes.has(palavra.id);
    span.textContent = textoExibido(palavra);
    span.classList.toggle('editada', editada);
    span.classList.toggle('removida', editada && edicoes.get(palavra.id) === '');
    span.classList.toggle('atual', entrada.atual);
    span.classList.toggle('dita', entrada.dita);
  }

  function iniciarEdicao(entrada) {
    if (edicaoAtiva) return;
    const span = entrada.el;
    const controle = new AbortController();
    const opcoes = { signal: controle.signal };
    edicaoAtiva = { entrada, controle };

    span.classList.add('editando');
    span.setAttribute('contenteditable', 'plaintext-only');
    span.addEventListener('keydown', (ev) => {
      if (ev.isComposing) return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        confirmarEdicao();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancelarEdicao();
      }
    }, opcoes);
    span.addEventListener('blur', () => {
      if (edicaoAtiva?.entrada === entrada) confirmarEdicao();
    }, opcoes);

    span.focus();
    const faixa = document.createRange();
    faixa.selectNodeContents(span);
    const selecao = window.getSelection();
    selecao.removeAllRanges();
    selecao.addRange(faixa);
  }

  function encerrarEdicao() {
    const { entrada, controle } = edicaoAtiva;
    edicaoAtiva = null;
    controle.abort();
    entrada.el.classList.remove('editando');
    entrada.el.removeAttribute('contenteditable');
    return entrada;
  }

  function confirmarEdicao() {
    if (!edicaoAtiva) return;
    const entrada = encerrarEdicao();
    const { palavra } = entrada;
    const texto = normalizarTexto(entrada.el.textContent);
    if (texto !== textoEfetivo(palavra)) {
      edicoes.set(palavra.id, texto);
      aoEditarPalavra(palavra.id, texto);
    }
    aplicarVisual(entrada);
  }

  function cancelarEdicao() {
    if (!edicaoAtiva) return;
    aplicarVisual(encerrarEdicao());
  }

  function criarResumo(qtdFrases, qtdPalavras) {
    const resumo = el('div', { classe: 'transcricao-resumo' });
    resumo.append(
      `${qtdFrases.toLocaleString('pt-BR')} ${qtdFrases === 1 ? 'Frase' : 'Frases'} · ` +
        `${qtdPalavras.toLocaleString('pt-BR')} ${qtdPalavras === 1 ? 'palavra' : 'palavras'} no Corte `,
      el('span', { classe: 'dica', texto: DICA }),
    );
    return resumo;
  }

  function criarFrase(frase, dentro) {
    const fraseEl = el('div', { classe: dentro ? 'frase' : 'frase fora' });
    fraseEl.dataset.id = frase.id;
    const textoEl = el('p', { classe: 'frase-texto' });
    const itens = palavras.slice(frase.i0, frase.i1 + 1);
    let palavrasNoCorte = 0;

    if (itens.length === 0) textoEl.textContent = frase.texto ?? '';
    itens.forEach((palavra, k) => {
      if (k > 0) textoEl.append(' ');
      const span = el('span', { classe: 'palavra', attrs: { role: 'button', tabindex: '0' } });
      span.dataset.id = palavra.id;
      const entrada = {
        palavra,
        el: span,
        fraseEl,
        dentro: sobrepoe(palavra.start, palavra.end, inicio, fim),
        atual: false,
        dita: false,
      };
      if (entrada.dentro) palavrasNoCorte++;
      entradas.set(palavra.id, entrada);
      aplicarVisual(entrada);
      textoEl.append(span);
    });

    fraseEl.append(el('span', { classe: 'frase-tempo', texto: formatarTempo(frase.start) }), textoEl);
    return { fraseEl, palavrasNoCorte };
  }

  function renderizar() {
    entradas.clear();
    fraseAcompanhada = null;
    const n = frases.length;
    const { a, b } = faixaDeFrases(frases, inicio, fim);
    const ultimaDoCorte = b >= a ? b : a - 1;
    const lo = Math.max(0, a - FRASES_DE_CONTEXTO);
    const hi = Math.min(n - 1, ultimaDoCorte + FRASES_DE_CONTEXTO);

    const nos = [];
    let qtdFrases = 0;
    let qtdPalavras = 0;
    let dentroAnterior = null;
    for (let i = lo; i <= hi; i++) {
      const frase = frases[i];
      const dentro = sobrepoe(frase.start, frase.end, inicio, fim);
      if (dentro) qtdFrases++;
      if (dentroAnterior !== null && dentro !== dentroAnterior) {
        nos.push(el('div', { classe: 'transcricao-borda', texto: dentro ? 'Início do Corte' : 'Fim do Corte' }));
      }
      const { fraseEl, palavrasNoCorte } = criarFrase(frase, dentro);
      qtdPalavras += palavrasNoCorte;
      nos.push(fraseEl);
      dentroAnterior = dentro;
    }
    container.replaceChildren(criarResumo(qtdFrases, qtdPalavras), ...nos);
  }

  function acompanharFrase(fraseEl) {
    if (fraseEl === fraseAcompanhada) return;
    fraseAcompanhada = fraseEl;
    if (performance.now() - ultimaRolagemUsuario < PAUSA_ROLAGEM_USUARIO_MS) return;
    const r = fraseEl.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    if (r.top < c.top || r.bottom > c.bottom) {
      fraseEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function definir(dados = {}) {
    cancelarEdicao();
    frases = dados.frases ?? [];
    palavras = dados.palavras ?? [];
    inicio = dados.inicio ?? 0;
    fim = dados.fim ?? 0;
    edicoes = new Map(dados.edicoes ?? []);
    renderizar();
    if (tempo !== null) definirTempo(tempo);
  }

  function definirTempo(t) {
    tempo = t;
    let atualEntrada = null;
    for (const entrada of entradas.values()) {
      const { palavra } = entrada;
      const atual = palavra.start <= t && t < palavra.end;
      const dita = entrada.dentro && palavra.end <= t;
      if (atual !== entrada.atual) {
        entrada.atual = atual;
        entrada.el.classList.toggle('atual', atual);
      }
      if (dita !== entrada.dita) {
        entrada.dita = dita;
        entrada.el.classList.toggle('dita', dita);
      }
      if (atual) atualEntrada = entrada;
    }
    if (atualEntrada) acompanharFrase(atualEntrada.fraseEl);
  }

  container.replaceChildren();
  return { definir, definirTempo };
}
