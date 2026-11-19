import {
  BannerErroCore,
  Botao,
  BotaoIcone,
  ConfirmDialog,
  Dialogo,
  Dica,
  Esqueleto,
  EstadoTela,
  FaixaJob,
  Progresso,
  Segmentado,
  Select,
  Status,
  Switch,
  duracao,
  useToast,
  type TomStatus,
} from '@ds'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  Lock,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GravadorTeleprompter,
  type AudioGravadoTeleprompter,
} from '~/componentes/GravadorTeleprompter'
import { InstaladorJustInTime } from '~/componentes/InstaladorJustInTime'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { ErroCore, chamar, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import type {
  AlinhamentoBloco,
  BlocoNarracao,
  CatalogoTtsDoc,
  useTransformarCorte,
} from '~/stores/transformarCorte'
import { mediaUrl } from '../../../../../src/lib/media'

export type StoreTransformarNarracao = ReturnType<typeof useTransformarCorte>

export interface PassoNarracaoProps {
  candidateId: number
  store: StoreTransformarNarracao
  modalPaiAberto?: boolean
  aoVoltarBlocoPendente: (blockId?: number) => void
  aoIrParaEmpacotar: () => void
  aoIrParaEditar: () => void
}

type ModoComparacaoLimpeza = 'original' | 'clean'

type ConfirmacaoSobrescrita =
  | { tipo: 'todos' }
  | { tipo: 'bloco'; blockId: number }
  | { tipo: 'importar'; blockId: number; path: string }

const CODIGOS_IMPORTACAO = new Set([
  'import_unsupported_format',
  'import_file_too_large',
  'import_duration_too_short',
  'import_duration_too_long',
  'import_no_audio_stream',
  'import_unsupported_codec',
  'import_empty_file',
  'import_invalid_audio',
  'import_file_missing',
  'import_failed',
])

function infoOrigemAudio(
  audio: BlocoNarracao['audio'],
  vozes: CatalogoTtsDoc['voices'] = [],
): { tom: TomStatus; rotulo: string } {
  if (!audio) return { tom: 'pendente', rotulo: 'Sem áudio' }
  if (audio.engineId === 'recorded') return { tom: 'sucesso', rotulo: 'Gravado' }
  if (audio.engineId === 'imported') return { tom: 'sucesso', rotulo: 'Importado' }
  const voz = vozes.find((v) => v.id === audio.voiceId)
  return { tom: 'sucesso', rotulo: voz ? `TTS · ${voz.label}` : 'TTS · Voz sintética' }
}

function formatarMinSeg(segundos: number): string {
  const seguro = Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0
  const m = Math.floor(seguro / 60)
  const s = seguro % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function PlayerAudioBloco({
  src,
  duracaoUs,
  posicaoBloco,
}: {
  src: string
  duracaoUs: number
  posicaoBloco: number
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [reproduzindo, setReproduzindo] = useState(false)
  const [tempoAtualSeg, setTempoAtualSeg] = useState(0)
  const [duracaoAudioSeg, setDuracaoAudioSeg] = useState<number | null>(null)

  useEffect(() => {
    setReproduzindo(false)
    setTempoAtualSeg(0)
    setDuracaoAudioSeg(null)
  }, [src])

  const duracaoFallbackSeg = Math.max(0, duracaoUs / 1_000_000)
  const duracaoTotalSeg =
    duracaoAudioSeg !== null && Number.isFinite(duracaoAudioSeg) && duracaoAudioSeg > 0
      ? duracaoAudioSeg
      : duracaoFallbackSeg
  const progressoPct =
    duracaoTotalSeg > 0 ? Math.min(100, Math.max(0, (tempoAtualSeg / duracaoTotalSeg) * 100)) : 0

  const alternar = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      void el.play().then(
        () => setReproduzindo(true),
        () => setReproduzindo(false),
      )
    } else {
      el.pause()
      setReproduzindo(false)
    }
  }

  return (
    <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-controle bg-area px-2 py-1">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuracaoAudioSeg(d)
        }}
        onTimeUpdate={(e) => setTempoAtualSeg(e.currentTarget.currentTime)}
        onEnded={() => {
          setReproduzindo(false)
          setTempoAtualSeg(0)
        }}
        className="hidden"
      />
      <BotaoIcone
        rotulo={
          reproduzindo
            ? `Pausar áudio do Bloco ${posicaoBloco}`
            : `Reproduzir áudio do Bloco ${posicaoBloco}`
        }
        tamanho="p"
        onClick={alternar}
      >
        {reproduzindo ? <Pause /> : <Play />}
      </BotaoIcone>
      <div className="h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-elevado">
        <div
          className="h-full rounded-full bg-t2 transition-[width] duration-(--dur-rapida) ease-saida"
          style={{ width: `${progressoPct}%` }}
        />
      </div>
      <span className="num text-pequeno text-t2">
        {formatarMinSeg(tempoAtualSeg)} / {formatarMinSeg(duracaoTotalSeg)}
      </span>
    </div>
  )
}

function infoAlinhamento(alinhamento: AlinhamentoBloco | null): { tom: TomStatus; rotulo: string } {
  switch (alinhamento?.status) {
    case 'aligned':
      return { tom: 'sucesso', rotulo: 'Alinhado' }
    case 'needs_review':
      return { tom: 'aviso', rotulo: 'Revisão necessária' }
    case 'approved':
      return { tom: 'sucesso', rotulo: 'Revisado' }
    case 'failed':
      return { tom: 'perigo', rotulo: 'Falhou' }
    default:
      return { tom: 'pendente', rotulo: 'Pendente' }
  }
}

function ehAudioGravadoOuImportado(audio: BlocoNarracao['audio']): boolean {
  return audio?.engineId === 'recorded' || audio?.engineId === 'imported'
}

function ehBlocoPendente(bloco: BlocoNarracao): boolean {
  return (
    !bloco.audio ||
    bloco.audio.stale ||
    (bloco.audio.engineId === 'recorded' && !bloco.audio.trimmed) ||
    bloco.alignment?.status === 'needs_review'
  )
}

function criarMensagemErroTraduzida(erro: ErroCore) {
  const trad = mensagemDeErro(erro)
  return { titulo: trad.titulo }
}

/**
 * Passo 3 de Transformar: síntese TTS local just-in-time (3A), gravação com teleprompter (3B),
 * importação externa, aparo VAD, limpeza Antes/Depois e revisão de desvios de alinhamento.
 */
export function PassoNarracao({
  candidateId,
  store,
  modalPaiAberto = false,
  aoVoltarBlocoPendente,
  aoIrParaEmpacotar,
  aoIrParaEditar,
}: PassoNarracaoProps) {
  const toast = useToast()
  const jobs = useFila()

  const narracao = store.narracao
  const roteiro = store.roteiro
  const catalogoTts = store.catalogoTts
  const pocketTts = store.pocketTts

  const idiomaTts: 'pt' | 'en' = (narracao?.language ?? roteiro?.current?.language ?? 'pt')
    .toLowerCase()
    .startsWith('en')
    ? 'en'
    : 'pt'

  const pocketInstalado = Boolean(pocketTts?.installed ?? catalogoTts?.componentInstalled)
  const modelosIdioma = useMemo(
    () => (catalogoTts?.models ?? []).filter((m) => m.language === idiomaTts),
    [catalogoTts?.models, idiomaTts],
  )
  const modeloAtivoId =
    narracao?.activeModelId ||
    catalogoTts?.activeModels?.[idiomaTts] ||
    modelosIdioma.find((m) => m.defaultForLanguage)?.id ||
    modelosIdioma[0]?.id ||
    ''
  const modeloAtivo = useMemo(
    () => modelosIdioma.find((m) => m.id === modeloAtivoId) ?? modelosIdioma[0],
    [modelosIdioma, modeloAtivoId],
  )
  const modeloTtsInstalado = Boolean(modeloAtivo?.installed)
  const ttsPronto = pocketInstalado && modeloTtsInstalado

  const vozesDisponiveis = useMemo(
    () =>
      (catalogoTts?.voices ?? []).filter(
        (v) =>
          v.language === idiomaTts &&
          (!modeloAtivoId || v.models.length === 0 || v.models.includes(modeloAtivoId)),
      ),
    [catalogoTts?.voices, idiomaTts, modeloAtivoId],
  )

  const [vozSelecionada, setVozSelecionada] = useState<string>(
    narracao?.defaultVoiceId ?? vozesDisponiveis[0]?.id ?? '',
  )
  const [instaladorTtsAberto, setInstaladorTtsAberto] = useState(false)
  const [blocoGravador, setBlocoGravador] = useState<BlocoNarracao | null>(null)
  const [blocoParaImportar, setBlocoParaImportar] = useState<BlocoNarracao | null>(null)
  const [caminhoImportacao, setCaminhoImportacao] = useState('')
  const [ultimoBlocoImportacaoId, setUltimoBlocoImportacaoId] = useState<number | null>(null)
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoSobrescrita | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [ocupadoGlobal, setOcupadoGlobal] = useState(false)
  const [blocosOcupados, setBlocosOcupados] = useState<Set<number>>(() => new Set())
  const [preparandoLimpezaIds, setPreparandoLimpezaIds] = useState<Set<number>>(() => new Set())
  const [modoLimpezaPorBloco, setModoLimpezaPorBloco] = useState<
    Record<number, ModoComparacaoLimpeza>
  >({})

  const refsBlocos = useRef<Map<number, HTMLElement>>(new Map())

  useEffect(() => {
    const padrao = narracao?.defaultVoiceId || vozesDisponiveis[0]?.id || ''
    if (padrao && (!vozSelecionada || !vozesDisponiveis.some((v) => v.id === vozSelecionada))) {
      setVozSelecionada(padrao)
    }
  }, [narracao?.defaultVoiceId, vozSelecionada, vozesDisponiveis])

  useEffect(() => {
    setErroAcao(null)
    setInstaladorTtsAberto(false)
    setBlocoGravador(null)
    setBlocoParaImportar(null)
    setConfirmacao(null)
    setModoLimpezaPorBloco({})
  }, [candidateId])

  const marcarBlocoOcupado = useCallback((blockId: number, ativo: boolean) => {
    setBlocosOcupados((prev) => {
      const next = new Set(prev)
      if (ativo) next.add(blockId)
      else next.delete(blockId)
      return next
    })
  }, [])

  const executarComTratamento = useCallback(
    async (fn: () => Promise<void>, opcoes?: { blockId?: number; global?: boolean }) => {
      setErroAcao(null)
      if (opcoes?.global) setOcupadoGlobal(true)
      if (opcoes?.blockId !== undefined) marcarBlocoOcupado(opcoes.blockId, true)
      try {
        await fn()
      } catch (err) {
        const coreErr = paraErroCore(err)
        if (coreErr.code === 'component_missing' || coreErr.code === 'tts_model_missing') {
          setInstaladorTtsAberto(true)
        }
        setErroAcao(coreErr)
      } finally {
        if (opcoes?.global) setOcupadoGlobal(false)
        if (opcoes?.blockId !== undefined) marcarBlocoOcupado(opcoes.blockId, false)
      }
    },
    [marcarBlocoOcupado],
  )

  // Jobs ativos da Fila para Narração, alinhamento e TTS (residual job "0" já filtrado em useFila #293)
  const jobAtivoNarracao = useMemo(
    () =>
      jobs.find(
        (j) =>
          j.estado === 'rodando' &&
          (j.etapa === 'narration' ||
            j.etapa === 'narration_import' ||
            j.etapa === 'aligning' ||
            j.etapa === 'narration_record' ||
            j.id === 'narration_record'),
      ) ?? null,
    [jobs],
  )

  const cancelarJobAtivo = async () => {
    if (!jobAtivoNarracao) return
    const idNum = Number(jobAtivoNarracao.id)
    if (!Number.isInteger(idNum) || idNum <= 0) return
    await executarComTratamento(async () => {
      await chamar('jobs.cancel', { id: idNum })
      await store.recarregarNarracao()
    })
  }

  const dispararTtsTodos = async (jaConfirmado = false) => {
    if (!ttsPronto) {
      setInstaladorTtsAberto(true)
      return
    }
    const temGravacaoOuImportacao = Boolean(
      narracao?.blocks.some((b) => ehAudioGravadoOuImportado(b.audio)),
    )
    if (temGravacaoOuImportacao && !jaConfirmado) {
      setConfirmacao({ tipo: 'todos' })
      return
    }
    await executarComTratamento(
      async () => {
        await chamar('narration.generate', {
          candidate: candidateId,
          ...(vozSelecionada ? { voiceId: vozSelecionada } : {}),
        })
        await store.recarregarNarracao()
        toast.add({ title: 'Narração sintetizada para os blocos.' })
      },
      { global: true },
    )
  }

  const dispararTtsBloco = async (bloco: BlocoNarracao, jaConfirmado = false) => {
    if (!ttsPronto) {
      setInstaladorTtsAberto(true)
      return
    }
    if (ehAudioGravadoOuImportado(bloco.audio) && !jaConfirmado) {
      setConfirmacao({ tipo: 'bloco', blockId: bloco.blockId })
      return
    }
    await executarComTratamento(
      async () => {
        await chamar('narration.regenerate_block', {
          candidate: candidateId,
          block: bloco.blockId,
          ...(vozSelecionada ? { voiceId: vozSelecionada } : {}),
        })
        await store.recarregarNarracao()
      },
      { blockId: bloco.blockId },
    )
  }

  const executarImportacao = async (blockId: number, path: string) => {
    setUltimoBlocoImportacaoId(blockId)
    await executarComTratamento(
      async () => {
        await chamar('narration.import', {
          candidate: candidateId,
          block: blockId,
          path: path.trim(),
        })
        setBlocoParaImportar(null)
        setCaminhoImportacao('')
        await store.recarregarNarracao()
        toast.add({ title: 'Áudio importado para o bloco.' })
      },
      { blockId },
    )
  }

  const confirmarEnvioImportacao = async () => {
    if (!blocoParaImportar) return
    const caminhoLimpo = caminhoImportacao.trim()
    if (!caminhoLimpo) return
    if (blocoParaImportar.audio) {
      setConfirmacao({ tipo: 'importar', blockId: blocoParaImportar.blockId, path: caminhoLimpo })
      return
    }
    await executarImportacao(blocoParaImportar.blockId, caminhoLimpo)
  }

  const salvarGravacao = async (payload: AudioGravadoTeleprompter) => {
    await chamar('narration.record_block', {
      candidate: candidateId,
      block: payload.blockId,
      audioBase64: payload.audioBase64,
      mimeType: payload.mimeType,
    })
    await store.recarregarNarracao()
    toast.add({ title: 'Gravação salva no bloco.' })
  }

  const descartarRascunho = async (blockId: number) => {
    await executarComTratamento(async () => {
      await chamar('narration.discard_draft', {
        candidate: candidateId,
        block: blockId,
      })
    })
  }

  const apararSilencios = async (blockId: number) => {
    await executarComTratamento(
      async () => {
        await chamar('narration.trim_block', {
          candidate: candidateId,
          block: blockId,
        })
        await store.recarregarNarracao()
        toast.add({ title: 'Silêncios aparados.' })
      },
      { blockId },
    )
  }

  const alternarLimpeza = async (blockId: number, enabled: boolean) => {
    await executarComTratamento(
      async () => {
        await chamar('narration.cleanup.set', {
          candidate: candidateId,
          block: blockId,
          enabled,
        })
        await store.recarregarNarracao()
      },
      { blockId },
    )
  }

  const alternarModoComparacao = async (bloco: BlocoNarracao, modo: ModoComparacaoLimpeza) => {
    if (!bloco.audio?.cleanup) return
    if (modo === 'clean' && !bloco.audio.cleanup.ready) {
      // #306: narration.cleanup.prepare executa sincronamente sem core-progress; mantemos loading local por bloco
      setErroAcao(null)
      setPreparandoLimpezaIds((prev) => new Set(prev).add(bloco.blockId))
      try {
        await chamar('narration.cleanup.prepare', {
          candidate: candidateId,
          block: bloco.blockId,
        })
        setModoLimpezaPorBloco((prev) => ({ ...prev, [bloco.blockId]: 'clean' }))
        await store.recarregarNarracao()
      } catch (err) {
        setErroAcao(paraErroCore(err))
      } finally {
        setPreparandoLimpezaIds((prev) => {
          const next = new Set(prev)
          next.delete(bloco.blockId)
          return next
        })
      }
      return
    }
    setModoLimpezaPorBloco((prev) => ({ ...prev, [bloco.blockId]: modo }))
  }

  const alinharTodos = async () => {
    await executarComTratamento(
      async () => {
        await chamar('narration.align', { candidate: candidateId })
        await store.recarregarNarracao()
        toast.add({ title: 'Alinhamento atualizado.' })
      },
      { global: true },
    )
  }

  const realinharBloco = async (blockId: number) => {
    await executarComTratamento(
      async () => {
        await chamar('narration.align_block', { candidate: candidateId, block: blockId })
        await store.recarregarNarracao()
      },
      { blockId },
    )
  }

  const revisarDesvio = async (blockId: number, choice: 'script' | 'spoken') => {
    await executarComTratamento(
      async () => {
        await chamar('narration.review', { candidate: candidateId, block: blockId, choice })
        await store.recarregarNarracao()
        toast.add({
          title: choice === 'spoken' ? 'Texto falado aplicado às legendas.' : 'Texto do Roteiro mantido.',
        })
      },
      { blockId },
    )
  }

  const trocarModeloAtivo = async (modelId: string) => {
    await executarComTratamento(async () => {
      await chamar('tts.models.choose', { language: idiomaTts, modelId })
      await store.recarregarTts()
    })
  }

  const irParaBloco = (blockId: number) => {
    const el = refsBlocos.current.get(blockId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    el.focus()
  }

  if (store.carregando && !narracao) {
    return (
      <div className="mx-auto flex w-full max-w-[68ch] flex-col gap-3">
        <Esqueleto variante="painel" rotuloAcessivel="Carregando etapa de Narração" />
      </div>
    )
  }

  if (store.erro && !narracao) {
    const trad = mensagemDeErro(store.erro)
    return (
      <div className="mx-auto w-full max-w-[68ch]">
        <BannerErroCore
          erro={{ code: store.erro.code, message: store.erro.detalhe || store.erro.message }}
          traduzir={() => ({ titulo: trad.titulo })}
          acaoRecuperacao={{
            rotulo: 'Tentar novamente',
            aoAcionar: () => void store.recarregar(),
          }}
          permitirRelato
        />
      </div>
    )
  }

  // Estado travado pedagógico (ADR-0001)
  if (!narracao || !narracao.narrationAllowed || (roteiro !== null && !roteiro.narrationAllowed)) {
    const blocosRoteiro = roteiro?.current?.blocks ?? []
    const primeiroPendente = blocosRoteiro.find((b) => b.status !== 'aprovado')
    const qtdPendentes =
      roteiro?.current?.pending ?? blocosRoteiro.filter((b) => b.status !== 'aprovado').length

    const qtdPendentesReais = Math.max(1, qtdPendentes)
    const tituloTrava =
      narracao?.gateReason === 'no_script'
        ? 'Gere e aprove o Roteiro antes de narrar.'
        : narracao?.gateReason === 'generating'
          ? 'Geração do Roteiro em andamento — aguarde e aprove os blocos antes de narrar.'
          : `Narração travada: ainda há ${qtdPendentesReais} ${qtdPendentesReais === 1 ? 'bloco pendente' : 'blocos pendentes'} no Roteiro.`

    return (
      <section aria-label="Narração travada" className="mx-auto flex w-full max-w-[68ch] flex-col gap-3">
        <div role="status" className="flex flex-col gap-3 rounded-area bg-area p-4">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="text-titulo font-forte text-t1">{tituloTrava}</h2>
              <p className="text-base text-t2">
                Pela regra de Transformação, a etapa de Narração só é liberada depois que você revisar
                e aprovar todos os blocos do Roteiro.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Botao
              variante={modalPaiAberto ? 'secundario' : 'primario'}
              onClick={() => aoVoltarBlocoPendente(primeiroPendente?.id)}
            >
              Voltar ao próximo bloco pendente
            </Botao>
          </div>
        </div>
      </section>
    )
  }

  const blocos = narracao.blocks
  const algumComAudio = blocos.some((b) => Boolean(b.audio))
  const blocosSemAudio = blocos.filter((b) => !b.audio).length
  const blocosRevisao = blocos.filter((b) => b.alignment?.status === 'needs_review').length
  const blocosSemVad = blocos.filter(
    (b) => b.audio?.engineId === 'recorded' && !b.audio.trimmed,
  ).length
  const blocosDesatualizados = blocos.filter((b) => b.audio?.stale).length
  const primeiroBlocoPendente = blocos.find(ehBlocoPendente)
  const narracaoParcial =
    algumComAudio &&
    (blocosSemAudio > 0 || blocosRevisao > 0 || blocosSemVad > 0 || blocosDesatualizados > 0)
  const modalAberto = Boolean(
    modalPaiAberto ||
      instaladorTtsAberto ||
      blocoGravador !== null ||
      blocoParaImportar !== null ||
      confirmacao !== null,
  )
  const qtdGravadosOuImportados = blocos.filter((b) => ehAudioGravadoOuImportado(b.audio)).length

  const opcoesVozes = vozesDisponiveis.map((v) => ({
    valor: v.id,
    rotulo: `${v.label} · ${v.license}`,
    descricao: v.attribution,
  }))
  const opcoesModelos = modelosIdioma.map((m) => ({
    valor: m.id,
    rotulo: m.label,
    descricao: m.description,
  }))

  const recuperarErroAcao = (() => {
    if (!erroAcao) return undefined
    if (erroAcao.code === 'component_missing' || erroAcao.code === 'tts_model_missing') {
      return {
        rotulo: 'Preparar voz local',
        aoAcionar: () => {
          setInstaladorTtsAberto(true)
          setErroAcao(null)
        },
      }
    }
    if (CODIGOS_IMPORTACAO.has(erroAcao.code)) {
      return {
        rotulo: 'Escolher outro arquivo',
        aoAcionar: () => {
          const alvo =
            blocos.find((b) => b.blockId === ultimoBlocoImportacaoId) ?? blocos[0] ?? null
          setErroAcao(null)
          if (alvo) {
            setCaminhoImportacao('')
            setBlocoParaImportar(alvo)
          }
        },
      }
    }
    const trad = mensagemDeErro(erroAcao)
    if (trad.recuperacao?.rota) {
      const rotaDestino = trad.recuperacao.rota
      return {
        rotulo: trad.recuperacao.rotulo,
        aoAcionar: () => {
          window.location.hash = rotaDestino
        },
      }
    }
    return undefined
  })()

  return (
    <section aria-label="Passo 3: Narração" className="mx-auto flex w-full max-w-[68ch] flex-col gap-3">
      {/* Resumo e ações globais */}
      <div className="flex flex-col gap-3 rounded-area bg-area p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3 text-pequeno text-t2">
            <h2 className="m-0 text-titulo font-forte tracking-[-0.01em] text-t1">
              3. Narração
            </h2>
            <span>
              Idioma: <strong className="font-medio text-t1">{idiomaTts === 'en' ? 'EN' : 'PT-BR'}</strong>
            </span>
            <span>
              Duração total:{' '}
              <strong className="num font-medio text-t1">
                {duracao(narracao.totalDurationUs)}
              </strong>
            </span>
            {narracao.alignPrerequisitesReady ? (
              <Status tom="sucesso">Alinhamento: Pronto</Status>
            ) : (
              <Status tom="aviso">Alinhamento indisponível</Status>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Botao variante="secundario" tamanho="p" onClick={aoIrParaEditar}>
              Ajustar na timeline (Editar)
            </Botao>
            <Botao
              variante={modalAberto ? 'secundario' : 'primario'}
              tamanho="p"
              icone={<ArrowRight />}
              onClick={aoIrParaEmpacotar}
            >
              Avançar para Empacotar
            </Botao>
          </div>
        </div>

        {!narracao.alignPrerequisitesReady && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-controle bg-elevado px-3 py-2 text-pequeno text-t2">
            <span>
              Alinhamento de legendas indisponível: instale o Motor de transcrição local em
              Configurações → Componentes para gerar legendas da Narração.
            </span>
            <a
              href="#/config/componentes"
              className="inline-flex min-h-6 items-center text-t1 underline hover:text-t2"
            >
              Abrir Componentes
            </a>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {opcoesVozes.length > 0 && (
            <div className="min-w-[200px] flex-1">
              <Select
                rotulo="Voz"
                valor={vozSelecionada || null}
                aoMudar={setVozSelecionada}
                opcoes={opcoesVozes}
                desabilitado={!ttsPronto || opcoesVozes.length === 0}
                placeholder="Selecione a voz"
              />
            </div>
          )}
          {opcoesModelos.length > 1 && (
            <div className="min-w-[180px]">
              <Select
                rotulo="Modelo ativo"
                valor={modeloAtivoId || null}
                aoMudar={(v) => void trocarModeloAtivo(v)}
                opcoes={opcoesModelos}
                placeholder="Modelo TTS"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<Sparkles />}
              carregando={ocupadoGlobal}
              disabled={blocos.length === 0 || narracao.busy}
              onClick={() => void dispararTtsTodos(false)}
            >
              Gerar voz de todos os blocos (TTS)
            </Botao>
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<RefreshCw />}
              disabled={!algumComAudio || !narracao.alignPrerequisitesReady || narracao.alignBusy}
              onClick={() => void alinharTodos()}
            >
              Alinhar todos os blocos
            </Botao>
          </div>
        </div>
      </div>

      {/* Sub-superfície 3A: Instalador just-in-time de pocket-tts e modelo TTS */}
      {!ttsPronto && !instaladorTtsAberto && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-area bg-area px-3 py-2 text-pequeno text-t2">
          <span>
            Motor ou modelo de voz local (TTS) pendente para {idiomaTts === 'en' ? 'EN' : 'PT-BR'}.
            Você ainda pode gravar ou importar áudio normalmente.
          </span>
          <Botao
            variante="secundario"
            tamanho="p"
            icone={<Download />}
            onClick={() => setInstaladorTtsAberto(true)}
          >
            Preparar voz local (TTS)
          </Botao>
        </div>
      )}

      {instaladorTtsAberto && (
        <InstaladorJustInTime
          recurso="tts"
          idioma={idiomaTts}
          modo="inline"
          aoFechar={() => setInstaladorTtsAberto(false)}
          aoConcluir={() => {
            setInstaladorTtsAberto(false)
            void store.recarregarTts()
          }}
        />
      )}

      {/* Progresso de job ativo na Fila */}
      {jobAtivoNarracao && (
        <FaixaJob
          rotulo={
            jobAtivoNarracao.etapa === 'vad' || jobAtivoNarracao.id === 'narration_record'
              ? 'Detectando fala e aparando silêncios…'
              : jobAtivoNarracao.mensagem || 'Processando Narração…'
          }
          aoCancelar={
            Number.isInteger(Number(jobAtivoNarracao.id)) && Number(jobAtivoNarracao.id) > 0
              ? () => void cancelarJobAtivo()
              : undefined
          }
        >
          <Progresso
            valor={jobAtivoNarracao.percentual}
            rotulo={jobAtivoNarracao.mensagem || 'Processando Narração'}
            compacto
          />
        </FaixaJob>
      )}

      {/* Erros em role="alert" */}
      {erroAcao && (
        <BannerErroCore
          erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
          traduzir={() => criarMensagemErroTraduzida(erroAcao)}
          acaoRecuperacao={recuperarErroAcao}
          aoDispensar={() => setErroAcao(null)}
          permitirRelato
        />
      )}

      {/* Orientação inicial quando nenhum bloco tem áudio */}
      {!algumComAudio && blocos.length > 0 && (
        <p className="m-0 rounded-area bg-area px-3 py-2.5 text-base text-t2">
          Roteiro aprovado. Escolha como dar voz a este vídeo: gere localmente com TTS, grave lendo
          o teleprompter ou importe um áudio.
        </p>
      )}

      {/* Faixa de estado parcial */}
      {narracaoParcial && primeiroBlocoPendente && (
        <EstadoTela
          tipo="parcial"
          compacto
          titulo="Narração parcial:"
          descricao={[
            blocosSemAudio > 0 ? `${blocosSemAudio} sem áudio` : null,
            blocosDesatualizados > 0
              ? `${blocosDesatualizados} ${blocosDesatualizados === 1 ? 'desatualizado' : 'desatualizados'}`
              : null,
            blocosSemVad > 0 ? `${blocosSemVad} sem aparo de silêncios` : null,
            blocosRevisao > 0 ? `${blocosRevisao} aguardando revisão de alinhamento` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          acaoPrimaria={{
            rotulo: 'Ir para o próximo pendente',
            aoAcionar: () => irParaBloco(primeiroBlocoPendente.blockId),
          }}
        />
      )}

      {/* Cartões por bloco */}
      <div className="flex flex-col gap-3">
        {blocos.map((bloco) => {
          const origem = infoOrigemAudio(bloco.audio, catalogoTts?.voices)
          const alinhamento = infoAlinhamento(bloco.alignment)
          const ocupadoBloco = blocosOcupados.has(bloco.blockId)
          const preparandoLimpeza = preparandoLimpezaIds.has(bloco.blockId)
          const modoLimpeza: ModoComparacaoLimpeza =
            modoLimpezaPorBloco[bloco.blockId] ?? 'original'
          const fonteAudioUrl = bloco.audio
            ? mediaUrl(
                (modoLimpeza === 'clean' && bloco.audio.cleanup?.ready
                  ? 'narration-clean/'
                  : 'narration-original/') + bloco.audio.id,
              )
            : null

          return (
            <article
              key={bloco.blockId}
              tabIndex={-1}
              ref={(el) => {
                if (el) refsBlocos.current.set(bloco.blockId, el)
                else refsBlocos.current.delete(bloco.blockId)
              }}
              aria-label={`Bloco ${bloco.position}: ${bloco.title}`}
              className="flex flex-col gap-2.5 rounded-area bg-area p-3 outline-none focus-visible:outline-2 focus-visible:outline-foco"
            >
              {/* Cabeçalho do bloco */}
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-base font-forte text-t1">
                  Bloco {bloco.position} · {bloco.title}
                </strong>
                <Status tom={origem.tom}>{origem.rotulo}</Status>
                {bloco.audio && (
                  <span className="num text-pequeno text-t3">
                    {duracao(bloco.audio.durationUs)}
                  </span>
                )}
                {bloco.audio?.stale && (
                  <Status tom="aviso">Desatualizado (Roteiro alterado)</Status>
                )}
                {bloco.audio && <Status tom={alinhamento.tom}>{alinhamento.rotulo}</Status>}
              </div>

              {/* Texto aprovado */}
              <p className="m-0 max-w-[68ch] text-base text-t2">
                {bloco.narrationText || 'Sem texto aprovado neste bloco.'}
              </p>

              {/* 3 caminhos de criação/substituição + Remover áudio desabilitado (#306) */}
              <div className="flex flex-wrap items-center gap-2">
                <Botao
                  variante="secundario"
                  tamanho="p"
                  icone={<Sparkles />}
                  carregando={ocupadoBloco}
                  disabled={ocupadoBloco}
                  onClick={() => void dispararTtsBloco(bloco, false)}
                >
                  {bloco.audio?.engineId === 'pocket-tts' ? 'Regenerar TTS' : 'Gerar com voz (TTS)'}
                </Botao>
                <Botao
                  variante="secundario"
                  tamanho="p"
                  icone={<Mic />}
                  disabled={ocupadoBloco}
                  onClick={() => setBlocoGravador(bloco)}
                >
                  Gravar no microfone
                </Botao>
                <Botao
                  variante="secundario"
                  tamanho="p"
                  icone={<Upload />}
                  disabled={ocupadoBloco}
                  onClick={() => {
                    setCaminhoImportacao('')
                    setBlocoParaImportar(bloco)
                  }}
                >
                  Importar áudio
                </Botao>

                {bloco.audio && (
                  /* Pendência #306: aguarda narration.delete_block no núcleo */
                  <Dica texto="Voltar a Sem áudio ainda não está disponível; substitua por TTS, gravação ou importação.">
                    <Botao
                      variante="fantasma"
                      tamanho="p"
                      icone={<Trash2 />}
                      aria-disabled="true"
                    >
                      Remover áudio
                    </Botao>
                  </Dica>
                )}
              </div>

              {/* Aparo VAD pós-gravação */}
              {bloco.audio?.engineId === 'recorded' && !bloco.audio.trimmed && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-controle bg-elevado px-3 py-2 text-pequeno text-t2">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="size-[14px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
                    Silêncios não foram aparados na gravação
                  </span>
                  {narracao.vadReady ? (
                    <Botao
                      variante="secundario"
                      tamanho="p"
                      icone={<Scissors />}
                      disabled={ocupadoBloco}
                      onClick={() => void apararSilencios(bloco.blockId)}
                    >
                      Aparar silêncios agora
                    </Botao>
                  ) : (
                    <a
                      href="#/config/componentes"
                      className="inline-flex min-h-6 items-center text-t1 underline hover:text-t2"
                    >
                      Instalar Worker em Componentes
                    </a>
                  )}
                </div>
              )}

              {/* Player e limpeza Antes/Depois (gravado ou importado) */}
              {bloco.audio && fonteAudioUrl && (
                <div className="flex flex-col gap-2 rounded-controle bg-elevado p-2.5">
                  {bloco.audio.cleanup?.applicable && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Switch
                        ligado={bloco.audio.cleanup.enabled}
                        desabilitado={ocupadoBloco}
                        aoMudar={(v) => void alternarLimpeza(bloco.blockId, v)}
                      >
                        Limpeza de voz (remove ruído de fundo e grave)
                      </Switch>
                      <span className="text-pequeno text-t3">
                        {bloco.audio.cleanup.noiseFloorSource === 'vad'
                          ? 'Ruído medido nos silêncios'
                          : 'Piso padrão aplicado'}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Volume2 className="size-[14px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
                    <PlayerAudioBloco
                      src={fonteAudioUrl}
                      duracaoUs={bloco.audio.durationUs}
                      posicaoBloco={bloco.position}
                    />

                    {bloco.audio.cleanup?.applicable && (
                      <Segmentado<ModoComparacaoLimpeza>
                        rotulo="Comparar limpeza de voz"
                        valor={modoLimpeza}
                        aoMudar={(m) => void alternarModoComparacao(bloco, m)}
                        opcoes={[
                          { valor: 'original', rotulo: 'Antes (original)' },
                          { valor: 'clean', rotulo: 'Depois (limpa)', desabilitada: preparandoLimpeza },
                        ]}
                      />
                    )}

                    <Botao
                      variante="fantasma"
                      tamanho="p"
                      icone={<RefreshCw />}
                      disabled={!narracao.alignPrerequisitesReady || ocupadoBloco}
                      onClick={() => void realinharBloco(bloco.blockId)}
                    >
                      Re-alinhar bloco
                    </Botao>
                  </div>

                  {preparandoLimpeza && (
                    <Status tom="rodando">Preparando áudio limpo…</Status>
                  )}
                </div>
              )}

              {/* Revisão de desvio (needs_review) */}
              {bloco.alignment?.status === 'needs_review' && (
                <div className="flex flex-col gap-2.5 rounded-controle bg-elevado p-3">
                  <p className="m-0 text-pequeno font-medio text-t1">
                    O áudio falado diferiu do Roteiro (
                    <span className="num">{bloco.alignment.insertions}</span>{' '}
                    {bloco.alignment.insertions === 1 ? 'acréscimo' : 'acréscimos'},{' '}
                    <span className="num">{bloco.alignment.substitutions}</span>{' '}
                    {bloco.alignment.substitutions === 1 ? 'troca' : 'trocas'}). Escolha qual texto
                    vai para as legendas:
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-controle bg-chao p-2.5">
                      <div className="mb-1 text-micro font-medio text-t3">Roteiro aprovado</div>
                      <p className="m-0 text-pequeno text-t1">{bloco.narrationText}</p>
                    </div>
                    <div className="rounded-controle bg-chao p-2.5">
                      <div className="mb-1 text-micro font-medio text-t3">Detectado na fala</div>
                      <p className="m-0 text-pequeno text-t1">{bloco.alignment.spokenText}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Botao
                      variante="secundario"
                      tamanho="p"
                      icone={<Check />}
                      disabled={ocupadoBloco}
                      onClick={() => void revisarDesvio(bloco.blockId, 'script')}
                    >
                      Usar texto do Roteiro
                    </Botao>
                    <Botao
                      variante="secundario"
                      tamanho="p"
                      icone={<Check />}
                      disabled={ocupadoBloco}
                      onClick={() => void revisarDesvio(bloco.blockId, 'spoken')}
                    >
                      Usar texto falado
                    </Botao>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {/* Sub-superfície 3B: Gravador com Teleprompter */}
      <GravadorTeleprompter
        aberto={blocoGravador !== null}
        bloco={
          blocoGravador
            ? {
                id: blocoGravador.blockId,
                position: blocoGravador.position,
                title: blocoGravador.title,
                narration: blocoGravador.narrationText,
              }
            : null
        }
        totalBlocos={blocos.length}
        aoSalvarAudio={salvarGravacao}
        aoDescartarRascunho={descartarRascunho}
        aoAlternarParaImportar={() => {
          const alvo = blocoGravador
          setBlocoGravador(null)
          if (alvo) {
            setCaminhoImportacao('')
            setBlocoParaImportar(alvo)
          }
        }}
        aoAlternarParaTts={() => {
          const alvo = blocoGravador
          setBlocoGravador(null)
          if (alvo) void dispararTtsBloco(alvo, false)
        }}
        aoFechar={() => setBlocoGravador(null)}
      />

      {/* Diálogo de Importação de Áudio */}
      <Dialogo
        aberto={blocoParaImportar !== null}
        aoMudarAberto={(v) => {
          if (!v) setBlocoParaImportar(null)
        }}
        titulo={
          blocoParaImportar
            ? `Importar áudio · Bloco ${blocoParaImportar.position}: ${blocoParaImportar.title}`
            : 'Importar áudio'
        }
        largura={500}
        rodape={
          <>
            <Botao variante="fantasma" onClick={() => setBlocoParaImportar(null)}>
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              icone={<Upload />}
              disabled={!caminhoImportacao.trim()}
              onClick={() => void confirmarEnvioImportacao()}
            >
              Importar
            </Botao>
          </>
        }
      >
        <SeletorCaminho
          rotulo="Arquivo de áudio"
          modo="arquivo"
          valor={caminhoImportacao}
          aoMudar={setCaminhoImportacao}
          ajuda="Envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB."
          placeholder="C:\Audios\narracao.wav ou /tmp/narracao.wav"
        />
      </Dialogo>

      {/* Confirmação de sobrescrita de áudio gravado/importado */}
      <ConfirmDialog
        aberto={confirmacao !== null}
        aoMudarAberto={(v) => {
          if (!v) setConfirmacao(null)
        }}
        titulo="Substituir áudio existente?"
        descricao={
          confirmacao?.tipo === 'importar'
            ? 'Este bloco já possui áudio. Importar este arquivo substituirá o áudio atual do bloco.'
            : qtdGravadosOuImportados === 1
              ? 'Há 1 bloco com áudio gravado ou importado. Gerar voz com TTS substituirá esse áudio.'
              : `Há ${qtdGravadosOuImportados} blocos com áudio gravado ou importado. Gerar voz com TTS substituirá esse áudio.`
        }
        rotuloConfirmar={confirmacao?.tipo === 'importar' ? 'Substituir áudio' : 'Substituir por TTS'}
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        aoConfirmar={async () => {
          const atual = confirmacao
          setConfirmacao(null)
          if (!atual) return
          if (atual.tipo === 'todos') {
            await dispararTtsTodos(true)
          } else if (atual.tipo === 'bloco') {
            const alvo = blocos.find((b) => b.blockId === atual.blockId)
            if (alvo) await dispararTtsBloco(alvo, true)
          } else if (atual.tipo === 'importar') {
            await executarImportacao(atual.blockId, atual.path)
          }
        }}
      />
    </section>
  )
}
