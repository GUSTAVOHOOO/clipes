import { AreaRolagem, Skeleton, Status, cn, useToast } from '@ds'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { ErroCore, chamar, paraErroCore } from '~/core/cliente'
import type { Fila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { useEmpacotarCorte, type CapaDoc, type EmpacotamentoDoc } from '~/stores/empacotarCorte'
import { parsearCorteId } from '~/stores/editorCorte'
import {
  storeFontesProjeto,
  useFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import type {
  DetalheExecucaoSelecao,
  ItemRevisaoSelecao,
  ResumoRunSelecao,
  RevisaoExecucaoSelecao,
} from '~/stores/selecaoProjeto'
import type { MetaCorteResolvida } from '~/telas/corte/EditarCorte'
import { EVENTO_CORTE_PRIMARIO_OCULTO } from '~/telas/corte/ContextoCorteConectado'
import { DialogoExportarCorte, type CorteParaExportar } from '~/telas/corte/DialogoExportarCorte'
import { ErroEmpacotar } from './ErroEmpacotar'
import { FichaEmpacotamento } from './FichaEmpacotamento'
import { PainelCapa } from './PainelCapa'

export type AcoesExternasEmpacotar = {
  abrirExportacao: () => void
}

export type EmpacotarCorteProps = {
  projetoId: string
  projetoPath: string | null
  corteId: string
  runId?: string
  storeFontes?: StoreFontesProjeto
  fila?: Fila
  aoAtualizarMeta?: (meta: MetaCorteResolvida) => void
  aoMudarStatusSalvamento?: (status: ReactNode) => void
  /** Permite ao `<ContextoCorteConectado>` abrir o diálogo de exportação desta tela. */
  acoesExternasRef?: MutableRefObject<AcoesExternasEmpacotar | null>
}

type CorteResolvido = {
  corteId: string
  candidateId: number
  sourceId: number
  runId: number
  startId: number
  endId: number
  startUs: number
  endUs: number
  titulo: string
  videoKind: 'direct' | 'transformed'
}

const SELETOR_FOCAVEL =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role="slider"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])'

function focarRegiao(alvo: HTMLElement): void {
  for (const el of alvo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)) {
    if (el.closest('[hidden], [aria-hidden="true"]')) continue
    const estilo = window.getComputedStyle(el)
    if (estilo.display === 'none' || estilo.visibility === 'hidden') continue
    el.focus()
    return
  }
  alvo.focus()
}

async function listarRunsDaFonte(sourceId: number): Promise<ResumoRunSelecao[]> {
  try {
    const lista = await chamar<ResumoRunSelecao[]>('selection.list', { source_id: sourceId })
    return Array.isArray(lista) ? lista : []
  } catch (err) {
    const erro = paraErroCore(err)
    if (erro.code === 'transcript_missing') return []
    throw erro
  }
}

function tituloDoItem(item: ItemRevisaoSelecao, execucao: DetalheExecucaoSelecao): string {
  const titulo = execucao.candidates.find((c) => c.id === item.candidate)?.title?.trim()
  if (titulo) return titulo
  const inicio = item.startText?.trim()
  return inicio || `Corte #${item.candidate}`
}

type Resolucao =
  | { tipo: 'ok'; corte: CorteResolvido }
  | { tipo: 'nao_aprovado' }
  | { tipo: 'ausente' }

async function resolverCorte(
  fontes: FonteProjeto[],
  candidateId: number,
  corteId: string,
  runId?: string,
): Promise<Resolucao> {
  const runNum = runId !== undefined && runId.trim() !== '' ? Number(runId) : NaN
  const temRun = Number.isInteger(runNum) && runNum > 0

  const montar = (
    sourceId: number,
    execucao: DetalheExecucaoSelecao,
    item: ItemRevisaoSelecao,
  ): Resolucao => {
    const comTipo = item as ItemRevisaoSelecao & { videoKind?: 'direct' | 'transformed' }
    return {
      tipo: 'ok',
      corte: {
        corteId,
        candidateId,
        sourceId,
        runId: execucao.run.id,
        startId: item.startId,
        endId: item.endId,
        startUs: item.startUs,
        endUs: item.endUs,
        titulo: tituloDoItem(item, execucao),
        videoKind:
          comTipo.videoKind ?? (execucao.run.videoKind === 'transformed' ? 'transformed' : 'direct'),
      },
    }
  }

  if (temRun) {
    const [execucao, revisao] = await Promise.all([
      chamar<DetalheExecucaoSelecao>('selection.get', { run: runNum }),
      chamar<RevisaoExecucaoSelecao>('selection.review', { run: runNum }),
    ])
    const item = revisao.items.find((it) => it.candidate === candidateId)
    if (!item) return { tipo: 'ausente' }
    if (item.status !== 'approved') return { tipo: 'nao_aprovado' }
    let sourceId =
      fontes.find((f) => f.available && f.status === 'available')?.id ?? fontes[0]?.id ?? 1
    for (const f of fontes) {
      const runs = await listarRunsDaFonte(f.id)
      if (runs.some((r) => r.id === runNum)) {
        sourceId = f.id
        break
      }
    }
    return montar(sourceId, execucao, item)
  }

  for (const f of fontes) {
    for (const r of await listarRunsDaFonte(f.id)) {
      const [execucao, revisao] = await Promise.all([
        chamar<DetalheExecucaoSelecao>('selection.get', { run: r.id }),
        chamar<RevisaoExecucaoSelecao>('selection.review', { run: r.id }),
      ])
      const item = revisao.items.find((it) => it.candidate === candidateId)
      if (!item) continue
      if (item.status !== 'approved') return { tipo: 'nao_aprovado' }
      return montar(f.id, execucao, item)
    }
  }
  return { tipo: 'ausente' }
}

function hashDoCorte(
  encProjeto: string,
  corteId: string,
  aba: 'editar' | 'transformar' | 'empacotar',
  runId?: string,
): string {
  const sufixo = runId && runId.trim() !== '' ? `?run=${encodeURIComponent(runId.trim())}` : ''
  return `#/projeto/${encProjeto}/corte/${encodeURIComponent(corteId)}/${aba}${sufixo}`
}

/**
 * Tela E.2 — Sub-aba `Empacotar` (`#/projeto/:id/corte/:corteId/empacotar`).
 * Duas colunas acopladas (Capa e Preview / Ficha e Guardrails), guardas de entrada, estados §6,
 * atalhos (`Ctrl+S`, `Ctrl+E`, transporte da capa) e ciclo `F6`.
 */
export function EmpacotarCorte({
  projetoId,
  projetoPath,
  corteId,
  runId,
  storeFontes = storeFontesProjeto,
  fila,
  aoAtualizarMeta,
  aoMudarStatusSalvamento,
  acoesExternasRef,
}: EmpacotarCorteProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const forcado = useEstadoForcado()
  const encProjeto = encodeURIComponent(projetoId)
  const identidade = useMemo(() => parsearCorteId(corteId), [corteId])

  const {
    fontes,
    projetoPath: projetoPathFontes,
    carregando: carregandoFontes,
    erro: erroFontes,
    recarregarFontes,
  } = useFontesProjeto(projetoPath, { store: storeFontes, fila })

  const [resolvendoEntrada, setResolvendoEntrada] = useState(true)
  const [erroResolucao, setErroResolucao] = useState<ErroCore | null>(null)
  const [corteResolvido, setCorteResolvido] = useState<CorteResolvido | null>(null)
  const [exportacaoAberta, setExportacaoAberta] = useState(false)
  const [modalCapaAberto, setModalCapaAberto] = useState(false)
  const [modalFichaAberto, setModalFichaAberto] = useState(false)
  const redirecionouRef = useRef<string | null>(null)
  const colunaCapaRef = useRef<HTMLElement>(null)
  const colunaFichaRef = useRef<HTMLElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const regiaoFocoRef = useRef<{ prev: number; curr: number }>({ prev: -1, curr: -1 })

  const redirecionarPara = useCallback((chave: string, hash: string, aviso: string) => {
    if (redirecionouRef.current === chave) return
    redirecionouRef.current = chave
    toastRef.current.add({ title: aviso })
    window.location.replace(hash)
  }, [])

  // Guarda de entrada + resolução de :corteId (avulso-* → /editar; ausente/não aprovado → /cortes)
  useEffect(() => {
    if (forcado === 'carregando' || forcado === 'erro') {
      setResolvendoEntrada(false)
      return
    }
    if (!identidade) {
      setResolvendoEntrada(false)
      setCorteResolvido(null)
      redirecionarPara(
        `invalido:${projetoId}:${corteId}`,
        `#/projeto/${encProjeto}/cortes`,
        'Este Corte não está disponível para Empacotar.',
      )
      return
    }
    if (identidade.kind === 'avulso') {
      setResolvendoEntrada(false)
      setCorteResolvido(null)
      redirecionarPara(
        `avulso:${projetoId}:${corteId}`,
        hashDoCorte(encProjeto, corteId, 'editar', runId),
        'Empacotar não está disponível para Corte avulso.',
      )
      return
    }
    if (!projetoPath || carregandoFontes || projetoPathFontes !== projetoPath) return
    if (erroFontes) {
      setResolvendoEntrada(false)
      setErroResolucao(erroFontes)
      return
    }

    let cancelado = false
    setResolvendoEntrada(true)
    setErroResolucao(null)
    void (async () => {
      try {
        const resultado = await resolverCorte(fontes, identidade.candidateId, corteId, runId)
        if (cancelado) return
        setResolvendoEntrada(false)
        if (resultado.tipo === 'ok') {
          setCorteResolvido(resultado.corte)
          return
        }
        setCorteResolvido(null)
        redirecionarPara(
          `${resultado.tipo}:${projetoId}:${corteId}`,
          `#/projeto/${encProjeto}/cortes`,
          'Este Corte não está disponível para Empacotar.',
        )
      } catch (err) {
        if (!cancelado) {
          setResolvendoEntrada(false)
          setErroResolucao(paraErroCore(err))
        }
      }
    })()
    return () => {
      cancelado = true
    }
  }, [
    carregandoFontes,
    corteId,
    encProjeto,
    erroFontes,
    fontes,
    forcado,
    identidade,
    projetoId,
    projetoPath,
    projetoPathFontes,
    redirecionarPara,
    runId,
  ])

  const fonteAtual = useMemo(
    () => (corteResolvido ? (fontes.find((f) => f.id === corteResolvido.sourceId) ?? null) : null),
    [corteResolvido, fontes],
  )
  const fonteDisponivel =
    forcado !== 'offline' &&
    (forcado === 'vazio' ||
      (fonteAtual ? Boolean(fonteAtual.available && fonteAtual.status === 'available') : true))

  const candidateIdAtivo =
    forcado === 'carregando' || forcado === 'erro' ? null : (corteResolvido?.candidateId ?? null)

  const store = useEmpacotarCorte(
    candidateIdAtivo,
    corteResolvido
      ? {
          id: corteResolvido.sourceId,
          disponivel: fonteDisponivel,
          startUs: corteResolvido.startUs,
          endUs: corteResolvido.endUs,
        }
      : null,
    fila,
  )

  // `?estado=vazio` força capa e ficha vazias sem mexer no núcleo.
  const storeParaTela = useMemo(() => {
    if (forcado !== 'vazio') return store
    return {
      ...store,
      carregando: false,
      erro: null,
      capa: {
        ...(store.capa ?? { history: [], job: null }),
        current: null,
        suggestions: [],
        choices: [],
        job: null,
      } as unknown as CapaDoc,
      empacotamento: store.empacotamento
        ? ({ ...store.empacotamento, current: null, job: null } as EmpacotamentoDoc)
        : store.empacotamento,
    }
  }, [forcado, store])

  useEffect(() => {
    aoAtualizarMeta?.({
      clipId: undefined,
      fonte: fonteAtual,
      videoKind: corteResolvido?.videoKind ?? 'direct',
    })
  }, [aoAtualizarMeta, corteResolvido?.videoKind, fonteAtual])

  useEffect(() => {
    if (!aoMudarStatusSalvamento) return
    aoMudarStatusSalvamento(
      <Status tom={store.sujo ? 'pendente' : 'info'}>
        Empacotar · {store.sujo ? 'Alterações não salvas' : 'Salvo'}
      </Status>,
    )
  }, [aoMudarStatusSalvamento, store.sujo])

  const desabilitarContextoRef = useRef(false)
  const abrirExportacao = useCallback(() => {
    if (desabilitarContextoRef.current) return
    setExportacaoAberta(true)
  }, [])

  useEffect(() => {
    if (!acoesExternasRef) return
    acoesExternasRef.current = { abrirExportacao }
    return () => {
      acoesExternasRef.current = null
    }
  }, [abrirExportacao, acoesExternasRef])

  const atalhosTela = useMemo<Atalho[]>(
    () => [
      {
        id: 'corte.exportar',
        titulo: 'Exportar Corte atual',
        grupo: 'Corte',
        tecla: 'Mod+E',
        executar: abrirExportacao,
      },
      {
        id: 'empacotar.exportarVideo',
        titulo: 'Exportar vídeo MP4',
        grupo: 'Empacotar',
        executar: abrirExportacao,
      },
    ],
    [abrirExportacao],
  )
  useAtalhos(atalhosTela)

  // Ciclo F6 / Shift+F6: Topo → Contexto → Coluna Capa → Coluna Ficha → Fila (se aberta) → Barra de Status
  useEffect(() => {
    const obterRegioes = (): HTMLElement[] => {
      const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')
      const contexto = document.querySelector<HTMLElement>('[data-regiao="contexto"]')
      const filaRegiao = document.querySelector<HTMLElement>('[data-regiao="fila"]')
      const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')
      return [topo, contexto, colunaCapaRef.current, colunaFichaRef.current, filaRegiao, rodape].filter(
        (el): el is HTMLElement => el !== null,
      )
    }
    const indiceDoElemento = (el: EventTarget | null, regioes: HTMLElement[]): number => {
      if (!(el instanceof Node)) return -1
      return regioes.findIndex((r) => r === el || r.contains(el))
    }
    const aoFocusIn = (e: FocusEvent) => {
      const idx = indiceDoElemento(e.target, obterRegioes())
      regiaoFocoRef.current = { prev: regiaoFocoRef.current.curr, curr: idx }
    }
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || e.ctrlKey || e.metaKey || e.altKey) return
      const temDialogo = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"], [data-nao-modal]'))
      if (temDialogo) return
      const regioes = obterRegioes()
      if (regioes.length === 0) return
      const idxAtual = indiceDoElemento(document.activeElement, regioes)
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const dir = e.shiftKey ? -1 : 1
      const proximo =
        idxAtual < 0
          ? dir > 0
            ? 0
            : regioes.length - 1
          : (idxAtual + dir + regioes.length) % regioes.length
      focarRegiao(regioes[proximo])
      regiaoFocoRef.current = { prev: proximo, curr: proximo }
    }
    document.addEventListener('focusin', aoFocusIn, true)
    window.addEventListener('keydown', aoTeclar, { capture: true })
    return () => {
      document.removeEventListener('focusin', aoFocusIn, true)
      window.removeEventListener('keydown', aoTeclar, { capture: true })
    }
  }, [])

  const irParaFonte = useCallback(() => {
    const id = corteResolvido?.sourceId ?? fonteAtual?.id
    window.location.hash = id
      ? `#/projeto/${encProjeto}/fontes/${id}`
      : `#/projeto/${encProjeto}/fontes`
  }, [corteResolvido?.sourceId, encProjeto, fonteAtual?.id])

  const corteParaExportar: CorteParaExportar | null = corteResolvido
    ? {
        corteId: corteResolvido.corteId,
        titulo: corteResolvido.titulo,
        videoKind: corteResolvido.videoKind,
        sourceId: corteResolvido.sourceId,
        startId: corteResolvido.startId,
        endId: corteResolvido.endId,
        candidateId: corteResolvido.candidateId,
      }
    : null

  const erroTela =
    forcado === 'erro'
      ? new ErroCore('project_write', 'Erro simulado via ?estado=erro.')
      : (erroResolucao ?? (forcado === 'vazio' ? null : store.erro))

  const carregandoTela =
    forcado === 'carregando' ||
    (forcado !== 'vazio' &&
      (resolvendoEntrada ||
        store.carregando ||
        store.candidateId !== candidateIdAtivo ||
        !store.empacotamento)) ||
    (forcado === 'vazio' && (resolvendoEntrada || !corteResolvido))

  const empacotamentoVazio = forcado === 'vazio' || storeParaTela.empacotamento?.current === null
  const desabilitarContexto =
    empacotamentoVazio || Boolean(erroTela) || carregandoTela || !fonteDisponivel
  desabilitarContextoRef.current = desabilitarContexto
  const ocultarPrimarioContexto =
    desabilitarContexto || exportacaoAberta || modalCapaAberto || modalFichaAberto

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(EVENTO_CORTE_PRIMARIO_OCULTO, {
        detail: { ocultar: ocultarPrimarioContexto, desabilitar: desabilitarContexto },
      }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent(EVENTO_CORTE_PRIMARIO_OCULTO, {
          detail: { ocultar: false, desabilitar: false },
        }),
      )
    }
  }, [desabilitarContexto, ocultarPrimarioContexto])

  if (erroTela) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[68ch]">
          <ErroEmpacotar
            erro={erroTela}
            acoes={{
              relocalizarFonte: irParaFonte,
              recarregar: () => {
                void recarregarFontes()
                if (candidateIdAtivo != null) void store.recarregarEmpacotamento(candidateIdAtivo)
              },
              irPara: (hash) => {
                window.location.hash = hash
              },
            }}
          />
        </div>
      </div>
    )
  }

  if (carregandoTela) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Carregando Empacotamento do Corte"
        className="flex min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex w-[42%] flex-col gap-3 border-r border-linha p-4">
          <Skeleton className="aspect-video w-full max-w-[420px]" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div className="mx-auto flex w-full max-w-[68ch] flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    )
  }

  const candidateId = corteResolvido?.candidateId ?? 0
  const startUs = corteResolvido?.startUs
  const endUs = corteResolvido?.endUs
  const duracaoCorteUs =
    startUs !== undefined && endUs !== undefined && endUs > startUs ? endUs - startUs : null

  return (
    <div ref={containerRef} data-f6-proprio="" className="flex min-h-0 flex-1 overflow-hidden">
      <aside
        ref={colunaCapaRef}
        data-regiao="empacotar-capa"
        tabIndex={-1}
        aria-label="Capa e preview"
        className={cn(
          'foco-interno flex min-h-0 w-[42%] shrink-0 flex-col border-r border-linha',
          'min-[1440px]:w-[40%]',
        )}
      >
        <AreaRolagem rotulo="Capa e preview do Corte" className="min-h-0 flex-1">
          <PainelCapa
            candidateId={candidateId}
            corteId={corteId}
            store={storeParaTela}
            fonte={{
              id: corteResolvido?.sourceId ?? 0,
              disponivel: fonteDisponivel,
              startUs,
              endUs,
            }}
            aoRelocalizarFonte={irParaFonte}
            aoMudarModalAberto={setModalCapaAberto}
          />
        </AreaRolagem>
      </aside>

      <section
        ref={colunaFichaRef}
        data-regiao="empacotar-ficha"
        tabIndex={-1}
        aria-label="Ficha de Empacotamento e Guardrails"
        className="foco-interno flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <AreaRolagem rotulo="Ficha de Empacotamento e Guardrails" className="min-h-0 flex-1">
          <FichaEmpacotamento
            projetoId={projetoId}
            corteId={corteId}
            fonteId={corteResolvido?.sourceId ?? null}
            fonteDisponivel={fonteDisponivel}
            duracaoCorteUs={duracaoCorteUs}
            modalPaiAberto={exportacaoAberta || modalCapaAberto}
            aoMudarModalAberto={setModalFichaAberto}
            store={storeParaTela}
            aoAbrirExportacao={abrirExportacao}
            aoIrParaFonte={irParaFonte}
            aoIrParaTransformar={() => {
              window.location.hash = hashDoCorte(encProjeto, corteId, 'transformar', runId)
            }}
            aoIrParaMesaExportacao={() => {
              window.location.hash = `#/projeto/${encProjeto}/exportacao`
            }}
          />
        </AreaRolagem>
      </section>

      <DialogoExportarCorte
        aberto={exportacaoAberta}
        aoFechar={() => setExportacaoAberta(false)}
        projetoId={projetoId}
        corte={corteParaExportar}
        fonte={fonteAtual}
        candidateId={corteResolvido?.candidateId ?? null}
        startId={corteResolvido?.startId}
        endId={corteResolvido?.endId}
        aoIrParaTranscricao={() => {
          window.location.hash = hashDoCorte(encProjeto, corteId, 'editar', runId)
        }}
        aoFonteRelocalizada={() => void recarregarFontes()}
        fila={fila}
      />
    </div>
  )
}
