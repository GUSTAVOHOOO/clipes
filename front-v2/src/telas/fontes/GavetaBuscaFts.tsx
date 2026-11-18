import { AreaRolagem, BannerErroCore, Botao, Esqueleto, tcLongo } from '@ds'
import { Search, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'

export type TrechoSnippetFts = {
  text: string
  match: boolean
}

export type ResultadoBuscaFts = {
  transcript_id: number
  source_id: number
  source: string
  sentence_id: number
  start_us: number
  end_us: number
  row: number
  snippet: TrechoSnippetFts[]
}

export type GavetaBuscaFtsProps = {
  aberto: boolean
  termo: string
  carregando: boolean
  erro: ErroCore | null
  resultados: ResultadoBuscaFts[]
  projetoId: string
  aoFechar: () => void
  aoTentarNovamente: () => void
}

/** Painel/gaveta de resultados da busca global FTS5 nas Transcrições do Projeto. */
export function GavetaBuscaFts({
  aberto,
  termo,
  carregando,
  erro,
  resultados,
  projetoId,
  aoFechar,
  aoTentarNovamente,
}: GavetaBuscaFtsProps) {
  if (!aberto) return null

  const traducao = erro ? mensagemDeErro(erro) : null
  const encProjeto = encodeURIComponent(projetoId)

  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      aoFechar()
    }
  }

  return (
    <aside
      aria-label="Resultados da busca nas Transcrições"
      onKeyDown={aoTeclar}
      className="flex min-h-0 w-full shrink-0 flex-col gap-3 rounded-area bg-area p-3.5 lg:w-[380px]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Search className="size-[15px] stroke-[1.75] text-t3" aria-hidden />
          <h2 className="text-base font-forte text-t1">
            Busca nas Transcrições <span className="num text-t3">({resultados.length})</span>
          </h2>
        </div>
        <Botao
          variante="fantasma"
          tamanho="p"
          icone={<X />}
          aria-label="Fechar busca"
          onClick={aoFechar}
        >
          Fechar
        </Botao>
      </div>

      <p className="text-pequeno text-t3">
        Resultados para <strong className="font-medio text-t1">&ldquo;{termo}&rdquo;</strong> em todo
        o Projeto
      </p>

      {carregando ? (
        <Esqueleto variante="lista" quantidade={4} rotuloAcessivel="Buscando nas Transcrições" />
      ) : erro && traducao ? (
        <BannerErroCore
          erro={{ code: erro.code, message: erro.detalhe || erro.message }}
          traduzir={() => ({ titulo: traducao.titulo })}
          acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: aoTentarNovamente }}
          permitirRelato
        />
      ) : resultados.length === 0 ? (
        <p className="rounded-controle bg-elevado px-3 py-4 text-pequeno text-t2">
          Nenhum trecho encontrado para &ldquo;{termo}&rdquo;.
        </p>
      ) : (
        <AreaRolagem rotulo="Ocorrências encontradas" className="min-h-0 flex-1">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {resultados.map((hit, idx) => {
              const destino = `#/projeto/${encProjeto}/fontes/${hit.source_id}?frase=${hit.sentence_id}&row=${hit.row}`
              return (
                <li key={`${hit.source_id}-${hit.sentence_id}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.hash = destino
                    }}
                    className="foco flex w-full cursor-pointer flex-col gap-1 rounded-controle border-0 bg-elevado p-2.5 text-left transition-colors duration-(--dur-rapida) hover:bg-hover"
                  >
                    <div className="flex w-full items-baseline justify-between gap-2">
                      <span className="truncate text-pequeno font-medio text-t1">{hit.source}</span>
                      <span className="num shrink-0 text-micro text-t3">
                        {tcLongo(hit.start_us)} – {tcLongo(hit.end_us)}
                      </span>
                    </div>
                    <p className="text-pequeno leading-[1.45] text-t2">
                      {hit.snippet.map((parte, pIdx) =>
                        parte.match ? (
                          <mark
                            key={pIdx}
                            className="rounded-mini bg-sinal-suave px-0.5 font-medio text-t1"
                          >
                            {parte.text}
                          </mark>
                        ) : (
                          <span key={pIdx}>{parte.text}</span>
                        ),
                      )}
                    </p>
                    <span className="num text-micro text-t3">Abrir Frase #{hit.sentence_id}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </AreaRolagem>
      )}
    </aside>
  )
}
