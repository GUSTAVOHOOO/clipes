import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { ConfigProjeto } from '~/telas/config/ConfigProjeto'

const chamarMock = vi.fn()
const notificarMudancaProjetoMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('~/shell/Shell', async () => {
  const atual = await vi.importActual<typeof import('~/shell/Shell')>('~/shell/Shell')
  return {
    ...atual,
    notificarMudancaProjeto: (...args: unknown[]) => notificarMudancaProjetoMock(...args),
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

const PERFIL_BASE = {
  videoKind: 'direct' as const,
  language: 'pt',
  minUs: 20_000_000,
  maxUs: 60_000_000,
  allowedSources: [{ label: 'Podcast Exemplo', url: 'https://youtube.com/@podcast', note: 'Email' }],
  narrationVoice: '13063',
  directMonetizationAck: true,
  captionStyle: {
    schemaVersion: 1,
    revision: 0,
    preset: 'vertical',
    font: 'Noto Sans',
    fontSize: 64,
    color: '#FFFFFF',
    activeColor: '#FACC15',
    dimColor: '#FFFFFF',
    outlineColor: '#101010',
    outline: 6,
    shadow: 0,
    x: 540,
    y: 1440,
    highlight: true,
  },
  limits: {
    defaultMinUs: 20_000_000,
    defaultMaxUs: 60_000_000,
    maxUs: 180_000_000,
    technicalMaxUs: 300_000_000,
  },
}

const BACKUPS_BASE = [
  { id: 'backup-20261117-193000.sqlite', created_at: 1794943800, before_restore: false },
  { id: 'before-restore-20261117-184500.sqlite', created_at: 1794941100, before_restore: true },
]

const BACKUP_CFG_BASE = {
  interval_seconds: 1800,
  copies: 10,
  default_interval_seconds: 1800,
  default_copies: 10,
  warning: null as { code: string; message: string } | null,
}

function configurarRespostasPadrao(overrides: Record<string, (args?: unknown) => unknown> = {}) {
  chamarMock.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd in overrides) return overrides[cmd](args)
    switch (cmd) {
      case 'channel_profile.get':
        return { ...PERFIL_BASE }
      case 'channel_profile.set':
        return { ...PERFIL_BASE, ...(args as object) }
      case 'channel_profile.languages':
        return [
          { code: 'pt', name: 'portuguese' },
          { code: 'en', name: 'english' },
        ]
      case 'tts.catalog':
        return {
          voices: [
            { id: '13063', label: 'Narrador PT-BR 13063 (masculina)', language: 'pt' },
            { id: 'alba', label: 'Alba (EN, feminina)', language: 'en' },
          ],
        }
      case 'projects.local_only.get':
        return { open: true, enabled: false }
      case 'projects.local_only.set':
        return { open: true, enabled: Boolean((args as { enabled?: boolean })?.enabled) }
      case 'backups.settings.get':
        return { ...BACKUP_CFG_BASE }
      case 'backups.settings.set':
        return null
      case 'backups.list':
        return [...BACKUPS_BASE]
      case 'backups.create':
        return null
      case 'backups.restore':
        return null
      default:
        throw new ErroCore('desconhecido', `Comando inesperado: ${cmd}`)
    }
  })
}

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{ui}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

describe('ConfigProjeto (#/config/projeto)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    notificarMudancaProjetoMock.mockReset()
    configurarRespostasPadrao()
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('loading exibe <Esqueleto> e nunca exibe "Nenhum backup salvo ainda." durante carregamento', async () => {
    let resolverGet: ((v: unknown) => void) | null = null
    configurarRespostasPadrao({
      'channel_profile.get': () =>
        new Promise((res) => {
          resolverGet = res
        }),
      'backups.list': () =>
        new Promise(() => {
          // pendente
        }),
    })

    render(
      envolver(
        <ConfigProjeto
          projetoAberto="meu-canal"
          projeto={{ id: 'meu-canal', name: 'Meu Canal', path: '/videos/MeuCanal.clipes' }}
        />,
      ),
    )

    expect(screen.getByRole('status', { name: /carregando/i })).toBeInTheDocument()
    expect(screen.queryByText('Nenhum backup salvo ainda.')).not.toBeInTheDocument()

    await act(async () => {
      resolverGet?.({ ...PERFIL_BASE })
    })
  })

  it('empty exibe estados vazios acionáveis para allowedSources e backups.list', async () => {
    const user = userEvent.setup()
    configurarRespostasPadrao({
      'channel_profile.get': () => ({ ...PERFIL_BASE, allowedSources: [] }),
      'backups.list': () => [],
    })

    render(
      envolver(
        <ConfigProjeto
          projetoAberto="meu-canal"
          projeto={{ id: 'meu-canal', name: 'Meu Canal', path: '/videos/MeuCanal.clipes' }}
        />,
      ),
    )

    expect(await screen.findByText('Nenhuma Fonte permitida cadastrada ainda.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar criador/canal' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Backups do Projeto' }))
    expect(await screen.findByText('Nenhum backup salvo ainda.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar primeiro backup agora' })).toBeInTheDocument()
  })

  it('error traduz invalid_cut_range, project_busy, backup_invalid e backup_settings em role="alert"', async () => {
    const user = userEvent.setup()

    for (const [codigo, trechoEsperado] of [
      ['invalid_cut_range', /duração mínima deve ser maior que zero/i],
      ['project_busy', /tarefa ativa/i],
      ['backup_invalid', /corrompido ou é de uma versão incompatível/i],
      ['backup_settings', /intervalo e número de cópias inteiros/i],
    ] as const) {
      chamarMock.mockReset()
      configurarRespostasPadrao({
        'channel_profile.get': () => {
          throw new ErroCore(codigo, 'detalhe')
        },
      })

      const { unmount } = render(
        envolver(
          <ConfigProjeto
            projetoAberto="meu-canal"
            projeto={{ id: 'meu-canal', name: 'Meu Canal', path: '/videos/MeuCanal.clipes' }}
          />,
        ),
      )

      const alerta = await screen.findByRole('alert')
      expect(alerta).toHaveTextContent(trechoEsperado)
      unmount()
    }

    // Erro em backups.restore exibe banner sem perder o formulário
    configurarRespostasPadrao({
      'backups.restore': () => {
        throw new ErroCore('restore_failed', 'corrupted')
      },
    })
    render(
      envolver(
        <ConfigProjeto
          projetoAberto="meu-canal"
          projeto={{ id: 'meu-canal', name: 'Meu Canal', path: '/videos/MeuCanal.clipes' }}
        />,
      ),
    )
    await user.click(await screen.findByRole('tab', { name: 'Backups do Projeto' }))
    const btnRestaurar = (await screen.findAllByRole('button', { name: /Restaurar backup/i }))[0]
    await user.click(btnRestaurar)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Restaurar backup' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/corrompido ou é de uma versão incompatível/i)
  })

  it('salva Perfil de canal convertendo s para µs e valida min >= max localmente sem chamar núcleo', async () => {
    const user = userEvent.setup()
    render(
      envolver(
        <ConfigProjeto
          projetoAberto="meu-canal"
          projeto={{ id: 'meu-canal', name: 'Meu Canal', path: '/videos/MeuCanal.clipes' }}
        />,
      ),
    )

    const campoMin = await screen.findByLabelText('Duração mínima (s)')
    const campoMax = screen.getByLabelText('Duração máxima (s)')

    await user.clear(campoMin)
    await user.type(campoMin, '100')
    await user.clear(campoMax)
    await user.type(campoMax, '90')
    await user.click(screen.getByRole('button', { name: 'Salvar Perfil' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/duração mínima deve ser maior que zero/i)
    expect(chamarMock).not.toHaveBeenCalledWith('channel_profile.set', expect.anything())

    await user.clear(campoMin)
    await user.type(campoMin, '20')
    await user.click(screen.getByRole('button', { name: 'Salvar Perfil' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'channel_profile.set',
        expect.objectContaining({
          minUs: 20_000_000,
          maxUs: 90_000_000,
        }),
      )
    })
  })

  it('liga Somente local em Privacidade chamando projects.local_only.set e notificando Shell', async () => {
    const user = userEvent.setup()
    render(
      envolver(
        <ConfigProjeto
          projetoAberto="meu-canal"
          projeto={{ id: 'meu-canal', name: 'Meu Canal', path: '/videos/MeuCanal.clipes' }}
        />,
      ),
    )

    await user.click(await screen.findByRole('tab', { name: /Privacidade/i }))
    const sw = await screen.findByRole('switch', {
      name: /Ativar veto Somente local para este Projeto/i,
    })
    await user.click(sw)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.local_only.set', { enabled: true })
      expect(notificarMudancaProjetoMock).toHaveBeenCalled()
    })
  })

  it('job_running desabilita Restaurar, partial exibe warning, ConfirmDialog foca Cancelar e recarrega após job (#297)', async () => {
    const user = userEvent.setup()
    const fila: Fila = criarFila(() => 'meu-canal')
    fila.aplicar({
      job: '12',
      project: 'meu-canal',
      stage: 'transcribing',
      percentage: 40,
      message: 'Transcrevendo',
      error: null,
    })

    configurarRespostasPadrao({
      'backups.settings.get': () => ({
        ...BACKUP_CFG_BASE,
        warning: { code: 'backup_failed', message: 'Sem espaço para backup automático.' },
      }),
    })

    render(
      envolver(
        <ConfigProjeto
          projetoAberto="meu-canal"
          projeto={{ id: 'meu-canal', name: 'Meu Canal', path: '/videos/MeuCanal.clipes' }}
          fila={fila}
        />,
      ),
    )

    await user.click(await screen.findByRole('tab', { name: 'Backups do Projeto' }))

    expect(await screen.findByText(/O último backup automático falhou/i)).toBeInTheDocument()
    expect(screen.getByText('Pré-restauração')).toBeInTheDocument()

    const botoesRestaurar = screen.getAllByRole('button', { name: /Restaurar backup/i })
    expect(botoesRestaurar[0]).toBeDisabled()

    const chamadasAntes = chamarMock.mock.calls.filter(([c]) => c === 'backups.list').length

    // Quando job termina, recarrega backups (#297) e habilita Restaurar
    act(() => {
      fila.aplicar({
        job: '12',
        project: 'meu-canal',
        stage: 'complete',
        percentage: 100,
        message: 'Concluído',
        error: null,
      })
    })

    await waitFor(() => {
      const btnAtualizado = screen.getAllByRole('button', { name: /Restaurar backup/i })[0]
      expect(btnAtualizado).toBeEnabled()
      const chamadasDepois = chamarMock.mock.calls.filter(([c]) => c === 'backups.list').length
      expect(chamadasDepois).toBeGreaterThan(chamadasAntes)
    })

    await user.click(screen.getAllByRole('button', { name: /Restaurar backup/i })[0])
    const dialogo = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dialogo).getByRole('button', { name: 'Restaurar backup' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('backups.restore', {
        id: 'backup-20261117-193000.sqlite',
      })
    })
  })
})
