// Gera o arquivo ASS (libass) com karaokê \kf a partir dos mesmos grupos que o preview usa (legenda.js).

// Fator Fontsize ASS = tamanho * altura * fator. Calibrado depois pelo integrador.
// Fontsize do ASS = altura de linha (usWinAscent + usWinDescent) no libass; o CSS usa o em.
// Fatores medidos pela altura do "H" renderizado pelo libass contra o CSS (batem com a tabela OS/2 das fontes).
export const FATOR_ASS = { 'Arial Black': 1.416, 'Impact': 1.231, 'Segoe UI': 1.333, 'Georgia': 1.153 };

// Fontes com peso 400 no preview; no ASS, Bold 0.
const FONTES_SEM_NEGRITO = ['Arial Black', 'Impact'];

/** '#RRGGBB' -> '&HAABBGGRR' (alfa 0 = opaco, 255 = invisível). */
export function corAss(hex, alfa = 0) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) throw new Error(`Cor inválida para ASS: ${hex}`);
  const rgb = m[1];
  const rr = rgb.slice(0, 2);
  const gg = rgb.slice(2, 4);
  const bb = rgb.slice(4, 6);
  const aa = Math.max(0, Math.min(255, Math.round(alfa))).toString(16).padStart(2, '0');
  return `&H${aa}${bb}${gg}${rr}`.toUpperCase();
}

/** Segundos -> centésimos inteiros, nunca negativos. */
function centesimos(s) {
  const valor = Number.isFinite(s) ? s : 0;
  return Math.max(0, Math.round(valor * 100));
}

const doisDigitos = (n) => String(n).padStart(2, '0');

/** Segundos -> 'H:MM:SS.cc' (centésimos arredondados; nunca negativo). */
export function tempoAss(s) {
  const cs = centesimos(s);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const seg = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  return `${h}:${doisDigitos(m)}:${doisDigitos(seg)}.${doisDigitos(c)}`;
}

// Chaves { } e barra invertida não podem aparecer no texto: no ASS abririam bloco de override.
// Trocadas por equivalentes de largura cheia (visíveis e sem efeito de tag).
function textoSeguro(texto) {
  return String(texto)
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '＼')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝');
}

/**
 * @param {object} p
 * @param {{start:number,end:number,palavras:{text:string,start:number,end:number}[]}[]} p.grupos
 * @param {object} p.estilo EstiloLegenda
 * @param {(t:number)=>number} [p.mapearTempo] tempo da Fonte -> tempo de saída
 */
export function gerarAss({ grupos, estilo, mapearTempo = (t) => t, largura = 1080, altura = 1920 }) {
  const fonte = estilo.fonte;
  const fator = FATOR_ASS[fonte] ?? 1;
  const tamanho = Math.round(estilo.tamanho * altura * fator);
  const negrito = FONTES_SEM_NEGRITO.includes(fonte) ? 0 : -1;
  const contorno = (estilo.contorno * altura).toFixed(2);
  const sombra = (estilo.sombra * altura).toFixed(2);
  const margem = Math.round(0.05 * largura);
  const maiusculas = Boolean(estilo.maiusculas);

  const corPrimaria = corAss(estilo.destaque, 0); // já falado (no \kf, Primary = falado)
  const corSecundaria = corAss(estilo.cor, 0); // ainda não falado
  const corContorno = corAss(estilo.corContorno, 0);
  const corSombra = corAss(estilo.corContorno, 0x80); // BackColour = sombra a 50%

  const cs = (t) => centesimos(mapearTempo(t));
  const posX = Math.round(largura / 2);
  const posY = Math.round(estilo.posY * altura);

  const cabecalho = [
    '[Script Info]',
    '; Gerado pelo Clipes (protótipo do editor)',
    'ScriptType: v4.00+',
    `PlayResX: ${largura}`,
    `PlayResY: ${altura}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Clipes,${fonte},${tamanho},${corPrimaria},${corSecundaria},${corContorno},${corSombra},${negrito},0,0,0,100,100,0,0,1,${contorno},${sombra},5,${margem},${margem},0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const eventos = [];
  for (const grupo of grupos) {
    const palavras = grupo.palavras || [];
    if (palavras.length === 0) continue;
    const inicioGrupoCs = cs(grupo.start);

    let texto = `{\\pos(${posX},${posY})}`;
    // Espaço entre o início do grupo e a 1ª palavra: sílaba vazia que só avança o tempo.
    const primeiraCs = cs(palavras[0].start);
    if (primeiraCs > inicioGrupoCs) texto += `{\\k${primeiraCs - inicioGrupoCs}}`;

    palavras.forEach((palavra, i) => {
      const ultima = i === palavras.length - 1;
      const inicioCs = cs(palavra.start);
      const fimCs = ultima ? cs(palavra.end) : cs(palavras[i + 1].start);
      const duracao = Math.max(0, fimCs - inicioCs);
      const palavraTexto = maiusculas
        ? textoSeguro(String(palavra.text).toLocaleUpperCase('pt-BR'))
        : textoSeguro(palavra.text);
      texto += `{\\kf${duracao}}${palavraTexto}`;
      // O espaço fica numa sílaba de duração 0, para o varrido de \kf não incluir o espaço na palavra.
      if (!ultima) texto += '{\\kf0} ';
    });

    eventos.push(
      `Dialogue: 0,${tempoAss(mapearTempo(grupo.start))},${tempoAss(mapearTempo(grupo.end))},Clipes,,0,0,0,,${texto}`,
    );
  }

  return [...cabecalho, ...eventos, ''].join('\n');
}
