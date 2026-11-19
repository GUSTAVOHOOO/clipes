import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import { criarStoreAtualizador } from '~/stores/atualizador'
import { Sobre } from '~/telas/sobre/Sobre'

const mockChamar = vi.fn()
const mockAbrirUrlExterna = vi.fn()
const mockInvoke = vi.fn()
const mockIsTauri = vi.fn(() => false)

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => mockChamar(...args),
  }
})

vi.mock('~/core/desktop', async () => {
  const atual = await vi.importActual<typeof import('~/core/desktop')>('~/core/desktop')
  return {
    ...atual,
    abrirUrlExterna: (...args: unknown[]) => mockAbrirUrlExterna(...args),
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => mockIsTauri(),
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null
  },
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '0.1.0'),
}))

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

function renderSobre(opcoes?: {
  store?: ReturnType<typeof criarStoreAtualizador>
  fila?: ReturnType<typeof criarFila>
}) {
  return render(
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>
          <Sobre store={opcoes?.store} fila={opcoes?.fila} />
        </ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>,
  )
}

describe('Sobre (#/sobre)', () => {
  beforeEach(() => {
    mockChamar.mockReset().mockImplementation(async (cmd: string) => {
      if (cmd === 'app.version') return { version: '0.1.0' }
      return {}
    })
    mockAbrirUrlExterna.mockReset().mockResolvedValue({ ok: true, copiado: false })
    mockInvoke.mockReset().mockResolvedValue(undefined)
    mockIsTauri.mockReset().mockReturnValue(false)
    vi.unstubAllEnvs()
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/sobre'
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('loading exibe Esqueleto apenas na linha da versão mantendo licenças legíveis; falha em app.version exibe Tentar novamente', async () => {
    let resolverVersao!: (v: { version: string }) => void
    mockChamar.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolverVersao = r
        }),
    )

    const user = userEvent.setup()
    const { unmount } = renderSobre()

    // Durante loading, Esqueleto na linha da versão e licença Apache-2.0 já legível
    expect(screen.getByRole('status', { name: /Carregando versão instalada/i })).toBeInTheDocument()
    expect(screen.getByText(/Apache License/i)).toBeInTheDocument()

    await act(async () => {
      resolverVersao({ version: '0.1.0' })
    })
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()

    // Falha em app.version -> exibe erro + Tentar novamente
    unmount()
    mockChamar.mockRejectedValueOnce(new ErroCore('desconhecido', 'Falha ao ler versão'))
    mockChamar.mockResolvedValueOnce({ version: '0.1.0' })

    renderSobre()
    expect(
      await screen.findByText(/Não foi possível carregar a versão instalada/i),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it('Verificar atualizações exibe atualização disponível sem baixar automaticamente e respeita ?updater-test=invalid-signature', async () => {
    vi.stubEnv('VITE_UPDATER_MOCK', 'available')
    const user = userEvent.setup()
    const store = criarStoreAtualizador()

    renderSobre({ store })
    await screen.findByText('0.1.0')

    // Nunca inicia verificação/instalação sem clique
    expect(screen.queryByRole('button', { name: /Baixar e instalar/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Verificar atualizações' }))

    expect(await screen.findByText(/Nova versão disponível/i)).toBeInTheDocument()
    expect(screen.getByText(/Novidades de teste/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Baixar e instalar/i })).toBeInTheDocument()
    expect(sessionStorage.getItem('clipes.mock-update-installed')).toBeNull()

    // Cenário invalid-signature bloqueia instalação em role="alert"
    await user.click(screen.getByRole('button', { name: 'Lembrar depois' }))
    window.history.replaceState(null, '', '/?updater-test=invalid-signature')
    await user.click(screen.getByRole('button', { name: 'Verificar atualizações' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/assinatura digital.*falhou|bloqueada por segurança/i)
    expect(screen.queryByRole('button', { name: /Baixar e instalar/i })).not.toBeInTheDocument()
  })

  it('navigator.onLine === false mostra aviso offline neutro sem erro alarmante', async () => {
    vi.stubEnv('VITE_UPDATER_MOCK', 'available')
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const user = userEvent.setup()
    const store = criarStoreAtualizador()

    renderSobre({ store })
    await screen.findByText('0.1.0')

    await user.click(screen.getByRole('button', { name: 'Verificar atualizações' }))

    expect(
      await screen.findByText(/Você está offline\. Conecte-se à internet para verificar atualizações/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ao reiniciar após instalar com download/exportação ativa em useFila(), abre ConfirmDialog reutilizando operacoesCriticasEmVoo (#291)', async () => {
    vi.stubEnv('VITE_UPDATER_MOCK', 'available')
    const user = userEvent.setup()
    const store = criarStoreAtualizador()
    const fila = criarFila(() => 'demo')
    fila.aplicar({
      job: 'ffmpeg',
      project: null,
      stage: 'download',
      percentage: 42,
      message: 'Baixando FFmpeg',
      error: null,
    })

    renderSobre({ store, fila })
    await screen.findByText('0.1.0')

    await user.click(screen.getByRole('button', { name: 'Verificar atualizações' }))
    await user.click(await screen.findByRole('button', { name: /Baixar e instalar/i }))

    expect(
      await screen.findByText(/Atualização instalada\. Reinicie para aplicar/i),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Reiniciar para aplicar/i }))

    const dlg = await screen.findByRole('alertdialog')
    expect(dlg).toHaveTextContent(/Baixando FFmpeg/i)
    expect(dlg).toHaveTextContent(/42%/)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continuar trabalhando' })).toHaveFocus()
    })
  })

  it('abas Apache-2.0 / Atribuições alternam por setas, pre tem tabIndex=0, busca vazia mostra Limpar busca e há link para Componentes', async () => {
    const user = userEvent.setup()
    renderSobre()

    await screen.findByText('0.1.0')

    // Link para #/config/componentes (US-17)
    const linkComponentes = screen.getByRole('link', { name: /Componentes/i })
    expect(linkComponentes).toHaveAttribute('href', '#/config/componentes')

    const abaLicenca = screen.getByRole('tab', { name: /Licença do Clipes \(Apache-2\.0\)/i })
    const abaAtribuicoes = screen.getByRole('tab', { name: /Atribuições de terceiros/i })
    expect(abaLicenca).toHaveAttribute('aria-selected', 'true')

    const pre = screen.getByLabelText(/Texto integral da licença Apache-2\.0/i)
    expect(pre.tagName).toBe('PRE')
    expect(pre).toHaveAttribute('tabindex', '0')

    // Alterna por seta direita + Enter (padrão manual activation do @ds Abas)
    abaLicenca.focus()
    await user.keyboard('{ArrowRight}')
    expect(abaAtribuicoes).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(abaAtribuicoes).toHaveAttribute('aria-selected', 'true')
    })

    const preAtrib = screen.getByLabelText(/Atribuições de terceiros/i)
    expect(preAtrib.tagName).toBe('PRE')
    expect(preAtrib).toHaveAttribute('tabindex', '0')

    // Busca sem match exibe estado vazio com "Limpar busca"
    const busca = screen.getByRole('searchbox', { name: /Buscar biblioteca ou componente/i })
    await user.type(busca, 'biblioteca-inexistente-xyz')

    expect(
      await screen.findByText(/Nenhuma atribuição encontrada para "biblioteca-inexistente-xyz"\./i),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(busca).toHaveValue('')
    expect(screen.getByLabelText(/Atribuições de terceiros/i)).toBeInTheDocument()
  })

  it('UI-122: formata a data da atualização disponível em PT-BR em vez do ISO bruto', async () => {
    vi.stubEnv('VITE_UPDATER_MOCK', 'available')
    const user = userEvent.setup()
    const store = criarStoreAtualizador()

    renderSobre({ store })
    await screen.findByText('0.1.0')

    await user.click(screen.getByRole('button', { name: 'Verificar atualizações' }))
    expect(await screen.findByText(/Nova versão disponível/i)).toBeInTheDocument()

    expect(screen.queryByText('2026-11-13T00:00:00Z')).not.toBeInTheDocument()
    expect(screen.getByText('13/11/2026')).toBeInTheDocument()
  })
})
