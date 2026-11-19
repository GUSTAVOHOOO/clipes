import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { Relatos } from '~/telas/relatos/Relatos'

const mockChamar = vi.fn()
const mockCopiarTexto = vi.fn()
const mockSalvarDialogo = vi.fn()
const mockAbrirUrlExterna = vi.fn()

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
    copiarTexto: (...args: unknown[]) => mockCopiarTexto(...args),
    salvarDialogo: (...args: unknown[]) => mockSalvarDialogo(...args),
    abrirUrlExterna: (...args: unknown[]) => mockAbrirUrlExterna(...args),
  }
})

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

const DIAGNOSTICO_PADRAO = [
  'Clipes: 0.1.0',
  'Sistema operacional: windows',
  'Etapa da falha: componente',
  'GPU / VRAM: NVIDIA GeForce RTX 3050 (3962/4096 MiB)',
].join('\n')

const SONDA_PADRAO = {
  key: {
    gpu: 'NVIDIA GeForce RTX 3050 Laptop GPU',
    driver: '616.92',
    ct2_version: '4.5.0',
    model: 'whisper-turbo',
    app_version: '0.1.0',
  },
  chosen: { device: 'cuda', compute_type: 'int8_float16' },
  verified: true,
  attempts: [
    { device: 'cuda', compute_type: 'int8_float16', batch_size: 1, ok: true },
    { device: 'cuda', compute_type: 'int8_float16', batch_size: 8, ok: true },
  ],
  batch: {
    compute_type: 'int8_float16',
    tested: [
      [4, true],
      [8, true],
    ],
    max_safe: 8,
    origin: 'probe',
    measured_at: 1790000000,
  },
  vram_free_mib: 3962,
  measured_at: 1790000000,
  fallback_reason: null,
}

function renderRelatos(tipoInicial?: 'bug' | 'ideia' | 'provedor') {
  return render(
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>
          <Relatos tipoInicial={tipoInicial} />
        </ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>,
  )
}

describe('Relatos (#/relatos)', () => {
  beforeEach(() => {
    mockChamar.mockReset()
    mockCopiarTexto.mockReset().mockResolvedValue(true)
    mockSalvarDialogo.mockReset().mockResolvedValue('C:\\diagnostico-clipes.txt')
    mockAbrirUrlExterna.mockReset().mockResolvedValue({ ok: true, copiado: false })
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/relatos'

    mockChamar.mockImplementation(async (cmd: string) => {
      if (cmd === 'diagnostic.get') return { text: DIAGNOSTICO_PADRAO }
      if (cmd === 'transcription.hardware.diagnostic') return SONDA_PADRAO
      if (cmd === 'diagnostic.export') return {}
      return {}
    })
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('Passo 1: padrão bug marca diagnóstico; tipoInicial="ideia" desmarca; botões de envio não existem no DOM antes de revisar', async () => {
    const user = userEvent.setup()
    renderRelatos()

    const radioBug = screen.getByRole('radio', { name: 'Relatar problema' })
    const radioIdeia = screen.getByRole('radio', { name: 'Sugerir ideia' })
    const radioProvedor = screen.getByRole('radio', { name: 'Propor Provedor ou modelo' })
    const checkDiag = screen.getByRole('checkbox', { name: /Incluir diagnóstico técnico local/i })

    expect(radioBug).toHaveAttribute('aria-checked', 'true')
    expect(checkDiag).toBeChecked()

    // ADR-0006 regra 2: botões de saída não existem no DOM antes de revisar
    expect(screen.queryByRole('button', { name: /Copiar texto/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Exportar diagnóstico/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Abrir no GitHub/i })).not.toBeInTheDocument()

    await user.click(radioIdeia)
    expect(radioIdeia).toHaveAttribute('aria-checked', 'true')
    expect(checkDiag).not.toBeChecked()

    await user.click(radioProvedor)
    expect(radioProvedor).toHaveAttribute('aria-checked', 'true')
    expect(checkDiag).not.toBeChecked()

    // Suporte a ?tipo=ideia inicial
    const { unmount } = renderRelatos('ideia')
    expect(screen.getAllByRole('radio', { name: 'Sugerir ideia' })[1]).toHaveAttribute(
      'aria-checked',
      'true',
    )
    unmount()
  })

  it('mantém Título e Descrição editáveis durante loading e exibe Esqueleto no diagnóstico', async () => {
    let resolverDiag!: (v: { text: string }) => void
    mockChamar.mockImplementation((cmd: string) => {
      if (cmd === 'diagnostic.get') {
        return new Promise((r) => {
          resolverDiag = r
        })
      }
      if (cmd === 'transcription.hardware.diagnostic') return Promise.resolve(null)
      return Promise.resolve({})
    })

    const user = userEvent.setup()
    renderRelatos()

    expect(screen.getByRole('status', { name: /Carregando diagnóstico/i })).toBeInTheDocument()
    const inputTitulo = screen.getByRole('textbox', { name: /Título/i })
    await user.type(inputTitulo, 'Erro no corte')
    expect(inputTitulo).toHaveValue('Erro no corte')

    await act(async () => {
      resolverDiag({ text: DIAGNOSTICO_PADRAO })
    })
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /Carregando diagnóstico/i })).not.toBeInTheDocument()
    })
  })

  it('detector /token|chave|\\bkey\\b/i exibe role="alert" sem roubar o foco da digitação', async () => {
    const user = userEvent.setup()
    renderRelatos()

    const textareaDesc = screen.getByRole('textbox', { name: /Descrição/i })
    await user.click(textareaDesc)
    await user.type(textareaDesc, 'Colei minha chave da api aqui')

    expect(textareaDesc).toHaveFocus()
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/chave|token|segredo/i)
    expect(textareaDesc).toHaveFocus()
  })

  it('sonda de hardware exibe null como vazia, exibe dados sem caminhos pessoais e anexa resumo ao diagnóstico', async () => {
    const user = userEvent.setup()
    mockChamar.mockImplementation(async (cmd: string) => {
      if (cmd === 'diagnostic.get') return { text: DIAGNOSTICO_PADRAO }
      if (cmd === 'transcription.hardware.diagnostic') return null
      return {}
    })

    const { unmount } = renderRelatos()
    expect(await screen.findByText('Nenhuma sonda de hardware gravada ainda.')).toBeInTheDocument()
    unmount()

    mockChamar.mockImplementation(async (cmd: string) => {
      if (cmd === 'diagnostic.get') return { text: DIAGNOSTICO_PADRAO }
      if (cmd === 'transcription.hardware.diagnostic') return SONDA_PADRAO
      return {}
    })

    renderRelatos()
    expect(await screen.findByText(/NVIDIA GeForce RTX 3050 Laptop GPU/i)).toBeInTheDocument()
    expect(screen.getByText(/3962\s*MiB/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Anexar resumo de hardware ao diagnóstico/i }))
    await user.click(screen.getByRole('button', { name: /Revisar relato antes de enviar/i }))

    const diagEditavel = screen.getByRole('textbox', { name: /Diagnóstico técnico editável/i })
    expect((diagEditavel as HTMLTextAreaElement).value).toContain('NVIDIA GeForce RTX 3050 Laptop GPU')
    expect((diagEditavel as HTMLTextAreaElement).value).toContain('cuda/int8_float16')
  })

  it('Passo 2: exibe nota sobre etapa padrão sem expor número de ticket (UI-12), envia exatamente o texto editado para diagnostic.export e copia texto', async () => {
    const user = userEvent.setup()
    renderRelatos()

    await screen.findByText(/NVIDIA GeForce RTX 3050/i)
    await user.type(screen.getByRole('textbox', { name: /Título/i }), 'Legenda falhou')
    await user.type(screen.getByRole('textbox', { name: /Descrição/i }), 'Erro ao renderizar')

    await user.click(screen.getByRole('button', { name: /Revisar relato antes de enviar/i }))

    expect(
      screen.getByText(/quando há registros locais.*Etapa da falha: componente/i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/#\d+/)
    const diagEditavel = screen.getByRole('textbox', { name: /Diagnóstico técnico editável/i })
    await user.clear(diagEditavel)
    await user.type(diagEditavel, 'Etapa da falha: exportacao\nLinha editada pelo usuario')

    await user.click(screen.getByRole('button', { name: /Exportar diagnóstico/i }))
    await waitFor(() => {
      expect(mockChamar).toHaveBeenCalledWith('diagnostic.export', {
        path: 'C:\\diagnostico-clipes.txt',
        text: 'Etapa da falha: exportacao\nLinha editada pelo usuario',
      })
    })

    await user.click(screen.getByRole('button', { name: /Copiar texto/i }))
    expect(mockCopiarTexto).toHaveBeenCalledWith(
      expect.stringContaining('Linha editada pelo usuario'),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/Texto copiado/i)
  })

  it('Passo 2: URL > 8.000 bytes copia diagnóstico e anuncia em role="status" ao Abrir no GitHub', async () => {
    const user = userEvent.setup()
    const diagGrande = 'x'.repeat(8500)
    mockChamar.mockImplementation(async (cmd: string) => {
      if (cmd === 'diagnostic.get') return { text: diagGrande }
      if (cmd === 'transcription.hardware.diagnostic') return null
      return {}
    })

    renderRelatos()
    await waitFor(() => expect(mockChamar).toHaveBeenCalledWith('diagnostic.get', {}))

    await user.type(screen.getByRole('textbox', { name: /Título/i }), 'Bug grande')
    await user.type(screen.getByRole('textbox', { name: /Descrição/i }), 'Descrição curta')
    await user.click(screen.getByRole('button', { name: /Revisar relato antes de enviar/i }))

    await user.click(screen.getByRole('button', { name: /Abrir no GitHub/i }))

    await waitFor(() => {
      expect(mockCopiarTexto).toHaveBeenCalledWith(diagGrande)
      expect(mockAbrirUrlExterna).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/GUSTAVOHOOO/clipes/issues/new'),
      )
    })
    const urlChamada = mockAbrirUrlExterna.mock.calls[0][0] as string
    expect(new TextEncoder().encode(urlChamada).length).toBeLessThanOrEqual(8000)
    expect(screen.getByRole('status')).toHaveTextContent(/Diagnóstico copiado/i)
  })

  it('traduz erros invalid_path, invalid_text, export_failed e settings em role="alert"', async () => {
    const user = userEvent.setup()
    mockChamar.mockImplementation(async (cmd: string) => {
      if (cmd === 'diagnostic.get') return { text: DIAGNOSTICO_PADRAO }
      if (cmd === 'transcription.hardware.diagnostic') {
        throw new ErroCore('settings', 'Falha ao ler settings')
      }
      if (cmd === 'diagnostic.export') {
        throw new ErroCore('invalid_path', 'Caminho inválido')
      }
      return {}
    })

    renderRelatos()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Não foi possível ler o histórico local de sonda de hardware/i,
    )

    await user.click(screen.getByRole('button', { name: /Revisar relato antes de enviar/i }))

    // invalid_path
    await user.click(screen.getByRole('button', { name: /Exportar diagnóstico/i }))
    expect((await screen.findByText(/terminado em \.txt/i)).closest('[role="alert"]')).toBeInTheDocument()

    // invalid_text
    mockChamar.mockImplementation(async (cmd: string) => {
      if (cmd === 'diagnostic.export') throw new ErroCore('invalid_text', 'Texto vazio')
      return {}
    })
    await user.click(screen.getByRole('button', { name: /Exportar diagnóstico/i }))
    expect((await screen.findByText(/não pode estar vazio/i)).closest('[role="alert"]')).toBeInTheDocument()

    // export_failed
    mockChamar.mockImplementation(async (cmd: string) => {
      if (cmd === 'diagnostic.export') throw new ErroCore('export_failed', 'Permissão negada')
      return {}
    })
    await user.click(screen.getByRole('button', { name: /Exportar diagnóstico/i }))
    expect((await screen.findByText(/não foi possível gravar/i)).closest('[role="alert"]')).toBeInTheDocument()
  })
})
