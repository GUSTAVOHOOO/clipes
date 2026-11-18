import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import type { FonteProjeto, TranscriptStatusFonte } from '~/stores/fontesProjeto'
import { PainelMotorSinais } from '~/telas/fontes/PainelMotorSinais'

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

const FONTE_DISPONIVEL: FonteProjeto = {
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

const FONTE_OFFLINE: FonteProjeto = {
  ...FONTE_DISPONIVEL,
  id: 2,
  path: '/videos/offline.mp4',
  status: 'offline',
  available: false,
  verified: false,
  origin_url: null,
}

function mockBase(overrides: Partial<Record<string, (args: unknown) => unknown>> = {}) {
  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    if (Object.hasOwn(overrides, cmd)) {
      return overrides[cmd]!(args)
    }
    switch (cmd) {
      case 'transcription.hardware.status':
        return {
          gpu: { name: 'NVIDIA GeForce RTX 3050', driver: '616.92', total_mib: 4096, free_mib: 3962 },
          ram: { total: 16 * 1024 ** 3, available: 9 * 1024 ** 3 },
          cuda: true,
          no_compatible_gpu: false,
          effective: { model: 'whisper-turbo', device: 'cuda', compute_type: 'int8_float16' },
          manual: false,
          fallback_reason: null,
          probe: null,
          options: [],
          worker_installed: true,
        }
      case 'transcription.grouping':
        return { enabled: false, mode: 'auto', size: 1, measured_size: null }
      case 'transcription.groq.info':
        return {
          endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
          model: 'whisper-large-v3-turbo',
          configured: true,
          confirmed: false,
          local_only: false,
          prices: {
            minimum_seconds: 10,
            models: { 'whisper-large-v3-turbo': { hourly_usd: 0.04 } },
          },
        }
      case 'transcription.groq.estimate':
        return {
          kind: 'usd',
          usd: 0.04,
          minMicroUsd: 35000,
          maxMicroUsd: 55000,
          audio_us: 3_600_000_000,
          hourly_usd: 0.04,
        }
      case 'transcription.blocks':
        return []
      case 'energy.status':
        return { measured: false, marks: { high: 0, peak: 0 }, job: null }
      case 'chat.status':
        return { state: 'none', canFetch: true, intervals: 0, messages: 0, peaks: 0, job: null }
      default:
        return null
    }
  })
}

describe('<PainelMotorSinais>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('exibe Local US$ 0,00 sem vazar int8_float16/handshake fora de <details>, mede amostra 30 s e permite cancelar com components.cancel', async () => {
    const user = userEvent.setup()
    let resolverEstimativa!: (v: unknown) => void
    mockBase({
      'transcription.estimate': () =>
        new Promise((res) => {
          resolverEstimativa = res
        }),
    })

    const { container } = render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_DISPONIVEL}
          transcriptStatus={{ language: 'pt', transcript: null, job: null }}
          aoAtualizarStatus={vi.fn(async () => {})}
        />,
      ),
    )

    expect(await screen.findByText(/Local — US\$ 0,00/i)).toBeInTheDocument()
    expect(screen.getByText(/Placa de vídeo NVIDIA detectada/i)).toBeInTheDocument()

    // int8_float16 / handshake nunca visíveis fora de <details>
    const details = container.querySelector('details')
    expect(details).toBeTruthy()
    expect(details?.hasAttribute('open')).toBe(false)
    const cloneSemDetails = container.cloneNode(true) as HTMLElement
    cloneSemDetails.querySelectorAll('details').forEach((d) => d.remove())
    expect(cloneSemDetails.textContent).not.toMatch(/int8_float16|handshake/i)

    // Medir amostra 30 s e cancelar via components.cancel
    await user.click(screen.getByRole('button', { name: /Medir amostra 30 s/i }))
    expect(chamarMock).toHaveBeenCalledWith('transcription.estimate', {
      project: '/projetos/Demo.clipes',
      source_id: 4,
      remeasure: false,
    })

    const btnCancelar = await screen.findByRole('button', { name: /Cancelar amostra/i })
    await user.click(btnCancelar)
    expect(chamarMock).toHaveBeenCalledWith('components.cancel', { id: 'transcription-estimate' })

    resolverEstimativa({
      model: 'whisper-turbo',
      device: 'cuda',
      compute_type: 'int8_float16',
      load_s: 5,
      rate: 0.386,
      estimate_s: 720,
      low_s: 540,
      high_s: 900,
      sample_start_us: 9e9,
      sample_us: 30e6,
      cached: false,
      measured_at: 1790000000,
      cpu: false,
      warnings: ['low_ram'],
    })

    expect(await screen.findByText(/Memória RAM baixa para este modelo/i)).toBeInTheDocument()
  })

  it('exibe aviso obrigatório do agrupamento VAD #279 e sincroniza transcription.grouping', async () => {
    const user = userEvent.setup()
    let modoAtual: 'auto' | 'manual' = 'auto'
    let enabledAtual = false
    mockBase({
      'transcription.grouping': (args) => {
        const a = args as { auto?: boolean; enabled?: boolean }
        if (a.auto === true) {
          modoAtual = 'auto'
          enabledAtual = false
        } else if (typeof a.enabled === 'boolean') {
          modoAtual = 'manual'
          enabledAtual = a.enabled
        }
        return {
          enabled: enabledAtual,
          mode: modoAtual,
          size: enabledAtual ? 8 : 1,
          measured_size: null,
        }
      },
    })

    render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_DISPONIVEL}
          transcriptStatus={{ language: 'pt', transcript: null, job: null }}
          aoAtualizarStatus={vi.fn(async () => {})}
        />,
      ),
    )

    expect(
      await screen.findByText(/ligado na CPU \(acelera em ~18%\) e desligado na GPU \(evita gastar ~1 GB extra de VRAM/i),
    ).toBeVisible()

    await user.click(screen.getByRole('radio', { name: /^Manual/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.grouping', { enabled: false })
    })

    await user.click(
      screen.getByRole('checkbox', { name: /Agrupar trechos consecutivos antes de transcrever/i }),
    )
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.grouping', { enabled: true })
    })
  })

  it('Groq exibe <ResumoCustoPrivacidade> e bloqueia disparo quando Somente local está ativo', async () => {
    const user = userEvent.setup()
    mockBase({
      'transcription.groq.info': () => ({
        endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        model: 'whisper-large-v3-turbo',
        configured: true,
        confirmed: false,
        local_only: true,
        prices: {
          minimum_seconds: 10,
          models: { 'whisper-large-v3-turbo': { hourly_usd: 0.04 } },
        },
      }),
    })

    render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_DISPONIVEL}
          transcriptStatus={{ language: 'pt', transcript: null, job: null }}
          localOnly
          aoAtualizarStatus={vi.fn(async () => {})}
        />,
      ),
    )

    await user.click(await screen.findByRole('radio', { name: /Groq remoto/i }))

    const resumo = await screen.findByRole('region', {
      name: /Resumo de custo e privacidade: Transcrição Groq/i,
    })
    expect(within(resumo).getByText(/api\.groq\.com/i)).toBeInTheDocument()
    expect(within(resumo).getByText(/whisper-large-v3-turbo/i)).toBeInTheDocument()
    expect(screen.getByText(/Indisponível no modo Somente local/i)).toBeInTheDocument()

    const btnIniciar = screen.getByRole('button', { name: /Iniciar transcrição/i })
    expect(btnIniciar).toBeDisabled()
  })

  it('intercepta engine_change_confirmation com <ConfirmDialog> antes de reenviar replace_confirmed: true', async () => {
    const user = userEvent.setup()
    const aoAtualizarStatus = vi.fn(async () => {})
    let tentativas = 0
    mockBase({
      'transcription.groq.info': () => ({
        endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        model: 'whisper-large-v3-turbo',
        configured: true,
        confirmed: true,
        local_only: false,
        prices: {
          minimum_seconds: 10,
          models: { 'whisper-large-v3-turbo': { hourly_usd: 0.04 } },
        },
      }),
      'transcription.start': (args) => {
        tentativas += 1
        const a = args as { replace_confirmed?: boolean }
        if (!a.replace_confirmed) {
          throw new ErroCore('engine_change_confirmation', 'Confirme troca de motor', {
            blocks: 2,
            paid_audio_us: 600_000_000,
            paid_usd: 0.01,
          })
        }
        return { transcript_id: 4, state: 'running', job_id: 99, warnings: [] }
      },
    })

    const parcial: TranscriptStatusFonte = {
      language: 'pt',
      transcript: {
        id: 4,
        state: 'running',
        resume_us: 1_200_000_000,
        duration_us: 3_600_000_000,
        model: 'whisper-turbo',
        engine: 'local',
        words: 0,
      },
      job: null,
    }

    render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_DISPONIVEL}
          transcriptStatus={parcial}
          aoAtualizarStatus={aoAtualizarStatus}
        />,
      ),
    )

    await user.click(await screen.findByRole('radio', { name: /Groq remoto/i }))
    await user.click(screen.getByRole('button', { name: /Retomar de 00:20:00/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/2 bloco/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/10 min/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/US\$\s*0,01/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Trocar Motor/i }))

    await waitFor(() => {
      expect(tentativas).toBe(2)
      expect(chamarMock).toHaveBeenCalledWith(
        'transcription.start',
        expect.objectContaining({
          project: '/projetos/Demo.clipes',
          source_id: 4,
          engine: 'groq',
          replace_confirmed: true,
        }),
      )
      expect(aoAtualizarStatus).toHaveBeenCalled()
    })
  })

  it('exibe blocos de 10 min (#307 total no cliente), reage a gpu_probe_fallback e cancela via jobs.cancel', async () => {
    const user = userEvent.setup()
    const aoAtualizarStatus = vi.fn(async () => {})
    mockBase({
      'transcription.blocks': () => [
        { start_us: 0, end_us: 600_000_000, device: 'cuda', compute_type: 'int8_float16' },
        { start_us: 600_000_000, end_us: 1_200_000_000, device: 'cpu', compute_type: 'int8' },
      ],
    })

    const rodando: TranscriptStatusFonte = {
      language: 'pt',
      transcript: {
        id: 4,
        state: 'running',
        resume_us: 1_200_000_000,
        duration_us: 3_600_000_000,
        model: 'whisper-turbo',
        engine: 'local',
        words: 0,
      },
      job: { id: 99, state: 'running', progress: 35, code: null },
    }

    render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_DISPONIVEL}
          transcriptStatus={rodando}
          aoAtualizarStatus={aoAtualizarStatus}
        />,
      ),
    )

    // Total previsto no cliente: 3600s / 600s = 6 blocos
    expect(await screen.findByText(/2 \/ 6 blocos/i)).toBeInTheDocument()
    expect(screen.getByText(/00:00:00–00:10:00/i)).toBeInTheDocument()
    expect(screen.getByText(/00:10:00–00:20:00/i)).toBeInTheDocument()

    // Evento gpu_probe_fallback exibe aviso persistente e recarrega hardware
    const callsHwAntes = chamarMock.mock.calls.filter(
      ([cmd]) => cmd === 'transcription.hardware.status',
    ).length

    act(() => {
      filaTeste.aplicar({
        job: '99',
        project: 'demo',
        stage: 'gpu_probe_fallback',
        percentage: 0,
        message: 'Fallback para CPU',
        error: null,
      })
    })

    expect(
      await screen.findByText(/A verificação da GPU falhou; continuando na CPU\./i),
    ).toBeInTheDocument()
    await waitFor(() => {
      const callsHwDepois = chamarMock.mock.calls.filter(
        ([cmd]) => cmd === 'transcription.hardware.status',
      ).length
      expect(callsHwDepois).toBeGreaterThan(callsHwAntes)
    })

    await user.click(screen.getByRole('button', { name: /Pausar \/ Cancelar mantendo blocos salvos/i }))
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 99 })
    await waitFor(() => expect(aoAtualizarStatus).toHaveBeenCalled())
  })

  it('dispara energy.start e chat.fetch quando elegíveis e bloqueia quando Fonte está offline', async () => {
    const user = userEvent.setup()
    mockBase()

    const pronta: TranscriptStatusFonte = {
      language: 'pt',
      transcript: {
        id: 4,
        state: 'complete',
        resume_us: 3_600_000_000,
        duration_us: 3_600_000_000,
        model: 'whisper-turbo',
        engine: 'local',
        words: 30000,
      },
      job: null,
    }

    const rDisp = render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_DISPONIVEL}
          transcriptStatus={pronta}
          aoAtualizarStatus={vi.fn(async () => {})}
        />,
      ),
    )

    const btnEnergia = await screen.findByRole('button', { name: /Medir energia agora/i })
    const btnChat = screen.getByRole('button', { name: /Buscar chat da live/i })

    await user.click(btnEnergia)
    expect(chamarMock).toHaveBeenCalledWith('energy.start', { source_id: 4 })

    await user.click(btnChat)
    expect(chamarMock).toHaveBeenCalledWith('chat.fetch', { source_id: 4 })

    rDisp.unmount()

    // Fonte offline sem origin_url: energia bloqueada e chat indica URL do YouTube
    mockBase({
      'chat.status': () => ({
        state: 'none',
        canFetch: false,
        intervals: 0,
        messages: 0,
        peaks: 0,
        job: null,
      }),
    })

    render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_OFFLINE}
          transcriptStatus={pronta}
          aoAtualizarStatus={vi.fn(async () => {})}
        />,
      ),
    )

    expect(
      await screen.findByText(/Disponível apenas para lives importadas por URL do YouTube\./i),
    ).toBeInTheDocument()
    const btnEnergiaOffline = screen.queryByRole('button', { name: /Medir energia agora/i })
    if (btnEnergiaOffline) {
      expect(btnEnergiaOffline).toBeDisabled()
    }
    expect(screen.queryByRole('button', { name: /Buscar chat da live/i })).not.toBeInTheDocument()
  })

  it('preserva usage ao normalizar objeto bruto { code, message, usage } em troca de motor', async () => {
    const user = userEvent.setup()
    mockBase({
      'transcription.groq.info': () => ({
        endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        model: 'whisper-large-v3-turbo',
        configured: true,
        confirmed: true,
        local_only: false,
        prices: {
          minimum_seconds: 10,
          models: { 'whisper-large-v3-turbo': { hourly_usd: 0.04 } },
        },
      }),
      'transcription.start': () => {
        throw {
          code: 'engine_change_confirmation',
          message: 'Confirme troca de motor',
          usage: {
            blocks: 3,
            paid_audio_us: 900_000_000,
            paid_usd: 0.02,
          },
        }
      },
    })

    const parcial: TranscriptStatusFonte = {
      language: 'pt',
      transcript: {
        id: 4,
        state: 'running',
        resume_us: 1_200_000_000,
        duration_us: 3_600_000_000,
        model: 'whisper-turbo',
        engine: 'local',
        words: 0,
      },
      job: null,
    }

    render(
      envolver(
        <PainelMotorSinais
          projetoPath="/projetos/Demo.clipes"
          fonte={FONTE_DISPONIVEL}
          transcriptStatus={parcial}
          aoAtualizarStatus={vi.fn(async () => {})}
        />,
      ),
    )

    await user.click(await screen.findByRole('radio', { name: /Groq remoto/i }))
    await user.click(screen.getByRole('button', { name: /Retomar de 00:20:00/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/3 bloco/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/15 min/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/US\$\s*0,02/i)).toBeInTheDocument()
  })
})
