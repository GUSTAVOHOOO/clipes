import { coreDispatch } from '@core'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import type { Fila } from '~/core/progresso'
import { criarFila } from '~/core/progresso'
import { ConfigComponentes } from '~/telas/config/ConfigComponentes'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => null)

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

afterEach(() => {
  vi.unstubAllEnvs()
  chamarMock.mockReset()
  filaTeste = criarFila(() => null)
  window.location.hash = '#/config/componentes'
})

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{ui}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

const MANIFESTO_COMPLETO = [
  {
    id: 'ffmpeg',
    version: '7.1',
    size: 150_000_000,
    license: 'GPL-3.0-or-later',
    source_url: 'https://github.com/FFmpeg/FFmpeg',
  },
  {
    id: 'yt-dlp',
    version: '2026.11.01',
    size: 12_000_000,
    license: 'Unlicense',
    source_url: 'https://github.com/yt-dlp/yt-dlp',
  },
  {
    id: 'deno',
    version: '2.9.8',
    size: 42_917_472,
    license: 'MIT',
    source_url: 'https://github.com/denoland/deno',
  },
  {
    id: 'pocket-tts',
    version: '3.3.0',
    size: 7_914_990,
    license: 'MIT',
    source_url: 'https://github.com/kyutai-labs/pocket-tts',
  },
  {
    id: 'uv',
    version: '0.13.8',
    size: 15_000_000,
    license: 'Apache-2.0',
    source_url: 'https://github.com/astral-sh/uv',
  },
]

const MODELOS_PADRAO = [
  {
    id: 'whisper-turbo',
    label: 'Whisper large-v3-turbo (GPU NVIDIA)',
    repo: 'dropbox-dash/faster-whisper-large-v3-turbo',
    revision: 'rev1',
    license: 'MIT',
    source_url: 'https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo',
    size: 1_621_666_000,
    installed: true,
    update_available: false,
    worker_installed: true,
    recommended: true,
  },
  {
    id: 'whisper-small',
    label: 'Whisper small (CPU)',
    repo: 'Systran/faster-whisper-small',
    revision: 'rev1',
    license: 'MIT',
    source_url: 'https://huggingface.co/Systran/faster-whisper-small',
    size: 486_212_372,
    installed: false,
    update_available: false,
    worker_installed: true,
    recommended: false,
  },
  {
    id: 'yunet',
    label: 'YuNet (reenquadramento)',
    repo: 'opencv/opencv_zoo',
    revision: 'rev1',
    license: 'MIT',
    source_url: 'https://github.com/opencv/opencv_zoo',
    size: 232_589,
    installed: false,
    update_available: false,
    worker_installed: true,
    recommended: false,
  },
]

const TTS_CATALOGO_PADRAO = {
  catalogVersion: 1,
  catalogSource: 'embedded',
  catalogWarning: null,
  componentInstalled: true,
  activeModels: { pt: 'portuguese_24l', en: 'english' },
  engines: [
    {
      id: 'pocket-tts',
      label: 'Pocket TTS (Kyutai)',
      componentId: 'pocket-tts',
      codeLicense: 'MIT',
      sourceUrl: 'https://github.com/kyutai-labs/pocket-tts',
      prohibitedUse: {
        textEn: 'Prohibited use: no impersonation or cloning.',
        summaryPt:
          'Uso proibido pelo autor do modelo (Kyutai): sem imitação ou clonagem de voz sem consentimento explícito e legal.',
        version: 'mock',
      },
    },
  ],
  models: [
    {
      id: 'portuguese_24l',
      engineId: 'pocket-tts',
      language: 'pt',
      label: 'Pocket TTS PT-BR (24 camadas · padrão)',
      description: 'Qualidade superior em PT-BR.',
      defaultForLanguage: true,
      active: true,
      installed: false,
      updateAvailable: false,
      termsAccepted: false,
      license: 'CC-BY-4.0',
      sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning',
      size: 701_332_218,
    },
    {
      id: 'english',
      engineId: 'pocket-tts',
      language: 'en',
      label: 'Pocket TTS EN (6 camadas · padrão)',
      description: 'Modelo oficial em inglês.',
      defaultForLanguage: true,
      active: true,
      installed: true,
      updateAvailable: false,
      termsAccepted: true,
      license: 'CC-BY-4.0',
      sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning',
      size: 231_761_368,
    },
  ],
  voices: [
    {
      id: '13063',
      engineId: 'pocket-tts',
      language: 'pt',
      gender: 'male',
      label: 'Narrador PT-BR 13063 (masculina)',
      license: 'CC-BY-4.0',
      attribution: 'BRSpeech-TTS / CML-TTS (CC-BY 4.0)',
      models: ['portuguese_24l'],
    },
  ],
}

function mockComponentesPadrao(sobrescrita?: (cmd: string, args?: unknown) => unknown) {
  chamarMock.mockImplementation(async (cmd: string, args?: unknown) => {
    const custom = sobrescrita?.(cmd, args)
    if (custom !== undefined) return custom
    switch (cmd) {
      case 'transcription.hardware.status':
        return {
          gpu: { name: 'NVIDIA GeForce RTX 3050', driver: '616.92', total_mib: 4096, free_mib: 3800 },
          ram: { total: 16 * 1024 ** 3, available: 9 * 1024 ** 3 },
          cuda: true,
          no_compatible_gpu: false,
          effective: { model: 'whisper-turbo', device: 'cuda', compute_type: 'int8_float16' },
          manual: false,
          fallback_reason: null,
          probe: null,
          options: [
            {
              model: 'whisper-turbo',
              device: 'cuda',
              compute_type: 'int8_float16',
              installed: true,
              enabled: true,
              reason: null,
            },
            {
              model: 'whisper-small',
              device: 'cpu',
              compute_type: 'int8',
              installed: true,
              enabled: true,
              reason: null,
            },
            {
              model: 'whisper-turbo',
              device: 'cpu',
              compute_type: 'int8',
              installed: false,
              enabled: false,
              reason: 'ram_insufficient',
            },
          ],
          worker_installed: true,
        }
      case 'transcription.grouping': {
        const a = (args ?? {}) as { auto?: boolean; enabled?: boolean }
        if (a.enabled !== undefined) {
          return { enabled: a.enabled, mode: 'manual', size: a.enabled ? 8 : 1, measured_size: 8 }
        }
        return { enabled: false, mode: 'auto', size: 1, measured_size: 8 }
      }
      case 'components.manifest':
        return MANIFESTO_COMPLETO
      case 'components.settings.get':
        return {
          data_dir: '/test/data',
          cache_dir: '/test/cache',
          cache_limit_bytes: 10_000_000_000,
          ffmpeg_path: null,
        }
      case 'components.settings.set':
        return args
      case 'components.ffmpeg.status':
        return { installed: true, incomplete: false }
      case 'components.ytdlp.status':
        return { installed: true, version: '2026.11.01' }
      case 'components.deno.status':
        return { installed: false, version: null, pinned: '2.9.8', outdated: false }
      case 'components.pocket_tts.status':
        return { installed: true, version: '3.3.0', pinned: '3.3.0', outdated: false }
      case 'components.worker.status':
        return {
          installed: true,
          outdated: false,
          cuda: true,
          gpu: true,
          uv: '0.13.8',
          handshake: { protocol: 1, worker: '0.1.0', python: '3.12.16', libs: {} },
        }
      case 'components.catalog.status':
        return {
          version: 1,
          embeddedVersion: 1,
          source: 'embedded',
          warning: null,
          warningCode: null,
        }
      case 'components.models.manifest':
        return MODELOS_PADRAO
      case 'tts.catalog':
        return TTS_CATALOGO_PADRAO
      case 'components.cancel':
      case 'tts.models.cancel':
        return {}
      default:
        return {}
    }
  })
}

describe('mock components.settings.set em core.ts', () => {
  it('valida caminhos absolutos e cache_limit_bytes > 0 e persiste alterações', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')

    await expect(
      coreDispatch('components.settings.set', {
        data_dir: 'relativo/data',
        cache_dir: '/test/cache',
        cache_limit_bytes: 5_000_000_000,
        ffmpeg_path: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_settings' })

    await expect(
      coreDispatch('components.settings.set', {
        data_dir: '/test/data',
        cache_dir: '/test/cache',
        cache_limit_bytes: 0,
        ffmpeg_path: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_settings' })

    const salvo = await coreDispatch<{
      data_dir: string
      cache_dir: string
      cache_limit_bytes: number
    }>('components.settings.set', {
      data_dir: 'C:\\Clipes\\data',
      cache_dir: '/novo/cache',
      cache_limit_bytes: 20_000_000_000,
      ffmpeg_path: null,
    })
    expect(salvo.data_dir).toBe('C:\\Clipes\\data')
    expect(salvo.cache_limit_bytes).toBe(20_000_000_000)

    const lido = await coreDispatch<{ data_dir: string; cache_dir: string }>(
      'components.settings.get',
      {},
    )
    expect(lido.data_dir).toBe('C:\\Clipes\\data')
    expect(lido.cache_dir).toBe('/novo/cache')
  })
})

describe('ConfigComponentes (#/config/componentes)', () => {
  it('estado loading exibe Esqueleto enquanto carrega', () => {
    chamarMock.mockImplementation(() => new Promise(() => {}))
    render(envolver(<ConfigComponentes projetoAberto={null} />))

    expect(screen.getByRole('status', { name: /Carregando/i })).toBeInTheDocument()
  })

  it('exibe aviso exato do agrupamento VAD (#279) fora de details e alterna modo', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao()
    render(envolver(<ConfigComponentes projetoAberto={null} />))

    expect(
      await screen.findByText(
        /No modo automático, fica ligado na CPU e desligado na GPU: na CPU acelera ~18%; na GPU usa ~1 GB a mais de VRAM sem ganho medido\./i,
      ),
    ).toBeVisible()

    // Sem jargões técnicos fora de <details>
    const foraDeDetails = (texto: RegExp) =>
      screen.queryAllByText(texto).filter((el) => !el.closest('details'))
    expect(foraDeDetails(/int8_float16/i)).toHaveLength(0)
    expect(foraDeDetails(/handshake/i)).toHaveLength(0)

    await user.click(screen.getByRole('radio', { name: /Manual/i }))
    expect(chamarMock).toHaveBeenCalledWith('transcription.grouping', { enabled: false })
  })

  it('estado empty exibe EstadoTela quando catálogo de modelos ou vozes TTS estiver vazio', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao((cmd) => {
      if (cmd === 'components.models.manifest') return []
      if (cmd === 'tts.catalog') {
        return {
          ...TTS_CATALOGO_PADRAO,
          models: [],
          voices: [],
        }
      }
      return undefined
    })

    render(envolver(<ConfigComponentes projetoAberto={null} />))

    await user.click(await screen.findByRole('tab', { name: /Componentes e Modelos/i }))
    expect(await screen.findByText(/Nenhum modelo no catálogo/i)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Vozes TTS/i }))
    expect(await screen.findByText(/Nenhuma voz TTS disponível/i)).toBeInTheDocument()
  })

  it('estado partial indica FFmpeg incompleto e Worker com atualização recomendada', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao((cmd) => {
      if (cmd === 'components.ffmpeg.status') return { installed: false, incomplete: true }
      if (cmd === 'components.worker.status') {
        return { installed: true, outdated: true, cuda: false, gpu: false, uv: '0.13.8' }
      }
      return undefined
    })

    render(envolver(<ConfigComponentes projetoAberto={null} />))
    await user.click(await screen.findByRole('tab', { name: /Componentes e Modelos/i }))

    expect(await screen.findByText('Incompleto')).toBeInTheDocument()
    expect(screen.getByText('Atualização recomendada')).toBeInTheDocument()
  })

  it('estado error traduz worker_missing, ram_insufficient, invalid_ffmpeg, catalog_signature_invalid e invalid_settings', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao((cmd) => {
      if (cmd === 'transcription.hardware.probe') {
        return Promise.reject(new ErroCore('worker_missing', 'worker missing'))
      }
      if (cmd === 'transcription.hardware.choose') {
        return Promise.reject(new ErroCore('ram_insufficient', 'less than 8 GB'))
      }
      if (cmd === 'components.ffmpeg.system') {
        return Promise.reject(new ErroCore('invalid_ffmpeg', 'bad binary'))
      }
      if (cmd === 'components.catalog.check') {
        return Promise.reject(new ErroCore('catalog_signature_invalid', 'bad sig'))
      }
      if (cmd === 'components.settings.set') {
        return Promise.reject(new ErroCore('invalid_settings', 'relative path'))
      }
      return undefined
    })

    render(envolver(<ConfigComponentes projetoAberto={null} />))
    await user.click(await screen.findByRole('button', { name: /Testar hardware/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Instale o ambiente Python e o modelo recomendado antes de testar o hardware\./i,
    )

    await user.click(screen.getByRole('radio', { name: /Modelo leve · Processador/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Este modelo em CPU exige pelo menos 8 GB de RAM\./i,
    )

    await user.click(screen.getByRole('tab', { name: /Componentes e Modelos/i }))
    await user.click(screen.getByText(/Usar FFmpeg já instalado no sistema/i))
    await user.click(screen.getByRole('button', { name: /Validar caminho/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /FFmpeg ou FFprobe não encontrado no caminho informado\./i,
    )

    await user.click(screen.getByRole('button', { name: /Verificar catálogo de modelos/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /assinatura do catálogo remoto não pôde ser verificada/i,
    )

    await user.click(screen.getByRole('tab', { name: /Pastas e Armazenamento/i }))
    await user.click(screen.getByRole('button', { name: /Salvar pastas e limite/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Informe pastas com caminho completo \(absoluto\) e limite de cache maior que zero\./i,
    )
  })

  it('isola progresso de core-progress estritamente por job (job: deno não vaza para outros cards)', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao()
    render(envolver(<ConfigComponentes projetoAberto={null} />))

    await user.click(await screen.findByRole('tab', { name: /Componentes e Modelos/i }))
    await screen.findByText('deno')

    act(() => {
      filaTeste.aplicar({
        job: 'deno',
        project: null,
        stage: 'download',
        percentage: 62,
        message: 'Baixando deno',
        error: null,
      })
    })

    const cardDeno = screen.getByRole('region', { name: /deno/i })
    expect(within(cardDeno).getByText(/62%/)).toBeInTheDocument()

    const cardFfmpeg = screen.getByRole('region', { name: /FFmpeg/i })
    expect(within(cardFfmpeg).queryByText(/62%/)).not.toBeInTheDocument()

    const cardYunet = screen.getByRole('region', { name: /YuNet/i })
    expect(within(cardYunet).queryByText(/62%/)).not.toBeInTheDocument()

    await user.click(within(cardDeno).getByRole('button', { name: /Cancelar download de deno/i }))
    expect(chamarMock).toHaveBeenCalledWith('components.cancel', { id: 'deno' })
  })

  it('download de modelo abre ConfirmDialog com tamanho e licença antes de chamar components.models.download', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao()
    render(envolver(<ConfigComponentes projetoAberto={null} />))

    await user.click(await screen.findByRole('tab', { name: /Componentes e Modelos/i }))

    const cardYunet = await screen.findByRole('region', { name: /YuNet/i })
    await user.click(within(cardYunet).getByRole('button', { name: /^Baixar$/i }))

    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent(/YuNet/i)
    expect(dialogo).toHaveTextContent(/MIT/i)
    expect(dialogo).toHaveTextContent(/KB|MB|B/i)
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    expect(chamarMock).not.toHaveBeenCalledWith('components.models.download', expect.anything())

    await user.click(within(dialogo).getByRole('button', { name: /Baixar agora/i }))
    expect(chamarMock).toHaveBeenCalledWith('components.models.download', {
      id: 'yunet',
      confirmed: true,
    })
  })

  it('download TTS exige termo aceito (termsAccepted: true) e cancela com tts.models.cancel', async () => {
    const user = userEvent.setup()
    let resolver: (v: unknown) => void = () => {}
    mockComponentesPadrao((cmd) => {
      if (cmd === 'tts.models.download') {
        return new Promise((r) => {
          resolver = r
        })
      }
      return undefined
    })
    render(envolver(<ConfigComponentes projetoAberto={null} />))

    await user.click(await screen.findByRole('tab', { name: /Vozes TTS/i }))
    expect(await screen.findByText(/sem imitação ou clonagem de voz/i)).toBeVisible()

    const cardPt = screen.getByRole('region', { name: /Pocket TTS PT-BR \(24 camadas/i })
    await user.click(within(cardPt).getByRole('button', { name: /^Baixar$/i }))

    const dialogo = await screen.findByRole('alertdialog')
    const btnConfirmar = within(dialogo).getByRole('button', { name: /Baixar agora/i })
    expect(btnConfirmar).toBeDisabled()

    await user.click(within(dialogo).getByRole('checkbox', { name: /termos de uso/i }))
    expect(btnConfirmar).toBeEnabled()
    await user.click(btnConfirmar)

    expect(chamarMock).toHaveBeenCalledWith('tts.models.download', {
      id: 'portuguese_24l',
      confirmed: true,
      termsAccepted: true,
    })

    act(() => {
      filaTeste.aplicar({
        job: 'tts:portuguese_24l',
        project: null,
        stage: 'download',
        percentage: 40,
        message: 'Baixando voz TTS',
        error: null,
      })
    })

    await user.click(within(cardPt).getByRole('button', { name: /Cancelar/i }))
    expect(chamarMock).toHaveBeenCalledWith('tts.models.cancel', { id: 'portuguese_24l' })
    expect(chamarMock).not.toHaveBeenCalledWith('components.cancel', { id: 'portuguese_24l' })

    resolver({ id: 'portuguese_24l' })
  })

  it('desabilita download automático com Dica citando #301 quando ausente do manifesto', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao((cmd) => {
      if (cmd === 'components.manifest') {
        return MANIFESTO_COMPLETO.filter((m) => m.id !== 'ffmpeg' && m.id !== 'yt-dlp')
      }
      if (cmd === 'components.ffmpeg.status') return { installed: false, incomplete: false }
      if (cmd === 'components.ytdlp.status') return { installed: false }
      return undefined
    })
    render(envolver(<ConfigComponentes projetoAberto={null} />))

    await user.click(await screen.findByRole('tab', { name: /Componentes e Modelos/i }))

    const cardFfmpeg = await screen.findByRole('region', { name: /FFmpeg/i })
    const btnFfmpeg = within(cardFfmpeg).getByRole('button', { name: /Baixar FFmpeg/i })
    expect(btnFfmpeg).toBeDisabled()
    await user.hover(btnFfmpeg.parentElement!)
    expect(await screen.findByText(/#301/)).toBeInTheDocument()
  })

  it('aba Pastas e Armazenamento exibe aviso obrigatório de data_dir antes de salvar', async () => {
    const user = userEvent.setup()
    mockComponentesPadrao()
    render(envolver(<ConfigComponentes projetoAberto={null} />))

    await user.click(await screen.findByRole('tab', { name: /Pastas e Armazenamento/i }))
    expect(
      await screen.findByText(
        /Alterar a pasta de componentes vale apenas para downloads futuros\. Arquivos já baixados não são movidos automaticamente/i,
      ),
    ).toBeVisible()

    const inputData = screen.getByLabelText(/Pasta de componentes e modelos \(data_dir\)/i)
    await user.clear(inputData)
    await user.type(inputData, '/novo/data')
    await user.click(screen.getByRole('button', { name: /Salvar pastas e limite/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('components.settings.set', {
        data_dir: '/novo/data',
        cache_dir: '/test/cache',
        cache_limit_bytes: 10_000_000_000,
        ffmpeg_path: null,
      })
    })
  })
})
