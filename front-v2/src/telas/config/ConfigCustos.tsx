import {
  Abas,
  AreaTexto,
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  Dialogo,
  Entrada,
  Esqueleto,
  EstadoTela,
  Progresso,
  ResumoCustoPrivacidade,
  Select,
  Status,
  TabelaGrade,
  usd,
  useToast,
  type Aba,
  type ColunaGrade,
  type OpcaoSelect,
} from '@ds'
import { Copy, Lock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'

type AbaCustos = 'orcamentos' | 'auditoria' | 'precos'

type BudgetRow = {
  scope: 'task' | 'batch'
  key: string
  maxCalls: number | null
  maxTokens: number | null
  maxWallMs: number | null
  maxCostMicroUsd: number | null
  unknownConfirmed: boolean
  since: number
  usage: {
    calls: number
    inputTokens: number
    outputTokens: number
    microUsd: number
    audioMicroUsd?: number
    unknownCostCalls: number
    planQuotaCalls: number
    durationMs: number
    costLabel?: string | null
  }
  paused: string | null
}

type CostRow = {
  id: number
  jobId: number | null
  task: string
  taskVersion: number | null
  attempt: number | null
  outcome: string | null
  code: string | null
  batch: string | null
  profile: string | null
  provider: string
  model: string
  inputTokens: number | null
  outputTokens: number | null
  calls: number
  costKind: 'usd' | 'zero' | 'plan_quota' | 'unknown'
  microUsd: number | null
  estimateMicroUsd: number | null
  durationMs: number | null
  priceSource: string | null
  tableUpdatedAt: string
  createdAt: number
}

type AuditRow = {
  id: number
  providerKind: string
  host: string | null
  model: string | null
  promptSha256: string | null
  inputSha256: string | null
  sentBytes: number | null
  responseSha256: string | null
  task: string | null
  taskVersion: number | null
  outcome: string | null
  costId: number | null
  transcriptionCallId: number | null
  job: number | null
}

type PriceRow = {
  provider: string
  model: string
  inputPerMillion: number
  outputPerMillion: number
}

type PricesResp = {
  updatedAt: string
  prices: PriceRow[]
  overrides: PriceRow[]
}

type EstimateResp = {
  kind: 'usd' | 'zero' | 'plan_quota' | 'unknown'
  inputTokens: number
  inputTokensRange: { min: number; max: number }
  maxOutputTokens: number | null
  minMicroUsd: number | null
  maxMicroUsd: number | null
  priceSource: 'table' | 'override' | null
  profileId?: string
}

type ProfileOption = {
  id: string
  label: string
  kind: string
  endpoint: string | null
  model: string | null
  local: boolean
  cli: boolean
}

const NOME_TAREFA: Record<string, string> = {
  selection: 'Seleção de Cortes',
  score: 'Seleção de Cortes',
  selection_transformed: 'Seleção (Transformado)',
  packaging: 'Empacotamento',
  thumbnail: 'Capa',
  script: 'Roteiro',
  script_block: 'Roteiro (bloco)',
  angles: 'Ângulos',
  translation: 'Tradução',
}

const MOTIVO_PAUSA: Record<string, string> = {
  budget_cost: 'Teto de custo atingido',
  budget_calls: 'Limite de chamadas atingido',
  budget_tokens: 'Limite de tokens atingido',
  budget_time: 'Limite de tempo atingido',
  time_budget_exhausted: 'Limite de tempo atingido',
  cost_unknown: 'Custo desconhecido',
}

const MENSAGENS_CUSTOS: Record<string, string> = {
  invalid_budget: 'Informe limites numéricos positivos para o orçamento.',
  invalid_price:
    'Verifique os valores por milhão de tokens e garanta que as faixas de preço estejam em ordem crescente.',
  local_only_violation: 'Estimativa bloqueada pelo modo Somente local para este perfil remoto.',
}

function traduzirErroCustos(erro: ErroCore) {
  const esp = MENSAGENS_CUSTOS[erro.code]
  const global = mensagemDeErro(erro)
  return esp ? { titulo: esp, recuperacao: global.recuperacao } : global
}

function truncarHash(hash: string | null): string {
  if (!hash) return '—'
  return hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash
}

function rotuloEscopo(b: BudgetRow): string {
  if (b.scope === 'task') {
    return `Tarefa: ${NOME_TAREFA[b.key] ?? b.key}`
  }
  return `Lote: ${b.key}`
}

function ehFalhaCobrada(r: CostRow): boolean {
  return r.outcome != null && r.outcome !== 'ok' && (r.microUsd ?? 0) > 0
}

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false
  return (
    host.startsWith('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('[::1]') ||
    host === '::1'
  )
}

const ROTULOS_ABA: Record<AbaCustos, string> = {
  orcamentos: 'Orçamentos e Gastos',
  auditoria: 'Auditoria',
  precos: 'Tabela de Preços e Estimador',
}

const ABAS_CUSTOS: Aba<AbaCustos>[] = [
  { valor: 'orcamentos', rotulo: ROTULOS_ABA.orcamentos },
  { valor: 'auditoria', rotulo: ROTULOS_ABA.auditoria },
  { valor: 'precos', rotulo: ROTULOS_ABA.precos },
]

const OPCOES_TAREFA_FILTRO: OpcaoSelect<string>[] = [
  { valor: '', rotulo: 'Todas as tarefas' },
  { valor: 'selection', rotulo: 'Seleção de Cortes' },
  { valor: 'packaging', rotulo: 'Empacotamento' },
  { valor: 'script', rotulo: 'Roteiro' },
  { valor: 'translation', rotulo: 'Tradução' },
]

const OPCOES_TAREFA_ORCAMENTO: OpcaoSelect<string>[] = [
  { valor: 'selection', rotulo: 'Seleção de Cortes' },
  { valor: 'packaging', rotulo: 'Empacotamento' },
  { valor: 'script', rotulo: 'Roteiro' },
  { valor: 'translation', rotulo: 'Tradução' },
]

const OPCOES_PROVEDOR_PRECO: OpcaoSelect<string>[] = [
  { valor: 'openai', rotulo: 'OpenAI / Compatível' },
  { valor: 'anthropic', rotulo: 'Anthropic' },
  { valor: 'gemini', rotulo: 'Gemini' },
  { valor: 'groq', rotulo: 'Groq' },
]

export type ConfigCustosProps = {
  projetoAberto: string | null
}

/** Tela de Configurações: Custos, Orçamentos e Auditoria (#/config/custos). */
export function ConfigCustos({ projetoAberto }: ConfigCustosProps) {
  const toast = useToast()
  const forcado = useEstadoForcado()
  const fila = useFila()

  const [aba, setAba] = useState<AbaCustos>('orcamentos')

  // Dados globais (Preços e Perfis)
  const [carregandoGlobal, setCarregandoGlobal] = useState(true)
  const [erroGlobal, setErroGlobal] = useState<ErroCore | null>(null)
  const [precos, setPrecos] = useState<PricesResp | null>(null)
  const [perfis, setPerfis] = useState<ProfileOption[]>([])

  // Dados do Projeto (Orçamentos, Gastos, Auditoria)
  const [carregandoProjeto, setCarregandoProjeto] = useState(false)
  const [erroCustos, setErroCustos] = useState<ErroCore | null>(null)
  const [erroAuditoria, setErroAuditoria] = useState<ErroCore | null>(null)
  const [budgets, setBudgets] = useState<BudgetRow[]>([])
  const [costs, setCosts] = useState<CostRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])

  // Filtros
  const [filtroTarefaGastos, setFiltroTarefaGastos] = useState('')
  const [somenteFalhasCobradas, setSomenteFalhasCobradas] = useState(false)
  const [filtroJobAuditoria, setFiltroJobAuditoria] = useState('')
  const [filtroTarefaAuditoria, setFiltroTarefaAuditoria] = useState('')
  const [anuncioCopia, setAnuncioCopia] = useState('')

  // Diálogo de orçamento
  const [dialogoOrcamento, setDialogoOrcamento] = useState<{
    modo: 'criar' | 'editar' | 'retomar'
    scope: 'task' | 'batch'
    key: string
    paused: string | null
  } | null>(null)
  const [orcKey, setOrcKey] = useState('selection')
  const [orcCustoUsd, setOrcCustoUsd] = useState('')
  const [orcChamadas, setOrcChamadas] = useState('')
  const [orcTokens, setOrcTokens] = useState('')
  const [orcTempoS, setOrcTempoS] = useState('')
  const [orcResetUsage, setOrcResetUsage] = useState(false)
  const [orcConfirmed, setOrcConfirmed] = useState(false)
  const [salvandoOrcamento, setSalvandoOrcamento] = useState(false)
  const [erroDialogoOrcamento, setErroDialogoOrcamento] = useState<ErroCore | null>(null)

  // Estimador e sobrescrita de preços
  const [estPerfil, setEstPerfil] = useState('')
  const [estTexto, setEstTexto] = useState('Transcrição de exemplo com 60 minutos de fala densa.')
  const [estMaxOut, setEstMaxOut] = useState('2048')
  const [estimando, setEstimando] = useState(false)
  const [estimativa, setEstimativa] = useState<EstimateResp | null>(null)
  const [erroPrecos, setErroPrecos] = useState<ErroCore | null>(null)

  const [ovProvider, setOvProvider] = useState('openai')
  const [ovModel, setOvModel] = useState('')
  const [ovIn, setOvIn] = useState('')
  const [ovOut, setOvOut] = useState('')
  const [salvandoPreco, setSalvandoPreco] = useState(false)

  const carregarGlobal = useCallback(async () => {
    setCarregandoGlobal(true)
    setErroGlobal(null)
    try {
      const [pr, pf] = await Promise.all([
        chamar<PricesResp>('provider.prices.get', {}),
        chamar<{ profiles: ProfileOption[] }>('provider.profiles.list', {}).catch(() => ({
          profiles: [],
        })),
      ])
      setPrecos(pr)
      const lista = pf?.profiles ?? []
      setPerfis(lista)
      if (!estPerfil && lista.length > 0) {
        setEstPerfil(lista[0].id)
      }
    } catch (err) {
      setErroGlobal(err instanceof ErroCore ? err : new ErroCore('desconhecido', String(err)))
    } finally {
      setCarregandoGlobal(false)
    }
  }, [estPerfil])

  const carregarProjeto = useCallback(async () => {
    if (!projetoAberto) {
      setBudgets([])
      setCosts([])
      setAudit([])
      setErroCustos(null)
      setErroAuditoria(null)
      return
    }
    setCarregandoProjeto(true)
    setErroCustos(null)
    setErroAuditoria(null)

    const [resB, resC, resA] = await Promise.allSettled([
      chamar<{ budgets: BudgetRow[] }>('jobs.budget.get', {}),
      chamar<CostRow[]>('provider.cost.list', {}),
      chamar<AuditRow[]>('provider.audit.list', {}),
    ])

    if (resB.status === 'fulfilled') {
      setBudgets(resB.value?.budgets ?? [])
    } else {
      const r = resB.reason
      setErroCustos(r instanceof ErroCore ? r : new ErroCore('desconhecido', String(r)))
    }

    if (resC.status === 'fulfilled') {
      setCosts(Array.isArray(resC.value) ? resC.value : [])
    } else {
      const r = resC.reason
      setErroCustos(r instanceof ErroCore ? r : new ErroCore('desconhecido', String(r)))
    }

    if (resA.status === 'fulfilled') {
      setAudit(Array.isArray(resA.value) ? resA.value : [])
    } else {
      const r = resA.reason
      setErroAuditoria(r instanceof ErroCore ? r : new ErroCore('desconhecido', String(r)))
    }

    setCarregandoProjeto(false)
  }, [projetoAberto])

  useEffect(() => {
    void carregarGlobal()
  }, [carregarGlobal])

  useEffect(() => {
    void carregarProjeto()
  }, [carregarProjeto])

  // Recarrega automaticamente quando job ai:* entra em estado terminal na Fila
  const assinaturaTerminais = fila
    .filter(
      (j) =>
        j.etapa.startsWith('ai:') &&
        (j.estado === 'concluido' || j.estado === 'falhou' || j.estado === 'pausado'),
    )
    .map((j) => `${j.id}:${j.estado}`)
    .join('|')

  useEffect(() => {
    if (assinaturaTerminais && projetoAberto) {
      void carregarProjeto()
    }
  }, [assinaturaTerminais, projetoAberto, carregarProjeto])

  function abrirDialogoOrcamento(
    modo: 'criar' | 'editar' | 'retomar',
    row?: BudgetRow,
  ) {
    setErroDialogoOrcamento(null)
    setOrcResetUsage(false)
    setOrcConfirmed(false)
    if (row) {
      setOrcKey(row.key)
      setOrcCustoUsd(
        row.maxCostMicroUsd != null ? (row.maxCostMicroUsd / 1_000_000).toString() : '',
      )
      setOrcChamadas(row.maxCalls != null ? String(row.maxCalls) : '')
      setOrcTokens(row.maxTokens != null ? String(row.maxTokens) : '')
      setOrcTempoS(row.maxWallMs != null ? String(Math.round(row.maxWallMs / 1000)) : '')
      setDialogoOrcamento({ modo, scope: row.scope, key: row.key, paused: row.paused })
    } else {
      setOrcKey('selection')
      setOrcCustoUsd('1')
      setOrcChamadas('')
      setOrcTokens('')
      setOrcTempoS('')
      setDialogoOrcamento({ modo: 'criar', scope: 'task', key: 'selection', paused: null })
    }
  }

  async function salvarOrcamento(e: React.FormEvent) {
    e.preventDefault()
    if (!dialogoOrcamento) return
    setErroDialogoOrcamento(null)

    const parseNum = (txt: string): number | null => {
      const limpo = txt.trim().replace(',', '.')
      if (!limpo) return null
      const n = Number(limpo)
      if (!Number.isFinite(n) || n <= 0) return Number.NaN
      return n
    }

    const custo = parseNum(orcCustoUsd)
    const calls = parseNum(orcChamadas)
    const tokens = parseNum(orcTokens)
    const tempo = parseNum(orcTempoS)

    if ([custo, calls, tokens, tempo].some((v) => v !== null && Number.isNaN(v))) {
      setErroDialogoOrcamento(
        new ErroCore('invalid_budget', 'Informe limites numéricos positivos para o orçamento.'),
      )
      return
    }

    const payload: Record<string, unknown> = {
      scope: dialogoOrcamento.scope,
      key: dialogoOrcamento.modo === 'criar' ? orcKey : dialogoOrcamento.key,
      maxCostMicroUsd: custo !== null ? Math.round(custo * 1_000_000) : null,
      maxCalls: calls !== null ? Math.trunc(calls) : null,
      maxTokens: tokens !== null ? Math.trunc(tokens) : null,
      maxWallMs: tempo !== null ? Math.trunc(tempo * 1000) : null,
      resetUsage: orcResetUsage,
    }

    if (dialogoOrcamento.modo === 'retomar') {
      if (dialogoOrcamento.paused === 'cost_unknown') {
        payload.confirmed = orcConfirmed
      }
    }

    setSalvandoOrcamento(true)
    try {
      const cmd =
        dialogoOrcamento.modo === 'retomar' ? 'jobs.budget.continue' : 'jobs.budget.set'
      await chamar(cmd, payload)
      setDialogoOrcamento(null)
      await carregarProjeto()
      toast.add({
        title:
          dialogoOrcamento.modo === 'retomar'
            ? 'Orçamento atualizado e fila retomada.'
            : 'Orçamento salvo.',
      })
    } catch (err) {
      setErroDialogoOrcamento(
        err instanceof ErroCore ? err : new ErroCore('desconhecido', String(err)),
      )
    } finally {
      setSalvandoOrcamento(false)
    }
  }

  async function simularCusto(e: React.FormEvent) {
    e.preventDefault()
    setErroPrecos(null)
    setEstimando(true)
    try {
      const outN = estMaxOut.trim() ? Number(estMaxOut) : undefined
      const resp = await chamar<EstimateResp>('provider.cost.estimate', {
        instruction: '',
        transcript: estTexto,
        schema: {},
        nativeSchema: false,
        ...(estPerfil ? { profileId: estPerfil } : {}),
        ...(outN && Number.isFinite(outN) && outN > 0 ? { maxOutputTokens: Math.trunc(outN) } : {}),
      })
      setEstimativa(resp)
    } catch (err) {
      setErroPrecos(err instanceof ErroCore ? err : new ErroCore('desconhecido', String(err)))
    } finally {
      setEstimando(false)
    }
  }

  async function salvarPreco(e: React.FormEvent) {
    e.preventDefault()
    setErroPrecos(null)
    const inVal = Number(ovIn.replace(',', '.'))
    const outVal = Number(ovOut.replace(',', '.'))
    if (!ovModel.trim() || !Number.isFinite(inVal) || inVal < 0 || !Number.isFinite(outVal) || outVal < 0) {
      setErroPrecos(new ErroCore('invalid_price', 'Preencha modelo e valores não negativos.'))
      return
    }
    setSalvandoPreco(true)
    try {
      const resp = await chamar<PricesResp>('provider.prices.set', {
        provider: ovProvider,
        model: ovModel.trim(),
        inputPerMillion: inVal,
        outputPerMillion: outVal,
      })
      setPrecos(resp)
      setOvModel('')
      setOvIn('')
      setOvOut('')
      toast.add({ title: 'Sobrescrita de preço salva.' })
    } catch (err) {
      setErroPrecos(err instanceof ErroCore ? err : new ErroCore('desconhecido', String(err)))
    } finally {
      setSalvandoPreco(false)
    }
  }

  async function restaurarPreco(provider: string, model: string) {
    setErroPrecos(null)
    try {
      const resp = await chamar<PricesResp>('provider.prices.clear', { provider, model })
      setPrecos(resp)
      toast.add({ title: `Preço padrão restaurado para ${model}.` })
    } catch (err) {
      setErroPrecos(err instanceof ErroCore ? err : new ErroCore('desconhecido', String(err)))
    }
  }

  async function copiarHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash)
      setAnuncioCopia('Hash copiado')
    } catch {
      setAnuncioCopia('Não foi possível copiar o hash')
    }
  }

  const orcamPausados = useMemo(() => budgets.filter((b) => b.paused !== null), [budgets])

  const custosFiltrados = useMemo(
    () =>
      costs.filter((c) => {
        if (filtroTarefaGastos && c.task !== filtroTarefaGastos) return false
        if (somenteFalhasCobradas && !ehFalhaCobrada(c)) return false
        return true
      }),
    [costs, filtroTarefaGastos, somenteFalhasCobradas],
  )

  const totais = useMemo(() => {
    let totalMicro = 0
    let cota = 0
    let desconhecido = 0
    for (const c of costs) {
      if (c.costKind === 'usd' && c.microUsd != null) {
        totalMicro += c.microUsd
      } else if (c.costKind === 'plan_quota') {
        cota += 1
      } else if (c.costKind === 'unknown') {
        desconhecido += 1
      }
    }
    return { totalMicro, cota, desconhecido }
  }, [costs])

  const auditoriaFiltrada = useMemo(() => {
    const jobNum = filtroJobAuditoria.trim() ? Number(filtroJobAuditoria.trim()) : null
    return audit.filter((a) => {
      if (jobNum !== null && Number.isFinite(jobNum) && a.job !== jobNum) return false
      if (filtroTarefaAuditoria && a.task !== filtroTarefaAuditoria) return false
      return true
    })
  }, [audit, filtroJobAuditoria, filtroTarefaAuditoria])

  const perfilSelecionadoEst = useMemo(
    () => perfis.find((p) => p.id === estPerfil) ?? null,
    [perfis, estPerfil],
  )

  const opcoesPerfisEst = useMemo<OpcaoSelect<string>[]>(
    () => [
      { valor: '', rotulo: 'Modelo padrão da tabela (gpt-5)' },
      ...perfis.map((p) => ({
        valor: p.id,
        rotulo: p.model ? `${p.label} (${p.model})` : p.label,
      })),
    ],
    [perfis],
  )

  const colunasOrcamentos: ColunaGrade<BudgetRow>[] = [
    {
      id: 'escopo',
      titulo: 'Escopo',
      largura: '24%',
      render: (b) => <span className="font-medio text-t1">{rotuloEscopo(b)}</span>,
    },
    {
      id: 'custo',
      titulo: 'Gasto / Teto USD',
      largura: '24%',
      render: (b) => {
        const pct =
          b.maxCostMicroUsd && b.maxCostMicroUsd > 0
            ? Math.min(100, (b.usage.microUsd / b.maxCostMicroUsd) * 100)
            : 0
        return (
          <div className="flex flex-col gap-1.5 py-1.5">
            <span className="num text-pequeno leading-tight text-t1">
              {usd(b.usage.microUsd)} /{' '}
              {b.maxCostMicroUsd != null ? usd(b.maxCostMicroUsd) : 'Sem teto'}
            </span>
            {b.maxCostMicroUsd != null && (
              <div className="w-36">
                <Progresso valor={pct} rotulo={`Consumo ${rotuloEscopo(b)}`} compacto />
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: 'chamadas',
      titulo: 'Chamadas',
      largura: '14%',
      alinhar: 'dir',
      render: (b) => (
        <span className="num">
          {b.usage.calls} / {b.maxCalls ?? '—'}
        </span>
      ),
    },
    {
      id: 'tokens',
      titulo: 'Tokens',
      largura: '16%',
      alinhar: 'dir',
      render: (b) => (
        <span className="num">
          {(b.usage.inputTokens + b.usage.outputTokens).toLocaleString('pt-BR')} /{' '}
          {b.maxTokens != null ? b.maxTokens.toLocaleString('pt-BR') : '—'}
        </span>
      ),
    },
    {
      id: 'estado',
      titulo: 'Estado',
      largura: '12%',
      render: (b) =>
        b.paused ? (
          <Status tom="pausado">{MOTIVO_PAUSA[b.paused] ?? b.paused}</Status>
        ) : (
          <Status tom="sucesso">Ativo</Status>
        ),
    },
    {
      id: 'acoes',
      titulo: 'Ações',
      largura: '10%',
      alinhar: 'dir',
      render: (b) =>
        b.paused ? (
          <Botao
            tamanho="p"
            variante="secundario"
            onClick={() => abrirDialogoOrcamento('retomar', b)}
          >
            Ajustar e continuar
          </Botao>
        ) : (
          <Botao
            tamanho="p"
            variante="secundario"
            onClick={() => abrirDialogoOrcamento('editar', b)}
          >
            Editar tetos
          </Botao>
        ),
    },
  ]

  const carregandoAtual =
    aba === 'precos' ? carregandoGlobal : carregandoGlobal || carregandoProjeto

  const renderSemProjeto = () => (
    <EstadoTela
      tipo="vazio"
      titulo="Nenhum Projeto aberto"
      descricao="Abra um Projeto para acompanhar orçamentos, gastos reais e trilha de auditoria. A aba Tabela de Preços e Estimador continua disponível normalmente."
      acaoPrimaria={{
        rotulo: 'Ir para Início',
        aoAcionar: () => {
          window.location.hash = '#/inicio'
        },
      }}
      acaoSecundaria={{
        rotulo: 'Abrir Tabela de Preços',
        aoAcionar: () => setAba('precos'),
      }}
    />
  )

  const renderAbaOrcamentos = () => {
    if (!projetoAberto) return renderSemProjeto()

    if (erroCustos) {
      const trad = traduzirErroCustos(erroCustos)
      return (
        <BannerErroCore
          erro={{ code: erroCustos.code, message: erroCustos.detalhe || erroCustos.message }}
          traduzir={() => ({
            titulo: 'Não foi possível carregar os registros de custo do Projeto.',
            explicacao: trad.titulo,
          })}
          acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: () => void carregarProjeto() }}
          permitirRelato
        />
      )
    }

    const primeiroPausado = orcamPausados[0] ?? null

    return (
      <div className="flex flex-col gap-4">
        {(forcado === 'parcial' || primeiroPausado) && (
          <section
            aria-label="Orçamento pausado"
            className="flex flex-wrap items-center justify-between gap-3 rounded-area bg-area px-3 py-2.5"
          >
            <Status tom="pausado" forte>
              {primeiroPausado
                ? `Fila pausada em ${rotuloEscopo(primeiroPausado)}: ${MOTIVO_PAUSA[primeiroPausado.paused!] ?? primeiroPausado.paused}`
                : 'Simulação de pausa por orçamento'}
            </Status>
            {primeiroPausado && (
              <Botao
                variante="primario"
                tamanho="p"
                onClick={() => abrirDialogoOrcamento('retomar', primeiroPausado)}
              >
                Ajustar e continuar fila
              </Botao>
            )}
          </section>
        )}

        <section
          aria-label="Orçamentos ativos do Projeto"
          className="flex flex-col gap-3 rounded-area bg-area p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medio text-t1">Orçamentos do Projeto</h2>
            <Botao variante="secundario" onClick={() => abrirDialogoOrcamento('criar')}>
              Definir orçamento por tarefa
            </Botao>
          </div>

          {budgets.length === 0 ? (
            <EstadoTela
              tipo="vazio"
              compacto
              titulo="Nenhum teto de orçamento configurado"
              descricao="Defina um teto em USD, chamadas ou tokens por tarefa."
              acaoPrimaria={{
                rotulo: 'Configurar teto por tarefa',
                aoAcionar: () => abrirDialogoOrcamento('criar'),
              }}
            />
          ) : (
            <TabelaGrade
              linhas={budgets}
              colunas={colunasOrcamentos}
              obterId={(b) => `${b.scope}:${b.key}`}
              rotulo="Orçamentos do Projeto"
            />
          )}
        </section>

        <section
          aria-label="Histórico real de chamadas"
          className="flex flex-col gap-3 rounded-area bg-area p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-medio text-t1">Histórico real de chamadas</h2>
              <span className="num text-pequeno font-medio text-t1">
                Total: {usd(totais.totalMicro)}
              </span>
              <span className="num text-pequeno text-t3">Cota do plano: {totais.cota}</span>
              <span className="num text-pequeno text-t3">Desconhecido: {totais.desconhecido}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="w-52">
                <Select
                  rotulo="Filtrar histórico por tarefa"
                  valor={filtroTarefaGastos}
                  aoMudar={setFiltroTarefaGastos}
                  opcoes={OPCOES_TAREFA_FILTRO}
                />
              </div>
              <Checkbox marcado={somenteFalhasCobradas} aoMudar={setSomenteFalhasCobradas}>
                Somente falhas cobradas
              </Checkbox>
            </div>
          </div>

          {custosFiltrados.length === 0 ? (
            <p className="text-pequeno text-t3">
              Nenhuma chamada de IA registrada para este filtro ainda.
            </p>
          ) : (
            <table className="w-full border-collapse text-left text-pequeno">
              <thead>
                <tr className="text-t3">
                  <th scope="col" className="h-8 px-2 font-normal">
                    Tarefa
                  </th>
                  <th scope="col" className="h-8 px-2 font-normal">
                    Perfil / Modelo
                  </th>
                  <th scope="col" className="h-8 px-2 text-right font-normal">
                    Tokens (ent / saí)
                  </th>
                  <th scope="col" className="h-8 px-2 text-right font-normal">
                    Custo real (est.)
                  </th>
                  <th scope="col" className="h-8 px-2 font-normal">
                    Desfecho
                  </th>
                </tr>
              </thead>
              <tbody>
                {custosFiltrados.map((r) => {
                  const falhaCobrada = ehFalhaCobrada(r)
                  const textoCusto =
                    r.costKind === 'plan_quota'
                      ? 'Consome cota do plano'
                      : r.costKind === 'zero'
                        ? 'US$ 0,00'
                        : r.costKind === 'unknown' || r.microUsd == null
                          ? 'Desconhecido'
                          : r.estimateMicroUsd != null
                            ? `${usd(r.microUsd)} (est. ${usd(r.estimateMicroUsd)})`
                            : usd(r.microUsd)

                  return (
                    <tr key={r.id} className="hover:bg-elevado">
                      <td className="h-10 px-2 text-t1">{NOME_TAREFA[r.task] ?? r.task}</td>
                      <td className="h-10 px-2 font-mono text-t2">
                        {r.provider}
                        {r.model ? ` · ${r.model}` : ''}
                      </td>
                      <td className="num h-10 px-2 text-right text-t2">
                        {r.inputTokens != null
                          ? `${r.inputTokens.toLocaleString('pt-BR')} / ${(r.outputTokens ?? 0).toLocaleString('pt-BR')}`
                          : '—'}
                      </td>
                      <td className="num h-10 px-2 text-right text-t1">{textoCusto}</td>
                      <td className="h-10 px-2">
                        {falhaCobrada ? (
                          <Status tom="perigo">Falha cobrada ({r.outcome})</Status>
                        ) : r.outcome && r.outcome !== 'ok' ? (
                          <Status tom="aviso">{r.outcome}</Status>
                        ) : (
                          <Status tom="sucesso">Concluído</Status>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    )
  }

  const renderAbaAuditoria = () => {
    if (!projetoAberto) return renderSemProjeto()

    if (erroAuditoria) {
      const trad = traduzirErroCustos(erroAuditoria)
      return (
        <BannerErroCore
          erro={{
            code: erroAuditoria.code,
            message: erroAuditoria.detalhe || erroAuditoria.message,
          }}
          traduzir={() => ({ titulo: trad.titulo })}
          acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: () => void carregarProjeto() }}
          permitirRelato
        />
      )
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-area bg-area px-3 py-2.5 text-pequeno text-t2">
          <Lock className="mt-0.5 size-[14px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
          <p className="max-w-[68ch]">
            Nenhum texto de Transcrição, Roteiro ou chave de API é salvo aqui. A trilha registra
            apenas destino, tamanho em bytes e assinaturas criptográficas SHA-256 para verificação.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="w-44">
            <Entrada
              aria-label="Filtrar por Job #"
              type="number"
              min={1}
              className="num"
              placeholder="Filtrar por Job #…"
              value={filtroJobAuditoria}
              onChange={(e) => setFiltroJobAuditoria(e.target.value)}
            />
          </div>
          <div className="w-52">
            <Select
              rotulo="Filtrar auditoria por tarefa"
              valor={filtroTarefaAuditoria}
              aoMudar={setFiltroTarefaAuditoria}
              opcoes={OPCOES_TAREFA_FILTRO}
            />
          </div>
          {anuncioCopia && (
            <span role="status" className="text-pequeno text-t2">
              {anuncioCopia}
            </span>
          )}
        </div>

        <section
          aria-label="Trilha de auditoria SHA-256"
          className="rounded-area bg-area p-3"
        >
          {auditoriaFiltrada.length === 0 ? (
            <p className="text-pequeno text-t3">Nenhum registro de auditoria para este filtro.</p>
          ) : (
            <table className="w-full border-collapse text-left text-pequeno">
              <thead>
                <tr className="text-t3">
                  <th scope="col" className="h-8 px-2 font-normal">
                    Job
                  </th>
                  <th scope="col" className="h-8 px-2 font-normal">
                    Tarefa / Versão
                  </th>
                  <th scope="col" className="h-8 px-2 font-normal">
                    Provedor / Modelo
                  </th>
                  <th scope="col" className="h-8 px-2 font-normal">
                    Host de destino
                  </th>
                  <th scope="col" className="h-8 px-2 text-right font-normal">
                    Bytes enviados
                  </th>
                  <th scope="col" className="h-8 px-2 font-normal">
                    Desfecho
                  </th>
                  <th scope="col" className="h-8 px-2 font-normal">
                    Hashes SHA-256
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditoriaFiltrada.map((a) => (
                  <tr key={a.id} className="hover:bg-elevado">
                    <td className="num h-10 px-2 text-t1">#{a.job ?? '—'}</td>
                    <td className="h-10 px-2 text-t2">
                      {(a.task && NOME_TAREFA[a.task]) ?? a.task ?? '—'}
                      {a.taskVersion != null && (
                        <span className="num ml-1 text-t3">v{a.taskVersion}</span>
                      )}
                    </td>
                    <td className="h-10 px-2 font-mono text-t2">
                      {a.providerKind}
                      {a.model ? ` · ${a.model}` : ''}
                    </td>
                    <td className="h-10 px-2 font-mono text-t2">
                      {a.host ?? '—'}
                      {isLoopbackHost(a.host) && (
                        <span className="ml-1 text-t3">(loopback)</span>
                      )}
                    </td>
                    <td className="num h-10 px-2 text-right text-t1">
                      {a.sentBytes != null ? `${a.sentBytes.toLocaleString('pt-BR')} B` : '—'}
                    </td>
                    <td className="h-10 px-2">
                      <Status tom={a.outcome === 'ok' ? 'sucesso' : 'aviso'}>
                        {a.outcome ?? '—'}
                      </Status>
                    </td>
                    <td className="h-10 px-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-micro text-t3">
                          in: {truncarHash(a.inputSha256)}
                        </span>
                        {a.inputSha256 && (
                          <Botao
                            tamanho="p"
                            variante="fantasma"
                            icone={<Copy />}
                            aria-label={`Copiar hash de entrada da chamada ${a.id}`}
                            onClick={() => void copiarHash(a.inputSha256!)}
                          >
                            Copiar
                          </Botao>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    )
  }

  const renderAbaPrecos = () => {
    const listaOverrides = precos?.overrides ?? []
    const ehSobrescrito = (p: PriceRow) =>
      listaOverrides.some((o) => o.provider === p.provider && o.model === p.model)
    const todasLinhas = [
      ...listaOverrides.map((p) => ({ ...p, custom: true })),
      ...(precos?.prices ?? [])
        .filter((p) => !ehSobrescrito(p))
        .map((p) => ({ ...p, custom: false })),
    ]

    return (
      <div className="flex flex-col gap-5">
        {erroPrecos && (
          <BannerErroCore
            erro={{ code: erroPrecos.code, message: erroPrecos.detalhe || erroPrecos.message }}
            traduzir={(code) => traduzirErroCustos(new ErroCore(code, erroPrecos.detalhe))}
            aoDispensar={() => setErroPrecos(null)}
          />
        )}

        <section
          aria-label="Estimador manual de custo"
          className="flex max-w-[68ch] flex-col gap-3 rounded-area bg-area p-3"
        >
          <h2 className="text-base font-medio text-t1">Estimador manual de custo</h2>
          <form onSubmit={(e) => void simularCusto(e)} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr]">
              <Campo rotulo="Perfil de Provedor">
                {(props) => (
                  <Select
                    {...props}
                    valor={estPerfil}
                    aoMudar={setEstPerfil}
                    opcoes={opcoesPerfisEst}
                  />
                )}
              </Campo>
              <Campo rotulo="Teto de saída (tokens)">
                {(props) => (
                  <Entrada
                    {...props}
                    type="number"
                    min={1}
                    className="num"
                    value={estMaxOut}
                    onChange={(e) => setEstMaxOut(e.target.value)}
                  />
                )}
              </Campo>
            </div>
            <Campo rotulo="Texto de amostra da Transcrição">
              {(props) => (
                <AreaTexto
                  {...props}
                  value={estTexto}
                  onChange={(e) => setEstTexto(e.target.value)}
                />
              )}
            </Campo>
            <div className="flex justify-end">
              <Botao type="submit" variante="primario" carregando={estimando}>
                Simular custo
              </Botao>
            </div>
          </form>

          {estimativa && (
            <ResumoCustoPrivacidade
              tarefa="Simulação de custo"
              perfil={{
                id: perfilSelecionadoEst?.id ?? 'default',
                label: perfilSelecionadoEst?.label ?? 'Modelo padrão da tabela',
                kind: perfilSelecionadoEst?.cli
                  ? 'cli'
                  : perfilSelecionadoEst?.local
                    ? 'local'
                    : 'api',
                model: perfilSelecionadoEst?.model ?? 'gpt-5',
              }}
              localidade={
                perfilSelecionadoEst?.cli
                  ? 'cli'
                  : perfilSelecionadoEst?.local
                    ? 'local'
                    : 'remoto'
              }
              saiDaMaquina={!perfilSelecionadoEst?.local}
              host={
                perfilSelecionadoEst?.endpoint
                  ? (() => {
                      try {
                        return new URL(perfilSelecionadoEst.endpoint!).host
                      } catch {
                        return null
                      }
                    })()
                  : null
              }
              estimativa={
                estimativa.kind === 'zero'
                  ? { kind: 'zero' }
                  : estimativa.kind === 'plan_quota'
                    ? { kind: 'plan_quota' }
                    : estimativa.kind === 'unknown'
                      ? { kind: 'unknown' }
                      : {
                          kind: 'usd',
                          minMicroUsd: estimativa.minMicroUsd ?? 0,
                          maxMicroUsd: estimativa.maxMicroUsd ?? estimativa.minMicroUsd ?? 0,
                          inputTokens: estimativa.inputTokens,
                          nota:
                            estimativa.priceSource === 'override'
                              ? 'Fonte: sobrescrita do usuário'
                              : 'Fonte: tabela embutida',
                        }
              }
            />
          )}
        </section>

        <section
          aria-label="Tabela de preços de referência"
          className="flex flex-col gap-3 rounded-area bg-area p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medio text-t1">Tabela de preços de referência</h2>
            {precos?.updatedAt && (
              <span className="num text-pequeno text-t3">
                Atualizada em {precos.updatedAt}
              </span>
            )}
          </div>

          <table className="w-full border-collapse text-left text-pequeno">
            <thead>
              <tr className="text-t3">
                <th scope="col" className="h-8 px-2 font-normal">
                  Provedor
                </th>
                <th scope="col" className="h-8 px-2 font-normal">
                  Modelo
                </th>
                <th scope="col" className="h-8 px-2 text-right font-normal">
                  Entrada / 1M
                </th>
                <th scope="col" className="h-8 px-2 text-right font-normal">
                  Saída / 1M
                </th>
                <th scope="col" className="h-8 px-2 font-normal">
                  Origem
                </th>
                <th scope="col" className="h-8 px-2 text-right font-normal">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {todasLinhas.map((p) => (
                <tr key={`${p.custom ? 'o' : 't'}-${p.provider}-${p.model}`} className="hover:bg-elevado">
                  <td className="h-10 px-2 text-t2">{p.provider}</td>
                  <td className="h-10 px-2 font-mono text-t1">{p.model}</td>
                  <td className="num h-10 px-2 text-right text-t1">
                    {usd(Math.round(p.inputPerMillion * 1_000_000))}
                  </td>
                  <td className="num h-10 px-2 text-right text-t1">
                    {usd(Math.round(p.outputPerMillion * 1_000_000))}
                  </td>
                  <td className="h-10 px-2">
                    <Status tom={p.custom ? 'info' : 'neutro'}>
                      {p.custom ? 'Personalizado' : 'Embutido'}
                    </Status>
                  </td>
                  <td className="h-10 px-2 text-right">
                    {p.custom ? (
                      <Botao
                        tamanho="p"
                        variante="fantasma"
                        onClick={() => void restaurarPreco(p.provider, p.model)}
                      >
                        Restaurar padrão
                      </Botao>
                    ) : (
                      <Botao
                        tamanho="p"
                        variante="fantasma"
                        onClick={() => {
                          setOvProvider(p.provider)
                          setOvModel(p.model)
                          setOvIn(String(p.inputPerMillion))
                          setOvOut(String(p.outputPerMillion))
                        }}
                      >
                        Sobrescrever
                      </Botao>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form
            onSubmit={(e) => void salvarPreco(e)}
            className="mt-2 grid grid-cols-1 items-end gap-2 rounded-controle bg-elevado p-3 sm:grid-cols-[1fr_1.3fr_1fr_1fr_auto]"
          >
            <Campo rotulo="Provedor">
              {(props) => (
                <Select
                  {...props}
                  valor={ovProvider}
                  aoMudar={setOvProvider}
                  opcoes={OPCOES_PROVEDOR_PRECO}
                />
              )}
            </Campo>
            <Campo rotulo="Modelo a sobrescrever">
              {(props) => (
                <Entrada
                  {...props}
                  className="font-mono"
                  value={ovModel}
                  onChange={(e) => setOvModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  required
                />
              )}
            </Campo>
            <Campo rotulo="Entrada (US$ / 1M)">
              {(props) => (
                <Entrada
                  {...props}
                  type="number"
                  min={0}
                  step="any"
                  className="num"
                  value={ovIn}
                  onChange={(e) => setOvIn(e.target.value)}
                  required
                />
              )}
            </Campo>
            <Campo rotulo="Saída (US$ / 1M)">
              {(props) => (
                <Entrada
                  {...props}
                  type="number"
                  min={0}
                  step="any"
                  className="num"
                  value={ovOut}
                  onChange={(e) => setOvOut(e.target.value)}
                  required
                />
              )}
            </Campo>
            <Botao type="submit" variante="secundario" carregando={salvandoPreco}>
              Salvar sobrescrita
            </Botao>
          </form>
        </section>
      </div>
    )
  }

  const renderCorpo = () => {
    if (forcado === 'carregando' || carregandoAtual) {
      return <Esqueleto variante="painel" rotuloAcessivel="Carregando Custos" />
    }
    if (forcado === 'erro' || erroGlobal) {
      const e = erroGlobal ?? new ErroCore('desconhecido', 'Erro simulado em ?estado=erro.')
      const trad = traduzirErroCustos(e)
      return (
        <BannerErroCore
          erro={{ code: e.code, message: e.detalhe || e.message }}
          traduzir={() => ({ titulo: trad.titulo })}
          acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: () => void carregarGlobal() }}
          permitirRelato
        />
      )
    }
    if (forcado === 'vazio') {
      return renderSemProjeto()
    }

    return (
      <div className="flex flex-col gap-4">
        <Abas
          valor={aba}
          aoMudar={(v) => setAba(v)}
          abas={ABAS_CUSTOS}
          rotulo="Seções de Custos"
        />

        <div
          role="tabpanel"
          aria-label={ROTULOS_ABA[aba]}
        >
          {aba === 'orcamentos' && renderAbaOrcamentos()}
          {aba === 'auditoria' && renderAbaAuditoria()}
          {aba === 'precos' && renderAbaPrecos()}
        </div>
      </div>
    )
  }

  return (
    <ConfiguracoesLayout
      secao="custos"
      projetoAberto={projetoAberto}
      titulo="Custos, Orçamentos e Auditoria"
      subtitulo="Configure tetos de orçamento do Projeto aberto, acompanhe gastos reais (inclusive falhas cobradas), inspecione hashes SHA-256 e simule preços."
    >
      {renderCorpo()}

      <Dialogo
        aberto={dialogoOrcamento !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setDialogoOrcamento(null)
        }}
        titulo={
          dialogoOrcamento?.modo === 'retomar'
            ? 'Ajustar orçamento e continuar fila'
            : dialogoOrcamento?.modo === 'criar'
              ? 'Definir orçamento por tarefa'
              : 'Editar tetos de orçamento'
        }
        largura={460}
      >
        <form onSubmit={(e) => void salvarOrcamento(e)} className="flex flex-col gap-3">
          {erroDialogoOrcamento && (
            <BannerErroCore
              erro={{
                code: erroDialogoOrcamento.code,
                message: erroDialogoOrcamento.detalhe || erroDialogoOrcamento.message,
              }}
              traduzir={(code) =>
                traduzirErroCustos(new ErroCore(code, erroDialogoOrcamento.detalhe))
              }
            />
          )}

          {dialogoOrcamento?.modo === 'criar' && (
            <Campo rotulo="Tarefa de IA">
              {(props) => (
                <Select
                  {...props}
                  valor={orcKey}
                  aoMudar={setOrcKey}
                  opcoes={OPCOES_TAREFA_ORCAMENTO}
                />
              )}
            </Campo>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Teto de custo (US$)">
              {(props) => (
                <Entrada
                  {...props}
                  type="number"
                  min={0}
                  step="any"
                  className="num"
                  value={orcCustoUsd}
                  onChange={(e) => setOrcCustoUsd(e.target.value)}
                  placeholder="Sem teto"
                />
              )}
            </Campo>
            <Campo rotulo="Máx. chamadas">
              {(props) => (
                <Entrada
                  {...props}
                  type="number"
                  min={1}
                  className="num"
                  value={orcChamadas}
                  onChange={(e) => setOrcChamadas(e.target.value)}
                  placeholder="Sem limite"
                />
              )}
            </Campo>
            <Campo rotulo="Máx. tokens">
              {(props) => (
                <Entrada
                  {...props}
                  type="number"
                  min={1}
                  className="num"
                  value={orcTokens}
                  onChange={(e) => setOrcTokens(e.target.value)}
                  placeholder="Sem limite"
                />
              )}
            </Campo>
            <Campo rotulo="Tempo máx. (s)">
              {(props) => (
                <Entrada
                  {...props}
                  type="number"
                  min={1}
                  className="num"
                  value={orcTempoS}
                  onChange={(e) => setOrcTempoS(e.target.value)}
                  placeholder="Sem limite"
                />
              )}
            </Campo>
          </div>

          <Checkbox marcado={orcResetUsage} aoMudar={setOrcResetUsage}>
            Zerar contagem acumulada a partir de agora
          </Checkbox>

          {dialogoOrcamento?.modo === 'retomar' &&
            dialogoOrcamento.paused === 'cost_unknown' && (
              <Checkbox marcado={orcConfirmed} aoMudar={setOrcConfirmed}>
                Entendo que o custo é desconhecido e desejo continuar mesmo assim
              </Checkbox>
            )}

          <div className="mt-2 flex justify-end gap-2">
            <Botao onClick={() => setDialogoOrcamento(null)} disabled={salvandoOrcamento}>
              Cancelar
            </Botao>
            <Botao
              type="submit"
              variante="primario"
              carregando={salvandoOrcamento}
              disabled={
                dialogoOrcamento?.modo === 'retomar' &&
                dialogoOrcamento.paused === 'cost_unknown' &&
                !orcConfirmed
              }
            >
              {dialogoOrcamento?.modo === 'retomar' ? 'Confirmar e continuar' : 'Salvar tetos'}
            </Botao>
          </div>
        </form>
      </Dialogo>
    </ConfiguracoesLayout>
  )
}
