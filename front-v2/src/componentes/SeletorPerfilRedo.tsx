import {
  BannerErroCore,
  ConfirmDialog,
  Dica,
  Esqueleto,
  ResumoCustoPrivacidade,
  Select,
  type OpcaoSelect,
} from '@ds'
import { Info } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import {
  resolverDestinoSelecao,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
} from '~/stores/selecaoProjeto'

export interface PropsSeletorPerfilRedo {
  aberto: boolean
  run: number
  windows: number[]
  perfilAtual?: string | null
  aoFechar: () => void
  aoConcluir?: (resultado: unknown) => void
}

type RespostaEstimativaRedo = {
  run: number
  windows: number[]
  profile: {
    id: string
    label: string
    kind: string
    model: string | null
  }
  paid: boolean
  leavesMachine: boolean
  estimate:
    | { kind: 'zero' }
    | { kind: 'plan_quota' }
    | { kind: 'unknown' }
    | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; inputTokens?: number; windows?: number }
}

function normalizarErro(err: unknown): ErroCore {
  if (err instanceof ErroCore) return err
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return new ErroCore(String((err as { code: unknown }).code), String((err as { message: unknown }).message))
  }
  return new ErroCore('desconhecido', err instanceof Error ? err.message : String(err))
}

function converterEstimativaParaDs(estimate: RespostaEstimativaRedo['estimate']) {
  if (estimate.kind === 'usd') {
    return {
      kind: 'usd' as const,
      minMicroUsd: estimate.minMicroUsd,
      maxMicroUsd: estimate.maxMicroUsd,
      inputTokens: estimate.inputTokens,
      janelas: estimate.windows,
    }
  }
  return estimate
}

/**
 * Diálogo para refazer Janelas específicas com outro Perfil de Provedor via `selection.estimate`
 * (Modo 3) + `selection.redo`, criando uma nova revisão da execução (nota `#304`).
 */
export function SeletorPerfilRedo({
  aberto,
  run,
  windows,
  perfilAtual = null,
  aoFechar,
  aoConcluir,
}: PropsSeletorPerfilRedo) {
  const [perfis, setPerfis] = useState<PerfilProvedorLista[]>([])
  const [tarefas, setTarefas] = useState<RespostaTarefasAssistente | null>(null)
  const [perfilSelecionado, setPerfilSelecionado] = useState<string | null>(null)
  const [estimativa, setEstimativa] = useState<RespostaEstimativaRedo | null>(null)
  const [carregandoPerfis, setCarregandoPerfis] = useState(false)
  const [carregandoEstimativa, setCarregandoEstimativa] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const houveErroAoConfirmarRef = useRef(false)
  const fechouAoConfirmarRef = useRef(false)

  const perfisElegiveis = useMemo(() => {
    const atualNorm = (perfilAtual ?? '').trim().toLowerCase()
    if (!atualNorm) return perfis
    return perfis.filter(
      (p) => p.id.toLowerCase() !== atualNorm && p.label.toLowerCase() !== atualNorm,
    )
  }, [perfis, perfilAtual])

  useEffect(() => {
    if (!aberto) {
      houveErroAoConfirmarRef.current = false
      fechouAoConfirmarRef.current = false
      return
    }

    let cancelado = false
    setErro(null)
    setEstimativa(null)
    setCarregandoPerfis(true)

    void Promise.all([
      chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list'),
      chamar<RespostaTarefasAssistente>('assistant.tasks').catch(() => null),
    ])
      .then(([listaResp, tarefasResp]) => {
        if (cancelado) return
        const lista = listaResp?.profiles ?? []
        setPerfis(lista)
        setTarefas(tarefasResp ?? null)

        const atualNorm = (perfilAtual ?? '').trim().toLowerCase()
        const elegiveis = atualNorm
          ? lista.filter((p) => p.id.toLowerCase() !== atualNorm && p.label.toLowerCase() !== atualNorm)
          : lista

        setPerfilSelecionado(elegiveis[0]?.id ?? null)
        setCarregandoPerfis(false)
      })
      .catch((err) => {
        if (cancelado) return
        setErro(normalizarErro(err))
        setCarregandoPerfis(false)
      })

    return () => {
      cancelado = true
    }
  }, [aberto, run, perfilAtual])

  useEffect(() => {
    if (!aberto || !perfilSelecionado) {
      setEstimativa(null)
      return
    }

    let cancelado = false
    setErro(null)
    setCarregandoEstimativa(true)

    void chamar<RespostaEstimativaRedo>('selection.estimate', {
      run,
      windows,
      profileId: perfilSelecionado,
    })
      .then((res) => {
        if (cancelado) return
        setEstimativa(res)
        setCarregandoEstimativa(false)
      })
      .catch((err) => {
        if (cancelado) return
        setEstimativa(null)
        setErro(normalizarErro(err))
        setCarregandoEstimativa(false)
      })

    return () => {
      cancelado = true
    }
  }, [aberto, run, windows, perfilSelecionado])

  const opcoesSelect = useMemo<OpcaoSelect<string>[]>(
    () =>
      perfisElegiveis.map((p) => ({
        valor: p.id,
        rotulo: p.label,
        descricao: p.model ? `${p.local ? 'Local' : p.cli ? 'CLI' : 'Remoto'} · ${p.model}` : undefined,
      })),
    [perfisElegiveis],
  )

  const destino = useMemo(() => {
    if (!perfilSelecionado) return null
    return resolverDestinoSelecao(perfilSelecionado, perfis, tarefas)
  }, [perfilSelecionado, perfis, tarefas])

  const confirmarRedo = async () => {
    if (!perfilSelecionado || enviando) return
    setErro(null)
    setEnviando(true)
    houveErroAoConfirmarRef.current = false
    fechouAoConfirmarRef.current = false

    try {
      const resultado = await chamar('selection.redo', {
        run,
        windows,
        profileId: perfilSelecionado,
        confirmed: true,
      })
      setEnviando(false)
      fechouAoConfirmarRef.current = true
      aoConcluir?.(resultado)
      aoFechar()
    } catch (err) {
      houveErroAoConfirmarRef.current = true
      setErro(normalizarErro(err))
      setEnviando(false)
    }
  }

  const semOutroPerfil = !carregandoPerfis && perfisElegiveis.length === 0
  const bloqueado = Boolean(destino?.bloqueadoSomenteLocal) || Boolean(erro)

  return (
    <ConfirmDialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (proximo) return
        if (houveErroAoConfirmarRef.current) {
          houveErroAoConfirmarRef.current = false
          return
        }
        if (fechouAoConfirmarRef.current) {
          fechouAoConfirmarRef.current = false
          return
        }
        if (!enviando) aoFechar()
      }}
      titulo="Refazer com outro Perfil de Provedor"
      descricao={`As ${windows.length === 1 ? 'janela selecionada será refeita' : `${windows.length} Janelas selecionadas serão refeitas`} em uma nova revisão desta execução, preservando suas aprovações e ajustes.`}
      rotuloCancelar="Cancelar"
      rotuloConfirmar="Refazer com este perfil"
      confirmarDesabilitado={
        carregandoPerfis || carregandoEstimativa || !perfilSelecionado || !estimativa || bloqueado
      }
      ocupado={enviando}
      focoInicial="cancelar"
      aoConfirmar={confirmarRedo}
    >
      <div className="flex flex-col gap-3">
        {carregandoPerfis ? (
          <Esqueleto variante="formulario" quantidade={2} rotuloAcessivel="Carregando Perfis de Provedor" />
        ) : semOutroPerfil ? (
          <p className="text-[var(--texto-p)] text-[var(--texto-fraco)]">
            Nenhum outro Perfil de Provedor disponível para comparação. Cadastre um novo Perfil em Configurações.
          </p>
        ) : (
          <Select
            rotulo="Novo Perfil de Provedor"
            valor={perfilSelecionado}
            aoMudar={(novoId) => setPerfilSelecionado(novoId)}
            opcoes={opcoesSelect}
            placeholder="Escolha um Perfil"
            desabilitado={enviando}
          />
        )}

        {carregandoEstimativa && (
          <Esqueleto variante="linha" quantidade={2} rotuloAcessivel="Estimando custo do Redo" />
        )}

        {erro && (
          <BannerErroCore
            erro={{ code: erro.code, message: erro.detalhe || erro.message }}
            traduzir={(code) => {
              const trad = mensagemDeErro(new ErroCore(code, erro.detalhe))
              return {
                titulo: trad.titulo,
                explicacao: erro.detalhe && erro.detalhe !== trad.titulo ? erro.detalhe : undefined,
              }
            }}
          />
        )}

        {estimativa && destino && !carregandoEstimativa && (
          <ResumoCustoPrivacidade
            tarefa={`Refazer ${windows.length} ${windows.length === 1 ? 'Janela' : 'Janelas'} da Seleção`}
            perfil={{
              ...destino.perfil,
              model: estimativa.profile.model ?? destino.perfil.model,
            }}
            localidade={destino.localidade}
            saiDaMaquina={destino.saiDaMaquina}
            host={destino.host}
            estimativa={converterEstimativaParaDs(estimativa.estimate)}
            bloqueadoSomenteLocal={destino.bloqueadoSomenteLocal}
          />
        )}

        <div className="flex items-center gap-2 text-[var(--texto-m)] text-[var(--texto-fraco)]">
          <Dica texto="Na Fila Global, repetir execução por job único sem incremento de revisão aguarda #304. Aqui usa-se selection.redo, que gera nova revisão.">
            <span className="inline-flex items-center gap-1.5">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              <span>Gera uma nova revisão nesta execução (nota #304).</span>
            </span>
          </Dica>
        </div>
      </div>
    </ConfirmDialog>
  )
}
