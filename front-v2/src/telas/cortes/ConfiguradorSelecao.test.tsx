import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import { ConfiguradorSelecao } from '~/telas/cortes/ConfiguradorSelecao'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => 'demo')

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('~/core/progresso', async () => {
  const atual = await vi.importActual<typeof import('~/core/progresso')>('~/core/progresso')
  return {
    ...atual,
    useFila: () => atual.useFila(filaTeste),
  }
})

beforeAll(() => {
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

const FONTE_DEMO: FonteProjeto = {
  id: 4,
  path: '/videos/Live_12_11_final.mp4',
  status: 'available',
  available: true,
  verified: true,
  audio_track: 1,
  origin_url: 'https://www.youtube.com/watch?v=live1211',
  language: 'pt',
  permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes e tradução' },
  metadata: {
    format: { duration: '3600.0' },
    streams: [{ index: 0, codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '60/1' }],
  },
}

const PESOS_DIRETO = [
  { key: 'hook', weight: 0.3 },
  { key: 'selfContained', weight: 0.2 },
  { key: 'energy', weight: 0.2 },
  { key: 'value', weight: 0.15 },
  { key: 'closing', weight: 0.15 },
]

const PESOS_TRANSFORMADO = [
  { key: 'commentary', weight: 0.3 },
  { key: 'hook', weight: 0.2 },
  { key: 'energy', weight: 0.15 },
  { key: 'value', weight: 0.15 },
  { key: 'selfContained', weight: 0.1 },
  { key: 'closing', weight: 0.1 },
]

function mockBase(overrides: Partial<Record<string, (args: unknown) => unknown>> = {}) {
  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    if (Object.hasOwn(overrides, cmd)) {
      return overrides[cmd]!(args)
    }
    const a = (args ?? {}) as Record<string, unknown>
    switch (cmd) {
      case 'channel_profile.get':
        return {
          videoKind: 'direct',
          language: 'pt',
          minUs: 20_000_000,
          maxUs: 60_000_000,
          allowedSources: [],
          narrationVoice: null,
          directMonetizationAck: false,
          limits: {
            defaultMinUs: 20_000_000,
            defaultMaxUs: 60_000_000,
            maxUs: 180_000_000,
            technicalMaxUs: 300_000_000,
          },
        }
      case 'guardrails.check':
        return {
          scope: 'source',
          directMonetizationAck: false,
          needsDirectNotice: true,
          videoKind: 'direct',
        }
      case 'guardrails.ack_direct_notice':
        return { directMonetizationAck: true }
      case 'energy.status':
        return { measured: false, marks: { high: 0, peak: 0 }, job: null }
      case 'energy.start':
        return { state: 'queued', job: 101 }
      case 'chat.status':
        return { state: 'none', canFetch: true, intervals: 0, messages: 0, peaks: 0, job: null }
      case 'chat.fetch':
        return { state: 'queued', job: 102 }
      case 'jobs.cancel':
        return null
      case 'provider.selection_state':
        return {
          applicable: true,
          profileId: 'remoto-rapido',
          kind: 'openai',
          model: 'gpt-4o-mini',
          contextTokens: 32768,
          origin: 'user',
          state: 'full',
          reference: {
            sourceMinutes: 60,
            maxWindowMinutes: 15,
            minWindowMinutes: 9,
            firstWindowMinutes: 15,
            windows: 5,
          },
          guides: [],
        }
      case 'provider.profiles.list':
        return {
          profiles: [
            {
              id: 'remoto-rapido',
              label: 'Perfil Rápido',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini',
              local: false,
              cli: false,
            },
            {
              id: 'local-ollama',
              label: 'Ollama Local',
              kind: 'ollama',
              endpoint: 'http://127.0.0.1:11434',
              model: 'qwen3',
              local: true,
              cli: false,
            },
          ],
        }
      case 'assistant.tasks':
        return {
          projectLocalOnly: false,
          tasks: [
            {
              task: 'selection',
              choice: 'profile:remoto-rapido',
              source: 'task',
              profile: {
                id: 'remoto-rapido',
                label: 'Perfil Rápido',
                kind: 'openai',
                local: false,
                model: 'gpt-4o-mini',
                cli: false,
              },
              localOnly: false,
              blocked: false,
              missing: null,
            },
          ],
        }
      case 'jobs.budget.get':
        return {
          budgets: [
            {
              scope: 'task',
              key: 'selection',
              maxCalls: 20,
              maxTokens: 100_000,
              maxWallMs: null,
              maxCostMicroUsd: 2_000_000,
              unknownConfirmed: false,
              since: 1794900000000000,
              usage: {
                calls: 2,
                inputTokens: 12_000,
                outputTokens: 2_000,
                microUsd: 40_000,
                audioMicroUsd: 0,
                unknownCostCalls: 0,
                planQuotaCalls: 0,
                durationMs: 3_000,
                costLabel: null,
              },
              paused: null,
            },
          ],
        }
      case 'selection.estimate': {
        const videoKind = a.videoKind === 'transformed' ? 'transformed' : 'direct'
        return {
          paid: true,
          profile: 'remoto-rapido',
          minUs: (a.minUs as number) ?? 20_000_000,
          maxUs: (a.maxUs as number) ?? 60_000_000,
          videoKind,
          plan: {
            state: 'full',
            windows: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }],
            contextTokens: 32768,
          },
          weights: videoKind === 'transformed' ? PESOS_TRANSFORMADO : PESOS_DIRETO,
          estimate: {
            kind: 'usd',
            windows: 4,
            inputTokens: 40_000,
            minMicroUsd: 10_000,
            maxMicroUsd: 50_000,
          },
        }
      }
      case 'selection.start':
        return {
          run: 14,
          batch: 'selection-14',
          videoKind: a.videoKind ?? 'direct',
          minUs: a.minUs ?? 20_000_000,
          maxUs: a.maxUs ?? 60_000_000,
          windows: 4,
          planState: 'full',
          weights: a.videoKind === 'transformed' ? PESOS_TRANSFORMADO : PESOS_DIRETO,
        }
      default:
        return null
    }
  })
}

describe('<ConfiguradorSelecao>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    window.location.hash = '#/projeto/demo/cortes'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('inicializa com channel_profile.get, pesos da Nota, compatibilidade de provider.selection_state e faixa direta de guardrails', async () => {
    mockBase()
    render(envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />))

    const radioDireto = await screen.findByRole('radio', { name: /Corte direto/i })
    const radioTransformado = screen.getByRole('radio', { name: /Vídeo transformado/i })
    expect(radioDireto).toHaveAttribute('aria-checked', 'true')
    expect(radioTransformado).toHaveAttribute('aria-checked', 'false')

    expect(screen.getByText(/Herdado do Perfil de canal/i)).toBeInTheDocument()
    expect(screen.getByText(/Gancho \(30%\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Duração mínima/i)).toHaveValue(20)
    expect(screen.getByLabelText(/Duração máxima/i)).toHaveValue(60)
    expect(screen.getByText(/Janela de contexto: Completa \(15 min\)/i)).toBeInTheDocument()
    expect(await screen.findByText(/Perfil Rápido/i)).toBeInTheDocument()
    expect(screen.getByText(/Remoto \(HTTPS\)/i)).toBeInTheDocument()
    expect(screen.getByText(/US\$ 1,96 restantes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entendi o risco' })).toBeInTheDocument()
  })

  it('alternar radiogroup por teclado para Vídeo transformado recalcula selection.estimate e destaca Espaço para comentário (30%) em 1º', async () => {
    const user = userEvent.setup()
    mockBase()
    render(envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />))

    const radioDireto = await screen.findByRole('radio', { name: /Corte direto/i })
    radioDireto.focus()
    await user.keyboard('{ArrowRight}')

    const radioTransformado = screen.getByRole('radio', { name: /Vídeo transformado/i })
    expect(radioTransformado).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Sobrescrito só para esta execução/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entendi o risco' })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'selection.estimate',
        expect.objectContaining({ source_id: 4, videoKind: 'transformed' }),
      )
    })

    const textoPesos = screen.getByText(/Espaço para comentário \(30%\)/i).closest('p, div')
    expect(textoPesos?.textContent).toMatch(/^Pesos da Nota:\s*Espaço para comentário \(30%\)/i)
  })

  it('clicar "Entendi o risco" chama guardrails.ack_direct_notice e oculta a faixa', async () => {
    const user = userEvent.setup()
    mockBase()
    render(envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />))

    const btnAck = await screen.findByRole('button', { name: 'Entendi o risco' })
    await user.click(btnAck)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('guardrails.ack_direct_notice', {})
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Entendi o risco' })).not.toBeInTheDocument()
    })
  })

  it('valida duração mínima/máxima com aviso > 60 s, restaurar padrão e bloqueio acessível (aria-describedby)', async () => {
    const user = userEvent.setup()
    mockBase()
    render(envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />))

    const inputMin = (await screen.findByLabelText(/Duração mínima/i)) as HTMLInputElement
    const inputMax = screen.getByLabelText(/Duração máxima/i) as HTMLInputElement
    const btnRestaurar = screen.getByRole('button', { name: /Restaurar padrão do canal/i })
    const btnDisparar = screen.getByRole('button', { name: 'Selecionar Cortes' })

    expect(btnRestaurar).toBeDisabled()

    await user.clear(inputMax)
    await user.type(inputMax, '90')

    expect(screen.getByText(/acima de 60 s/i)).toBeInTheDocument()
    expect(btnRestaurar).toBeEnabled()
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'selection.estimate',
        expect.objectContaining({ maxUs: 90_000_000 }),
      )
    })

    await user.clear(inputMin)
    await user.type(inputMin, '95')

    expect(btnDisparar).toBeDisabled()
    expect(inputMin).toHaveAttribute('aria-invalid', 'true')
    const descId = inputMin.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId!)).toHaveTextContent(/menor que a duração máxima/i)

    await user.clear(inputMax)
    await user.type(inputMax, '350')
    expect(inputMax).toHaveAttribute('aria-invalid', 'true')
    expect(btnDisparar).toBeDisabled()

    await user.click(btnRestaurar)
    expect(inputMin).toHaveValue(20)
    expect(inputMax).toHaveValue(60)
    expect(btnDisparar).toBeEnabled()
  })

  it('aciona energy.start, chat.fetch e permite cancelar job ativo com jobs.cancel', async () => {
    const user = userEvent.setup()
    let energiaEstado = { measured: false, marks: { high: 0, peak: 0 }, job: null as { id: number; state: string; progress: number } | null }
    let chatEstado = { state: 'none', canFetch: true, intervals: 0, messages: 0, peaks: 0, job: null as { id: number; state: string; progress: number } | null }

    mockBase({
      'energy.status': () => energiaEstado,
      'energy.start': () => {
        energiaEstado = { measured: false, marks: { high: 0, peak: 0 }, job: { id: 101, state: 'running', progress: 40 } }
        return { state: 'queued', job: 101 }
      },
      'chat.status': () => chatEstado,
      'chat.fetch': () => {
        chatEstado = { state: 'none', canFetch: true, intervals: 0, messages: 0, peaks: 0, job: { id: 102, state: 'running', progress: 25 } }
        return { state: 'queued', job: 102 }
      },
    })

    render(envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />))

    const btnEnergia = await screen.findByRole('button', { name: /Medir energia do áudio/i })
    await user.click(btnEnergia)

    expect(chamarMock).toHaveBeenCalledWith('energy.start', { source_id: 4 })
    expect(await screen.findByText(/Medindo energia do áudio/i)).toBeInTheDocument()

    const btnCancelarEnergia = screen.getByRole('button', { name: /Cancelar medição de energia/i })
    await user.click(btnCancelarEnergia)
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 101 })

    const btnChat = screen.getByRole('button', { name: /Buscar chat da live/i })
    await user.click(btnChat)
    expect(chamarMock).toHaveBeenCalledWith('chat.fetch', { source_id: 4 })
    expect(await screen.findByText(/Buscando chat da live/i)).toBeInTheDocument()

    await act(async () => {
      energiaEstado = { measured: true, marks: { high: 12, peak: 4 }, job: null }
      filaTeste.aplicar({
        job: '101',
        project: 'demo',
        stage: 'complete',
        percentage: 100,
        message: 'Energia medida',
        error: null,
      })
    })

    expect(await screen.findByText(/12 altas/i)).toBeInTheDocument()
  })

  it('com Provedor pago, abre <ConfirmDialog> com foco inicial em Cancelar e <ResumoCustoPrivacidade>, e só chama selection.start { confirmed: true } ao confirmar', async () => {
    const user = userEvent.setup()
    const aoIniciar = vi.fn()
    mockBase()
    render(
      envolver(
        <ConfiguradorSelecao
          fonte={FONTE_DEMO}
          execucaoEmAndamento={false}
          aoIniciarSelecao={aoIniciar}
        />,
      ),
    )

    const btnDisparar = await screen.findByRole('button', { name: 'Selecionar Cortes' })
    await user.click(btnDisparar)

    const dlg = await screen.findByRole('alertdialog')
    const btnCancelar = within(dlg).getByRole('button', { name: 'Cancelar' })
    await waitFor(() => expect(btnCancelar).toHaveFocus())

    expect(within(dlg).getByText(/Perfil Rápido/i)).toBeInTheDocument()
    expect(within(dlg).getByText(/Remoto \(HTTPS\)/i)).toBeInTheDocument()
    expect(chamarMock).not.toHaveBeenCalledWith('selection.start', expect.anything())

    const btnConfirmar = within(dlg).getByRole('button', { name: /Confirmar e selecionar Cortes/i })
    await user.click(btnConfirmar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.start', {
        source_id: 4,
        minUs: 20_000_000,
        maxUs: 60_000_000,
        videoKind: 'direct',
        confirmed: true,
      })
    })
    expect(aoIniciar).toHaveBeenCalledWith(expect.objectContaining({ run: 14 }))
  })

  it('com Provedor local (!paid), dispara selection.start diretamente sem ConfirmDialog', async () => {
    const user = userEvent.setup()
    const aoIniciar = vi.fn()
    mockBase({
      'provider.profiles.list': () => ({
        profiles: [
          {
            id: 'local-ollama',
            label: 'Ollama Local',
            kind: 'ollama',
            endpoint: 'http://127.0.0.1:11434',
            model: 'qwen3',
            local: true,
            cli: false,
          },
        ],
      }),
      'assistant.tasks': () => ({
        projectLocalOnly: false,
        tasks: [
          {
            task: 'selection',
            choice: 'profile:local-ollama',
            source: 'task',
            profile: {
              id: 'local-ollama',
              label: 'Ollama Local',
              kind: 'ollama',
              local: true,
              model: 'qwen3',
              cli: false,
            },
            localOnly: false,
            blocked: false,
            missing: null,
          },
        ],
      }),
      'selection.estimate': () => ({
        paid: false,
        profile: 'local-ollama',
        minUs: 20_000_000,
        maxUs: 60_000_000,
        videoKind: 'direct',
        plan: { state: 'full', windows: [{ index: 0 }], contextTokens: 32768 },
        weights: PESOS_DIRETO,
        estimate: { kind: 'zero' },
      }),
    })

    render(
      envolver(
        <ConfiguradorSelecao
          fonte={FONTE_DEMO}
          execucaoEmAndamento={false}
          aoIniciarSelecao={aoIniciar}
        />,
      ),
    )

    const btnDisparar = await screen.findByRole('button', { name: 'Selecionar Cortes' })
    await user.click(btnDisparar)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.start', {
        source_id: 4,
        minUs: 20_000_000,
        maxUs: 60_000_000,
        videoKind: 'direct',
        confirmed: false,
      })
    })
    expect(aoIniciar).toHaveBeenCalledWith(expect.objectContaining({ run: 14 }))
  })

  it('renderiza erros context_too_small, local_only_violation e profile_unavailable com recuperações corretas', async () => {
    const user = userEvent.setup()

    // 1. context_too_small -> "Reduzir duração máxima" foca campo maxUs
    mockBase({
      'selection.estimate': () => {
        throw new ErroCore('context_too_small', 'Janela de contexto insuficiente.')
      },
    })
    const { unmount } = render(
      envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />),
    )
    const alertaCtx = await screen.findByRole('alert')
    expect(alertaCtx).toHaveTextContent(/Janela de contexto/i)
    const btnReduzir = within(alertaCtx).getByRole('button', { name: /Reduzir duração máxima/i })
    expect(within(alertaCtx).getByRole('button', { name: /Trocar Perfil de Provedor/i })).toBeInTheDocument()
    await user.click(btnReduzir)
    expect(screen.getByLabelText(/Duração máxima/i)).toHaveFocus()
    unmount()

    // 2. local_only_violation -> "Escolher Perfil local" e "Ver veto do Projeto"
    mockBase({
      'selection.estimate': () => {
        throw new ErroCore('local_only_violation', 'Somente local ativo.')
      },
    })
    const r2 = render(
      envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />),
    )
    const alertaLocal = await screen.findByRole('alert')
    expect(alertaLocal).toHaveTextContent(/Somente local/i)
    expect(within(alertaLocal).getByRole('button', { name: /Escolher Perfil local/i })).toBeInTheDocument()
    expect(within(alertaLocal).getByRole('button', { name: /Ver veto do Projeto/i })).toBeInTheDocument()
    r2.unmount()

    // 3. profile_unavailable -> <EstadoTela tipo="sem_permissao" compacto /> com CTA "Configurar Provedores"
    mockBase({
      'provider.selection_state': () => ({ applicable: false }),
      'assistant.tasks': () => ({
        projectLocalOnly: false,
        tasks: [
          {
            task: 'selection',
            choice: '',
            source: 'none',
            profile: null,
            localOnly: false,
            blocked: false,
            missing: null,
          },
        ],
      }),
      'selection.estimate': () => {
        throw new ErroCore('profile_unavailable', 'Sem Perfil configurado.')
      },
    })
    render(envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />))
    expect(
      await screen.findByText(/Configure um Perfil de Provedor para selecionar Cortes/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Configurar Provedores/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Selecionar Cortes' })).toBeDisabled()
  })

  it('UI-30: não engole context_too_small no modo legado (assistant.tasks sem profile) nem pisca EstadoTela enquanto selection.estimate carrega', async () => {
    const user = userEvent.setup()
    let resolverEstimativa!: (v: unknown) => void
    let rejeitarEstimativa!: (e: unknown) => void
    let chamada = 0

    mockBase({
      'provider.selection_state': () => ({ applicable: false }),
      'assistant.tasks': () => ({
        projectLocalOnly: false,
        tasks: [
          {
            task: 'selection',
            choice: '',
            source: 'none',
            profile: null,
            localOnly: false,
            blocked: false,
            missing: null,
          },
        ],
      }),
      'selection.estimate': () => {
        chamada += 1
        if (chamada === 1) {
          return new Promise((resolve, reject) => {
            resolverEstimativa = resolve
            rejeitarEstimativa = reject
          })
        }
        throw new ErroCore('context_too_small', 'Janela de contexto insuficiente.')
      },
    })

    const { rerender } = render(
      envolver(<ConfiguradorSelecao fonte={FONTE_DEMO} execucaoEmAndamento={false} />),
    )

    // Enquanto selection.estimate da 1ª carga estiver pendente, não deve piscar "Configure um Perfil de Provedor"
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.estimate', expect.anything())
    })
    expect(
      screen.queryByText(/Configure um Perfil de Provedor para selecionar Cortes/i),
    ).not.toBeInTheDocument()

    await act(async () => {
      rejeitarEstimativa(new ErroCore('context_too_small', 'Janela de contexto insuficiente.'))
    })

    // Erro context_too_small deve aparecer no BannerErroCore com botão "Reduzir duração máxima"
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Janela de contexto/i)
    expect(within(alerta).getByRole('button', { name: /Reduzir duração máxima/i })).toBeInTheDocument()
    expect(
      screen.queryByText(/Configure um Perfil de Provedor para selecionar Cortes/i),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Selecionar Cortes' })).toBeDisabled()

    // Ao trocar para outra Fonte com estimativa ainda pendente, também não pisca EstadoTela sem permissão
    chamada = 0
    const outraFonte: FonteProjeto = {
      ...FONTE_DEMO,
      id: 2,
      path: '/videos/offline.mp4',
      status: 'offline',
      available: false,
    }
    rerender(envolver(<ConfiguradorSelecao fonte={outraFonte} execucaoEmAndamento={false} />))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'selection.estimate',
        expect.objectContaining({ source_id: 2 }),
      )
    })
    expect(
      screen.queryByText(/Configure um Perfil de Provedor para selecionar Cortes/i),
    ).not.toBeInTheDocument()

    await act(async () => {
      resolverEstimativa({
        paid: true,
        profile: 'legacy',
        minUs: 20_000_000,
        maxUs: 60_000_000,
        videoKind: 'direct',
        plan: { state: 'full', windows: [{ index: 0 }], contextTokens: 32768 },
        weights: PESOS_DIRETO,
        estimate: { kind: 'usd', windows: 1, inputTokens: 10_000, minMicroUsd: 1_000, maxMicroUsd: 5_000 },
      })
    })
    expect(await screen.findByRole('button', { name: 'Selecionar Cortes' })).toBeEnabled()
    void user
  })
})
