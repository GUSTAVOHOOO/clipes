import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  faixaUsd,
  ProvedorToast,
  ResumoCustoPrivacidade,
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
})
