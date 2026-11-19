import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  BannerErroCore,
  Botao,
  ChecklistGuardaCorpos,
  Dialogo,
  Esqueleto,
  EstadoTela,
  FaixaJob,
  Progresso,
  Status,
  useToast,
  type ItemGuarda,
} from '@ds'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import type { FonteProjeto } from '~/stores/fontesProjeto'

export type CorteParaExportar = {
  corteId: string
  titulo: string
  videoKind: 'direct' | 'transformed'
  sourceId: number
  startId: number
  endId: number
  candidateId?: number | null
  clipId?: number
}

export type DialogoExportarCorteProps = {
  aberto: boolean
  aoFechar: () => void
  projetoId: string
  corte: CorteParaExportar | null
  fonte: FonteProjeto | null
  clipId?: number
  startId?: number
  endId?: number
  candidateId?: number | null
  aoAntesDeAbrir?: () => Promise<boolean>
  aoIrParaTranscricao?: (posicao?: number) => void
  aoIrParaAudio?: () => void
  aoFonteRelocalizada?: (fonteAtualizada: FonteProjeto) => void
  fila?: Fila
}

type GuardrailsCheckResposta = {
  scope: 'single' | 'source' | 'project'
  directMonetizationAck: boolean
  needsDirectNotice: boolean
  videoKind: 'direct' | 'transformed' | 'mixed'
  over60s: boolean
  permission: {
    status: 'granted' | 'partial' | 'none'
    who?: string | null
    where?: string | null
    scope?: string | null
  }
  script?: {
    applicable: boolean
    exists?: boolean
    approved?: boolean
    pendingBlocks?: number
    totalBlocks?: number
  }
  narration?: {
    applicable: boolean
    hasTts?: boolean
    generatedBlocks?: number
    totalBlocks?: number
    voices?: string[]
    freezeTailUs?: number
    longFreezeTail?: boolean
  }
  audio?: {
    hasAudio: boolean
    assetCount?: number
    unverifiedCount: number
  }
}

type MissingGlyphItem = {
  position: number
  sentence_id?: number | null
  word: string
  char: string
  codepoint: string
  start_us: number
}

type ExportCaptionsResposta = {
  missingGlyphs?: MissingGlyphItem[]
  emojiRemoved?: number
}

type ExportSettingsResposta = {
  last_directory: string | null
}

type ExportStartResposta = {
  job: number
  state: string
}

type ExportStatusResposta = {
  job: number
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
  progress: number
  output: string
  error: { code: string; message?: string; usage?: { missing_glyphs?: MissingGlyphItem[] } } | null
  encoder: string | null
  encoderFallback: { from: string; reason: string } | null
}

function sugerirNomeArquivoMp4(titulo: string, fallbackId: number | string): string {
  let limpo = titulo
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\.mp4$/i, '')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100)
    .replace(/[. ]+$/g, '')
  if (!limpo || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(limpo)) {
    limpo = `corte-${fallbackId}`
  }
  return `${limpo}.mp4`
}

function juntarCaminho(diretorio: string | null | undefined, arquivo: string): string {
  const dir = diretorio?.trim()
  if (!dir) return arquivo
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${arquivo}`
}

function formatarSegundos(us: number): string {
  return (us / 1_000_000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

async function selecionarArquivoDialogo(
  kind: 'open' | 'save',
  defaultPath?: string,
): Promise<string | null> {
  const e2e = typeof window !== 'undefined' ? window.__CLIPES_E2E__ : undefined
  if (e2e) {
    e2e.dialogCalls.push({
      kind,
      options:
        kind === 'save'
          ? { defaultPath, filters: [{ name: 'MP4', extensions: ['mp4'] }] }
          : { directory: false, multiple: false },
    })
    return e2e.dialogQueue.length > 0 ? (e2e.dialogQueue.shift() ?? null) : null
  }
  if (isTauri()) {
    const cmd = kind === 'save' ? 'plugin:dialog|save' : 'plugin:dialog|open'
    const options =
      kind === 'save'
        ? {
            title: 'Salvar Corte em MP4',
            defaultPath,
            filters: [{ name: 'MP4', extensions: ['mp4'] }],
          }
        : { directory: false, multiple: false }
    const selecionado = await invoke<string | string[] | null>(cmd, { options })
    return Array.isArray(selecionado) ? (selecionado[0] ?? null) : selecionado
  }
  return null
}

function construirItensGuarda(
  guardrails: GuardrailsCheckResposta,
  captions: ExportCaptionsResposta | null,
  ackEmCurso: boolean,
  aoConfirmarDireto: () => void,
  aoIrParaAudio?: () => void,
): ItemGuarda[] {
  const itens: ItemGuarda[] = []

  if (guardrails.permission.status === 'granted') {
    const detalhe = [
      guardrails.permission.who,
      guardrails.permission.where,
      guardrails.permission.scope,
    ]
      .filter(Boolean)
      .join(' · ')
    itens.push({
      id: 'permissao',
      estado: 'ok',
      titulo: 'Permissão da Fonte registrada',
      detalhe: detalhe || undefined,
    })
  } else {
    itens.push({
      id: 'permissao',
      estado: 'atencao',
      titulo: 'Fonte sem Permissão registrada',
      detalhe: 'Pode haver reivindicação de direitos autorais mesmo com crédito.',
    })
  }

  if (guardrails.videoKind === 'direct') {
    if (guardrails.needsDirectNotice && !guardrails.directMonetizationAck) {
      itens.push({
        id: 'corte-direto',
        estado: 'atencao',
        titulo: 'Aviso de Corte direto: monetização pode ser recusada por conteúdo reutilizado',
        detalhe: 'Este aviso aparece uma única vez por Perfil de canal e não bloqueia a exportação.',
        acao: {
          rotulo: ackEmCurso ? 'Confirmando…' : 'Entendi o risco',
          aoAcionar: aoConfirmarDireto,
        },
      })
    } else {
      itens.push({
        id: 'corte-direto',
        estado: 'ok',
        titulo: 'Aviso de Corte direto confirmado para este canal',
      })
    }
  }

  if (guardrails.script?.applicable) {
    if (guardrails.script.approved) {
      itens.push({
        id: 'roteiro',
        estado: 'ok',
        titulo: `Roteiro aprovado (${guardrails.script.totalBlocks ?? 0} blocos)`,
      })
    } else {
      itens.push({
        id: 'roteiro',
        estado: 'pendente',
        titulo: 'Roteiro ainda não foi totalmente aprovado',
        detalhe: 'Revise e aprove os blocos na sub-aba Transformar para habilitar a Narração.',
      })
    }
  }

  if (guardrails.narration?.applicable && guardrails.narration.longFreezeTail) {
    const seg = formatarSegundos(guardrails.narration.freezeTailUs ?? 0)
    itens.push({
      id: 'cauda-narracao',
      estado: 'atencao',
      titulo: `Sobra final longa da Narração (${seg} s > 5 s)`,
      detalhe: 'O último quadro ficará congelado ao fim do vídeo.',
    })
  }

  if (guardrails.audio?.hasAudio) {
    if (guardrails.audio.unverifiedCount > 0) {
      itens.push({
        id: 'audio',
        estado: 'atencao',
        titulo: `${guardrails.audio.unverifiedCount} trilha/SFX com licença não verificada`,
        detalhe: 'Músicas sem origem registrada podem gerar claim no Content ID.',
        acao: aoIrParaAudio
          ? {
              rotulo: 'Abrir Áudio e SFX',
              aoAcionar: aoIrParaAudio,
            }
          : undefined,
      })
    } else {
      itens.push({
        id: 'audio',
        estado: 'ok',
        titulo: 'Trilha sonora e efeitos com licença registrada',
      })
    }
  }

  if (guardrails.over60s) {
    itens.push({
      id: 'duracao',
      estado: 'atencao',
      titulo: 'Corte acima de 60 s',
      detalhe: 'Shorts com mais de 1 minuto e música protegida ficam inelegíveis para monetização.',
    })
  } else {
    itens.push({
      id: 'duracao',
      estado: 'ok',
      titulo: 'Duração dentro de 60 s',
    })
  }

  if ((captions?.emojiRemoved ?? 0) > 0) {
    itens.push({
      id: 'emojis',
      estado: 'ok',
      titulo: `${captions?.emojiRemoved} emoji(s) removido(s) automaticamente das legendas`,
    })
  }

  return itens
}

/** Modal pré-exportação e acompanhamento individual MP4 (1080×1920) com guardrails e `#289`/`#303`. */
export function DialogoExportarCorte({
  aberto,
  aoFechar,
  projetoId,
  corte,
  fonte,
  clipId: clipIdProp,
  startId: startIdProp,
  endId: endIdProp,
  candidateId: candidateIdProp,
  aoAntesDeAbrir,
  aoIrParaTranscricao,
  aoIrParaAudio,
  aoFonteRelocalizada,
  fila,
}: DialogoExportarCorteProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const forcado = useEstadoForcado()
  const jobs = useFila(fila)
  const refDestino = useRef<HTMLInputElement>(null)

  const startId = startIdProp ?? corte?.startId
  const endId = endIdProp ?? corte?.endId
  const candidateId = candidateIdProp !== undefined ? candidateIdProp : corte?.candidateId
  const clipId = clipIdProp ?? corte?.clipId
  const sourceId = fonte?.id ?? corte?.sourceId

  const [fonteLocal, setFonteLocal] = useState<FonteProjeto | null>(fonte)
  const [carregando, setCarregando] = useState(false)
  const [erroCarga, setErroCarga] = useState<ErroCore | null>(null)
  const [guardrails, setGuardrails] = useState<GuardrailsCheckResposta | null>(null)
  const [captions, setCaptions] = useState<ExportCaptionsResposta | null>(null)
  const [destino, setDestino] = useState('')
  const destinoCorteIdRef = useRef<string | null>(null)
  const [erroDestino, setErroDestino] = useState<string | undefined>(undefined)
  const [ackEmCurso, setAckEmCurso] = useState(false)

  const [enviando, setEnviando] = useState(false)
  const [erroExportacao, setErroExportacao] = useState<ErroCore | null>(null)
  const [jobAtivoId, setJobAtivoId] = useState<number | null>(null)
  const jobAtivoIdRef = useRef<number | null>(null)
  jobAtivoIdRef.current = jobAtivoId
  const [statusFinal, setStatusFinal] = useState<ExportStatusResposta | null>(null)

  const [relocalizando, setRelocalizando] = useState(false)
  const [mostrarInputRelocalizar, setMostrarInputRelocalizar] = useState(false)
  const [caminhoRelocalizar, setCaminhoRelocalizar] = useState('')
  const [erroRelocalizar, setErroRelocalizar] = useState<ErroCore | null>(null)
  const [recarregarSeq, setRecarregarSeq] = useState(0)

  const aoAntesDeAbrirRef = useRef(aoAntesDeAbrir)
  aoAntesDeAbrirRef.current = aoAntesDeAbrir
  const aoFecharRef = useRef(aoFechar)
  aoFecharRef.current = aoFechar

  useEffect(() => {
    setFonteLocal(fonte)
  }, [fonte])

  const fonteEfetiva = fonteLocal ?? fonte
  const fonteBloqueada =
    forcado === 'offline' ||
    (fonteEfetiva != null && (fonteEfetiva.status === 'offline' || fonteEfetiva.status === 'changed' || !fonteEfetiva.available))

  // Carrega ao abrir (executando aoAntesDeAbrir / editor.flush primeiro)
  useEffect(() => {
    if (!aberto) return
    if (!corte || !sourceId || !startId || !endId) {
      setCarregando(false)
      return
    }
    if (forcado === 'carregando') {
      setCarregando(true)
      return
    }
    if (forcado === 'vazio') {
      setCarregando(false)
      return
    }

    let cancelado = false
    setCarregando(true)
    setErroCarga(null)
    setErroExportacao(null)
    setErroDestino(undefined)
    setErroRelocalizar(null)
    if (jobAtivoIdRef.current == null) {
      setStatusFinal(null)
    }

    void (async () => {
      if (aoAntesDeAbrirRef.current) {
        try {
          const ok = await aoAntesDeAbrirRef.current()
          if (cancelado) return
          if (!ok) {
            setCarregando(false)
            aoFecharRef.current()
            return
          }
        } catch (err) {
          if (cancelado) return
          setErroCarga(paraErroCore(err))
          setCarregando(false)
          return
        }
      }

      if (fonteBloqueada) {
        setCarregando(false)
        return
      }

      try {
        const reqBase = {
          source_id: sourceId,
          start_id: startId,
          end_id: endId,
          ...(candidateId != null ? { candidate_id: candidateId } : {}),
          ...(clipId !== undefined ? { clip_id: clipId } : {}),
        }

        const [resGuardrails, resCaptions, resSettings] = await Promise.all([
          chamar<GuardrailsCheckResposta>('guardrails.check', { scope: 'single', ...reqBase }),
          chamar<ExportCaptionsResposta>('export.captions', reqBase),
          chamar<ExportSettingsResposta>('export.settings', {}),
        ])

        if (cancelado) return
        setGuardrails(resGuardrails)
        setCaptions(resCaptions)

        const nomeSugerido = sugerirNomeArquivoMp4(
          corte.titulo,
          candidateId ?? startId ?? corte.corteId,
        )
        const sugestaoCompleta = juntarCaminho(resSettings?.last_directory, nomeSugerido)
        const mesmoCorte = destinoCorteIdRef.current === corte.corteId
        destinoCorteIdRef.current = corte.corteId
        setDestino((atual) => (mesmoCorte && atual.trim() ? atual : sugestaoCompleta))
        setCarregando(false)
      } catch (err) {
        if (cancelado) return
        setErroCarga(paraErroCore(err))
        setCarregando(false)
      }
    })()

    return () => {
      cancelado = true
    }
  }, [
    aberto,
    candidateId,
    clipId,
    corte,
    endId,
    fonteBloqueada,
    forcado,
    recarregarSeq,
    sourceId,
    startId,
  ])

  const jobFilaAtivo = useMemo(() => {
    if (jobAtivoId == null) return undefined
    return jobs.find((j) => j.id === String(jobAtivoId))
  }, [jobAtivoId, jobs])

  // Consulta export.status assim que core-progress sinaliza término
  const statusConsultadoJobRef = useRef<number | null>(null)
  useEffect(() => {
    if (jobAtivoId == null || !jobFilaAtivo) return
    if (jobFilaAtivo.estado !== 'concluido' && jobFilaAtivo.estado !== 'falhou') return
    if (statusConsultadoJobRef.current === jobAtivoId) return
    statusConsultadoJobRef.current = jobAtivoId

    let cancelado = false
    void chamar<ExportStatusResposta>('export.status', { job: jobAtivoId })
      .then((res) => {
        if (cancelado) return
        setJobAtivoId(null)
        if (res.state === 'failed') {
          const erro = new ErroCore(
            res.error?.code ?? 'export_failed',
            res.error?.message ?? 'Falha ao exportar Corte.',
          )
          setErroExportacao(erro)
          return
        }
        if (res.state === 'cancelled') {
          toastRef.current.add({ title: 'Exportação cancelada.' })
          return
        }
        setStatusFinal(res)
        toastRef.current.add({ title: 'Corte exportado com sucesso.' })
      })
      .catch((err) => {
        if (cancelado) return
        setJobAtivoId(null)
        setErroExportacao(paraErroCore(err))
      })

    return () => {
      cancelado = true
    }
  }, [jobAtivoId, jobFilaAtivo])

  const confirmarDireto = useCallback(async () => {
    if (ackEmCurso) return
    setAckEmCurso(true)
    try {
      await chamar('guardrails.ack_direct_notice', {})
      setGuardrails((prev) =>
        prev ? { ...prev, directMonetizationAck: true, needsDirectNotice: false } : prev,
      )
    } catch (err) {
      setErroExportacao(paraErroCore(err))
    } finally {
      setAckEmCurso(false)
    }
  }, [ackEmCurso])

  const executarRelocalizacao = useCallback(
    async (novoCaminho: string) => {
      if (!fonteEfetiva || !novoCaminho.trim() || relocalizando) return
      setRelocalizando(true)
      setErroRelocalizar(null)
      try {
        const atualizada = await chamar<FonteProjeto>('sources.relocate', {
          id: fonteEfetiva.id,
          path: novoCaminho.trim(),
          confirmed: true,
        })
        setFonteLocal(atualizada)
        setMostrarInputRelocalizar(false)
        setCaminhoRelocalizar('')
        aoFonteRelocalizada?.(atualizada)
        setRecarregarSeq((n) => n + 1)
      } catch (err) {
        setErroRelocalizar(paraErroCore(err))
      } finally {
        setRelocalizando(false)
      }
    },
    [aoFonteRelocalizada, fonteEfetiva, relocalizando],
  )

  const iniciarRelocalizacao = useCallback(async () => {
    const escolhido = await selecionarArquivoDialogo('open')
    if (escolhido) {
      await executarRelocalizacao(escolhido)
      return
    }
    setMostrarInputRelocalizar(true)
    if (fonteEfetiva?.path) setCaminhoRelocalizar(fonteEfetiva.path)
  }, [executarRelocalizacao, fonteEfetiva?.path])

  const escolherDestino = useCallback(async (): Promise<string | null> => {
    const escolhido = await selecionarArquivoDialogo('save', destino || undefined)
    if (escolhido) {
      setErroDestino(undefined)
      return escolhido
    }
    return null
  }, [destino])

  const iniciarExportacao = useCallback(async () => {
    if (!corte || !sourceId || !startId || !endId || enviando || fonteBloqueada) return
    const saida = destino.trim()
    if (!saida || !/\.mp4$/i.test(saida)) {
      const msg = 'Escolha uma pasta existente e um nome terminado em .mp4.'
      setErroDestino(msg)
      setErroExportacao(new ErroCore('export_destination', msg))
      refDestino.current?.focus()
      return
    }

    setEnviando(true)
    setErroExportacao(null)
    setErroDestino(undefined)
    setStatusFinal(null)
    statusConsultadoJobRef.current = null

    try {
      const res = await chamar<ExportStartResposta>('export.start', {
        source_id: sourceId,
        start_id: startId,
        end_id: endId,
        ...(candidateId != null ? { candidate_id: candidateId } : {}),
        ...(clipId !== undefined ? { clip_id: clipId } : {}),
        output: saida,
      })
      setJobAtivoId(res.job)
    } catch (err) {
      const coreErr = paraErroCore(err)
      setErroExportacao(coreErr)
      if (coreErr.code === 'export_exists' || coreErr.code === 'export_destination') {
        setErroDestino(mensagemDeErro(coreErr).titulo)
        queueMicrotask(() => refDestino.current?.focus())
      }
    } finally {
      setEnviando(false)
    }
  }, [candidateId, clipId, corte, destino, endId, enviando, fonteBloqueada, sourceId, startId])

  const cancelarExportacao = useCallback(async () => {
    if (jobAtivoId == null) return
    try {
      await chamar('jobs.cancel', { id: jobAtivoId })
      setJobAtivoId(null)
      toast.add({ title: 'Exportação cancelada.' })
    } catch (err) {
      setErroExportacao(paraErroCore(err))
    }
  }, [jobAtivoId, toast])

  const missingGlyphs = captions?.missingGlyphs ?? []
  const emExecucao = jobAtivoId != null
  const percentualJob = jobFilaAtivo?.percentual ?? 0

  const itensGuarda = useMemo(() => {
    if (!guardrails) return []
    return construirItensGuarda(
      guardrails,
      captions,
      ackEmCurso,
      () => void confirmarDireto(),
      aoIrParaAudio
        ? () => {
            aoFechar()
            aoIrParaAudio()
          }
        : undefined,
    )
  }, [ackEmCurso, aoFechar, aoIrParaAudio, captions, confirmarDireto, guardrails])

  const podeIniciar =
    !carregando &&
    !enviando &&
    !emExecucao &&
    !fonteBloqueada &&
    Boolean(corte) &&
    missingGlyphs.length === 0 &&
    forcado !== 'vazio' &&
    forcado !== 'erro' &&
    !erroCarga

  function acaoRecuperacaoErro(erro: ErroCore): { rotulo: string; aoAcionar: () => void } | undefined {
    const rec = mensagemDeErro(erro).recuperacao
    if (erro.code === 'source_offline' || erro.code === 'source_changed') {
      return { rotulo: 'Relocalizar Fonte', aoAcionar: () => void iniciarRelocalizacao() }
    }
    if (erro.code === 'audio_asset_missing' && aoIrParaAudio) {
      return {
        rotulo: 'Abrir aba Áudio e SFX',
        aoAcionar: () => {
          aoFechar()
          aoIrParaAudio()
        },
      }
    }
    if (erro.code === 'export_glyph_missing' && aoIrParaTranscricao) {
      return {
        rotulo: 'Corrigir palavras na Transcrição',
        aoAcionar: () => {
          aoFechar()
          aoIrParaTranscricao(missingGlyphs[0]?.position)
        },
      }
    }
    if (erro.code === 'export_bounds' || erro.code === 'export_candidate') {
      return {
        rotulo: 'Voltar para Cortes',
        aoAcionar: () => {
          aoFechar()
          window.location.hash = `#/projeto/${encodeURIComponent(projetoId)}/cortes`
        },
      }
    }
    if (rec?.rota) {
      const rota = rec.rota
      return {
        rotulo: rec.rotulo,
        aoAcionar: () => {
          aoFechar()
          window.location.hash = rota
        },
      }
    }
    return undefined
  }

  const erroVazio = forcado === 'vazio' || !corte
  const erroOffline = fonteBloqueada
  const erroParaBanner =
    forcado === 'erro'
      ? new ErroCore('export_failed', 'Simulação de erro via ?estado=erro.')
      : erroCarga ?? erroExportacao

  const fallbackAtivo = Boolean(statusFinal?.encoderFallback) || (statusFinal != null && forcado === 'fallback')

  return (
    <Dialogo
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (!proximo) aoFechar()
      }}
      titulo="Exportar Corte em MP4 (1080×1920)"
      descricao={
        corte
          ? `Renderiza "${corte.titulo || `Corte #${corte.corteId}`}" em H.264 com normalização -14 LUFS.`
          : undefined
      }
      largura={560}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar}>
            {statusFinal ? 'Fechar' : 'Cancelar'}
          </Botao>
          {!statusFinal && (
            <Botao
              variante="primario"
              carregando={enviando}
              disabled={!podeIniciar}
              onClick={() => void iniciarExportacao()}
            >
              Iniciar exportação
            </Botao>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {carregando ? (
          <Esqueleto variante="formulario" quantidade={3} rotuloAcessivel="Carregando conferência de exportação" />
        ) : erroVazio ? (
          <EstadoTela
            tipo="vazio"
            titulo="Nenhum Corte selecionado"
            descricao="Abra ou aprove um Corte para configurar a exportação individual em MP4."
          />
        ) : erroOffline ? (
          <div className="flex flex-col gap-3">
            <BannerErroCore
              erro={{
                code: fonteEfetiva?.status === 'changed' ? 'source_changed' : 'source_offline',
                message: 'O arquivo da Fonte foi movido ou alterado. Relocalize a Fonte antes de exportar.',
              }}
              traduzir={(code) => mensagemDeErro(new ErroCore(code, ''))}
              acaoRecuperacao={{
                rotulo: relocalizando ? 'Relocalizando…' : 'Relocalizar Fonte',
                aoAcionar: () => void iniciarRelocalizacao(),
              }}
            />
            {mostrarInputRelocalizar && (
              <div className="flex flex-col gap-2 rounded-area bg-area p-3">
                <SeletorCaminho
                  rotulo="Novo arquivo da Fonte"
                  valor={caminhoRelocalizar}
                  aoMudar={setCaminhoRelocalizar}
                  modo="arquivo"
                  desabilitado={relocalizando}
                />
                <div className="flex justify-end">
                  <Botao
                    variante="secundario"
                    tamanho="p"
                    carregando={relocalizando}
                    disabled={!caminhoRelocalizar.trim()}
                    onClick={() => void executarRelocalizacao(caminhoRelocalizar)}
                  >
                    Confirmar relocalização
                  </Botao>
                </div>
              </div>
            )}
            {erroRelocalizar && (
              <BannerErroCore
                erro={{ code: erroRelocalizar.code, message: erroRelocalizar.detalhe }}
                traduzir={(code) => mensagemDeErro(new ErroCore(code, erroRelocalizar.detalhe))}
              />
            )}
          </div>
        ) : (
          <>
            {erroParaBanner && (
              <BannerErroCore
                erro={{ code: erroParaBanner.code, message: erroParaBanner.detalhe }}
                traduzir={(code) => mensagemDeErro(new ErroCore(code, erroParaBanner.detalhe))}
                acaoRecuperacao={
                  erroCarga
                    ? {
                        rotulo: 'Tentar novamente',
                        aoAcionar: () => setRecarregarSeq((n) => n + 1),
                      }
                    : acaoRecuperacaoErro(erroParaBanner)
                }
                permitirRelato={
                  erroParaBanner.code === 'export_ass_missing' ||
                  erroParaBanner.code === 'export_font_missing' ||
                  erroParaBanner.code === 'export_failed'
                }
              />
            )}

            {missingGlyphs.length > 0 && (
              <div role="alert" className="flex flex-col gap-2 rounded-area bg-area p-3 text-pequeno">
                <p className="font-medio text-erro">
                  A fonte da legenda não possui glifo para caracteres do texto:
                </p>
                <ul className="m-0 list-disc pl-4 text-t2">
                  {missingGlyphs.map((g) => (
                    <li key={`${g.position}-${g.codepoint}`}>
                      “{g.word}” ({g.char} · <span className="num">{g.codepoint}</span>)
                    </li>
                  ))}
                </ul>
                {aoIrParaTranscricao && (
                  <div>
                    <Botao
                      tamanho="p"
                      variante="secundario"
                      onClick={() => {
                        aoFechar()
                        aoIrParaTranscricao(missingGlyphs[0]?.position)
                      }}
                    >
                      Corrigir palavras na Transcrição
                    </Botao>
                  </div>
                )}
              </div>
            )}

            {guardrails && (
              <ChecklistGuardaCorpos
                escopo="single"
                itens={itensGuarda}
                abertoPorPadrao
                mostrarDivulgacaoIa={
                  guardrails.videoKind === 'transformed' && Boolean(guardrails.narration?.hasTts)
                }
                confirmado={guardrails.directMonetizationAck}
              />
            )}

            {!emExecucao && !statusFinal && (
              <SeletorCaminho
                rotulo="Arquivo de destino (.mp4)"
                valor={destino}
                aoMudar={(v) => {
                  setDestino(v)
                  if (erroDestino) setErroDestino(undefined)
                }}
                modo="arquivo"
                erro={erroDestino}
                inputRef={refDestino}
                aoEscolher={escolherDestino}
                ajuda="A pasta escolhida é lembrada para a próxima exportação."
              />
            )}

            {emExecucao && (
              <FaixaJob
                rotulo="Exportando Corte em MP4"
                detalhe={`${Math.round(percentualJob)}%`}
              >
                <div className="flex flex-col gap-2">
                  <Progresso valor={percentualJob} rotulo="Progresso da exportação" compacto />
                  <div className="flex justify-end">
                    <Botao tamanho="p" variante="secundario" onClick={() => void cancelarExportacao()}>
                      Cancelar exportação
                    </Botao>
                  </div>
                </div>
              </FaixaJob>
            )}

            {statusFinal && (
              <div className="flex flex-col gap-2 rounded-area bg-area p-3 text-pequeno">
                <Status tom="sucesso" forte>
                  Corte exportado com sucesso
                </Status>
                <p className="flex items-center gap-1.5 font-mono text-micro break-all text-t2">
                  <FolderOpen className="size-[13px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
                  <span>{statusFinal.output}</span>
                </p>
                {fallbackAtivo && (
                  <Status tom="aviso">
                    {`A exportação usou a CPU (${statusFinal.encoder ?? 'libx264'}) porque o encoder de placa de vídeo falhou (${statusFinal.encoderFallback?.from ?? 'hardware'}).`}
                  </Status>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Dialogo>
  )
}
