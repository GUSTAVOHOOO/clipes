import { DicaAtalho, Status, Tela, useToast, type Etapa } from '@ds'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useAtalhos, usePaleta, type Atalho } from '~/comandos/atalhos'
import { chamar } from '~/core/cliente'
import { useFila, type Fila } from '~/core/progresso'
import { resolver, type Rota } from '~/rotas/rotas'

export type ProjetoAtual = {
  id?: string | null
  name: string
  path?: string
  warning?: string | null
}

type RespostaSomenteLocal = {
  open?: boolean
  enabled: boolean
}

export type EstadoProjetoAtual = {
  projeto: ProjetoAtual | null
  somenteLocal: boolean
  carregando: boolean
  recarregar: () => void
}

const ouvintesProjeto = new Set<(prox?: ProjetoAtual | null) => void>()

/** Notifica instâncias de `useProjetoAtual` para atualizar/recarregar `projects.current` após criação/abertura/fechamento. */
export function notificarMudancaProjeto(prox?: ProjetoAtual | null): void {
  const aplicar = () => {
    for (const fn of ouvintesProjeto) {
      fn(prox)
    }
  }
  if (prox !== undefined) {
    flushSync(aplicar)
  } else {
    aplicar()
  }
}

/** Consulta `projects.current` e `projects.local_only.get` no núcleo para alimentar o Shell e as guardas de rota. */
export function useProjetoAtual(ativo = true): EstadoProjetoAtual {
  const [projeto, setProjeto] = useState<ProjetoAtual | null>(null)
  const [somenteLocal, setSomenteLocal] = useState(false)
  const [carregando, setCarregando] = useState(ativo)
  const [versao, setVersao] = useState(0)

  const recarregar = useCallback(() => {
    setVersao((v) => v + 1)
  }, [])

  useEffect(() => {
    if (!ativo) return
    const aoNotificar = (prox?: ProjetoAtual | null) => {
      if (prox !== undefined) {
        setProjeto(prox)
        if (prox === null) setSomenteLocal(false)
      }
      setVersao((v) => v + 1)
    }
    ouvintesProjeto.add(aoNotificar)
    return () => {
      ouvintesProjeto.delete(aoNotificar)
    }
  }, [ativo])

  useEffect(() => {
    if (!ativo) {
      setCarregando(false)
      return
    }
    let cancelado = false
    if (versao === 0) {
      setCarregando(true)
    }

    Promise.allSettled([
      chamar<ProjetoAtual | null>('projects.current', {}),
      chamar<RespostaSomenteLocal>('projects.local_only.get', {}),
    ]).then(([resProjeto, resLocal]) => {
      if (cancelado) return
      const proxProjeto = resProjeto.status === 'fulfilled' ? (resProjeto.value ?? null) : null
      const proxLocal = resLocal.status === 'fulfilled' ? Boolean(resLocal.value?.enabled) : false
      setProjeto(proxProjeto)
      setSomenteLocal(proxLocal)
      setCarregando(false)
    })

    return () => {
      cancelado = true
    }
  }, [ativo, versao])

  return { projeto, somenteLocal, carregando, recarregar }
}

function assinarHash(aoMudar: () => void): () => void {
  window.addEventListener('hashchange', aoMudar)
  return () => window.removeEventListener('hashchange', aoMudar)
}

function lerHash(): string {
  return window.location.hash
}

function etapaDaRota(rota: Rota): Etapa | undefined {
  switch (rota.tela) {
    case 'fontes':
    case 'fonte':
      return 'fontes'
    case 'cortes':
    case 'revisao':
    case 'corte':
      return 'cortes'
    case 'exportacao':
      return 'exportacao'
    default:
      return undefined
  }
}

function tituloDaRota(rota: Rota): string {
  switch (rota.tela) {
    case 'inicio':
      return 'Clipes — Início'
    case 'assistente':
      return 'Clipes — Assistente de primeiro uso'
    case 'fontes':
    case 'fonte':
      return 'Clipes — Fontes e Transcrição'
    case 'cortes':
    case 'revisao':
    case 'corte':
      return 'Clipes — Cortes'
    case 'exportacao':
      return 'Clipes — Exportação'
    case 'config':
      return 'Clipes — Configurações'
    case 'relatos':
      return 'Clipes — Relatos e diagnóstico'
    case 'sobre':
      return 'Clipes — Sobre'
  }
}

export type ShellProps = {
  children: ReactNode
  rota?: Rota
  projeto?: ProjetoAtual | null
  somenteLocal?: boolean
  carregando?: boolean
  fila?: Fila
  meio?: ReactNode
  direita?: ReactNode
  titulo?: string
  aoAbrirFila?: () => void
}

/** Moldura global do front v2: liga `<Tela>` do `@ds` ao Projeto ativo, etapas, Fila, Somente local e Paleta. */
export function Shell({
  children,
  rota: rotaProp,
  projeto: projetoProp,
  somenteLocal: somenteLocalProp,
  carregando: carregandoProp,
  fila: filaStore,
  meio,
  direita,
  titulo,
  aoAbrirFila,
}: ShellProps) {
  const gerenciaProjeto = projetoProp === undefined
  const estadoProjeto = useProjetoAtual(gerenciaProjeto)

  const projeto = gerenciaProjeto ? estadoProjeto.projeto : projetoProp
  const somenteLocal = somenteLocalProp ?? (gerenciaProjeto ? estadoProjeto.somenteLocal : false)
  const carregando = carregandoProp ?? (gerenciaProjeto ? estadoProjeto.carregando : false)

  const hash = useSyncExternalStore(assinarHash, lerHash, () => '#/inicio')
  const projetoAberto = projeto ? (projeto.id ?? projeto.name) : null

  const resolucao = useMemo(
    () => resolver(hash, { projetoAberto }),
    [hash, projetoAberto],
  )

  const destinoRedirecionar =
    !rotaProp && !carregando && 'redirecionar' in resolucao ? resolucao.redirecionar : null

  useEffect(() => {
    if (!destinoRedirecionar) return
    window.location.replace(destinoRedirecionar)
  }, [destinoRedirecionar])

  const rotaAtiva: Rota = useMemo(() => {
    if (rotaProp) return rotaProp
    if ('rota' in resolucao) return resolucao.rota
    const apos = resolver(resolucao.redirecionar, { projetoAberto })
    return 'rota' in apos ? apos.rota : { tela: 'inicio' }
  }, [rotaProp, resolucao, projetoAberto])

  const jobs = useFila(filaStore)
  const jobsAtivos = jobs.filter((j) => j.estado === 'rodando')
  const primeiroAtivo = jobsAtivos[0]
  const resumoFila = primeiroAtivo
    ? `${primeiroAtivo.mensagem || primeiroAtivo.etapa} · ${Math.round(primeiroAtivo.percentual)}%`
    : undefined

  const { abrir: abrirPaleta } = usePaleta()
  const toast = useToast()

  const abrirFilaPadrao = useCallback(() => {
    if (aoAbrirFila) {
      aoAbrirFila()
      return
    }
    toast.add({
      title: 'Fila de jobs',
      description:
        jobsAtivos.length > 0
          ? `${jobsAtivos.length} tarefa(s) em andamento.`
          : 'Nenhuma tarefa em andamento no momento.',
    })
  }, [aoAbrirFila, jobsAtivos.length, toast])

  const atalhosShell = useMemo<Atalho[]>(() => {
    const lista: Atalho[] = [
      {
        id: 'navegar.inicio',
        titulo: 'Ir para Início e Projetos',
        grupo: 'Navegação',
        executar: () => {
          window.location.hash = '#/inicio'
        },
      },
      {
        id: 'navegar.config',
        titulo: 'Abrir Configurações',
        grupo: 'Configurações',
        tecla: 'Mod+,',
        executar: () => {
          window.location.hash = '#/config/provedores'
        },
      },
      {
        id: 'navegar.relatos',
        titulo: 'Ir para Relatos e diagnóstico',
        grupo: 'App',
        executar: () => {
          window.location.hash = '#/relatos'
        },
      },
      {
        id: 'navegar.sobre',
        titulo: 'Ir para Sobre e atualizações',
        grupo: 'App',
        executar: () => {
          window.location.hash = '#/sobre'
        },
      },
    ]

    if (projetoAberto) {
      const enc = encodeURIComponent(projetoAberto)
      lista.push(
        {
          id: 'navegar.fontes',
          titulo: 'Ir para Fontes e Transcrição',
          grupo: 'Projeto',
          executar: () => {
            window.location.hash = `#/projeto/${enc}/fontes`
          },
        },
        {
          id: 'navegar.cortes',
          titulo: 'Ir para Cortes',
          grupo: 'Projeto',
          executar: () => {
            window.location.hash = `#/projeto/${enc}/cortes`
          },
        },
        {
          id: 'navegar.exportacao',
          titulo: 'Ir para Exportação',
          grupo: 'Projeto',
          executar: () => {
            window.location.hash = `#/projeto/${enc}/exportacao`
          },
        },
      )
    }

    return lista
  }, [projetoAberto])

  useAtalhos(atalhosShell)

  const modoMinimo = rotaAtiva.tela === 'assistente'
  const etapa = etapaDaRota(rotaAtiva)

  const aoIrEtapa = useCallback(
    (proximaEtapa: Etapa) => {
      if (!projetoAberto) return
      window.location.hash = `#/projeto/${encodeURIComponent(projetoAberto)}/${proximaEtapa}`
    },
    [projetoAberto],
  )

  return (
    <Tela
      titulo={titulo ?? tituloDaRota(rotaAtiva)}
      meio={meio}
      direita={direita}
      modoMinimo={modoMinimo}
      mostrarEtapas={Boolean(projeto)}
      projeto={projeto ? { nome: projeto.name } : null}
      etapa={etapa}
      aoIrEtapa={aoIrEtapa}
      fila={{ ativos: jobsAtivos.length, resumo: resumoFila }}
      aoAbrirFila={abrirFilaPadrao}
      aoAbrirPaleta={abrirPaleta}
      somenteLocal={somenteLocal}
      status={
        modoMinimo
          ? undefined
          : {
              esquerda: primeiroAtivo ? (
                <Status tom="rodando">
                  <span className="truncate">{primeiroAtivo.mensagem || primeiroAtivo.etapa}</span>
                  <span className="num text-t3">{Math.round(primeiroAtivo.percentual)}%</span>
                </Status>
              ) : (
                <span>Sem jobs ativos</span>
              ),
              direita: (
                <>
                  <DicaAtalho tecla="Ctrl K">Comandos</DicaAtalho>
                  <DicaAtalho tecla="Ctrl ,">Configurações</DicaAtalho>
                </>
              ),
            }
      }
    >
      <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4">{children}</main>
    </Tela>
  )
}
