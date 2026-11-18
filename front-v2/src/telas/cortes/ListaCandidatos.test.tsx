import { ProvedorDicas, ProvedorToast } from '@ds'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ListaCandidatos,
  type CandidatoLista,
  type FiltroEstadoCandidato,
  type OrdenacaoCandidatos,
} from '~/telas/cortes/ListaCandidatos'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-index')) {
      return {
        width: 360,
        height: 56,
        top: 0,
        left: 0,
        bottom: 56,
        right: 360,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    }
    return {
      width: 380,
      height: 500,
      top: 0,
      left: 0,
      bottom: 500,
      right: 380,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  }

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 500
    },
  })

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{ui}</ProvedorToast>
    </ProvedorDicas>
  )
}

const CANDIDATOS_MOCK: CandidatoLista[] = [
  {
    id: 101,
    rank: 0,
    title: 'A virada do jogo',
    total: 8.8,
    chat: [{ ratio: 3.1, reaction: 'laugh', atUs: 95_000_000 }],
    windows: [0, 1],
    profile: 'forte',
    revision: 2,
    adjusted: false,
    adjust: null,
    status: 'pending',
    startUs: 90_000_000,
    endUs: 140_000_000,
    startText: 'Primeira frase 10.',
    endText: 'Última frase 14.',
  },
  {
    id: 102,
    rank: 1,
    title: '',
    total: 7.5,
    chat: [],
    windows: [0],
    profile: 'legacy',
    revision: 2,
    adjusted: true,
    adjust: { extendedAfter: 1 },
    status: 'approved',
    startUs: 390_000_000,
    endUs: 410_000_000,
    startText: 'Primeira frase 40.',
    endText: 'Última frase 41.',
  },
  {
    id: 103,
    rank: 2,
    title: 'Piada de abertura',
    total: 6.2,
    chat: [],
    windows: [0],
    profile: 'legacy',
    revision: 2,
    adjusted: false,
    adjust: null,
    status: 'rejected',
    startUs: 30_000_000,
    endUs: 65_000_000,
    startText: 'Primeira frase 4.',
    endText: 'Última frase 7.',
  },
]

function ListaControlada({
  candidatos = CANDIDATOS_MOCK,
  aoSelecionarSpy,
}: {
  candidatos?: CandidatoLista[]
  aoSelecionarSpy?: (c: CandidatoLista) => void
}) {
  const [selecionadoId, setSelecionadoId] = useState<number | null>(candidatos[0]?.id ?? null)
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoCandidato>('todos')
  const [notaMinima, setNotaMinima] = useState<number>(0)
  const [ordenacao, setOrdenacao] = useState<OrdenacaoCandidatos>('nota')

  return (
    <ListaCandidatos
      candidatos={candidatos}
      selecionadoId={selecionadoId}
      aoSelecionar={(c) => {
        setSelecionadoId(c.id)
        aoSelecionarSpy?.(c)
      }}
      filtroEstado={filtroEstado}
      aoMudarFiltroEstado={setFiltroEstado}
      notaMinima={notaMinima}
      aoMudarNotaMinima={setNotaMinima}
      ordenacao={ordenacao}
      aoMudarOrdenacao={setOrdenacao}
      aoLimparFiltros={() => {
        setFiltroEstado('todos')
        setNotaMinima(0)
      }}
    />
  )
}

describe('ListaCandidatos (Coluna esquerda C.2)', () => {
  it('renderiza <ListaVirtual> com role="listbox", tabIndex={0}, aria-activedescendant e navega com ↑/↓', async () => {
    const user = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(envolver(<ListaControlada aoSelecionarSpy={aoSelecionar} />))

    const listbox = screen.getByRole('listbox', { name: /Candidatos a Corte/i })
    expect(listbox).toHaveAttribute('tabindex', '0')
    const activedescendantInicial = listbox.getAttribute('aria-activedescendant')
    expect(activedescendantInicial).toBeTruthy()

    listbox.focus()
    expect(listbox).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(aoSelecionar).toHaveBeenCalledWith(expect.objectContaining({ id: 102 }))
    const activedescendantDepois = listbox.getAttribute('aria-activedescendant')
    expect(activedescendantDepois).toBeTruthy()
    expect(activedescendantDepois).not.toBe(activedescendantInicial)

    await user.keyboard('{ArrowUp}')
    expect(aoSelecionar).toHaveBeenLastCalledWith(expect.objectContaining({ id: 101 }))
  })

  it('exibe candidato V1 sem título como "Sem título", com início, duração, Nota tabular e ícone de decisão', () => {
    render(envolver(<ListaControlada />))

    const opcoes = screen.getAllByRole('option')
    expect(opcoes).toHaveLength(3)

    expect(screen.getByText('A virada do jogo')).toBeInTheDocument()
    expect(screen.getByText('Sem título')).toBeInTheDocument()
    expect(screen.getByText('00:06:30')).toBeInTheDocument()
    expect(screen.getByText('20 s')).toBeInTheDocument()
    expect(screen.getByText('7,5')).toBeInTheDocument()
    expect(screen.getByLabelText('Aprovado')).toBeInTheDocument()
    expect(screen.getByLabelText('Rejeitado')).toBeInTheDocument()
  })

  it('filtra por estado no <Segmentado> e por Nota mínima no <Slider> sem perder os demais candidatos', async () => {
    const user = userEvent.setup()
    render(envolver(<ListaControlada />))

    const grupoEstado = screen.getByRole('radiogroup', { name: /Filtrar por estado/i })
    const btnAprovados = within(grupoEstado).getByRole('radio', { name: /Aprov\.\s*\(1\)/i })
    await user.click(btnAprovados)

    let opcoes = screen.getAllByRole('option')
    expect(opcoes).toHaveLength(1)
    expect(within(opcoes[0]).getByText('Sem título')).toBeInTheDocument()

    // Volta para Todos: os 3 candidatos continuam disponíveis
    const btnTodos = within(grupoEstado).getByRole('radio', { name: /Todos\s*\(3\)/i })
    await user.click(btnTodos)
    expect(screen.getAllByRole('option')).toHaveLength(3)

    // Ajusta Slider Nota mínima para 8,5
    const slider = screen.getByRole('slider', { name: /Nota mínima/i })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '10')
    fireEvent.change(slider, { target: { value: '8.5' } })
    expect(slider).toHaveAttribute('aria-valuetext', 'Nota mínima 8,5 de 10')

    opcoes = screen.getAllByRole('option')
    expect(opcoes).toHaveLength(1)
    expect(within(opcoes[0]).getByText('A virada do jogo')).toBeInTheDocument()
  })

  it('ordena por "Ordem na Fonte" (startUs crescente) e volta para "Maior Nota"', async () => {
    const user = userEvent.setup()
    render(envolver(<ListaControlada />))

    const ordemInicial = screen.getAllByRole('option').map((el) => el.textContent ?? '')
    expect(ordemInicial[0]).toContain('A virada do jogo')
    expect(ordemInicial[1]).toContain('Sem título')
    expect(ordemInicial[2]).toContain('Piada de abertura')

    const selectOrdem = screen.getByRole('combobox', { name: /Ordenar candidatos/i })
    await user.click(selectOrdem)
    await user.click(await screen.findByRole('option', { name: 'Ordem na Fonte' }))

    const ordemFonte = screen.getAllByRole('option').map((el) => el.textContent ?? '')
    // 30s (Piada de abertura) -> 90s (A virada do jogo) -> 390s (Sem título)
    expect(ordemFonte[0]).toContain('Piada de abertura')
    expect(ordemFonte[1]).toContain('A virada do jogo')
    expect(ordemFonte[2]).toContain('Sem título')
  })

  it('exibe estado vazio quando filtro zera a lista e "Limpar filtros" restaura Todos e 0,0', async () => {
    const user = userEvent.setup()
    render(envolver(<ListaControlada />))

    const slider = screen.getByRole('slider', { name: /Nota mínima/i })
    fireEvent.change(slider, { target: { value: '9.5' } })

    expect(screen.getByText('Nenhum candidato corresponde aos filtros atuais')).toBeInTheDocument()
    const btnLimpar = screen.getByRole('button', { name: 'Limpar filtros' })
    await user.click(btnLimpar)

    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('slider', { name: /Nota mínima/i })).toHaveAttribute(
      'aria-valuetext',
      'Nota mínima 0,0 de 10',
    )
  })

  it('UI-34b: não usa botão primário bg-sinal em "Limpar filtros" quando há candidato selecionado no detalhe', () => {
    render(envolver(<ListaControlada />))

    const slider = screen.getByRole('slider', { name: /Nota mínima/i })
    fireEvent.change(slider, { target: { value: '9.5' } })

    const btnLimpar = screen.getByRole('button', { name: 'Limpar filtros' })
    expect(btnLimpar.className).not.toContain('bg-sinal')
  })

  it('UI-33b: mantém "Nota mínima" sem quebra de linha e reserva largura ao Slider ao lado do Select', () => {
    render(envolver(<ListaControlada />))

    const rotuloNota = screen.getByText('Nota mínima')
    expect(rotuloNota.className).toContain('whitespace-nowrap')
    const selectOrdem = screen.getByRole('combobox', { name: /Ordenar candidatos/i })
    expect(selectOrdem.className).not.toContain('min-w-[140px]')
  })
})
