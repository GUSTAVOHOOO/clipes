import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import type { CapaDoc, ProxyDoc, useEmpacotarCorte } from '~/stores/empacotarCorte'
import { PainelCapa } from '~/telas/corte/empacotar/PainelCapa'

const chamarMock = vi.fn()
const saveDialogMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return { ...atual, chamar: (...args: unknown[]) => chamarMock(...args) }
})

vi.mock('~/telas/corte/empacotar/dialogosNativos', () => ({
  salvarArquivo: (...args: unknown[]) => saveDialogMock(...args),
  copiarTexto: vi.fn(),
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []
})

type StoreEmpacotar = ReturnType<typeof useEmpacotarCorte>

const CORTE = { startUs: 60_000_000, endUs: 108_000_000 }

type CapaCompleta = CapaDoc & {
  cut: { startUs: number; endUs: number }
  suggestions: Array<{ id: number; instantUs: number; why: string }>
  choices: Array<{ id: number; instantUs: number; origin: 'ai' | 'user' }>
  maxWhyChars: number
}

function criarCapa(parcial?: Partial<CapaCompleta>): CapaCompleta {
  return {
    current: null,
    history: [],
    job: null,
    cut: CORTE,
    suggestions: [],
    choices: [],
    maxWhyChars: 200,
    ...parcial,
  }
}

function criarStoreFake(overrides?: Partial<StoreEmpacotar>): StoreEmpacotar {
  const proxy: ProxyDoc = { job: null, state: 'ready', progress: 100, proxyPath: null }
  return {
    candidateId: 201,
    carregando: false,
    erro: null,
    capa: criarCapa() as CapaDoc,
    empacotamento: null,
    guardrails: null,
    proxy: { ...proxy, key: 'abc123' } as ProxyDoc,
    perfis: [],
    tarefas: null,
    orcamento: { limitMicroUsd: 1_000_000, spentMicroUsd: 0, remainingMicroUsd: 1_000_000, callsRemaining: 10, paused: false },
    rascunho: null,
    sujo: false,
    conflitoRemoto: false,
    remotoPendente: null,
    bytesDescricao: 0,
    editarRascunho: vi.fn(),
    marcarSalvo: vi.fn(),
    aceitarRemoto: vi.fn(),
    manterRascunho: vi.fn(),
    recarregarCapa: vi.fn().mockResolvedValue(undefined),
    recarregarEmpacotamento: vi.fn().mockResolvedValue(undefined),
    recarregarGuardrails: vi.fn().mockResolvedValue(undefined),
    resolverDestino: () => ({
      perfil: { id: 'openai-gpt4o', label: 'OpenAI GPT-4o', kind: 'api', model: 'gpt-4o' },
      localidade: 'remoto',
      saiDaMaquina: true,
      host: 'api.openai.com',
      bloqueadoSomenteLocal: false,
    }),
    ...overrides,
  } as StoreEmpacotar
}

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

function renderizar(store: StoreEmpacotar, disponivel = true) {
  const aoRelocalizarFonte = vi.fn()
  const utils = render(
    envolver(
      <PainelCapa
        candidateId={201}
        corteId="cand-201"
        store={store}
        fonte={{ id: 4, disponivel, startUs: CORTE.startUs, endUs: CORTE.endUs }}
        aoRelocalizarFonte={aoRelocalizarFonte}
      />,
    ),
  )
  return { ...utils, aoRelocalizarFonte }
}

describe('<PainelCapa>', () => {
  afterEach(() => {
    chamarMock.mockReset()
    saveDialogMock.mockReset()
  })

  it('estado vazio exibe mensagem e desabilita "Salvar capa (PNG)"', () => {
    renderizar(criarStoreFake())
    expect(screen.getByText('Nenhum momento de capa escolhido ainda.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar capa (PNG)' })).toBeDisabled()
  })

  it('scrubber role="slider" limitado a [startUs, endUs] e passos -1 s / +1 s atualizam o instante', async () => {
    const user = userEvent.setup()
    renderizar(criarStoreFake())
    const slider = screen.getByRole('slider', { name: 'Instante da capa' })
    expect(slider).toHaveAttribute('aria-valuemin', String(CORTE.startUs / 1_000))
    expect(slider).toHaveAttribute('aria-valuemax', String(CORTE.endUs / 1_000))
    expect(slider).toHaveAttribute('aria-valuenow', String(CORTE.startUs / 1_000))
    expect(slider.getAttribute('aria-valuetext')).toContain('de')

    await user.click(screen.getByRole('button', { name: '+1 s' }))
    expect(screen.getByRole('slider', { name: 'Instante da capa' })).toHaveAttribute(
      'aria-valuenow',
      String((CORTE.startUs + 1_000_000) / 1_000),
    )
    // não passa do início do Corte
    await user.click(screen.getByRole('button', { name: '-1 s' }))
    await user.click(screen.getByRole('button', { name: '-1 s' }))
    expect(screen.getByRole('slider', { name: 'Instante da capa' })).toHaveAttribute(
      'aria-valuenow',
      String(CORTE.startUs / 1_000),
    )
  })

  it('"Sugerir momento da capa" pago abre <ConfirmDialog> com <ResumoCustoPrivacidade> antes de thumbnail.suggest { confirmed: true }', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'thumbnail.estimate') {
        return {
          paid: true,
          profile: 'openai-gpt4o',
          estimate: { kind: 'usd', minMicroUsd: 300, maxMicroUsd: 1200 },
        }
      }
      if (cmd === 'thumbnail.suggest') return { job: 5 }
      return undefined
    })
    renderizar(criarStoreFake())

    await user.click(screen.getByRole('button', { name: 'Sugerir momento da capa' }))
    const dialogo = await screen.findByRole('alertdialog')
    expect(within(dialogo).getByLabelText(/Resumo de custo e privacidade/)).toBeInTheDocument()
    expect(chamarMock).not.toHaveBeenCalledWith('thumbnail.suggest', expect.anything())
    await waitFor(() =>
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus(),
    )

    await user.click(within(dialogo).getByRole('button', { name: /Confirmar e sugerir/ }))
    await waitFor(() =>
      expect(chamarMock).toHaveBeenCalledWith('thumbnail.suggest', {
        candidate: 201,
        confirmed: true,
      }),
    )
  })

  it('"Usar quadro atual como capa" chama thumbnail.choose e atualiza o selo para "Escolhido por você"', async () => {
    const user = userEvent.setup()
    const store = criarStoreFake()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'thumbnail.choose') {
        return criarCapa({
          current: { instantUs: CORTE.startUs + 1_000_000, origin: 'user' },
        })
      }
      return undefined
    })
    const { rerender } = renderizar(store)
    await user.click(screen.getByRole('button', { name: '+1 s' }))
    await user.click(screen.getByRole('button', { name: 'Usar quadro atual como capa' }))
    await waitFor(() =>
      expect(chamarMock).toHaveBeenCalledWith('thumbnail.choose', {
        candidate: 201,
        instant_us: CORTE.startUs + 1_000_000,
      }),
    )
    await waitFor(() => expect(store.recarregarCapa).toHaveBeenCalled())

    const storeAtualizado = criarStoreFake({
      capa: criarCapa({
        current: { instantUs: CORTE.startUs + 1_000_000, origin: 'user' },
      }) as CapaDoc,
    })
    rerender(
      envolver(
        <PainelCapa
          candidateId={201}
          corteId="cand-201"
          store={storeAtualizado}
          fonte={{ id: 4, disponivel: true, startUs: CORTE.startUs, endUs: CORTE.endUs }}
          aoRelocalizarFonte={vi.fn()}
        />,
      ),
    )
    expect(screen.getByText('Escolhido por você')).toBeInTheDocument()
    // quadro já é a capa atual: não repete
    expect(screen.getByRole('button', { name: 'Usar quadro atual como capa' })).toBeDisabled()
  })

  it('"Salvar capa (PNG)" chama thumbnail.export e exibe toast "Capa salva"', async () => {
    const user = userEvent.setup()
    saveDialogMock.mockResolvedValue('/tmp/capa-cand-201.png')
    chamarMock.mockImplementation(async (cmd: string) =>
      cmd === 'thumbnail.export' ? { output: '/tmp/capa-cand-201.png', instantUs: CORTE.startUs } : undefined,
    )
    renderizar(
      criarStoreFake({
        capa: criarCapa({ current: { instantUs: CORTE.startUs, origin: 'ai' } }) as CapaDoc,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Salvar capa (PNG)' }))
    await waitFor(() =>
      expect(chamarMock).toHaveBeenCalledWith('thumbnail.export', {
        candidate: 201,
        output: '/tmp/capa-cand-201.png',
        instant_us: CORTE.startUs,
      }),
    )
    expect(await screen.findByText('Capa salva')).toBeInTheDocument()
  })

  it('erro thumbnail_exists exibe alerta acionável', async () => {
    const user = userEvent.setup()
    saveDialogMock.mockResolvedValue('/tmp/existente.png')
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'thumbnail.export') {
        throw new ErroCore('thumbnail_exists', 'Já existe um arquivo no destino.')
      }
      return undefined
    })
    renderizar(
      criarStoreFake({
        capa: criarCapa({ current: { instantUs: CORTE.startUs, origin: 'ai' } }) as CapaDoc,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Salvar capa (PNG)' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Já existe um arquivo/)
    expect(within(alerta).getByRole('button', { name: 'Escolher outro nome' })).toBeInTheDocument()
  })

  it('com Fonte offline bloqueia preview e botões de exportar/usar quadro mantendo histórico legível', async () => {
    const user = userEvent.setup()
    const { aoRelocalizarFonte } = renderizar(
      criarStoreFake({
        capa: criarCapa({
          current: { instantUs: CORTE.startUs, origin: 'ai' },
          suggestions: [{ id: 1, instantUs: CORTE.startUs + 5_000_000, why: 'Reação' }],
          choices: [{ id: 1, instantUs: CORTE.startUs, origin: 'ai' }],
        }) as CapaDoc,
      }),
      false,
    )
    expect(screen.getAllByText(/Fonte offline/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Salvar capa (PNG)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Usar quadro atual como capa' })).toBeDisabled()
    expect(screen.queryByRole('img', { name: 'Quadro do Corte' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Relocalizar Fonte' }))
    expect(aoRelocalizarFonte).toHaveBeenCalled()

    await user.click(screen.getByText(/Histórico de sugestões/))
    expect(screen.getAllByRole('button', { name: 'Ver quadro' }).length).toBeGreaterThan(0)
  })

  it('UI-104 / UI-105: proxy em andamento exibe "Preparando quadro…" em vez de Fonte ausente, e cartão da capa usa "Duração do Corte:"', () => {
    renderizar(
      criarStoreFake({
        proxy: { job: 7, state: 'running', progress: 40, proxyPath: null } as ProxyDoc,
        capa: criarCapa({
          current: { instantUs: CORTE.startUs + 5_000_000, origin: 'ai' },
        }) as CapaDoc,
      }),
    )

    expect(screen.queryByText(/A Fonte não está no lugar de antes/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Preparando quadro/i)).toBeInTheDocument()

    expect(screen.queryByText(/^de 48 s$/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Duração do Corte: 48 s/i)).toBeInTheDocument()
  })
})
