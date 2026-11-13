// Dados reais do protótipo v2: Tears of Steel (Blender Foundation, CC-BY 3.0) repetido 10×, com Transcrição por palavra.
import bruto from './dados.json'

export type Eixo = { nome: string; valor: number; justificativa: string }
export type Palavra = { id: string; t: string; s: number; e: number; f: string }
export type Frase = { id: string; s: number; e: number; texto: string }
export type Corte = {
  id: string; titulo: string; inicio: number; fim: number; cx: number
  nota: { total: number; eixos: Eixo[]; resumo?: string }
  thumbs: string[]; wide: string; vert: string; peaks: number[]
  palavras: Palavra[]; frases: Frase[]
}
export const fonte = bruto.fonte as { nome: string; duracao: number; largura: number; altura: number; fps: number }
export const cortes = bruto.cortes as unknown as Corte[]

// As imagens são importadas pelo Vite para poderem ser embutidas no build de arquivo único.
const mapa = import.meta.glob('./img/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
/** URL de uma imagem: img('img/c1-wide.jpg'). */
export const img = (p: string) => mapa[`./${p}`] ?? p

/** 1:23:45, ou 0:41.2 com décimos */
export function tc(seg: number, decimos = false) {
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60
  const ss = decimos ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
export const duracao = (c: Corte) => c.fim - c.inicio

/** Fila de Fontes de mentira para as telas de importar. */
export const fila = [
  { nome: 'Live #212 · Reagindo a trailers', projeto: 'Canal de cortes', dur: 3 * 3600 + 12 * 60, estado: 'Transcrevendo', progresso: 0.42, img: 'img/fonte-0.jpg' },
  { nome: 'Podcast ep. 48 · convidada especial', projeto: 'Canal de cortes', dur: 2 * 3600 + 5 * 60, estado: 'Na fila', progresso: 0, img: 'img/fonte-1.jpg' },
  { nome: 'Tears of Steel ×10 (live de teste)', projeto: 'Canal dark · Ficção', dur: 7341, estado: 'Pronta · 4 Cortes', progresso: 1, img: 'img/fonte-2.jpg' },
  { nome: 'Gameplay maratona · parte 3', projeto: 'Canal de cortes', dur: 5 * 3600 + 40 * 60, estado: 'Selecionando Cortes', progresso: 0.8, img: 'img/fonte-3.jpg' },
]

/** Presets de legenda. */
export const presets = [
  { id: 'classico', nome: 'Clássico', fonte: 'Inter', cor: '#FFFFFF', destaque: '#FACC15', contorno: 6, pos: 0.72, palavras: 3 },
  { id: 'impacto', nome: 'Impacto', fonte: 'Geist', cor: '#FFFFFF', destaque: '#22D3EE', contorno: 8, pos: 0.6, palavras: 2 },
  { id: 'limpo', nome: 'Limpo', fonte: 'Inter', cor: '#F5F5F4', destaque: '#F5F5F4', contorno: 0, pos: 0.8, palavras: 5 },
  { id: 'caixa', nome: 'Caixa', fonte: 'Geist', cor: '#0A0A0A', destaque: '#0A0A0A', contorno: 0, pos: 0.75, palavras: 4 },
]
