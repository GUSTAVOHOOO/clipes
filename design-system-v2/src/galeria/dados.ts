// Dados de exemplo das telas de prova (os mesmos textos dos protótipos aprovados).
import type { DecisaoCorte } from '@/componentes/Linhas'
import type { EixoNota } from '@/componentes/Selos'

export const quadro1 = `${import.meta.env.BASE_URL}midia/quadro-1.jpg`
export const quadro2 = `${import.meta.env.BASE_URL}midia/quadro-2.jpg`

const s = (seg: number) => Math.round(seg * 1_000_000)

/* ---------- Editor ---------- */

export type ItemTranscricao =
  | { tipo: 'frase'; id: string; inicioUs: number; fimUs: number; texto: string; fora?: boolean }
  | { tipo: 'silencio'; id: string; inicioUs: number; fimUs: number; removido: boolean }

export const transcricao: ItemTranscricao[] = [
  { tipo: 'frase', id: 'f0', inicioUs: s(-4), fimUs: s(0), fora: true, texto: 'Em dois mil e dezoito ninguém achava que uma aba conseguiria ler memória de outra.' },
  { tipo: 'frase', id: 'f1', inicioUs: s(0), fimUs: s(6.1), texto: 'Todo mundo achava que o isolamento do navegador era impenetrável até aquela manhã.' },
  { tipo: 'frase', id: 'f2', inicioUs: s(6.1), fimUs: s(11.6), texto: 'O pesquisador abriu um site comum e percebeu que o cache vazava dados da sessão.' },
  { tipo: 'silencio', id: 's1', inicioUs: s(11.6), fimUs: s(12.8), removido: false },
  { tipo: 'frase', id: 'f3', inicioUs: s(12.8), fimUs: s(20.4), texto: 'e foi EXATAMENTE ali que tudo mudou para a arquitetura moderna da web.' },
  { tipo: 'silencio', id: 's2', inicioUs: s(20.4), fimUs: s(23.2), removido: true },
  { tipo: 'frase', id: 'f4', inicioUs: s(23.2), fimUs: s(29.5), texto: 'Os engenheiros tiveram que reescrever o processo de renderização em semanas.' },
  { tipo: 'silencio', id: 's3', inicioUs: s(29.5), fimUs: s(30.4), removido: false },
  { tipo: 'frase', id: 'f5', inicioUs: s(30.4), fimUs: s(34.9), texto: 'Cada guia ganhou sua própria caixa de areia sem acesso ao que as outras guardavam.' },
  { tipo: 'frase', id: 'f6', inicioUs: s(34.9), fimUs: s(38.4), texto: 'E é por isso que hoje o seu navegador usa tanta memória.' },
  { tipo: 'frase', id: 'f7', inicioUs: s(38.4), fimUs: s(43), fora: true, texto: 'Mas essa é uma história para o próximo vídeo do canal.' },
]

export const duracaoCorteUs = s(38.4)

/** onda fixa e determinística (sem Math.random, para captura estável) */
export const onda = Array.from({ length: 96 }, (_, i) => 0.35 + 0.5 * Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23)))

export const silenciosTimeline = transcricao.filter((t) => t.tipo === 'silencio').map((t) => ({ inicioUs: t.inicioUs, fimUs: t.fimUs, removido: t.removido }))

export const frasesTimeline = transcricao
  .filter((t): t is Extract<ItemTranscricao, { tipo: 'frase' }> => t.tipo === 'frase' && !t.fora)
  .map((t) => ({ inicioUs: t.inicioUs, fimUs: t.fimUs, texto: t.texto }))

export const historico = [
  { quando: 'agora', oque: 'Silêncio de 2,8 s removido' },
  { quando: 'há 2 min', oque: 'Legenda: estilo Karaokê' },
  { quando: 'há 4 min', oque: 'Enquadrar: Preencher, zoom 112%' },
  { quando: 'há 6 min', oque: 'Saída movida para 00:38,4' },
]

/* ---------- Bancada ---------- */

export type CorteSugerido = { id: string; titulo: string; inicioUs: number; duracaoUs: number; nota: number; decisao: DecisaoCorte }

const hms = (h: number, m: number, sec: number) => s(h * 3600 + m * 60 + sec)

export const cortesSugeridos: CorteSugerido[] = [
  { id: 'c1', titulo: 'A regra de ouro antes de aceitar qualquer sociedade', inicioUs: hms(0, 42, 18), duracaoUs: s(54), nota: 8.9, decisao: 'aprovado' },
  { id: 'c2', titulo: 'O erro de preço que quase quebrou a operação no Natal', inicioUs: hms(1, 22, 12), duracaoUs: s(45), nota: 8.6, decisao: 'aprovado' },
  { id: 'c3', titulo: 'Ele contou como perdeu tudo em 2019', inicioUs: hms(0, 12, 31), duracaoUs: s(48), nota: 8.4, decisao: 'pendente' },
  { id: 'c4', titulo: 'Por que reunião diária de uma hora mata a entrega', inicioUs: hms(1, 45, 20), duracaoUs: s(41), nota: 8.1, decisao: 'pendente' },
  { id: 'c5', titulo: 'Comentário rápido sobre a mudança de algoritmo', inicioUs: hms(2, 24, 45), duracaoUs: s(32), nota: 7.8, decisao: 'rejeitado' },
  { id: 'c6', titulo: 'Como ele respondeu quando o cliente pediu desconto de 40%', inicioUs: hms(0, 58, 10), duracaoUs: s(49), nota: 7.7, decisao: 'pendente' },
  { id: 'c7', titulo: 'A pergunta de entrevista que revela quem realmente fez o projeto', inicioUs: hms(1, 34, 4), duracaoUs: s(44), nota: 7.5, decisao: 'pendente' },
  { id: 'c8', titulo: 'O microfone barato que resolveu o eco do estúdio', inicioUs: hms(0, 28, 35), duracaoUs: s(37), nota: 7.2, decisao: 'pendente' },
  { id: 'c9', titulo: 'Bastidores da viagem que atrasou quatro horas no aeroporto', inicioUs: hms(2, 36, 50), duracaoUs: s(34), nota: 6.9, decisao: 'rejeitado' },
  { id: 'c10', titulo: 'Por que publicar menos vídeos melhorou a retenção do canal', inicioUs: hms(1, 59, 0), duracaoUs: s(46), nota: 6.6, decisao: 'pendente' },
  { id: 'c11', titulo: 'A diferença entre audiência fiel e pico de curiosidade', inicioUs: hms(1, 8, 40), duracaoUs: s(42), nota: 6.3, decisao: 'pendente' },
  { id: 'c12', titulo: 'O dia em que o servidor caiu no meio do lançamento', inicioUs: hms(2, 51, 12), duracaoUs: s(39), nota: 6.1, decisao: 'pendente' },
]

export const eixos: EixoNota[] = [
  { nome: 'Gancho', peso: 3, valor: 9.2, porque: 'abre com "perdi tudo em 2019"' },
  { nome: 'Arco completo', peso: 2, valor: 8.5, porque: 'começo, virada e lição no mesmo trecho' },
  { nome: 'Densidade', peso: 2, valor: 8.0, porque: 'poucos silêncios, fala contínua' },
  { nome: 'Autonomia', peso: 2, valor: 8.1, porque: 'entende-se sem o resto da live' },
  { nome: 'Emoção', peso: 1, valor: 7.6, porque: 'tom contido, sem pico de voz' },
]
