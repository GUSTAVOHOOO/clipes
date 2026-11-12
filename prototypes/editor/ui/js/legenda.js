// Partes deste arquivo (agruparPalavras) derivam de HyperFrames, registry/components/caption-pill-karaoke/caption-pill-karaoke.html,
// commit 5bf361f, Copyright 2026 HeyGen, Inc., licenciado sob a Apache License 2.0
// (http://www.apache.org/licenses/LICENSE-2.0). Modificado pelo Clipes: sem GSAP, quebra por Frase e por palavras por linha.

import { FATOR_ASS } from './ass.js';

// Agrupamento e render karaokê da legenda no preview (CSS). O export (ass.js, libass) usa as mesmas
// regras de agrupamento, as mesmas cores e o mesmo efeito \kf, para que os dois fiquem iguais.

/** Extensão visível depois da última palavra do grupo (GROUP_END_BUFFER do HyperFrames), em segundos. */
export const FIM_EXTRA = 0.3;

// Pausa mínima entre palavras que fecha o grupo (o HyperFrames usa 0,1 s; aqui o combinado é 0,3 s).
const PAUSA_FECHA_GRUPO = 0.3;
// Tolerância para comparações de ponto flutuante.
const EPS = 1e-9;
// Espaço entre palavras no preview: o avanço real do glifo de espaço da fonte, como no libass.
const medidor = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
function larguraEspaco(familia, peso, tamanhoPx) {
  if (!medidor) return tamanhoPx * 0.28;
  medidor.font = `${peso} ${tamanhoPx}px ${familia}`;
  return medidor.measureText(' ').width;
}
// Fontes renderizadas com peso 400; as demais usam 700.
const FONTES_PESO_400 = ['Arial Black', 'Impact'];
// Pontuação que fecha o grupo, ignorando aspas e parênteses no fim da palavra.
const PONTUACAO_FIM = /[,.:;!?…]["'”’»)\]}]*$/;

const INVALIDO = -2; // força reconstrução do DOM na próxima atualização
const SEM_GRUPO = -1;

/**
 * Agrupa palavras em "cartões" de legenda.
 * Fecha o grupo quando: atingiu palavrasPorLinha; a palavra termina em pontuação de fim de frase;
 * há pausa >= 0,3 s até a próxima; a próxima é de outra Frase; é a última palavra.
 * Palavras com texto vazio são descartadas antes.
 * @returns {{palavras: object[], start: number, end: number}[]}
 */
export function agruparPalavras(palavras, palavrasPorLinha = 3) {
  const limite = Math.max(1, Math.floor(Number(palavrasPorLinha)) || 1);
  const lista = (palavras || [])
    .map((p) => ({ ...p, text: String(p.text ?? '').trim() }))
    .filter((p) => p.text !== '');

  const blocos = [];
  let atual = [];
  lista.forEach((palavra, i) => {
    atual.push(palavra);
    const proxima = lista[i + 1];
    const fecha =
      atual.length >= limite ||
      !proxima ||
      PONTUACAO_FIM.test(palavra.text) ||
      proxima.start - palavra.end >= PAUSA_FECHA_GRUPO - EPS ||
      proxima.frase !== palavra.frase;
    if (fecha) {
      blocos.push(atual);
      atual = [];
    }
  });

  return blocos.map((palavrasDoGrupo, k) => {
    const inicio = palavrasDoGrupo[0].start;
    const ultima = palavrasDoGrupo[palavrasDoGrupo.length - 1];
    const inicioSeguinte = blocos[k + 1]?.[0].start;
    const fimBruto = ultima.end + FIM_EXTRA;
    const fim = inicioSeguinte === undefined ? fimBruto : Math.min(inicioSeguinte, fimBruto);
    // Um grupo degenerado (fim antes do início) fica simplesmente invisível.
    return { palavras: palavrasDoGrupo, start: inicio, end: Math.max(inicio, fim) };
  });
}

/** Índice do grupo visível em t (intervalo [start, end)), ou -1. Busca binária: grupos estão ordenados. */
export function indiceDoGrupo(grupos, t) {
  let lo = 0;
  let hi = grupos.length - 1;
  let achado = -1;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if (grupos[meio].start <= t) {
      achado = meio;
      lo = meio + 1;
    } else {
      hi = meio - 1;
    }
  }
  return achado >= 0 && t < grupos[achado].end ? achado : -1;
}

/**
 * Estado karaokê da palavra i do grupo em t, no mesmo modelo do \kf do ASS:
 * 'antes' (ainda não falada, cor), 'durante' (varredura com progresso p em 0..100), 'depois' (destaque).
 * O segmento de cada palavra vai até o início da próxima palavra do grupo (ou até o fim, na última).
 */
export function estadoKaraoke(palavrasDoGrupo, i, t) {
  const atual = palavrasDoGrupo[i];
  const fimSegmento =
    i < palavrasDoGrupo.length - 1 ? palavrasDoGrupo[i + 1].start : atual.end;
  if (t < atual.start) return { fase: 'antes', p: 0 };
  if (t >= fimSegmento) return { fase: 'depois', p: 100 };
  const duracao = fimSegmento - atual.start;
  return { fase: 'durante', p: duracao > 0 ? ((t - atual.start) / duracao) * 100 : 100 };
}

function estilar(el, propriedades) {
  for (const [nome, valor] of Object.entries(propriedades)) {
    el.style.setProperty(nome.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), valor);
  }
}

/**
 * Cria a legenda sobre o palco (div 9:16 com position relative/absolute).
 * api: definir({palavras, estilo}), atualizar(t), limpar(), destruir().
 */
export function criarLegenda(palco) {
  const bloco = document.createElement('div');
  bloco.className = 'legenda-bloco';
  bloco.style.display = 'none';
  palco.appendChild(bloco);

  let estilo = null;
  let grupos = [];
  let mostrado = SEM_GRUPO; // índice do grupo no DOM, SEM_GRUPO ou INVALIDO
  let elementos = []; // { palavra, preenchimento, chave } do grupo montado
  let alturaUsada = 0;
  let ultimoT = 0;

  // Quando o palco muda de tamanho, a legenda é remontada com as novas medidas em px.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => atualizar(ultimoT)) : null;
  ro?.observe(palco);

  function esconder() {
    bloco.style.display = 'none';
    bloco.replaceChildren();
    elementos = [];
  }

  function montar(grupo) {
    const H = palco.clientHeight; // altura de referência: todas as medidas são frações de H
    alturaUsada = H;
    bloco.replaceChildren();
    elementos = [];
    if (H <= 0) {
      bloco.style.display = 'none';
      return;
    }

    const familia = estilo.fonte ? `"${estilo.fonte}", sans-serif` : 'sans-serif';
    const peso = FONTES_PESO_400.includes(estilo.fonte) ? '400' : '700';
    const sombraPx = estilo.sombra * H;

    estilar(bloco, {
      position: 'absolute',
      left: '50%',
      top: `${estilo.posY * H}px`,
      transform: 'translate(-50%, -50%)',
      width: 'max-content',
      maxWidth: '90%',
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: `${larguraEspaco(familia, peso, estilo.tamanho * H)}px`,
      fontFamily: familia,
      fontSize: `${estilo.tamanho * H}px`,
      fontWeight: peso,
      // Passo entre linhas igual ao do libass (Fontsize ASS = em × fator).
      lineHeight: String(FATOR_ASS[estilo.fonte] ?? 1.12),
      textAlign: 'center',
      textTransform: estilo.maiusculas ? 'uppercase' : 'none',
      pointerEvents: 'none',
    });
    bloco.style.display = 'flex';

    for (const palavra of grupo.palavras) {
      const el = document.createElement('span');
      el.className = 'legenda-palavra';
      estilar(el, { position: 'relative', display: 'block', whiteSpace: 'nowrap' });

      // Camada de baixo: contorno (stroke centrado, então a parte externa tem contorno * H) e sombra.
      const contorno = document.createElement('span');
      contorno.className = 'legenda-contorno';
      contorno.textContent = palavra.text;
      estilar(contorno, {
        display: 'block',
        color: estilo.corContorno,
        '-webkit-text-stroke': `${2 * estilo.contorno * H}px ${estilo.corContorno}`,
        filter:
          estilo.sombra > 0
            ? `drop-shadow(${sombraPx}px ${sombraPx}px 0 ${estilo.corContorno}80)`
            : 'none',
      });

      // Camada de cima: preenchimento recortado no texto; a cor vem do estado karaokê.
      const preenchimento = document.createElement('span');
      preenchimento.className = 'legenda-preenchimento';
      preenchimento.textContent = palavra.text;
      estilar(preenchimento, {
        position: 'absolute',
        inset: '0',
        display: 'block',
        whiteSpace: 'nowrap',
        color: 'transparent',
        '-webkit-text-fill-color': 'transparent',
        'background-clip': 'text',
        '-webkit-background-clip': 'text',
        pointerEvents: 'none',
      });

      el.append(contorno, preenchimento);
      bloco.appendChild(el);
      elementos.push({ palavra, preenchimento, chave: '' });
    }
  }

  function atualizarKaraoke(t) {
    const palavras = grupos[mostrado].palavras;
    elementos.forEach((item, i) => {
      const e = estadoKaraoke(palavras, i, t);
      let imagem = 'none';
      let cor = estilo.cor;
      if (e.fase === 'depois') cor = estilo.destaque;
      if (e.fase === 'durante') {
        // Falado à esquerda em destaque; ainda não falado à direita na cor base.
        imagem = `linear-gradient(90deg, ${estilo.destaque} ${e.p.toFixed(3)}%, ${estilo.cor} ${e.p.toFixed(3)}%)`;
        cor = 'transparent';
      }
      const chave = `${imagem}|${cor}`;
      if (chave !== item.chave) {
        item.chave = chave;
        item.preenchimento.style.backgroundImage = imagem;
        item.preenchimento.style.backgroundColor = cor;
      }
    });
  }

  function atualizar(t) {
    ultimoT = t;
    if (!estilo) return;
    if (palco.clientHeight !== alturaUsada) mostrado = INVALIDO;
    const idx = indiceDoGrupo(grupos, t);
    if (idx !== mostrado) {
      mostrado = idx;
      if (idx < 0) esconder();
      else montar(grupos[idx]);
    }
    if (mostrado >= 0 && elementos.length) atualizarKaraoke(t);
  }

  function definir({ palavras, estilo: novoEstilo }) {
    estilo = novoEstilo;
    grupos = agruparPalavras(palavras, estilo.palavrasPorLinha);
    mostrado = INVALIDO;
    atualizar(ultimoT);
  }

  function limpar() {
    estilo = null;
    grupos = [];
    mostrado = SEM_GRUPO;
    esconder();
  }

  function destruir() {
    ro?.disconnect();
    bloco.remove();
    limpar();
  }

  return { definir, atualizar, limpar, destruir };
}
