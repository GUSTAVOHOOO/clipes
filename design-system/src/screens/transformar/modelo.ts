export type ModoNarracao = 'tts' | 'voz' | 'arquivo'
export type Transformacao = {
  roteiro: string
  revisado: boolean
  salvo: boolean
  modo: ModoNarracao
  voz: string
  modeloPronto: boolean
  ttsDemonstrado: boolean
  ducking: boolean
  reducao: number
  audio: { url: string; nome: string; origem: 'gravacao' | 'arquivo'; roteiro: string } | null
}

export const roteiroInicial = (titulo: string) =>
  `O que a cena “${titulo}” revela além do diálogo?\n\nA distância entre os personagens diz tanto quanto as palavras. Enquanto a conversa se intensifica, o enquadramento mantém os dois próximos: uma escolha que torna a ruptura ainda mais evidente.\n\nOlhe de novo para a reação de quem escuta. É ali que a cena muda de sentido.`

export const transformacaoInicial = (titulo: string): Transformacao => ({
  roteiro: roteiroInicial(titulo),
  revisado: false,
  salvo: false,
  modo: 'tts',
  voz: 'pf_dora',
  modeloPronto: false,
  ttsDemonstrado: false,
  ducking: true,
  reducao: -18,
  audio: null,
})
