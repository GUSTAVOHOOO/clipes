import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import {
  BarraAcoes,
  caixaCampo,
  Dialogo,
  EixosNota,
  Entrada,
  faixaUsd,
  PlayerProxy,
  ProvedorDicas,
  ProvedorToast,
  ResumoCustoPrivacidade,
  Segmentado,
  Select,
  Slider,
  Transporte,
  usd,
  useToast,
} from '@ds'

function GatilhoToast() {
  const toast = useToast()
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => toast.add({ type: 'aviso', title: 'Fonte não encontrada' })}
      >
        Disparar aviso
      </button>
      <button
        type="button"
        onClick={() => toast.add({ type: 'erro', title: 'Falha crítica' })}
      >
        Disparar erro
      </button>
      <button type="button" onClick={() => toast.add({ title: 'Operação concluída' })}>
        Disparar sucesso
      </button>
    </div>
  )
}

describe('Design System v2 — Toast aviso e formatadores USD (UI-27a, UI-28)', () => {
  it('UI-27a: Toast com type="aviso" exibe ícone de aviso em vez de check de sucesso, preservando erro e sucesso', async () => {
    const user = userEvent.setup()
    render(
      <ProvedorToast>
        <GatilhoToast />
      </ProvedorToast>,
    )

    await user.click(screen.getByRole('button', { name: 'Disparar aviso' }))
    const textoAviso = await screen.findByText('Fonte não encontrada')
    const toastAviso = textoAviso.closest('[class*="rounded-controle"]')
    expect(toastAviso).not.toBeNull()
    expect(toastAviso!.querySelector('.lucide-triangle-alert')).not.toBeNull()
    expect(toastAviso!.querySelector('.lucide-check')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Disparar erro' }))
    const textoErro = await screen.findByText('Falha crítica')
    const toastErro = textoErro.closest('[class*="rounded-controle"]')
    expect(toastErro!.querySelector('.lucide-circle-x')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Disparar sucesso' }))
    const textoSucesso = await screen.findByText('Operação concluída')
    const toastSucesso = textoSucesso.closest('[class*="rounded-controle"]')
    expect(toastSucesso!.querySelector('.lucide-check')).not.toBeNull()
  })

  it('UI-28: usd e faixaUsd formatam microvalores positivos abaixo de US$ 0,01 como "< US$ 0,01" mantendo zero como "US$ 0,00"', () => {
    expect(usd(0)).toBe('US$ 0,00')
    expect(usd(120)).toBe('< US$ 0,01')
    expect(usd(9_999)).toBe('< US$ 0,01')
    expect(usd(10_000)).toBe('US$ 0,01')
    expect(usd(40_000)).toBe('US$ 0,04')

    expect(faixaUsd(0, 0)).toBe('US$ 0,00')
    expect(faixaUsd(120, 240)).toBe('< US$ 0,01')
    expect(faixaUsd(5_000, 40_000)).toBe('< US$ 0,01 – US$ 0,04')
    expect(faixaUsd(40_000, 40_000)).toBe('US$ 0,04')
    expect(faixaUsd(35_000, 55_000)).toBe('~US$ 0,04 – US$ 0,06')
  })

  it('UI-28: <ResumoCustoPrivacidade> exibe "< US$ 0,01" quando min e max estão abaixo de 1 centavo', () => {
    render(
      <ResumoCustoPrivacidade
        tarefa="Transcrição Groq"
        perfil={{ id: 'groq', label: 'Groq', kind: 'groq', model: 'whisper-large-v3-turbo' }}
        localidade="remoto"
        saiDaMaquina
        host="api.groq.com"
        estimativa={{ kind: 'usd', minMicroUsd: 120, maxMicroUsd: 240 }}
      />,
    )

    expect(screen.getByText('< US$ 0,01')).toBeInTheDocument()
    expect(screen.queryByText(/~US\$ 0,00/)).not.toBeInTheDocument()
  })

  it('UI-50: caixaCampo, Entrada, Select e Slider declaram outline-solid com outline-2 no foco', () => {
    expect(caixaCampo).toContain('focus-visible:outline-solid')
    expect(caixaCampo).toContain('focus-visible:outline-2')

    render(
      <div>
        <Entrada aria-label="Duração teste" value="20" onChange={() => undefined} />
        <Select
          rotulo="Fonte teste"
          valor="1"
          aoMudar={() => undefined}
          opcoes={[{ valor: '1', rotulo: 'Opção 1' }]}
        />
        <Slider valor={5} aoMudar={() => undefined} rotulo="Nota teste" />
      </div>,
    )

    expect(screen.getByRole('textbox', { name: 'Duração teste' }).className).toContain(
      'focus-visible:outline-solid',
    )
    expect(screen.getByRole('combobox', { name: 'Fonte teste' }).className).toContain(
      'focus-visible:outline-solid',
    )
    const sliderInput = screen.getByRole('slider', { name: 'Nota teste' })
    const thumb = sliderInput.parentElement!
    expect(thumb.className).toContain('has-focus-visible:outline-solid')
  })

  it('UI-55: <EixosNota> formata pesos decimais em PT-BR com vírgula', async () => {
    const user = userEvent.setup()
    render(
      <EixosNota
        eixos={[
          { nome: 'Gancho', peso: 3, valor: 8.5, porque: 'Forte.' },
          { nome: 'Fechamento', peso: 1.5, valor: 7.5, porque: 'Bom.' },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Ver os 2 eixos/i }))
    expect(screen.getByText('×1,5')).toBeInTheDocument()
    expect(screen.queryByText('×1.5')).not.toBeInTheDocument()
  })

  it('UI-56: <PlayerProxy> recebe contorno via --contorno-controle e <Transporte desabilitado> desabilita botões', () => {
    const { container } = render(
      <ProvedorDicas>
        <PlayerProxy
          sourceId={4}
          fonteDisponivel
          startUs={0}
          endUs={30_000_000}
          poster="/proxy.jpg"
          modo="previa_9_16"
          tempoAtualUs={0}
          reproduzindo={false}
          aoMudarTempoUs={() => undefined}
          aoMudarReproduzindo={() => undefined}
        />
        <Transporte
          tempoUs={0}
          duracaoUs={30_000_000}
          reproduzindo={false}
          desabilitado
          aoAlternar={() => undefined}
          aoInicio={() => undefined}
          aoFim={() => undefined}
          aoAlternarMudo={() => undefined}
        />
      </ProvedorDicas>,
    )

    const quadro = container.querySelector('.aspect-\\[9\\/16\\]')!
    expect(quadro.className).toContain('--contorno-controle')

    const toolbar = screen.getByRole('toolbar', { name: 'Controles de reprodução' })
    for (const btn of toolbar.querySelectorAll('button')) {
      expect(btn).toBeDisabled()
    }
  })

  it('UI-62: <Dialogo> e <BarraAcoes> não iniciam foco em "Fechar (Esc)" e Esc no popover devolve foco ao gatilho', async () => {
    const user = userEvent.setup()

    function Cena() {
      const [dlgAberto, setDlgAberto] = useState(false)
      const [popAberto, setPopAberto] = useState<string | null>(null)
      return (
        <ProvedorDicas>
          <button type="button" onClick={() => setDlgAberto(true)}>
            Abrir diálogo
          </button>
          <Dialogo
            aberto={dlgAberto}
            aoMudarAberto={setDlgAberto}
            titulo="Exportar"
            rodape={<button type="button">Iniciar</button>}
          >
            <input aria-label="Destino" defaultValue="/a.mp4" />
          </Dialogo>
          <BarraAcoes
            aberta={popAberto}
            aoMudarAberta={setPopAberto}
            acoes={[
              {
                id: 'enquadrar',
                rotulo: 'Enquadrar',
                icone: <span aria-hidden>E</span>,
                conteudo: <button type="button">Rosto</button>,
              },
            ]}
          />
        </ProvedorDicas>
      )
    }

    render(<Cena />)

    await user.click(screen.getByRole('button', { name: 'Abrir diálogo' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Destino' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Fechar (Esc)' })).not.toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const gatilho = screen.getByRole('button', { name: 'Enquadrar' })
    await user.click(gatilho)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rosto' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Fechar (Esc)' })).not.toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(gatilho).toHaveFocus())
  })

  it('UI-67: <Segmentado> impede quebra de linha com whitespace-nowrap e min-h-6.5', () => {
    render(
      <Segmentado
        rotulo="Modo do palco"
        valor="previa_9_16"
        aoMudar={() => undefined}
        opcoes={[
          { valor: 'previa_9_16', rotulo: 'Prévia 9:16' },
          { valor: 'fonte_16_9', rotulo: 'Enquadrar na Fonte 16:9' },
        ]}
      />,
    )
    const btn = screen.getByRole('radio', { name: 'Enquadrar na Fonte 16:9' })
    expect(btn.className).toContain('whitespace-nowrap')
    expect(btn.className).toContain('min-h-6.5')
  })
})
