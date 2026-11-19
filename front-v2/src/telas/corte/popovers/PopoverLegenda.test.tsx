import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { criarStoreEditorCorte, type EditorDocumento, type TraducaoDocumento } from '~/stores/editorCorte'
import { PopoverLegenda } from '~/telas/corte/popovers/PopoverLegenda'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => '/projetos/demo.clipes')

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
})

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

function criarDoc(): EditorDocumento {
  return {
    clipId: 1,
    schemaVersion: 2,
    request: { source_id: 2, start_id: 1, end_id: 3, candidate_id: 10 },
    startUs: 10_000_000,
    endUs: 40_000_000,
    windowStartUs: 0,
    windowEndUs: 120_000_000,
    fps: 24,
    sourceAspect: 16 / 9,
    revision: 0,
    undoCount: 0,
    redoCount: 0,
    silences: { enabled: true, thresholdUs: 600_000, intervals: [], segments: [], removedUs: 0, effectiveDurationUs: 30_000_000 },
    crop: { layout: 'face', explicitLayout: 'face', splitRatio: 0.3, suggested: null, edits: [], gameplayWebcam: null, twoPeople: null, resolved: [], hasCrop: true },
    montage: null,
    audioMix: { soundtrack: null, sfx: [], speechIntervals: [], totalDurationUs: 30_000_000, unverifiedCount: 0, warnings: [] },
  }
}

function criarLegendas(parcial: Record<string, unknown> = {}) {
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
    words: [
      {
        position: 5,
        text: 'Olá',
        startUs: 0,
        endUs: 400_000,
        overrides: { color: '#FF0000' },
        missingGlyph: null,
      },
    ],
    transcriptId: 2,
    start_us: 10_000_000,
    end_us: 40_000_000,
    missingGlyphs: [
      { position: 5, sentence_id: 1, word: '東京', char: '東', codepoint: 'U+6771', start_us: 10_200_000 },
    ],
    track: 'original',
    availableTracks: ['original', 'translated', 'narration'],
    narrationSummary: null,
    ...parcial,
  }
}

function criarTraducao(parcial: Partial<TraducaoDocumento> = {}): TraducaoDocumento {
  return {
    schemaVersion: 1,
    clipId: 1,
    sourceId: 2,
    transcriptId: 2,
    permitted: true,
    permissionError: null,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    defaultTargetLanguage: 'en',
    activeTrack: 'original',
    targetLanguage: 'en',
    hasTranslation: true,
    missingSentenceIds: [],
    sentences: [
      { id: 1, startUs: 10_000_000, endUs: 20_000_000, originalText: 'Frase 1', translatedText: 'Sentence 1', edited: false },
    ],
    run: null,
    ...parcial,
  }
}

async function prepararSessao(opcoes: {
  remapDiscarded?: number
  traducao?: TraducaoDocumento
  localOnly?: boolean
  conflitoEstilo?: boolean
} = {}) {
  const doc = criarDoc()
  const traducao = opcoes.traducao ?? criarTraducao()
  let legendas = criarLegendas()

  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'editor.open') return doc
    if (cmd === 'editor.sentences') return []
    if (cmd === 'export.captions') return legendas
    if (cmd === 'audio.list') return []
    if (cmd === 'translation.get') return traducao
    if (cmd === 'captions.remap_status') return { discarded: opcoes.remapDiscarded ?? 0 }
    if (cmd === 'proxy.request') return { state: 'ready', key: 'p1', job: null, progress: 100, error: null }
    if (cmd === 'editor.timeline') return { state: 'ready', key: 'tl1', job: null, progress: 100, error: null, thumbs: null }
    if (cmd === 'editor.wave') return { blockUs: 100_000, values: [] }
    if (cmd === 'captions.style.preset') {
      if (opcoes.conflitoEstilo) {
        throw new ErroCore('caption_style_conflict', 'Estilo alterado')
      }
      legendas = {
        ...legendas,
        style: { ...legendas.style, preset: String(args.preset), revision: legendas.style.revision + 1 },
      }
      return legendas.style
    }
    if (cmd === 'captions.override') {
      return { position: args.position, overrides: args.overrides }
    }
    if (cmd === 'provider.profiles.list') {
      return {
        profiles: [
          {
            id: 'remoto-openai',
            label: 'OpenAI GPT',
            kind: 'openai',
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            local: false,
            cli: false,
          },
        ],
      }
    }
    if (cmd === 'assistant.tasks') {
      return {
        projectLocalOnly: opcoes.localOnly ?? false,
        tasks: [
          {
            task: 'translation',
            choice: 'profile:remoto-openai',
            source: 'task',
            profile: { id: 'remoto-openai', label: 'OpenAI GPT', kind: 'openai', local: false, model: 'gpt-4o-mini' },
            localOnly: opcoes.localOnly ?? false,
            blocked: opcoes.localOnly ?? false,
            missing: null,
          },
        ],
      }
    }
    if (cmd === 'jobs.budget.get') {
      return { budgets: [] }
    }
    if (cmd === 'projects.local_only.get') {
      return { enabled: opcoes.localOnly ?? false }
    }
    if (cmd === 'translation.estimate') {
      return {
        paid: true,
        profile: 'remoto-openai',
        sourceLanguage: 'pt-BR',
        targetLanguage: 'en',
        batches: 1,
        sentenceCount: 1,
        contextTokens: 32768,
        estimate: { kind: 'usd', minMicroUsd: 20_000, maxMicroUsd: 40_000 },
      }
    }
    if (cmd === 'translation.start') {
      return { run: 7, jobs: [701], batches: 1, sourceLanguage: 'pt-BR', targetLanguage: 'en' }
    }
    if (cmd === 'translation.edit') {
      return {
        ...traducao,
        sentences: traducao.sentences.map((s) =>
          s.id === args.sentence_id ? { ...s, translatedText: String(args.text), edited: true } : s,
        ),
      }
    }
    return null
  })

  const store = criarStoreEditorCorte()
  store.definirProjeto('/projetos/demo.clipes')
  await store.abrir({
    corteId: '10',
    sourceId: 2,
    startId: 1,
    endId: 3,
    candidateId: 10,
    fonteDisponivel: true,
  })
  return store
}

describe('<PopoverLegenda>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => '/projetos/demo.clipes')
  })

  it('exibe aviso de remap_status, 4 faixas em transformed, presets preservando overrides, missingGlyphs e nota fora do undo', async () => {
    const user = userEvent.setup()
    const aoIrParaPalavra = vi.fn()
    const store = await prepararSessao({ remapDiscarded: 2 })
    const snap = store.obterSnapshot()

    render(
      envolver(
        <PopoverLegenda
          projetoId="demo"
          videoKind="transformed"
          palavraSelecionadaPosition={5}
          aoIrParaTranscricaoPalavra={aoIrParaPalavra}
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    // remap_status > 0
    expect(screen.getByText(/2 destaque/i)).toBeInTheDocument()

    // 4 faixas disponíveis em transformed (layout 2x2 sem corte horizontal)
    const grupoFaixa = screen.getByRole('radiogroup', { name: 'Faixa da legenda' })
    expect(grupoFaixa.className).toContain('grid-cols-2')
    for (const rotulo of ['Automático', 'Original', 'Traduzida', 'Narração']) {
      expect(screen.getByRole('radio', { name: rotulo })).toBeInTheDocument()
    }

    // 3 estilos preservando overrides (sem usar "preset" do GLOSSARY)
    expect(document.body.textContent ?? '').not.toMatch(/\bpreset\b/i)
    expect(screen.getByText(/Trocar o estilo preserva seus destaques por palavra/i)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Cinema' }))
    expect(chamarMock).toHaveBeenCalledWith(
      'captions.style.preset',
      expect.objectContaining({ clip_id: 1, preset: 'cinema', revision: 0 }),
    )
    expect(store.obterSnapshot().legendas?.words[0].overrides).toEqual({ color: '#FF0000' })

    // missingGlyphs lista glifos e botão para corrigir na Transcrição
    expect(screen.getByText(/U\+6771/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Corrigir palavras na Transcrição' }))
    expect(aoIrParaPalavra).toHaveBeenCalledWith(5)

    // Nota fixa fora do Desfazer
    expect(
      screen.getByText('Estilo, destaques e tradução são salvos automaticamente fora do Desfazer da timeline.'),
    ).toBeInTheDocument()
  })

  it('trata caption_style_conflict exibindo Recarregar estilo', async () => {
    const user = userEvent.setup()
    const store = await prepararSessao({ conflitoEstilo: true })
    const snap = store.obterSnapshot()

    render(
      envolver(
        <PopoverLegenda
          projetoId="demo"
          videoKind="direct"
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    // Em Corte direto não exibe faixa Narração
    expect(screen.queryByRole('radio', { name: 'Narração' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Simples' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    const btnRecarregar = screen.getByRole('button', { name: 'Recarregar estilo' })
    chamarMock.mockClear()
    await user.click(btnRecarregar)
    expect(chamarMock).toHaveBeenCalledWith('export.captions', expect.objectContaining({ clip_id: 1 }))
  })

  it('!permitted na Tradução exibe link para Fonte; com permissão, calcula estimativa, bloqueia remoto em Somente local, confirma via ConfirmDialog e translation.edit recarrega legendas', async () => {
    const user = userEvent.setup()
    const storeSemPerm = await prepararSessao({
      traducao: criarTraducao({
        permitted: false,
        permissionError: { code: 'translation_permission_required', message: 'Sem escopo tradução.' },
      }),
    })
    const snapSem = storeSemPerm.obterSnapshot()

    const { unmount } = render(
      envolver(
        <PopoverLegenda
          projetoId="demo"
          videoKind="transformed"
          estadoEditor={{
            ...snapSem,
            documentoAtivo: snapSem.previaLocal ?? snapSem.oficial,
            store: storeSemPerm,
            abrir: storeSemPerm.abrir,
            salvarAgora: storeSemPerm.salvarAgora,
            garantirSalvoParaSaida: storeSemPerm.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    expect(screen.getByText(/Sem escopo tradução/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Permissão da Fonte/i })).toHaveAttribute('href', '#/projeto/demo/fontes/2')
    unmount()

    // Somente local bloqueia remoto
    const storeLocalOnly = await prepararSessao({ localOnly: true })
    const snapLocalOnly = storeLocalOnly.obterSnapshot()
    const { unmount: unmountLocal } = render(
      envolver(
        <PopoverLegenda
          projetoId="demo"
          videoKind="transformed"
          estadoEditor={{
            ...snapLocalOnly,
            documentoAtivo: snapLocalOnly.previaLocal ?? snapLocalOnly.oficial,
            store: storeLocalOnly,
            abrir: storeLocalOnly.abrir,
            salvarAgora: storeLocalOnly.salvarAgora,
            garantirSalvoParaSaida: storeLocalOnly.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Calcular tradução' }))
    expect(await screen.findByLabelText(/Resumo de custo e privacidade/i)).toBeInTheDocument()
    expect(screen.getByText(/Somente local/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Traduzir Corte' })).toBeDisabled()
    unmountLocal()

    // Com permissão e remoto liberado: ConfirmDialog -> translation.start (#297) -> translation.edit invalida export.captions
    const store = await prepararSessao({ localOnly: false })
    const snap = store.obterSnapshot()
    render(
      envolver(
        <PopoverLegenda
          projetoId="demo"
          videoKind="transformed"
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Calcular tradução' }))
    const btnTraduzir = await screen.findByRole('button', { name: 'Traduzir Corte' })
    expect(btnTraduzir).toBeEnabled()
    await user.click(btnTraduzir)

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Confirmar tradução' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'translation.start',
        expect.objectContaining({ clip_id: 1, target_language: 'en', confirmed: true }),
      )
    })
    expect(store.obterSnapshot().translationJobToClip[701]).toBe(1)

    // Editar frase traduzida invalida export.captions
    chamarMock.mockClear()
    const campoFrase = screen.getByLabelText('Tradução da frase 1')
    await user.clear(campoFrase)
    await user.type(campoFrase, 'Edited sentence 1')
    await user.click(screen.getByRole('button', { name: 'Salvar frase 1' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('translation.edit', {
        clip_id: 1,
        sentence_id: 1,
        text: 'Edited sentence 1',
      })
      expect(chamarMock).toHaveBeenCalledWith('export.captions', expect.objectContaining({ clip_id: 1 }))
    })
  })
})
