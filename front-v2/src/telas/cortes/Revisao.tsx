import {
  BannerErroCore,
  Botao,
  Dica,
  Esqueleto,
  EstadoTela,
  SeloTipoVideo,
  Select,
  Status,
  useToast,
  type OpcaoSelect,
} from '@ds'
import { ArrowLeft, ArrowRight, RefreshCw, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { SeletorPerfilRedo } from '~/componentes/SeletorPerfilRedo'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import {
  storeFontesProjeto,
  useFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import {
  useSelecaoProjeto,
  type DetalheExecucaoSelecao,
  type ItemRevisaoSelecao,
  type RevisaoExecucaoSelecao,
} from '~/stores/selecaoProjeto'
import {
  DetalheCandidato,
  type CandidatoDetalhe,
} from '~/telas/cortes/DetalheCandidato'
import {
  filtrarEOrdenarCandidatos,
  ListaCandidatos,
  type FiltroEstadoCandidato,
  type OrdenacaoCandidatos,
} from '~/telas/cortes/ListaCandidatos'

export type RevisaoProps = {
  projetoId: string
  projetoPath: string | null
  runParam: string
  revParam?: number
  corteParam?: string
  storeFontes?: StoreFontesProjeto
  fila?: Fila
}

type RespostaAcaoRevisao = {
  run: number
  item: ItemRevisaoSelecao | null
  canUndo: boolean
}

type RunComMeta = DetalheExecucaoSelecao['run'] & {
  profile?: string
  transcriptId?: number
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

function nomeArquivo(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function atualizarQueryRevisao(
  projetoId: string,
  runId: number,
  patch: { rev?: number | null; corte?: number | null },
) {
  const hashAtual = window.location.hash || ''
  const qIdx = hashAtual.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? hashAtual.slice(qIdx + 1) : '')

  if (patch.rev === null) params.delete('rev')
  else if (patch.rev !== undefined) params.set('rev', String(patch.rev))

  if (patch.corte === null) params.delete('corte')
  else if (patch.corte !== undefined) params.set('corte', String(patch.corte))

  const qs = params.toString()
  const enc = encodeURIComponent(projetoId)
  const novoHash = `#/projeto/${enc}/cortes/revisao/${runId}${qs ? `?${qs}` : ''}`
  if (window.location.hash !== novoHash) {
    window.location.hash = novoHash
  }
}

function aplicarItemNaRevisao(
  revisao: RevisaoExecucaoSelecao,
  item: ItemRevisaoSelecao | null,
  canUndo: boolean,
): RevisaoExecucaoSelecao {
  if (!item) return { ...revisao, canUndo }
  const existe = revisao.items.some((it) => it.candidate === item.candidate)
  const items = existe
    ? revisao.items.map((it) => (it.candidate === item.candidate ? item : it))
    : [...revisao.items, item]
  return { ...revisao, items, canUndo }
}

/**
 * Tela C.2 — Bancada de Revisão de Cortes (`#/projeto/:id/cortes/revisao/:runId`).
 * Organização *Lista e detalhe* enxuta com guarda `:runId`, otimismo + rollback, `selection.undo`,
 * seletor de Revisão (`?rev=:n`), `SeletorPerfilRedo` e atalhos integrados a `useAtalhos`.
 */
export function Revisao({
  projetoId,
  projetoPath,
  runParam,
  revParam,
  corteParam,
  storeFontes = storeFontesProjeto,
  fila,
}: RevisaoProps) {
  const toast = useToast()
  const forcado = useEstadoForcado()
  const jobs = useFila(fila)
  const encProjeto = encodeURIComponent(projetoId)

  const runId = Number(runParam)
  const runIdValido = Number.isInteger(runId) && runId > 0

  const { fontes, transcriptStatusBySource } = useFontesProjeto(projetoPath, {
    store: storeFontes,
    fila,
  })
  const {
    execucaoAtiva,
    carregandoExecucao,
    erroExecucao,
    revisaoAtiva,
    carregandoRevisao,
    erroRevisao,
    carregarExecucao,
    carregarRevisao,
  } = useSelecaoProjeto(projetoPath, fila)

  const [revisaoLocal, setRevisaoLocal] = useState<RevisaoExecucaoSelecao | null>(null)
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoCandidato>('todos')
  const [notaMinima, setNotaMinima] = useState<number>(0)
  const [ordenacao, setOrdenacao] = useState<OrdenacaoCandidatos>('nota')

  const [tempoAtualUs, setTempoAtualUs] = useState(0)
  const [reproduzindo, setReproduzindo] = useState(false)

  const [erroOperacao, setErroOperacao] = useState<ErroCore | null>(null)
  const [erroAjuste, setErroAjuste] = useState<ErroCore | null>(null)
  const [ocupadoAjuste, setOcupadoAjuste] = useState(false)
  const [desfazendo, setDesfazendo] = useState(false)
  const [redoAberto, setRedoAberto] = useState(false)
  const [redoSolicitado, setRedoSolicitado] = useState(false)
  const [carregandoInicial, setCarregandoInicial] = useState(true)

  const redirecionouRef = useRef<string | null>(null)
  const redoRodandoRef = useRef(false)
  const subcabecalhoRef = useRef<HTMLElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const detalheRef = useRef<HTMLDivElement>(null)
  const regiaoFocoRef = useRef<{ prev: number; curr: number }>({ prev: -1, curr: -1 })

  // Redireciona imediatamente se :runId na URL não for numérico positivo
  useEffect(() => {
    if (runIdValido) return
    const chave = `${projetoId}:${runParam}`
    if (redirecionouRef.current === chave) return
    redirecionouRef.current = chave
    toast.add({ title: 'Esta execução de seleção não foi encontrada.' })
    window.location.replace(`#/projeto/${encProjeto}/cortes`)
  }, [encProjeto, projetoId, runIdValido, runParam, toast])

  // Carrega execução (selection.get) antes de selection.review para manter activeRevision alinhada
  useEffect(() => {
    if (!runIdValido) return
    let cancelado = false
    setCarregandoInicial(true)
    setErroOperacao(null)
    setErroAjuste(null)

    void (async () => {
      try {
        const det = await carregarExecucao(runId, revParam)
        if (cancelado || !det) return
        await carregarRevisao(runId)
      } finally {
        if (!cancelado) setCarregandoInicial(false)
      }
    })()

    return () => {
      cancelado = true
    }
  }, [runIdValido, runId, revParam, forcado, carregarExecucao, carregarRevisao])

  // Redireciona para C.1 se o núcleo retornar run_not_found
  useEffect(() => {
    if (!runIdValido) return
    const erroNaoEncontrado =
      erroExecucao?.code === 'run_not_found' || erroRevisao?.code === 'run_not_found'
    if (!erroNaoEncontrado) return
    const chave = `${projetoId}:${runId}`
    if (redirecionouRef.current === chave) return
    redirecionouRef.current = chave
    toast.add({ title: 'Esta execução de seleção não foi encontrada.' })
    window.location.replace(`#/projeto/${encProjeto}/cortes`)
  }, [encProjeto, erroExecucao, erroRevisao, projetoId, runId, runIdValido, toast])

  // Sincroniza cópia otimista local com o estado do store quando revisaoAtiva atualiza
  useEffect(() => {
    if (!revisaoAtiva || (runIdValido && revisaoAtiva.run !== runId)) return
    setRevisaoLocal(revisaoAtiva)
  }, [revisaoAtiva, runId, runIdValido])

  const execucaoDoRun =
    execucaoAtiva && execucaoAtiva.run.id === runId ? execucaoAtiva : null
  const runAtivo = (execucaoDoRun?.run ?? null) as RunComMeta | null
  const janelas = execucaoDoRun?.windows ?? []

  const fonteAtiva = useMemo<FonteProjeto | null>(() => {
    if (!runAtivo || fontes.length === 0) return null
    const tid = runAtivo.transcriptId
    if (typeof tid === 'number') {
      const porTranscricao = fontes.find(
        (f) => transcriptStatusBySource[f.id]?.transcript?.id === tid,
      )
      if (porTranscricao) return porTranscricao
      const porId = fontes.find((f) => f.id === tid)
      if (porId) return porId
    }
    return fontes[0] ?? null
  }, [fontes, runAtivo, transcriptStatusBySource])

  const candidatosCombinados = useMemo<CandidatoDetalhe[]>(() => {
    if (!execucaoDoRun) return []
    const mapaItens = new Map<number, ItemRevisaoSelecao>()
    for (const item of revisaoLocal?.items ?? []) {
      mapaItens.set(item.candidate, item)
    }

    return execucaoDoRun.candidates.map((c) => {
      const item = mapaItens.get(c.id)
      const cComExtras = c as typeof c & {
        axes?: CandidatoDetalhe['axes']
        weights?: CandidatoDetalhe['weights']
        chat?: CandidatoDetalhe['chat']
        adjust?: CandidatoDetalhe['adjust']
      }
      return {
        ...c,
        axes: cComExtras.axes,
        weights: cComExtras.weights,
        chat: cComExtras.chat,
        adjust: cComExtras.adjust ?? null,
        status: item?.status ?? 'pending',
        adjusted: item?.adjusted ?? c.adjusted,
        startId: item?.startId ?? c.startId,
        endId: item?.endId ?? c.endId,
        startUs: item?.startUs ?? c.startUs,
        endUs: item?.endUs ?? c.endUs,
        startText: item?.startText ?? '',
        endText: item?.endText ?? '',
        moves: item?.moves,
      }
    })
  }, [execucaoDoRun, revisaoLocal])

  const candidatosOrdenados = useMemo(
    () =>
      filtrarEOrdenarCandidatos(candidatosCombinados, {
        filtroEstado,
        notaMinima,
        ordenacao,
      }),
    [candidatosCombinados, filtroEstado, notaMinima, ordenacao],
  )

  // Seleciona candidato inicial (?corte= ou 1º da lista ordenada)
  useEffect(() => {
    if (candidatosCombinados.length === 0) {
      setSelecionadoId(null)
      return
    }
    const idParam = corteParam ? Number(corteParam) : NaN
    if (Number.isFinite(idParam) && candidatosCombinados.some((c) => c.id === idParam)) {
      setSelecionadoId(idParam)
      return
    }
    setSelecionadoId((atual) => {
      if (atual !== null && candidatosCombinados.some((c) => c.id === atual)) return atual
      return (candidatosOrdenados[0] ?? candidatosCombinados[0])?.id ?? null
    })
  }, [corteParam, candidatosCombinados, candidatosOrdenados])

  const candidatoSelecionado = useMemo(
    () => candidatosCombinados.find((c) => c.id === selecionadoId) ?? null,
    [candidatosCombinados, selecionadoId],
  )

  // Reinicia relógio de preview ao trocar de candidato
  useEffect(() => {
    setTempoAtualUs(0)
    setReproduzindo(false)
    setErroAjuste(null)
  }, [candidatoSelecionado?.id])

  const contadores = useMemo(() => {
    let approved = 0
    let rejected = 0
    let pending = 0
    for (const c of candidatosCombinados) {
      if (c.status === 'approved') approved += 1
      else if (c.status === 'rejected') rejected += 1
      else pending += 1
    }
    return { approved, rejected, pending }
  }, [candidatosCombinados])

  // Monitora jobs de Redo em background via useFila()
  const jobSelecaoAtivo = useMemo(
    () =>
      jobs.find(
        (j) =>
          j.id === `selection-${runId}` ||
          (j.etapa.startsWith('ai:selection') && j.estado === 'rodando'),
      ),
    [jobs, runId],
  )

  const redoEmAndamento =
    redoSolicitado ||
    runAtivo?.state === 'running' ||
    jobSelecaoAtivo?.estado === 'rodando' ||
    janelas.some((w) => w.state === 'running' || w.state === 'queued')

  useEffect(() => {
    const rodandoAgora = Boolean(
      jobSelecaoAtivo?.estado === 'rodando' || redoSolicitado || runAtivo?.state === 'running',
    )
    if (rodandoAgora) {
      redoRodandoRef.current = true
      return
    }
    if (redoRodandoRef.current && jobSelecaoAtivo?.estado === 'concluido') {
      redoRodandoRef.current = false
      setRedoSolicitado(false)
      void (async () => {
        const det = await carregarExecucao(runId, undefined, { silencioso: true })
        await carregarRevisao(runId, { silencioso: true })
        const rev = det?.run.revision ?? runAtivo?.revision ?? 1
        toast.add({ title: `Nova revisão (v${rev}) disponível` })
      })()
    }
  }, [
    carregarExecucao,
    carregarRevisao,
    jobSelecaoAtivo?.estado,
    redoSolicitado,
    runAtivo?.revision,
    runAtivo?.state,
    runId,
    toast,
  ])

  const selecionarCandidato = useCallback(
    (candidato: CandidatoDetalhe | { id: number }) => {
      setSelecionadoId(candidato.id)
      if (runIdValido) {
        atualizarQueryRevisao(projetoId, runId, { corte: candidato.id })
      }
    },
    [projetoId, runId, runIdValido],
  )

  const aoDecidir = useCallback(
    async (candidatoId: number, decisao: 'approved' | 'rejected') => {
      if (!revisaoLocal) return
      const anterior = revisaoLocal
      const itemAnterior = anterior.items.find((it) => it.candidate === candidatoId) ?? null
      setErroOperacao(null)

      // Atualização otimista imediata
      if (itemAnterior) {
        setRevisaoLocal(
          aplicarItemNaRevisao(anterior, { ...itemAnterior, status: decisao }, true),
        )
      }

      try {
        const res = await chamar<RespostaAcaoRevisao>('selection.decide', {
          candidate: candidatoId,
          decision: decisao,
        })
        setRevisaoLocal((atual) =>
          atual ? aplicarItemNaRevisao(atual, res.item, res.canUndo) : atual,
        )
      } catch (err) {
        setRevisaoLocal(anterior)
        setErroOperacao(paraErroCore(err))
      }
    },
    [revisaoLocal],
  )

  const aoAjustar = useCallback(
    async (candidatoId: number, borda: 'start' | 'end', delta: -1 | 1) => {
      if (!revisaoLocal || ocupadoAjuste) return
      const anterior = revisaoLocal
      const focadoAntes = document.activeElement
      setErroAjuste(null)
      setErroOperacao(null)
      setOcupadoAjuste(true)

      try {
        const res = await chamar<RespostaAcaoRevisao>('selection.adjust', {
          candidate: candidatoId,
          edge: borda,
          delta,
        })
        setRevisaoLocal((atual) =>
          atual ? aplicarItemNaRevisao(atual, res.item, res.canUndo) : atual,
        )
      } catch (err) {
        setRevisaoLocal(anterior)
        setErroAjuste(paraErroCore(err))
      } finally {
        setOcupadoAjuste(false)
        if (focadoAntes instanceof HTMLElement && focadoAntes.isConnected) {
          requestAnimationFrame(() => {
            if (!focadoAntes.hasAttribute('disabled') && document.activeElement === document.body) {
              focadoAntes.focus()
            }
          })
        }
      }
    },
    [ocupadoAjuste, revisaoLocal],
  )

  const aoDesfazer = useCallback(async () => {
    if (!runAtivo || !revisaoLocal?.canUndo || desfazendo) return
    setErroOperacao(null)
    setErroAjuste(null)
    setDesfazendo(true)
    try {
      const res = await chamar<RespostaAcaoRevisao>('selection.undo', { run: runAtivo.id })
      setRevisaoLocal((atual) =>
        atual ? aplicarItemNaRevisao(atual, res.item, res.canUndo) : atual,
      )
      if (res.item) {
        selecionarCandidato({ id: res.item.candidate })
      }
    } catch (err) {
      const coreErr = paraErroCore(err)
      if (coreErr.code === 'nothing_to_undo') {
        setRevisaoLocal((atual) => (atual ? { ...atual, canUndo: false } : atual))
      }
      setErroOperacao(coreErr)
    } finally {
      setDesfazendo(false)
    }
  }, [desfazendo, revisaoLocal?.canUndo, runAtivo, selecionarCandidato])

  const aoMudarRevisao = useCallback(
    async (novaRev: number) => {
      if (!runAtivo || novaRev === runAtivo.revision) return
      setErroOperacao(null)
      setErroAjuste(null)
      atualizarQueryRevisao(projetoId, runAtivo.id, { rev: novaRev, corte: null })
      const det = await carregarExecucao(runAtivo.id, novaRev)
      if (det) {
        await carregarRevisao(runAtivo.id)
      }
    },
    [carregarExecucao, carregarRevisao, projetoId, runAtivo],
  )

  const aoAbrirEditor = useCallback(
    (candidatoId: number) => {
      if (!runAtivo) return
      const alvo = candidatosCombinados.find((c) => c.id === candidatoId)
      if (!alvo || alvo.status !== 'approved') return
      window.location.hash = `#/projeto/${encProjeto}/corte/${candidatoId}/editar?run=${runAtivo.id}`
    },
    [candidatosCombinados, encProjeto, runAtivo],
  )

  const aoRelocalizarFonte = useCallback(
    (fonteId: number) => {
      window.location.hash = `#/projeto/${encProjeto}/fontes/${fonteId}`
    },
    [encProjeto],
  )

  // Registra F6 / Shift+F6 com 5 regiões (Topo -> Sub-cabeçalho -> Lista -> Detalhe -> Rodapé)
  useEffect(() => {
    const obterRegioes = (): HTMLElement[] => {
      const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')
      const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')
      return [
        topo,
        subcabecalhoRef.current,
        listaRef.current,
        detalheRef.current,
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

      // Se o Shell já tratou este F6 em capture antes de nós, recupera a região anterior ao Shell
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

  const duracaoCorteUs = candidatoSelecionado
    ? Math.max(0, candidatoSelecionado.endUs - candidatoSelecionado.startUs)
    : 0

  const atalhos = useMemo<Atalho[]>(() => {
    const lista: Atalho[] = []
    if (!runAtivo) return lista

    lista.push({
      id: 'revisao.desfazer',
      titulo: 'Desfazer última decisão/ajuste',
      grupo: 'Revisão de Cortes',
      tecla: 'Mod+Z',
      executar: () => {
        void aoDesfazer()
      },
    })

    if (candidatoSelecionado) {
      const moves = candidatoSelecionado.moves ?? {
        startEarlier: true,
        startLater: true,
        endEarlier: true,
        endLater: true,
      }
      lista.push(
        {
          id: 'revisao.aprovar',
          titulo: 'Aprovar candidato',
          grupo: 'Revisão de Cortes',
          tecla: 'A',
          teclaUnica: true,
          executar: () => {
            void aoDecidir(candidatoSelecionado.id, 'approved')
          },
        },
        {
          id: 'revisao.rejeitar',
          titulo: 'Rejeitar candidato',
          grupo: 'Revisão de Cortes',
          tecla: 'R',
          teclaUnica: true,
          executar: () => {
            void aoDecidir(candidatoSelecionado.id, 'rejected')
          },
        },
        {
          id: 'revisao.bordaInicio',
          titulo: 'Recuar borda inicial em 1 Frase',
          grupo: 'Revisão de Cortes',
          tecla: 'I',
          teclaUnica: true,
          executar: () => {
            if (moves.startEarlier) void aoAjustar(candidatoSelecionado.id, 'start', -1)
          },
        },
        {
          id: 'revisao.bordaInicioAvancar',
          titulo: 'Avançar borda inicial em 1 Frase',
          grupo: 'Revisão de Cortes',
          tecla: 'Shift+I',
          teclaUnica: true,
          executar: () => {
            if (moves.startLater) void aoAjustar(candidatoSelecionado.id, 'start', 1)
          },
        },
        {
          id: 'revisao.bordaFim',
          titulo: 'Recuar borda final em 1 Frase',
          grupo: 'Revisão de Cortes',
          tecla: 'O',
          teclaUnica: true,
          executar: () => {
            if (moves.endEarlier) void aoAjustar(candidatoSelecionado.id, 'end', -1)
          },
        },
        {
          id: 'revisao.bordaFimAvancar',
          titulo: 'Avançar borda final em 1 Frase',
          grupo: 'Revisão de Cortes',
          tecla: 'Shift+O',
          teclaUnica: true,
          executar: () => {
            if (moves.endLater) void aoAjustar(candidatoSelecionado.id, 'end', 1)
          },
        },
        {
          id: 'revisao.abrirEditor',
          titulo: 'Abrir Corte aprovado no Editor',
          grupo: 'Revisão de Cortes',
          tecla: 'Enter',
          executar: () => {
            if (candidatoSelecionado.status === 'approved') {
              aoAbrirEditor(candidatoSelecionado.id)
            }
          },
        },
        {
          id: 'transporte.reproduzir',
          titulo: 'Reproduzir / Pausar preview',
          grupo: 'Transporte',
          tecla: 'Espaço',
          teclaUnica: true,
          executar: () => setReproduzindo((v) => !v),
        },
        {
          id: 'transporte.pausar',
          titulo: 'Pausar/Alternar transporte',
          grupo: 'Transporte',
          tecla: 'K',
          teclaUnica: true,
          executar: () => setReproduzindo((v) => !v),
        },
        {
          id: 'transporte.rebobinar',
          titulo: 'Rebobinar preview em 5 s',
          grupo: 'Transporte',
          tecla: 'J',
          teclaUnica: true,
          executar: () => setTempoAtualUs((t) => Math.max(0, t - 5_000_000)),
        },
        {
          id: 'transporte.avancar',
          titulo: 'Avançar preview em 5 s',
          grupo: 'Transporte',
          tecla: 'L',
          teclaUnica: true,
          executar: () => setTempoAtualUs((t) => Math.min(duracaoCorteUs, t + 5_000_000)),
        },
        {
          id: 'transporte.quadroAnterior',
          titulo: 'Voltar 1 segundo no preview',
          grupo: 'Transporte',
          tecla: 'ArrowLeft',
          teclaUnica: false,
          executar: () => {
            if (
              document.activeElement?.closest(
                '[role="radiogroup"], [role="slider"], input[type="range"], [role="toolbar"]',
              )
            ) {
              return
            }
            setTempoAtualUs((t) => Math.max(0, t - 1_000_000))
          },
        },
        {
          id: 'transporte.quadroProximo',
          titulo: 'Avançar 1 segundo no preview',
          grupo: 'Transporte',
          tecla: 'ArrowRight',
          teclaUnica: false,
          executar: () => {
            if (
              document.activeElement?.closest(
                '[role="radiogroup"], [role="slider"], input[type="range"], [role="toolbar"]',
              )
            ) {
              return
            }
            setTempoAtualUs((t) => Math.min(duracaoCorteUs, t + 1_000_000))
          },
        },
      )
    }

    return lista
  }, [aoAbrirEditor, aoAjustar, aoDecidir, aoDesfazer, candidatoSelecionado, duracaoCorteUs, runAtivo])

  useAtalhos(atalhos)

  const estadoTela = useMemo<'carregando' | 'erro' | 'vazio' | 'pronto'>(() => {
    if (forcado === 'carregando') return 'carregando'
    if (forcado === 'erro') return 'erro'
    if (forcado === 'vazio') return 'vazio'
    if (!runIdValido) return 'carregando'
    if (carregandoInicial || ((carregandoExecucao || carregandoRevisao) && (!execucaoDoRun || !revisaoLocal))) {
      return 'carregando'
    }
    if ((erroExecucao || erroRevisao) && !execucaoDoRun) {
      return 'erro'
    }
    if (execucaoDoRun && candidatosCombinados.length === 0) {
      return 'vazio'
    }
    return 'pronto'
  }, [
    candidatosCombinados.length,
    carregandoExecucao,
    carregandoInicial,
    carregandoRevisao,
    erroExecucao,
    erroRevisao,
    execucaoDoRun,
    forcado,
    revisaoLocal,
    runIdValido,
  ])

  const erroFatal = useMemo(() => {
    if (erroExecucao && erroExecucao.code !== 'run_not_found') return erroExecucao
    if (erroRevisao && erroRevisao.code !== 'run_not_found') return erroRevisao
    if (forcado === 'erro') {
      return new ErroCore(
        'local_only_violation',
        'Bloqueado pelo modo Somente local: o Provedor configurado envia texto para fora da máquina.',
      )
    }
    return null
  }, [erroExecucao, erroRevisao, forcado])

  const ehMac =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
  const rotuloAtalhoDesfazer = ehMac ? '⌘Z' : 'Ctrl+Z'

  if (estadoTela === 'carregando') {
    return (
      <div
        aria-label="Carregando bancada de revisão"
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <div className="flex items-center justify-between border-b border-linha pb-2.5">
          <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">
            Revisão de Cortes
          </h1>
          <Esqueleto variante="linha" rotuloAcessivel="Carregando cabeçalho da revisão" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(320px,37%)_1fr] min-[1440px]:grid-cols-[32%_1fr]">
          <div className="rounded-area bg-area p-3">
            <Esqueleto variante="lista" quantidade={6} rotuloAcessivel="Carregando lista de candidatos" />
          </div>
          <div className="flex flex-col gap-4 p-2">
            <Esqueleto variante="painel" quantidade={2} rotuloAcessivel="Carregando preview e Nota" />
          </div>
        </div>
      </div>
    )
  }

  if (estadoTela === 'erro' && erroFatal) {
    const trad = mensagemDeErro(erroFatal)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">Revisão de Cortes</h1>
        <BannerErroCore
          erro={{ code: erroFatal.code, message: erroFatal.detalhe || erroFatal.message }}
          traduzir={() => ({ titulo: trad.titulo })}
          acaoRecuperacao={
            trad.recuperacao?.rota
              ? {
                  rotulo: trad.recuperacao.rotulo,
                  aoAcionar: () => {
                    window.location.hash = trad.recuperacao!.rota!
                  },
                }
              : {
                  rotulo: 'Voltar à seleção',
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

  if (estadoTela === 'vazio' || !runAtivo) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
        <EstadoTela
          tipo="vazio"
          nivelTitulo="h1"
          titulo="Nenhum candidato gerado nesta execução"
          descricao="O Provedor não gerou Cortes válidos para esta execução. Volte à seleção para ajustar a faixa ou tentar outro Perfil de Provedor."
          acaoPrimaria={{
            rotulo: 'Voltar à seleção para tentar outro Perfil',
            aoAcionar: () => {
              window.location.hash = `#/projeto/${encProjeto}/cortes${fonteAtiva ? `?fonte=${fonteAtiva.id}&run=${runId}` : ''}`
            },
          }}
        />
      </div>
    )
  }

  const revisoes = runAtivo.revisions?.length ? runAtivo.revisions : [runAtivo.revision ?? 1]
  const numeroRevisaoAtiva = runAtivo.revision ?? revisoes[revisoes.length - 1]
  const opcoesRevisao: OpcaoSelect<string>[] = revisoes.map((rev, idx) => ({
    valor: String(rev),
    rotulo: idx === revisoes.length - 1 ? `v${rev} (atual)` : `v${rev}`,
  }))

  const temIncerta = janelas.some((w) => w.state === 'uncertain')
  const janelasElegiveis = janelas
    .filter((w) => w.state !== 'queued' && w.state !== 'running' && w.state !== 'uncertain')
    .map((w) => w.index)

  const totalJanelas = runAtivo.counts?.windows ?? janelas.length
  const janelasConcluidas =
    runAtivo.counts?.completed ?? janelas.filter((w) => w.state === 'completed').length
  const estaParcial = forcado === 'parcial' || runAtivo.state === 'partial'

  const queryVoltar = new URLSearchParams()
  if (fonteAtiva) queryVoltar.set('fonte', String(fonteAtiva.id))
  queryVoltar.set('run', String(runAtivo.id))
  if (numeroRevisaoAtiva) queryVoltar.set('rev', String(numeroRevisaoAtiva))
  const hashSelecao = `#/projeto/${encProjeto}/cortes?${queryVoltar.toString()}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Sub-cabeçalho enxuto */}
      <nav
        ref={subcabecalhoRef}
        aria-label="Controles da revisão"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-linha pb-2.5 min-[1440px]:flex-nowrap"
      >
        <Botao
          tamanho="p"
          variante="fantasma"
          icone={<ArrowLeft />}
          onClick={() => {
            window.location.hash = hashSelecao
          }}
        >
          Voltar à seleção
        </Botao>

        <h1 className="num shrink-0 text-titulo font-forte tracking-[-0.01em] text-t1">
          Execução #{runAtivo.id}
        </h1>

        {fonteAtiva && (
          <span className="max-w-36 truncate text-pequeno text-t3" title={nomeArquivo(fonteAtiva.path)}>
            {nomeArquivo(fonteAtiva.path)}
          </span>
        )}

        <SeloTipoVideo tipo={runAtivo.videoKind} />

        {revisoes.length > 1 && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-pequeno text-t3">Revisão:</span>
            <Select
              rotulo="Revisão da execução"
              valor={String(numeroRevisaoAtiva)}
              aoMudar={(v) => void aoMudarRevisao(Number(v))}
              opcoes={opcoesRevisao}
              className="w-28 min-w-0"
            />
          </div>
        )}

        <span role="status" aria-live="polite" className="num shrink-0 text-pequeno text-t3">
          {contadores.approved} aprovados · {contadores.rejected} rejeitados · {contadores.pending} pendentes
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Dica texto="Desfaz a última aprovação, rejeição ou ajuste desta execução">
            <span tabIndex={revisaoLocal?.canUndo ? undefined : 0} className="inline-flex">
              <Botao
                tamanho="p"
                variante="secundario"
                icone={<Undo2 />}
                atalho={rotuloAtalhoDesfazer}
                disabled={!revisaoLocal?.canUndo || desfazendo}
                carregando={desfazendo}
                onClick={() => void aoDesfazer()}
              >
                Desfazer
              </Botao>
            </span>
          </Dica>

          {temIncerta || janelasElegiveis.length === 0 ? (
            <Dica
              texto={
                temIncerta
                  ? 'Há janela incerta nesta execução; resolva na Fila antes de refazer com outro Perfil.'
                  : 'Nenhuma Janela disponível para refazer no momento.'
              }
            >
              <span tabIndex={0} className="inline-flex">
                <Botao tamanho="p" variante="secundario" icone={<RefreshCw />} disabled>
                  Refazer com outro Perfil…
                </Botao>
              </span>
            </Dica>
          ) : (
            <Botao
              tamanho="p"
              variante="secundario"
              icone={<RefreshCw />}
              onClick={() => setRedoAberto(true)}
            >
              Refazer com outro Perfil…
            </Botao>
          )}

          <Botao
            tamanho="p"
            variante="secundario"
            disabled={contadores.approved === 0}
            onClick={() => {
              window.location.hash = `#/projeto/${encProjeto}/exportacao`
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="num">Ir para Exportação ({contadores.approved})</span>
              <ArrowRight className="size-[15px] stroke-[1.75]" aria-hidden />
            </span>
          </Botao>
        </div>
      </nav>

      {/* Faixa de redo em background (sem travar a revisão) */}
      {redoEmAndamento && (
        <div
          role="status"
          aria-live="polite"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-area bg-area px-3 py-2"
        >
          <Status tom="rodando">Gerando nova revisão da execução em segundo plano…</Status>
          <Botao
            tamanho="p"
            variante="fantasma"
            onClick={() => {
              window.location.hash = hashSelecao
            }}
          >
            Acompanhar na seleção
          </Botao>
        </div>
      )}

      {/* Faixa de execução parcial */}
      {estaParcial && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-area bg-area px-3 py-2"
        >
          <p className="num text-pequeno text-t1">
            Esta execução está parcial ({janelasConcluidas}/{totalJanelas} Janelas). Alguns trechos da Fonte podem não ter sido analisados.
          </p>
          <Botao
            tamanho="p"
            variante="secundario"
            onClick={() => {
              window.location.hash = hashSelecao
            }}
          >
            Retomar na tela de seleção
          </Botao>
        </div>
      )}

      {/* Erro de operação (ex.: rollback em selection.decide ou nothing_to_undo) */}
      {erroOperacao && (
        <div className="shrink-0">
          <BannerErroCore
            erro={{ code: erroOperacao.code, message: erroOperacao.detalhe || erroOperacao.message }}
            traduzir={() => mensagemDeErro(erroOperacao)}
            aoDispensar={() => setErroOperacao(null)}
          />
        </div>
      )}

      {/* Bancada 2 colunas: Lista à esquerda · Detalhe 9:16 à direita */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden lg:grid-cols-[minmax(320px,37%)_1fr] min-[1440px]:grid-cols-[32%_1fr]">
        <div ref={listaRef} className="flex min-h-0 flex-col overflow-hidden">
          <ListaCandidatos
            candidatos={candidatosCombinados}
            selecionadoId={selecionadoId}
            aoSelecionar={(c) => selecionarCandidato(c)}
            filtroEstado={filtroEstado}
            aoMudarFiltroEstado={setFiltroEstado}
            notaMinima={notaMinima}
            aoMudarNotaMinima={setNotaMinima}
            ordenacao={ordenacao}
            aoMudarOrdenacao={setOrdenacao}
            aoLimparFiltros={() => {
              setFiltroEstado('todos')
              setNotaMinima(0)
            }}
            className="min-h-0 flex-1"
          />
        </div>

        <div ref={detalheRef} className="flex min-h-0 flex-col overflow-hidden">
          <DetalheCandidato
            projetoId={projetoId}
            run={runAtivo}
            fonte={fonteAtiva}
            candidato={candidatoSelecionado}
            erroAjuste={erroAjuste}
            ocupadoAjuste={ocupadoAjuste}
            tempoAtualUs={tempoAtualUs}
            aoMudarTempoUs={setTempoAtualUs}
            reproduzindo={reproduzindo}
            aoMudarReproduzindo={setReproduzindo}
            desabilitarAtalhosLocais
            aoDecidir={aoDecidir}
            aoAjustar={aoAjustar}
            aoAbrirEditor={aoAbrirEditor}
            aoRelocalizarFonte={aoRelocalizarFonte}
            className="min-h-0 flex-1"
          />
        </div>
      </div>

      {/* Diálogo: Refazer com outro Perfil (selection.redo) */}
      <SeletorPerfilRedo
        aberto={redoAberto}
        run={runAtivo.id}
        windows={janelasElegiveis}
        perfilAtual={runAtivo.profile ?? null}
        aoFechar={() => setRedoAberto(false)}
        aoConcluir={() => {
          setRedoSolicitado(true)
          void carregarExecucao(runAtivo.id, undefined, { silencioso: true })
        }}
      />
    </div>
  )
}
