// Dados de demonstração: Tears of Steel (Blender Foundation, CC-BY 3.0) repetido 10× como uma "live" de 2 h,
// com Transcrição por palavra, Frases, picos de áudio e a Nota de 5 eixos de cada Corte.
// Tudo o que é dado de produto mora aqui; as telas só leem.
import bruto from './dados.json'

export type Eixo = { nome: string; valor: number; justificativa: string }
export type Palavra = { id: string; t: string; s: number; e: number; f: string }
export type Frase = { id: string; s: number; e: number; texto: string }
export type Corte = {
  id: string
  titulo: string
  inicio: number
  fim: number
  /** centro horizontal sugerido do recorte 9:16 (0 a 1) */
  cx: number
  nota: { total: number; eixos: Eixo[]; resumo?: string }
  thumbs: string[]
  wide: string
  vert: string
  peaks: number[]
  palavras: Palavra[]
  frases: Frase[]
}
export type Fonte = { nome: string; duracao: number; largura: number; altura: number; fps: number }

export const fonte = bruto.fonte as Fonte
export const cortes = bruto.cortes as unknown as Corte[]
export const duracao = (c: Corte) => c.fim - c.inicio

// Imagens importadas pelo Vite (com hash no build).
const mapa = import.meta.glob('./img/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
/** URL de uma imagem dos dados: img('img/c1-wide.jpg'). */
export const img = (p: string) => mapa[`./${p}`] ?? p

/** Pesos fixos e visíveis dos 5 eixos da Nota (#19). */
export const PESOS: Record<string, number> = {
  Gancho: 0.3,
  Autossuficiência: 0.2,
  'Emoção/energia': 0.2,
  Valor: 0.15,
  Fechamento: 0.15,
}

/* ------------------------------------------------------------------ Projeto, Perfil de canal, fila */

export type PerfilCanal = {
  id: string
  nome: string
  tipo: 'Corte direto' | 'Vídeo transformado'
  idioma: 'PT-BR' | 'EN'
  legenda: string
  voz: string
  faixa: [number, number]
}
export const perfis: PerfilCanal[] = [
  { id: 'cortes', nome: 'Canal de cortes', tipo: 'Corte direto', idioma: 'PT-BR', legenda: 'classico', voz: '—', faixa: [20, 60] },
  { id: 'ficcao', nome: 'Canal dark · Ficção', tipo: 'Vídeo transformado', idioma: 'PT-BR', legenda: 'impacto', voz: 'Kokoro · pf_dora', faixa: [30, 75] },
]

export type Projeto = { id: string; nome: string; perfil: string; pasta: string; fontes: number; cortes: number }
export const projetos: Projeto[] = [
  { id: 'p1', nome: 'Canal dark · Ficção', perfil: 'ficcao', pasta: String.raw`D:\Clipes\Canal dark · Ficção`, fontes: 3, cortes: 4 },
  { id: 'p2', nome: 'Canal de cortes', perfil: 'cortes', pasta: String.raw`D:\Clipes\Canal de cortes`, fontes: 12, cortes: 87 },
]

export type EstadoFila = 'baixando' | 'transcrevendo' | 'selecionando' | 'na-fila' | 'pronta' | 'erro' | 'offline'
export type ItemFila = {
  id: string
  nome: string
  projeto: string
  dur: number
  estado: EstadoFila
  progresso: number
  img: string
  cortes?: number
  erro?: string
  /** segundos restantes estimados */
  resta?: number
}
export const fila: ItemFila[] = [
  { id: 'f1', nome: 'Live #212 · Reagindo a trailers', projeto: 'Canal de cortes', dur: 3 * 3600 + 12 * 60, estado: 'transcrevendo', progresso: 0.42, img: 'img/fonte-0.jpg', resta: 11 * 60 },
  { id: 'f2', nome: 'Podcast ep. 48 · convidada especial', projeto: 'Canal de cortes', dur: 2 * 3600 + 5 * 60, estado: 'na-fila', progresso: 0, img: 'img/fonte-1.jpg' },
  { id: 'f3', nome: 'Tears of Steel ×10 (live de teste)', projeto: 'Canal dark · Ficção', dur: 7341, estado: 'pronta', progresso: 1, img: 'img/fonte-2.jpg', cortes: 4 },
  { id: 'f4', nome: 'Gameplay maratona · parte 3', projeto: 'Canal de cortes', dur: 5 * 3600 + 40 * 60, estado: 'selecionando', progresso: 0.8, img: 'img/fonte-3.jpg', resta: 40 },
  { id: 'f5', nome: 'Live #209 · perguntas e respostas', projeto: 'Canal de cortes', dur: 2 * 3600 + 31 * 60, estado: 'erro', progresso: 0.12, img: 'img/fonte-4.jpg', erro: 'O yt-dlp não conseguiu baixar: o VOD é só para membros.' },
]

/* ------------------------------------------------------------------ legenda */

export type PresetLegenda = {
  id: string
  nome: string
  fonte: 'Inter' | 'Geist'
  cor: string
  destaque: string
  contorno: number
  pos: number
  palavras: number
}
/** Cores de legenda são conteúdo do vídeo (vão para o libass), por isso ficam em hex e fora dos tokens da UI. */
export const presets: PresetLegenda[] = [
  { id: 'classico', nome: 'Clássico', fonte: 'Inter', cor: '#FFFFFF', destaque: '#FACC15', contorno: 6, pos: 0.72, palavras: 3 },
  { id: 'impacto', nome: 'Impacto', fonte: 'Geist', cor: '#FFFFFF', destaque: '#22D3EE', contorno: 8, pos: 0.6, palavras: 2 },
  { id: 'limpo', nome: 'Limpo', fonte: 'Inter', cor: '#F5F5F4', destaque: '#F5F5F4', contorno: 0, pos: 0.8, palavras: 5 },
  { id: 'caixa', nome: 'Caixa', fonte: 'Geist', cor: '#0A0A0A', destaque: '#0A0A0A', contorno: 0, pos: 0.75, palavras: 4 },
]

export type Layout = 'rosto' | 'fit' | 'jogo' | 'duas' | 'cheia'
export const LAYOUTS: { id: Layout; nome: string }[] = [
  { id: 'rosto', nome: 'Rosto' },
  { id: 'fit', nome: 'Fit' },
  { id: 'jogo', nome: 'Jogo + webcam' },
  { id: 'duas', nome: 'Duas pessoas' },
  { id: 'cheia', nome: 'Tela cheia' },
]
