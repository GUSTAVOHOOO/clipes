import {
  Abas,
  BannerErroCore,
  ConfirmDialog,
  Esqueleto,
  EstadoTela,
  FaixaJob,
  Progresso,
  useToast,
  type Aba,
} from '@ds'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type { Fila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import {
  storeExportacaoProjeto,
  useExportacaoProjeto,
  type StoreExportacaoProjeto,
} from '~/stores/exportacaoProjeto'
import { HistoricoLotes } from '~/telas/exportacao/HistoricoLotes'
import { MesaProntidao } from '~/telas/exportacao/MesaProntidao'

export type ExportacaoProps = {
  projetoId: string
  projetoPath: string | null
  sub: 'prontidao' | 'lotes'
  store?: StoreExportacaoProjeto
  fila?: Fila
}

const SELETOR_FOCAVEL =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function focarRegiao(alvo: HTMLElement): void {
  const candidatos = alvo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)
  for (const el of candidatos) {
    if (el.closest('[hidden], [aria-hidden="true"]')) continue
    const estilo = window.getComputedStyle(el)
    if (estilo.display === 'none' || estilo.visibility === 'hidden') continue
    el.focus()
    return
  }
  alvo.focus()
}

/**
 * Macro-etapa 3: Exportação — Mesa de Prontidão, Exportação em Lote e Histórico de Lotes
 * (`#/projeto/:id/exportacao?sub=prontidao|lotes`).
 */
export function Exportacao({
  projetoId,
  projetoPath,
  sub,
  store = storeExportacaoProjeto,
  fila,
}: ExportacaoProps) {
  const toast = useToast()
  const forcado = useEstadoForcado()
  const exportacao = useExportacaoProjeto(projetoPath, { store, fila })

  const [loteSelecionadoId, setLoteSelecionadoId] = useState<number | null>(null)
  const [loteParaCancelarFaixa, setLoteParaCancelarFaixa] = useState<number | null>(null)
  const [cancelandoFaixa, setCancelandoFaixa] = useState(false)

  const subbarraRef = useRef<HTMLElement>(null)
  const zonaEsquerdaRef = useRef<HTMLDivElement>(null)
  const zonaDireitaRef = useRef<HTMLElement>(null)
  const regiaoFocoRef = useRef<{ prev: number; curr: number }>({ prev: -1, curr: -1 })

  const encProjeto = encodeURIComponent(projetoId)

  const lotesAtivos = useMemo(
    () => exportacao.lotes.filter((l) => l.state === 'running'),
    [exportacao.lotes],
  )
  const loteAtivoPrincipal = lotesAtivos[0] ?? null

  const irParaSub = useCallback(
    (proxima: 'prontidao' | 'lotes') => {
      window.location.hash = `#/projeto/${encProjeto}/exportacao?sub=${proxima}`
    },
    [encProjeto],
  )

  const aoAbrirLote = useCallback(
    (loteId: number) => {
      setLoteSelecionadoId(loteId)
      irParaSub('lotes')
    },
    [irParaSub],
  )

  const atalhos = useMemo<Atalho[]>(
    () => [
      {
        id: 'exportacao.prontidao',
        titulo: 'Ir para Prontidão e Lote',
        grupo: 'Exportação',
        executar: () => irParaSub('prontidao'),
      },
      {
        id: 'exportacao.lotes',
        titulo: 'Ir para Histórico de lotes',
        grupo: 'Exportação',
        executar: () => irParaSub('lotes'),
      },
    ],
    [irParaSub],
  )
  useAtalhos(atalhos)

  // Ciclo F6 / Shift+F6 entre as 5 regiões da tela (Topo -> Sub-barra -> Zona esq. -> Zona dir. -> Rodapé)
  useEffect(() => {
    const obterRegioes = (): HTMLElement[] => {
      const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')
      const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')
      return [
        topo,
        subbarraRef.current,
        zonaEsquerdaRef.current,
        zonaDireitaRef.current,
        rodape,
      ].filter((el): el is HTMLElement => el !== null)
    }

    const indiceDoElemento = (el: EventTarget | null, regioes: HTMLElement[]): number => {
      if (!(el instanceof Node)) return -1
      return regioes.findIndex((r) => r === el || r.contains(el))
    }

    const aoFocusIn = (e: FocusEvent) => {
      const regioes = obterRegioes()
      const idx = indiceDoElemento(e.target, regioes)
      if (idx >= 0) {
        regiaoFocoRef.current = { prev: regiaoFocoRef.current.curr, curr: idx }
      }
    }

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || e.ctrlKey || e.metaKey || e.altKey) return
      const temDialogoModal = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"]'))
      if (temDialogoModal) return

      const regioes = obterRegioes()
      if (regioes.length === 0) return

      const idxAtual = e.defaultPrevented
        ? regiaoFocoRef.current.prev
        : indiceDoElemento(document.activeElement, regioes)

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      const dir = e.shiftKey ? -1 : 1
      const proximoIdx =
        idxAtual < 0
          ? dir > 0
            ? 0
            : regioes.length - 1
          : (idxAtual + dir + regioes.length) % regioes.length

      focarRegiao(regioes[proximoIdx])
      regiaoFocoRef.current = { prev: proximoIdx, curr: proximoIdx }
    }

    document.addEventListener('focusin', aoFocusIn, true)
    window.addEventListener('keydown', aoTeclar, { capture: true })
    return () => {
      document.removeEventListener('focusin', aoFocusIn, true)
      window.removeEventListener('keydown', aoTeclar, { capture: true })
    }
  }, [])

  const estadoTela = useMemo<'carregando' | 'erro' | 'vazio' | 'pronto'>(() => {
    if (forcado === 'carregando') return 'carregando'
    if (forcado === 'erro') return 'erro'
    if (forcado === 'vazio') return 'vazio'
    if (exportacao.carregando) return 'carregando'
    if (exportacao.erro) return 'erro'
    if (sub === 'prontidao' && exportacao.aprovados.length === 0) return 'vazio'
    if (sub === 'lotes' && exportacao.lotes.length === 0) return 'vazio'
    return 'pronto'
  }, [exportacao.aprovados.length, exportacao.carregando, exportacao.erro, exportacao.lotes.length, forcado, sub])

  const erroExibido = useMemo(() => {
    if (exportacao.erro) return exportacao.erro
    if (forcado === 'erro') {
      return new ErroCore('component_missing', 'Simulação de erro via ?estado=erro.')
    }
    return null
  }, [exportacao.erro, forcado])

  const traducaoErro = erroExibido ? mensagemDeErro(erroExibido) : null

  const abasSub = useMemo<Aba<'prontidao' | 'lotes'>[]>(
    () => [
      { valor: 'prontidao', rotulo: `Prontidão e Lote (${exportacao.aprovados.length})` },
      {
        valor: 'lotes',
        rotulo:
          lotesAtivos.length > 0
            ? `Histórico de lotes (${lotesAtivos.length} ativo${lotesAtivos.length > 1 ? 's' : ''})`
            : `Histórico de lotes (${exportacao.lotes.length})`,
      },
    ],
    [exportacao.aprovados.length, exportacao.lotes.length, lotesAtivos.length],
  )

  const cancelarLoteDaFaixa = useCallback(async () => {
    if (loteParaCancelarFaixa === null || cancelandoFaixa) return
    setCancelandoFaixa(true)
    try {
      await chamar('export.batch.cancel', { id: loteParaCancelarFaixa })
      setLoteParaCancelarFaixa(null)
      toast.add({ title: `Lote #${loteParaCancelarFaixa} cancelado.` })
      await exportacao.recarregarLotes()
    } catch (err) {
      setLoteParaCancelarFaixa(null)
      const e = err instanceof ErroCore ? err : new ErroCore('export_failed', '')
      toast.add({ type: 'erro', title: mensagemDeErro(e).titulo })
    } finally {
      setCancelandoFaixa(false)
    }
  }, [cancelandoFaixa, exportacao, loteParaCancelarFaixa, toast])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Sub-barra da etapa (Região 2 do F6) */}
      <nav
        ref={subbarraRef}
        tabIndex={-1}
        aria-label="Visões de Exportação"
        className="foco-interno flex flex-wrap items-center justify-between gap-3 border-b border-linha pb-2.5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">Exportação</h1>
          <Abas
            rotulo="Visões de Exportação"
            valor={sub}
            aoMudar={irParaSub}
            abas={abasSub}
          />
        </div>
      </nav>

      {/* Faixa de lote ativo quando em Prontidão (mantém a Mesa interativa — estado job_running) */}
      {sub === 'prontidao' && loteAtivoPrincipal && estadoTela === 'pronto' && (
        <div className="flex flex-col gap-2">
          <FaixaJob
            rotulo={`Lote #${loteAtivoPrincipal.id}: exportando ${loteAtivoPrincipal.counts.completed}/${loteAtivoPrincipal.counts.total} (${Math.round(loteAtivoPrincipal.progress)}%)`}
            detalhe={
              <button
                type="button"
                onClick={() => aoAbrirLote(loteAtivoPrincipal.id)}
                className="foco cursor-pointer rounded-controle border-0 bg-transparent px-1.5 py-0.5 text-pequeno text-t1 underline hover:bg-hover"
              >
                Ver em Histórico
              </button>
            }
            aoCancelar={() => setLoteParaCancelarFaixa(loteAtivoPrincipal.id)}
          >
            <Progresso
              valor={loteAtivoPrincipal.progress}
              rotulo={`Progresso do lote #${loteAtivoPrincipal.id}`}
              compacto
            />
          </FaixaJob>
        </div>
      )}

      {estadoTela === 'carregando' && (
        sub === 'prontidao' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
            <div className="min-h-0 flex-1">
              <Esqueleto
                variante="cards"
                quantidade={6}
                rotuloAcessivel="Carregando Mesa de Prontidão"
              />
            </div>
            <div className="w-full shrink-0 rounded-area bg-area p-3 lg:w-[375px] min-[1440px]:w-[410px]">
              <Esqueleto
                variante="formulario"
                quantidade={4}
                rotuloAcessivel="Carregando configuração do lote"
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
            <div className="w-full shrink-0 rounded-area bg-area p-3 lg:w-[320px]">
              <Esqueleto
                variante="lista"
                quantidade={3}
                rotuloAcessivel="Carregando lista de lotes"
              />
            </div>
            <div className="min-h-0 flex-1 rounded-area bg-area p-3">
              <Esqueleto
                variante="lista"
                quantidade={4}
                rotuloAcessivel="Carregando itens do lote"
              />
            </div>
          </div>
        )
      )}

      {estadoTela === 'erro' && erroExibido && traducaoErro && (
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
                    const rec = traducaoErro.recuperacao!
                    if (rec.acao === 'ir-para-cortes') {
                      window.location.hash = `#/projeto/${encProjeto}/cortes`
                    } else if (rec.rota) {
                      window.location.hash = rec.rota
                    } else {
                      void exportacao.recarregar()
                    }
                  },
                }
              : {
                  rotulo: 'Tentar novamente',
                  aoAcionar: () => void exportacao.recarregar(),
                }
          }
          permitirRelato
        />
      )}

      {estadoTela === 'vazio' && sub === 'prontidao' && (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
          <EstadoTela
            tipo="vazio"
            titulo="Nenhum Corte aprovado para exportar"
            descricao="Aprove candidatos na etapa de Cortes para conferi-los aqui antes de renderizar em lote."
            acaoPrimaria={{
              rotulo: 'Ir para Cortes',
              aoAcionar: () => {
                window.location.hash = `#/projeto/${encProjeto}/cortes`
              },
            }}
          />
        </div>
      )}

      {estadoTela === 'vazio' && sub === 'lotes' && (
        <HistoricoLotes
          projetoId={projetoId}
          lotes={[]}
          loteSelecionadoId={null}
          aoSelecionarLote={setLoteSelecionadoId}
          aoVoltarProntidao={() => irParaSub('prontidao')}
          aoRecarregarLotes={exportacao.recarregarLotes}
          fila={fila}
          zonaEsquerdaRef={zonaEsquerdaRef}
          zonaDireitaRef={zonaDireitaRef}
        />
      )}

      {estadoTela === 'pronto' && sub === 'prontidao' && projetoPath && (
        <MesaProntidao
          projetoId={projetoId}
          projetoPath={projetoPath}
          exportacao={exportacao}
          aoAbrirLote={aoAbrirLote}
          zonaEsquerdaRef={zonaEsquerdaRef}
          zonaDireitaRef={zonaDireitaRef}
        />
      )}

      {estadoTela === 'pronto' && sub === 'lotes' && (
        <HistoricoLotes
          projetoId={projetoId}
          lotes={exportacao.lotes}
          loteSelecionadoId={loteSelecionadoId}
          aoSelecionarLote={setLoteSelecionadoId}
          aoVoltarProntidao={() => irParaSub('prontidao')}
          aoRecarregarLotes={exportacao.recarregarLotes}
          fila={fila}
          zonaEsquerdaRef={zonaEsquerdaRef}
          zonaDireitaRef={zonaDireitaRef}
        />
      )}

      <ConfirmDialog
        aberto={loteParaCancelarFaixa !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !cancelandoFaixa) setLoteParaCancelarFaixa(null)
        }}
        titulo={`Cancelar lote #${loteParaCancelarFaixa ?? ''}?`}
        descricao="Cancelar exportação do lote? Cortes já concluídos serão mantidos."
        rotuloConfirmar="Cancelar lote"
        rotuloCancelar="Cancelar"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={cancelandoFaixa}
        aoConfirmar={cancelarLoteDaFaixa}
      />
    </div>
  )
}
