import {
  AreaRolagem,
  BannerErroCore,
  Botao,
  Busca,
  Checkbox,
  ConfirmDialog,
  Dialogo,
  EstadoTela,
  FaixaJob,
  ListaVirtual,
  Progresso,
  Select,
  Status,
  cn,
  tcLongo,
  useToast,
  type OpcaoSelect,
} from '@ds'
import { ArrowRight, Languages, RefreshCw, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CampoPermissao, permissaoValida } from '~/componentes/CampoPermissao'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import type {
  FonteProjeto,
  InvalidacoesFontes,
  PermissaoFonte,
  TranscriptStatusFonte,
} from '~/stores/fontesProjeto'
import {
  IDIOMAS_FALLBACK,
  basenameCaminho,
  formatarNomeIdioma,
  opcoesIdiomaDe,
  type IdiomaOpcao,
} from '~/telas/fontes/EntradaFonte'

type FiltroEstadoFonte = 'todas' | 'disponiveis' | 'pendencia' | 'prontas'

type ChatResumo = {
  state?: 'none' | 'available' | 'unavailable' | string
  canFetch?: boolean
  peaks?: number
}

type EnergiaResumo = {
  measured?: boolean
  marks?: { high?: number; peak?: number }
}

const OPCOES_FILTRO: OpcaoSelect<FiltroEstadoFonte>[] = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'disponiveis', rotulo: 'Disponíveis' },
  { valor: 'pendencia', rotulo: 'Offline / Alteradas' },
  { valor: 'prontas', rotulo: 'Prontas para Cortes' },
]

function formatarMetadadosFonte(fonte: FonteProjeto): string {
  const seg = Number(fonte.metadata?.format?.duration ?? 0)
  const durUs = Number.isFinite(seg) && seg > 0 ? Math.round(seg * 1_000_000) : 0
  const video = fonte.metadata?.streams?.find((s) => s.codec_type === 'video')
  const res = video?.height ? `${video.height}p` : null
  return [durUs > 0 ? tcLongo(durUs) : null, res].filter(Boolean).join(' · ')
}

function textoStatusTranscricao(st?: TranscriptStatusFonte): {
  tom: 'neutro' | 'sucesso' | 'rodando' | 'pausado'
  texto: string
} {
  if (st?.job && (st.job.state === 'queued' || st.job.state === 'running')) {
    return {
      tom: 'rodando',
      texto:
        st.job.state === 'queued'
          ? 'Na fila'
          : `Transcrevendo ${Math.round(st.job.progress)}%`,
    }
  }
  if (st?.transcript?.state === 'complete') {
    return {
      tom: 'sucesso',
      texto: `Transcrição pronta (${st.transcript.words.toLocaleString('pt-BR')} palavras)`,
    }
  }
  if (st?.transcript && st.transcript.resume_us > 0) {
    return {
      tom: 'pausado',
      texto: `Parcial (${tcLongo(st.transcript.resume_us)})`,
    }
  }
  return { tom: 'neutro', texto: 'Não transcrita' }
}

export type ListaFontesProps = {
  projetoId: string
  projetoPath: string
  fontes: FonteProjeto[]
  transcriptStatusBySource: Record<number, TranscriptStatusFonte>
  selecionadasParaLote: number[]
  invalidacoes: InvalidacoesFontes
  forcadoParcial?: boolean
  aoMudarSelecionadas: (ids: number[]) => void
  aoIrParaLote: () => void
  aoAtualizarFonte: (id: number) => Promise<void>
  aoAtualizarTodas: () => Promise<void>
}

/** Lista de Fontes do Projeto com integridade V1, seleção para Lote, Permissão e Idioma. */
export function ListaFontes({
  projetoId,
  projetoPath,
  fontes,
  transcriptStatusBySource,
  selecionadasParaLote,
  invalidacoes,
  forcadoParcial = false,
  aoMudarSelecionadas,
  aoIrParaLote,
  aoAtualizarFonte,
  aoAtualizarTodas,
}: ListaFontesProps) {
  const toast = useToast()
  const jobs = useFila()

  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoFonte>('todas')
  const [buscaNome, setBuscaNome] = useState('')
  const [idiomas, setIdiomas] = useState<IdiomaOpcao[]>(IDIOMAS_FALLBACK)
  const [chatPorFonte, setChatPorFonte] = useState<Record<number, ChatResumo | null>>({})
  const [energiaPorFonte, setEnergiaPorFonte] = useState<Record<number, EnergiaResumo | null>>({})

  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [jobVerificacaoAtivo, setJobVerificacaoAtivo] = useState<string | null>(null)

  // Modais de ação rápida
  const [alvoRelocalizar, setAlvoRelocalizar] = useState<FonteProjeto | null>(null)
  const [caminhoRelocalizar, setCaminhoRelocalizar] = useState('')
  const [ocupadoRelocalizar, setOcupadoRelocalizar] = useState(false)

  const [confirmacaoPendente, setConfirmacaoPendente] = useState<
    | { tipo: 'relocate'; fonte: FonteProjeto; path: string }
    | { tipo: 'hash'; fonte: FonteProjeto }
    | null
  >(null)
  const [confirmandoDialogo, setConfirmandoDialogo] = useState(false)

  const [alvoPermissao, setAlvoPermissao] = useState<FonteProjeto | null>(null)
  const [permEditada, setPermEditada] = useState<PermissaoFonte>({ status: 'none' })
  const [salvandoPerm, setSalvandoPerm] = useState(false)

  const [alvoIdioma, setAlvoIdioma] = useState<FonteProjeto | null>(null)
  const [idiomaEditado, setIdiomaEditado] = useState('pt')
  const [salvandoIdioma, setSalvandoIdioma] = useState(false)

  const [alvoExcluir, setAlvoExcluir] = useState<FonteProjeto | null>(null)
  const [excluindoFonte, setExcluindoFonte] = useState(false)

  useEffect(() => {
    chamar<IdiomaOpcao[]>('channel_profile.languages', {})
      .then((lista) => {
        if (Array.isArray(lista) && lista.length > 0) setIdiomas(lista)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelado = false
    if (fontes.length === 0 || fontes.length > 30) return
    Promise.all(
      fontes.map(async (f) => {
        const [chat, energia] = await Promise.all([
          chamar<ChatResumo>('chat.status', { source_id: f.id }).catch(() => null),
          chamar<EnergiaResumo>('energy.status', { source_id: f.id }).catch(() => null),
        ])
        return { id: f.id, chat, energia }
      }),
    ).then((res) => {
      if (cancelado) return
      const proxChat: Record<number, ChatResumo | null> = {}
      const proxEnergia: Record<number, EnergiaResumo | null> = {}
      for (const r of res) {
        proxChat[r.id] = r.chat
        proxEnergia[r.id] = r.energia
      }
      setChatPorFonte(proxChat)
      setEnergiaPorFonte(proxEnergia)
    })
    return () => {
      cancelado = true
    }
  }, [fontes, invalidacoes.chat, invalidacoes.energia])

  const opcoesIdioma = useMemo(() => opcoesIdiomaDe(idiomas), [idiomas])

  const pendentesCount = useMemo(
    () => fontes.filter((f) => f.status === 'offline' || f.status === 'changed').length,
    [fontes],
  )

  const fontesFiltradas = useMemo(() => {
    const q = buscaNome.trim().toLowerCase()
    return fontes.filter((f) => {
      if (filtroEstado === 'disponiveis' && f.status !== 'available') return false
      if (filtroEstado === 'pendencia' && f.status !== 'offline' && f.status !== 'changed') {
        return false
      }
      if (
        filtroEstado === 'prontas' &&
        transcriptStatusBySource[f.id]?.transcript?.state !== 'complete'
      ) {
        return false
      }
      if (q && !basenameCaminho(f.path).toLowerCase().includes(q)) return false
      return true
    })
  }, [buscaNome, filtroEstado, fontes, transcriptStatusBySource])

  const selecionadasSet = useMemo(() => new Set(selecionadasParaLote), [selecionadasParaLote])
  const todasFiltradasSelecionadas =
    fontesFiltradas.length > 0 && fontesFiltradas.every((f) => selecionadasSet.has(f.id))
  const algumaFiltradaSelecionada = fontesFiltradas.some((f) => selecionadasSet.has(f.id))
  const estadoSelecionarTodas: boolean | 'misto' = todasFiltradasSelecionadas
    ? true
    : algumaFiltradaSelecionada
      ? 'misto'
      : false

  const alternarSelecionarTodas = (marcar: boolean) => {
    const idsFiltradas = new Set(fontesFiltradas.map((f) => f.id))
    if (marcar) {
      const uniao = new Set([...selecionadasParaLote, ...idsFiltradas])
      aoMudarSelecionadas(Array.from(uniao))
    } else {
      aoMudarSelecionadas(selecionadasParaLote.filter((id) => !idsFiltradas.has(id)))
    }
  }

  const alternarFonte = (id: number, marcar: boolean) => {
    if (marcar) {
      if (!selecionadasSet.has(id)) aoMudarSelecionadas([...selecionadasParaLote, id])
    } else {
      aoMudarSelecionadas(selecionadasParaLote.filter((x) => x !== id))
    }
  }

  const executarHash = useCallback(
    async (fonte: FonteProjeto, confirmed = false) => {
      const jobId = `source-hash-${fonte.id}`
      setErroAcao(null)
      setJobVerificacaoAtivo(jobId)
      try {
        await chamar('sources.hash', {
          project: projetoPath,
          id: fonte.id,
          job: jobId,
          ...(confirmed ? { confirmed: true } : {}),
        })
        await aoAtualizarFonte(fonte.id)
        toast.add({ title: `Identidade de ${basenameCaminho(fonte.path)} verificada.` })
      } catch (err) {
        const coreErr = paraErroCore(err)
        if (coreErr.code === 'confirmation_required') {
          setConfirmacaoPendente({ tipo: 'hash', fonte })
        } else if (coreErr.code !== 'cancelled') {
          setErroAcao(coreErr)
        }
      } finally {
        setJobVerificacaoAtivo(null)
      }
    },
    [aoAtualizarFonte, projetoPath, toast],
  )

  const executarRelocate = useCallback(
    async (fonte: FonteProjeto, novoCaminho: string, confirmed = false) => {
      const jobId = `source-relocate-${fonte.id}`
      setErroAcao(null)
      setOcupadoRelocalizar(true)
      setJobVerificacaoAtivo(jobId)
      try {
        await chamar('sources.relocate', {
          project: projetoPath,
          id: fonte.id,
          path: novoCaminho,
          job: jobId,
          ...(confirmed ? { confirmed: true } : {}),
        })
        setAlvoRelocalizar(null)
        setCaminhoRelocalizar('')
        await aoAtualizarFonte(fonte.id)
        toast.add({ title: `Fonte ${basenameCaminho(novoCaminho)} relocalizada.` })
      } catch (err) {
        const coreErr = paraErroCore(err)
        if (coreErr.code === 'confirmation_required') {
          setAlvoRelocalizar(null)
          setConfirmacaoPendente({ tipo: 'relocate', fonte, path: novoCaminho })
        } else if (coreErr.code !== 'cancelled') {
          setErroAcao(coreErr)
        }
      } finally {
        setOcupadoRelocalizar(false)
        setJobVerificacaoAtivo(null)
      }
    },
    [aoAtualizarFonte, projetoPath, toast],
  )

  const submeterRelocalizar = async (e: FormEvent) => {
    e.preventDefault()
    if (!alvoRelocalizar || !caminhoRelocalizar.trim()) return
    await executarRelocate(alvoRelocalizar, caminhoRelocalizar.trim(), false)
  }

  const confirmarPendencia = async () => {
    if (!confirmacaoPendente) return
    const atual = confirmacaoPendente
    setConfirmandoDialogo(true)
    try {
      setConfirmacaoPendente(null)
      if (atual.tipo === 'relocate') {
        await executarRelocate(atual.fonte, atual.path, true)
      } else {
        await executarHash(atual.fonte, true)
      }
    } finally {
      setConfirmandoDialogo(false)
    }
  }

  const salvarPermissao = async () => {
    if (!alvoPermissao || !permissaoValida(permEditada)) return
    setSalvandoPerm(true)
    setErroAcao(null)
    try {
      await chamar('sources.permission.set', {
        project: projetoPath,
        id: alvoPermissao.id,
        permission: permEditada,
      })
      setAlvoPermissao(null)
      await aoAtualizarTodas()
      toast.add({ title: 'Permissão da Fonte atualizada.' })
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setSalvandoPerm(false)
    }
  }

  const salvarIdioma = async () => {
    if (!alvoIdioma) return
    setSalvandoIdioma(true)
    setErroAcao(null)
    try {
      await chamar('sources.language.set', {
        project: projetoPath,
        id: alvoIdioma.id,
        language: idiomaEditado,
      })
      setAlvoIdioma(null)
      await aoAtualizarFonte(alvoIdioma.id)
      toast.add({ title: 'Idioma da Fonte atualizado.' })
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setSalvandoIdioma(false)
    }
  }

  const confirmarExclusao = async () => {
    if (!alvoExcluir) return
    const fonteAlvo = alvoExcluir
    setExcluindoFonte(true)
    setErroAcao(null)
    try {
      const res = await chamar<{
        deleted?: boolean
        jobs_kept_for_costs?: number
      }>('sources.delete', {
        project: projetoPath,
        id: fonteAlvo.id,
      })
      setAlvoExcluir(null)
      await aoAtualizarTodas()
      const nome = basenameCaminho(fonteAlvo.path)
      const sufixoCustos =
        res && typeof res.jobs_kept_for_costs === 'number' && res.jobs_kept_for_costs > 0
          ? ' Histórico de custos mantido.'
          : ''
      toast.add({
        title: `Fonte ${nome} excluída.${sufixoCustos}`,
      })
    } catch (err) {
      setAlvoExcluir(null)
      setErroAcao(paraErroCore(err))
    } finally {
      setExcluindoFonte(false)
    }
  }

  const jobAtivoLista = useMemo(() => {
    const porNome = jobs.find(
      (j) =>
        j.estado === 'rodando' &&
        (j.id === jobVerificacaoAtivo ||
          j.id.startsWith('source-hash') ||
          j.id.startsWith('source-relocate')),
    )
    return porNome
  }, [jobVerificacaoAtivo, jobs])

  const encProjeto = encodeURIComponent(projetoId)
  const qtdSel = selecionadasParaLote.length
  const rotuloLote =
    qtdSel === 0
      ? 'Processar em lote'
      : qtdSel === 1
        ? 'Processar 1 Fonte em lote'
        : `Processar ${qtdSel} Fontes em lote`

  const renderizarCardFonte = (fonte: FonteProjeto) => {
    const nome = basenameCaminho(fonte.path)
    const st = transcriptStatusBySource[fonte.id]
    const statusTr = textoStatusTranscricao(st)
    const metaResumo = formatarMetadadosFonte(fonte)
    const pronta = st?.transcript?.state === 'complete'
    const transcrevendoOuConcluida =
      Boolean(st?.transcript && st.transcript.resume_us > 0) ||
      pronta ||
      Boolean(st?.job && ['queued', 'running', 'uncertain'].includes(st.job.state))
    const chat = chatPorFonte[fonte.id]
    const energia = energiaPorFonte[fonte.id]
    const selecionada = selecionadasSet.has(fonte.id)

    return (
      <article
        aria-label={nome}
        className={cn(
          'flex flex-col gap-2 rounded-area bg-area p-3 transition-colors duration-(--dur-rapida)',
          selecionada && 'marcado',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            marcado={selecionada}
            aoMudar={(v) => alternarFonte(fonte.id, v)}
            className="mr-0.5"
          >
            <span className="sr-only">{`Selecionar ${nome} para lote`}</span>
          </Checkbox>

          <strong className="min-w-0 truncate text-base font-medio text-t1" title={fonte.path}>
            {nome}
          </strong>

          <span className="rounded-mini bg-elevado px-1.5 py-0.5 text-micro text-t3">
            {fonte.origin_url ? 'URL' : 'Local'}
          </span>

          {fonte.status === 'available' ? (
            <Status tom="sucesso">Disponível</Status>
          ) : fonte.status === 'offline' ? (
            <Status tom="aviso">Offline</Status>
          ) : (
            <Status tom="aviso">Alterada</Status>
          )}

          <Status tom={statusTr.tom} className="ml-auto">
            {statusTr.texto}
          </Status>
        </div>

        {fonte.status === 'offline' && (
          <p className="pl-6 text-pequeno text-t2">
            Arquivo não encontrado no disco (<span className="font-mono text-t3">{fonte.path}</span>
            ). Transcrição e edição continuam acessíveis; preview e exportação bloqueados.
          </p>
        )}

        {fonte.status === 'changed' && (
          <p className="pl-6 text-pequeno text-t2">
            Arquivo mudou desde a importação. Verifique a identidade antes de usar preview ou
            exportar.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-pequeno text-t3">
          {metaResumo && <span className="num">{metaResumo}</span>}
          <span>Idioma: {formatarNomeIdioma(fonte.language)}</span>
          <span>
            Permissão:{' '}
            {fonte.permission.status === 'granted' ? 'Autorizada' : 'Sem permissão'}
          </span>
          {chat && (
            <span>
              Chat:{' '}
              {chat.state === 'available'
                ? `${chat.peaks ?? 0} picos`
                : chat.canFetch
                  ? 'Não buscado'
                  : 'Sem chat'}
            </span>
          )}
          {energia && <span>Energia: {energia.measured ? 'Medida' : 'Pendente'}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pl-6 pt-0.5">
          {pronta && (
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<ArrowRight />}
              onClick={() => {
                window.location.hash = `#/projeto/${encProjeto}/cortes?fonte=${fonte.id}`
              }}
            >
              Ir para Cortes
            </Botao>
          )}

          <Botao
            variante="secundario"
            tamanho="p"
            onClick={() => {
              window.location.hash = `#/projeto/${encProjeto}/fontes/${fonte.id}`
            }}
          >
            Abrir
          </Botao>

          {fonte.status === 'offline' && (
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<Wrench />}
              onClick={() => {
                setAlvoRelocalizar(fonte)
                setCaminhoRelocalizar('')
              }}
            >
              Relocalizar arquivo
            </Botao>
          )}

          {(fonte.status === 'changed' || !fonte.verified) && fonte.status !== 'offline' && (
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<RefreshCw />}
              onClick={() => void executarHash(fonte, false)}
            >
              Verificar identidade
            </Botao>
          )}

          <Botao
            variante="fantasma"
            tamanho="p"
            icone={<ShieldCheck />}
            onClick={() => {
              setAlvoPermissao(fonte)
              setPermEditada(fonte.permission)
            }}
          >
            Permissão
          </Botao>

          {!transcrevendoOuConcluida && (
            <Botao
              variante="fantasma"
              tamanho="p"
              icone={<Languages />}
              onClick={() => {
                setAlvoIdioma(fonte)
                setIdiomaEditado(fonte.language)
              }}
            >
              Idioma
            </Botao>
          )}

          <Botao
            variante="perigo"
            tamanho="p"
            icone={<Trash2 />}
            className="ml-auto"
            onClick={() => setAlvoExcluir(fonte)}
          >
            Excluir Fonte
          </Botao>
        </div>
      </article>
    )
  }

  const traducaoErroAcao = erroAcao ? mensagemDeErro(erroAcao) : null

  return (
    <section
      aria-label="Fontes do Projeto"
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      {erroAcao && traducaoErroAcao && (
        <BannerErroCore
          erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
          traduzir={() => ({ titulo: traducaoErroAcao.titulo })}
          acaoRecuperacao={
            traducaoErroAcao.recuperacao?.acao === 'abrir-fila'
              ? {
                  rotulo: traducaoErroAcao.recuperacao.rotulo,
                  aoAcionar: () => {
                    toast.add({
                      title: 'Fila de Jobs',
                      description:
                        'Use o botão Fila no topo ou Ctrl+J para acompanhar tarefas ativas.',
                    })
                  },
                }
              : traducaoErroAcao.recuperacao?.rota
                ? {
                    rotulo: traducaoErroAcao.recuperacao.rotulo,
                    aoAcionar: () => {
                      window.location.hash = traducaoErroAcao.recuperacao!.rota!
                    },
                  }
                : undefined
          }
          aoDispensar={() => setErroAcao(null)}
          permitirRelato
        />
      )}

      {jobAtivoLista && (
        <FaixaJob
          rotulo={jobAtivoLista.mensagem || 'Verificando Fonte…'}
          detalhe={`${Math.round(jobAtivoLista.percentual)}%`}
          aoCancelar={() => void chamar('sources.cancel', { job: jobAtivoLista.id })}
        >
          <Progresso valor={jobAtivoLista.percentual} rotulo={jobAtivoLista.mensagem} compacto />
        </FaixaJob>
      )}

      {(pendentesCount > 0 || forcadoParcial) && (
        <EstadoTela
          tipo="parcial"
          compacto
          titulo={`${pendentesCount || 1} ${
            (pendentesCount || 1) === 1 ? 'Fonte precisa' : 'Fontes precisam'
          } de verificação ou relocalização no disco.`}
          descricao="A leitura e edição da Transcrição continuam disponíveis."
          acaoPrimaria={{
            rotulo:
              filtroEstado === 'pendencia' ? 'Mostrar todas' : 'Ver apenas com pendência',
            aoAcionar: () =>
              setFiltroEstado((prev) => (prev === 'pendencia' ? 'todas' : 'pendencia')),
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-area bg-area px-3 py-2">
        <Checkbox
          marcado={estadoSelecionarTodas}
          aoMudar={alternarSelecionarTodas}
          className="text-pequeno"
        >
          Selecionar todas
        </Checkbox>

        <span className="num text-pequeno text-t3">
          {qtdSel === 1 ? '1 Fonte selecionada' : `${qtdSel} Fontes selecionadas`}
        </span>

        <Botao
          variante="secundario"
          tamanho="p"
          disabled={qtdSel === 0}
          onClick={aoIrParaLote}
        >
          {rotuloLote}
        </Botao>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            valor={filtroEstado}
            aoMudar={setFiltroEstado}
            opcoes={OPCOES_FILTRO}
            rotulo="Filtrar Fontes por estado"
            className="min-w-36"
          />
          <Busca
            rotulo="Filtrar Fontes por nome"
            placeholder="Filtrar nome…"
            value={buscaNome}
            onChange={(e) => setBuscaNome(e.target.value)}
            className="w-44"
          />
        </div>
      </div>

      {fontesFiltradas.length === 0 ? (
        <div className="rounded-area bg-area px-4 py-6 text-center text-pequeno text-t2">
          Nenhuma Fonte corresponde ao filtro atual.
        </div>
      ) : fontesFiltradas.length > 30 ? (
        <ListaVirtual
          itens={fontesFiltradas}
          total={fontesFiltradas.length}
          alturaItem={128}
          obterId={(f) => f.id}
          ariaLabel="Lista de Fontes"
          papel="region"
          className="min-h-0 flex-1"
          renderizarItem={(fonte) => (
            <div className="pb-2">{renderizarCardFonte(fonte)}</div>
          )}
        />
      ) : (
        <AreaRolagem rotulo="Lista de Fontes" className="min-h-0 flex-1">
          <ul aria-label="Fontes do Projeto" className="m-0 flex list-none flex-col gap-2 p-0">
            {fontesFiltradas.map((fonte) => (
              <li key={fonte.id}>{renderizarCardFonte(fonte)}</li>
            ))}
          </ul>
        </AreaRolagem>
      )}

      {/* Diálogo: Relocalizar arquivo offline */}
      <Dialogo
        aberto={Boolean(alvoRelocalizar)}
        aoMudarAberto={(v) => {
          if (!v && !ocupadoRelocalizar) {
            setAlvoRelocalizar(null)
            setCaminhoRelocalizar('')
          }
        }}
        titulo={
          alvoRelocalizar
            ? `Relocalizar arquivo — ${basenameCaminho(alvoRelocalizar.path)}`
            : 'Relocalizar arquivo'
        }
        descricao="Escolha o arquivo correspondente no disco. A Transcrição existente será preservada."
        largura={500}
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={ocupadoRelocalizar}
              onClick={() => {
                setAlvoRelocalizar(null)
                setCaminhoRelocalizar('')
              }}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              type="submit"
              form="form-relocalizar-fonte"
              carregando={ocupadoRelocalizar}
              disabled={!caminhoRelocalizar.trim()}
            >
              Relocalizar
            </Botao>
          </>
        }
      >
        <form id="form-relocalizar-fonte" onSubmit={(e) => void submeterRelocalizar(e)}>
          <SeletorCaminho
            rotulo="Arquivo de vídeo"
            modo="arquivo"
            valor={caminhoRelocalizar}
            aoMudar={setCaminhoRelocalizar}
            desabilitado={ocupadoRelocalizar}
          />
        </form>
      </Dialogo>

      {/* ConfirmDialog para confirmation_required (V1 sem full_hash ou arquivo alterado) */}
      <ConfirmDialog
        aberto={Boolean(confirmacaoPendente)}
        aoMudarAberto={(v) => {
          if (!v && !confirmandoDialogo) setConfirmacaoPendente(null)
        }}
        titulo="Confirmar que o arquivo é a mesma Fonte?"
        descricao={
          confirmacaoPendente?.tipo === 'relocate'
            ? `A Fonte ${basenameCaminho(confirmacaoPendente.fonte.path)} não tinha verificação completa salva anteriormente. Tamanho, duração e amostras conferem com o arquivo selecionado.`
            : `O arquivo de ${confirmacaoPendente ? basenameCaminho(confirmacaoPendente.fonte.path) : ''} mudou desde a importação ou não tinha verificação completa salva.`
        }
        rotuloConfirmar={
          confirmacaoPendente?.tipo === 'relocate'
            ? 'Confirmar relocalização'
            : 'Confirmar verificação'
        }
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={confirmandoDialogo}
        aoConfirmar={confirmarPendencia}
      />

      {/* Diálogo: Editar Permissão */}
      <Dialogo
        aberto={Boolean(alvoPermissao)}
        aoMudarAberto={(v) => {
          if (!v && !salvandoPerm) setAlvoPermissao(null)
        }}
        titulo={
          alvoPermissao
            ? `Editar Permissão — ${basenameCaminho(alvoPermissao.path)}`
            : 'Editar Permissão'
        }
        largura={500}
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={salvandoPerm}
              onClick={() => setAlvoPermissao(null)}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={salvandoPerm}
              disabled={!permissaoValida(permEditada)}
              onClick={() => void salvarPermissao()}
            >
              Salvar Permissão
            </Botao>
          </>
        }
      >
        <CampoPermissao
          valor={permEditada}
          aoMudar={setPermEditada}
          obrigatorio
          somenteLeitura={salvandoPerm}
        />
      </Dialogo>

      {/* Diálogo: Alterar Idioma */}
      <Dialogo
        aberto={Boolean(alvoIdioma)}
        aoMudarAberto={(v) => {
          if (!v && !salvandoIdioma) setAlvoIdioma(null)
        }}
        titulo={
          alvoIdioma
            ? `Alterar idioma — ${basenameCaminho(alvoIdioma.path)}`
            : 'Alterar idioma'
        }
        largura={420}
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={salvandoIdioma}
              onClick={() => setAlvoIdioma(null)}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={salvandoIdioma}
              onClick={() => void salvarIdioma()}
            >
              Salvar idioma
            </Botao>
          </>
        }
      >
        <Select
          valor={idiomaEditado}
          aoMudar={setIdiomaEditado}
          opcoes={opcoesIdioma}
          rotulo="Idioma falado"
          desabilitado={salvandoIdioma}
        />
      </Dialogo>

      {/* ConfirmDialog: Excluir Fonte */}
      <ConfirmDialog
        aberto={Boolean(alvoExcluir)}
        aoMudarAberto={(v) => {
          if (!v && !excluindoFonte) setAlvoExcluir(null)
        }}
        titulo={
          alvoExcluir
            ? `Excluir Fonte — ${basenameCaminho(alvoExcluir.path)}?`
            : 'Excluir Fonte?'
        }
        descricao={
          alvoExcluir
            ? `A Transcrição, os Cortes e as edições vinculados a ${basenameCaminho(alvoExcluir.path)} saem deste Projeto. O histórico de custos é mantido e o arquivo original no disco não é apagado.`
            : ''
        }
        variante="perigo"
        rotuloConfirmar="Excluir Fonte"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={excluindoFonte}
        aoConfirmar={confirmarExclusao}
      />
    </section>
  )
}
