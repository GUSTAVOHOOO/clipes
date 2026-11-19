import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleAoVivo } from '~/componentes/ConsoleAoVivo'
import { criarStoreConsole, type EventoConsole } from '~/core/console'

const mockCopiarTexto = vi.fn(async (_texto: string) => true)

vi.mock('~/core/desktop', () => ({
  copiarTexto: (...args: unknown[]) => mockCopiarTexto(...(args as [string])),
}))

function envolver(ui: ReactElement) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{ui}</ProvedorToast>
    </ProvedorDicas>
  )
}

function ev(parcial: Partial<EventoConsole> = {}): EventoConsole {
  return {
    seq: 1,
    timestampMs: new Date(2026, 10, 19, 10, 20, 30).getTime(),
    job: 'worker',
    project: null,
    origin: 'uv',
    level: 'info',
    simple: 'Baixando dependências…',
    technical: 'uv: Downloading cpython-3.12.7',
    ...parcial,
  }
}

describe('<ConsoleAoVivo> (Variante C — terminal com abas)', () => {
  beforeEach(() => {
    mockCopiarTexto.mockClear()
  })

  it('exibe abas por origem com contadores e filtra linhas por aba', async () => {
    const user = userEvent.setup()
    const store = criarStoreConsole({ projetoAtual: () => null, throttleMs: 0 })
    store.aplicarLote([
      ev({ seq: 1, job: 'ffmpeg', origin: 'component', simple: 'Baixando FFmpeg', technical: 'GET ffmpeg.zip' }),
      ev({ seq: 2, job: 'worker', origin: 'uv', simple: 'Instalando pacotes Python', technical: 'uv: Resolved 42 packages' }),
      ev({ seq: 3, job: 'worker', origin: 'worker', simple: 'Worker respondeu', technical: 'handshake ok' }),
    ])

    render(envolver(<ConsoleAoVivo store={store} />))

    const tablist = screen.getByRole('tablist', { name: /Origem/i })
    expect(tablist).toBeInTheDocument()

    expect(screen.getByRole('tab', { name: /Tudo/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Componentes/i })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /^uv/i })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /Worker/i })).toHaveTextContent('1')

    expect(screen.getByText('Baixando FFmpeg')).toBeInTheDocument()
    expect(screen.getByText('Instalando pacotes Python')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^uv/i }))
    expect(screen.queryByText('Baixando FFmpeg')).not.toBeInTheDocument()
    expect(screen.getByText('Instalando pacotes Python')).toBeInTheDocument()
  })

  it('alterna entre modo Simples e Técnico e copia/limpa o registro visível', async () => {
    const user = userEvent.setup()
    const store = criarStoreConsole({ projetoAtual: () => null, throttleMs: 0 })
    store.aplicarLote([
      ev({ seq: 1, origin: 'ffmpeg', job: 'export-3', simple: 'Exportando 48%', technical: 'frame=1240 speed=2.4x' }),
    ])

    render(envolver(<ConsoleAoVivo store={store} />))

    const btnSimples = screen.getByRole('button', { name: 'Simples' })
    const btnTecnico = screen.getByRole('button', { name: 'Técnico' })
    const log = screen.getByRole('log')
    expect(btnSimples).toHaveAttribute('aria-pressed', 'true')
    expect(btnTecnico).toHaveAttribute('aria-pressed', 'false')
    expect(within(log).getByText('Exportando 48%')).toBeInTheDocument()
    expect(within(log).queryByText('frame=1240 speed=2.4x')).not.toBeInTheDocument()

    await user.click(btnTecnico)
    expect(btnTecnico).toHaveAttribute('aria-pressed', 'true')
    expect(within(log).getByText('frame=1240 speed=2.4x')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(mockCopiarTexto).toHaveBeenCalledTimes(1)
    expect(mockCopiarTexto.mock.calls[0][0]).toContain('frame=1240 speed=2.4x')
    expect(screen.getAllByText('Console copiado.').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(store.linhas()).toHaveLength(0)
    expect(screen.getByText(/Nada rodando agora/i)).toBeInTheDocument()
  })

  it('pausa rolagem automática ao rolar para cima e retoma ao clicar em "Retomar rolagem"', async () => {
    const user = userEvent.setup()
    const store = criarStoreConsole({ projetoAtual: () => null, throttleMs: 0 })
    store.aplicarLote([
      ev({ seq: 1, simple: 'Linha 1' }),
      ev({ seq: 2, simple: 'Linha 2' }),
    ])

    render(envolver(<ConsoleAoVivo store={store} />))

    const log = screen.getByRole('log', { name: /Registro de atividade ao vivo/i })
    expect(log).toHaveAttribute('aria-live', 'off')
    expect(screen.queryByRole('button', { name: 'Retomar rolagem' })).not.toBeInTheDocument()

    Object.defineProperty(log, 'scrollHeight', { value: 600, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(log, 'scrollTop', { value: 50, writable: true, configurable: true })

    fireEvent.scroll(log)
    const btnRetomar = screen.getByRole('button', { name: 'Retomar rolagem' })
    expect(btnRetomar).toBeInTheDocument()

    await user.click(btnRetomar)
    expect(screen.queryByRole('button', { name: 'Retomar rolagem' })).not.toBeInTheDocument()
  })

  it('usa role="log" com aria-live="off" e anuncia apenas marcos espaçados em role="status"', () => {
    const store = criarStoreConsole({ projetoAtual: () => null, throttleMs: 0 })
    render(envolver(<ConsoleAoVivo store={store} />))

    const log = screen.getByRole('log')
    expect(log).toHaveAttribute('aria-live', 'off')

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')

    act(() => {
      store.aplicar(ev({ seq: 1, job: 'ffmpeg', origin: 'component', simple: 'Baixando FFmpeg (82 MB)…' }))
    })
    expect(status).toHaveTextContent('Baixando FFmpeg (82 MB)…')

    act(() => {
      store.aplicar(ev({ seq: 2, job: 'ffmpeg', origin: 'component', simple: 'Baixando FFmpeg · 35%' }))
    })
    expect(status).not.toHaveTextContent('35%')

    act(() => {
      store.aplicar(ev({ seq: 3, job: 'ffmpeg', origin: 'component', level: 'error', simple: 'Falha de rede ao baixar FFmpeg.' }))
    })
    expect(status).toHaveTextContent('Falha de rede ao baixar FFmpeg.')
  })

  it('suporta modo recolhível com aria-expanded e aria-controls e nunca exibe #NNN', async () => {
    const user = userEvent.setup()
    const store = criarStoreConsole({ projetoAtual: () => null, throttleMs: 0 })
    store.aplicar(ev({ seq: 1, job: '42', origin: 'ffmpeg', simple: 'Exportando Corte' }))

    render(
      envolver(
        <ConsoleAoVivo
          store={store}
          recolhivel
          titulo="Console de instalação e verificação"
        />,
      ),
    )

    const toggle = screen.getByRole('button', { name: /Console de instalação e verificação/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/#\d+/)

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('log')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/#\d+/)
  })
})
