import { isTauri } from '@tauri-apps/api/core'
import {
  AreaRolagem,
  BannerErroCore,
  Botao,
  Busca,
  ChecklistGuardaCorpos,
  ConfirmDialog,
  Dica,
  Esqueleto,
  EstadoTela,
  SeloTipoVideo,
  Select,
  Status,
  cn,
  duracao,
  tc,
  useToast,
  type ItemGuarda,
  type OpcaoSelect,
} from '@ds'
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type {
  ConfiguracoesExportacao,
  CorteAprovadoProntidao,
  RespostaGuardrails,
  ResultadoUseExportacaoProjeto,
} from '~/stores/exportacaoProjeto'
import type { LoteExportacao } from '~/stores/filaGlobal'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import { DialogoExportarCorte, type CorteParaExportar } from '~/telas/corte/DialogoExportarCorte'
import { mediaUrl } from '../../../../src/lib/media'

export type FiltroProntidao = 'todos' | 'pendencias' | 'prontos' | 'direto' | 'transformado'
export type OrdenacaoProntidao = 'pendencias' | 'fonte' | 'nota'

export type MesaProntidaoProps = {
  projetoId: string
  projetoPath: string
  exportacao: ResultadoUseExportacaoProjeto
  aoAbrirLote: (loteId: number) => void
  aoLimparFiltros?: () => void
  zonaEsquerdaRef?: RefObject<HTMLDivElement | null>
  zonaDireitaRef?: RefObject<HTMLElement | null>
}

type ProntidaoCalculada = {
  tituloExibido: string
  semEmpacotamento: boolean
  temCapa: boolean
  semPermissao: boolean
  fonteIndisponivel: boolean
  roteiroPendente: boolean
  blocosPendentes: number
  narracaoPendente: boolean
  sobraLonga: boolean
  audioSemLicenca: boolean
  acima60s: boolean
  pendenciasTotal: number
  prontoParaPublicar: boolean
}

function nomeArquivo(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function traduzirEncoder(effective: string, gpu: string): string {
  switch (effective) {
    case 'h264_nvenc':
      return gpu ? `Hardware NVIDIA (NVENC) · ${gpu}` : 'Hardware NVIDIA (NVENC)'
    case 'h264_qsv':
      return 'Intel Quick Sync (QSV)'
    case 'h264_amf':
      return 'AMD AMF'
    case 'h264_videotoolbox':
      return 'Apple VideoToolbox'
    default:
      return 'CPU (x264)'
  }
}

export function avaliarProntidaoCorte(corte: CorteAprovadoProntidao): ProntidaoCalculada {
  const pkgTitle = corte.packaging?.current?.title?.trim()
  const semEmpacotamento = !corte.packaging?.current
  const tituloExibido = pkgTitle || corte.candidateTitle.trim() || `Corte #${corte.candidateId}`
  const temCapa = Boolean(corte.thumbnail?.current)
  const semPermissao = corte.source.permission.status !== 'granted'
  const fonteIndisponivel = corte.source.status === 'offline' || corte.source.status === 'changed'

  const script = corte.script ?? corte.guardrails?.script
  const narration = corte.narration ?? corte.guardrails?.narration
  const gr = corte.guardrails
  const transformado = corte.videoKind === 'transformed'
  const blocosPendentes = script?.pendingBlocks ?? 0
  const roteiroPendente = transformado && Boolean(script?.applicable && !script.approved)
  const narrTotal = narration?.totalBlocks ?? 0
  const narrProntos = narration?.readyBlocks ?? narration?.generatedBlocks ?? 0
  const narracaoPendente =
    transformado &&
    Boolean(
      narration?.applicable &&
        (typeof narration.ready === 'boolean'
          ? !narration.ready
          : narrTotal === 0 || narrProntos < narrTotal),
    )
  const sobraLonga = transformado && Boolean(narration?.longFreezeTail)
  const audioSemLicenca = (gr?.audio?.unverifiedCount ?? 0) > 0
  const acima60s = corte.durationUs > 60_000_000 || Boolean(gr?.over60s)

  const pendenciasTotal =
    (fonteIndisponivel ? 1 : 0) +
    (!temCapa ? 1 : 0) +
    (semEmpacotamento ? 1 : 0) +
    (semPermissao ? 1 : 0) +
    (roteiroPendente ? 1 : 0) +
    (narracaoPendente ? 1 : 0) +
    (sobraLonga ? 1 : 0) +
    (audioSemLicenca ? 1 : 0)

  return {
    tituloExibido,
    semEmpacotamento,
    temCapa,
    semPermissao,
    fonteIndisponivel,
    roteiroPendente,
    blocosPendentes,
    narracaoPendente,
    sobraLonga,
    audioSemLicenca,
    acima60s,
    pendenciasTotal,
    prontoParaPublicar: pendenciasTotal === 0,
  }
}

function construirItensChecklist(
  guardrails: RespostaGuardrails | null,
  qtdOffline: number,
  precisaAvisoDireto: boolean,
): { itens: ItemGuarda[]; temAvisos: boolean } {
  if (!guardrails) return { itens: [], temAvisos: false }

  const itens: ItemGuarda[] = []
  const rotuloTipo =
    guardrails.videoKind === 'transformed'
      ? 'Vídeo transformado'
      : guardrails.videoKind === 'direct'
        ? 'Corte direto'
        : 'Misto (Cortes diretos e Vídeos transformados)'

  itens.push({
    id: 'tipo',
    estado: guardrails.hasDirect ? 'atencao' : 'ok',
    titulo: `Tipo: ${rotuloTipo}`,
    detalhe: 'Legenda, crop, filtros e trilha importada não contam como Transformação.',
  })

  const totalPerm = guardrails.permission?.totalCount ?? 0
  const grantedPerm = guardrails.permission?.grantedCount ?? 0
  const missingPerm = guardrails.permission?.missingCount ?? 0
  itens.push({
    id: 'permissao',
    estado: missingPerm > 0 ? 'atencao' : 'ok',
    titulo: `Permissão das Fontes: ${grantedPerm} de ${totalPerm} com registro`,
    detalhe:
      missingPerm > 0
        ? `${missingPerm} sem Permissão registrada — risco de reivindicação ou strike.`
        : undefined,
  })

  if (guardrails.script?.applicable) {
    const aprovados = guardrails.script.approvedCount ?? 0
    const transformados = guardrails.script.transformedCount ?? 0
    const pendentes = guardrails.script.unapprovedCount ?? 0
    itens.push({
      id: 'roteiro',
      estado: pendentes > 0 ? 'pendente' : 'ok',
      titulo: `Roteiros: ${aprovados} de ${transformados} aprovados`,
      detalhe:
        pendentes > 0
          ? `${pendentes} Corte(s) ainda aguardam revisão e aprovação do Roteiro.`
          : undefined,
    })
  }

  if (guardrails.narration?.applicable && (guardrails.narration.longFreezeTailCount ?? 0) > 0) {
    const segMax = ((guardrails.narration.maxFreezeTailUs ?? 0) / 1_000_000).toLocaleString(
      'pt-BR',
      { minimumFractionDigits: 1, maximumFractionDigits: 1 },
    )
    itens.push({
      id: 'sobra',
      estado: 'atencao',
      titulo: `${guardrails.narration.longFreezeTailCount} Corte(s) com sobra final > 5 s`,
      detalhe: `Maior sobra congelada no fim do vídeo: ${segMax} s.`,
    })
  }

  const audioSemLic = guardrails.audio?.unverifiedCount ?? 0
  if (guardrails.audio?.hasAudio || audioSemLic > 0) {
    itens.push({
      id: 'audio',
      estado: audioSemLic > 0 ? 'atencao' : 'ok',
      titulo:
        audioSemLic > 0
          ? `${audioSemLic} trilha/efeito com licença não verificada`
          : 'Trilhas e efeitos com licença verificada',
      detalhe:
        audioSemLic > 0
          ? 'Músicas sem licença podem gerar reivindicação de direitos autorais.'
          : undefined,
    })
  }

  if ((guardrails.over60sCount ?? 0) > 0) {
    itens.push({
      id: 'duracao',
      estado: 'atencao',
      titulo: `${guardrails.over60sCount} Corte(s) acima de 60 s`,
      detalhe: 'Shorts com mais de 1 minuto e música protegida ficam inelegíveis para monetização.',
    })
  }

  if (qtdOffline > 0) {
    itens.push({
      id: 'offline',
      estado: 'atencao',
      titulo: `${qtdOffline} Corte(s) com Fonte offline ou alterada`,
      detalhe: 'Esses itens falharão no lote até que a Fonte seja relocalizada.',
    })
  }

  if (precisaAvisoDireto) {
    itens.push({
      id: 'aviso-direto',
      estado: 'pendente',
      titulo: 'Aviso de monetização do Corte direto pendente',
      detalhe: 'Será exibido uma única vez ao confirmar a exportação em lote.',
    })
  }

  const temAvisos =
    precisaAvisoDireto ||
    missingPerm > 0 ||
    (guardrails.script?.unapprovedCount ?? 0) > 0 ||
    audioSemLic > 0 ||
    (guardrails.over60sCount ?? 0) > 0 ||
    (guardrails.narration?.longFreezeTailCount ?? 0) > 0 ||
    qtdOffline > 0

  return { itens, temAvisos }
}

type CartaoProntidaoProps = {
  projetoId: string
  corte: CorteAprovadoProntidao
  onExportarIndividual: (corte: CorteAprovadoProntidao, titulo: string) => void
}

function CartaoProntidao({
  projetoId,
  corte,
  onExportarIndividual,
}: CartaoProntidaoProps) {
  const tituloId = useId()
  const [imgFalhou, setImgFalhou] = useState(false)
  const p = useMemo(() => avaliarProntidaoCorte(corte), [corte])
  const encProjeto = encodeURIComponent(projetoId)
  const hashEditar = `#/projeto/${encProjeto}/corte/${corte.candidateId}/editar?run=${corte.runId}`
  const hashTransformar = `#/projeto/${encProjeto}/corte/${corte.candidateId}/transformar?run=${corte.runId}`
  const hashEmpacotar = `#/projeto/${encProjeto}/corte/${corte.candidateId}/empacotar?run=${corte.runId}`
  const hashFonte = `#/projeto/${encProjeto}/fontes/${corte.sourceId}`

  const acaoContextual = useMemo(() => {
    if (p.fonteIndisponivel) {
      return { rotulo: 'Relocalizar Fonte', destino: hashFonte }
    }
    if (corte.videoKind === 'transformed' && (p.roteiroPendente || p.narracaoPendente)) {
      return { rotulo: 'Transformar', destino: hashTransformar }
    }
    if (p.semEmpacotamento || !p.temCapa) {
      return { rotulo: 'Empacotar', destino: hashEmpacotar }
    }
    return { rotulo: 'Editar Corte', destino: hashEditar }
  }, [
    corte.videoKind,
    hashEditar,
    hashEmpacotar,
    hashFonte,
    hashTransformar,
    p.fonteIndisponivel,
    p.narracaoPendente,
    p.roteiroPendente,
    p.semEmpacotamento,
    p.temCapa,
  ])

  const instantCapaUs = corte.thumbnail?.current?.instantUs
  const podeExibirImgTauri = isTauri() && p.temCapa && !p.fonteIndisponivel && !imgFalhou

  return (
    <article
      aria-labelledby={tituloId}
      className="flex flex-col gap-3 rounded-area bg-area p-3"
    >
      <div className="flex items-start gap-3">
        <div className="relative flex aspect-[9/16] w-[58px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-controle bg-chao p-1 text-center">
          {podeExibirImgTauri && instantCapaUs !== undefined ? (
            <img
              src={mediaUrl(`thumbs/${corte.sourceId}-${instantCapaUs}`)}
              alt={`Capa do Corte ${p.tituloExibido}`}
              onError={() => setImgFalhou(true)}
              className="h-full w-full object-cover"
            />
          ) : p.temCapa && instantCapaUs !== undefined ? (
            <div className="flex flex-col items-center gap-0.5 text-micro text-t2">
              <span>Capa 9:16</span>
              <span className="num text-t3">{tc(instantCapaUs)}</span>
            </div>
          ) : (
            <span className="text-micro leading-tight text-t3">Sem capa escolhida</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <SeloTipoVideo tipo={corte.videoKind} />
            <span className="num text-pequeno text-t3">{duracao(corte.durationUs)}</span>
          </div>

          <h3 id={tituloId} className="line-clamp-2 text-base font-medio text-t1">
            {p.tituloExibido}
          </h3>
          {p.semEmpacotamento && (
            <span className="text-micro text-t3">Título sugerido (sem Empacotamento)</span>
          )}

          <p className="truncate text-pequeno text-t3">
            <span>{corte.source.name}</span>
            <span aria-hidden> · </span>
            {p.fonteIndisponivel ? (
              <span className="text-t2">
                {corte.source.status === 'offline' ? 'Fonte offline' : 'Fonte alterada'}
              </span>
            ) : corte.source.permission.status === 'granted' ? (
              <span>
                Permissão registrada
                {corte.source.permission.who ? ` (${corte.source.permission.who})` : ''}
              </span>
            ) : (
              <span>Sem Permissão</span>
            )}
          </p>
        </div>
      </div>

      {/* Glifos de pendência (ícone + rótulo curto, SC 1.4.1) */}
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 rounded-controle bg-chao/60 px-2 py-1.5">
        {p.fonteIndisponivel && (
          <Status tom="perigo" forte>
            Fonte indisponível
          </Status>
        )}
        <Status tom={p.temCapa ? 'sucesso' : 'aviso'} forte={!p.temCapa}>
          {p.temCapa ? 'Capa escolhida' : 'Sem capa'}
        </Status>
        <Status tom={!p.semEmpacotamento ? 'sucesso' : 'aviso'} forte={p.semEmpacotamento}>
          {!p.semEmpacotamento ? 'Empacotado' : 'Sem Empacotamento'}
        </Status>
        <Status tom={!p.semPermissao ? 'sucesso' : 'aviso'} forte={p.semPermissao}>
          {!p.semPermissao ? 'Com Permissão' : 'Sem Permissão'}
        </Status>

        {corte.videoKind === 'transformed' && (
          <>
            <Status tom={!p.roteiroPendente ? 'sucesso' : 'aviso'} forte={p.roteiroPendente}>
              {!p.roteiroPendente
                ? 'Roteiro aprovado'
                : p.blocosPendentes > 0
                  ? `Roteiro pendente (${p.blocosPendentes})`
                  : 'Roteiro pendente'}
            </Status>
            <Status tom={!p.narracaoPendente ? 'sucesso' : 'aviso'} forte={p.narracaoPendente}>
              {!p.narracaoPendente ? 'Narração pronta' : 'Narração pendente'}
            </Status>
            {p.sobraLonga && (
              <Status tom="aviso" forte>
                Sobra final &gt; 5 s
              </Status>
            )}
          </>
        )}

        {p.audioSemLicenca && (
          <Status tom="aviso" forte>
            Áudio sem licença
          </Status>
        )}
        {p.acima60s && <Status tom="neutro">Acima de 60 s</Status>}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <Botao
          tamanho="p"
          variante="secundario"
          onClick={() => {
            window.location.hash = acaoContextual.destino
          }}
        >
          {acaoContextual.rotulo}
        </Botao>

        {acaoContextual.destino !== hashEditar && (
          <Botao
            tamanho="p"
            variante="fantasma"
            onClick={() => {
              window.location.hash = hashEditar
            }}
          >
            Editar
          </Botao>
        )}

        {acaoContextual.destino !== hashEmpacotar && (
          <Botao
            tamanho="p"
            variante="fantasma"
            onClick={() => {
              window.location.hash = hashEmpacotar
            }}
          >
            Empacotar
          </Botao>
        )}

        {corte.videoKind === 'direct' && (
          /* Pendência no núcleo (#292): conversão individual para Vídeo transformado. */
          <Dica texto="A conversão individual para Vídeo transformado ainda não está disponível nesta versão.">
            <Botao tamanho="p" variante="fantasma" icone={<Sparkles />} aria-disabled="true">
              Converter em Vídeo transformado
            </Botao>
          </Dica>
        )}

        <Botao
          tamanho="p"
          variante="suave"
          className="ml-auto"
          disabled={p.fonteIndisponivel}
          onClick={() => onExportarIndividual(corte, p.tituloExibido)}
        >
          Exportar só este
        </Botao>
      </div>
    </article>
  )
}

/**
 * Mesa de Prontidão (Zona A) e Configuração/Disparo de Exportação em Lote (Zona B)
 * da Macro-etapa 3 (`#/projeto/:id/exportacao?sub=prontidao`).
 */
export function MesaProntidao({
  projetoId,
  projetoPath,
  exportacao,
  aoAbrirLote,
  aoLimparFiltros,
  zonaEsquerdaRef,
  zonaDireitaRef,
}: MesaProntidaoProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const inputPastaRef = useRef<HTMLInputElement>(null)

  const [filtroFonte, setFiltroFonte] = useState<string>(() =>
    exportacao.filtroFonteId !== null ? String(exportacao.filtroFonteId) : 'todas',
  )
  const [filtroProntidao, setFiltroProntidao] = useState<FiltroProntidao>('todos')
  const [buscaTitulo, setBuscaTitulo] = useState('')
  const [ordenacao, setOrdenacao] = useState<OrdenacaoProntidao>('pendencias')

  const [escopo, setEscopo] = useState<'projeto' | 'fonte'>(() =>
    exportacao.filtroFonteId !== null ? 'fonte' : 'projeto',
  )
  const [pastaSaida, setPastaSaida] = useState('')
  const pastaEditadaRef = useRef(false)
  const [salvandoPasta, setSalvandoPasta] = useState(false)
  const [erroPasta, setErroPasta] = useState<string | null>(null)

  const [corteExportarIndividual, setCorteExportarIndividual] = useState<CorteParaExportar | null>(
    null,
  )
  const [fonteExportarIndividual, setFonteExportarIndividual] = useState<FonteProjeto | null>(null)

  const [dialogoDiretoAberto, setDialogoDiretoAberto] = useState(false)
  const [conflitosSobrescrita, setConflitosSobrescrita] = useState<string[] | null>(null)
  const algumDialogoAberto =
    corteExportarIndividual !== null || dialogoDiretoAberto || conflitosSobrescrita !== null
  const [disparando, setDisparando] = useState(false)
  const [erroDisparo, setErroDisparo] = useState<ErroCore | null>(null)

  useEffect(() => {
    if (!pastaEditadaRef.current && exportacao.settings?.last_directory) {
      setPastaSaida(exportacao.settings.last_directory)
    }
  }, [exportacao.settings?.last_directory])

  const salvarPastaPadrao = useCallback(async () => {
    const pasta = pastaSaida.trim()
    if (!pasta || salvandoPasta) return
    setSalvandoPasta(true)
    setErroPasta(null)
    try {
      const res = exportacao.salvarPastaPadrao
        ? await exportacao.salvarPastaPadrao(pasta)
        : await chamar<ConfiguracoesExportacao>('export.settings.set', {
            last_directory: pasta,
          })
      pastaEditadaRef.current = false
      if (res?.last_directory) {
        setPastaSaida(res.last_directory)
      }
      toastRef.current.add({ title: 'Pasta padrão de exportação salva.' })
    } catch (err) {
      const coreErr = paraErroCore(err)
      setErroPasta(
        coreErr.code === 'export_destination'
          ? 'Informe uma pasta existente com caminho completo.'
          : mensagemDeErro(coreErr).titulo,
      )
      queueMicrotask(() => inputPastaRef.current?.focus())
    } finally {
      setSalvandoPasta(false)
    }
  }, [exportacao, pastaSaida, salvandoPasta])

  const fonteFiltroNum = filtroFonte === 'todas' ? null : Number(filtroFonte)

  const aoMudarFiltroFonte = useCallback(
    (valor: string) => {
      setFiltroFonte(valor)
      const sid = valor === 'todas' ? null : Number(valor)
      const fonteId = sid !== null && Number.isFinite(sid) ? sid : null
      setEscopo(fonteId !== null ? 'fonte' : 'projeto')
      void exportacao.filtrarPorFonte(fonteId)
      if (fonteId !== null) {
        void exportacao.carregarGuardrailsEscopo(fonteId)
      }
    },
    [exportacao],
  )

  const prontidaoPorId = useMemo(() => {
    const mapa = new Map<number, ProntidaoCalculada>()
    for (const c of exportacao.aprovados) {
      mapa.set(c.candidateId, avaliarProntidaoCorte(c))
    }
    return mapa
  }, [exportacao.aprovados])

  const contagemComPendencias = useMemo(
    () => exportacao.aprovados.filter((c) => (prontidaoPorId.get(c.candidateId)?.pendenciasTotal ?? 0) > 0).length,
    [exportacao.aprovados, prontidaoPorId],
  )
  const contagemProntos = exportacao.aprovados.length - contagemComPendencias

  const cortefiltradosOrdenados = useMemo(() => {
    const termo = buscaTitulo.trim().toLowerCase()
    const lista = exportacao.aprovados.filter((c) => {
      if (fonteFiltroNum !== null && c.sourceId !== fonteFiltroNum) return false
      const p = prontidaoPorId.get(c.candidateId)
      if (filtroProntidao === 'pendencias' && (p?.pendenciasTotal ?? 0) === 0) return false
      if (filtroProntidao === 'prontos' && !p?.prontoParaPublicar) return false
      if (filtroProntidao === 'direto' && c.videoKind !== 'direct') return false
      if (filtroProntidao === 'transformado' && c.videoKind !== 'transformed') return false
      if (termo) {
        const titulo = (p?.tituloExibido ?? c.candidateTitle).toLowerCase()
        if (!titulo.includes(termo) && !c.source.name.toLowerCase().includes(termo)) return false
      }
      return true
    })

    lista.sort((a, b) => {
      if (ordenacao === 'nota') return b.scoreTotal - a.scoreTotal
      if (ordenacao === 'fonte') {
        const cmp = a.source.name.localeCompare(b.source.name, 'pt-BR')
        return cmp !== 0 ? cmp : a.startUs - b.startUs
      }
      const pendA = prontidaoPorId.get(a.candidateId)?.pendenciasTotal ?? 0
      const pendB = prontidaoPorId.get(b.candidateId)?.pendenciasTotal ?? 0
      return pendB - pendA || b.scoreTotal - a.scoreTotal
    })

    return lista
  }, [
    buscaTitulo,
    exportacao.aprovados,
    filtroProntidao,
    fonteFiltroNum,
    ordenacao,
    prontidaoPorId,
  ])

  const cortesaExibir = cortefiltradosOrdenados
  const temMaisFiltrados = exportacao.temMais

  const limparFiltros = useCallback(() => {
    const tinhaFiltroFonte = filtroFonte !== 'todas' || exportacao.filtroFonteId !== null
    setFiltroFonte('todas')
    setFiltroProntidao('todos')
    setBuscaTitulo('')
    setOrdenacao('pendencias')
    setEscopo('projeto')
    if (tinhaFiltroFonte) {
      void exportacao.filtrarPorFonte(null)
    }
    aoLimparFiltros?.()
  }, [aoLimparFiltros, exportacao, filtroFonte])

  const opcoesFonte = useMemo<OpcaoSelect<string>[]>(
    () => [
      { valor: 'todas', rotulo: 'Todas as Fontes' },
      ...exportacao.fontes.map((f) => ({
        valor: String(f.id),
        rotulo: nomeArquivo(f.path),
      })),
    ],
    [exportacao.fontes],
  )

  const opcoesProntidao = useMemo<OpcaoSelect<FiltroProntidao>[]>(
    () => [
      { valor: 'todos', rotulo: `Todos (${exportacao.aprovados.length})` },
      { valor: 'pendencias', rotulo: `Com pendências (${contagemComPendencias})` },
      { valor: 'prontos', rotulo: `Prontos para publicar (${contagemProntos})` },
      { valor: 'direto', rotulo: 'Apenas Corte direto' },
      { valor: 'transformado', rotulo: 'Apenas Vídeo transformado' },
    ],
    [contagemComPendencias, contagemProntos, exportacao.aprovados.length],
  )

  const opcoesOrdenacao: OpcaoSelect<OrdenacaoProntidao>[] = [
    { valor: 'pendencias', rotulo: 'Pendências primeiro' },
    { valor: 'fonte', rotulo: 'Por Fonte' },
    { valor: 'nota', rotulo: 'Por Nota' },
  ]

  const fonteEscopoObj = useMemo(
    () => (fonteFiltroNum !== null ? exportacao.fontes.find((f) => f.id === fonteFiltroNum) ?? null : null),
    [exportacao.fontes, fonteFiltroNum],
  )

  const aprovadosNoEscopo = useMemo(
    () =>
      escopo === 'fonte' && fonteFiltroNum !== null
        ? exportacao.aprovados.filter((c) => c.sourceId === fonteFiltroNum)
        : exportacao.aprovados,
    [escopo, exportacao.aprovados, fonteFiltroNum],
  )

  const qtdOfflineNoEscopo = useMemo(
    () =>
      aprovadosNoEscopo.filter(
        (c) => c.source.status === 'offline' || c.source.status === 'changed',
      ).length,
    [aprovadosNoEscopo],
  )

  const guardrailsEscopo =
    escopo === 'fonte' && fonteFiltroNum !== null
      ? (exportacao.guardrailsPorFonte[fonteFiltroNum] ?? exportacao.guardrailsProjeto)
      : exportacao.guardrailsProjeto

  const temDiretoNoEscopo = useMemo(
    () => aprovadosNoEscopo.some((c) => c.videoKind === 'direct'),
    [aprovadosNoEscopo],
  )

  const precisaAvisoDireto =
    Boolean(guardrailsEscopo?.needsDirectNotice && !guardrailsEscopo?.directMonetizationAck) ||
    (guardrailsEscopo !== null && !guardrailsEscopo.directMonetizationAck && temDiretoNoEscopo)

  const { itens: itensChecklist, temAvisos: checklistTemAvisos } = useMemo(
    () => construirItensChecklist(guardrailsEscopo, qtdOfflineNoEscopo, precisaAvisoDireto),
    [guardrailsEscopo, precisaAvisoDireto, qtdOfflineNoEscopo],
  )

  const encoder = exportacao.encoder
  const ffmpegOk = encoder?.ffmpeg ?? true

  const executarStartLote = useCallback(
    async (confirmed: boolean) => {
      setDisparando(true)
      setErroDisparo(null)
      try {
        const args: Record<string, unknown> = {
          project: projetoPath,
          output_dir: pastaSaida.trim(),
        }
        if (escopo === 'fonte' && fonteFiltroNum !== null) {
          args.source_id = fonteFiltroNum
        }
        if (confirmed) {
          args.confirmed = true
        }
        const lote = await chamar<LoteExportacao>('export.batch.start', args)
        setConflitosSobrescrita(null)
        await exportacao.recarregarLotes()
        toast.add({ title: `Lote #${lote.id} iniciado.` })
        aoAbrirLote(lote.id)
      } catch (err) {
        const coreErr = paraErroCore(err)
        if (coreErr.code === 'confirmation_required' && !confirmed) {
          const uso = coreErr.usage as { conflicts?: unknown } | undefined
          const lista = Array.isArray(uso?.conflicts)
            ? uso.conflicts.filter((x): x is string => typeof x === 'string')
            : []
          setConflitosSobrescrita(lista)
          return
        }
        setErroDisparo(coreErr)
      } finally {
        setDisparando(false)
      }
    },
    [aoAbrirLote, escopo, exportacao, fonteFiltroNum, pastaSaida, projetoPath, toast],
  )

  const iniciarDisparoLote = useCallback(async () => {
    if (disparando) return
    setErroDisparo(null)
    if (precisaAvisoDireto) {
      setDialogoDiretoAberto(true)
      return
    }
    await executarStartLote(false)
  }, [disparando, executarStartLote, precisaAvisoDireto])

  const confirmarAvisoDiretoEContinuar = useCallback(async () => {
    setDisparando(true)
    setErroDisparo(null)
    try {
      await chamar('guardrails.ack_direct_notice', {})
      await exportacao.carregarGuardrailsEscopo(
        escopo === 'fonte' && fonteFiltroNum !== null ? fonteFiltroNum : null,
      )
      setDialogoDiretoAberto(false)
      await executarStartLote(false)
    } catch (err) {
      setDialogoDiretoAberto(false)
      setErroDisparo(paraErroCore(err))
      setDisparando(false)
    }
  }, [escopo, executarStartLote, exportacao, fonteFiltroNum])

  const abrirExportarIndividual = useCallback(
    (corte: CorteAprovadoProntidao, titulo: string) => {
      const fonte = exportacao.fontes.find((f) => f.id === corte.sourceId) ?? null
      setFonteExportarIndividual(fonte)
      setCorteExportarIndividual({
        corteId: String(corte.candidateId),
        titulo,
        videoKind: corte.videoKind,
        sourceId: corte.sourceId,
        startId: corte.startId,
        endId: corte.endId,
        candidateId: corte.candidateId,
      })
    },
    [exportacao.fontes],
  )

  const acaoRecuperacaoDisparo = useMemo(() => {
    if (!erroDisparo) return undefined
    const rec = mensagemDeErro(erroDisparo).recuperacao
    if (!rec) return undefined
    if (rec.acao === 'escolher-pasta') {
      return {
        rotulo: rec.rotulo,
        aoAcionar: () => inputPastaRef.current?.focus(),
      }
    }
    if (rec.acao === 'ir-para-cortes') {
      return {
        rotulo: rec.rotulo,
        aoAcionar: () => {
          window.location.hash = `#/projeto/${encodeURIComponent(projetoId)}/cortes`
        },
      }
    }
    if (rec.rota) {
      const rota = rec.rota
      return {
        rotulo: rec.rotulo,
        aoAcionar: () => {
          window.location.hash = rota
        },
      }
    }
    return undefined
  }, [erroDisparo, projetoId])

  const encProjeto = encodeURIComponent(projetoId)
  const qtdNoEscopoFonte =
    fonteFiltroNum !== null && exportacao.filtroFonteId === fonteFiltroNum
      ? exportacao.totalAprovados
      : aprovadosNoEscopo.length
  const qtdEscopoDisparo = escopo === 'fonte' ? qtdNoEscopoFonte : exportacao.totalProjeto
  const erroBannerProntidao = exportacao.erroProntidao ?? exportacao.erro
  const podeExportarLote =
    ffmpegOk && qtdEscopoDisparo > 0 && pastaSaida.trim().length > 0 && !disparando

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Filtros da Mesa de Prontidão */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[170px]">
          <Select
            rotulo="Filtrar por Fonte"
            valor={filtroFonte}
            aoMudar={aoMudarFiltroFonte}
            opcoes={opcoesFonte}
          />
        </div>
        <div className="min-w-[190px]">
          <Select
            rotulo="Filtrar por prontidão"
            valor={filtroProntidao}
            aoMudar={setFiltroProntidao}
            opcoes={opcoesProntidao}
          />
        </div>
        <div className="min-w-[180px] flex-1 min-[1440px]:max-w-[260px]">
          <Busca
            rotulo="Buscar título do Corte"
            placeholder="Buscar título do Corte…"
            value={buscaTitulo}
            onChange={(e) => setBuscaTitulo(e.target.value)}
          />
        </div>
        <div className="min-w-[165px]">
          <Select
            rotulo="Ordenar Cortes"
            valor={ordenacao}
            aoMudar={setOrdenacao}
            opcoes={opcoesOrdenacao}
          />
        </div>

        <Botao
          tamanho="p"
          variante="fantasma"
          icone={<RefreshCw />}
          carregando={exportacao.atualizandoProntidao}
          onClick={() => void exportacao.atualizarProntidao()}
          className="ml-auto shrink-0"
        >
          Atualizar prontidão em lote
        </Botao>
      </div>

      {erroBannerProntidao && (
        <BannerErroCore
          erro={{
            code: erroBannerProntidao.code,
            message: erroBannerProntidao.detalhe || erroBannerProntidao.message,
          }}
          traduzir={(code) =>
            mensagemDeErro(
              new ErroCore(code, erroBannerProntidao.detalhe || erroBannerProntidao.message),
            )
          }
          acaoRecuperacao={{
            rotulo: 'Tentar de novo',
            aoAcionar: () => void exportacao.tentarNovamenteProntidao(),
          }}
          permitirRelato
        />
      )}

      {/* Zonas A (Grade) + B (Configuração e Disparo) */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
        {/* Zona A */}
        <div
          ref={zonaEsquerdaRef}
          tabIndex={-1}
          role="region"
          aria-label="Grade de Prontidão dos Cortes"
          className="foco-interno flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <AreaRolagem rotulo="Grade de Cortes aprovados" className="min-h-0 flex-1">
            {cortesaExibir.length === 0 ? (
              <div className="flex min-h-[260px] items-center justify-center rounded-area bg-area">
                <EstadoTela
                  tipo="vazio"
                  titulo="Nenhum Corte encontrado com estes filtros"
                  descricao="Nenhum Corte aprovado corresponde aos filtros selecionados."
                  acaoSecundaria={{ rotulo: 'Limpar filtros', aoAcionar: limparFiltros }}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3 pr-1 pb-2">
                <h2 className="sr-only">Cortes aprovados</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(315px,1fr))]">
                  {cortesaExibir.map((corte) => (
                    <CartaoProntidao
                      key={corte.candidateId}
                      projetoId={projetoId}
                      corte={corte}
                      onExportarIndividual={abrirExportarIndividual}
                    />
                  ))}
                </div>

                {exportacao.carregandoMais && (
                  <Esqueleto
                    variante="cards"
                    quantidade={3}
                    rotuloAcessivel="Carregando mais Cortes aprovados"
                  />
                )}

                {temMaisFiltrados && (
                  <div className="flex justify-center pt-1">
                    <Botao
                      variante="secundario"
                      carregando={exportacao.carregandoMais}
                      onClick={() => void exportacao.carregarMais()}
                    >
                      Carregar mais Cortes
                    </Botao>
                  </div>
                )}
              </div>
            )}
          </AreaRolagem>
        </div>

        {/* Zona B */}
        <aside
          ref={zonaDireitaRef}
          tabIndex={-1}
          aria-label="Configuração da exportação em lote"
          className="foco-interno flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-area bg-area p-3 lg:w-[375px] min-[1440px]:w-[410px]"
        >
          <AreaRolagem rotulo="Configuração e disparo em lote" className="min-h-0 flex-1">
            <div className="flex flex-col gap-3.5 pr-1">
              <h2 className="text-base font-forte text-t1">Exportação em lote</h2>

              {/* Escopo */}
              <div className="flex flex-col gap-1.5">
                <span className="text-pequeno text-t2">Escopo do lote</span>
                <div className="flex flex-wrap gap-1.5">
                  <Botao
                    tamanho="p"
                    variante={escopo === 'projeto' ? 'secundario' : 'fantasma'}
                    aria-pressed={escopo === 'projeto'}
                    onClick={() => setEscopo('projeto')}
                  >
                    Todo o Projeto ({exportacao.totalProjeto})
                  </Botao>
                  <Botao
                    tamanho="p"
                    variante={escopo === 'fonte' ? 'secundario' : 'fantasma'}
                    aria-pressed={escopo === 'fonte'}
                    disabled={fonteFiltroNum === null}
                    onClick={() => setEscopo('fonte')}
                  >
                    {fonteEscopoObj
                      ? `Fonte: ${nomeArquivo(fonteEscopoObj.path)} (${qtdNoEscopoFonte})`
                      : 'Só Fonte filtrada'}
                  </Botao>
                </div>

                {qtdOfflineNoEscopo > 0 && (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-controle bg-chao px-2.5 py-2 text-pequeno text-t2"
                  >
                    <AlertTriangle className="mt-0.5 size-[14px] shrink-0 text-t2" aria-hidden />
                    <span>
                      {qtdOfflineNoEscopo} Corte(s) estão com a Fonte offline ou alterada e falharão
                      até serem relocalizados.
                    </span>
                  </div>
                )}
              </div>

              {/* Pasta de saída */}
              <div className="flex flex-col gap-1.5">
                <SeletorCaminho
                  rotulo="Pasta de saída"
                  valor={pastaSaida}
                  aoMudar={(v) => {
                    pastaEditadaRef.current = true
                    setPastaSaida(v)
                    if (erroPasta) setErroPasta(null)
                  }}
                  erro={erroPasta ?? undefined}
                  modo="pasta"
                  inputRef={inputPastaRef}
                  placeholder="Escolha a pasta de saída…"
                  ajuda="Formato: MP4 1080×1920 (H.264), áudio normalizado (-14 LUFS / -1 dBTP), sem marca d'água. Arquivos: <fonte>-<nn>-<tempo>.mp4."
                />

                <div className="flex justify-end">
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    carregando={salvandoPasta}
                    disabled={!pastaSaida.trim() || salvandoPasta}
                    onClick={() => void salvarPastaPadrao()}
                  >
                    Salvar pasta padrão
                  </Botao>
                </div>
              </div>

              {/* Encoder e fallback */}
              <div className="flex flex-col gap-1.5 rounded-controle bg-chao p-2.5">
                {!ffmpegOk ? (
                  <div role="alert" className="flex flex-col gap-2">
                    <p className="text-pequeno text-erro">
                      Falta instalar o FFmpeg para exportar vídeos.
                    </p>
                    <Botao
                      tamanho="p"
                      variante="secundario"
                      onClick={() => {
                        window.location.hash = '#/config/componentes'
                      }}
                    >
                      Instalar FFmpeg em Componentes
                    </Botao>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-pequeno font-medio text-t1">
                        {encoder?.detected
                          ? `Encoder: ${traduzirEncoder(encoder.effective, encoder.gpu)}`
                          : 'Encoder ainda não testado (usará x264)'}
                      </span>
                      <span className="text-micro text-t3">
                        {encoder?.manual ? 'Manual' : 'Automático'}
                      </span>
                    </div>
                    {encoder?.stale && (
                      <Status tom="aviso" forte>
                        Driver ou FFmpeg alterado — reteste recomendado
                      </Status>
                    )}
                    <p className="text-pequeno text-t3">
                      Se o encoder de hardware falhar durante o render, o Clipes refaz o item
                      automaticamente com CPU (x264) e registra o aviso no lote.
                    </p>
                    <div className="flex gap-2">
                      <Botao
                        tamanho="p"
                        variante="fantasma"
                        onClick={() => {
                          window.location.hash = '#/config/exportacao'
                        }}
                      >
                        {encoder?.detected ? 'Configurar encoder' : 'Detectar encoder'}
                      </Botao>
                    </div>
                  </>
                )}
              </div>

              {/* Checklist informativo de guarda-corpos */}
              <div className="flex flex-col gap-1 rounded-controle bg-chao p-2.5">
                <span className="text-micro text-t3">
                  Checklist informativo — nenhum item bloqueia a exportação.
                </span>
                <ChecklistGuardaCorpos
                  itens={itensChecklist}
                  escopo={escopo === 'fonte' ? 'source' : 'project'}
                  abertoPorPadrao={checklistTemAvisos}
                  mostrarDivulgacaoIa={Boolean(guardrailsEscopo?.narration?.ttsCutCount)}
                />
              </div>
            </div>
          </AreaRolagem>

          <div className="mt-3 flex shrink-0 flex-col gap-2 border-t border-linha pt-3">
            {erroDisparo && (
              <BannerErroCore
                erro={{
                  code: erroDisparo.code,
                  message: erroDisparo.detalhe || erroDisparo.message,
                }}
                traduzir={(code) =>
                  mensagemDeErro(new ErroCore(code, erroDisparo.detalhe || erroDisparo.message))
                }
                acaoRecuperacao={acaoRecuperacaoDisparo}
                permitirRelato
              />
            )}

            {/* Único botão primário (bg-sinal) da tela */}
            <Botao
              variante={algumDialogoAberto ? 'secundario' : 'primario'}
              tamanho="g"
              carregando={disparando}
              disabled={!podeExportarLote}
              onClick={() => void iniciarDisparoLote()}
              className="w-full justify-center"
            >
              {escopo === 'fonte'
                ? `Exportar ${qtdEscopoDisparo} da Fonte em lote`
                : `Exportar ${qtdEscopoDisparo} aprovados em lote`}
            </Botao>

            {qtdEscopoDisparo === 0 && (
              <Botao
                tamanho="p"
                variante="fantasma"
                onClick={() => {
                  window.location.hash = `#/projeto/${encProjeto}/cortes`
                }}
              >
                Ir para Cortes
              </Botao>
            )}
          </div>
        </aside>
      </div>

      {/* Modal pré-exportação individual ("Exportar só este") */}
      <DialogoExportarCorte
        aberto={corteExportarIndividual !== null}
        aoFechar={() => setCorteExportarIndividual(null)}
        projetoId={projetoId}
        corte={corteExportarIndividual}
        fonte={fonteExportarIndividual}
        aoIrParaTranscricao={() => {
          if (corteExportarIndividual) {
            window.location.hash = `#/projeto/${encProjeto}/fontes/${corteExportarIndividual.sourceId}`
          }
        }}
        aoIrParaAudio={() => {
          if (corteExportarIndividual) {
            window.location.hash = `#/projeto/${encProjeto}/corte/${corteExportarIndividual.corteId}/editar`
          }
        }}
        aoFonteRelocalizada={() => {
          void exportacao.recarregar()
        }}
      />

      {/* Diálogo único de monetização de Corte direto */}
      <ConfirmDialog
        aberto={dialogoDiretoAberto}
        aoMudarAberto={setDialogoDiretoAberto}
        titulo="Aviso de monetização — Corte direto"
        descricao="Este lote inclui Cortes diretos (sem Transformação). Cortes diretos podem ter monetização recusada pela política de conteúdo reutilizado, mesmo com Permissão registrada. Este aviso é confirmado uma única vez por Perfil de canal."
        rotuloConfirmar="Entendi e continuar"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={disparando}
        aoConfirmar={confirmarAvisoDiretoEContinuar}
      />

      {/* Diálogo de confirmação de sobrescrita (confirmation_required) */}
      <ConfirmDialog
        aberto={conflitosSobrescrita !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !disparando) setConflitosSobrescrita(null)
        }}
        titulo="Arquivos já existem na pasta de saída"
        descricao={
          <div className="flex flex-col gap-2">
            <p>
              Os seguintes arquivos em <span className="font-mono text-t1">{pastaSaida}</span> serão
              sobrescritos ao iniciar o lote:
            </p>
            {conflitosSobrescrita && conflitosSobrescrita.length > 0 && (
              <ul className="m-0 max-h-40 list-disc overflow-y-auto pl-5 font-mono text-pequeno text-t1">
                {conflitosSobrescrita.map((arquivo) => (
                  <li key={arquivo}>{arquivo}</li>
                ))}
              </ul>
            )}
          </div>
        }
        rotuloConfirmar={`Sobrescrever e exportar (${qtdEscopoDisparo})`}
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={disparando}
        aoConfirmar={() => executarStartLote(true)}
      />
    </div>
  )
}
