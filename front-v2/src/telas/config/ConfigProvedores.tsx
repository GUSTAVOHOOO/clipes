import {
  BannerErroCore,
  Botao,
  Campo,
  ConfirmDialog,
  Dica,
  Entrada,
  Esqueleto,
  EstadoTela,
  Select,
  Status,
  Switch,
  TabelaGrade,
  useToast,
  type ColunaGrade,
  type OpcaoSelect,
} from '@ds'
import { Eye, EyeOff, Lock, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtalhos } from '~/comandos/atalhos'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { useFila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'
import {
  FormPerfilProvedor,
  traduzirErroProvedor,
  type PerfilProvedor,
} from '~/telas/config/FormPerfilProvedor'

type TarefaId = 'selection' | 'packaging' | 'script' | 'translation'

type TarefaRota = {
  task: TarefaId
  choice: string
  source: string
  profile: {
    id: string
    label: string
    kind: string
    model: string | null
    local: boolean
    cli: boolean
    cost: { kind: string }
  } | null
  localOnly: boolean
  blocked: boolean
  missing: string | null
  suggestion: { choice: string; label: string; measured: boolean } | null
}

type AssistantStatus = {
  default: string
  tasks: Record<string, string>
  localOnly: Record<string, boolean>
  missing: Record<string, string>
}

type ProviderStatusResp = {
  timeouts?: { remote: number; local: number }
}

type CliStatusResp = {
  selected: string
  codexConfirmed: boolean
  claudeConfirmed: boolean
  opencodeConfirmed: boolean
  opencodeModel: string
  timeoutSeconds: number
}

type ContextoResp = {
  profileId: string
  value: number
  source: string
  explanation?: string
}

type SelectionStateResp = {
  applicable: boolean
  profileId?: string
  kind?: string
  model?: string
  contextTokens?: number
  origin?: string
  state?: 'full' | 'reduced' | 'blocked'
  reference?: { firstWindowMinutes: number | null; maxWindowMinutes: number }
  guides?: string[]
}

const INFO_TAREFAS: Record<TarefaId, { titulo: string; descricao: string }> = {
  selection: { titulo: 'Seleção de Cortes', descricao: 'Escolhe e pontua trechos da Transcrição' },
  packaging: { titulo: 'Empacotamento', descricao: 'Título, descrição, tags e capa' },
  script: { titulo: 'Roteiro', descricao: 'Ângulo e blocos de Narração' },
  translation: { titulo: 'Tradução', descricao: 'Tradução das legendas do Corte' },
}

const ORIGEM_CONTEXTO: Record<string, string> = {
  user: 'Informado por você',
  measured: 'Medido',
  loaded: 'Carregado no servidor',
  server: 'Reportado pelo servidor',
  catalog: 'Catálogo',
  fallback: 'Padrão conservador',
}

const GUIAS_CONTEXTO: Record<string, string> = {
  ollama_profile: 'Ollama: aumente num_ctx no perfil ou servidor e clique em "Medir contexto".',
  ollama_server: 'Ollama: ajuste num_ctx para 16.384+ tokens para Janelas completas.',
  lmstudio: 'LM Studio: aumente o Context Length ao carregar o modelo.',
  llamacpp: 'llama.cpp: inicie o servidor com `-c 16384` ou superior.',
}

const HASH_REABRIR_ASSISTENTE = '#/assistente?passo=1&retorno=config'

const NOMES_CLI: Record<'codex' | 'claude' | 'opencode', string> = {
  codex: 'Codex CLI',
  claude: 'Claude Code CLI',
  opencode: 'OpenCode CLI',
}

function normalizarEscolha(escolha: string, temLegacy: boolean): string {
  if (escolha === 'endpoint' && temLegacy) return 'profile:legacy'
  return escolha
}

function destinoCustoTexto(perfil: TarefaRota['profile'], endpoint?: string | null): string {
  if (!perfil) return 'Não configurado'
  if (perfil.cli) return `CLI (${perfil.kind}) · cota do plano`
  if (perfil.local) return 'Local (loopback) · US$ 0,00'
  let host = ''
  if (endpoint) {
    try {
      host = new URL(endpoint).host
    } catch {
      host = ''
    }
  }
  return host ? `Remoto (${host}) · pago` : 'Remoto · pago'
}

export type ConfigProvedoresProps = {
  projetoAberto: string | null
  aoAtualizar?: () => void
}

/** Tela de Configurações: Provedores, Perfis, CLIs, Groq e Roteamento de Tarefas de IA (#/config/provedores). */
export function ConfigProvedores({ projetoAberto, aoAtualizar }: ConfigProvedoresProps) {
  const toast = useToast()
  const forcado = useEstadoForcado()
  const fila = useFila()

  const [carregando, setCarregando] = useState(true)
  const [erroFatal, setErroFatal] = useState<ErroCore | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)

  const [assistant, setAssistant] = useState<AssistantStatus | null>(null)
  const [tarefas, setTarefas] = useState<TarefaRota[]>([])
  const [perfis, setPerfis] = useState<PerfilProvedor[]>([])
  const [timeoutsGlobais, setTimeoutsGlobais] = useState<{ remote: number; local: number }>({
    remote: 60,
    local: 300,
  })
  const [cliStatus, setCliStatus] = useState<CliStatusResp>({
    selected: '',
    codexConfirmed: false,
    claudeConfirmed: false,
    opencodeConfirmed: false,
    opencodeModel: '',
    timeoutSeconds: 300,
  })
  const [groqConfigurada, setGroqConfigurada] = useState(false)
  const [contextos, setContextos] = useState<Record<string, ContextoResp>>({})
  const [selectionState, setSelectionState] = useState<SelectionStateResp | null>(null)

  // Estados de formulário/ação
  const [formAberto, setFormAberto] = useState(false)
  const [perfilEditando, setPerfilEditando] = useState<PerfilProvedor | null>(null)
  const [perfilRemover, setPerfilRemover] = useState<PerfilProvedor | null>(null)
  const [consentirRemoto, setConsentirRemoto] = useState<PerfilProvedor | null>(null)
  const [confirmarCli, setConfirmarCli] = useState<{
    kind: 'codex' | 'claude' | 'opencode'
    destino?: { tipo: 'default' } | { tipo: 'task'; task: TarefaId } | { tipo: 'test'; label: string }
  } | null>(null)

  const [ocupadoId, setOcupadoId] = useState<string | null>(null)
  const [groqInput, setGroqInput] = useState('')
  const [mostrarGroq, setMostrarGroq] = useState(false)
  const [confirmarRemoverGroq, setConfirmarRemoverGroq] = useState(false)

  const [opencodeModelo, setOpencodeModelo] = useState('')
  const [cliTimeouts, setCliTimeouts] = useState<Record<string, string>>({
    codex: '300',
    claude: '300',
    opencode: '300',
  })

  const refFocoRemover = useRef<HTMLButtonElement | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErroFatal(null)
    try {
      const [st, tk, lp, pst, cst, grq, selSt] = await Promise.all([
        chamar<AssistantStatus>('assistant.status', {}),
        chamar<{ projectLocalOnly: boolean; tasks: TarefaRota[] }>('assistant.tasks', {}),
        chamar<{ profiles: PerfilProvedor[] }>('provider.profiles.list', {}),
        chamar<ProviderStatusResp>('provider.status', {}),
        chamar<CliStatusResp>('provider.cli.status', {}),
        chamar<{ configured: boolean }>('transcription.groq.key.status', {}),
        chamar<SelectionStateResp>('provider.selection_state', { task: 'selection' }).catch(
          () => ({ applicable: false }),
        ),
      ])

      const listaPerfis = lp?.profiles ?? []
      setAssistant(st)
      setTarefas(tk?.tasks ?? [])
      setPerfis(listaPerfis)
      if (pst?.timeouts) setTimeoutsGlobais(pst.timeouts)
      if (cst) {
        setCliStatus(cst)
        setOpencodeModelo(cst.opencodeModel ?? '')
        const tStr = String(cst.timeoutSeconds ?? 300)
        setCliTimeouts({ codex: tStr, claude: tStr, opencode: tStr })
      }
      setGroqConfigurada(Boolean(grq?.configured))
      setSelectionState(selSt)

      const httpPerfis = listaPerfis.filter((p) => !p.cli)
      const entries = await Promise.all(
        httpPerfis.map(async (p) => {
          try {
            const ctx = await chamar<ContextoResp>('provider.context.get', { profileId: p.id })
            return [p.id, ctx] as const
          } catch {
            return null
          }
        }),
      )
      const mapaCtx: Record<string, ContextoResp> = {}
      for (const e of entries) {
        if (e) mapaCtx[e[0]] = e[1]
      }
      setContextos(mapaCtx)
    } catch (err) {
      setErroFatal(paraErroCore(err))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const perfisHttp = useMemo(() => perfis.filter((p) => !p.cli), [perfis])
  const perfisCli = useMemo(() => perfis.filter((p) => p.cli), [perfis])
  const temLegacy = useMemo(() => perfisHttp.some((p) => p.id === 'legacy'), [perfisHttp])

  const abrirNovoPerfil = useCallback(() => {
    setPerfilEditando(null)
    setFormAberto(true)
  }, [])

  const testarGroq = useCallback(async () => {
    setErroAcao(null)
    setOcupadoId('groq-test')
    try {
      await chamar('transcription.groq.key.test', {})
      toast.add({ title: 'Chave Groq validada com sucesso.' })
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setOcupadoId(null)
    }
  }, [toast])

  useAtalhos(
    useMemo(
      () => [
        {
          id: 'config.provedores.novo-perfil',
          titulo: 'Novo Perfil de Provedor',
          grupo: 'Configurações',
          executar: abrirNovoPerfil,
        },
        {
          id: 'config.provedores.testar-groq',
          titulo: 'Testar chave Groq',
          grupo: 'Configurações',
          executar: () => {
            if (groqConfigurada) void testarGroq()
          },
        },
        {
          id: 'config.provedores.assistente',
          titulo: 'Reabrir assistente inicial',
          grupo: 'Configurações',
          executar: () => {
            window.location.hash = HASH_REABRIR_ASSISTENTE
          },
        },
      ],
      [abrirNovoPerfil, groqConfigurada, testarGroq],
    ),
  )

  const opcoesRota = useMemo<OpcaoSelect<string>[]>(() => {
    const base: OpcaoSelect<string>[] = []
    for (const p of perfisHttp) {
      base.push({
        valor: `profile:${p.id}`,
        rotulo: `${p.label}${p.local ? ' (Local)' : ''}`,
      })
    }
    for (const c of perfisCli) {
      base.push({
        valor: c.kind,
        rotulo: `${c.label}${c.kind === 'claude' ? ' [Experimental]' : ''}`,
      })
    }
    return base
  }, [perfisHttp, perfisCli])

  const opcoesPadrao = useMemo<OpcaoSelect<string>[]>(
    () => [{ valor: '', rotulo: 'Nenhum padrão definido' }, ...opcoesRota],
    [opcoesRota],
  )

  const opcoesTarefa = useMemo<OpcaoSelect<string>[]>(
    () => [{ valor: '', rotulo: 'Herdar padrão do app' }, ...opcoesRota],
    [opcoesRota],
  )

  async function executarAcao(id: string, fn: () => Promise<void>) {
    setErroAcao(null)
    setOcupadoId(id)
    try {
      await fn()
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setOcupadoId(null)
    }
  }

  async function escolherPadrao(choice: string) {
    setErroAcao(null)
    try {
      await chamar('assistant.default.set', { choice })
      await carregar()
      aoAtualizar?.()
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'confirmation_required' && ['codex', 'claude', 'opencode'].includes(choice)) {
        setConfirmarCli({ kind: choice as 'codex' | 'claude' | 'opencode', destino: { tipo: 'default' } })
        return
      }
      setErroAcao(e)
    }
  }

  async function escolherTarefa(task: TarefaId, choice: string) {
    setErroAcao(null)
    try {
      await chamar('assistant.task.set', { task, choice })
      await carregar()
      aoAtualizar?.()
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'confirmation_required' && ['codex', 'claude', 'opencode'].includes(choice)) {
        setConfirmarCli({
          kind: choice as 'codex' | 'claude' | 'opencode',
          destino: { tipo: 'task', task },
        })
        return
      }
      setErroAcao(e)
    }
  }

  async function alternarSomenteLocal(task: TarefaId, enabled: boolean) {
    await executarAcao(`local-${task}`, async () => {
      await chamar('assistant.local_only.set', { task, enabled })
      await carregar()
      aoAtualizar?.()
    })
  }

  async function testarPerfil(p: PerfilProvedor) {
    if (!p.local && !p.confirmed) {
      setConsentirRemoto(p)
      return
    }
    await executarAcao(`test-${p.id}`, async () => {
      await chamar('provider.test', { profileId: p.id })
      toast.add({ title: `Conexão aprovada: ${p.label}` })
    })
  }

  async function confirmarETestarRemoto() {
    if (!consentirRemoto || !consentirRemoto.endpoint) return
    const alvo = consentirRemoto
    setConsentirRemoto(null)
    await executarAcao(`test-${alvo.id}`, async () => {
      await chamar('provider.confirm', { profileId: alvo.id, endpoint: alvo.endpoint })
      await chamar('provider.test', { profileId: alvo.id })
      await carregar()
      toast.add({ title: `Consentimento salvo e conexão aprovada: ${alvo.label}` })
    })
  }

  async function atualizarContexto(p: PerfilProvedor) {
    await executarAcao(`ctx-${p.id}`, async () => {
      await chamar('provider.context.get', { profileId: p.id, refresh: true })
      await carregar()
      toast.add({ title: `Contexto atualizado para ${p.label}` })
    })
  }

  async function medirContexto(p: PerfilProvedor) {
    await executarAcao(`probe-${p.id}`, async () => {
      await chamar('provider.test', { profileId: p.id, probeContext: true })
      await carregar()
      toast.add({ title: `Contexto medido para ${p.label}` })
    })
  }

  async function removerPerfilConfirmado() {
    if (!perfilRemover) return
    const alvo = perfilRemover
    await executarAcao(`remove-${alvo.id}`, async () => {
      await chamar('provider.profiles.remove', { profileId: alvo.id })
      setPerfilRemover(null)
      await carregar()
      aoAtualizar?.()
      toast.add({ title: `Perfil "${alvo.label}" removido.` })
    })
  }

  async function salvarCli(kind: 'codex' | 'claude' | 'opencode') {
    const tVal = Number(cliTimeouts[kind] || '300')
    await executarAcao(`cli-save-${kind}`, async () => {
      await chamar('provider.cli.configure', {
        kind,
        timeoutSeconds: tVal,
        ...(kind === 'opencode' ? { model: opencodeModelo.trim() } : {}),
      })
      await carregar()
      toast.add({ title: 'Configuração do CLI salva.' })
    })
  }

  async function confirmarUsoCli() {
    if (!confirmarCli) return
    const alvo = confirmarCli
    setConfirmarCli(null)
    const acaoId =
      alvo.destino?.tipo === 'test' ? `cli-test-${alvo.kind}` : `cli-confirm-${alvo.kind}`
    await executarAcao(acaoId, async () => {
      await chamar('provider.cli.configure', {
        kind: alvo.kind,
        ...(alvo.kind === 'opencode' && opencodeModelo.trim() ? { model: opencodeModelo.trim() } : {}),
      })
      await chamar('provider.cli.confirm', { kind: alvo.kind })
      if (alvo.destino?.tipo === 'default') {
        await chamar('assistant.default.set', { choice: alvo.kind })
      } else if (alvo.destino?.tipo === 'task') {
        await chamar('assistant.task.set', { task: alvo.destino.task, choice: alvo.kind })
      }
      await carregar()
      aoAtualizar?.()
      if (alvo.destino?.tipo === 'test') {
        await chamar('provider.test', {})
        toast.add({ title: `${alvo.destino.label} validado.` })
        return
      }
      toast.add({ title: 'CLI confirmado e pronto para uso.' })
    })
  }

  async function salvarGroq(e: React.FormEvent) {
    e.preventDefault()
    if (!groqInput.trim()) return
    await executarAcao('groq-save', async () => {
      await chamar('transcription.groq.key.set', { key: groqInput.trim() })
      setGroqInput('')
      setMostrarGroq(false)
      await carregar()
      toast.add({ title: 'Chave Groq salva no cofre do sistema.' })
    })
  }

  async function removerGroq() {
    await executarAcao('groq-remove', async () => {
      await chamar('transcription.groq.key.remove', {})
      setConfirmarRemoverGroq(false)
      await carregar()
      toast.add({ title: 'Chave Groq removida do cofre.' })
    })
  }

  const colunasTarefas: ColunaGrade<TarefaRota>[] = [
    {
      id: 'tarefa',
      titulo: 'Tarefa de IA',
      largura: '24%',
      render: (r) => {
        const info = INFO_TAREFAS[r.task]
        return (
          <div className="py-1">
            <div className="font-medio text-t1">{info.titulo}</div>
            <div className="text-micro text-t3">{info.descricao}</div>
          </div>
        )
      },
    },
    {
      id: 'perfil',
      titulo: 'Perfil atribuído',
      largura: '28%',
      render: (r) => (
        <Select
          rotulo={`Perfil para ${INFO_TAREFAS[r.task].titulo}`}
          valor={normalizarEscolha(r.choice, temLegacy)}
          aoMudar={(v) => void escolherTarefa(r.task, v)}
          opcoes={opcoesTarefa}
        />
      ),
    },
    {
      id: 'destino',
      titulo: 'Destino e custo',
      largura: '30%',
      render: (r) => {
        const perfilObj = perfisHttp.find((p) => p.id === r.profile?.id)
        return (
          <div className="flex flex-col gap-1 py-1">
            <Status tom={r.profile?.local ? 'sucesso' : 'neutro'}>
              {destinoCustoTexto(r.profile, perfilObj?.endpoint)}
            </Status>
            {r.missing && <Status tom="aviso">Perfil anterior removido</Status>}
            {r.blocked && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Status tom="aviso" icone={<Lock className="size-[13px] stroke-[1.75]" aria-hidden />}>
                  Bloqueado pelo modo Somente local
                </Status>
                {r.suggestion && (
                  <Botao
                    tamanho="p"
                    variante="suave"
                    onClick={() => void escolherTarefa(r.task, r.suggestion!.choice)}
                  >
                    Usar {r.suggestion.label}
                  </Botao>
                )}
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: 'localOnly',
      titulo: 'Somente local',
      largura: '18%',
      render: (r) => (
        <Switch
          ligado={r.localOnly}
          aoMudar={(enabled) => void alternarSomenteLocal(r.task, enabled)}
        >
          <span className="sr-only">Somente local ({INFO_TAREFAS[r.task].titulo})</span>
          <span className="text-pequeno text-t2">{r.localOnly ? 'Ativo' : 'Desligado'}</span>
        </Switch>
      ),
    },
  ]

  const semNenhumConfigurado =
    !carregando && perfisHttp.length === 0 && !perfisCli.some((c) => c.confirmed)
  const temParcial = tarefas.some((t) => t.missing !== null || t.blocked)
  const testandoEstrutura = fila.some((j) => j.id === 'provider.structured' && j.estado === 'rodando')

  const estadoTela =
    forcado === 'carregando' || carregando
      ? 'carregando'
      : forcado === 'erro' || erroFatal
        ? 'erro'
        : forcado === 'vazio' || semNenhumConfigurado
          ? 'vazio'
          : 'pronto'

  const renderCorpo = () => {
    if (estadoTela === 'carregando') {
      return (
        <div className="flex flex-col gap-4">
          <Esqueleto variante="lista" quantidade={4} rotuloAcessivel="Carregando Provedores" />
          <Esqueleto variante="painel" rotuloAcessivel="Carregando Perfis" />
        </div>
      )
    }

    if (estadoTela === 'erro') {
      const e = erroFatal ?? new ErroCore('desconhecido', 'Erro simulado em ?estado=erro.')
      const trad = traduzirErroProvedor(e)
      return (
        <BannerErroCore
          erro={{ code: e.code, message: e.detalhe || e.message }}
          traduzir={() => ({ titulo: trad.titulo })}
          acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: () => void carregar() }}
          permitirRelato
        />
      )
    }

    if (estadoTela === 'vazio') {
      return (
        <EstadoTela
          tipo="vazio"
          titulo="Nenhum Perfil de Provedor configurado"
          descricao="Adicione um modelo local, uma chave de API ou uma CLI para selecionar Cortes, sugerir títulos e gerar Roteiros."
          acaoPrimaria={{
            rotulo: 'Adicionar Perfil de Provedor',
            aoAcionar: abrirNovoPerfil,
          }}
          acaoSecundaria={{
            rotulo: 'Abrir assistente inicial',
            aoAcionar: () => {
              window.location.hash = HASH_REABRIR_ASSISTENTE
            },
          }}
        />
      )
    }

    return (
      <div className="flex flex-col gap-5">
        {erroAcao && (
          <BannerErroCore
            erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
            traduzir={(code) => traduzirErroProvedor(new ErroCore(code, erroAcao.detalhe))}
            aoDispensar={() => setErroAcao(null)}
            permitirRelato
          />
        )}

        {(forcado === 'parcial' || temParcial) && (
          <EstadoTela
            tipo="parcial"
            compacto
            titulo="Atenção no roteamento"
            descricao="Uma ou mais Tarefas de IA estão bloqueadas por Somente local ou apontam para um Perfil removido."
          />
        )}

        {/* Bloco 1: Roteamento por Tarefa de IA */}
        <section
          aria-label="Roteamento por Tarefa de IA"
          className="flex flex-col gap-3 rounded-area bg-area p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-medio text-t1">1. Roteamento por Tarefa de IA</h2>
            <div className="flex items-center gap-2">
              <span className="text-pequeno text-t2">Provedor padrão do app:</span>
              <Select
                rotulo="Provedor padrão do app"
                valor={normalizarEscolha(assistant?.default ?? '', temLegacy)}
                aoMudar={(v) => void escolherPadrao(v)}
                opcoes={opcoesPadrao}
              />
            </div>
          </div>

          <TabelaGrade
            linhas={tarefas}
            colunas={colunasTarefas}
            obterId={(l) => l.task}
            rotulo="Roteamento de Tarefas de IA"
          />

          {selectionState?.applicable && (
            <div
              aria-label="Compatibilidade da Janela de contexto"
              className="flex flex-col gap-1 rounded-controle bg-elevado px-3 py-2 text-pequeno"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Status tom={selectionState.state === 'full' ? 'sucesso' : 'aviso'}>
                  {selectionState.state === 'full'
                    ? `Janelas completas até ${selectionState.reference?.maxWindowMinutes ?? 15} min`
                    : selectionState.state === 'reduced'
                      ? `Janelas reduzidas (${selectionState.reference?.firstWindowMinutes ?? 12} min)`
                      : 'Contexto insuficiente para Seleção de Cortes'}
                </Status>
                {selectionState.contextTokens != null && (
                  <span className="num text-t3">
                    Contexto efetivo: {selectionState.contextTokens.toLocaleString('pt-BR')} tokens
                  </span>
                )}
              </div>
              {selectionState.state !== 'full' && selectionState.guides && selectionState.guides.length > 0 && (
                <ul className="m-0 list-disc pl-5 text-micro text-t2">
                  {selectionState.guides.map((g) => (
                    <li key={g}>{GUIAS_CONTEXTO[g] ?? g}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Bloco 2: Perfis de Provedor + CLIs + Timeouts globais */}
        <section
          aria-label="Perfis de Provedor configurados"
          className="flex flex-col gap-3 rounded-area bg-area p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medio text-t1">2. Perfis de Provedor configurados</h2>
            <Botao variante="primario" icone={<Plus />} onClick={abrirNovoPerfil}>
              Novo Perfil
            </Botao>
          </div>

          <div className="flex flex-col gap-2">
            {perfisHttp.map((p) => {
              const ctx = contextos[p.id]
              const ehLegacy = p.id === 'legacy'
              const testando = ocupadoId === `test-${p.id}` || testandoEstrutura

              return (
                <section
                  key={p.id}
                  aria-label={`Perfil ${p.label}`}
                  className="flex flex-col gap-2 rounded-controle bg-elevado px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medio text-t1">{p.label}</span>
                      <Status tom={p.local ? 'sucesso' : p.confirmed ? 'info' : 'aviso'}>
                        {p.local
                          ? 'Local · US$ 0,00'
                          : p.confirmed
                            ? 'Remoto · Confirmado'
                            : 'Remoto · Aguarda consentimento'}
                      </Status>
                      <span className="font-mono text-pequeno text-t3">
                        {p.kind} · {p.model}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Botao
                        tamanho="p"
                        variante="secundario"
                        carregando={testando}
                        onClick={() => void testarPerfil(p)}
                      >
                        Testar
                      </Botao>
                      <Botao
                        tamanho="p"
                        variante="fantasma"
                        carregando={ocupadoId === `ctx-${p.id}`}
                        onClick={() => void atualizarContexto(p)}
                      >
                        Atualizar contexto
                      </Botao>
                      {p.local && (
                        <Botao
                          tamanho="p"
                          variante="fantasma"
                          carregando={ocupadoId === `probe-${p.id}`}
                          onClick={() => void medirContexto(p)}
                        >
                          Medir contexto
                        </Botao>
                      )}
                      <Botao
                        tamanho="p"
                        variante="fantasma"
                        onClick={() => {
                          setPerfilEditando(p)
                          setFormAberto(true)
                        }}
                      >
                        Editar
                      </Botao>
                      {ehLegacy ? (
                        // Pendência no núcleo (#305)
                        <Dica texto="Remoção do perfil legado disponível em breve.">
                          <span tabIndex={0} className="inline-flex">
                            <Botao
                              tamanho="p"
                              variante="perigo"
                              disabled
                              title="Remoção do perfil legado disponível em breve."
                            >
                              Remover
                            </Botao>
                          </span>
                        </Dica>
                      ) : (
                        <Botao
                          tamanho="p"
                          variante="perigo"
                          onClick={(e) => {
                            refFocoRemover.current = e.currentTarget
                            setPerfilRemover(p)
                          }}
                        >
                          Remover
                        </Botao>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-pequeno text-t3">
                    <span className="font-mono">{p.endpoint}</span>
                    <span>
                      Chave:{' '}
                      <strong className="font-mono font-normal text-t2">
                        {p.keyLastFour ? `••••${p.keyLastFour}` : 'Sem chave'}
                      </strong>
                    </span>
                    {ctx && (
                      <span className="num">
                        Contexto: {ctx.value.toLocaleString('pt-BR')} tokens (
                        {ORIGEM_CONTEXTO[ctx.source] ?? ctx.source})
                      </span>
                    )}
                    {ehLegacy && (
                      // Pendência no núcleo (#305)
                      <span className="text-micro text-t3">
                        Remoção do perfil legado disponível em breve.
                      </span>
                    )}
                  </div>
                </section>
              )
            })}
          </div>

          {/* CLIs */}
          <div className="mt-1 flex flex-col gap-2">
            <h3 className="text-pequeno font-medio text-t2">Assinaturas via CLI</h3>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              {perfisCli.map((c) => {
                const kind = c.kind as 'codex' | 'claude' | 'opencode'
                const confirmado =
                  kind === 'codex'
                    ? cliStatus.codexConfirmed || c.confirmed
                    : kind === 'claude'
                      ? cliStatus.claudeConfirmed || c.confirmed
                      : cliStatus.opencodeConfirmed || c.confirmed

                return (
                  <section
                    key={c.id}
                    aria-label={c.label}
                    className="flex flex-col gap-2 rounded-controle bg-elevado p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medio text-t1">{c.label}</span>
                      {kind === 'claude' ? (
                        <Status tom="aviso">Experimental</Status>
                      ) : (
                        <Status tom={confirmado ? 'sucesso' : 'neutro'}>
                          {confirmado ? 'Confirmado' : 'Aguarda confirmação'}
                        </Status>
                      )}
                    </div>

                    {kind === 'claude' && (
                      <p className="text-micro text-t3">
                        Experimental: aguarda confirmação formal da Anthropic.
                      </p>
                    )}

                    {kind === 'opencode' && (
                      <Campo rotulo="Modelo (provedor/modelo)">
                        {(props) => (
                          <Entrada
                            {...props}
                            tamanho="p"
                            className="font-mono"
                            value={opencodeModelo}
                            onChange={(e) => setOpencodeModelo(e.target.value)}
                            placeholder="opencode/big-pickle"
                          />
                        )}
                      </Campo>
                    )}

                    <Campo rotulo="Timeout (s)">
                      {(props) => (
                        <Entrada
                          {...props}
                          tamanho="p"
                          type="number"
                          min={1}
                          max={3600}
                          className="num"
                          value={cliTimeouts[kind] ?? '300'}
                          onChange={(e) =>
                            setCliTimeouts((prev) => ({ ...prev, [kind]: e.target.value }))
                          }
                        />
                      )}
                    </Campo>

                    <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                      <Botao
                        tamanho="p"
                        variante="secundario"
                        carregando={ocupadoId === `cli-save-${kind}`}
                        onClick={() => void salvarCli(kind)}
                      >
                        Salvar CLI
                      </Botao>
                      {!confirmado && (
                        <Botao
                          tamanho="p"
                          variante="fantasma"
                          onClick={() => setConfirmarCli({ kind })}
                        >
                          Confirmar
                        </Botao>
                      )}
                      <Botao
                        tamanho="p"
                        variante="fantasma"
                        carregando={ocupadoId === `cli-test-${kind}`}
                        onClick={() => {
                          if (!confirmado) {
                            setConfirmarCli({ kind, destino: { tipo: 'test', label: c.label } })
                            return
                          }
                          void executarAcao(`cli-test-${kind}`, async () => {
                            await chamar('provider.test', {})
                            toast.add({ title: `${c.label} validado.` })
                          })
                        }}
                      >
                        Testar
                      </Botao>
                    </div>
                  </section>
                )
              })}
            </div>
          </div>

          {/* Timeouts globais (#305) */}
          <section
            aria-label="Timeouts globais de provider.json"
            className="flex flex-col gap-2 rounded-controle bg-elevado p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-pequeno font-medio text-t1">Timeouts globais</span>
              <span className="text-micro text-t3">
                Edição global disponível em breve; ajuste por perfil.
              </span>
            </div>
            <div className="grid max-w-md grid-cols-2 gap-3">
              <Dica texto="Edição de timeouts globais disponível em breve; ajuste por perfil.">
                <div>
                  <Campo rotulo="Timeout global remoto (s)">
                    {(props) => (
                      <Entrada
                        {...props}
                        tamanho="p"
                        className="num"
                        value={String(timeoutsGlobais.remote)}
                        disabled
                        readOnly
                      />
                    )}
                  </Campo>
                </div>
              </Dica>
              <Dica texto="Edição de timeouts globais disponível em breve; ajuste por perfil.">
                <div>
                  <Campo rotulo="Timeout global local (s)">
                    {(props) => (
                      <Entrada
                        {...props}
                        tamanho="p"
                        className="num"
                        value={String(timeoutsGlobais.local)}
                        disabled
                        readOnly
                      />
                    )}
                  </Campo>
                </div>
              </Dica>
            </div>
          </section>
        </section>

        {/* Bloco 3: Transcrição remota (Groq) */}
        <section
          aria-label="Transcrição remota (Groq)"
          className="flex max-w-[68ch] flex-col gap-3 rounded-area bg-area p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medio text-t1">3. Transcrição remota (Groq)</h2>
            <Status tom={groqConfigurada ? 'sucesso' : 'neutro'}>
              {groqConfigurada ? 'Chave no cofre: configurada' : 'Chave não configurada'}
            </Status>
          </div>
          <p className="text-pequeno text-t2">
            Usada apenas quando você escolher explicitamente o Motor Groq na Transcrição de uma Fonte.
          </p>
          <form onSubmit={(e) => void salvarGroq(e)} className="flex flex-col gap-2">
            <Campo rotulo="Nova chave da API Groq">
              {(props) => (
                <div className="flex flex-wrap items-center gap-2">
                  <Entrada
                    {...props}
                    type={mostrarGroq ? 'text' : 'password'}
                    autoComplete="off"
                    className="min-w-56 flex-1"
                    value={groqInput}
                    onChange={(e) => setGroqInput(e.target.value)}
                    placeholder={
                      groqConfigurada
                        ? 'Informe nova chave para substituir…'
                        : 'Cole sua chave Groq (gsk_...)'
                    }
                  />
                  <Botao
                    variante="secundario"
                    aria-label="Mostrar/ocultar chave Groq durante digitação"
                    onClick={() => setMostrarGroq((v) => !v)}
                    icone={mostrarGroq ? <EyeOff /> : <Eye />}
                  >
                    {mostrarGroq ? 'Ocultar' : 'Mostrar'}
                  </Botao>
                  <Botao
                    type="submit"
                    variante="secundario"
                    disabled={!groqInput.trim()}
                    carregando={ocupadoId === 'groq-save'}
                  >
                    Salvar chave
                  </Botao>
                  <Botao
                    variante="fantasma"
                    disabled={!groqConfigurada}
                    carregando={ocupadoId === 'groq-test'}
                    onClick={() => void testarGroq()}
                  >
                    Testar chave Groq
                  </Botao>
                  <Botao
                    variante="perigo"
                    disabled={!groqConfigurada}
                    onClick={() => setConfirmarRemoverGroq(true)}
                  >
                    Remover chave Groq
                  </Botao>
                </div>
              )}
            </Campo>
          </form>
        </section>
      </div>
    )
  }

  return (
    <ConfiguracoesLayout
      secao="provedores"
      projetoAberto={projetoAberto}
      titulo="Provedores e Tarefas de IA"
      subtitulo="Configure Perfis de Provedor (API, modelo local em loopback ou CLI) e defina qual perfil executa cada Tarefa de IA."
      acoesCabecalho={
        <Botao
          variante="secundario"
          onClick={() => {
            window.location.hash = HASH_REABRIR_ASSISTENTE
          }}
        >
          Reabrir assistente inicial
        </Botao>
      }
    >
      {renderCorpo()}

      <FormPerfilProvedor
        aberto={formAberto}
        aoMudarAberto={setFormAberto}
        perfilInicial={perfilEditando}
        idsExistentes={perfisHttp.map((p) => p.id)}
        aoSalvar={async () => {
          await carregar()
          aoAtualizar?.()
        }}
      />

      <ConfirmDialog
        aberto={perfilRemover !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setPerfilRemover(null)
        }}
        titulo={`Remover perfil "${perfilRemover?.label ?? ''}"?`}
        descricao="A chave própria salva no cofre do sistema operacional será apagada e as Tarefas de IA ligadas a ele precisarão de outro Perfil de Provedor."
        rotuloConfirmar="Remover perfil"
        variante="perigo"
        focoInicial="cancelar"
        focoFinal={refFocoRemover}
        ocupado={ocupadoId?.startsWith('remove-')}
        aoConfirmar={removerPerfilConfirmado}
      />

      <ConfirmDialog
        aberto={confirmarRemoverGroq}
        aoMudarAberto={setConfirmarRemoverGroq}
        titulo="Remover chave Groq?"
        descricao="Remover chave salva do cofre do sistema? A Transcrição remota via Groq deixará de funcionar até você informar outra chave."
        rotuloConfirmar="Remover chave"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={ocupadoId === 'groq-remove'}
        aoConfirmar={removerGroq}
      />

      <ConfirmDialog
        aberto={consentirRemoto !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setConsentirRemoto(null)
        }}
        titulo="Confirmar envio de texto ao Provedor?"
        descricao={`Ao testar ou usar "${consentirRemoto?.label ?? ''}", apenas trechos de texto de transcrições são enviados para ${consentirRemoto?.endpoint ?? ''}. Vídeo e áudio nunca são enviados.`}
        rotuloConfirmar="Concordo e testar"
        focoInicial="cancelar"
        aoConfirmar={confirmarETestarRemoto}
      />

      <ConfirmDialog
        aberto={confirmarCli !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setConfirmarCli(null)
        }}
        titulo="Confirmar envio de texto via CLI?"
        descricao={
          confirmarCli?.kind === 'claude'
            ? 'Claude Code CLI é experimental e aguarda confirmação formal da Anthropic. Apenas texto de transcrições sai do computador (vídeo e áudio nunca são enviados) para o Claude Code CLI. Custo: consome cota do seu plano.'
            : confirmarCli
              ? `Ao usar ou testar o ${NOMES_CLI[confirmarCli.kind]}, apenas texto de transcrições sai do computador (vídeo e áudio nunca são enviados) para o serviço da CLI. Custo: consome cota do seu plano.`
              : ''
        }
        rotuloConfirmar={
          confirmarCli?.destino?.tipo === 'test' ? 'Concordo e testar' : 'Ativar e permitir envio'
        }
        focoInicial="cancelar"
        aoConfirmar={confirmarUsoCli}
      />
    </ConfiguracoesLayout>
  )
}
