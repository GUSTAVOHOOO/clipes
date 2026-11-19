import { Esqueleto, EstadoTela, ProvedorDicas, ProvedorToast, useToast } from '@ds'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { definirProjetoDaFila, iniciarProgresso } from '~/core/progresso'
import { aplicarPreferencias } from '~/preferencias/aplicarPreferencias'
import { usePreferencias } from '~/preferencias/preferencias'
import type { Rota, SecaoConfig } from '~/rotas/rotas'
import { useRota } from '~/rotas/useRota'
import { ComEstado, useEstadoForcado } from '~/shell/EstadoForcado'
import { Shell, useProjetoAtual, type ProjetoAtual } from '~/shell/Shell'
import { Assistente } from '~/telas/assistente/Assistente'
import { ConfigAparencia } from '~/telas/config/ConfigAparencia'
import { ConfigComponentes } from '~/telas/config/ConfigComponentes'
import { ConfigCustos } from '~/telas/config/ConfigCustos'
import { ConfigExportacao } from '~/telas/config/ConfigExportacao'
import { ConfigProjeto } from '~/telas/config/ConfigProjeto'
import { ConfigProvedores } from '~/telas/config/ConfigProvedores'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'
import { ContextoCorteConectado } from '~/telas/corte/ContextoCorteConectado'
import {
  EditarCorte,
  type AcoesExternasEditarCorte,
  type MetaCorteResolvida,
} from '~/telas/corte/EditarCorte'
import { Revisao } from '~/telas/cortes/Revisao'
import { Selecao } from '~/telas/cortes/Selecao'
import { Exportacao } from '~/telas/exportacao/Exportacao'
import { DetalheFonte } from '~/telas/fontes/DetalheFonte'
import { Fontes } from '~/telas/fontes/Fontes'
import { Inicio } from '~/telas/inicio/Inicio'
import { Relatos } from '~/telas/relatos/Relatos'

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

function mesmaSessaoEditar(a: Rota, b: Rota): boolean {
  return (
    a.tela === 'corte' &&
    a.aba === 'editar' &&
    b.tela === 'corte' &&
    b.aba === 'editar' &&
    a.projeto === b.projeto &&
    a.corte === b.corte
  )
}

function PlaceholderTela({
  rota,
  nivelTitulo = 'h1',
}: {
  rota: Rota
  nivelTitulo?: 'h1' | 'h2'
}) {
  switch (rota.tela) {
    case 'inicio':
      return (
        <EstadoTela
          tipo="vazio"
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
          nivelTitulo={nivelTitulo}
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
  const ultimoAvisoRef = useRef<{ texto: string; em: number } | null>(null)
  const aoRedirecionar = useCallback(
    (aviso: string) => {
      const agora = Date.now()
      const ant = ultimoAvisoRef.current
      if (ant && ant.texto === aviso && agora - ant.em < 250) return
      ultimoAvisoRef.current = { texto: aviso, em: agora }
      toast.add({ title: aviso })
    },
    [toast],
  )

  const projetoAberto = projeto ? (projeto.id ?? projeto.name) : null
  const rota = useRota({ projetoAberto }, aoRedirecionar)
  const forcado = useEstadoForcado()

  const guardaSaidaRef = useRef<(() => Promise<boolean>) | null>(null)
  const saidaLiberadaRef = useRef(false)
  const verificandoSaidaRef = useRef(false)
  const rotaEstavelRef = useRef<Rota>(rota)
  const hashEstavelRef = useRef<string>(window.location.hash)

  const [metaCorte, setMetaCorte] = useState<MetaCorteResolvida>({
    clipId: undefined,
    fonte: null,
    videoKind: 'direct',
  })
  const [statusSalvamentoEditor, setStatusSalvamentoEditor] = useState<ReactNode>(null)
  const acoesEditarRef = useRef<AcoesExternasEditarCorte | null>(null)

  const estavel = rotaEstavelRef.current
  const tentandoSairSemLiberacao =
    estavel.tela === 'corte' &&
    estavel.aba === 'editar' &&
    !mesmaSessaoEditar(estavel, rota) &&
    !saidaLiberadaRef.current &&
    guardaSaidaRef.current !== null

  const rotaExibida = tentandoSairSemLiberacao ? estavel : rota

  useEffect(() => {
    if (tentandoSairSemLiberacao) {
      if (verificandoSaidaRef.current) return
      verificandoSaidaRef.current = true
      const destino = window.location.hash
      const origem = hashEstavelRef.current
      window.history.replaceState(null, '', origem)

      const guarda = guardaSaidaRef.current
      if (!guarda) {
        verificandoSaidaRef.current = false
        saidaLiberadaRef.current = true
        window.location.hash = destino
        return
      }

      void guarda().then((podeSair) => {
        verificandoSaidaRef.current = false
        if (podeSair) {
          saidaLiberadaRef.current = true
          window.location.hash = destino
          window.dispatchEvent(new HashChangeEvent('hashchange'))
        } else {
          window.dispatchEvent(new HashChangeEvent('hashchange'))
        }
      })
      return
    }

    saidaLiberadaRef.current = false
    rotaEstavelRef.current = rota
    hashEstavelRef.current = window.location.hash
  }, [rota, tentandoSairSemLiberacao])

  const aoRegistrarGuardaSaida = useCallback((fn: () => Promise<boolean>) => {
    guardaSaidaRef.current = fn
  }, [])

  const aoAntesDeNavegarEditar = useCallback(async () => {
    const guarda = guardaSaidaRef.current
    if (!guarda) return true
    const pode = await guarda()
    if (pode) {
      saidaLiberadaRef.current = true
    }
    return pode
  }, [])

  if (rotaExibida.tela === 'inicio') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <Inicio />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'assistente') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <Assistente passo={rotaExibida.passo} />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'fontes') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <Fontes
          projetoId={rotaExibida.projeto}
          projetoPath={projeto?.path ?? null}
          sub={rotaExibida.sub}
        />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'fonte') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <DetalheFonte
          projetoId={rotaExibida.projeto}
          projetoPath={projeto?.path ?? null}
          fonteId={rotaExibida.fonte}
          frase={rotaExibida.frase}
          row={rotaExibida.row}
        />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'cortes') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <Selecao
          projetoId={rotaExibida.projeto}
          projetoPath={projeto?.path ?? null}
          fonteParam={rotaExibida.fonte}
          runParam={rotaExibida.run}
          revParam={rotaExibida.rev}
        />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'revisao') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <Revisao
          projetoId={rotaExibida.projeto}
          projetoPath={projeto?.path ?? null}
          runParam={rotaExibida.run}
          revParam={rotaExibida.rev}
          corteParam={rotaExibida.corte}
        />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'corte' && rotaExibida.aba === 'editar') {
    return (
      <Shell
        rota={rotaExibida}
        projeto={projeto}
        somenteLocal={somenteLocal}
        semPaddingConteudo
        statusSalvamento={statusSalvamentoEditor}
        meio={
          <ContextoCorteConectado
            projetoId={rotaExibida.projeto}
            corteId={rotaExibida.corte}
            subAbaAtiva="editar"
            runId={rotaExibida.run}
            fonte={metaCorte.fonte}
            clipId={metaCorte.clipId}
            aoAntesDeNavegar={aoAntesDeNavegarEditar}
            aoIrParaTranscricaoPalavra={(pos) =>
              acoesEditarRef.current?.irParaTranscricaoPalavra(pos)
            }
            aoIrParaAudio={() => acoesEditarRef.current?.abrirAbaAudio()}
            aoFonteRelocalizada={(atualizada) =>
              setMetaCorte((prev) => ({ ...prev, fonte: atualizada }))
            }
          />
        }
      >
        <EditarCorte
          projetoId={rotaExibida.projeto}
          projetoPath={projeto?.path ?? null}
          corteId={rotaExibida.corte}
          runId={rotaExibida.run}
          aoRegistrarGuardaSaida={aoRegistrarGuardaSaida}
          aoAtualizarMeta={setMetaCorte}
          aoMudarStatusSalvamento={setStatusSalvamentoEditor}
          acoesExternasRef={acoesEditarRef}
        />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'exportacao') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <Exportacao
          projetoId={rotaExibida.projeto}
          projetoPath={projeto?.path ?? null}
          sub={rotaExibida.sub}
        />
      </Shell>
    )
  }

  if (rotaExibida.tela === 'relatos') {
    return (
      <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
        <Relatos tipoInicial={rotaExibida.tipo} />
      </Shell>
    )
  }

  const placeholder = <PlaceholderTela rota={rotaExibida} />
  const placeholderConfig = <PlaceholderTela rota={rotaExibida} nivelTitulo="h2" />

  const conteudo =
    rotaExibida.tela === 'config' ? (
      rotaExibida.secao === 'provedores' ? (
        <ConfigProvedores projetoAberto={projetoAberto} />
      ) : rotaExibida.secao === 'custos' ? (
        <ConfigCustos projetoAberto={projetoAberto} />
      ) : rotaExibida.secao === 'componentes' ? (
        <ConfigComponentes projetoAberto={projetoAberto} />
      ) : rotaExibida.secao === 'exportacao' ? (
        <ConfigExportacao projetoAberto={projetoAberto} />
      ) : rotaExibida.secao === 'aparencia' ? (
        <ConfigAparencia projetoAberto={projetoAberto} />
      ) : rotaExibida.secao === 'projeto' ? (
        <ConfigProjeto projetoAberto={projetoAberto} projeto={projeto} />
      ) : (
        <ConfiguracoesLayout
          secao={rotaExibida.secao}
          projetoAberto={projetoAberto}
          titulo={TITULOS_CONFIG[rotaExibida.secao]}
        >
          <ComEstado
            estado={forcado ?? 'pronto'}
            carregando={<Esqueleto variante="painel" />}
            vazio={placeholderConfig}
          >
            {placeholderConfig}
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
    <Shell rota={rotaExibida} projeto={projeto} somenteLocal={somenteLocal}>
      {conteudo}
    </Shell>
  )
}

function AppInterno() {
  const { projeto, somenteLocal, carregando } = useProjetoAtual()
  const [preferencias] = usePreferencias()
  const projetoId = projeto ? (projeto.id ?? projeto.name) : null

  useEffect(() => {
    definirProjetoDaFila(projetoId)
    return () => {
      definirProjetoDaFila(null)
    }
  }, [projetoId])

  useEffect(() => {
    aplicarPreferencias(preferencias)
    if (preferencias.tema !== 'sistema' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const aoMudar = () => aplicarPreferencias(preferencias)
    media.addEventListener?.('change', aoMudar)
    return () => media.removeEventListener?.('change', aoMudar)
  }, [preferencias])

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
