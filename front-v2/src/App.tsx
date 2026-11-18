import { Esqueleto, EstadoTela, ProvedorDicas, ProvedorToast, useToast } from '@ds'
import { useCallback, useEffect } from 'react'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { iniciarProgresso } from '~/core/progresso'
import type { Rota, SecaoConfig } from '~/rotas/rotas'
import { useRota } from '~/rotas/useRota'
import { ComEstado, useEstadoForcado } from '~/shell/EstadoForcado'
import { Shell, useProjetoAtual, type ProjetoAtual } from '~/shell/Shell'
import { Assistente } from '~/telas/assistente/Assistente'
import { ConfigProvedores } from '~/telas/config/ConfigProvedores'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'
import { Inicio } from '~/telas/inicio/Inicio'

const TITULOS_CONFIG: Record<SecaoConfig, string> = {
  provedores: 'Provedores e Tarefas de IA',
  custos: 'Custos, Orçamentos e Auditoria',
  componentes: 'Componentes e Armazenamento',
  exportacao: 'Exportação e Encoder',
  aparencia: 'Aparência e Teclado',
  projeto: 'Projeto atual',
}

function irPara(hash: string) {
  window.location.hash = hash
}

function PlaceholderTela({ rota }: { rota: Rota }) {
  switch (rota.tela) {
    case 'inicio':
      return (
        <EstadoTela
          tipo="vazio"
          titulo="Início e Projetos"
          descricao="Crie ou abra um Projeto portátil para começar a trabalhar com Fontes, Transcrição e Cortes."
          acaoPrimaria={{
            rotulo: 'Abrir Configurações',
            aoAcionar: () => irPara('#/config/provedores'),
          }}
        />
      )
    case 'assistente':
      return (
        <EstadoTela
          tipo="vazio"
          titulo={`Assistente de primeiro uso · Passo ${rota.passo}`}
          descricao="Configure o FFmpeg, o Motor de transcrição local e o Perfil de Provedor padrão."
          acaoPrimaria={{
            rotulo: 'Voltar para Início',
            aoAcionar: () => irPara('#/inicio'),
          }}
        />
      )
    case 'fontes':
      return (
        <EstadoTela
          tipo="vazio"
          titulo={rota.sub === 'lotes' ? 'Lotes de Fontes' : 'Fontes e Transcrição'}
          descricao="Importe Fontes locais ou por link, acompanhe Lotes de Fontes e gerencie Permissões e Transcrições."
          acaoPrimaria={{
            rotulo: 'Ir para Cortes',
            aoAcionar: () => irPara(`#/projeto/${encodeURIComponent(rota.projeto)}/cortes`),
          }}
        />
      )
    case 'fonte':
      return (
        <EstadoTela
          tipo="vazio"
          titulo="Detalhe da Fonte"
          descricao={`Acompanhe o processamento, leia, corrija e pesquise na Transcrição da Fonte ${rota.fonte}.`}
          acaoPrimaria={{
            rotulo: 'Voltar para Fontes',
            aoAcionar: () => irPara(`#/projeto/${encodeURIComponent(rota.projeto)}/fontes`),
          }}
        />
      )
    case 'cortes':
      return (
        <EstadoTela
          tipo="vazio"
          titulo="Cortes"
          descricao="Configure a seleção de Cortes a partir da Transcrição e abra a revisão dos candidatos."
          acaoPrimaria={{
            rotulo: 'Ir para Exportação',
            aoAcionar: () => irPara(`#/projeto/${encodeURIComponent(rota.projeto)}/exportacao`),
          }}
        />
      )
    case 'revisao':
      return (
        <EstadoTela
          tipo="vazio"
          titulo="Revisão de Cortes"
          descricao={`Avalie a Nota dos candidatos da execução ${rota.run}, ajuste bordas por Frase e aprove Cortes.`}
          acaoPrimaria={{
            rotulo: 'Voltar para Cortes',
            aoAcionar: () => irPara(`#/projeto/${encodeURIComponent(rota.projeto)}/cortes`),
          }}
        />
      )
    case 'corte':
      return (
        <EstadoTela
          tipo="vazio"
          titulo={`Corte ${rota.corte} · ${rota.aba}`}
          descricao="Ajuste bordas, enquadramento, legendas, Transformação e Empacotamento do Corte."
          acaoPrimaria={{
            rotulo: 'Voltar para Cortes',
            aoAcionar: () => irPara(`#/projeto/${encodeURIComponent(rota.projeto)}/cortes`),
          }}
        />
      )
    case 'exportacao':
      return (
        <EstadoTela
          tipo="vazio"
          titulo={rota.sub === 'lotes' ? 'Lotes de exportação' : 'Exportação'}
          descricao="Confira a prontidão dos Cortes aprovados e acompanhe a renderização em MP4."
          acaoPrimaria={{
            rotulo: 'Voltar para Fontes',
            aoAcionar: () => irPara(`#/projeto/${encodeURIComponent(rota.projeto)}/fontes`),
          }}
        />
      )
    case 'config':
      return (
        <EstadoTela
          tipo="vazio"
          titulo={`Configurações · ${TITULOS_CONFIG[rota.secao]}`}
          descricao="Preferências do aplicativo, Perfis de Provedor, custos, armazenamento e configurações do Projeto."
          acaoPrimaria={{
            rotulo: 'Voltar para Início',
            aoAcionar: () => irPara('#/inicio'),
          }}
        />
      )
    case 'relatos':
      return (
        <EstadoTela
          tipo="vazio"
          titulo="Relatos e diagnóstico"
          descricao="Gere um diagnóstico local sanitizado do ambiente para relatar problemas sem telemetria."
          acaoPrimaria={{
            rotulo: 'Voltar para Início',
            aoAcionar: () => irPara('#/inicio'),
          }}
        />
      )
    case 'sobre':
      return (
        <EstadoTela
          tipo="vazio"
          titulo="Sobre e atualizações"
          descricao="Versão instalada do aplicativo, verificação de atualizações assinadas e licenças."
          acaoPrimaria={{
            rotulo: 'Voltar para Início',
            aoAcionar: () => irPara('#/inicio'),
          }}
        />
      )
  }
}

function AppRoteado({
  projeto,
  somenteLocal,
}: {
  projeto: ProjetoAtual | null
  somenteLocal: boolean
}) {
  const toast = useToast()
  const aoRedirecionar = useCallback(
    (aviso: string) => {
      toast.add({ title: aviso })
    },
    [toast],
  )

  const projetoAberto = projeto ? (projeto.id ?? projeto.name) : null
  const rota = useRota({ projetoAberto }, aoRedirecionar)
  const forcado = useEstadoForcado()

  if (rota.tela === 'inicio') {
    return (
      <Shell rota={rota} projeto={projeto} somenteLocal={somenteLocal}>
        <Inicio />
      </Shell>
    )
  }

  if (rota.tela === 'assistente') {
    return (
      <Shell rota={rota} projeto={projeto} somenteLocal={somenteLocal}>
        <Assistente passo={rota.passo} />
      </Shell>
    )
  }

  const placeholder = <PlaceholderTela rota={rota} />

  const conteudo =
    rota.tela === 'config' ? (
      rota.secao === 'provedores' ? (
        <ConfigProvedores projetoAberto={projetoAberto} />
      ) : (
        <ConfiguracoesLayout
          secao={rota.secao}
          projetoAberto={projetoAberto}
          titulo={TITULOS_CONFIG[rota.secao]}
        >
          <ComEstado
            estado={forcado ?? 'pronto'}
            carregando={<Esqueleto variante="painel" />}
            vazio={placeholder}
          >
            {placeholder}
          </ComEstado>
        </ConfiguracoesLayout>
      )
    ) : (
      <ComEstado
        estado={forcado ?? 'pronto'}
        carregando={<Esqueleto variante="painel" />}
        vazio={placeholder}
      >
        {placeholder}
      </ComEstado>
    )

  return (
    <Shell rota={rota} projeto={projeto} somenteLocal={somenteLocal}>
      {conteudo}
    </Shell>
  )
}

function AppInterno() {
  const { projeto, somenteLocal, carregando } = useProjetoAtual()

  useEffect(() => {
    let parar = () => {}
    let cancelado = false
    iniciarProgresso()
      .then((fn) => {
        if (cancelado) fn()
        else parar = fn
      })
      .catch(() => {})
    return () => {
      cancelado = true
      parar()
    }
  }, [])

  if (carregando) {
    return (
      <Shell projeto={null} somenteLocal={false} carregando>
        <Esqueleto variante="painel" />
      </Shell>
    )
  }

  return <AppRoteado projeto={projeto} somenteLocal={somenteLocal} />
}

export function App() {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>
          <AppInterno />
        </ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}
