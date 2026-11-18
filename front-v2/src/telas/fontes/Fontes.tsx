import { Abas, BannerErroCore, Busca, Esqueleto, EstadoTela, type Aba } from '@ds'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { formatarTecla, useAtalhos, type Atalho } from '~/comandos/atalhos'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import {
  storeFontesProjeto,
  useFontesProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import { EntradaFonte, type ModoEntradaFonte } from '~/telas/fontes/EntradaFonte'
import { GavetaBuscaFts, type ResultadoBuscaFts } from '~/telas/fontes/GavetaBuscaFts'
import { ListaFontes } from '~/telas/fontes/ListaFontes'
import { LotesFontes } from '~/telas/fontes/LotesFontes'

export type FontesProps = {
  projetoId: string
  projetoPath: string | null
  sub: 'fontes' | 'lotes'
  store?: StoreFontesProjeto
}

function normalizarErro(err: unknown): ErroCore {
  if (err instanceof ErroCore) return err
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code?: unknown; message?: unknown }
    return new ErroCore(
      typeof e.code === 'string' && e.code ? e.code : 'desconhecido',
      typeof e.message === 'string' ? e.message : '',
    )
  }
  return new ErroCore('desconhecido', err instanceof Error ? err.message : String(err ?? ''))
}

/** Tela principal da Macro-etapa 1: Lista e Entrada de Fontes, Busca FTS5 e sub-aba Lotes (`#/projeto/:id/fontes`). */
export function Fontes({
  projetoId,
  projetoPath,
  sub,
  store = storeFontesProjeto,
}: FontesProps) {
  const forcado = useEstadoForcado()
  const {
    fontes,
    carregando,
    erro,
    transcriptStatusBySource,
    lotes,
    selecionadasParaLote,
    copiaEmAndamento,
    invalidacoes,
    recarregarFontes,
    recarregarFonte,
    definirSelecionadasParaLote,
    definirCopiaEmAndamento,
  } = useFontesProjeto(projetoPath, { store })

  const [modoEntrada, setModoEntrada] = useState<ModoEntradaFonte>('local')
  const inputLocalRef = useRef<HTMLInputElement>(null)
  const buscaGlobalRef = useRef<HTMLInputElement>(null)

  const [termoBusca, setTermoBusca] = useState('')
  const [termoPesquisado, setTermoPesquisado] = useState('')
  const [gavetaAberta, setGavetaAberta] = useState(false)
  const [buscandoFts, setBuscandoFts] = useState(false)
  const [erroFts, setErroFts] = useState<ErroCore | null>(null)
  const [resultadosFts, setResultadosFts] = useState<ResultadoBuscaFts[]>([])
  const seqBuscaRef = useRef(0)

  const encProjeto = encodeURIComponent(projetoId)

  const executarBuscaFts = useCallback(async (queryBruta: string) => {
    const q = queryBruta.trim()
    if (!q) {
      setGavetaAberta(false)
      setResultadosFts([])
      setErroFts(null)
      return
    }
    const seq = ++seqBuscaRef.current
    setTermoPesquisado(q)
    setGavetaAberta(true)
    setBuscandoFts(true)
    setErroFts(null)
    try {
      const hits = await chamar<ResultadoBuscaFts[]>('transcription.search', {
        query: q,
        limit: 50,
      })
      if (seq !== seqBuscaRef.current) return
      setResultadosFts(Array.isArray(hits) ? hits : [])
    } catch (err) {
      if (seq !== seqBuscaRef.current) return
      setErroFts(normalizarErro(err))
      setResultadosFts([])
    } finally {
      if (seq === seqBuscaRef.current) {
        setBuscandoFts(false)
      }
    }
  }, [])

  useEffect(() => {
    const q = termoBusca.trim()
    if (!q) {
      setGavetaAberta(false)
      setResultadosFts([])
      setErroFts(null)
      return
    }
    const timer = window.setTimeout(() => {
      void executarBuscaFts(q)
    }, 220)
    return () => window.clearTimeout(timer)
  }, [executarBuscaFts, termoBusca])

  const focarEntradaLocal = useCallback(() => {
    setModoEntrada('local')
    requestAnimationFrame(() => inputLocalRef.current?.focus())
  }, [])

  const atalhos = useMemo<Atalho[]>(
    () => [
      {
        id: 'busca.focar',
        titulo: 'Buscar nas Transcrições',
        grupo: 'Fontes',
        tecla: 'Mod+F',
        executar: () => {
          buscaGlobalRef.current?.focus()
          buscaGlobalRef.current?.select()
        },
      },
      {
        id: 'fontes.importarLocal',
        titulo: 'Importar arquivo local',
        grupo: 'Fontes',
        executar: () => {
          if (sub !== 'fontes') {
            window.location.hash = `#/projeto/${encProjeto}/fontes`
          }
          focarEntradaLocal()
        },
      },
      {
        id: 'fontes.baixarUrl',
        titulo: 'Baixar Fonte por URL',
        grupo: 'Fontes',
        executar: () => {
          if (sub !== 'fontes') {
            window.location.hash = `#/projeto/${encProjeto}/fontes`
          }
          setModoEntrada('url')
        },
      },
      {
        id: 'fontes.lotes',
        titulo: 'Ir para Lotes de Fontes',
        grupo: 'Fontes',
        executar: () => {
          window.location.hash = `#/projeto/${encProjeto}/fontes?sub=lotes`
        },
      },
    ],
    [encProjeto, focarEntradaLocal, sub],
  )

  useAtalhos(atalhos)

  const abasSubnav = useMemo<Aba<'fontes' | 'lotes'>[]>(
    () => [
      { valor: 'fontes', rotulo: `Fontes (${fontes.length})` },
      { valor: 'lotes', rotulo: `Lotes de Fontes (${lotes.length})` },
    ],
    [fontes.length, lotes.length],
  )

  const aoSubmeterBusca = (e: FormEvent) => {
    e.preventDefault()
    void executarBuscaFts(termoBusca)
  }

  const estadoDireita = useMemo<'carregando' | 'vazio' | 'erro' | 'pronto'>(() => {
    if (forcado === 'carregando') return 'carregando'
    if (forcado === 'vazio') return 'vazio'
    if (forcado === 'erro') return 'erro'
    if (carregando) return 'carregando'
    if (erro) return 'erro'
    if (fontes.length === 0) return 'vazio'
    return 'pronto'
  }, [carregando, erro, fontes.length, forcado])

  const erroExibido = useMemo(() => {
    if (erro) return erro
    if (forcado === 'erro') {
      return new ErroCore('project_not_open', 'Simulação de erro via ?estado=erro.')
    }
    return null
  }, [erro, forcado])

  const traducaoErro = erroExibido ? mensagemDeErro(erroExibido) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Subnavegação + Busca Global FTS5 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha pb-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">
            Fontes e Transcrição
          </h1>
          <Abas
            rotulo="Subnavegação de Fontes"
            valor={sub}
            aoMudar={(proxima) => {
              window.location.hash =
                proxima === 'lotes'
                  ? `#/projeto/${encProjeto}/fontes?sub=lotes`
                  : `#/projeto/${encProjeto}/fontes`
            }}
            abas={abasSubnav}
          />
        </div>

        <form onSubmit={aoSubmeterBusca} className="w-full sm:w-96 lg:w-[430px]">
          <Busca
            ref={buscaGlobalRef}
            rotulo="Buscar falas em todas as Transcrições do Projeto"
            placeholder="Buscar falas em todas as Transcrições do Projeto…"
            atalho={formatarTecla('Mod+F')}
            value={termoBusca}
            onChange={(e) => setTermoBusca(e.target.value)}
            className="[&_input]:pr-14"
          />
        </form>
      </div>

      {sub === 'lotes' ? (
        <LotesFontes
          projetoId={projetoId}
          projetoPath={projetoPath}
          store={store}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
          {projetoPath && (
            <div className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto lg:w-[40%] lg:max-w-[520px]">
              <EntradaFonte
                projetoPath={projetoPath}
                copiaEmAndamento={copiaEmAndamento}
                aoImportar={async () => {
                  await recarregarFontes()
                }}
                aoMudarCopiaAtiva={definirCopiaEmAndamento}
                refPrimeiroControle={inputLocalRef}
                modo={modoEntrada}
                aoMudarModo={setModoEntrada}
              />
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {estadoDireita === 'carregando' && (
              <div className="rounded-area bg-area p-3">
                <Esqueleto
                  variante="lista"
                  quantidade={4}
                  rotuloAcessivel="Carregando Fontes do Projeto"
                />
              </div>
            )}

            {estadoDireita === 'erro' && erroExibido && traducaoErro && (
              <BannerErroCore
                erro={{
                  code: erroExibido.code,
                  message: erroExibido.detalhe || erroExibido.message,
                }}
                traduzir={() => ({ titulo: traducaoErro.titulo })}
                acaoRecuperacao={
                  traducaoErro.recuperacao
                    ? {
                        rotulo: traducaoErro.recuperacao.rotulo,
                        aoAcionar: () => {
                          if (traducaoErro.recuperacao?.rota) {
                            window.location.hash = traducaoErro.recuperacao.rota
                          } else {
                            void recarregarFontes()
                          }
                        },
                      }
                    : { rotulo: 'Tentar novamente', aoAcionar: () => void recarregarFontes() }
                }
                permitirRelato
              />
            )}

            {estadoDireita === 'vazio' && (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
                <EstadoTela
                  tipo="vazio"
                  titulo="Nenhuma Fonte importada ainda"
                  descricao="Importe um arquivo de vídeo do seu computador ou baixe uma live gravada (VOD) por URL para começar a transcrever."
                  acaoPrimaria={{
                    rotulo: 'Importar primeira Fonte',
                    aoAcionar: focarEntradaLocal,
                  }}
                />
              </div>
            )}

            {estadoDireita === 'pronto' && projetoPath && (
              <ListaFontes
                projetoId={projetoId}
                projetoPath={projetoPath}
                fontes={fontes}
                transcriptStatusBySource={transcriptStatusBySource}
                selecionadasParaLote={selecionadasParaLote}
                invalidacoes={invalidacoes}
                forcadoParcial={forcado === 'parcial'}
                aoMudarSelecionadas={definirSelecionadasParaLote}
                aoIrParaLote={() => {
                  window.location.hash = `#/projeto/${encProjeto}/fontes?sub=lotes`
                }}
                aoAtualizarFonte={recarregarFonte}
                aoAtualizarTodas={async () => {
                  await recarregarFontes()
                }}
              />
            )}
          </div>

          <GavetaBuscaFts
            aberto={gavetaAberta}
            termo={termoPesquisado}
            carregando={buscandoFts}
            erro={erroFts}
            resultados={resultadosFts}
            projetoId={projetoId}
            aoFechar={() => {
              setGavetaAberta(false)
              buscaGlobalRef.current?.focus()
            }}
            aoTentarNovamente={() => void executarBuscaFts(termoPesquisado)}
          />
        </div>
      )}
    </div>
  )
}
