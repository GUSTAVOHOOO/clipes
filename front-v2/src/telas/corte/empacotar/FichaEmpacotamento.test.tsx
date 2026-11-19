import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import { useEmpacotarCorte, type EmpacotamentoDoc } from '~/stores/empacotarCorte'
import { FichaEmpacotamento } from '~/telas/corte/empacotar/FichaEmpacotamento'

const chamarMock = vi.fn()
const copiarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return { ...atual, chamar: (...args: unknown[]) => chamarMock(...args) }
})

vi.mock('~/telas/corte/empacotar/dialogosNativos', () => ({
  salvarArquivo: vi.fn(),
  copiarTexto: (...args: unknown[]) => copiarMock(...args),
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []
})

const CREDITO = 'Crédito: vídeo original de Criador.'
const TITULO_IDEAL = 'Como o streamer reagiu ao susto mais inesperado da live'

function docEmpacotamento(parcial?: {
  current?: Partial<NonNullable<EmpacotamentoDoc['current']>> | null
  credit?: EmpacotamentoDoc['credit']
  chapters?: Partial<EmpacotamentoDoc['chapters']>
  languageRequired?: boolean
}): EmpacotamentoDoc {
  const current =
    parcial?.current === null
      ? null
      : {
          generation: 1,
          language: 'pt-BR',
          edited: false,
          title: TITULO_IDEAL,
          description: 'Resumo do Corte.',
          tags: ['live', 'corte'],
          hashtags: ['#live'],
          fullDescription: `Resumo do Corte.\n\n${CREDITO}`,
          ...parcial?.current,
        }
  return {
    schemaVersion: 1,
    revision: 1,
    detectedLanguage: 'pt-BR',
    languageRequired: parcial?.languageRequired ?? false,
    current,
    credit: parcial?.credit ?? { text: CREDITO, warning: null },
    chapters: {
      applicable: false,
      status: 'not_transformed',
      canGenerate: false,
      count: 0,
      block: null,
      hasDelimiters: false,
      generationWarning: null,
      validationErrors: [],
      ...parcial?.chapters,
    },
    job: null,
    limits: {
      titleChars: 100,
      descriptionBytes: 5000,
      tagsChars: 500,
      tags: 30,
      tagChars: 60,
      hashtags: 15,
    } as unknown as EmpacotamentoDoc['limits'],
    source: 4,
    generations: [],
  }
}

type RespostasMock = {
  pacote?: EmpacotamentoDoc
  guardrails?: Record<string, unknown>
  extra?: (cmd: string, args: unknown) => unknown
}

const GUARDRAILS_PADRAO = {
  scope: 'single',
  needsDirectNotice: false,
  videoKind: 'transformed',
  over60s: false,
  permission: { status: 'granted', who: 'Criador', where: 'YouTube' },
  script: { applicable: true, exists: true, approved: true, pendingBlocks: 0, totalBlocks: 3 },
  narration: { applicable: true, hasTts: true, voices: ['13063'], freezeTailUs: 0, longFreezeTail: false },
  audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
}

function configurarMock(r: RespostasMock) {
  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    const extra = r.extra?.(cmd, args)
    if (extra !== undefined) return extra
    switch (cmd) {
      case 'thumbnail.get':
        return { current: null, history: [], job: null }
      case 'packaging.get':
        return r.pacote ?? docEmpacotamento()
      case 'guardrails.check':
        return { ...GUARDRAILS_PADRAO, ...r.guardrails }
      case 'provider.profiles.list':
        return { profiles: [] }
      case 'assistant.tasks':
        return { tasks: [], default: null }
      case 'jobs.budget.get':
        return { limitMicroUsd: 1_000_000, spentMicroUsd: 0, remainingMicroUsd: 1_000_000, callsRemaining: 10, paused: false }
      case 'proxy.request':
        return { state: 'running', key: 'k', job: 7, progress: 10 }
      default:
        return undefined
    }
  })
}

function Harness({ aoIrParaFonte = vi.fn() }: { aoIrParaFonte?: () => void }) {
  const store = useEmpacotarCorte(201, { id: 4, disponivel: true }, filaTeste)
  if (store.carregando || !store.empacotamento) return <p>carregando teste</p>
  return (
    <FichaEmpacotamento
      projetoId="demo"
      corteId="cand-201"
      fonteId={4}
      fonteDisponivel
      store={store}
      aoAbrirExportacao={aoAbrirExportacaoMock}
      aoIrParaFonte={aoIrParaFonte}
      aoIrParaTransformar={vi.fn()}
      aoIrParaMesaExportacao={vi.fn()}
    />
  )
}

let filaTeste = criarFila(() => 'demo')
const aoAbrirExportacaoMock = vi.fn()

function renderizar() {
  filaTeste = criarFila(() => 'demo')
  return render(
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>
          <Harness />
        </ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>,
  )
}

const bytes = (t: string) => new TextEncoder().encode(t).length

describe('<FichaEmpacotamento>', () => {
  afterEach(() => {
    chamarMock.mockReset()
    copiarMock.mockReset()
  })

  it('estado vazio: "Sugerir Empacotamento" ativo e "Preencher manualmente" desabilitado com Dica humana (sem número de ticket)', async () => {
    configurarMock({ pacote: docEmpacotamento({ current: null }) })
    renderizar()
    expect(await screen.findByRole('button', { name: 'Sugerir Empacotamento' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Preencher manualmente' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const dica = screen.getByText('Preencher manualmente ainda não está disponível.')
    expect(dica).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/#\d{3}|packaging\.edit/)
  })

  it('"Sugerir Empacotamento" pago abre <ConfirmDialog> + <ResumoCustoPrivacidade> antes de packaging.generate { confirmed: true }', async () => {
    const user = userEvent.setup()
    configurarMock({
      pacote: docEmpacotamento({ current: null }),
      extra: (cmd) => {
        if (cmd === 'packaging.estimate') {
          return {
            paid: true,
            profile: 'openai-gpt4o',
            language: 'pt-BR',
            estimate: { kind: 'usd', minMicroUsd: 300, maxMicroUsd: 900 },
          }
        }
        if (cmd === 'packaging.generate') return { job: 9 }
        return undefined
      },
    })
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Sugerir Empacotamento' }))
    const dialogo = await screen.findByRole('alertdialog')
    expect(within(dialogo).getByLabelText(/Resumo de custo e privacidade/)).toBeInTheDocument()
    expect(chamarMock).not.toHaveBeenCalledWith('packaging.generate', expect.anything())
    await user.click(within(dialogo).getByRole('button', { name: /Confirmar e sugerir/ }))
    await waitFor(() =>
      expect(chamarMock).toHaveBeenCalledWith(
        'packaging.generate',
        expect.objectContaining({ candidate: 201, confirmed: true }),
      ),
    )
  })

  it('título com validador 50–70 (Curto/Ideal/Pode truncar) sem bloquear salvamento; descrição soma bytes UTF-8 + crédito contra 5000', async () => {
    const user = userEvent.setup()
    const descricao = 'Ação rápida: emoção 🎬'
    configurarMock({
      pacote: docEmpacotamento({
        current: { title: TITULO_IDEAL, description: descricao, fullDescription: `${descricao}\n\n${CREDITO}` },
      }),
    })
    renderizar()
    const titulo = await screen.findByRole('textbox', { name: 'Título' })
    expect(screen.getByText('Ideal')).toBeInTheDocument()

    await user.clear(titulo)
    await user.type(titulo, 'Curto demais')
    expect(screen.getByText('Curto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled()

    const esperado = bytes(descricao) + bytes(CREDITO) + 2
    expect(screen.getByText(`${esperado}/5000 bytes`)).toBeInTheDocument()
  })

  it('crédito protegido tem aria-readonly="true"; sem Permissão exibe alerta e link para a Fonte', async () => {
    configurarMock({
      pacote: docEmpacotamento({ credit: { text: null, warning: 'no_permission' } }),
    })
    renderizar()
    await screen.findByRole('textbox', { name: 'Título' })
    const link = screen.getByRole('link', { name: 'Registrar Permissão na Fonte' })
    expect(link).toHaveAttribute('href', '#/projeto/demo/fontes/4')
    expect(screen.getByText(/sem Permissão registrada: nenhum crédito será incluído/)).toBeInTheDocument()
  })

  it('bloco de crédito é aria-readonly="true"', async () => {
    configurarMock({})
    renderizar()
    await screen.findByRole('textbox', { name: 'Título' })
    const bloco = screen.getByLabelText(/Crédito da Fonte \(preenchido pela Permissão/)
    expect(bloco).toHaveAttribute('aria-readonly', 'true')
    expect(bloco).toHaveTextContent(CREDITO)
  })

  it('capítulos sem 00:00 mostram aviso em role="status" sem bloquear packaging.edit; "Atualizar capítulos" chama packaging.refresh_chapters', async () => {
    const user = userEvent.setup()
    const comCapitulos = '--- Capítulos ---\n00:05 Introdução\n00:20 Meio\n00:40 Fim\n--- Fim dos capítulos ---'
    configurarMock({
      pacote: docEmpacotamento({
        current: { description: `Texto do usuário.\n\n${comCapitulos}` },
        chapters: { applicable: true, status: 'ready', canGenerate: true, hasDelimiters: true, count: 3 },
      }),
      extra: (cmd) => {
        if (cmd === 'packaging.edit' || cmd === 'packaging.refresh_chapters') {
          return docEmpacotamento({
            current: { description: `Texto do usuário.\n\n--- Capítulos ---\n00:00 Introdução\n--- Fim dos capítulos ---` },
            chapters: { applicable: true, status: 'ready', canGenerate: true, hasDelimiters: true, count: 3 },
          })
        }
        return undefined
      },
    })
    renderizar()
    await screen.findByRole('textbox', { name: 'Título' })
    const avisos = screen.getAllByRole('status')
    expect(avisos.some((a) => /primeiro capítulo precisa começar em 00:00/.test(a.textContent ?? ''))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Atualizar capítulos' }))
    await waitFor(() =>
      expect(chamarMock).toHaveBeenCalledWith('packaging.refresh_chapters', {
        candidate: 201,
        description: `Texto do usuário.\n\n${comCapitulos}`,
      }),
    )

    const titulo = screen.getByRole('textbox', { name: 'Título' })
    await user.type(titulo, '!')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(chamarMock).toHaveBeenCalledWith('packaging.edit', expect.objectContaining({ candidate: 201 })),
    )
  })

  it('chapter_delimiters_missing renderiza em role="alert"', async () => {
    const user = userEvent.setup()
    configurarMock({
      pacote: docEmpacotamento({
        chapters: { applicable: true, status: 'ready', canGenerate: true, hasDelimiters: true, count: 3 },
      }),
      extra: (cmd) => {
        if (cmd === 'packaging.refresh_chapters') {
          throw new ErroCore('chapter_delimiters_missing', 'Os delimitadores foram removidos.')
        }
        return undefined
      },
    })
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Atualizar capítulos' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/marcadores de capítulos foram removidos/)
  })

  it('Guardrails: AiDisclosureNote, sobra final > 5 s, Corte > 60 s e ciência de Corte direto chama guardrails.ack_direct_notice', async () => {
    const user = userEvent.setup()
    configurarMock({
      guardrails: {
        needsDirectNotice: true,
        videoKind: 'direct',
        over60s: true,
        script: { applicable: false },
        narration: { applicable: true, hasTts: true, voices: ['13063'], freezeTailUs: 6_000_000, longFreezeTail: true },
      },
      extra: (cmd) => (cmd === 'guardrails.ack_direct_notice' ? { directMonetizationAck: true } : undefined),
    })
    renderizar()
    await screen.findByRole('textbox', { name: 'Título' })
    expect(screen.getByText(/Divulgação de conteúdo gerado por IA/)).toBeInTheDocument()
    expect(screen.getByText(/Corte acima de 60 s/)).toBeInTheDocument()
    expect(screen.getByText(/sobra final/i)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Sei que Corte direto/ }))
    await waitFor(() => expect(chamarMock).toHaveBeenCalledWith('guardrails.ack_direct_notice', {}))
  })

  it('"Copiar descrição completa" chama copiarTexto(fullDescription)', async () => {
    const user = userEvent.setup()
    configurarMock({})
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Copiar descrição completa' }))
    await waitFor(() => expect(copiarMock).toHaveBeenCalledWith(`Resumo do Corte.\n\n${CREDITO}`))
  })

  it('UI-102 / UI-103 / UI-105 / UI-106: sem span[tabindex=0], link >= 24 px, h2 antes de h3, chapter_past_end com cutDurationUs e barra superior alinhada', async () => {
    // Estado vazio: sem <span tabIndex={0}> em "Preencher manualmente"
    configurarMock({ pacote: docEmpacotamento({ current: null }) })
    const { container, unmount } = render(
      <ProvedorDicas>
        <ProvedorToast>
          <ProvedorAtalhos>
            <Harness />
          </ProvedorAtalhos>
        </ProvedorToast>
      </ProvedorDicas>,
    )
    expect(
      await screen.findByRole('button', { name: 'Preencher manualmente' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(container.querySelectorAll('span[tabindex="0"]')).toHaveLength(0)
    unmount()

    // Estado preenchido: h2 antes de h3, link >= 24 px, chapter_past_end com 00:24 em Corte de 20 s, barra alinhada
    configurarMock({
      pacote: docEmpacotamento({
        credit: { text: null, warning: 'no_permission' },
        current: {
          description:
            'Resumo.\n\n--- Capítulos ---\n00:00 Abertura\n00:10 Meio\n00:24 Fechamento\n--- Fim dos capítulos ---',
        },
        chapters: { applicable: true, status: 'ready', canGenerate: true, hasDelimiters: true, count: 3 },
      }),
      extra: (cmd) =>
        cmd === 'thumbnail.get'
          ? { current: null, history: [], job: null, cut: { startUs: 0, endUs: 20_000_000 } }
          : undefined,
    })
    const { container: c2 } = render(
      <ProvedorDicas>
        <ProvedorToast>
          <ProvedorAtalhos>
            <Harness />
          </ProvedorAtalhos>
        </ProvedorToast>
      </ProvedorDicas>,
    )

    await waitFor(() => expect(within(c2).getByRole('textbox', { name: 'Título' })).toBeInTheDocument())
    expect(c2.querySelector('h2')).not.toBeNull()
    const headings = Array.from(c2.querySelectorAll('h2, h3')).map((h) => Number(h.tagName[1]))
    expect(headings[0]).toBe(2)

    const linkPerm = within(c2).getByRole('link', { name: 'Registrar Permissão na Fonte' })
    expect(linkPerm.className).toContain('min-h-6')

    expect(
      within(c2).getByText(/ultrapassa a duração do Corte/i),
    ).toBeInTheDocument()

    const btnSugerirNovamente = within(c2).getByRole('button', { name: 'Sugerir novamente' })
    expect(btnSugerirNovamente.parentElement?.className).toContain('items-center')
    expect(btnSugerirNovamente.parentElement?.className).not.toContain('items-end')
  })
})
