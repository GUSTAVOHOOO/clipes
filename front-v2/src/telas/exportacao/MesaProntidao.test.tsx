import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import {
  criarStoreExportacaoProjeto,
  useExportacaoProjeto,
  type CorteAprovadoProntidao,
  type RespostaGuardrails,
  type ResultadoUseExportacaoProjeto,
} from '~/stores/exportacaoProjeto'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import { MesaProntidao } from '~/telas/exportacao/MesaProntidao'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
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

const FONTES_MOCK: FonteProjeto[] = [
  {
    id: 4,
    path: '/videos/Live_12_11_final.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: 'https://youtube.com/watch?v=live1',
    language: 'pt',
    permission: { status: 'granted', who: 'Criador Tech', where: 'Discord', scope: 'cortes' },
  },
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
  },
]

const APROVADOS_BASE: CorteAprovadoProntidao[] = [
  {
    candidateId: 102,
    runId: 1,
    sourceId: 4,
    clipId: null,
    videoKind: 'direct',
    candidateTitle: 'Corte V1 sem empacotamento',
    scoreTotal: 8.4,
    adjusted: false,
    startId: 40,
    endId: 41,
    startUs: 390_000_000,
    endUs: 410_000_000,
    durationUs: 20_000_000,
    source: {
      id: 4,
      name: 'Live_12_11_final.mp4',
      path: '/videos/Live_12_11_final.mp4',
      status: 'available',
      available: true,
      online: true,
      permission: FONTES_MOCK[0].permission,
    },
    packaging: { current: null },
    thumbnail: { current: null },
    script: { applicable: false },
    narration: { applicable: false },
    guardrails: {
      scope: 'single',
      needsDirectNotice: true,
      videoKind: 'direct',
      durationUs: 20_000_000,
      over60s: false,
      permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1 },
      script: { applicable: false },
      narration: { applicable: false },
      audio: { hasAudio: true, assetCount: 1, unverifiedCount: 1 },
    },
  },
  {
    candidateId: 202,
    runId: 2,
    sourceId: 4,
    clipId: null,
    videoKind: 'transformed',
    candidateTitle: 'A virada que mudou o jogo',
    scoreTotal: 8.9,
    adjusted: false,
    startId: 10,
    endId: 14,
    startUs: 90_000_000,
    endUs: 162_000_000,
    durationUs: 72_000_000,
    source: {
      id: 4,
      name: 'Live_12_11_final.mp4',
      path: '/videos/Live_12_11_final.mp4',
      status: 'available',
      available: true,
      online: true,
      permission: FONTES_MOCK[0].permission,
    },
    packaging: { current: { title: 'Empacotado: A virada do jogo' } },
    thumbnail: { current: { id: 1, instantUs: 110_000_000, origin: 'provider' } },
    script: { applicable: true, exists: true, approved: false, pendingBlocks: 2, totalBlocks: 3 },
    narration: {
      applicable: true,
      hasTts: true,
      generatedBlocks: 1,
      readyBlocks: 1,
      ready: false,
      totalBlocks: 3,
      freezeTailUs: 6_500_000,
      longFreezeTail: true,
    },
    guardrails: {
      scope: 'single',
      needsDirectNotice: false,
      videoKind: 'transformed',
      durationUs: 72_000_000,
      over60s: true,
      permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1 },
      script: { applicable: true, exists: true, approved: false, pendingBlocks: 2, totalBlocks: 3 },
      narration: {
        applicable: true,
        hasTts: true,
        generatedBlocks: 1,
        readyBlocks: 1,
        ready: false,
        totalBlocks: 3,
        freezeTailUs: 6_500_000,
        longFreezeTail: true,
      },
      audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
    },
  },
  {
    candidateId: 301,
    runId: 3,
    sourceId: 2,
    clipId: null,
    videoKind: 'transformed',
    candidateTitle: 'Corte legado offline',
    scoreTotal: 7.8,
    adjusted: false,
    startId: 10,
    endId: 14,
    startUs: 90_000_000,
    endUs: 140_000_000,
    durationUs: 50_000_000,
    source: {
      id: 2,
      name: 'offline.mp4',
      path: '/videos/offline.mp4',
      status: 'offline',
      available: false,
      online: false,
      permission: FONTES_MOCK[1].permission,
    },
    packaging: { current: { title: 'Corte legado da live antiga' } },
    thumbnail: { current: { id: 2, instantUs: 95_000_000, origin: 'user' } },
    script: { applicable: true, exists: true, approved: true, pendingBlocks: 0, totalBlocks: 3 },
    narration: {
      applicable: true,
      hasTts: true,
      generatedBlocks: 1,
      readyBlocks: 3,
      ready: true,
      totalBlocks: 3,
      freezeTailUs: 0,
      longFreezeTail: false,
    },
    guardrails: {
      scope: 'single',
      needsDirectNotice: false,
      videoKind: 'transformed',
      durationUs: 50_000_000,
      over60s: false,
      permission: { status: 'none', grantedCount: 0, missingCount: 1, totalCount: 1 },
      script: { applicable: true, exists: true, approved: true, pendingBlocks: 0, totalBlocks: 3 },
      narration: {
        applicable: true,
        hasTts: true,
        generatedBlocks: 1,
        readyBlocks: 3,
        ready: true,
        totalBlocks: 3,
        freezeTailUs: 0,
        longFreezeTail: false,
      },
      audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
    },
  },
]

const GUARDRAILS_PROJETO_BASE: RespostaGuardrails = {
  scope: 'project',
  directMonetizationAck: false,
  needsDirectNotice: true,
  videoKind: 'mixed',
  hasDirect: true,
  hasTransformed: true,
  totalCuts: 3,
  over60sCount: 1,
  permission: { status: 'partial', grantedCount: 2, missingCount: 1, totalCount: 3 },
  script: { applicable: true, transformedCount: 2, approvedCount: 1, unapprovedCount: 1 },
  narration: {
    applicable: true,
    hasTts: true,
    ttsCutCount: 2,
    transformedCount: 2,
    freezeTailCount: 1,
    longFreezeTailCount: 1,
    maxFreezeTailUs: 6_500_000,
  },
  audio: { hasAudio: true, assetCount: 1, cutsWithAudio: 1, cutsWithUnverifiedAudio: 1, unverifiedCount: 1 },
}

function criarExportacaoMock(
  overrides: Partial<ResultadoUseExportacaoProjeto> = {},
): ResultadoUseExportacaoProjeto {
  return {
    projetoPath: '/projetos/Demo.clipes',
    carregando: false,
    carregandoMais: false,
    atualizandoProntidao: false,
    erro: null,
    erroProntidao: null,
    fontes: FONTES_MOCK,
    aprovados: APROVADOS_BASE,
    totalAprovados: APROVADOS_BASE.length,
    totalProjeto: APROVADOS_BASE.length,
    filtroFonteId: null,
    temMais: false,
    guardrailsProjeto: GUARDRAILS_PROJETO_BASE,
    guardrailsPorFonte: {},
    settings: { last_directory: '/test/exports' },
    encoder: {
      ffmpeg: true,
      detected: true,
      stale: false,
      passed: ['h264_nvenc', 'libx264'],
      selected: 'h264_nvenc',
      manual: null,
      effective: 'h264_nvenc',
      gpu: 'NVIDIA RTX 3050',
      detected_at: 1000,
    },
    lotes: [],
    recarregar: vi.fn().mockResolvedValue(undefined),
    recarregarLotes: vi.fn().mockResolvedValue([]),
    carregarMais: vi.fn().mockResolvedValue(undefined),
    filtrarPorFonte: vi.fn().mockResolvedValue(undefined),
    atualizarProntidao: vi.fn().mockResolvedValue(undefined),
    tentarNovamenteProntidao: vi.fn().mockResolvedValue(undefined),
    carregarGuardrailsEscopo: vi.fn().mockResolvedValue(GUARDRAILS_PROJETO_BASE),
    ...overrides,
  }
}

function renderizar(
  exportacao: ResultadoUseExportacaoProjeto,
  aoAbrirLote = vi.fn(),
) {
  return render(
    <ProvedorDicas>
      <ProvedorToast>
        <MesaProntidao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          exportacao={exportacao}
          aoAbrirLote={aoAbrirLote}
        />
      </ProvedorToast>
    </ProvedorDicas>,
  )
}

describe('MesaProntidao', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    window.location.hash = '#/projeto/demo/exportacao'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'guardrails.check') return APROVADOS_BASE[0].guardrails
      if (cmd === 'export.captions') return { missingGlyphs: [], emojiRemoved: 0 }
      if (cmd === 'export.settings') return { last_directory: '/test/exports' }
      return null
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza cards a partir do resumo de export.readiness, paginação e "Atualizar prontidão em lote" habilitado', async () => {
    const user = userEvent.setup()
    const carregarMais = vi.fn().mockResolvedValue(undefined)
    const atualizarProntidao = vi.fn().mockResolvedValue(undefined)
    const exp = criarExportacaoMock({ temMais: true, carregarMais, atualizarProntidao })
    renderizar(exp)

    // Card V1 sem Empacotamento exibe candidateTitle + etiqueta explícita e "Sem capa"
    const card102 = screen.getByRole('article', { name: /Corte V1 sem empacotamento/i })
    expect(within(card102).getByText(/Título sugerido \(sem Empacotamento\)/i)).toBeInTheDocument()
    expect(within(card102).getByText('Corte direto')).toBeInTheDocument()
    expect(within(card102).getByText('Sem capa')).toBeInTheDocument()
    expect(within(card102).getByText('Sem Empacotamento')).toBeInTheDocument()
    expect(within(card102).getByText('Áudio sem licença')).toBeInTheDocument()
    expect(within(card102).getByText('20 s')).toBeInTheDocument()

    // Card 202 (Vídeo transformado) exibe Empacotado, Roteiro pendente (2), Narração pendente, Sobra final > 5 s e Acima de 60 s
    const card202 = screen.getByRole('article', { name: /Empacotado: A virada do jogo/i })
    expect(within(card202).getByText('Vídeo transformado')).toBeInTheDocument()
    expect(within(card202).getByText('Capa escolhida')).toBeInTheDocument()
    expect(within(card202).getByText(/Roteiro pendente \(2\)/i)).toBeInTheDocument()
    expect(within(card202).getByText('Narração pendente')).toBeInTheDocument()
    expect(within(card202).getByText(/Sobra final > 5 s/i)).toBeInTheDocument()
    expect(within(card202).getByText(/Acima de 60 s/i)).toBeInTheDocument()

    // Card 301 (Fonte offline, mas com narration.ready === true mesmo com generatedBlocks < totalBlocks)
    const card301 = screen.getByRole('article', { name: /Corte legado da live antiga/i })
    expect(within(card301).getByText('Fonte indisponível')).toBeInTheDocument()
    expect(within(card301).getByText('Sem Permissão')).toBeInTheDocument()
    expect(within(card301).getByText('Narração pronta')).toBeInTheDocument()

    // Paginação incremental
    const btnCarregarMais = screen.getByRole('button', { name: /Carregar mais/i })
    await user.click(btnCarregarMais)
    expect(carregarMais).toHaveBeenCalledTimes(1)

    // Botão "Atualizar prontidão em lote" habilitado e aciona atualizarProntidao()
    const btnReadiness = screen.getByRole('button', { name: /Atualizar prontidão em lote/i })
    expect(btnReadiness).toBeEnabled()
    await user.click(btnReadiness)
    expect(atualizarProntidao).toHaveBeenCalledTimes(1)

    // Busca por título filtrando para 0 itens e "Limpar filtros"
    const busca = screen.getByRole('searchbox', { name: /Buscar título do Corte/i })
    await user.type(busca, 'inexistente-xyz')
    expect(screen.getByText(/Nenhum Corte aprovado corresponde aos filtros/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getByRole('article', { name: /Empacotado: A virada do jogo/i })).toBeInTheDocument()
  })

  it('filtra por Fonte acionando filtrarPorFonte(sourceId) e exibe BannerErroCore com recuperação ao falhar', async () => {
    const user = userEvent.setup()
    const filtrarPorFonte = vi.fn().mockResolvedValue(undefined)
    const tentarNovamenteProntidao = vi.fn().mockResolvedValue(undefined)
    const exp = criarExportacaoMock({
      filtrarPorFonte,
      tentarNovamenteProntidao,
      erroProntidao: new ErroCore('project_read', 'Falha ao ler prontidão.'),
    })
    renderizar(exp)

    // BannerErroCore visível com ação "Tentar de novo"
    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent('Ver detalhe técnico')
    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }))
    expect(tentarNovamenteProntidao).toHaveBeenCalledTimes(1)

    // Seleciona uma Fonte no Select "Filtrar por Fonte"
    const selectFonte = screen.getByRole('combobox', { name: /Filtrar por Fonte/i })
    await user.click(selectFonte)
    const opcaoLive = await screen.findByRole('option', { name: 'Live_12_11_final.mp4' })
    await user.click(opcaoLive)
    expect(filtrarPorFonte).toHaveBeenCalledWith(4)
  })

  it('integração MesaProntidao + store: 1 chamada export.readiness por página, filtro source_id e atualização em lote', async () => {
    const user = userEvent.setup()
    const chamadasReadiness: Record<string, unknown>[] = []
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === 'sources.list') return FONTES_MOCK
      if (cmd === 'export.settings') return { last_directory: '/test/exports' }
      if (cmd === 'export.encoder.status') {
        return { ffmpeg: true, detected: true, stale: false, passed: ['h264_nvenc'], selected: 'h264_nvenc', manual: null, effective: 'h264_nvenc', gpu: 'RTX', detected_at: 100 }
      }
      if (cmd === 'export.batch.list') return []
      if (cmd === 'guardrails.check') return GUARDRAILS_PROJETO_BASE
      if (cmd === 'export.readiness') {
        chamadasReadiness.push(args)
        const sid = typeof args.source_id === 'number' ? args.source_id : null
        const items = sid === null ? APROVADOS_BASE : APROVADOS_BASE.filter((c) => c.sourceId === sid)
        return { total: items.length, offset: 0, limit: 12, hasMore: false, items }
      }
      return null
    })

    const store = criarStoreExportacaoProjeto()
    const fila = criarFila(() => 'demo')
    const { result } = renderHook(() => useExportacaoProjeto('/projetos/Demo.clipes', { store, fila }))
    await waitFor(() => expect(result.current.carregando).toBe(false))
    expect(chamadasReadiness).toEqual([{ offset: 0, limit: 12 }])

    const Wrapper = () => {
      const exp = useExportacaoProjeto('/projetos/Demo.clipes', { store, fila })
      return (
        <ProvedorDicas>
          <ProvedorToast>
            <MesaProntidao
              projetoId="demo"
              projetoPath="/projetos/Demo.clipes"
              exportacao={exp}
              aoAbrirLote={vi.fn()}
            />
          </ProvedorToast>
        </ProvedorDicas>
      )
    }

    render(<Wrapper />)
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(chamadasReadiness).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /Atualizar prontidão em lote/i }))
    await waitFor(() => expect(chamadasReadiness).toHaveLength(2))
    expect(chamadasReadiness[1]).toEqual({ offset: 0, limit: 12 })

    await user.click(screen.getByRole('combobox', { name: /Filtrar por Fonte/i }))
    await user.click(await screen.findByRole('option', { name: 'offline.mp4' }))
    await waitFor(() => expect(chamadasReadiness).toHaveLength(3))
    expect(chamadasReadiness[2]).toEqual({ offset: 0, limit: 12, source_id: 2 })
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('navega para Empacotar/Transformar/Relocalizar, abre DialogoExportarCorte em "Exportar só este" e exibe Dicas #292 e #303', async () => {
    const user = userEvent.setup()
    const exp = criarExportacaoMock()
    renderizar(exp)

    // Transformar no card 202
    const card202 = screen.getByRole('article', { name: /Empacotado: A virada do jogo/i })
    await user.click(within(card202).getByRole('button', { name: 'Transformar' }))
    expect(window.location.hash).toBe('#/projeto/demo/corte/202/transformar?run=2')

    // Empacotar no card 102
    const card102 = screen.getByRole('article', { name: /Corte V1 sem empacotamento/i })
    await user.click(within(card102).getByRole('button', { name: 'Empacotar' }))
    expect(window.location.hash).toBe('#/projeto/demo/corte/102/empacotar?run=1')

    // Relocalizar Fonte no card 301
    const card301 = screen.getByRole('article', { name: /Corte legado da live antiga/i })
    await user.click(within(card301).getByRole('button', { name: 'Relocalizar Fonte' }))
    expect(window.location.hash).toBe('#/projeto/demo/fontes/2')

    // Dica da ação indisponível "Converter em Vídeo transformado" (#292) sem expor número de ticket (UI-12)
    const btnConverter = within(card102).getByRole('button', { name: /Converter em Vídeo transformado/i })
    expect(btnConverter).toHaveAttribute('aria-disabled', 'true')
    expect(btnConverter.parentElement?.getAttribute('tabindex')).toBeNull()
    await user.hover(btnConverter)
    const dicaConverter = await screen.findByText(
      /conversão individual para Vídeo transformado ainda não está disponível nesta versão/i,
    )
    expect(dicaConverter).toBeInTheDocument()
    expect(dicaConverter.textContent).not.toMatch(/#\d+/)

    // Dica da ação indisponível "Salvar pasta padrão" (#303) sem expor ticket nem comando interno (UI-12)
    const btnSalvarPasta = screen.getByRole('button', { name: /Salvar pasta padrão/i })
    expect(btnSalvarPasta).toHaveAttribute('aria-disabled', 'true')
    expect(document.querySelectorAll('span[tabindex="0"]')).toHaveLength(0)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Cortes aprovados' }),
    ).toBeInTheDocument()
    await user.hover(btnSalvarPasta)
    const dicaPasta = await screen.findByText(
      /salvar a pasta padrão sem exportar ainda não está disponível nesta versão/i,
    )
    expect(dicaPasta).toBeInTheDocument()
    expect(dicaPasta.textContent).not.toMatch(/#\d+|export\.settings/)

    // "Exportar só este" no card 102 abre <DialogoExportarCorte>
    await user.click(within(card102).getByRole('button', { name: 'Exportar só este' }))
    expect(await screen.findByRole('dialog', { name: /Exportar Corte em MP4/i })).toBeInTheDocument()
  })

  it('bloqueia exportação em lote quando !ffmpeg e exibe CTA para #/config/componentes', async () => {
    const user = userEvent.setup()
    const exp = criarExportacaoMock({
      encoder: {
        ffmpeg: false,
        detected: false,
        stale: false,
        passed: [],
        selected: 'libx264',
        manual: null,
        effective: 'libx264',
        gpu: '',
        detected_at: null,
      },
    })
    renderizar(exp)

    const btnExportar = screen.getByRole('button', { name: /Exportar 3 aprovados em lote/i })
    expect(btnExportar).toBeDisabled()

    const ctaFfmpeg = screen.getByRole('button', { name: /Instalar FFmpeg em Componentes/i })
    await user.click(ctaFfmpeg)
    expect(window.location.hash).toBe('#/config/componentes')
  })

  it('executa fluxo completo: needsDirectNotice -> guardrails.ack_direct_notice -> export.batch.start (project) -> confirmation_required (conflicts) -> confirmed: true', async () => {
    const user = userEvent.setup()
    const aoAbrirLote = vi.fn()
    const carregarGuardrailsEscopo = vi.fn().mockResolvedValue({
      ...GUARDRAILS_PROJETO_BASE,
      directMonetizationAck: true,
      needsDirectNotice: false,
    })
    const recarregarLotes = vi.fn().mockResolvedValue([])

    let tentativasStart = 0
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'guardrails.ack_direct_notice') {
        return { directMonetizationAck: true }
      }
      if (cmd === 'export.batch.start') {
        tentativasStart += 1
        if (tentativasStart === 1 && !args.confirmed) {
          throw new ErroCore('confirmation_required', 'Alguns arquivos já existem na pasta de saída.', {
            conflicts: ['live-01-06m30s.mp4', 'live-02-01m30s.mp4'],
          })
        }
        return {
          id: 6410,
          scope: 'project',
          sourceId: null,
          outputDir: '/test/exports',
          state: 'running',
          status: 'running',
          progress: 0,
          counts: { total: 3, queued: 3, running: 0, completed: 0, failed: 0, cancelled: 0 },
          items: [],
        }
      }
      return null
    })

    const exp = criarExportacaoMock({
      carregarGuardrailsEscopo,
      recarregarLotes,
    })
    renderizar(exp, aoAbrirLote)

    // Só deve existir 1 botão primário (bg-sinal) na tela
    const btnExportar = screen.getByRole('button', { name: /Exportar 3 aprovados em lote/i })
    expect(btnExportar).toBeEnabled()
    expect(document.querySelectorAll('button.bg-sinal')).toHaveLength(1)

    await user.click(btnExportar)

    // 1) ConfirmDialog do aviso de Corte direto (foco inicial em Cancelar)
    const dlgDireto = await screen.findByRole('alertdialog')
    expect(dlgDireto).toHaveTextContent(/Corte direto/i)
    // Luz Única: atrás do modal o botão da tela deixa de acender (UI-84)
    expect(btnExportar).not.toHaveClass('bg-sinal')
    await waitFor(() => {
      expect(within(dlgDireto).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dlgDireto).getByRole('button', { name: /Entendi e continuar/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('guardrails.ack_direct_notice', {})
      expect(chamarMock).toHaveBeenCalledWith('export.batch.start', {
        project: '/projetos/Demo.clipes',
        output_dir: '/test/exports',
      })
    })

    // 2) ConfirmDialog de conflitos de sobrescrita listando os arquivos
    const dlgConflitos = await screen.findByRole('alertdialog')
    expect(dlgConflitos).toHaveTextContent('live-01-06m30s.mp4')
    expect(dlgConflitos).toHaveTextContent('live-02-01m30s.mp4')
    await waitFor(() => {
      expect(within(dlgConflitos).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dlgConflitos).getByRole('button', { name: /Sobrescrever e exportar/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.batch.start', {
        project: '/projetos/Demo.clipes',
        output_dir: '/test/exports',
        confirmed: true,
      })
    })
    await act(async () => {})
    expect(aoAbrirLote).toHaveBeenCalledWith(6410)
  })
})
