import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { criarStoreEditorCorte, type EditorDocumento, type StoreEditorCorte } from '~/stores/editorCorte'
import { PainelEsquerdoCorte } from '~/telas/corte/PainelEsquerdoCorte'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

beforeAll(() => {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: {
              width: 380,
              height: 520,
              top: 0,
              left: 0,
              bottom: 520,
              right: 380,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      )
    }
    unobserve() {}
    disconnect() {}
  }

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-index')) {
      return {
        width: 360,
        height: 76,
        top: 0,
        left: 0,
        bottom: 76,
        right: 360,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    }
    return {
      width: 380,
      height: 520,
      top: 0,
      left: 0,
      bottom: 520,
      right: 380,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  }

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 520
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.hasAttribute('data-index') ? 76 : 520
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      const filho = this.firstElementChild as HTMLElement | null
      const h = filho?.style?.height ? parseFloat(filho.style.height) : 0
      return Number.isFinite(h) && h > 0 ? Math.max(h, 520) : 520
    },
  })

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  HTMLElement.prototype.scrollTo = function (opts?: ScrollToOptions | number, y?: number) {
    const top = typeof opts === 'number' ? (y ?? 0) : (opts?.top ?? 0)
    this.scrollTop = top
    this.dispatchEvent(new Event('scroll'))
  }
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

function criarDocBase(parcial: Partial<EditorDocumento> = {}): EditorDocumento {
  return {
    clipId: 11,
    schemaVersion: 2,
    request: { source_id: 4, start_id: 10, end_id: 12, candidate_id: 201 },
    startUs: 90_000_000,
    endUs: 120_000_000,
    windowStartUs: 60_000_000,
    windowEndUs: 150_000_000,
    fps: 24,
    sourceAspect: 16 / 9,
    revision: 1,
    undoCount: 0,
    redoCount: 0,
    silences: {
      enabled: true,
      thresholdUs: 600_000,
      intervals: [
        {
          id: 1,
          startUs: 100_120_000,
          endUs: 100_920_000,
          gapStartUs: 100_000_000,
          gapEndUs: 101_000_000,
          status: 'active',
        },
      ],
      segments: [],
      removedUs: 800_000,
      effectiveDurationUs: 29_200_000,
    },
    crop: {
      layout: 'face',
      explicitLayout: 'face',
      suggested: null,
      edits: [
        {
          timeUs: 95_000_000,
          x: 0.25,
          y: 0,
          width: 0.3164,
          height: 1,
          cut: false,
        },
      ],
      gameplayWebcam: null,
      twoPeople: null,
      resolved: [],
      hasCrop: true,
    },
    montage: {
      schemaVersion: 1,
      blocks: [
        {
          blockId: 101,
          position: 1,
          title: 'Gancho inicial',
          mode: 'manual',
          anchorSentenceId: 10,
          manualSourceStartUs: 92_000_000,
          autoStartUs: 0,
          desiredStartUs: 2_000_000,
          startUs: 2_000_000,
          endUs: 10_000_000,
          durationUs: 8_000_000,
          estimated: false,
          pushedUs: 0,
          overflowUs: 0,
          sourceStartUs: 92_000_000,
          audioId: 101,
        },
      ],
      clipDurationUs: 29_200_000,
      narrationEndUs: 10_000_000,
      freezeTailUs: 0,
      totalDurationUs: 29_200_000,
      totalPushedUs: 0,
      usesEstimatedDurations: false,
      scriptApproved: true,
      warnings: [],
    },
    audioMix: {
      soundtrack: null,
      sfx: [
        {
          id: 7,
          assetId: 3,
          name: 'Impacto grave',
          mediaId: 'audio/3',
          assetDurationUs: 1_200_000,
          anchor: { kind: 'word', track: 'original', position: 100, offsetUs: 0 },
          wordText: 'navegador',
          startUs: 10_000_000,
          endUs: 11_200_000,
          sourceStartUs: 100_000_000,
          volume: 0.8,
          fadeInUs: 0,
          fadeOutUs: 0,
          outsideClip: false,
          licenseKind: 'cc0',
          licenseAttribution: '',
          licenseVerified: true,
        },
      ],
      speechIntervals: [],
      totalDurationUs: 29_200_000,
      unverifiedCount: 0,
      warnings: [],
    },
    ...parcial,
  }
}

const FRASES_BASE = [
  { id: 9, startUs: 80_000_000, endUs: 90_000_000, text: 'Antes do corte' },
  { id: 10, startUs: 90_000_000, endUs: 100_000_000, text: 'Quando o navegador bloqueou' },
  { id: 11, startUs: 101_000_000, endUs: 110_000_000, text: 'tudo mudou ontem' },
  { id: 12, startUs: 110_000_000, endUs: 120_000_000, text: 'naquele instante' },
  { id: 13, startUs: 120_000_000, endUs: 130_000_000, text: 'Depois do corte' },
]

async function abrirStoreComFixture(doc = criarDocBase()): Promise<StoreEditorCorte> {
  const store = criarStoreEditorCorte()
  store.definirProjeto('/projetos/Demo.clipes')
  await store.abrir({
    corteId: '201',
    sourceId: doc.request.source_id,
    startId: doc.request.start_id,
    endId: doc.request.end_id,
    candidateId: doc.request.candidate_id,
    fonteDisponivel: true,
  })
  return store
}

describe('PainelEsquerdoCorte', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    let docAtual = criarDocBase()
    let frasesAtuais = FRASES_BASE.map((f) => ({ ...f }))
    let canUndo = false
    let canRedo = false

    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === 'editor.open') return docAtual
      if (cmd === 'editor.sentences') return frasesAtuais
      if (cmd === 'export.captions') {
        return {
          style: {
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
          cues: [],
          emojiRemoved: 0,
          words: [],
          transcriptId: 4,
          start_us: docAtual.startUs,
          end_us: docAtual.endUs,
          missingGlyphs: [],
          track: 'original',
          availableTracks: ['original'],
          narrationSummary: null,
        }
      }
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') {
        return {
          clipId: docAtual.clipId,
          sourceId: docAtual.request.source_id,
          permitted: true,
          permissionError: null,
          activeTrack: 'original',
          hasTranslation: false,
          sentences: [],
        }
      }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'ready', key: 'px-1', job: null, progress: 100, error: null }
      if (cmd === 'editor.timeline') return { state: 'ready', key: 'tl-1', job: null, progress: 100, error: null, thumbs: null }
      if (cmd === 'editor.wave') return { blockUs: 100_000, values: [] }
      if (cmd === 'transcription.corrections') return { can_undo: canUndo, can_redo: canRedo }
      if (cmd === 'transcription.correct') {
        const pos = Number(args.position)
        const text = String(args.text ?? '').trim()
        canUndo = true
        canRedo = false
        const sid = Math.floor(pos / 10)
        frasesAtuais = frasesAtuais.map((f) => {
          if (f.id !== sid) return f
          const parts = f.text.split(' ')
          parts[pos % 10] = text
          return { ...f, text: parts.join(' ') }
        })
        return {
          changed: true,
          source_id: docAtual.request.source_id,
          transcript_id: 4,
          position: pos,
          sentence_id: sid,
          text,
          corrected: true,
          can_undo: canUndo,
          can_redo: canRedo,
        }
      }
      if (cmd === 'transcription.undo') {
        canUndo = false
        canRedo = true
        frasesAtuais = FRASES_BASE.map((f) => ({ ...f }))
        return {
          changed: true,
          source_id: docAtual.request.source_id,
          transcript_id: 4,
          position: 102,
          sentence_id: 10,
          text: 'navegador',
          corrected: false,
          can_undo: canUndo,
          can_redo: canRedo,
        }
      }
      if (cmd === 'transcription.redo') {
        canUndo = true
        canRedo = false
        return {
          changed: true,
          source_id: docAtual.request.source_id,
          transcript_id: 4,
          position: 102,
          sentence_id: 10,
          text: 'browser',
          corrected: true,
          can_undo: canUndo,
          can_redo: canRedo,
        }
      }
      if (cmd === 'editor.adjust') {
        const sid = typeof args.sentence_id === 'number' ? args.sentence_id : null
        if (sid === 9) {
          docAtual = { ...docAtual, startUs: 80_000_000, request: { ...docAtual.request, start_id: 9 } }
        } else if (sid === 13) {
          docAtual = { ...docAtual, endUs: 130_000_000, request: { ...docAtual.request, end_id: 13 } }
        }
        return docAtual
      }
      if (cmd === 'editor.silences.toggle') {
        docAtual = {
          ...docAtual,
          silences: {
            ...docAtual.silences,
            intervals: docAtual.silences.intervals.map((i) =>
              i.id === args.id ? { ...i, status: i.status === 'active' ? 'reverted' : 'active' } : i,
            ),
          },
        }
        return docAtual
      }
      if (cmd === 'editor.crop.set_edits') {
        docAtual = {
          ...docAtual,
          crop: { ...docAtual.crop, edits: args.edits as EditorDocumento['crop']['edits'] },
        }
        return { clipId: docAtual.clipId, schemaVersion: 2, revision: 2, undoCount: 1, redoCount: 0, ...docAtual.crop }
      }
      if (cmd === 'editor.montage.set_start') {
        docAtual = {
          ...docAtual,
          montage: docAtual.montage
            ? {
                ...docAtual.montage,
                blocks: docAtual.montage.blocks.map((b) =>
                  b.blockId === args.block_id
                    ? {
                        ...b,
                        mode: args.time_us == null ? 'automatic' : 'manual',
                        manualSourceStartUs: (args.time_us as number | null) ?? null,
                      }
                    : b,
                ),
              }
            : null,
        }
        return docAtual
      }
      if (cmd === 'editor.audio.sfx.remove') {
        docAtual = {
          ...docAtual,
          audioMix: {
            ...docAtual.audioMix,
            sfx: docAtual.audioMix.sfx.filter((s) => s.id !== args.id),
          },
        }
        return docAtual
      }
      return null
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('quando recolhido renderiza trilho de 40 px sem abrir por hover e alterna ao clicar', async () => {
    const user = userEvent.setup()
    const store = await abrirStoreComFixture()
    const aoAlternarAberto = vi.fn()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={false}
          aoAlternarAberto={aoAlternarAberto}
          projetoId="demo"
          store={store}
        />,
      ),
    )

    const trilho = screen.getByLabelText(/transcrição recolhida/i)
    expect(trilho.className).toContain('w-10')

    fireEvent.mouseEnter(trilho)
    fireEvent.pointerEnter(trilho)
    expect(aoAlternarAberto).not.toHaveBeenCalled()

    const botaoAbrir = screen.getByRole('button', { name: /abrir transcrição/i })
    await user.click(botaoAbrir)
    expect(aoAlternarAberto).toHaveBeenCalledTimes(1)
  })

  it('renderiza Frases vizinhas atenuadas com "Incluir no Corte", palavra ativa em sinal-texto, alvos >= 24px e clique faz seek', async () => {
    const user = userEvent.setup()
    const store = await abrirStoreComFixture()
    const aoMudarTempoUs = vi.fn()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={true}
          aoAlternarAberto={vi.fn()}
          projetoId="demo"
          store={store}
          tempoAtualUs={95_500_000}
          aoMudarTempoUs={aoMudarTempoUs}
        />,
      ),
    )

    const botoesIncluir = screen.getAllByRole('button', { name: /incluir no corte/i })
    expect(botoesIncluir.length).toBe(2)

    const palavraNavegador = screen.getByRole('button', { name: 'navegador' })
    expect(palavraNavegador.className).toContain('min-w-6')
    expect(palavraNavegador.className).toContain('min-h-6')
    expect(palavraNavegador.className).toContain('text-sinal-texto')

    await user.click(palavraNavegador)
    expect(aoMudarTempoUs).toHaveBeenCalledWith(95_000_000)

    await user.click(botoesIncluir[0])
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', sentence_id: 9, preview: false }),
      )
    })
  })

  it('F2 e Enter abrem edição inline (transcription.correct) preservando foco e Esc cancela mantendo foco', async () => {
    const user = userEvent.setup()
    const store = await abrirStoreComFixture()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={true}
          aoAlternarAberto={vi.fn()}
          projetoId="demo"
          store={store}
        />,
      ),
    )

    const palavra = screen.getByRole('button', { name: 'navegador' })
    palavra.focus()

    await user.keyboard('{F2}')
    const input = screen.getByRole('textbox', { name: 'Corrigir palavra' })
    expect(input).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Corrigir palavra' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'navegador' })).toHaveFocus()
    })

    await user.keyboard('{Enter}')
    const inputConfirmar = screen.getByRole('textbox', { name: 'Corrigir palavra' })
    await user.clear(inputConfirmar)
    await user.type(inputConfirmar, 'browser{Enter}')

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'transcription.correct',
        expect.objectContaining({ source_id: 4, position: 102, text: 'browser' }),
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'browser' })).toHaveFocus()
    })
  })

  it('Ctrl+Z com foco na Transcrição chama transcription.undo (#302) e silêncio inline chama editor.silences.toggle', async () => {
    const user = userEvent.setup()
    const store = await abrirStoreComFixture()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={true}
          aoAlternarAberto={vi.fn()}
          projetoId="demo"
          store={store}
        />,
      ),
    )

    // Faz uma correção primeiro para habilitar undo
    const palavra = screen.getByRole('button', { name: 'navegador' })
    palavra.focus()
    await user.keyboard('{F2}')
    const input = screen.getByRole('textbox', { name: 'Corrigir palavra' })
    await user.clear(input)
    await user.type(input, 'browser{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'browser' })).toHaveFocus()
    })

    await user.keyboard('{Control>}z{/Control}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.undo', {})
    })

    // Silêncio inline tachado/hachurado
    const silencioBtn = screen.getByRole('button', { name: /silêncio|pausa/i })
    expect(silencioBtn.className).toContain('border-dashed')
    expect(silencioBtn.innerHTML).toContain('line-through')
    await user.click(silencioBtn)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.silences.toggle',
        expect.objectContaining({ id: 1 }),
      )
    })
  })

  it('Ctrl+F foca busca local, filtra ocorrências e exibe estado empty quando sem resultados', async () => {
    const user = userEvent.setup()
    const store = await abrirStoreComFixture()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={true}
          aoAlternarAberto={vi.fn()}
          projetoId="demo"
          store={store}
        />,
      ),
    )

    await user.keyboard('{Control>}f{/Control}')
    const campoBusca = screen.getByRole('textbox', { name: /filtrar fala do corte/i })
    expect(campoBusca).toHaveFocus()

    await user.type(campoBusca, 'navegador')
    expect(screen.getByText('1/1')).toBeInTheDocument()

    await user.clear(campoBusca)
    await user.type(campoBusca, 'inexistenteXYZ')
    expect(screen.getByText(/nenhuma fala com/i)).toBeInTheDocument()
  })

  it('Índice do Corte filtra por categoria e opera 100% por teclado no ListaVirtual role="listbox"', async () => {
    const user = userEvent.setup()
    const store = await abrirStoreComFixture()
    const aoMudarTempoUs = vi.fn()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={true}
          aoAlternarAberto={vi.fn()}
          projetoId="demo"
          store={store}
          aoMudarTempoUs={aoMudarTempoUs}
        />,
      ),
    )

    const tabIndice = screen.getByRole('tab', { name: /índice do corte/i })
    await user.click(tabIndice)

    const listbox = screen.getByRole('listbox', { name: /índice do corte/i })
    expect(listbox).toBeInTheDocument()

    // Filtrar Silêncios e alternar por teclado
    await user.click(screen.getByRole('button', { name: 'Silêncios' }))
    const opcoesSilencio = within(listbox).getAllByRole('option')
    expect(opcoesSilencio.length).toBe(1)

    listbox.focus()
    await user.keyboard('{Enter}')
    expect(aoMudarTempoUs).toHaveBeenCalledWith(100_120_000)

    const btnManter = within(opcoesSilencio[0]).getByRole('button', { name: /manter pausa/i })
    btnManter.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.silences.toggle',
        expect.objectContaining({ id: 1 }),
      )
    })

    // Filtrar Enquadramento e alternar cut por teclado
    await user.click(screen.getByRole('button', { name: 'Enquadramento' }))
    const opcoesKf = within(listbox).getAllByRole('option')
    expect(opcoesKf.length).toBe(1)
    const btnCut = within(opcoesKf[0]).getByRole('button', { name: /corte seco/i })
    btnCut.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.crop.set_edits',
        expect.objectContaining({
          panel: 'primary',
          edits: [expect.objectContaining({ cut: true })],
        }),
      )
    })

    // Filtrar Narração e resetar para automático por teclado
    await user.click(screen.getByRole('button', { name: 'Narração' }))
    const opcoesNar = within(listbox).getAllByRole('option')
    expect(opcoesNar.length).toBe(1)
    const btnAuto = within(opcoesNar[0]).getByRole('button', { name: /automático/i })
    btnAuto.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.montage.set_start',
        expect.objectContaining({ block_id: 101, time_us: null }),
      )
    })

    // Filtrar Áudio e SFX e remover SFX por teclado
    await user.click(screen.getByRole('button', { name: 'Áudio e SFX' }))
    const opcoesSfx = within(listbox).getAllByRole('option')
    expect(opcoesSfx.length).toBe(1)
    const btnRemoverSfx = within(opcoesSfx[0]).getByRole('button', { name: /remover/i })
    btnRemoverSfx.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.audio.sfx.remove',
        expect.objectContaining({ id: 7 }),
      )
    })
  })

  it('menu da palavra aciona Entrada, Saída, estilo da palavra e ancorar SFX; Ctrl+Shift+Z chama transcription.redo e undo de outra Fonte exibe toast (#302)', async () => {
    const user = userEvent.setup()
    const store = await abrirStoreComFixture()
    const aoFocarLegendaOverride = vi.fn()
    const aoAbrirAbaAudio = vi.fn()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={true}
          aoAlternarAberto={vi.fn()}
          projetoId="demo"
          store={store}
          aoFocarLegendaOverride={aoFocarLegendaOverride}
          aoAbrirAbaAudio={aoAbrirAbaAudio}
        />,
      ),
    )

    const palavra = screen.getByRole('button', { name: 'navegador' })
    await user.click(palavra)

    await user.click(screen.getByRole('button', { name: /ações da palavra/i }))
    await user.click(await screen.findByRole('menuitem', { name: /personalizar estilo da palavra/i }))
    expect(aoFocarLegendaOverride).toHaveBeenCalledWith(102)

    await user.click(palavra)
    await user.click(screen.getByRole('button', { name: /ações da palavra/i }))
    await user.click(await screen.findByRole('menuitem', { name: /ancorar sfx nesta palavra/i }))
    expect(aoAbrirAbaAudio).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'word', position: 102 }),
    )

    await user.click(palavra)
    await user.click(screen.getByRole('button', { name: /ações da palavra/i }))
    await user.click(await screen.findByRole('menuitem', { name: /definir entrada aqui/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', sentence_id: 10, preview: false }),
      )
    })

    // UI-12: não expõe números de ticket (#\d+) na UI visível
    expect(document.body.textContent ?? '').not.toMatch(/#\d+/)

    // Ctrl+Z quando undo retorna outra Fonte exibe toast informativo e Ctrl+Shift+Z chama redo
    const implAtual = chamarMock.getMockImplementation()!
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === 'transcription.undo') {
        return {
          changed: true,
          source_id: 99,
          transcript_id: 99,
          position: 10,
          sentence_id: 1,
          text: 'outra',
          corrected: true,
          can_undo: false,
          can_redo: true,
        }
      }
      return implAtual(cmd, args)
    })

    palavra.focus()
    await user.keyboard('{Control>}z{/Control}')
    await waitFor(() => {
      expect(screen.getByText(/correção desfeita em outra fonte do projeto/i)).toBeInTheDocument()
    })
    expect(document.body.textContent ?? '').not.toMatch(/#\d+/)

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.redo', {})
    })
  })

  it('UI-63 / UI-69: botão Ir tem min-w-6 (>= 24 px) e Transcrição abre rolada na 1ª frase ativa do Corte', async () => {
    const user = userEvent.setup()
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollTo')
    const store = await abrirStoreComFixture()

    render(
      envolver(
        <PainelEsquerdoCorte
          aberto={true}
          aoAlternarAberto={vi.fn()}
          projetoId="demo"
          store={store}
        />,
      ),
    )

    const viewport = screen.getByLabelText('Frases do Corte')
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    })
    const chamadaViewport = scrollSpy.mock.instances.some((inst) => inst === viewport)
    expect(chamadaViewport).toBe(true)
    scrollSpy.mockRestore()

    await user.click(screen.getByRole('tab', { name: 'Índice do Corte' }))
    const btnIr = screen.getAllByRole('button', { name: 'Ir' })[0]
    expect(btnIr.className).toContain('min-w-6')
  })
})
