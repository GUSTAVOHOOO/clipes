import {
  BannerErroCore,
  Botao,
  ConfirmDialog,
  Dialogo,
  Esqueleto,
  EstadoTela,
  Status,
  useToast,
  type AcaoBarra,
} from '@ds'
import { AudioLines, Crop, History, Type, Volume2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import {
  limparErroSalvamentoEditor,
  useFila,
  useSalvamentoEditor,
  type Fila,
} from '~/core/progresso'
import { usePreferencias } from '~/preferencias/preferencias'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { EVENTO_CANDIDATO_KIND_ALTERADO } from '~/telas/corte/ContextoCorteConectado'
import {
  nextRate,
  parsearCorteId,
  splicedToSourceUs,
  sourceToSplicedUs,
  useEditorCorte,
  type EditorDocumento,
  type StoreEditorCorte,
} from '~/stores/editorCorte'
import {
  storeFontesProjeto,
  useFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import type {
  DetalheExecucaoSelecao,
  ResumoRunSelecao,
  RevisaoExecucaoSelecao,
} from '~/stores/selecaoProjeto'
import { PainelEsquerdoCorte } from '~/telas/corte/PainelEsquerdoCorte'
import {
  PalcoEditor,
  type OverlayBorda,
  type PainelCropAtivo,
  type SessaoEditorCorte,
} from '~/telas/corte/PalcoEditor'
import { TimelineCorte } from '~/telas/corte/TimelineCorte'
import { PopoverAudio } from '~/telas/corte/popovers/PopoverAudio'
import { PopoverEnquadrar } from '~/telas/corte/popovers/PopoverEnquadrar'
import { PopoverHistorico } from '~/telas/corte/popovers/PopoverHistorico'
import { PopoverLegenda } from '~/telas/corte/popovers/PopoverLegenda'
import { PopoverSilencios } from '~/telas/corte/popovers/PopoverSilencios'

export type AcoesExternasEditarCorte = {
  irParaTranscricaoPalavra: (posicao?: number) => void
  abrirAbaAudio: () => void
}

export type MetaCorteResolvida = {
  clipId?: number
  fonte: FonteProjeto | null
  videoKind: 'direct' | 'transformed'
}

export type EditarCorteProps = {
  projetoId: string
  projetoPath: string | null
  corteId: string
  runId?: string
  storeFontes?: StoreFontesProjeto
  storeEditor?: StoreEditorCorte
  fila?: Fila
  aoRegistrarGuardaSaida?: (guarda: () => Promise<boolean>) => void
  aoAtualizarMeta?: (meta: MetaCorteResolvida) => void
  aoMudarStatusSalvamento?: (status: ReactNode) => void
  acoesExternasRef?: MutableRefObject<AcoesExternasEditarCorte | null>
}

type CorteResolvido = {
  corteId: string
  sourceId: number
  startId: number
  endId: number
  candidateId?: number
  videoKind: 'direct' | 'transformed'
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

function emCampoDeTexto(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false
  if (
    el.closest(
      'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]),textarea,select,[role="textbox"]',
    )
  ) {
    return true
  }
  const editable = el.closest('[contenteditable]')
  return !!editable && editable.getAttribute('contenteditable') !== 'false'
}

async function listarRunsDaFonte(sourceId: number): Promise<ResumoRunSelecao[]> {
  try {
    const lista = await chamar<ResumoRunSelecao[]>('selection.list', { source_id: sourceId })
    return Array.isArray(lista) ? lista : []
  } catch (err) {
    const coreErr = paraErroCore(err)
    if (coreErr.code === 'transcript_missing') return []
    throw coreErr
  }
}

function useSessaoEditorControlada(
  projetoPath: string | null,
  corteId: string | null,
  fonteDisponivel: boolean,
  fila?: Fila,
  storeInjetada?: StoreEditorCorte,
): SessaoEditorCorte {
  const hookPadrao = useEditorCorte(
    storeInjetada ? null : projetoPath,
    storeInjetada ? null : corteId,
    storeInjetada ? undefined : { fonteDisponivel, fila },
  )
  const storeAtiva = storeInjetada ?? hookPadrao.store
  const jobs = useFila(fila)
  const salvamento = useSalvamentoEditor(fila)

  useEffect(() => {
    if (!storeInjetada) return
    storeInjetada.definirProjeto(projetoPath)
  }, [storeInjetada, projetoPath])

  useEffect(() => {
    if (!storeInjetada) return
    storeInjetada.definirCorte(corteId)
  }, [storeInjetada, corteId])

  useEffect(() => {
    if (!storeInjetada) return
    storeInjetada.definirFonteDisponivel(fonteDisponivel)
  }, [storeInjetada, fonteDisponivel])

  useEffect(() => {
    if (!storeInjetada || !projetoPath) return
    void storeInjetada.sincronizarJobs(jobs)
  }, [storeInjetada, projetoPath, jobs])

  useEffect(() => {
    if (!storeInjetada) return
    storeInjetada.sincronizarSalvamento(salvamento)
  }, [storeInjetada, salvamento])

  const estadoVivo = useSyncExternalStore(
    storeAtiva.assinar,
    storeAtiva.obterSnapshot,
    storeAtiva.obterSnapshot,
  )

  return useMemo(() => {
    if (!storeInjetada) return hookPadrao
    return {
      ...estadoVivo,
      documentoAtivo: estadoVivo.previaLocal ?? estadoVivo.oficial,
      store: storeAtiva,
      abrir: (args) => storeAtiva.abrir(args),
      salvarAgora: () => storeAtiva.salvarAgora(),
      garantirSalvoParaSaida: () => storeAtiva.garantirSalvoParaSaida(),
    }
  }, [estadoVivo, hookPadrao, storeAtiva, storeInjetada])
}

/**
 * Tela D.2 — Sub-aba `Editar` (`#/projeto/:id/corte/:corteId/editar`).
 * Orquestra Painel Esquerdo recolhível (`Ctrl+[`), Palco 9:16/16:9 + 5 popovers (`Ctrl+]`),
 * Timeline compacta (`+3 faixas`), guarda de entrada, guarda de saída `editor.flush` (3 ações),
 * atalhos WCAG 2.1.4 e ciclo `F6`/`Shift+F6`.
 */
export function EditarCorte({
  projetoId,
  projetoPath,
  corteId,
  runId,
  storeFontes = storeFontesProjeto,
  storeEditor: storeEditorProp,
  fila,
  aoRegistrarGuardaSaida,
  aoAtualizarMeta,
  aoMudarStatusSalvamento,
  acoesExternasRef,
}: EditarCorteProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const forcado = useEstadoForcado()
  const [preferencias] = usePreferencias()
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

  const fonteAtual = useMemo(() => {
    if (!corteResolvido) return null
    return fontes.find((f) => f.id === corteResolvido.sourceId) ?? null
  }, [corteResolvido, fontes])

  const fonteDisponivel =
    forcado !== 'offline' &&
    (fonteAtual ? Boolean(fonteAtual.available && fonteAtual.status === 'available') : true)

  const editor = useSessaoEditorControlada(
    projetoPath,
    corteId,
    fonteDisponivel,
    fila,
    storeEditorProp,
  )
  const doc: EditorDocumento | null = editor.documentoAtivo
  const jobsFila = useFila(fila)
  const jobProxyNaFila =
    editor.proxy.job !== null
      ? jobsFila.find((j) => j.id === String(editor.proxy.job)) ?? null
      : null

  const [painelEsquerdoAberto, setPainelEsquerdoAberto] = useState(true)
  const [painelResetKey, setPainelResetKey] = useState(0)
  const [popoverAberto, setPopoverAberto] = useState<string | null>(null)
  const painelEsquerdoAbertoRef = useRef(painelEsquerdoAberto)
  painelEsquerdoAbertoRef.current = painelEsquerdoAberto
  const popoverAbertoRef = useRef(popoverAberto)
  popoverAbertoRef.current = popoverAberto
  const ultimoPopoverRef = useRef<string>('enquadrar')
  const [painelCropAtivo, setPainelCropAtivo] = useState<PainelCropAtivo>('top')
  const [palavraSelecionadaPosition, setPalavraSelecionadaPosition] = useState<number | null>(null)

  const [tempoUs, setTempoUs] = useState(0)
  const [reproduzindo, setReproduzindo] = useState(false)
  const [taxa, setTaxa] = useState(1)
  const [mudo, setMudo] = useState(false)
  const [overlayBorda, setOverlayBorda] = useState<OverlayBorda | null>(null)

  const [dialogoRelocalizarAberto, setDialogoRelocalizarAberto] = useState(false)
  const [caminhoRelocalizar, setCaminhoRelocalizar] = useState('')
  const [relocalizando, setRelocalizando] = useState(false)
  const [erroRelocalizar, setErroRelocalizar] = useState<ErroCore | null>(null)

  const [dialogoSaida, setDialogoSaida] = useState<{ aberto: boolean; erro: ErroCore | null }>({
    aberto: false,
    erro: null,
  })
  const [tentandoSalvarSaida, setTentandoSalvarSaida] = useState(false)
  const resolveSaidaRef = useRef<((podeSair: boolean) => void) | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const palcoRef = useRef<HTMLDivElement>(null)
  const timelineWrapRef = useRef<HTMLDivElement>(null)
  const regiaoFocoRef = useRef<{ prev: number; curr: number }>({ prev: -1, curr: -1 })
  const redirecionouRef = useRef<string | null>(null)
  const aberturaChaveRef = useRef<string | null>(null)
  const docAtualRef = useRef<EditorDocumento | null>(null)
  docAtualRef.current = doc

  useEffect(() => {
    if (popoverAberto) {
      ultimoPopoverRef.current = popoverAberto
    }
  }, [popoverAberto])

  const redirecionarParaCortes = useCallback(
    (chave: string) => {
      if (redirecionouRef.current === chave) return
      redirecionouRef.current = chave
      toastRef.current.add({ title: 'Este Corte não está disponível para edição.' })
      window.location.replace(`#/projeto/${encProjeto}/cortes`)
    },
    [encProjeto],
  )

  // Guarda de entrada + resolução de :corteId (candidato ou avulso-*)
  useEffect(() => {
    if (forcado === 'carregando' || forcado === 'vazio' || forcado === 'erro') {
      setResolvendoEntrada(false)
      return
    }

    if (!identidade) {
      setResolvendoEntrada(false)
      setCorteResolvido(null)
      redirecionarParaCortes(`invalido:${projetoId}:${corteId}`)
      return
    }

    if (!projetoPath || carregandoFontes || projetoPathFontes !== projetoPath) {
      return
    }

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
        if (identidade.kind === 'avulso') {
          const existeFonte = fontes.some((f) => f.id === identidade.sourceId)
          if (!existeFonte) {
            if (!cancelado) {
              setResolvendoEntrada(false)
              setCorteResolvido(null)
              redirecionarParaCortes(`avulso-sem-fonte:${projetoId}:${corteId}`)
            }
            return
          }
          if (!cancelado) {
            setCorteResolvido({
              corteId,
              sourceId: identidade.sourceId,
              startId: identidade.startId,
              endId: identidade.endId,
              videoKind: 'direct',
            })
            setResolvendoEntrada(false)
          }
          return
        }

        const runNum = runId !== undefined && runId.trim() !== '' ? Number(runId) : NaN
        const temRun = Number.isInteger(runNum) && runNum > 0

        if (temRun) {
          const [execucao, revisao] = await Promise.all([
            chamar<DetalheExecucaoSelecao>('selection.get', { run: runNum }),
            chamar<RevisaoExecucaoSelecao>('selection.review', { run: runNum }),
          ])
          if (cancelado) return
          const item = revisao.items.find((it) => it.candidate === identidade.candidateId)
          if (!item || item.status !== 'approved') {
            setResolvendoEntrada(false)
            setCorteResolvido(null)
            redirecionarParaCortes(`nao-aprovado:${projetoId}:${corteId}:${runNum}`)
            return
          }

          let sourceId = fontes[0]?.id ?? 1
          for (const f of fontes) {
            const runs = await listarRunsDaFonte(f.id)
            if (cancelado) return
            if (runs.some((r) => r.id === runNum)) {
              sourceId = f.id
              break
            }
          }

          const itemComKind = item as typeof item & { videoKind?: 'direct' | 'transformed' }
          const videoKind =
            itemComKind.videoKind ??
            (execucao.run.videoKind === 'transformed' ? 'transformed' : 'direct')

          setCorteResolvido({
            corteId,
            sourceId,
            startId: item.startId,
            endId: item.endId,
            candidateId: identidade.candidateId,
            videoKind,
          })
          setResolvendoEntrada(false)
          return
        }

        for (const f of fontes) {
          const runs = await listarRunsDaFonte(f.id)
          if (cancelado) return
          for (const r of runs) {
            const [execucao, revisao] = await Promise.all([
              chamar<DetalheExecucaoSelecao>('selection.get', { run: r.id }),
              chamar<RevisaoExecucaoSelecao>('selection.review', { run: r.id }),
            ])
            if (cancelado) return
            const item = revisao.items.find((it) => it.candidate === identidade.candidateId)
            if (item) {
              if (item.status !== 'approved') {
                setResolvendoEntrada(false)
                setCorteResolvido(null)
                redirecionarParaCortes(`nao-aprovado:${projetoId}:${corteId}`)
                return
              }
              const itemComKind = item as typeof item & { videoKind?: 'direct' | 'transformed' }
              const videoKind =
                itemComKind.videoKind ??
                (execucao.run.videoKind === 'transformed' ? 'transformed' : 'direct')
              setCorteResolvido({
                corteId,
                sourceId: f.id,
                startId: item.startId,
                endId: item.endId,
                candidateId: identidade.candidateId,
                videoKind,
              })
              setResolvendoEntrada(false)
              return
            }
          }
        }

        if (!cancelado) {
          setResolvendoEntrada(false)
          setCorteResolvido(null)
          redirecionarParaCortes(`ausente:${projetoId}:${corteId}`)
        }
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
    erroFontes,
    fontes,
    forcado,
    identidade,
    projetoId,
    projetoPath,
    projetoPathFontes,
    redirecionarParaCortes,
    runId,
  ])

  // Abre a sessão no store apenas quando o Corte resolvido muda
  const storeRef = useRef(editor.store)
  storeRef.current = editor.store
  const fonteDisponivelRef = useRef(fonteDisponivel)
  fonteDisponivelRef.current = fonteDisponivel

  useEffect(() => {
    if (!corteResolvido || !projetoPath) return
    if (forcado === 'carregando' || forcado === 'vazio' || forcado === 'erro') return
    const chave = `${projetoPath}|${corteResolvido.corteId}|${corteResolvido.sourceId}|${corteResolvido.startId}|${corteResolvido.endId}|${corteResolvido.candidateId ?? ''}`
    if (aberturaChaveRef.current === chave) return
    aberturaChaveRef.current = chave

    setReproduzindo(false)
    setTaxa(1)
    setPopoverAberto(null)
    setPalavraSelecionadaPosition(null)

    void storeRef.current
      .abrir({
        corteId: corteResolvido.corteId,
        sourceId: corteResolvido.sourceId,
        startId: corteResolvido.startId,
        endId: corteResolvido.endId,
        candidateId: corteResolvido.candidateId,
        fonteDisponivel: fonteDisponivelRef.current,
      })
      .then((aberto) => {
        if (aberto) {
          setTempoUs(aberto.startUs)
        }
      })
  }, [corteResolvido, forcado, projetoPath])

  // Se um job de proxy reutilizado já constar como concluído na Fila, confirma via proxy.status
  useEffect(() => {
    if (
      (editor.proxy.state !== 'running' && editor.proxy.state !== 'queued') ||
      !editor.proxy.key ||
      editor.proxy.job === null ||
      jobProxyNaFila?.estado !== 'concluido'
    ) {
      return
    }
    let cancelado = false
    const key = editor.proxy.key
    const jobIdStr = String(editor.proxy.job)
    let tentativas = 0

    const verificar = () => {
      if (cancelado) return
      void chamar<{ state: string }>('proxy.status', { key })
        .then((st) => {
          if (cancelado) return
          if (st?.state === 'ready') {
            storeRef.current.registrarEventoProgresso({
              job: jobIdStr,
              stage: 'complete',
              percentage: 100,
              message: 'Preview concluído.',
              error: null,
            })
          } else if (st?.state === 'failed') {
            storeRef.current.registrarEventoProgresso({
              job: jobIdStr,
              stage: 'failed',
              percentage: 0,
              message: 'Falha ao preparar preview.',
              error: { code: 'proxy_failed', message: 'Falha ao preparar preview.' },
            })
          } else if (tentativas < 10) {
            tentativas += 1
            window.setTimeout(verificar, 40)
          }
        })
        .catch(() => {})
    }

    const timer = window.setTimeout(verificar, 35)
    return () => {
      cancelado = true
      window.clearTimeout(timer)
    }
  }, [editor.proxy.job, editor.proxy.key, editor.proxy.state, jobProxyNaFila?.estado])

  // Atualiza meta e status de salvamento para o Shell / ContextoCorteConectado
  useEffect(() => {
    const aoAlterarKind = (e: Event) => {
      const detail = (
        e as CustomEvent<{ candidateId?: number; videoKind?: 'direct' | 'transformed' }>
      ).detail
      if (!detail || typeof detail.candidateId !== 'number' || !detail.videoKind) return
      setCorteResolvido((prev) => {
        if (!prev || prev.candidateId !== detail.candidateId || prev.videoKind === detail.videoKind) {
          return prev
        }
        return { ...prev, videoKind: detail.videoKind! }
      })
    }
    window.addEventListener(EVENTO_CANDIDATO_KIND_ALTERADO, aoAlterarKind)
    return () => window.removeEventListener(EVENTO_CANDIDATO_KIND_ALTERADO, aoAlterarKind)
  }, [])

  useEffect(() => {
    aoAtualizarMeta?.({
      clipId: doc?.clipId,
      fonte: fonteAtual,
      videoKind: corteResolvido?.videoKind ?? 'direct',
    })
  }, [aoAtualizarMeta, corteResolvido?.videoKind, doc?.clipId, fonteAtual])

  useEffect(() => {
    if (!aoMudarStatusSalvamento) return
    if (editor.erroSalvamento) {
      aoMudarStatusSalvamento(<Status tom="perigo">Falha ao salvar</Status>)
      return
    }
    if (editor.salvando) {
      aoMudarStatusSalvamento(<Status tom="rodando">Salvando…</Status>)
      return
    }
    if (editor.dirty) {
      aoMudarStatusSalvamento(<Status tom="pendente">Alterações pendentes…</Status>)
      return
    }
    if (editor.oficial) {
      aoMudarStatusSalvamento(
        <span className="flex items-center gap-2">
          <Status tom="sucesso">Salvo</Status>
          <span className="num text-t3">Desfazer: {editor.oficial.undoCount}</span>
        </span>,
      )
      return
    }
    aoMudarStatusSalvamento(null)
  }, [
    aoMudarStatusSalvamento,
    editor.dirty,
    editor.erroSalvamento,
    editor.oficial,
    editor.salvando,
  ])

  // Avança agulha durante reprodução contínua quando em modo mock ou taxa != 1
  useEffect(() => {
    if (!reproduzindo || !doc) return
    const id = window.setInterval(() => {
      setTempoUs((atual) => {
        const atualSpliced = Math.max(
          0,
          sourceToSplicedUs(atual, doc.silences.segments, doc.startUs),
        )
        const durEfetiva = doc.silences.effectiveDurationUs || Math.max(0, doc.endUs - doc.startUs)
        const proximoSpliced = atualSpliced + Math.round(100_000 * taxa)
        if (proximoSpliced >= durEfetiva) {
          setReproduzindo(false)
          setTaxa(1)
          return doc.endUs
        }
        if (proximoSpliced <= 0) {
          setReproduzindo(false)
          setTaxa(1)
          return doc.startUs
        }
        return splicedToSourceUs(proximoSpliced, doc.silences.segments, doc.startUs, doc.endUs)
      })
    }, 100)
    return () => window.clearInterval(id)
  }, [doc, reproduzindo, taxa])

  // Guarda de saída (editor.flush + ConfirmDialog de 3 ações)
  const garantirSaida = useCallback(async (): Promise<boolean> => {
    if (!docAtualRef.current) return true
    const res = await storeRef.current.garantirSalvoParaSaida()
    if (res.ok) return true
    limparErroSalvamentoEditor(fila)
    setDialogoSaida({ aberto: true, erro: res.erro })
    return new Promise<boolean>((resolve) => {
      resolveSaidaRef.current = resolve
    })
  }, [fila])

  useEffect(() => {
    aoRegistrarGuardaSaida?.(garantirSaida)
  }, [aoRegistrarGuardaSaida, garantirSaida])

  const continuarEditando = useCallback(() => {
    setDialogoSaida({ aberto: false, erro: null })
    const resolve = resolveSaidaRef.current
    resolveSaidaRef.current = null
    resolve?.(false)
  }, [])

  const sairDescartando = useCallback(() => {
    setDialogoSaida({ aberto: false, erro: null })
    const resolve = resolveSaidaRef.current
    resolveSaidaRef.current = null
    resolve?.(true)
  }, [])

  const tentarSalvarNovamenteSaida = useCallback(async () => {
    setTentandoSalvarSaida(true)
    try {
      const res = await storeRef.current.garantirSalvoParaSaida()
      if (res.ok) {
        setDialogoSaida({ aberto: false, erro: null })
        const resolve = resolveSaidaRef.current
        resolveSaidaRef.current = null
        resolve?.(true)
      } else {
        limparErroSalvamentoEditor(fila)
        setDialogoSaida({ aberto: true, erro: res.erro })
      }
    } finally {
      setTentandoSalvarSaida(false)
    }
  }, [fila])

  // Relocalizar Fonte offline/changed
  const abrirRelocalizarFonte = useCallback(() => {
    setErroRelocalizar(null)
    setCaminhoRelocalizar(fonteAtual?.path ?? '')
    setDialogoRelocalizarAberto(true)
  }, [fonteAtual?.path])

  const confirmarRelocalizar = useCallback(async () => {
    const idFonte = fonteAtual?.id ?? corteResolvido?.sourceId
    if (!idFonte || !caminhoRelocalizar.trim() || relocalizando) return
    setRelocalizando(true)
    setErroRelocalizar(null)
    try {
      await chamar('sources.relocate', {
        id: idFonte,
        path: caminhoRelocalizar.trim(),
        confirmed: true,
      })
      await recarregarFontes()
      storeRef.current.definirFonteDisponivel(true)
      setDialogoRelocalizarAberto(false)
      toastRef.current.add({ title: 'Fonte relocalizada.' })
      const d = docAtualRef.current
      if (d) {
        void chamar('proxy.request', {
          source_id: d.request.source_id,
          start_us: d.startUs,
          end_us: d.endUs,
        }).catch(() => {})
      }
    } catch (err) {
      setErroRelocalizar(paraErroCore(err))
    } finally {
      setRelocalizando(false)
    }
  }, [caminhoRelocalizar, corteResolvido?.sourceId, fonteAtual?.id, recarregarFontes, relocalizando])

  // Callbacks entre zonas
  const irParaTranscricaoPalavra = useCallback((posicao?: number) => {
    setPainelEsquerdoAberto(true)
    setPainelResetKey((k) => k + 1)
    setPopoverAberto(null)
    if (typeof posicao === 'number') {
      setPalavraSelecionadaPosition(posicao)
      window.setTimeout(() => {
        containerRef.current
          ?.querySelector<HTMLButtonElement>(`button[data-word="${posicao}"]`)
          ?.focus()
      }, 0)
    }
  }, [])

  const abrirAbaAudio = useCallback(() => {
    setPopoverAberto('audio')
  }, [])

  useEffect(() => {
    if (!acoesExternasRef) return
    acoesExternasRef.current = { irParaTranscricaoPalavra, abrirAbaAudio }
    return () => {
      acoesExternasRef.current = null
    }
  }, [abrirAbaAudio, acoesExternasRef, irParaTranscricaoPalavra])

  const aoOuvirEmContexto = useCallback((alvoUs: number) => {
    setTempoUs(alvoUs)
    setTaxa(1)
    setReproduzindo(true)
  }, [])

  const focarBuscaPainelEsquerdo = useCallback(() => {
    setPainelEsquerdoAberto(true)
    window.setTimeout(() => {
      const input = containerRef.current?.querySelector<HTMLInputElement>(
        'input[aria-label="Filtrar fala do Corte"], input[aria-label="Filtrar no Índice"]',
      )
      input?.focus()
      input?.select()
    }, 0)
  }, [])

  const clicarZoomTimeline = useCallback((direcao: 'mais' | 'menos') => {
    const rotulo = direcao === 'mais' ? 'Aumentar zoom' : 'Diminuir zoom'
    timelineWrapRef.current
      ?.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)
      ?.click()
  }, [])

  const marcarBordaNaAgulha = useCallback((edge: 'start' | 'end', free = false) => {
    const d = docAtualRef.current
    if (!d) return
    const clamped =
      edge === 'start'
        ? Math.min(tempoUs, d.endUs - 1_000_000)
        : Math.max(tempoUs, d.startUs + 1_000_000)
    void storeRef.current.ajustarBorda({ edge, timeUs: clamped, free, preview: false })
  }, [tempoUs])

  // Atalhos globais/contextuais da tela (WCAG 2.1.4)
  const atalhosTela = useMemo<Atalho[]>(() => {
    const ehTransformado = corteResolvido?.videoKind === 'transformed'
    const lista: Atalho[] = [
      {
        id: 'editor.transcricao.alternar',
        titulo: 'Recolher/expandir Transcrição à esquerda',
        grupo: 'Editor',
        tecla: 'Mod+[',
        executar: () => setPainelEsquerdoAberto((v) => !v),
      },
      {
        id: 'editor.popover.alternar',
        titulo: 'Abrir/fechar último popover da barra de ações',
        grupo: 'Editor',
        tecla: 'Mod+]',
        executar: () =>
          setPopoverAberto((atual) => (atual ? null : ultimoPopoverRef.current || 'enquadrar')),
      },
      {
        id: 'corte.salvar',
        titulo: 'Salvar alterações da sub-aba ativa',
        grupo: 'Corte',
        tecla: 'Mod+S',
        executar: () => {
          void storeRef.current.salvarAgora().then((res) => {
            if (res.ok) limparErroSalvamentoEditor(fila)
          })
        },
      },
      {
        id: 'busca.focar',
        titulo: 'Buscar na Transcrição ou Índice do Corte',
        grupo: 'Transcrição',
        tecla: 'Mod+F',
        executar: focarBuscaPainelEsquerdo,
      },
      {
        id: 'editor.desfazer',
        titulo: 'Desfazer edição do Corte',
        grupo: 'Editor do Corte',
        tecla: 'Mod+Z',
        executar: () => {
          void storeRef.current.desfazerEditor()
        },
      },
      {
        id: 'editor.refazer',
        titulo: 'Refazer edição do Corte',
        grupo: 'Editor do Corte',
        tecla: 'Mod+Shift+Z',
        executar: () => {
          void storeRef.current.refazerEditor()
        },
      },
      {
        id: 'transporte.reproduzir',
        titulo: 'Reproduzir / Pausar',
        grupo: 'Transporte',
        tecla: 'Espaço',
        teclaUnica: true,
        executar: () => {
          setReproduzindo((v) => !v)
          setTaxa(1)
        },
      },
      {
        id: 'transporte.rebobinar',
        titulo: 'Rebobinar (1×, 2×, 4×)',
        grupo: 'Transporte',
        tecla: 'J',
        teclaUnica: true,
        executar: () => {
          setTaxa((t) => nextRate(reproduzindo && t < 0 ? t : 0, 'j'))
          setReproduzindo(true)
        },
      },
      {
        id: 'transporte.pausar',
        titulo: 'Pausar transporte',
        grupo: 'Transporte',
        tecla: 'K',
        teclaUnica: true,
        executar: () => {
          setReproduzindo(false)
          setTaxa(1)
        },
      },
      {
        id: 'transporte.avancar',
        titulo: 'Avançar (1×, 2×, 4×)',
        grupo: 'Transporte',
        tecla: 'L',
        teclaUnica: true,
        executar: () => {
          setTaxa((t) => nextRate(reproduzindo && t > 0 ? t : 0, 'l'))
          setReproduzindo(true)
        },
      },
      {
        id: 'editor.entrada',
        titulo: 'Mover borda Entrada para a agulha',
        grupo: 'Editor do Corte',
        tecla: 'I',
        teclaUnica: true,
        teclaModoAlt: 'Shift+Alt+I',
        executar: () => marcarBordaNaAgulha('start', false),
      },
      {
        id: 'editor.saida',
        titulo: 'Mover borda Saída para a agulha',
        grupo: 'Editor do Corte',
        tecla: 'O',
        teclaUnica: true,
        teclaModoAlt: 'Shift+Alt+O',
        executar: () => marcarBordaNaAgulha('end', false),
      },
      {
        id: 'editor.zoomMais',
        titulo: 'Aumentar zoom da timeline',
        grupo: 'Editor do Corte',
        tecla: '+',
        teclaUnica: true,
        executar: () => clicarZoomTimeline('mais'),
      },
      {
        id: 'editor.zoomMenos',
        titulo: 'Diminuir zoom da timeline',
        grupo: 'Editor do Corte',
        tecla: '-',
        teclaUnica: true,
        executar: () => clicarZoomTimeline('menos'),
      },
    ]
    if (ehTransformado) {
      return lista
    }
    return lista
  }, [
    clicarZoomTimeline,
    corteResolvido?.videoKind,
    fila,
    focarBuscaPainelEsquerdo,
    marcarBordaNaAgulha,
    reproduzindo,
  ])

  useAtalhos(atalhosTela)

  // Alt+I / Alt+O livres por quadro e ←/→ por quadro no palco
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      if (emCampoDeTexto(e.target)) return
      const temModal = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"], [data-nao-modal]'))
      if (temModal) return

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'i') {
          e.preventDefault()
          marcarBordaNaAgulha('start', true)
          return
        }
        if (k === 'o') {
          e.preventDefault()
          marcarBordaNaAgulha('end', true)
          return
        }
      }

      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        const alvo = e.target as Element | null
        if (
          alvo?.closest(
            '[role="toolbar"], [role="slider"], [role="listbox"], [role="application"], aside[aria-label="Transcrição e Índice do Corte"]',
          )
        ) {
          return
        }
        const d = docAtualRef.current
        if (!d) return
        const modo = preferencias.modoTeclasUnicas ?? (preferencias.teclasUnicas ? 'ativas' : 'desligadas')
        if (modo === 'desligadas') return
        e.preventDefault()
        const fps = d.fps && d.fps > 0 ? d.fps : 24
        const passo = e.shiftKey ? 1_000_000 : Math.round(1_000_000 / fps)
        const delta = e.key === 'ArrowRight' ? passo : -passo
        setTempoUs((atual) =>
          Math.min(d.windowEndUs ?? d.endUs, Math.max(d.windowStartUs ?? d.startUs, atual + delta)),
        )
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [marcarBordaNaAgulha, preferencias.modoTeclasUnicas, preferencias.teclasUnicas])

  // Ciclo F6 / Shift+F6 entre as regiões visíveis da janela
  useEffect(() => {
    const obterRegioes = (): HTMLElement[] => {
      if (!containerRef.current) return []
      const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')
      const contexto = document.querySelector<HTMLElement>('[data-regiao="contexto"]')
      const painel = painelEsquerdoAbertoRef.current
        ? containerRef.current?.querySelector<HTMLElement>(
            'aside[aria-label="Transcrição e Índice do Corte"]',
          ) ?? null
        : null
      const palco =
        palcoRef.current?.querySelector<HTMLElement>('section[aria-label="Palco de prévia"]') ??
        palcoRef.current
      const popover = popoverAbertoRef.current
        ? document.querySelector<HTMLElement>('[data-regiao="popover-editor"]')
        : null
      const timeline =
        timelineWrapRef.current?.querySelector<HTMLElement>(
          'section[aria-label="Timeline compacta do Corte"]',
        ) ?? timelineWrapRef.current
      const filaRegiao = document.querySelector<HTMLElement>('[data-regiao="fila"]')
      const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')

      return [topo, contexto, painel, palco, popover, timeline, filaRegiao, rodape].filter(
        (el): el is HTMLElement => el !== null,
      )
    }

    const indiceDoElemento = (el: EventTarget | null, regioes: HTMLElement[]): number => {
      if (!(el instanceof Node)) return -1
      return regioes.findIndex((r) => r === el || r.contains(el))
    }

    const aoFocusIn = (e: FocusEvent) => {
      const regioes = obterRegioes()
      const idx = indiceDoElemento(e.target, regioes)
      regiaoFocoRef.current = { prev: regiaoFocoRef.current.curr, curr: idx }
    }

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || e.ctrlKey || e.metaKey || e.altKey) return
      const temDialogoModal = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"], [data-nao-modal]'))
      if (temDialogoModal) return

      const regioes = obterRegioes()
      if (regioes.length === 0) return

      const idxAtual = indiceDoElemento(document.activeElement, regioes)

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

  const videoKind: 'direct' | 'transformed' = corteResolvido?.videoKind ?? 'direct'

  const acoesBarra: AcaoBarra[] = useMemo(
    () => [
      {
        id: 'enquadrar',
        rotulo: 'Enquadrar',
        icone: <Crop />,
        conteudo: (
          <div data-regiao="popover-editor" tabIndex={-1} className="outline-none">
            <PopoverEnquadrar
              projetoPath={projetoPath}
              corteId={corteId}
              estadoEditor={editor}
              tempoUs={tempoUs}
              painelCropAtivo={painelCropAtivo}
              aoMudarPainelCropAtivo={setPainelCropAtivo}
            />
          </div>
        ),
      },
      {
        id: 'legenda',
        rotulo: 'Legenda',
        icone: <Type />,
        conteudo: (
          <div data-regiao="popover-editor" tabIndex={-1} className="outline-none">
            <PopoverLegenda
              projetoId={projetoId}
              projetoPath={projetoPath}
              corteId={corteId}
              videoKind={videoKind}
              palavraSelecionadaPosition={palavraSelecionadaPosition}
              aoIrParaTranscricaoPalavra={irParaTranscricaoPalavra}
              estadoEditor={editor}
            />
          </div>
        ),
      },
      {
        id: 'silencios',
        rotulo: 'Silêncios',
        icone: <AudioLines />,
        conteudo: (
          <div data-regiao="popover-editor" tabIndex={-1} className="outline-none">
            <PopoverSilencios
              projetoPath={projetoPath}
              corteId={corteId}
              estadoEditor={editor}
              aoOuvirEmContexto={aoOuvirEmContexto}
            />
          </div>
        ),
      },
      {
        id: 'audio',
        rotulo: 'Áudio',
        icone: <Volume2 />,
        conteudo: (
          <div data-regiao="popover-editor" tabIndex={-1} className="outline-none">
            <PopoverAudio
              projetoPath={projetoPath}
              corteId={corteId}
              estadoEditor={editor}
              tempoUs={tempoUs}
              palavraSelecionadaPosition={palavraSelecionadaPosition}
            />
          </div>
        ),
      },
      {
        id: 'historico',
        rotulo: 'Histórico',
        icone: <History />,
        conteudo: (
          <div data-regiao="popover-editor" tabIndex={-1} className="outline-none">
            <PopoverHistorico
              projetoPath={projetoPath}
              corteId={corteId}
              estadoEditor={editor}
            />
          </div>
        ),
      },
    ],
    [
      aoOuvirEmContexto,
      corteId,
      editor,
      irParaTranscricaoPalavra,
      painelCropAtivo,
      palavraSelecionadaPosition,
      projetoId,
      projetoPath,
      tempoUs,
      videoKind,
    ],
  )

  if (forcado === 'vazio') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EstadoTela
          tipo="vazio"
          titulo="Este Corte não está disponível para edição"
          descricao="Selecione um Corte aprovado na revisão ou crie um Corte a partir da Transcrição."
          acaoPrimaria={{
            rotulo: 'Voltar para Cortes',
            aoAcionar: () => {
              window.location.hash = `#/projeto/${encProjeto}/cortes`
            },
          }}
        />
      </div>
    )
  }

  const erroTela =
    forcado === 'erro'
      ? new ErroCore('project_write', 'Erro simulado via ?estado=erro.')
      : (erroResolucao ?? editor.erro)

  if (erroTela) {
    const traducao = mensagemDeErro(erroTela)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <BannerErroCore
          erro={{ code: erroTela.code, message: erroTela.detalhe || erroTela.message }}
          traduzir={() => traducao}
          acaoRecuperacao={
            traducao.recuperacao
              ? {
                  rotulo: traducao.recuperacao.rotulo,
                  aoAcionar: () => {
                    if (traducao.recuperacao?.acao === 'relocalizar-fonte') {
                      abrirRelocalizarFonte()
                    } else if (traducao.recuperacao?.rota) {
                      window.location.hash = traducao.recuperacao.rota
                    } else {
                      window.location.hash = `#/projeto/${encProjeto}/cortes`
                    }
                  },
                }
              : {
                  rotulo: 'Voltar para Cortes',
                  aoAcionar: () => {
                    window.location.hash = `#/projeto/${encProjeto}/cortes`
                  },
                }
          }
          permitirRelato
        />
      </div>
    )
  }

  const carregandoTela =
    forcado === 'carregando' || resolucaoOuAberturaEmCurso(resolvendoEntrada, editor.carregando, doc)

  if (carregandoTela) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        aria-busy="true"
        aria-label="Carregando editor do Corte"
      >
        <div className="flex min-h-0 flex-1">
          <div className="w-[clamp(330px,31vw,420px)] shrink-0 border-r border-linha bg-area p-3 min-[1440px]:w-[clamp(420px,31vw,480px)]">
            <Esqueleto variante="transcricao" rotuloAcessivel="Carregando Transcrição" />
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <div className="aspect-[9/16] h-full max-h-full w-64">
              <Esqueleto variante="painel" rotuloAcessivel="Carregando palco de prévia" />
            </div>
          </div>
        </div>
        <div className="h-32 shrink-0 border-t border-linha p-3">
          <Esqueleto variante="lista" rotuloAcessivel="Carregando timeline" />
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} data-f6-proprio="" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!fonteDisponivel && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-linha bg-area px-4 py-1.5 text-pequeno"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Status tom="aviso">Fonte offline</Status>
            <span className="truncate text-t2">
              O arquivo original da Fonte foi movido ou alterado. Você ainda pode ler a Transcrição e ajustar bordas por Frase; prévia e exportação estão bloqueadas.
            </span>
          </div>
          <Botao
            tamanho="p"
            variante="secundario"
            onClick={abrirRelocalizarFonte}
          >
            Relocalizar Fonte
          </Botao>
        </div>
      )}

      {editor.erroAcao && (
        <div className="shrink-0 border-b border-linha px-4 py-2">
          <BannerErroCore
            erro={{
              code: editor.erroAcao.code,
              message: editor.erroAcao.detalhe || editor.erroAcao.message,
            }}
            traduzir={(code) =>
              mensagemDeErro(new ErroCore(code, editor.erroAcao?.detalhe ?? ''))
            }
          />
        </div>
      )}

      {/* Zona superior: Painel Esquerdo recolhível + Palco central (Variante D: sem painel direito fixo) */}
      <div className="flex min-h-0 flex-1">
        <PainelEsquerdoCorte
          key={painelResetKey}
          aberto={painelEsquerdoAberto}
          aoAlternarAberto={() => setPainelEsquerdoAberto((v) => !v)}
          projetoId={projetoId}
          projetoPath={projetoPath}
          corteId={corteId}
          fonteDisponivel={fonteDisponivel}
          store={editor.store}
          fila={fila}
          tempoAtualUs={tempoUs}
          aoMudarTempoUs={(us) => setTempoUs(us)}
          aoOuvirEmContexto={aoOuvirEmContexto}
          aoFocarLegendaOverride={(pos) => {
            setPalavraSelecionadaPosition(pos)
            setPopoverAberto('legenda')
          }}
          aoAbrirAbaAudio={() => setPopoverAberto('audio')}
          abaInicial="transcricao"
        />

        <div ref={palcoRef} className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-2">
          <PalcoEditor
            projetoPath={projetoPath}
            corteId={corteId}
            estadoEditor={editor}
            tempoUs={tempoUs}
            reproduzindo={reproduzindo}
            taxa={taxa}
            mudo={mudo}
            overlayBorda={overlayBorda}
            painelCropAtivo={painelCropAtivo}
            aoMudarPainelCropAtivo={setPainelCropAtivo}
            acoesBarra={acoesBarra}
            popoverAberto={popoverAberto}
            aoMudarPopoverAberto={setPopoverAberto}
            aoMudarTempoUs={(us) => setTempoUs(us)}
            aoMudarReproduzindo={(tocando) => {
              setReproduzindo(tocando)
              if (!tocando) setTaxa(1)
            }}
            aoIrParaInicio={() => doc && setTempoUs(doc.startUs)}
            aoIrParaFim={() => doc && setTempoUs(doc.endUs)}
            aoMarcarEntrada={(free) => marcarBordaNaAgulha('start', Boolean(free))}
            aoMarcarSaida={(free) => marcarBordaNaAgulha('end', Boolean(free))}
            aoAlternarMudo={() => setMudo((v) => !v)}
            aoRelocalizarFonte={abrirRelocalizarFonte}
          />
        </div>
      </div>

      {/* Base: Timeline compacta */}
      <div ref={timelineWrapRef} className="shrink-0">
        <TimelineCorte
          videoKind={videoKind}
          fonteDisponivel={fonteDisponivel}
          projetoPath={projetoPath}
          corteId={corteId}
          store={editor.store}
          fila={fila}
          tempoAtualUs={tempoUs}
          aoMudarTempoUs={(us) => setTempoUs(us)}
          aoMudarOverlayBorda={(ov) =>
            setOverlayBorda(
              ov ? { edge: ov.lado, timeUs: ov.timeUs, livrePorQuadro: ov.livrePorQuadro } : null,
            )
          }
        />
      </div>

      {/* Diálogo de relocalização da Fonte */}
      <Dialogo
        aberto={dialogoRelocalizarAberto}
        aoMudarAberto={setDialogoRelocalizarAberto}
        titulo="Relocalizar arquivo da Fonte"
        descricao="Informe o novo caminho no disco para restaurar a prévia e a exportação deste Corte."
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={relocalizando}
              onClick={() => setDialogoRelocalizarAberto(false)}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={relocalizando}
              disabled={!caminhoRelocalizar.trim()}
              onClick={() => void confirmarRelocalizar()}
            >
              Confirmar relocalização
            </Botao>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {erroRelocalizar && (
            <BannerErroCore
              erro={{
                code: erroRelocalizar.code,
                message: erroRelocalizar.detalhe || erroRelocalizar.message,
              }}
              traduzir={(code) =>
                mensagemDeErro(new ErroCore(code, erroRelocalizar.detalhe ?? ''))
              }
            />
          )}
          <SeletorCaminho
            modo="arquivo"
            rotulo="Arquivo de vídeo da Fonte"
            valor={caminhoRelocalizar}
            aoMudar={setCaminhoRelocalizar}
            placeholder="Selecione ou informe o caminho completo do vídeo"
          />
        </div>
      </Dialogo>

      {/* Guarda de saída: ConfirmDialog obrigatório de 3 ações quando editor.flush falha */}
      <ConfirmDialog
        aberto={dialogoSaida.aberto}
        aoMudarAberto={(proximo) => {
          if (!proximo && !tentandoSalvarSaida) continuarEditando()
        }}
        titulo="Não foi possível salvar as alterações"
        descricao={
          mensagemDeErro(dialogoSaida.erro ?? new ErroCore('project_write', '')).titulo
        }
        rotuloConfirmar="Tentar salvar novamente"
        rotuloCancelar="Continuar editando"
        variante="primario"
        focoInicial="cancelar"
        ocupado={tentandoSalvarSaida}
        aoConfirmar={tentarSalvarNovamenteSaida}
      >
        <div className="flex flex-col gap-3 rounded-controle bg-area p-3 text-pequeno">
          <p className="text-t2">
            Você pode tentar salvar novamente, continuar editando para liberar espaço ou sair descartando o último rascunho não gravado.
          </p>
          <div className="flex justify-start">
            <Botao
              variante="perigo"
              disabled={tentandoSalvarSaida}
              onClick={sairDescartando}
            >
              Sair descartando alterações não salvas
            </Botao>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  )
}

function resolucaoOuAberturaEmCurso(
  resolvendoEntrada: boolean,
  carregandoEditor: boolean,
  doc: EditorDocumento | null,
): boolean {
  return resolvendoEntrada || (carregandoEditor && !doc)
}
