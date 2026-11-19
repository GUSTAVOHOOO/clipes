import { ProvedorDicas, ProvedorToast } from '@ds'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import type { ResultadoUseExportacaoProjeto, StoreExportacaoProjeto } from '~/stores/exportacaoProjeto'
import type { LoteExportacao } from '~/stores/filaGlobal'
import { Exportacao } from '~/telas/exportacao/Exportacao'

let estadoMockUseExportacao: ResultadoUseExportacaoProjeto

vi.mock('~/stores/exportacaoProjeto', async () => {
  const atual = await vi.importActual<typeof import('~/stores/exportacaoProjeto')>(
    '~/stores/exportacaoProjeto',
  )
  return {
    ...atual,
    useExportacaoProjeto: () => estadoMockUseExportacao,
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

function criarEstado(
  overrides: Partial<ResultadoUseExportacaoProjeto> = {},
): ResultadoUseExportacaoProjeto {
  return {
    projetoPath: '/projetos/Demo.clipes',
    carregando: false,
    carregandoMais: false,
    erro: null,
    fontes: [
      {
        id: 4,
        path: '/videos/Live.mp4',
        status: 'available',
        available: true,
        verified: true,
        audio_track: 1,
        origin_url: null,
        language: 'pt',
        permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes' },
      },
    ],
    aprovados: [
      {
        candidateId: 102,
        runId: 1,
        sourceId: 4,
        sourceName: 'Live.mp4',
        sourceStatus: 'available',
        permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes' },
        videoKind: 'direct',
        startId: 40,
        endId: 41,
        startUs: 390_000_000,
        endUs: 410_000_000,
        durationUs: 20_000_000,
        adjusted: false,
        scoreTotal: 8.4,
        candidateTitle: 'Corte V1 pronto',
      },
    ],
    paginaAtual: 1,
    temMais: false,
    detalhesPorCandidato: {
      102: {
        candidateId: 102,
        packaging: { current: null },
        thumbnail: { current: null },
        guardrails: {
          scope: 'single',
          needsDirectNotice: false,
          videoKind: 'direct',
          durationUs: 20_000_000,
          over60s: false,
          permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1 },
          script: { applicable: false },
          narration: { applicable: false },
          audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
        },
      },
    },
    guardrailsProjeto: {
      scope: 'project',
      directMonetizationAck: true,
      needsDirectNotice: false,
      videoKind: 'direct',
      hasDirect: true,
      hasTransformed: false,
      totalCuts: 1,
      over60sCount: 0,
      permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1 },
      script: { applicable: false },
      narration: { applicable: false },
      audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
    },
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
      gpu: 'RTX 3050',
      detected_at: 100,
    },
    lotes: [],
    recarregar: vi.fn().mockResolvedValue(undefined),
    recarregarLotes: vi.fn().mockResolvedValue([]),
    carregarMais: vi.fn().mockResolvedValue(undefined),
    garantirDetalhesParaIds: vi.fn().mockResolvedValue(undefined),
    carregarGuardrailsEscopo: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

function renderizar(sub: 'prontidao' | 'lotes' = 'prontidao') {
  return render(
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>
          <div data-tela>
            <header data-regiao="topo">
              <button type="button">Topo</button>
            </header>
            <main data-regiao="conteudo">
              <Exportacao
                projetoId="demo"
                projetoPath="/projetos/Demo.clipes"
                sub={sub}
                store={{} as StoreExportacaoProjeto}
              />
            </main>
            <footer data-regiao="rodape">
              <button type="button">Rodapé</button>
            </footer>
          </div>
        </ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>,
  )
}

describe('Exportacao (#/projeto/:id/exportacao)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/projeto/demo/exportacao'
    estadoMockUseExportacao = criarEstado()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('estado loading exibe Skeletons e NUNCA mostra "Nenhum Corte aprovado"', () => {
    estadoMockUseExportacao = criarEstado({ carregando: true, aprovados: [] })
    renderizar('prontidao')

    expect(screen.getByRole('heading', { level: 1, name: 'Exportação' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /Carregando Mesa de Prontidão/i })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /Carregando configuração do lote/i })).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum Corte aprovado/i)).not.toBeInTheDocument()
  })

  it('estado empty em prontidao e lotes exibe mensagem e CTA exatos', async () => {
    const user = userEvent.setup()
    estadoMockUseExportacao = criarEstado({ aprovados: [], lotes: [] })
    const { rerender } = renderizar('prontidao')

    expect(screen.getByText('Nenhum Corte aprovado para exportar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ir para Cortes' }))
    expect(window.location.hash).toBe('#/projeto/demo/cortes')

    rerender(
      <ProvedorDicas>
        <ProvedorToast>
          <ProvedorAtalhos>
            <Exportacao
              projetoId="demo"
              projetoPath="/projetos/Demo.clipes"
              sub="lotes"
              store={{} as StoreExportacaoProjeto}
            />
          </ProvedorAtalhos>
        </ProvedorToast>
      </ProvedorDicas>,
    )

    expect(screen.getByText('Nenhum lote exportado ainda')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Voltar para Prontidão e Lote' }))
    expect(window.location.hash).toBe('#/projeto/demo/exportacao?sub=prontidao')
  })

  it.each([
    ['project_not_open', /Nenhum Projeto está aberto no momento\./i],
    ['export_batch_empty', /Não há Cortes aprovados neste escopo para exportar\./i],
    ['export_destination', /pasta existente e um nome terminado em \.mp4/i],
    ['component_missing', /componente ou modelo necessário/i],
    ['export_ass_missing', /não foi possível renderizar o vídeo com as legendas atuais/i],
    ['export_font_missing', /não foi possível renderizar o vídeo com as legendas atuais/i],
    ['export_glyph_missing', /fonte da legenda não possui alguns caracteres/i],
    ['source_changed', /arquivo da Fonte foi movido, apagado ou alterado/i],
    ['audio_asset_missing', /trilha sonora ou efeito sonoro/i],
    ['export_exists', /Já existe um arquivo com esse nome/i],
    ['export_bounds', /bordas ou a aprovação deste Corte mudaram/i],
    ['insufficient_space', /Espaço livre insuficiente/i],
    ['export_failed', /não foi possível renderizar o vídeo com as legendas atuais/i],
    ['batch_not_found', /lote de exportação não foi encontrado/i],
  ])('estado error traduz código %s em role="alert" humano', (code, textoEsperado) => {
    estadoMockUseExportacao = criarEstado({
      erro: new ErroCore(code, `detalhe-${code}`),
    })
    renderizar('prontidao')

    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent(textoEsperado)
    expect(alerta).toHaveTextContent('Ver detalhe técnico')
  })

  it('estados job_running e partial mantêm a Mesa interativa e exibem progresso/falha parcial', async () => {
    const user = userEvent.setup()
    const loteAtivo: LoteExportacao = {
      id: 6411,
      scope: 'project',
      sourceId: null,
      outputDir: '/test/exports',
      state: 'running',
      status: 'running',
      progress: 45,
      counts: { total: 4, queued: 2, running: 1, completed: 1, failed: 0, cancelled: 0 },
      items: [],
    }
    const loteParcial: LoteExportacao = {
      id: 6399,
      scope: 'project',
      sourceId: null,
      outputDir: '/test/exports',
      state: 'completed',
      status: 'partial',
      progress: 100,
      counts: { total: 3, queued: 0, running: 0, completed: 2, failed: 1, cancelled: 0 },
      items: [
        {
          position: 0,
          sourceId: 4,
          candidateId: 102,
          clipId: null,
          jobId: 1,
          title: 'Falho',
          filename: 'f.mp4',
          durationUs: 10_000_000,
          state: 'failed',
          progress: 0,
          error: { code: 'source_changed', message: 'alterado' },
          encoder: null,
          encoderFallback: null,
        },
      ],
    }

    estadoMockUseExportacao = criarEstado({ lotes: [loteAtivo, loteParcial] })
    const { rerender } = renderizar('prontidao')

    // job_running: faixa no topo e Mesa continua interativa
    expect(screen.getByText(/Lote #6411: exportando 1\/4 \(45%\)/i)).toBeInTheDocument()
    expect(screen.getByRole('article', { name: /Corte V1 pronto/i })).toBeInTheDocument()

    // partial em ?sub=lotes
    rerender(
      <ProvedorDicas>
        <ProvedorToast>
          <ProvedorAtalhos>
            <Exportacao
              projetoId="demo"
              projetoPath="/projetos/Demo.clipes"
              sub="lotes"
              store={{} as StoreExportacaoProjeto}
            />
          </ProvedorAtalhos>
        </ProvedorToast>
      </ProvedorDicas>,
    )

    await user.click(screen.getByRole('button', { name: /Lote #6399/i }))
    expect(
      screen.getByText(/Lote concluído parcialmente: 2 de 3 Cortes exportados e 1 com falha/i),
    ).toBeInTheDocument()
  })

  it('alterna abas com setas ←/→ + Enter e cicla 5 regiões com F6/Shift+F6', async () => {
    const user = userEvent.setup()
    renderizar('prontidao')

    const tabProntidao = screen.getByRole('tab', { name: /Prontidão e Lote/i })
    const tabLotes = screen.getByRole('tab', { name: /Histórico de lotes/i })

    tabProntidao.focus()
    await user.keyboard('{ArrowRight}')
    expect(tabLotes).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(window.location.hash).toBe('#/projeto/demo/exportacao?sub=lotes')

    await user.keyboard('{ArrowLeft}')
    expect(tabProntidao).toHaveFocus()

    // Ciclo F6: Topo -> Sub-barra -> Zona esquerda -> Zona direita -> Rodapé -> Topo
    const topo = document.querySelector('[data-regiao="topo"]')!
    const rodape = document.querySelector('[data-regiao="rodape"]')!
    const subbarra = screen.getByRole('navigation', { name: 'Visões de Exportação' })
    const zonaEsq = screen.getByRole('region', { name: 'Grade de Prontidão dos Cortes' })
    const zonaDir = screen.getByRole('complementary', { name: 'Configuração da exportação em lote' })

    const fireF6 = (shiftKey = false) => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'F6', shiftKey, cancelable: true }))
    }

    ;(document.activeElement as HTMLElement | null)?.blur()
    fireF6()
    expect(topo.contains(document.activeElement)).toBe(true)

    fireF6()
    expect(subbarra.contains(document.activeElement)).toBe(true)

    fireF6()
    expect(zonaEsq.contains(document.activeElement)).toBe(true)

    fireF6()
    expect(zonaDir.contains(document.activeElement)).toBe(true)

    fireF6()
    expect(rodape.contains(document.activeElement)).toBe(true)

    fireF6(true)
    expect(zonaDir.contains(document.activeElement)).toBe(true)
  })
})
