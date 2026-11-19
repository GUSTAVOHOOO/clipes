import {
  AreaTexto,
  BannerErroCore,
  Botao,
  Campo,
  ConfirmDialog,
  Dialogo,
  Entrada,
  EstadoTela,
  FaixaJob,
  Kbd,
  Menu,
  MenuItem,
  MenuSeparador,
  Progresso,
  ResumoCustoPrivacidade,
  Select,
  Status,
  cn,
} from '@ds'
import { ChevronRight, MoreVertical, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatarTecla } from '~/comandos/atalhos'
import { ContadorLimite } from '~/componentes/ContadorLimite'
import { ListaChips } from '~/componentes/ListaChips'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila } from '~/core/progresso'
import type { PerfilProvedorLista } from '~/stores/selecaoProjeto'
import type { BlocoRoteiro, RoteiroDoc } from '~/stores/transformarCorte'
import {
  OPCOES_IDIOMA,
  converterEstimativa,
  normalizarIdioma,
  parsearIdsFrase,
  type AlvoRefsEmFoco,
  type EstimativaProvedorBruta,
  type StoreTransformarPasso,
} from '~/telas/corte/transformar/PassoAngulo'

export interface PassoRoteiroProps {
  candidateId: number
  store: StoreTransformarPasso
  fila?: Fila
  modalPaiAberto?: boolean
  aoMudarRefEmFoco?: (alvo: AlvoRefsEmFoco | null) => void
  aoClicarChipFrase?: (fraseId: number) => void
  aoAvancarNarracao?: () => void
  blocoFocadoInicial?: number | null
}

interface RespostaEstimativaRoteiro {
  paid: boolean
  profile?: string
  language?: string
  estimate: EstimativaProvedorBruta
}

type RascunhoBloco = {
  title: string
  narration: string
  refs: number[]
}

type ErrosBloco = {
  title?: string
  narration?: string
  refs?: string
}

type AcaoConfirmacaoRoteiro =
  | { tipo: 'gerar'; estimativa: RespostaEstimativaRoteiro }
  | { tipo: 'regenerar'; blockId: number; profileId?: string; estimativa: RespostaEstimativaRoteiro }

function rascunhoIgualBloco(rascunho: RascunhoBloco, bloco: BlocoRoteiro): boolean {
  return (
    rascunho.title === bloco.title &&
    rascunho.narration === (bloco.narration ?? '') &&
    JSON.stringify(rascunho.refs) === JSON.stringify(bloco.refs)
  )
}

function blocoEstaGerando(bloco: BlocoRoteiro): boolean {
  const job = bloco.job as { state?: string } | null
  return job?.state === 'queued' || job?.state === 'running'
}

/**
 * Passo 2 de Transformar: Roteiro em blocos com banner ADR-0001, edição com `Ctrl+S`,
 * bloqueio de aprovação enquanto sujo, validação `script.narration_allowed` e regeneração com `profileId`.
 */
export function PassoRoteiro({
  candidateId,
  store,
  fila,
  modalPaiAberto = false,
  aoMudarRefEmFoco,
  aoClicarChipFrase,
  aoAvancarNarracao,
  blocoFocadoInicial = null,
}: PassoRoteiroProps) {
  const jobs = useFila(fila)
  const roteiro = store.roteiro
  const angulos = store.angulos
  const current = roteiro?.current ?? null
  const limits = roteiro?.limits ?? {
    titleChars: 80,
    narrationChars: 800,
    scriptChars: 6000,
    refs: 50,
  }

  const languageRequired = Boolean(roteiro?.languageRequired)
  const [idioma, setIdioma] = useState<'pt-BR' | 'en' | null>(() =>
    normalizarIdioma(roteiro?.detectedLanguage ?? angulos?.detectedLanguage),
  )
  const [erroIdioma, setErroIdioma] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)

  const [rascunhos, setRascunhos] = useState<Record<number, RascunhoBloco>>({})
  const [errosBlocos, setErrosBlocos] = useState<Record<number, ErrosBloco>>({})
  const [blocoEmFocoId, setBlocoEmFocoId] = useState<number | null>(blocoFocadoInicial)

  const [estimando, setEstimando] = useState(false)
  const [disparandoGeracao, setDisparandoGeracao] = useState(false)
  const [confirmacao, setConfirmacao] = useState<AcaoConfirmacaoRoteiro | null>(null)
  const [salvandoBlocoId, setSalvandoBlocoId] = useState<number | null>(null)
  const [aprovandoBlocoId, setAprovandoBlocoId] = useState<number | null>(null)

  const [blocoEscolhendoPerfil, setBlocoEscolhendoPerfil] = useState<number | null>(null)
  const [perfisExtras, setPerfisExtras] = useState<PerfilProvedorLista[] | null>(null)
  const [carregandoPerfis, setCarregandoPerfis] = useState(false)
  const [anuncio, setAnuncio] = useState('')

  const selectIdiomaRef = useRef<HTMLDivElement | null>(null)
  const listaBlocosRef = useRef<HTMLOListElement | null>(null)
  const versoesAnterioresRef = useRef<Map<number, number>>(new Map())
  const aoMudarRefEmFocoRef = useRef(aoMudarRefEmFoco)
  aoMudarRefEmFocoRef.current = aoMudarRefEmFoco

  useEffect(() => {
    const detectado = normalizarIdioma(roteiro?.detectedLanguage ?? angulos?.detectedLanguage)
    if (detectado && !idioma) {
      setIdioma(detectado)
    }
  }, [roteiro?.detectedLanguage, angulos?.detectedLanguage, idioma])

  // Limpa rascunhos de blocos cuja versão no servidor avançou (ex.: após salvar ou regenerar)
  useEffect(() => {
    if (!current) {
      setRascunhos({})
      setErrosBlocos({})
      versoesAnterioresRef.current.clear()
      return
    }
    const proximasVersoes = new Map<number, number>()
    const blocosAtualizados: number[] = []
    for (const b of current.blocks) {
      proximasVersoes.set(b.id, b.version)
      const prevVer = versoesAnterioresRef.current.get(b.id)
      if (prevVer !== undefined && prevVer !== b.version) {
        blocosAtualizados.push(b.id)
      }
    }
    versoesAnterioresRef.current = proximasVersoes
    if (blocosAtualizados.length > 0) {
      setRascunhos((prev) => {
        const copia = { ...prev }
        for (const id of blocosAtualizados) delete copia[id]
        return copia
      })
    }
  }, [current])

  useEffect(() => {
    if (blocoFocadoInicial == null) return
    setBlocoEmFocoId(blocoFocadoInicial)
    const alvo = listaBlocosRef.current?.querySelector<HTMLElement>(
      `[data-bloco-id="${blocoFocadoInicial}"]`,
    )
    if (alvo) {
      if (typeof alvo.scrollIntoView === 'function') {
        alvo.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      alvo.querySelector<HTMLElement>('input, textarea')?.focus()
    }
  }, [blocoFocadoInicial, current?.blocks.length])

  const obterRascunho = (bloco: BlocoRoteiro): RascunhoBloco =>
    rascunhos[bloco.id] ?? {
      title: bloco.title,
      narration: bloco.narration ?? '',
      refs: [...bloco.refs],
    }

  const blocoEmFoco = useMemo(
    () => current?.blocks.find((b) => b.id === blocoEmFocoId) ?? null,
    [current, blocoEmFocoId],
  )
  const rascunhoFoco = blocoEmFoco ? obterRascunho(blocoEmFoco) : null

  useEffect(() => {
    if (!blocoEmFoco || !rascunhoFoco) {
      aoMudarRefEmFocoRef.current?.(null)
      return
    }
    aoMudarRefEmFocoRef.current?.({
      chave: `bloco-${blocoEmFoco.id}`,
      refs: rascunhoFoco.refs,
      alternarId: (id) => {
        setRascunhos((prev) => {
          const atual = prev[blocoEmFoco.id] ?? {
            title: blocoEmFoco.title,
            narration: blocoEmFoco.narration ?? '',
            refs: [...blocoEmFoco.refs],
          }
          if (atual.refs.includes(id)) {
            return {
              ...prev,
              [blocoEmFoco.id]: { ...atual, refs: atual.refs.filter((r) => r !== id) },
            }
          }
          if (atual.refs.length >= limits.refs) {
            setErrosBlocos((e) => ({
              ...e,
              [blocoEmFoco.id]: {
                ...e[blocoEmFoco.id],
                refs: `Máximo de ${limits.refs} referências permitido.`,
              },
            }))
            return prev
          }
          setErrosBlocos((e) => ({
            ...e,
            [blocoEmFoco.id]: { ...e[blocoEmFoco.id], refs: undefined },
          }))
          return {
            ...prev,
            [blocoEmFoco.id]: { ...atual, refs: [...atual.refs, id] },
          }
        })
      },
    })
  }, [blocoEmFoco, rascunhoFoco, limits.refs])

  useEffect(() => {
    return () => {
      aoMudarRefEmFocoRef.current?.(null)
    }
  }, [])

  useEffect(() => {
    if (blocoEscolhendoPerfil == null || store.perfis.length > 0) return
    let cancelado = false
    setCarregandoPerfis(true)
    void chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {})
      .then((res) => {
        if (!cancelado) setPerfisExtras(res.profiles ?? [])
      })
      .catch((e) => {
        if (!cancelado) setErroAcao(paraErroCore(e))
      })
      .finally(() => {
        if (!cancelado) setCarregandoPerfis(false)
      })
    return () => {
      cancelado = true
    }
  }, [blocoEscolhendoPerfil, store.perfis.length])

  const jobRoteiroFila = useMemo(
    () =>
      jobs.find(
        (j) =>
          (j.etapa.startsWith('ai:script:') || j.etapa.startsWith('ai:script_block:')) &&
          j.estado === 'rodando',
      ) ?? null,
    [jobs],
  )

  const gerandoRoteiro =
    disparandoGeracao ||
    Boolean(roteiro?.busy) ||
    roteiro?.job?.state === 'running' ||
    roteiro?.job?.state === 'queued' ||
    Boolean(jobRoteiroFila)

  const jobIdAtivo = jobRoteiroFila ? Number(jobRoteiroFila.id) : roteiro?.job?.id ?? null

  const cancelarGeracao = async () => {
    if (jobIdAtivo == null || !Number.isFinite(jobIdAtivo)) return
    setErroAcao(null)
    try {
      await chamar('jobs.cancel', { id: jobIdAtivo })
      await store.recarregarRoteiro()
    } catch (e) {
      setErroAcao(paraErroCore(e))
    }
  }

  const executarConfirmacao = async (acao: AcaoConfirmacaoRoteiro, confirmed: boolean) => {
    setErroAcao(null)
    setDisparandoGeracao(true)
    try {
      if (acao.tipo === 'gerar') {
        await chamar('script.generate', {
          candidate: candidateId,
          ...(idioma ? { language: idioma } : {}),
          confirmed,
        })
      } else {
        await chamar('script.regenerate', {
          candidate: candidateId,
          block: acao.blockId,
          ...(acao.profileId ? { profileId: acao.profileId } : {}),
          ...(idioma ? { language: idioma } : {}),
          confirmed,
        })
      }
      setConfirmacao(null)
      await store.recarregarRoteiro()
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'confirmation_required' && !confirmed) {
        setConfirmacao(acao)
      } else {
        setConfirmacao(null)
        setErroAcao(err)
      }
    } finally {
      setDisparandoGeracao(false)
    }
  }

  const solicitarGeracaoRoteiro = async () => {
    setErroAcao(null)
    setErroIdioma(null)
    if (languageRequired && !idioma) {
      setErroIdioma('Escolha o idioma do Corte (PT-BR ou EN) antes de gerar o Roteiro.')
      selectIdiomaRef.current?.querySelector('button')?.focus()
      return
    }
    setEstimando(true)
    try {
      const est = await chamar<RespostaEstimativaRoteiro>('script.estimate', {
        candidate: candidateId,
        ...(idioma ? { language: idioma } : {}),
      })
      const destino = store.resolverDestino(est.profile)
      const acao: AcaoConfirmacaoRoteiro = { tipo: 'gerar', estimativa: est }
      if (est.paid || destino.localidade === 'cli' || destino.saiDaMaquina) {
        setConfirmacao(acao)
        return
      }
      await executarConfirmacao(acao, false)
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'language_required') {
        setErroIdioma('Escolha o idioma do Corte (PT-BR ou EN) antes de gerar o Roteiro.')
        selectIdiomaRef.current?.querySelector('button')?.focus()
      } else {
        setErroAcao(err)
      }
    } finally {
      setEstimando(false)
    }
  }

  const solicitarRegeneracaoBloco = async (blockId: number, profileId?: string) => {
    setErroAcao(null)
    setBlocoEscolhendoPerfil(null)
    setEstimando(true)
    try {
      const est = await chamar<RespostaEstimativaRoteiro>('script.estimate', {
        candidate: candidateId,
        block: blockId,
        ...(profileId ? { profileId } : {}),
        ...(idioma ? { language: idioma } : {}),
      })
      const destino = store.resolverDestino(est.profile ?? profileId)
      const acao: AcaoConfirmacaoRoteiro = {
        tipo: 'regenerar',
        blockId,
        profileId,
        estimativa: est,
      }
      if (est.paid || destino.localidade === 'cli' || destino.saiDaMaquina) {
        setConfirmacao(acao)
        return
      }
      await executarConfirmacao(acao, false)
    } catch (e) {
      setErroAcao(paraErroCore(e))
    } finally {
      setEstimando(false)
    }
  }

  const salvarEdicaoBloco = async (bloco: BlocoRoteiro) => {
    const rascunho = obterRascunho(bloco)
    if (rascunhoIgualBloco(rascunho, bloco)) return

    const tituloTrim = rascunho.title.trim()
    const narracaoTrim = rascunho.narration.trim()
    const erros: ErrosBloco = {}
    if (!tituloTrim) erros.title = 'O título do bloco não pode ficar vazio.'
    else if ([...tituloTrim].length > limits.titleChars) {
      erros.title = `Máximo de ${limits.titleChars} caracteres.`
    }
    if (!narracaoTrim) erros.narration = 'O texto da Narração não pode ficar vazio.'
    else if ([...narracaoTrim].length > limits.narrationChars) {
      erros.narration = `Máximo de ${limits.narrationChars} caracteres.`
    }
    if (rascunho.refs.length > limits.refs) {
      erros.refs = `Máximo de ${limits.refs} referências.`
    }

    if (erros.title || erros.narration || erros.refs) {
      setErrosBlocos((prev) => ({ ...prev, [bloco.id]: erros }))
      return
    }

    setErroAcao(null)
    setSalvandoBlocoId(bloco.id)
    try {
      await chamar<RoteiroDoc>('script.edit', {
        candidate: candidateId,
        block: bloco.id,
        title: tituloTrim,
        narration: narracaoTrim,
        refs: rascunho.refs,
      })
      setRascunhos((prev) => {
        const copia = { ...prev }
        delete copia[bloco.id]
        return copia
      })
      setErrosBlocos((prev) => ({ ...prev, [bloco.id]: {} }))
      await store.recarregarRoteiro()
      setAnuncio(`Edição do bloco ${bloco.position} salva. Bloco retornou para Pendente.`)
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'edit_invalid' && err.usage && typeof err.usage === 'object') {
        const violations = (err.usage as { violations?: Array<{ path?: string; message?: string }> }).violations
        if (Array.isArray(violations)) {
          const mapeados: ErrosBloco = {}
          for (const v of violations) {
            if (v.path === '/title') mapeados.title = v.message || 'Título inválido.'
            else if (v.path === '/narration') mapeados.narration = v.message || 'Texto inválido.'
            else if (v.path === '/refs') mapeados.refs = v.message || 'Referências inválidas.'
          }
          setErrosBlocos((prev) => ({ ...prev, [bloco.id]: mapeados }))
        }
      }
      setErroAcao(err)
    } finally {
      setSalvandoBlocoId(null)
    }
  }

  const aprovarBloco = async (bloco: BlocoRoteiro) => {
    if (!current) return
    const rascunho = obterRascunho(bloco)
    if (!rascunhoIgualBloco(rascunho, bloco)) return
    if (!bloco.narration?.trim()) return

    setErroAcao(null)
    setAprovandoBlocoId(bloco.id)
    try {
      const pendentesAntes = current.blocks.filter((b) => b.status !== 'aprovado').length
      const resp = await chamar<RoteiroDoc>('script.approve', {
        candidate: candidateId,
        block: bloco.id,
      })
      const pendentesDepois =
        resp?.current?.pending ??
        Math.max(0, pendentesAntes - (bloco.status !== 'aprovado' ? 1 : 0))

      if (pendentesDepois === 0 || resp?.narrationAllowed) {
        await chamar<{ allowed: boolean }>('script.narration_allowed', {
          candidate: candidateId,
        })
      } else {
        setAnuncio(
          `Bloco ${bloco.position} aprovado. Faltam ${pendentesDepois} de ${current.blocks.length} blocos para aprovar.`,
        )
      }
      await store.recarregarRoteiro()
    } catch (e) {
      setErroAcao(paraErroCore(e))
    } finally {
      setAprovandoBlocoId(null)
    }
  }

  const aoAlterarChipsBloco = (bloco: BlocoRoteiro, itens: string[]) => {
    const { ids, invalido } = parsearIdsFrase(itens)
    if (invalido) {
      setErrosBlocos((prev) => ({
        ...prev,
        [bloco.id]: { ...prev[bloco.id], refs: 'Informe apenas IDs numéricos de Frase.' },
      }))
      return
    }
    setErrosBlocos((prev) => ({
      ...prev,
      [bloco.id]: { ...prev[bloco.id], refs: undefined },
    }))
    setRascunhos((prev) => {
      const atual = prev[bloco.id] ?? {
        title: bloco.title,
        narration: bloco.narration ?? '',
        refs: [...bloco.refs],
      }
      return { ...prev, [bloco.id]: { ...atual, refs: ids } }
    })
  }

  const aoTeclarNoBloco = (bloco: BlocoRoteiro, e: KeyboardEvent<HTMLElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      const rascunho = obterRascunho(bloco)
      if (!rascunhoIgualBloco(rascunho, bloco)) {
        e.preventDefault()
        e.stopPropagation()
        void salvarEdicaoBloco(bloco)
      }
    }
  }

  const totalCharsAoVivo = useMemo(() => {
    if (!current) return 0
    return current.blocks.reduce((soma, b) => {
      const r = rascunhos[b.id]
      const texto = r ? r.narration : (b.narration ?? '')
      return soma + [...texto].length
    }, 0)
  }, [current, rascunhos])

  const blocosProntos = current
    ? current.blocks.filter((b) => b.narration !== null && b.narration.trim() !== '').length
    : 0
  const roteiroParcial = Boolean(current && (!current.complete || blocosProntos < current.blocks.length))
  const anguloAtivo = roteiro?.angle ?? angulos?.selected ?? null
  const perfisDisponiveis = store.perfis.length > 0 ? store.perfis : (perfisExtras ?? [])
  const modalAberto = Boolean(modalPaiAberto || confirmacao !== null || blocoEscolhendoPerfil !== null)

  const destinoConfirmacao = confirmacao
    ? store.resolverDestino(
        confirmacao.estimativa.profile ??
          (confirmacao.tipo === 'regenerar' ? confirmacao.profileId : undefined),
      )
    : null

  return (
    <div className="mx-auto flex w-full max-w-[68ch] flex-col gap-4">
      <section
        aria-label="Regra da revisão humana"
        className="flex items-start gap-2.5 rounded-area bg-area px-3 py-2.5"
      >
        <ShieldCheck className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-base font-medio text-t1">
            Revisão humana obrigatória antes da Narração
          </p>
          <p className="mt-0.5 mb-0 text-pequeno text-t2">
            O Provedor sugere um rascunho em blocos, mas só você aprova o texto final. A etapa de Narração é liberada apenas quando todos os blocos estiverem aprovados — isso garante Transformação real e evita conteúdo automático repetitivo.
          </p>
        </div>
      </section>

      <header className="flex flex-wrap items-start justify-between gap-3 rounded-area bg-area p-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-titulo font-forte tracking-[-0.01em] text-t1">
            2. Roteiro em blocos
          </h2>
          {anguloAtivo && (
            <p className="mt-0.5 mb-0 truncate text-pequeno text-t2">
              Ângulo ativo: <span className="text-t1">{anguloAtivo.name}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {current && (
            <Botao
              variante={!modalAberto && !roteiro?.narrationAllowed ? 'primario' : 'secundario'}
              carregando={estimando || gerandoRoteiro}
              disabled={gerandoRoteiro}
              onClick={() => void solicitarGeracaoRoteiro()}
            >
              Sugerir novo Roteiro
            </Botao>
          )}
          {current && aoAvancarNarracao && (
            <Botao
              variante={!modalAberto && roteiro?.narrationAllowed ? 'primario' : 'secundario'}
              disabled={!roteiro?.narrationAllowed}
              onClick={aoAvancarNarracao}
            >
              Avançar para Narração <ChevronRight aria-hidden />
            </Botao>
          )}
        </div>

        {current && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-linha pt-2">
            <span role="status" aria-live="polite" className="num text-pequeno text-t2">
              {current.pending === 0
                ? 'Todos os blocos aprovados — Narração liberada'
                : `Faltam ${current.pending} de ${current.blocks.length} blocos para aprovar`}
            </span>
            <ContadorLimite
              usado={totalCharsAoVivo}
              maximo={limits.scriptChars}
              unidade="caracteres"
            />
          </div>
        )}
      </header>

      {languageRequired && (
        <div ref={selectIdiomaRef} className="rounded-area bg-area p-3">
          <Campo
            rotulo="Idioma do Roteiro"
            ajuda="O idioma deste Corte não ficou claro na Transcrição; escolha em que idioma gerar."
            erro={erroIdioma ?? undefined}
          >
            {(props) => (
              <Select
                {...props}
                valor={idioma}
                opcoes={OPCOES_IDIOMA}
                placeholder="Escolha o idioma"
                aoMudar={(v) => {
                  setIdioma(v)
                  setErroIdioma(null)
                }}
              />
            )}
          </Campo>
        </div>
      )}

      {erroAcao && (
        <BannerErroCore
          erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
          traduzir={(code) => ({
            titulo: mensagemDeErro(new ErroCore(code, erroAcao.detalhe)).titulo,
          })}
          aoDispensar={() => setErroAcao(null)}
          permitirRelato
        />
      )}

      {gerandoRoteiro && (
        <FaixaJob
          rotulo="Gerando Roteiro em blocos…"
          detalhe={jobRoteiroFila?.mensagem}
          aoCancelar={jobIdAtivo != null ? () => void cancelarGeracao() : undefined}
        >
          <Progresso
            valor={jobRoteiroFila?.percentual ?? null}
            rotulo="Progresso da geração do Roteiro"
            compacto
          />
        </FaixaJob>
      )}

      {roteiroParcial && current && (
        <EstadoTela
          tipo="parcial"
          compacto
          titulo="Roteiro parcial:"
          descricao={`${blocosProntos} de ${current.blocks.length} blocos gerados. Regenere os blocos vazios ou refaça com outro Perfil.`}
        />
      )}

      {!current && !gerandoRoteiro && (
        <div className="flex flex-col items-center gap-3">
          <EstadoTela
            tipo="vazio"
            titulo="Roteiro ainda não gerado"
            descricao="Ângulo definido! Gere o Roteiro em blocos para revisar e aprovar cada trecho antes de narrar."
          />
          <Botao
            variante={modalAberto ? 'secundario' : 'primario'}
            onClick={() => void solicitarGeracaoRoteiro()}
          >
            Sugerir Roteiro
          </Botao>
        </div>
      )}

      {current && (
        <ol ref={listaBlocosRef} className="m-0 flex list-none flex-col gap-3 p-0">
          {current.blocks.map((bloco) => {
            const rascunho = obterRascunho(bloco)
            const sujo = !rascunhoIgualBloco(rascunho, bloco)
            const gerandoBloco = blocoEstaGerando(bloco)
            const blocoOcupado =
              gerandoBloco || salvandoBlocoId === bloco.id || aprovandoBlocoId === bloco.id
            const errosCampo = errosBlocos[bloco.id]
            const temTexto = Boolean(bloco.narration?.trim())
            const podeAprovar =
              !sujo && temTexto && !blocoOcupado && (bloco.status !== 'aprovado' || bloco.stale)

            return (
              <li
                key={bloco.id}
                data-bloco-id={bloco.id}
                onFocusCapture={() => setBlocoEmFocoId(bloco.id)}
                onKeyDown={(e) => aoTeclarNoBloco(bloco, e)}
                className={cn(
                  'flex flex-col gap-3 rounded-area bg-area p-3',
                  blocoEmFocoId === bloco.id && 'marcado',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-base font-forte text-t1">
                      Bloco {bloco.position}
                    </span>
                    {gerandoBloco ? (
                      <Status tom="rodando">Gerando texto deste bloco…</Status>
                    ) : bloco.status === 'aprovado' && !bloco.stale ? (
                      <Status tom="sucesso" forte>
                        Aprovado
                      </Status>
                    ) : (
                      <Status tom="pendente">Pendente</Status>
                    )}
                    {bloco.stale && <Status tom="aviso">Desatualizado — ângulo mudou</Status>}
                    {bloco.edited && <Status tom="info">Editado</Status>}
                    {sujo && <Status tom="aviso">Alterações não salvas</Status>}
                  </div>
                  <span className="text-pequeno text-t3">{bloco.intent}</span>
                </div>

                <Campo
                  rotulo="Título do bloco"
                  extra={`${[...rascunho.title].length}/${limits.titleChars}`}
                  erro={errosCampo?.title}
                >
                  {(props) => (
                    <Entrada
                      {...props}
                      value={rascunho.title}
                      disabled={gerandoBloco}
                      onChange={(e) => {
                        const val = e.target.value
                        setRascunhos((prev) => ({
                          ...prev,
                          [bloco.id]: { ...obterRascunho(bloco), title: val },
                        }))
                      }}
                    />
                  )}
                </Campo>

                <Campo
                  rotulo="Texto da Narração"
                  extra={`${[...rascunho.narration].length}/${limits.narrationChars}`}
                  erro={errosCampo?.narration}
                >
                  {(props) => (
                    <AreaTexto
                      {...props}
                      value={rascunho.narration}
                      disabled={gerandoBloco}
                      onChange={(e) => {
                        const val = e.target.value
                        setRascunhos((prev) => ({
                          ...prev,
                          [bloco.id]: { ...obterRascunho(bloco), narration: val },
                        }))
                      }}
                    />
                  )}
                </Campo>

                <ListaChips
                  rotulo="Frases de referência"
                  itens={rascunho.refs.map((id) => `#${id}`)}
                  maxItens={limits.refs}
                  prefixo="#"
                  desabilitado={gerandoBloco}
                  erro={errosCampo?.refs}
                  placeholder="Digite o ID (ex.: 10) e pressione Enter"
                  aoClicarChip={(chip) => {
                    const n = Number(chip.replace(/^#/, ''))
                    if (Number.isInteger(n) && n > 0) aoClicarChipFrase?.(n)
                  }}
                  aoAlterar={(itens) => aoAlterarChipsBloco(bloco, itens)}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-linha pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Botao
                      variante="secundario"
                      tamanho="p"
                      disabled={!sujo || blocoOcupado}
                      carregando={salvandoBlocoId === bloco.id}
                      onClick={() => void salvarEdicaoBloco(bloco)}
                    >
                      Salvar edição
                      {sujo && <Kbd tom="forte">{formatarTecla('Mod+S')}</Kbd>}
                    </Botao>

                    <Botao
                      variante="secundario"
                      tamanho="p"
                      disabled={!podeAprovar}
                      carregando={aprovandoBlocoId === bloco.id}
                      onClick={() => void aprovarBloco(bloco)}
                    >
                      Aprovar bloco
                    </Botao>
                  </div>

                  <Menu
                    gatilho={
                      <Botao
                        variante="fantasma"
                        tamanho="p"
                        icone={<MoreVertical aria-hidden />}
                        disabled={blocoOcupado || gerandoRoteiro}
                      >
                        Regenerar bloco
                      </Botao>
                    }
                  >
                    <MenuItem
                      aoSelecionar={() => void solicitarRegeneracaoBloco(bloco.id)}
                    >
                      Regenerar com Perfil padrão
                    </MenuItem>
                    <MenuSeparador />
                    <MenuItem
                      aoSelecionar={() => setBlocoEscolhendoPerfil(bloco.id)}
                    >
                      Refazer com outro Perfil…
                    </MenuItem>
                  </Menu>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <span className="sr-only" aria-live="polite">
        {anuncio}
      </span>

      <Dialogo
        aberto={blocoEscolhendoPerfil !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setBlocoEscolhendoPerfil(null)
        }}
        titulo="Refazer bloco com outro Perfil"
        descricao="Escolha o Perfil de Provedor para estimar custo e regenerar apenas este bloco."
      >
        {carregandoPerfis ? (
          <Progresso valor={null} rotulo="Carregando Perfis de Provedor…" />
        ) : perfisDisponiveis.length === 0 ? (
          <EstadoTela
            tipo="vazio"
            compacto
            titulo="Nenhum Perfil configurado"
            descricao="Adicione um Perfil em Configurações → Provedores."
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {perfisDisponiveis.map((perfil) => (
              <li key={perfil.id}>
                <Botao
                  variante="secundario"
                  className="w-full justify-between"
                  onClick={() => {
                    if (blocoEscolhendoPerfil != null) {
                      void solicitarRegeneracaoBloco(blocoEscolhendoPerfil, perfil.id)
                    }
                  }}
                >
                  <span className="truncate">
                    {perfil.label}
                    {perfil.model ? ` · ${perfil.model}` : ''}
                  </span>
                  <span className="text-micro text-t3">
                    {perfil.local ? 'Local' : perfil.cli ? 'CLI' : 'Remoto'}
                  </span>
                </Botao>
              </li>
            ))}
          </ul>
        )}
      </Dialogo>

      <ConfirmDialog
        aberto={confirmacao !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !disparandoGeracao) setConfirmacao(null)
        }}
        titulo={
          confirmacao?.tipo === 'regenerar'
            ? 'Confirmar regeneração do bloco'
            : 'Confirmar geração do Roteiro'
        }
        descricao="Confira o Perfil de Provedor, destino de privacidade e custo estimado antes de enviar a Transcrição."
        rotuloConfirmar={
          confirmacao?.tipo === 'regenerar' ? 'Confirmar e regenerar' : 'Confirmar e sugerir'
        }
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={disparandoGeracao}
        confirmarDesabilitado={Boolean(destinoConfirmacao?.bloqueadoSomenteLocal)}
        aoConfirmar={() => {
          if (confirmacao) {
            void executarConfirmacao(confirmacao, true)
          }
        }}
      >
        {confirmacao && destinoConfirmacao && (
          <ResumoCustoPrivacidade
            tarefa={
              confirmacao.tipo === 'regenerar'
                ? 'Regenerar bloco do Roteiro'
                : 'Sugestão de Roteiro em blocos'
            }
            perfil={destinoConfirmacao.perfil}
            localidade={destinoConfirmacao.localidade}
            saiDaMaquina={destinoConfirmacao.saiDaMaquina}
            host={destinoConfirmacao.host}
            estimativa={converterEstimativa(confirmacao.estimativa.estimate)}
            orcamento={
              store.orcamento
                ? {
                    restanteMicroUsd: store.orcamento.remainingMicroUsd ?? null,
                    callsRestantes: store.orcamento.callsRemaining ?? null,
                    pausado: Boolean(store.orcamento.paused),
                  }
                : null
            }
            bloqueadoSomenteLocal={destinoConfirmacao.bloqueadoSomenteLocal}
          />
        )}
      </ConfirmDialog>
    </div>
  )
}
