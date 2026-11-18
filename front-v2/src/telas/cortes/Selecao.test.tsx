import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import {
  criarStoreFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import { Selecao } from '~/telas/cortes/Selecao'

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
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

const FONTES_PADRAO: FonteProjeto[] = [
  {
    id: 2,
    path: '/videos/offline.mp4',
    status: 'offline',
    available: false,
    verified: false,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'none' },
    metadata: { format: { duration: '1800.0' }, streams: [] },
  },
  {
    id: 4,
    path: '/videos/Live_12_11_final.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: 'https://www.youtube.com/watch?v=live1211',
    language: 'pt',
    permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes e tradução' },
    metadata: { format: { duration: '3600.0' }, streams: [] },
  },
]

const PESOS_DIRETO = [
  { key: 'hook', weight: 0.3 },
  { key: 'selfContained', weight: 0.2 },
  { key: 'energy', weight: 0.2 },
  { key: 'value', weight: 0.15 },
  { key: 'closing', weight: 0.15 },
]

function criarRunBase(override: Record<string, unknown> = {}) {
  return {
    id: 1,
    state: 'completed',
    minUs: 20_000_000,
    maxUs: 60_000_000,
    planState: 'full',
    revision: 2,
    revisions: [1, 2],
    videoKind: 'direct',
    profile: 'remoto-rapido',
    budgetPause: null,
    weights: PESOS_DIRETO,
    summary: {
      energy: { measured: true, high: 4, peak: 2 },
      chat: { available: true, peaks: 3, marked: 2 },
    },
    counts: { windows: 3, completed: 3, failed: 0, kept: 2, discarded: 0, merged: 1 },
    createdAt: '2026-11-17T16:40:00Z',
    ...override,
  }
}

function criarJanelasPadrao() {
  return [
    {
      index: 0,
      firstId: 1,
      lastId: 90,
      startUs: 0,
      endUs: 900_000_000,
      jobId: 10,
      state: 'completed',
      code: null,
      resetAtMs: null,
      profile: 'remoto-rapido',
    },
    {
      index: 1,
      firstId: 91,
      lastId: 180,
      startUs: 720_000_000,
      endUs: 1_620_000_000,
      jobId: 11,
      state: 'completed',
      code: null,
      resetAtMs: null,
      profile: 'remoto-rapido',
    },
    {
      index: 2,
      firstId: 181,
      lastId: 270,
      startUs: 1_440_000_000,
      endUs: 2_340_000_000,
      jobId: 12,
      state: 'completed',
      code: null,
      resetAtMs: null,
      profile: 'remoto-forte',
    },
  ]
}

function criarCandidatosPadrao(rev = 2) {
  return [
    {
      id: rev * 100 + 1,
      rank: 0,
      startId: 10,
      endId: 14,
      startUs: 90_000_000,
      endUs: 140_000_000,
      total: 8.4,
      title: 'A virada do jogo',
      windows: [0, 1],
      profile: 'remoto-rapido',
      revision: rev,
      adjusted: false,
    },
    {
      id: rev * 100 + 2,
      rank: 1,
      startId: 40,
      endId: 41,
      startUs: 390_000_000,
      endUs: 410_000_000,
      total: 7.5,
      title: '',
      windows: [0],
      profile: 'remoto-rapido',
      revision: rev,
      adjusted: true,
    },
  ]
}

function mockSelecaoBase(overrides: Partial<Record<string, (args: unknown) => unknown>> = {}) {
  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    if (Object.hasOwn(overrides, cmd)) {
      return overrides[cmd]!(args)
    }
    const a = (args ?? {}) as Record<string, unknown>
    switch (cmd) {
      case 'sources.list':
        return FONTES_PADRAO
      case 'batches.list':
        return []
      case 'transcription.status':
        return {
          language: 'pt',
          transcript: {
            id: Number(a.source_id ?? 4),
            state: 'complete',
            resume_us: 3_600_000_000,
            duration_us: 3_600_000_000,
            model: 'whisper-turbo',
            engine: 'local',
            words: 30000,
          },
          job: null,
        }
      case 'channel_profile.get':
        return {
          videoKind: 'direct',
          language: 'pt',
          minUs: 20_000_000,
          maxUs: 60_000_000,
          directMonetizationAck: true,
          limits: {
            defaultMinUs: 20_000_000,
            defaultMaxUs: 60_000_000,
            maxUs: 180_000_000,
            technicalMaxUs: 300_000_000,
          },
        }
      case 'guardrails.check':
        return { scope: 'source', directMonetizationAck: true, needsDirectNotice: false }
      case 'energy.status':
        return { measured: true, marks: { high: 4, peak: 2 }, job: null }
      case 'chat.status':
        return { state: 'available', canFetch: true, intervals: 42, messages: 1280, peaks: 3, job: null }
      case 'provider.selection_state':
        return {
          applicable: true,
          profileId: 'remoto-rapido',
          kind: 'openai',
          model: 'gpt-4o-mini',
          contextTokens: 32768,
          state: 'full',
          reference: { firstWindowMinutes: 15 },
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
              id: 'remoto-forte',
              label: 'Perfil Forte',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o',
              local: false,
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
      case 'jobs.budget.continue':
        return { budgets: [] }
      case 'jobs.estimate':
        return { safety: 'paid', estimate: { kind: 'unknown' } }
      case 'jobs.retry':
        return null
      case 'jobs.discard':
        return null
      case 'selection.estimate':
        if (a.run && a.profileId) {
          return {
            run: a.run,
            windows: a.windows ?? [0],
            profile: { id: a.profileId, label: 'Perfil Forte', kind: 'openai', model: 'gpt-4o' },
            paid: true,
            leavesMachine: true,
            estimate: { kind: 'usd', minMicroUsd: 2000, maxMicroUsd: 8000 },
          }
        }
        return {
          paid: true,
          profile: 'remoto-rapido',
          minUs: 20_000_000,
          maxUs: 60_000_000,
          videoKind: 'direct',
          plan: { state: 'full', windows: [{}, {}, {}], contextTokens: 32768 },
          weights: PESOS_DIRETO,
          estimate: { kind: 'usd', minMicroUsd: 5000, maxMicroUsd: 15000, inputTokens: 30000, windows: 3 },
        }
      case 'selection.list':
        return [criarRunBase()]
      case 'selection.get': {
        const rev = (a.revision as number) ?? 2
        return {
          run: criarRunBase({ revision: rev }),
          windows: criarJanelasPadrao(),
          candidates: criarCandidatosPadrao(rev),
        }
      }
      case 'selection.cancel':
        return null
      case 'selection.resume':
        return { run: 1, windows: [1] }
      case 'selection.redo':
        return { run: 1, windows: a.windows ?? [0] }
      default:
        return null
    }
  })
}

describe('Tela Configurador e Acompanhamento de Seleção (#/projeto/:id/cortes)', () => {
  let storeFontes: StoreFontesProjeto

  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    storeFontes = criarStoreFontesProjeto()
    window.location.hash = '#/projeto/demo/cortes'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('cobre estados §6: loading com Esqueleto, empty sem Fontes transcritas e empty sem execuções focando Selecionar Cortes', async () => {
    const user = userEvent.setup()

    // 1. loading: nunca exibe lista vazia antes da primeira resposta
    mockSelecaoBase({
      'sources.list': () => new Promise(() => {}),
    })
    const { unmount } = render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(screen.getAllByRole('status', { name: /Carregando/i }).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/Nenhuma Fonte transcrita ainda/i)).not.toBeInTheDocument()
    unmount()

    // 2. empty sem Fontes transcritas
    const storeVazio = criarStoreFontesProjeto()
    mockSelecaoBase({
      'transcription.status': () => ({ language: 'pt', transcript: null, job: null }),
    })
    const r2 = render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeVazio}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText(/Nenhuma Fonte transcrita ainda/i)).toBeInTheDocument()
    const ctaFontes = screen.getByRole('button', { name: /Ir para Fontes e Transcrição/i })
    await user.click(ctaFontes)
    expect(window.location.hash).toBe('#/projeto/demo/fontes')
    r2.unmount()

    // 3. empty sem execuções na Fonte -> botão foca "Selecionar Cortes"
    const storeSemRun = criarStoreFontesProjeto()
    window.location.hash = '#/projeto/demo/cortes'
    mockSelecaoBase({
      'selection.list': () => [],
    })
    render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeSemRun}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText(/Nenhuma seleção executada nesta Fonte/i)).toBeInTheDocument()
    const btnFocarDisparo = screen.getByRole('button', { name: /Ir para Selecionar Cortes/i })
    await user.click(btnFocarDisparo)
    expect(screen.getByRole('button', { name: 'Selecionar Cortes' })).toHaveFocus()
  })

  it('cobre empty com 0 candidatos, error (local_only_violation e transcript_incomplete) e Fonte V1 offline com aviso não bloqueante', async () => {
    // 1. empty com 0 candidatos -> "Nenhum Corte encontrado nesta seleção" + "Refazer com outro Perfil"
    mockSelecaoBase({
      'selection.get': () => ({
        run: criarRunBase({ counts: { windows: 3, completed: 3, failed: 0, kept: 0, discarded: 0, merged: 0 } }),
        windows: criarJanelasPadrao(),
        candidates: [],
      }),
    })
    const r1 = render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    const tituloVazio = await screen.findByText(/Nenhum Corte encontrado nesta seleção/i)
    const caixaVazio = tituloVazio.closest('div')!.parentElement!
    expect(within(caixaVazio).getByRole('button', { name: /Refazer com outro Perfil/i })).toBeInTheDocument()
    r1.unmount()

    // 2. ?estado=erro simula local_only_violation em role="alert"
    window.location.hash = '#/projeto/demo/cortes?estado=erro'
    const storeErro = criarStoreFontesProjeto()
    const r2 = render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeErro}
          fila={filaTeste}
        />,
      ),
    )
    const alertaErro = await screen.findByRole('alert')
    expect(alertaErro).toHaveTextContent(/Somente local/i)
    expect(within(alertaErro).getByRole('button', { name: /Escolher Perfil local/i })).toBeInTheDocument()
    expect(within(alertaErro).getByRole('button', { name: /Ver veto do Projeto/i })).toBeInTheDocument()
    r2.unmount()

    // 3. Fonte V1 offline exibe aviso não bloqueante e erro transcript_incomplete na execução oferece Abrir Transcrição
    window.location.hash = '#/projeto/demo/cortes?fonte=2'
    const storeOffline = criarStoreFontesProjeto()
    mockSelecaoBase({
      'selection.list': () => {
        throw new ErroCore('transcript_incomplete', 'Transcrição incompleta')
      },
    })
    render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          fonteParam="2"
          storeFontes={storeOffline}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText(/Fonte offline no disco/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Selecionar Cortes' })).toBeEnabled()
    const alertaTransc = await screen.findByRole('alert')
    expect(within(alertaTransc).getByRole('button', { name: /Abrir Transcrição/i })).toBeInTheDocument()
  })

  it('em execução parcial com janela uncertain, bloqueia "Retomar janelas pendentes" com <Dica> sem expor ticket (UI-12) e abre <DialogoResolverIncerteza>', async () => {
    const user = userEvent.setup()
    const janelasIncertas = criarJanelasPadrao().map((w) =>
      w.index === 2
        ? { ...w, state: 'uncertain', jobId: 2, code: 'timeout_uncertain' }
        : w.index === 1
          ? { ...w, state: 'failed', code: 'rate_limit' }
          : w,
    )
    mockSelecaoBase({
      'selection.list': () => [
        criarRunBase({
          state: 'partial',
          counts: { windows: 3, completed: 1, failed: 2, kept: 1, discarded: 0, merged: 0 },
        }),
      ],
      'selection.get': () => ({
        run: criarRunBase({
          state: 'partial',
          counts: { windows: 3, completed: 1, failed: 2, kept: 1, discarded: 0, merged: 0 },
        }),
        windows: janelasIncertas,
        candidates: criarCandidatosPadrao(2),
      }),
    })

    render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Chamada paga incerta/i)

    const btnRetomar = screen.getByRole('button', { name: /Retomar janelas pendentes/i })
    expect(btnRetomar).toBeDisabled()

    // Dica acessível ao focar o gatilho envolvente do botão desabilitado, sem referência de ticket (#\d+)
    const gatilhoDica = btnRetomar.closest('[tabindex="0"]') as HTMLElement
    expect(gatilhoDica).not.toBeNull()
    await user.hover(gatilhoDica)
    const dicaTexto = await screen.findByText(
      /Há janela incerta nesta execução; resolva na Fila antes de retomar\./i,
    )
    expect(dicaTexto).toBeInTheDocument()
    expect(dicaTexto.textContent ?? '').not.toMatch(/#\d+/)

    // Varredura UI-12 no texto renderizado e na Dica (excluindo o identificador "Execução #<id>")
    expect(alerta.textContent ?? '').not.toMatch(/#\d+/)
    const textoSemExecucaoId = (document.body.textContent ?? '').replace(/Execução(?::\s*|\s+)#\d+/g, '')
    expect(textoSemExecucaoId).not.toMatch(/#\d+/)

    // Resolver na Fila abre <DialogoResolverIncerteza> e chama jobs.estimate
    const btnResolver = within(alerta).getByRole('button', { name: /Resolver na Fila/i })
    await user.click(btnResolver)

    const dlgIncerteza = await screen.findByRole('alertdialog')
    expect(dlgIncerteza).toHaveTextContent(/Resolver chamada incerta/i)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.estimate', { id: 2 })
    })
  })

  it('trata budgetPause com jobs.budget.get -> ConfirmDialog -> jobs.budget.continue e alterna Revisão (tablist <= 5 e Select > 5) atualizando ?rev=', async () => {
    const user = userEvent.setup()

    // 1. budgetPause + tablist (<= 5 revisões)
    mockSelecaoBase({
      'selection.list': () => [criarRunBase({ state: 'partial', budgetPause: 'cost_unknown' })],
      'selection.get': (args) => {
        const rev = (args as { revision?: number })?.revision ?? 2
        return {
          run: criarRunBase({ state: 'partial', budgetPause: 'cost_unknown', revision: rev, revisions: [1, 2] }),
          windows: criarJanelasPadrao(),
          candidates: criarCandidatosPadrao(rev),
        }
      },
    })

    const r1 = render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByText(/Seleção pausada pelo teto de orçamento/i)).toBeInTheDocument()
    const tablist = screen.getByRole('tablist', { name: /Revisão da execução/i })
    const tabRev1 = within(tablist).getByRole('tab', { name: /Rev\. 1/i })
    await user.click(tabRev1)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.get', { run: 1, revision: 1 })
    })
    expect(window.location.hash).toContain('rev=1')

    await user.click(screen.getByRole('button', { name: /Ajustar orçamento e continuar/i }))
    const dlgBudget = await screen.findByRole('alertdialog')
    const checkDesconhecido = within(dlgBudget).getByRole('checkbox', {
      name: /custo.*desconhecido/i,
    })
    await user.click(checkDesconhecido)
    await user.click(within(dlgBudget).getByRole('button', { name: /Continuar execução/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'jobs.budget.continue',
        expect.objectContaining({ scope: 'task', key: 'selection', confirmed: true }),
      )
    })
    r1.unmount()

    // 2. > 5 revisões usa <Select> em vez de tablist
    const storeSelect = criarStoreFontesProjeto()
    mockSelecaoBase({
      'selection.list': () => [criarRunBase({ revision: 6, revisions: [1, 2, 3, 4, 5, 6] })],
      'selection.get': () => ({
        run: criarRunBase({ revision: 6, revisions: [1, 2, 3, 4, 5, 6] }),
        windows: criarJanelasPadrao(),
        candidates: criarCandidatosPadrao(6),
      }),
    })
    render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeSelect}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByRole('combobox', { name: /Revisão da execução/i })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: /Revisão da execução/i })).not.toBeInTheDocument()
  })

  it('atualiza progresso determinístico via core-progress (selection:window / selection:done) sem setInterval, permite cancelar e habilita Abrir bancada de revisão', async () => {
    const user = userEvent.setup()
    let execucaoEstado: 'running' | 'completed' = 'running'

    mockSelecaoBase({
      'selection.list': () => [
        criarRunBase({
          state: execucaoEstado,
          counts:
            execucaoEstado === 'running'
              ? { windows: 3, completed: 1, failed: 0, kept: 0, discarded: 0, merged: 0 }
              : { windows: 3, completed: 3, failed: 0, kept: 2, discarded: 0, merged: 1 },
        }),
      ],
      'selection.get': () => ({
        run: criarRunBase({
          state: execucaoEstado,
          counts:
            execucaoEstado === 'running'
              ? { windows: 3, completed: 1, failed: 0, kept: 0, discarded: 0, merged: 0 }
              : { windows: 3, completed: 3, failed: 0, kept: 2, discarded: 0, merged: 1 },
        }),
        windows: criarJanelasPadrao().map((w) => ({
          ...w,
          state: execucaoEstado === 'completed' ? 'completed' : w.index === 0 ? 'completed' : w.index === 1 ? 'running' : 'queued',
        })),
        candidates: execucaoEstado === 'completed' ? criarCandidatosPadrao(2) : [],
      }),
    })

    render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByText(/1 de 3 Janelas concluídas/i)).toBeInTheDocument()
    const btnBancada = screen.getByRole('button', { name: /Abrir bancada de revisão/i })
    expect(btnBancada).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar seleção' })).toBeInTheDocument()

    await act(async () => {
      filaTeste.aplicar({
        job: '11',
        project: 'demo',
        stage: 'ai:selection:call',
        percentage: 10,
        message: 'Consultando Provedor',
        error: null,
      })
    })
    expect((await screen.findAllByText(/Enviando ao Provedor/i)).length).toBeGreaterThanOrEqual(1)

    await act(async () => {
      execucaoEstado = 'completed'
      filaTeste.aplicar({
        job: 'selection-1',
        project: 'demo',
        stage: 'selection:done',
        percentage: 100,
        message: 'Seleção concluída',
        error: null,
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abrir bancada de revisão/i })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /Abrir bancada de revisão/i }))
    expect(window.location.hash).toBe('#/projeto/demo/cortes/revisao/1?rev=2')
  })

  it('aciona Refazer janela (selection.redo), exibe resetAtMs em provider_daily_limit e pede ConfirmDialog ao cancelar seleção paga', async () => {
    const user = userEvent.setup()
    const resetMs = new Date(2026, 10, 18, 19, 30).getTime()
    let execEstado: 'running' | 'partial' = 'partial'

    mockSelecaoBase({
      'selection.list': () => [criarRunBase({ state: execEstado })],
      'selection.get': () => ({
        run: criarRunBase({ state: execEstado }),
        windows: criarJanelasPadrao().map((w) =>
          w.index === 1
            ? { ...w, state: execEstado === 'running' ? 'running' : 'failed', code: execEstado === 'running' ? null : 'provider_daily_limit', resetAtMs: execEstado === 'running' ? null : resetMs }
            : w,
        ),
        candidates: criarCandidatosPadrao(2),
      }),
    })

    const { unmount } = render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByText(/retoma às/i)).toBeInTheDocument()
    const btnRefazerJanela = screen.getByRole('button', { name: 'Refazer janela' })
    await user.click(btnRefazerJanela)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.redo', {
        run: 1,
        windows: [1],
        confirmed: true,
      })
    })
    unmount()

    // Agora testa cancelamento em seleção paga em andamento
    const storeRunning = criarStoreFontesProjeto()
    execEstado = 'running'
    render(
      envolver(
        <Selecao
          projetoId="demo"
          projetoPath="/projetos/Demo2.clipes"
          storeFontes={storeRunning}
          fila={filaTeste}
        />,
      ),
    )
    const btnCancelar = await screen.findByRole('button', { name: 'Cancelar seleção' })
    await user.click(btnCancelar)

    const dlgCancel = await screen.findByRole('alertdialog')
    expect(dlgCancel).toHaveTextContent(/incerta/i)
    await user.click(within(dlgCancel).getByRole('button', { name: 'Cancelar seleção' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.cancel', { run: 1 })
    })
  })
})
