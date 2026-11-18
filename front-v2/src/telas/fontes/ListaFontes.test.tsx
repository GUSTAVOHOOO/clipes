import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { coreDispatch } from '@core'
import { Checkbox, ProvedorDicas, ProvedorToast } from '@ds'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import { ListaFontes } from '~/telas/fontes/ListaFontes'

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: vi.fn(async () => []),
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

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

const FONTES_EXEMPLO: FonteProjeto[] = [
  {
    id: 1,
    path: '/videos/Live_12_11_final.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'none' },
    metadata: { format: { duration: '3600.0' }, streams: [] },
  },
]

describe('UI-15: Checkbox sem rótulo visível com alvo >= 24x24 px', () => {
  it('aplica min-w-6, min-h-6 e justify-center no <label> quando não há texto visível', () => {
    render(
      <div>
        <Checkbox marcado={false} aoMudar={() => {}}>
          <span className="sr-only">Selecionar item</span>
        </Checkbox>
        <Checkbox marcado={false} aoMudar={() => {}}>
          Selecionar todas
        </Checkbox>
      </div>,
    )

    const semRotulo = screen.getByRole('checkbox', { name: 'Selecionar item' })
    const labelSemRotulo = semRotulo.closest('label')
    expect(labelSemRotulo).not.toBeNull()
    expect(labelSemRotulo!.className).toContain('min-w-6')
    expect(labelSemRotulo!.className).toContain('min-h-6')
    expect(labelSemRotulo!.className).toContain('justify-center')

    const comRotulo = screen.getByRole('checkbox', { name: 'Selecionar todas' })
    const labelComRotulo = comRotulo.closest('label')
    expect(labelComRotulo).not.toBeNull()
    expect(labelComRotulo!.className).toContain('min-h-6')
    expect(labelComRotulo!.className).not.toContain('justify-center')
  })

  it('checkbox de seleção em lote em ListaFontes tem alvo mínimo de 24x24 px (min-w-6 min-h-6)', () => {
    render(
      envolver(
        <ListaFontes
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          fontes={FONTES_EXEMPLO}
          transcriptStatusBySource={{}}
          selecionadasParaLote={[]}
          invalidacoes={{ transcricao: 0, energia: 0, chat: 0, preview: 0, lotes: 0 }}
          aoMudarSelecionadas={() => {}}
          aoIrParaLote={() => {}}
          aoAtualizarFonte={async () => {}}
          aoAtualizarTodas={async () => {}}
        />,
      ),
    )

    const chk = screen.getByRole('checkbox', {
      name: 'Selecionar Live_12_11_final.mp4 para lote',
    })
    const label = chk.closest('label')
    expect(label).not.toBeNull()
    expect(label!.className).toContain('min-w-6')
    expect(label!.className).toContain('min-h-6')
    expect(label!.className).toContain('justify-center')
  })

  it('UI-28: botão Ir para Cortes não duplica seta no texto além do ícone', () => {
    render(
      envolver(
        <ListaFontes
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          fontes={FONTES_EXEMPLO}
          transcriptStatusBySource={{
            1: {
              language: 'pt',
              transcript: {
                id: 1,
                state: 'complete',
                resume_us: 3600_000_000,
                duration_us: 3600_000_000,
                model: 'whisper-turbo',
                engine: 'local',
                words: 1200,
              },
              job: null,
            },
          }}
          selecionadasParaLote={[]}
          invalidacoes={{ transcricao: 0, energia: 0, chat: 0, preview: 0, lotes: 0 }}
          aoMudarSelecionadas={() => {}}
          aoIrParaLote={() => {}}
          aoAtualizarFonte={async () => {}}
          aoAtualizarTodas={async () => {}}
        />,
      ),
    )

    const btn = screen.getByRole('button', { name: 'Ir para Cortes' })
    expect(btn.textContent?.trim()).toBe('Ir para Cortes')
    expect(btn.textContent).not.toContain('→')
  })
})

describe('Mock TS sources.delete (src/lib/core.ts)', () => {
  afterEach(async () => {
    try {
      await coreDispatch('projects.close', {})
    } catch {
      // ignora se já fechado
    }
    vi.unstubAllEnvs()
  })

  it('remove a Fonte, retorna contagens com jobs_kept_for_costs e rejeita source_missing e source_busy', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    const projeto = await coreDispatch<{ path: string }>('projects.open', {
      path: '/projetos/MeuCanal.clipes',
    })

    const criada = await coreDispatch<{ id: number }>('sources.import', {
      project: projeto.path,
      path: '/videos/para_excluir.mp4',
      audio_track: 1,
      language: 'pt',
      copy: false,
      origin_url: null,
      permission: { status: 'none' },
    })

    const antes = await coreDispatch<Array<{ id: number }>>('sources.list', {
      project: projeto.path,
    })
    expect(antes.some((s) => s.id === criada.id)).toBe(true)

    const res = await coreDispatch<{
      deleted: boolean
      id: number
      transcripts: number
      cuts: number
      selection_runs: number
      clip_edits: number
      batch_items: number
      jobs: number
      jobs_kept_for_costs: number
    }>('sources.delete', { project: projeto.path, id: criada.id })

    expect(res).toMatchObject({
      deleted: true,
      id: criada.id,
      transcripts: 0,
      cuts: 0,
      jobs_kept_for_costs: 0,
    })

    const depois = await coreDispatch<Array<{ id: number }>>('sources.list', {
      project: projeto.path,
    })
    expect(depois.some((s) => s.id === criada.id)).toBe(false)

    await expect(
      coreDispatch('sources.delete', { project: projeto.path, id: criada.id }),
    ).rejects.toMatchObject({ code: 'source_missing' })

    // Cria outra Fonte, inicia transcrição e valida source_busy
    const ocupada = await coreDispatch<{ id: number }>('sources.import', {
      project: projeto.path,
      path: '/videos/ocupada.mp4',
      audio_track: 1,
      language: 'pt',
      copy: false,
      origin_url: null,
      permission: { status: 'none' },
    })
    await coreDispatch('transcription.start', {
      project: projeto.path,
      source_id: ocupada.id,
      engine: 'local',
    })

    await expect(
      coreDispatch('sources.delete', { project: projeto.path, id: ocupada.id }),
    ).rejects.toMatchObject({ code: 'source_busy' })
  })
})

