// Lista de Cortes com a Nota total, os cinco eixos e as justificativas do Corte ativo.

const EIXO_MAXIMO = 10;

let instancias = 0;

function el(tag, { classe, texto, attrs } = {}) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  if (attrs) for (const [chave, valor] of Object.entries(attrs)) no.setAttribute(chave, valor);
  return no;
}

/** Arredonda a Nota para 1 casa decimal, como ela aparece na tela. */
export function arredondarNota(total) {
  return Math.round(total * 10) / 10;
}

/** Faixa da Nota: alta (>= 8), media (>= 6,5) ou baixa. */
export function faixaDaNota(total) {
  const nota = arredondarNota(total);
  if (nota >= 8) return 'alta';
  if (nota >= 6.5) return 'media';
  return 'baixa';
}

/** Nota com 1 casa decimal e vírgula, ex.: 8,1. */
export function formatarNota(total) {
  return arredondarNota(total).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Duração do Corte como m:ss. */
export function formatarDuracao(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Posição na Fonte como h:mm:ss, ex.: 1:36:12. */
export function formatarPosicao(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatarValorEixo(valor) {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function criarEixos(eixos) {
  const bloco = el('div', { classe: 'corte-eixos' });
  for (const eixo of eixos) {
    const preenchimento = el('span', { classe: 'eixo-preenchimento' });
    const porcentagem = Math.min(EIXO_MAXIMO, Math.max(0, eixo.valor)) * 10;
    preenchimento.style.width = `${Number(porcentagem.toFixed(1))}%`;
    const barra = el('span', { classe: 'eixo-barra', attrs: { 'aria-hidden': 'true' } });
    barra.append(preenchimento);
    bloco.append(el('div', { classe: 'eixo' }));
    bloco.lastElementChild.append(
      el('span', { classe: 'eixo-nome', texto: eixo.nome }),
      barra,
      el('span', { classe: 'eixo-valor', texto: formatarValorEixo(eixo.valor) }),
    );
  }
  return bloco;
}

function criarBotaoCorte(corte, ativo, { inicio, fim, modificado }) {
  const total = arredondarNota(corte.nota.total);
  const botao = el('button', { classe: ativo ? 'corte ativo' : 'corte', attrs: { type: 'button' } });
  botao.dataset.id = corte.id;
  if (ativo) botao.setAttribute('aria-current', 'true');

  const nota = el('span', { classe: 'corte-nota', texto: formatarNota(total) });
  nota.dataset.faixa = faixaDaNota(total);

  const meta = el('span', {
    classe: 'corte-meta',
    texto: `${formatarDuracao(fim - inicio)} · em ${formatarPosicao(inicio)}`,
  });
  if (modificado) {
    meta.append(' ', el('span', { classe: 'corte-modificado', texto: 'editado' }));
  }

  botao.append(
    nota,
    el('span', { classe: 'corte-titulo', texto: corte.titulo }),
    meta,
    criarEixos(corte.nota.eixos),
  );
  return botao;
}

function criarJustificativas(corte) {
  const bloco = el('div', { classe: 'corte-justificativas' });
  const lista = el('dl');
  for (const eixo of corte.nota.eixos) {
    lista.append(el('dt', { texto: eixo.nome }), el('dd', { texto: eixo.justificativa }));
  }
  bloco.append(lista);
  return bloco;
}

export function criarListaCortes(container, { aoSelecionar = () => {} } = {}) {
  const id = `cortes-${++instancias}`;
  const titulo = el('h2', { texto: 'Cortes', attrs: { id: `${id}-titulo` } });
  const contagem = el('span', { texto: '0 cortes' });
  const cabecalho = el('div', { classe: 'cortes-cabecalho' });
  cabecalho.append(titulo, contagem);

  const lista = el('ol', { classe: 'cortes', attrs: { 'aria-labelledby': `${id}-titulo` } });
  let botoes = [];

  // Setas movem o foco entre os cortes. Enter e clique disparam o botão (aoSelecionar).
  lista.addEventListener('keydown', (ev) => {
    const atual = botoes.indexOf(ev.target);
    if (atual === -1) return;
    let proximo = null;
    if (ev.key === 'ArrowDown') proximo = Math.min(atual + 1, botoes.length - 1);
    else if (ev.key === 'ArrowUp') proximo = Math.max(atual - 1, 0);
    else if (ev.key === 'Home') proximo = 0;
    else if (ev.key === 'End') proximo = botoes.length - 1;
    if (proximo === null) return;
    ev.preventDefault();
    botoes[proximo].focus();
  });

  container.replaceChildren(cabecalho, lista);

  function definir(cortes, ativoId, estados = {}) {
    const focado = document.activeElement;
    const idComFoco = botoes.includes(focado) ? focado.dataset.id : null;

    const itens = [];
    botoes = [];
    for (const corte of cortes) {
      const ativo = corte.id === ativoId;
      const estado = estados[corte.id] ?? {};
      const botao = criarBotaoCorte(corte, ativo, {
        inicio: estado.inicio ?? corte.inicio,
        fim: estado.fim ?? corte.fim,
        modificado: estado.modificado === true,
      });
      botao.addEventListener('click', () => aoSelecionar(corte.id));

      const item = el('li');
      item.append(botao);
      if (ativo) item.append(criarJustificativas(corte));
      itens.push(item);
      botoes.push(botao);
    }

    lista.replaceChildren(...itens);
    contagem.textContent = `${cortes.length} ${cortes.length === 1 ? 'corte' : 'cortes'}`;

    if (idComFoco !== null) {
      botoes.find((b) => b.dataset.id === idComFoco)?.focus();
    }
  }

  return { definir };
}
