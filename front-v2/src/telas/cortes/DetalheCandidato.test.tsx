import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { CHAVE_PREFERENCIAS } from '~/preferencias/preferencias'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import type { ResumoRunSelecao } from '~/stores/selecaoProjeto'
import { DetalheCandidato, type CandidatoDetalhe } from '~/telas/cortes/DetalheCandidato'

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

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  window.location.hash = ''
})

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{ui}</ProvedorToast>
    </ProvedorDicas>
  )
}

const FONTE_DISPONIVEL: FonteProjeto = {
  id: 4,
  path: 'C:/videos/live-ep42.mp4',
  status: 'available',
  available: true,
  verified: true,
  audio_track: 0,
  origin_url: 'https://youtube.com/watch?v=abc',
  language: 'pt',
  permission: { status: 'granted', who: 'Criador X', where: 'YouTube', scope: 'Cortes com crédito' },
}

const RUN_DIRETO: ResumoRunSelecao = {
  id: 1,
  state: 'completed',
  minUs: 20_000_000,
  maxUs: 60_000_000,
  planState: 'full',
  revision: 2,
  revisions: [1, 2],
  videoKind: 'direct',
  weights: [
    { key: 'hook', weight: 0.3 },
    { key: 'selfContained', weight: 0.2 },
    { key: 'energy', weight: 0.2 },
    { key: 'value', weight: 0.15 },
    { key: 'closing', weight: 0.15 },
  ],
}

const RUN_TRANSFORMADO: ResumoRunSelecao = {
  ...RUN_DIRETO,
  videoKind: 'transformed',
  weights: [
    { key: 'hook', weight: 0.2 },
    { key: 'commentary', weight: 0.3 },
    { key: 'energy', weight: 0.15 },
    { key: 'value', weight: 0.15 },
    { key: 'selfContained', weight: 0.1 },
    { key: 'closing', weight: 0.1 },
  ],
}

const CANDIDATO_BASE: CandidatoDetalhe = {
  id: 101,
  rank: 0,
  startId: 10,
  endId: 14,
  startUs: 90_000_000,
  endUs: 140_000_000,
  total: 8.8,
  title: 'A virada do jogo',
  windows: [0, 1],
  profile: 'forte',
  revision: 2,
  adjusted: true,
  adjust: { extendedBefore: 1, trimmedEnd: 2 },
  chat: [{ ratio: 3.1, reaction: 'laugh', atUs: 95_000_000 }],
  axes: {
    hook: { score: 9.2, why: 'Abre com tensão imediata.' },
    selfContained: { score: 8.5, why: 'História fechada no trecho.' },
    energy: { score: 8.0, why: 'Ritmo alto na fala.' },
    value: { score: 8.8, why: 'Lição clara ao final.' },
    closing: { score: 8.4, why: 'Termina na frase de impacto.' },
    commentary: { score: 9.4, why: 'Abre espaço claro para análise e comentário.' },
  },
  status: 'pending',
  startText: 'Primeira frase 10 do Corte.',
  endText: 'Última frase 14 do Corte.',
  moves: {
    startEarlier: true,
    startLater: true,
    endEarlier: false,
    endLater: true,
  },
}

describe('DetalheCandidato (Coluna direita C.2)', () => {
  it('inicia <EixosNota> recolhido e, em Vídeo transformado, exibe Espaço para comentário (30%) em 1º ao expandir', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'proxy.map_time') return { proxyUs: 90_000_000 }
      return {}
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_TRANSFORMADO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const toggleEixos = screen.getByRole('button', { name: /Ver os 6 eixos/i })
    expect(toggleEixos).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggleEixos)
    expect(toggleEixos).toHaveAttribute('aria-expanded', 'true')

    const termos = screen.getAllByRole('term')
    expect(termos[0].textContent).toContain('Espaço para comentário')
    expect(termos[0].textContent).toContain('30%')

    // Picos de chat e ajuste de seleção visíveis
    expect(screen.getByText(/chat 3,1× acima do normal/i)).toBeInTheDocument()
    expect(screen.getByText(/risadas/i)).toBeInTheDocument()
    expect(screen.getByText(/Bordas ajustadas na seleção/i)).toBeInTheDocument()
  })

  it('mostra <Progresso> via core-progress e "Cancelar preview" (jobs.cancel) durante proxy queued/running mantendo revisão interativa', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'running',
          key: '0004abab',
          job: 7,
          progress: 25,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'proxy.status') {
        return { state: 'ready', key: '0004abab', job: 7, progress: 100, error: null }
      }
      if (cmd === 'proxy.map_time') return { proxyUs: 90_000_000 }
      if (cmd === 'jobs.cancel') return null
      return {}
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByRole('button', { name: /Cancelar preview/i })).toBeInTheDocument()

    // Enquanto proxy roda, Nota, bordas e decisões continuam 100% habilitadas
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Rejeitar/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Recuar início/i })).toBeEnabled()

    // Progresso atualiza via core-progress (sem setInterval)
    act(() => {
      filaTeste.aplicar({
        job: '7',
        project: 'demo',
        stage: 'proxy',
        percentage: 68,
        message: 'Gerando preview',
        error: null,
      })
    })
    expect(screen.getByText('68%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Cancelar preview/i }))
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 7 })
  })

  it('transiciona para <PlayerProxy> 9:16 com mediaUrl("proxy/" + key) quando core-progress conclui o proxy', async () => {
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'queued',
          key: '0004cdcd',
          job: 17,
          progress: 0,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'proxy.status') {
        return { state: 'ready', key: '0004cdcd', job: 17, progress: 100, error: null }
      }
      return {}
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByRole('button', { name: /Cancelar preview/i })).toBeInTheDocument()

    act(() => {
      filaTeste.aplicar({
        job: '17',
        project: 'demo',
        stage: 'complete',
        percentage: 100,
        message: 'Preview concluído.',
        error: null,
      })
    })

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('proxy.status', { key: '0004cdcd' })
    })
    const img = await screen.findByRole('img', { name: /Quadro do Corte/i })
    expect(img).toHaveAttribute('src', '/__clipes-media__/proxy/0004cdcd')
  })

  it('exibe fallback acionável em source_offline e component_missing mantendo Nota, bordas e decisões funcionais', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    const aoRelocalizarFonte = vi.fn()
    chamarMock.mockRejectedValueOnce(new ErroCore('source_offline', 'Fonte offline.'))

    const { rerender } = render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
          aoRelocalizarFonte={aoRelocalizarFonte}
        />,
      ),
    )

    const btnRelocalizar = await screen.findByRole('button', { name: /Ir para Fontes e relocalizar/i })
    await user.click(btnRelocalizar)
    expect(aoRelocalizarFonte).toHaveBeenCalledWith(4)

    // Decisões e texto seguem funcionais
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeEnabled()
    expect(screen.getByText('Primeira frase 10 do Corte.')).toBeInTheDocument()

    // Agora simula component_missing (FFmpeg ausente) em outro candidato
    chamarMock.mockRejectedValueOnce(new ErroCore('component_missing', 'Falta o FFmpeg.'))
    rerender(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, id: 102 }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByText(/Falta o FFmpeg para gerar o preview 9:16/i)).toBeInTheDocument()
    const btnComp = screen.getByRole('button', { name: /Instalar componente/i })
    await user.click(btnComp)
    expect(window.location.hash).toBe('#/config/componentes')
  })

  it('respeita moves.* nos botões ±1 Frase, exibe startText/endText (#307) e erro adjust_too_short inline em role="alert"', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockResolvedValue({
      state: 'ready',
      key: '0004abab',
      job: null,
      progress: 100,
      error: null,
      windowStartUs: 0,
      windowEndUs: 260_000_000,
    })

    const aoAjustar = vi.fn()
    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          erroAjuste={new ErroCore('adjust_too_short', 'Menor que 20 s.')}
          aoDecidir={vi.fn()}
          aoAjustar={aoAjustar}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(screen.getByText('Primeira frase 10 do Corte.')).toBeInTheDocument()
    expect(screen.getByText('Última frase 14 do Corte.')).toBeInTheDocument()
    expect(screen.getByText(/20 s – 1 min/i)).toBeInTheDocument()

    const recuarInicio = screen.getByRole('button', { name: /Recuar início 1 Frase/i })
    const recuarFim = screen.getByRole('button', { name: /Recuar fim 1 Frase/i })
    expect(recuarInicio).toBeEnabled()
    expect(recuarFim).toBeDisabled() // moves.endEarlier === false

    await user.click(recuarInicio)
    expect(aoAjustar).toHaveBeenCalledWith(101, 'start', -1)

    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent(/abaixo da duração mínima/i)
  })

  it('cumpre a Regra da Luz Única (único primário por estado) e carrega <ChecklistGuardaCorpos>, ack_direct_notice, angles.get e botão de conversão habilitado sem expor ticket (UI-12)', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'proxy.map_time') return { proxyUs: 90_000_000 }
      if (cmd === 'guardrails.check') {
        return {
          scope: 'single',
          directMonetizationAck: false,
          needsDirectNotice: true,
          videoKind: 'direct',
          over60s: false,
          permission: { status: 'granted', who: 'Criador X', where: 'YouTube', scope: 'Cortes' },
        }
      }
      if (cmd === 'guardrails.ack_direct_notice') return { directMonetizationAck: true }
      if (cmd === 'angles.get') {
        return {
          angles: [],
          generation: null,
          selected: null,
          busy: false,
          job: null,
        }
      }
      return {}
    })

    const { rerender } = render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    // Pendente: Aprovar é o único botão primário (bg-sinal); Abrir no editor está desabilitado; sem ChecklistGuardaCorpos
    const btnAprovar = screen.getByRole('button', { name: /Aprovar/i })
    const btnAbrirEditor = screen.getByRole('button', { name: /Abrir no editor/i })
    expect(btnAprovar.className).toContain('bg-sinal')
    expect(btnAbrirEditor).toBeDisabled()
    expect(btnAbrirEditor).toHaveAccessibleDescription(/Aprove este candidato para editar ou exportar/i)
    expect(screen.queryByRole('region', { name: /Antes de exportar/i })).not.toBeInTheDocument()

    // Botão de conversão individual em Corte direto fica habilitado e sem texto de indisponível (UI-12)
    const btnConverter = screen.getByRole('button', { name: /Converter em Vídeo transformado/i })
    expect(btnConverter).toBeEnabled()
    expect(btnConverter).not.toHaveAttribute('aria-disabled')
    expect(document.body.textContent).not.toMatch(/ainda não está disponível/i)
    expect(document.body.textContent).not.toMatch(/#\d+/)

    // Aprovado (Corte direto): Abrir no editor vira o único primário; Aprovado vira secundário; ChecklistGuardaCorpos aparece
    rerender(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, status: 'approved' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const btnAprovado = screen.getByRole('button', { name: /Aprovado/i })
    const btnAbrirEditorAtivo = screen.getByRole('button', { name: /Abrir no editor/i })
    expect(btnAprovado).toHaveAttribute('aria-pressed', 'true')
    expect(btnAprovado.className).not.toContain('bg-sinal')
    expect(btnAbrirEditorAtivo).toBeEnabled()
    expect(btnAbrirEditorAtivo.className).toContain('bg-sinal')

    const checklist = await screen.findByRole('region', { name: /Antes de exportar/i })
    const checkboxDireto = within(checklist).getByRole('checkbox', {
      name: /Corte direto pode não monetizar/i,
    })
    await user.click(checkboxDireto)
    expect(chamarMock).toHaveBeenCalledWith('guardrails.ack_direct_notice', {})

    // Aprovado em Vídeo transformado: chama angles.get e exibe orientação de Transformar
    rerender(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_TRANSFORMADO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, status: 'approved' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('angles.get', { candidate: 101 })
    })
    expect(
      await screen.findByText(/Próximo passo no Editor: escolher Ângulo → aprovar Roteiro → gerar Narração/i),
    ).toBeInTheDocument()

    // Com ângulo já selecionado em angles.get, exibe o nome do ângulo escolhido
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'guardrails.check') {
        return {
          scope: 'single',
          directMonetizationAck: true,
          needsDirectNotice: false,
          over60s: false,
          permission: { status: 'granted', who: 'Criador X', where: 'YouTube', scope: 'Cortes' },
        }
      }
      if (cmd === 'angles.get') {
        return {
          angles: [{ name: 'Foco no risco', promise: 'Mostra o que mudou.' }],
          generation: 1,
          selected: { name: 'Foco no risco', promise: 'Mostra o que mudou.' },
          busy: false,
          job: null,
        }
      }
      return {}
    })

    rerender(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_TRANSFORMADO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, id: 109, status: 'approved' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByText(/Ângulo escolhido: Foco no risco/i)).toBeInTheDocument()
  })

  it('exibe BannerErroCore com "Tentar de novo" sem renderizar checklist quando guardrails.check falha e recarrega ao clicar', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    let tentativasGuardrails = 0
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'guardrails.check') {
        tentativasGuardrails += 1
        if (tentativasGuardrails === 1) {
          throw new ErroCore('project_busy', 'Projeto ocupado.')
        }
        return {
          scope: 'single',
          directMonetizationAck: true,
          needsDirectNotice: false,
          over60s: false,
          permission: { status: 'granted', who: 'Criador X', where: 'YouTube', scope: 'Cortes' },
        }
      }
      return {}
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, status: 'approved' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Há uma tarefa ativa bloqueando esta operação no Projeto\./i)
    expect(screen.queryByRole('region', { name: /Antes de exportar/i })).not.toBeInTheDocument()

    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('region', { name: /Antes de exportar/i })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(tentativasGuardrails).toBe(2)
  })

  it('exibe BannerErroCore com "Tentar de novo" sem renderizar checklist quando angles.get falha em Vídeo transformado e recarrega ao clicar', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    let tentativasAngles = 0
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'guardrails.check') {
        return {
          scope: 'single',
          directMonetizationAck: true,
          needsDirectNotice: false,
          over60s: false,
          permission: { status: 'granted', who: 'Criador X', where: 'YouTube', scope: 'Cortes' },
        }
      }
      if (cmd === 'angles.get') {
        tentativasAngles += 1
        if (tentativasAngles === 1) {
          throw new ErroCore('run_not_found', 'Execução não encontrada.')
        }
        return {
          angles: [],
          generation: null,
          selected: { name: 'Foco no risco', promise: 'Mostra o que mudou.' },
          busy: false,
          job: null,
        }
      }
      return {}
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_TRANSFORMADO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, status: 'approved' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Esta execução de seleção não foi encontrada\./i)
    expect(screen.queryByRole('region', { name: /Antes de exportar/i })).not.toBeInTheDocument()

    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }))

    const checklist = await screen.findByRole('region', { name: /Antes de exportar/i })
    expect(within(checklist).getByText(/Ângulo escolhido: Foco no risco/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(tentativasAngles).toBe(2)
  })

  it('renderiza <Transporte> com role="toolbar" e timecode tabular', async () => {
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockResolvedValue({
      state: 'ready',
      key: '0004abab',
      job: null,
      progress: 100,
      error: null,
      windowStartUs: 0,
      windowEndUs: 260_000_000,
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const toolbar = screen.getByRole('toolbar', { name: /Controles de reprodução/i })
    expect(toolbar).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /Reproduzir/i })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /Ir para Entrada/i })).toBeInTheDocument()
  })

  it('preserva code de objeto bruto { code, message } quando angles.get rejeita sem ErroCore', async () => {
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'guardrails.check') {
        return {
          scope: 'single',
          directMonetizationAck: true,
          needsDirectNotice: false,
          over60s: false,
          permission: { status: 'granted', who: 'Criador X', where: 'YouTube', scope: 'Cortes' },
        }
      }
      if (cmd === 'angles.get') {
        throw { code: 'project_busy', message: 'Projeto ocupado' }
      }
      return {}
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_TRANSFORMADO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, status: 'approved' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Há uma tarefa ativa bloqueando esta operação no Projeto.')
  })

  it('suporta transporte controlado opcional e desabilitarAtalhosLocais sem quebrar modo padrão', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockResolvedValue({
      state: 'ready',
      key: '0004abab',
      job: null,
      progress: 100,
      error: null,
      windowStartUs: 0,
      windowEndUs: 260_000_000,
    })

    const aoMudarTempoUs = vi.fn()
    const aoMudarReproduzindo = vi.fn()

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          tempoAtualUs={12_000_000}
          aoMudarTempoUs={aoMudarTempoUs}
          reproduzindo
          aoMudarReproduzindo={aoMudarReproduzindo}
          desabilitarAtalhosLocais
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const toolbar = await screen.findByRole('toolbar', { name: /Controles de reprodução/i })
    expect(within(toolbar).getByLabelText(/Posição 00:12,0 de 00:50,0/i)).toBeInTheDocument()

    const btnPausar = within(toolbar).getByRole('button', { name: /Pausar/i })
    await user.click(btnPausar)
    expect(aoMudarReproduzindo).toHaveBeenCalledWith(false)

    await user.click(within(toolbar).getByRole('button', { name: /Ir para Entrada/i }))
    expect(aoMudarTempoUs).toHaveBeenCalledWith(0)

    await user.click(within(toolbar).getByRole('button', { name: /Ir para Saída/i }))
    expect(aoMudarTempoUs).toHaveBeenCalledWith(50_000_000)

    aoMudarTempoUs.mockClear()
    aoMudarReproduzindo.mockClear()
    btnPausar.focus()
    await user.keyboard('jkl')
    expect(aoMudarTempoUs).not.toHaveBeenCalled()
    expect(aoMudarReproduzindo).not.toHaveBeenCalled()
  })

  it('UI-31b: não força proxy para ready quando proxy.status retorna running nem quando jobId reutilizado já está concluído na Fila', async () => {
    filaTeste = criarFila(() => 'demo')
    let statusState: 'running' | 'ready' = 'running'
    chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
      const a = (args ?? {}) as Record<string, unknown>
      if (cmd === 'proxy.request') {
        const ehSegundo = Number(a.start_us) > 200_000_000
        return {
          state: 'running',
          key: ehSegundo ? '0004second' : '0004first',
          job: 7,
          progress: 40,
          error: null,
          windowStartUs: 0,
          windowEndUs: 500_000_000,
        }
      }
      if (cmd === 'proxy.status') {
        return {
          state: statusState,
          key: String(a.key),
          job: 7,
          progress: statusState === 'ready' ? 100 : 40,
          error: null,
        }
      }
      return {}
    })

    const { rerender } = render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByRole('button', { name: /Cancelar preview/i })).toBeInTheDocument()

    // 1) Se core-progress concluir mas proxy.status ainda responder 'running', NÃO força 'ready'
    act(() => {
      filaTeste.aplicar({
        job: '7',
        project: 'demo',
        stage: 'complete',
        percentage: 100,
        message: 'Preview concluído.',
        error: null,
      })
    })

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('proxy.status', { key: '0004first' })
    })
    expect(screen.queryByRole('img', { name: /Quadro do Corte/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancelar preview/i })).toBeInTheDocument()

    // 2) Troca para 2º candidato que reutiliza o mesmo jobId 7 (já 'concluido' em filaTeste)
    rerender(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{
            ...CANDIDATO_BASE,
            id: 102,
            startUs: 390_000_000,
            endUs: 410_000_000,
          }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByRole('button', { name: /Cancelar preview/i })).toBeInTheDocument()
    // Não deve pular para 100% nem exibir PlayerProxy antes de o 2º proxy ficar ready
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Quadro do Corte/i })).not.toBeInTheDocument()

    // Agora o 2º proxy conclui e proxy.status retorna 'ready'
    statusState = 'ready'
    act(() => {
      filaTeste.aplicar({
        job: '7',
        project: 'demo',
        stage: 'complete',
        percentage: 100,
        message: 'Preview concluído.',
        error: null,
      })
    })

    const img = await screen.findByRole('img', { name: /Quadro do Corte/i })
    expect(img).toHaveAttribute('src', '/__clipes-media__/proxy/0004second')
  })

  it('UI-32a/b: acompanha modo WCAG 2.1.4 nos <Kbd>, remove I/O do <Transporte> da Bancada e elimina <span tabIndex={0}>', async () => {
    localStorage.setItem(
      CHAVE_PREFERENCIAS,
      JSON.stringify({ modoTeclasUnicas: 'alt', teclasUnicas: true }),
    )
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockResolvedValue({
      state: 'ready',
      key: '0004abab',
      job: null,
      progress: 100,
      error: null,
      windowStartUs: 0,
      windowEndUs: 260_000_000,
    })

    const { container, unmount } = render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    await screen.findByRole('img', { name: /Quadro do Corte/i })

    // <Kbd> de A, R, I, O refletem Alt+tecla em modo 'alt'
    const kbds = Array.from(container.querySelectorAll('kbd')).map((k) => k.textContent?.trim())
    expect(kbds).toContain('Alt+A')
    expect(kbds).toContain('Alt+R')
    expect(kbds).toContain('Alt+I')
    expect(kbds).toContain('Alt+O')
    expect(kbds).not.toContain('A')
    expect(kbds).not.toContain('R')

    // <Transporte> na Bancada não renderiza botões I/O redundantes nem <span tabIndex={0}>
    const toolbar = screen.getByRole('toolbar', { name: /Controles de reprodução/i })
    expect(within(toolbar).queryByRole('button', { name: /Definir Entrada/i })).not.toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: /Definir Saída/i })).not.toBeInTheDocument()
    expect(container.querySelector('span[tabindex="0"]')).toBeNull()

    const btnConverter = screen.getByRole('button', { name: /Converter em Vídeo transformado/i })
    expect(btnConverter).toBeEnabled()
    expect(btnConverter).not.toHaveAttribute('aria-disabled')

    // Modo 'desligadas' oculta Kbd de teclas únicas mas preserva Enter
    unmount()
    localStorage.setItem(
      CHAVE_PREFERENCIAS,
      JSON.stringify({ modoTeclasUnicas: 'desligadas', teclasUnicas: false }),
    )
    const { container: containerDesligado } = render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, id: 109 }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )
    const kbdsDesligados = Array.from(containerDesligado.querySelectorAll('kbd')).map((k) =>
      k.textContent?.trim(),
    )
    expect(kbdsDesligados).toEqual(['Enter'])
  })

  it('UI-34c: substitui <img> quebrada no <PlayerProxy> por placeholder limpo quando o poster falha ao carregar', async () => {
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockResolvedValue({
      state: 'ready',
      key: '0004broken',
      job: null,
      progress: 100,
      error: null,
      windowStartUs: 0,
      windowEndUs: 260_000_000,
    })

    const { container } = render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const img = await screen.findByRole('img', { name: /Quadro do Corte/i })
    fireEvent.error(img)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: /Quadro do Corte/i })).toBeInTheDocument()
  })

  it('UI-35b: traduz profile "legacy" para "Perfil configurado" sem expor "legacy"', async () => {
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockResolvedValue({
      state: 'ready',
      key: '0004abab',
      job: null,
      progress: 100,
      error: null,
      windowStartUs: 0,
      windowEndUs: 260_000_000,
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, profile: 'legacy' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByText(/Gerado por Perfil configurado/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\blegacy\b/i)
  })

  it('UI-55: resolve label do perfil via provider.profiles.list, trata "forte" e "Legacy" sem sensibilidade a caixa', async () => {
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'provider.profiles.list') {
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
          ],
        }
      }
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      return {}
    })

    const { rerender } = render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, profile: 'remoto-rapido' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    expect(await screen.findByText(/Gerado por Perfil Rápido/i)).toBeInTheDocument()

    rerender(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, id: 102, profile: 'forte' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )
    expect(await screen.findByText(/Gerado por Forte remoto/i)).toBeInTheDocument()

    rerender(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, id: 103, profile: 'Legacy' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )
    expect(await screen.findByText(/Gerado por Perfil configurado/i)).toBeInTheDocument()
  })

  it('UI-56: desabilita <Transporte> sem preview pronto/fonte offline', async () => {
    filaTeste = criarFila(() => 'demo')
    chamarMock.mockResolvedValue({
      state: 'error',
      key: null,
      job: null,
      progress: 0,
      error: { code: 'source_offline', message: 'Arquivo offline' },
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={{ ...FONTE_DISPONIVEL, status: 'offline', available: false }}
          candidato={CANDIDATO_BASE}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
        />,
      ),
    )

    const toolbar = await screen.findByRole('toolbar', { name: /Controles de reprodução/i })
    for (const btn of toolbar.querySelectorAll('button')) {
      expect(btn).toBeDisabled()
    }

    const btnConverter = screen.getByRole('button', { name: /Converter em Vídeo transformado/i })
    expect(btnConverter).toBeEnabled()
  })

  it('converte candidato direto em Vídeo transformado via ConfirmDialog, atualiza selo/guardrails/angles e trata erro com mensagemDeErro', async () => {
    const user = userEvent.setup()
    filaTeste = criarFila(() => 'demo')
    const aoConverterMock = vi.fn()
    let convertido = false
    let falhar = true
    let resolverConversao: ((v: unknown) => void) | null = null

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'provider.profiles.list') return { profiles: [] }
      if (cmd === 'proxy.request') {
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 260_000_000,
        }
      }
      if (cmd === 'guardrails.check') {
        return {
          scope: 'single',
          directMonetizationAck: false,
          needsDirectNotice: !convertido,
          over60s: false,
          permission: { status: 'granted', who: 'Criador X', where: 'YouTube', scope: 'Cortes com crédito' },
        }
      }
      if (cmd === 'angles.get') {
        return { selected: null, generation: null, busy: false }
      }
      if (cmd === 'selection.candidate.set_kind') {
        if (falhar) {
          throw { code: 'invalid_video_kind', message: 'raw code error' }
        }
        convertido = true
        return new Promise((resolve) => {
          resolverConversao = resolve
        })
      }
      return {}
    })

    render(
      envolver(
        <DetalheCandidato
          projetoId="demo"
          run={RUN_DIRETO}
          fonte={FONTE_DISPONIVEL}
          candidato={{ ...CANDIDATO_BASE, status: 'approved' }}
          aoDecidir={vi.fn()}
          aoAjustar={vi.fn()}
          aoAbrirEditor={vi.fn()}
          aoConverterParaTransformado={aoConverterMock}
        />,
      ),
    )

    expect(await screen.findByText('Corte direto')).toBeInTheDocument()
    const btnConverter = screen.getByRole('button', { name: 'Converter em Vídeo transformado' })

    // Abre diálogo, cancela -> mantém Corte direto e devolve foco ao gatilho
    await user.click(btnConverter)
    await screen.findByRole('alertdialog')
    const btnCancelar = screen.getByRole('button', { name: 'Cancelar' })
    await waitFor(() => expect(btnCancelar).toHaveFocus())
    await user.click(btnCancelar)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(btnConverter).toHaveFocus())

    // Reabre, falha primeiro -> BannerErroCore traduzido mantém diálogo aberto
    await user.click(btnConverter)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Confirmar conversão' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Tipo de vídeo inválido: escolha Corte direto ou Vídeo transformado\./i)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    // Tenta de novo com sucesso -> carregando -> atualiza selo, remove botão, chama angles.get e move foco
    falhar = false
    const btnConfirmar = screen.getByRole('button', { name: 'Confirmar conversão' })
    await user.click(btnConfirmar)
    await waitFor(() => {
      expect(btnConfirmar).toHaveAttribute('aria-busy', 'true')
      expect(btnConfirmar).toBeDisabled()
    })

    await act(async () => {
      resolverConversao?.({
        run: 1,
        candidate: 101,
        videoKind: 'transformed',
        canUndo: false,
        item: {
          candidate: 101,
          status: 'approved',
          adjusted: true,
          videoKind: 'transformed',
          startId: 10,
          endId: 14,
          startUs: 90_000_000,
          endUs: 140_000_000,
          startText: 'Primeira frase 10 do Corte.',
          endText: 'Última frase 14 do Corte.',
        },
      })
    })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByText('Vídeo transformado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Converter em Vídeo transformado' })).not.toBeInTheDocument()
    expect(aoConverterMock).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('angles.get', { candidate: 101 })
    })
    expect(
      await screen.findByText(/Próximo passo no Editor: escolher Ângulo/i),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /Aprovado/i })).toHaveFocus())
  })
})
