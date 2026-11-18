import { ProvedorDicas, ProvedorToast, useToast } from '@ds'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useRota } from '~/rotas/useRota'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'

beforeAll(() => {
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

function envolver(ui: React.ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{ui}</ProvedorToast>
    </ProvedorDicas>
  )
}

function HarnessGuardaProjeto() {
  const toast = useToast()
  const rota = useRota({ projetoAberto: null }, (aviso) => {
    toast.add({ title: aviso })
  })
  const secao = rota.tela === 'config' ? rota.secao : 'provedores'
  return (
    <ConfiguracoesLayout secao={secao} projetoAberto={null} titulo="Provedores e Tarefas de IA">
      <div>Conteúdo da seção: {secao}</div>
    </ConfiguracoesLayout>
  )
}

describe('ConfiguracoesLayout', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('renderiza as 6 seções no menu lateral e marca a seção ativa com aria-current="page"', () => {
    render(
      envolver(
        <ConfiguracoesLayout
          secao="custos"
          projetoAberto="canal-1"
          titulo="Custos, Orçamentos e Auditoria"
        >
          <div>Corpo custos</div>
        </ConfiguracoesLayout>,
      ),
    )

    const nav = screen.getByRole('navigation', { name: 'Seções de Configurações' })
    expect(nav).toBeInTheDocument()

    const links = [
      'Provedores e Tarefas de IA',
      'Custos, Orçamentos e Auditoria',
      'Componentes e Armazenamento',
      'Exportação e Encoder',
      'Aparência e Teclado',
      'Projeto atual',
    ]

    for (const rotulo of links) {
      expect(screen.getByRole('link', { name: new RegExp(rotulo) })).toBeInTheDocument()
    }

    expect(screen.getByRole('link', { name: /Custos, Orçamentos e Auditoria/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: /Provedores e Tarefas de IA/ })).not.toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.queryByText('Abra um Projeto')).not.toBeInTheDocument()
  })

  it('mostra a dica "Abra um Projeto" em Projeto atual quando não há Projeto aberto', () => {
    render(
      envolver(
        <ConfiguracoesLayout
          secao="provedores"
          projetoAberto={null}
          titulo="Provedores e Tarefas de IA"
        >
          <div>Corpo provedores</div>
        </ConfiguracoesLayout>,
      ),
    )

    const linkProjeto = screen.getByRole('link', { name: /Projeto atual/ })
    expect(linkProjeto).toHaveTextContent('Abra um Projeto')
  })

  it('redireciona #/config/projeto para #/config/provedores com aviso quando não há Projeto aberto', async () => {
    window.location.hash = '#/config/projeto'
    render(envolver(<HarnessGuardaProjeto />))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/config/provedores')
    })

    expect(
      await screen.findByText('Abra um Projeto para editar estas configurações.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Conteúdo da seção: provedores')).toBeInTheDocument()
  })
})
