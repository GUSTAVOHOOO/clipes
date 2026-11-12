// Painel de estilo da legenda: quatro presets e os controles para ajustá-los.
// Valores de tamanho, contorno e posição são frações do quadro 9:16 (1920 px de altura).

const ALTURA_QUADRO = 1920;
const CAMPOS_ESTILO = ['fonte', 'tamanho', 'cor', 'destaque', 'contorno', 'corContorno',
  'sombra', 'posY', 'palavrasPorLinha', 'maiusculas'];
const CAMPOS_COR = ['cor', 'destaque', 'corContorno'];

function criarPreset(id, nome, descricao, estilo) {
  return Object.freeze({ id, nome, descricao, estilo: Object.freeze({ preset: id, ...estilo }) });
}

export const PRESETS = Object.freeze([
  criarPreset('classico', 'Clássico', 'Caixa alta com destaque amarelo', {
    fonte: 'Arial Black', tamanho: 0.058, cor: '#FFFFFF', destaque: '#FFD43B',
    contorno: 0.0065, corContorno: '#000000', sombra: 0, posY: 0.70,
    palavrasPorLinha: 3, maiusculas: true,
  }),
  criarPreset('impacto', 'Impacto', 'Grande e chamativo, destaque verde', {
    fonte: 'Impact', tamanho: 0.075, cor: '#FFFFFF', destaque: '#22E07A',
    contorno: 0.008, corContorno: '#000000', sombra: 0.004, posY: 0.62,
    palavrasPorLinha: 2, maiusculas: true,
  }),
  criarPreset('limpo', 'Limpo', 'Texto claro e leitura tranquila', {
    fonte: 'Segoe UI', tamanho: 0.048, cor: '#F2F2F2', destaque: '#5CC8FF',
    contorno: 0.004, corContorno: '#101418', sombra: 0.003, posY: 0.80,
    palavrasPorLinha: 4, maiusculas: false,
  }),
  criarPreset('documentario', 'Documentário', 'Serifada e sóbria, para narração', {
    fonte: 'Georgia', tamanho: 0.044, cor: '#FFFFFF', destaque: '#FF8A3D',
    contorno: 0.0045, corContorno: '#1A1208', sombra: 0.002, posY: 0.84,
    palavrasPorLinha: 5, maiusculas: false,
  }),
]);

const FONTES = [...new Set(PRESETS.map((p) => p.estilo.fonte))];

let instancias = 0;

function el(tag, { classe, texto, attrs } = {}) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  if (attrs) for (const [chave, valor] of Object.entries(attrs)) no.setAttribute(chave, valor);
  return no;
}

/** Rótulo de posição vertical: 0 = topo, 1 = base. */
export function rotuloPosicao(posY) {
  if (posY < 0.4) return 'Alto';
  if (posY < 0.65) return 'Meio';
  return 'Baixo';
}

/** Verdadeiro quando o estilo tem os mesmos valores do preset (cores sem diferenciar maiúsculas). */
export function estiloIgualAoPreset(estilo, preset) {
  const referencia = preset.estilo;
  return CAMPOS_ESTILO.every((campo) => {
    const a = estilo[campo];
    const b = referencia[campo];
    if (CAMPOS_COR.includes(campo)) return String(a).toLowerCase() === String(b).toLowerCase();
    if (typeof b === 'number') return typeof a === 'number' && Math.abs(a - b) < 1e-9;
    return a === b;
  });
}

function formatarNumero(valor, casasDecimais) {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: casasDecimais });
}

function criarAmostra(preset) {
  const e = preset.estilo;
  const amostra = el('span', { classe: 'preset-amostra' });
  amostra.style.fontFamily = `"${e.fonte}"`;
  // Tamanho fixo na amostra; contorno e sombra proporcionais ao tamanho do preset.
  const px = 15;
  const escala = px / e.tamanho;
  amostra.style.fontSize = `${px}px`;
  amostra.style.fontWeight = ['Arial Black', 'Impact'].includes(e.fonte) ? '400' : '700';
  amostra.style.color = e.cor;
  amostra.style.setProperty('-webkit-text-stroke', `${(2 * e.contorno * escala).toFixed(2)}px ${e.corContorno}`);
  amostra.style.paintOrder = 'stroke fill';
  amostra.style.textShadow = e.sombra > 0
    ? `${(e.sombra * escala).toFixed(2)}px ${(e.sombra * escala).toFixed(2)}px 0 rgba(0, 0, 0, 0.6)`
    : 'none';
  amostra.style.textTransform = e.maiusculas ? 'uppercase' : 'none';
  const destaque = el('span', { texto: 'exemplo' });
  destaque.style.color = e.destaque;
  amostra.append('texto de ', destaque);
  return amostra;
}

function sincronizarValor(input, valor) {
  const texto = String(valor);
  if (input.value !== texto) input.value = texto;
}

export function criarPainelEstilo(container, { aoMudar = () => {} } = {}) {
  const id = `estilo-${++instancias}`;
  let estado = { ...PRESETS[0].estilo };
  const botoesPreset = new Map();
  const segmentos = new Map();
  const ref = {};

  function alterar(campo, valor) {
    estado = { ...estado, [campo]: valor };
    atualizarVisual();
    aoMudar({ ...estado });
  }

  function aplicarPreset(preset) {
    estado = { ...preset.estilo };
    atualizarVisual();
    aoMudar({ ...estado });
  }

  // Presets
  const presets = el('div', { classe: 'presets', attrs: { role: 'group', 'aria-label': 'Presets de estilo' } });
  for (const preset of PRESETS) {
    const botao = el('button', { classe: 'preset', attrs: { type: 'button' } });
    botao.append(
      criarAmostra(preset),
      el('span', { classe: 'preset-nome', texto: preset.nome }),
      el('span', { classe: 'preset-desc', texto: preset.descricao }),
    );
    botao.addEventListener('click', () => aplicarPreset(preset));
    botoesPreset.set(preset.id, botao);
    presets.append(botao);
  }

  // Controles
  const linha = (rotulo, idAlvo, ...controles) => {
    const div = el('div', { classe: 'controle' });
    div.append(el('label', { texto: rotulo, attrs: idAlvo ? { for: idAlvo } : undefined }), ...controles);
    return div;
  };

  const campoCor = (sufixo, campo) => {
    const input = el('input', { attrs: { type: 'color', id: `${id}-${sufixo}` } });
    input.addEventListener('input', () => alterar(campo, input.value.toUpperCase()));
    return input;
  };

  const campoFaixa = (sufixo, campo, min, max, passo) => {
    const input = el('input', {
      attrs: { type: 'range', id: `${id}-${sufixo}`, min: String(min), max: String(max), step: String(passo) },
    });
    const saida = el('output', { attrs: { for: input.id } });
    input.addEventListener('input', () => alterar(campo, Number(input.value)));
    return { input, saida };
  };

  ref.fonte = el('select', { attrs: { id: `${id}-fonte` } });
  for (const fonte of FONTES) {
    const opcao = el('option', { texto: fonte });
    opcao.value = fonte;
    opcao.style.fontFamily = `"${fonte}"`;
    ref.fonte.append(opcao);
  }
  ref.fonte.addEventListener('change', () => alterar('fonte', ref.fonte.value));

  ref.cor = campoCor('cor', 'cor');
  ref.destaque = campoCor('destaque', 'destaque');
  ref.contorno = campoFaixa('contorno', 'contorno', 0, 0.012, 0.0005);
  ref.corContorno = campoCor('corContorno', 'corContorno');
  ref.tamanho = campoFaixa('tamanho', 'tamanho', 0.03, 0.09, 0.001);
  ref.posY = campoFaixa('posY', 'posY', 0.15, 0.9, 0.01);

  const idPPL = `${id}-ppl`;
  const grupo = el('div', { classe: 'segmentado', attrs: { role: 'group', 'aria-labelledby': idPPL } });
  for (let n = 1; n <= 5; n++) {
    const botao = el('button', { texto: String(n), attrs: { type: 'button' } });
    botao.addEventListener('click', () => alterar('palavrasPorLinha', n));
    segmentos.set(n, botao);
    grupo.append(botao);
  }
  const linhaPPL = el('div', { classe: 'controle' });
  linhaPPL.append(el('label', { texto: 'Palavras por linha', attrs: { id: idPPL } }), grupo);

  ref.maiusculas = el('input', { attrs: { type: 'checkbox', role: 'switch', id: `${id}-maiusculas` } });
  ref.maiusculas.addEventListener('change', () => alterar('maiusculas', ref.maiusculas.checked));

  const controles = el('div', { classe: 'controles' });
  controles.append(
    linha('Fonte', ref.fonte.id, ref.fonte),
    linha('Cor do texto', ref.cor.id, ref.cor),
    linha('Cor de destaque', ref.destaque.id, ref.destaque),
    linha('Contorno', ref.contorno.input.id, ref.contorno.input, ref.contorno.saida),
    linha('Cor do contorno', ref.corContorno.id, ref.corContorno),
    linha('Tamanho', ref.tamanho.input.id, ref.tamanho.input, ref.tamanho.saida),
    linha('Posição vertical', ref.posY.input.id, ref.posY.input, ref.posY.saida),
    linhaPPL,
    linha('Maiúsculas', ref.maiusculas.id, ref.maiusculas),
  );

  function atualizarVisual() {
    for (const preset of PRESETS) {
      const botao = botoesPreset.get(preset.id);
      const ativo = preset.id === estado.preset;
      botao.classList.toggle('ativo', ativo);
      botao.classList.toggle('modificado', ativo && !estiloIgualAoPreset(estado, preset));
      botao.setAttribute('aria-pressed', String(ativo));
    }

    sincronizarValor(ref.fonte, estado.fonte);
    sincronizarValor(ref.cor, estado.cor.toLowerCase());
    sincronizarValor(ref.destaque, estado.destaque.toLowerCase());
    sincronizarValor(ref.corContorno, estado.corContorno.toLowerCase());
    sincronizarValor(ref.contorno.input, estado.contorno);
    sincronizarValor(ref.tamanho.input, estado.tamanho);
    sincronizarValor(ref.posY.input, estado.posY);
    ref.contorno.saida.textContent = `${formatarNumero(estado.contorno * ALTURA_QUADRO, 1)} px`;
    ref.tamanho.saida.textContent = `${formatarNumero(estado.tamanho * ALTURA_QUADRO, 0)} px`;
    ref.posY.saida.textContent = rotuloPosicao(estado.posY);

    for (const [n, botao] of segmentos) {
      botao.setAttribute('aria-pressed', String(n === estado.palavrasPorLinha));
    }
    ref.maiusculas.checked = Boolean(estado.maiusculas);
  }

  container.replaceChildren(presets, controles);

  function definir(novo = {}) {
    const base = PRESETS.find((p) => p.id === novo.preset) ?? PRESETS[0];
    estado = { ...base.estilo, ...novo };
    atualizarVisual();
  }

  atualizarVisual();
  return { definir };
}
