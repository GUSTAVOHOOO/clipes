import {
  BotaoIcone,
  cn,
  ConfirmDialog,
  DicaAtalho,
  Menu,
  MenuItem,
  MenuSeparador,
  Status,
  Tela,
  useToast,
  type Etapa,
} from '@ds'
import { AlertCircle, Info, Keyboard, MessageSquareWarning, MoreHorizontal, Settings } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { useAtalhos, usePaleta, type Atalho } from '~/comandos/atalhos'
import { chamar, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, useSalvamentoEditor, type Fila } from '~/core/progresso'
import { resolver, type Rota } from '~/rotas/rotas'
import { FechamentoJanela } from '~/shell/FechamentoJanela'
import { FolhaAtalhos } from '~/shell/FolhaAtalhos'

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

type ProjetoRecente = {
  available: boolean
  name: string
  path: string
}

const SELETOR_FOCAVEL =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function focarRegiao(alvo: HTMLElement): void {
  const candidatos = alvo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)
  for (const el of candidatos) {
    if (el.closest('[hidden], [aria-hidden="true"]')) continue
    const estilo = window.getComputedStyle(el)
    if (estilo.display === 'none' || estilo.visibility === 'hidden') continue
    el.focus()
    return
  }
  alvo.focus()
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
  semPaddingConteudo?: boolean
  statusSalvamento?: ReactNode
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
  semPaddingConteudo = false,
  statusSalvamento,
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
  const salvamento = useSalvamentoEditor(filaStore)
  const jobsAtivos = jobs.filter((j) => j.estado === 'rodando')
  const primeiroAtivo = jobsAtivos[0]
  const resumoFila = primeiroAtivo
    ? `${primeiroAtivo.mensagem || primeiroAtivo.etapa} · ${Math.round(primeiroAtivo.percentual)}%`
    : undefined

  const { aberta: paletaAberta, abrir: abrirPaleta } = usePaleta()
  const toast = useToast()
  const mainRef = useRef<HTMLElement>(null)
  const [ajudaAtalhosAberta, setAjudaAtalhosAberta] = useState(false)
  const [recentesDisponiveis, setRecentesDisponiveis] = useState<ProjetoRecente[]>([])
  const [dialogoErroSalvarAberto, setDialogoErroSalvarAberto] = useState(false)
  const [salvandoAgora, setSalvandoAgora] = useState(false)
  const [erroFlushLocal, setErroFlushLocal] = useState<ErroCore | null>(null)
  const estadoSalvamentoAnteriorRef = useRef(salvamento.estado)

  useEffect(() => {
    const anterior = estadoSalvamentoAnteriorRef.current
    estadoSalvamentoAnteriorRef.current = salvamento.estado
    if (salvamento.estado === 'erro' && anterior !== 'erro') {
      setErroFlushLocal(salvamento.erro ?? null)
      setDialogoErroSalvarAberto(true)
    } else if (salvamento.estado !== 'erro') {
      setErroFlushLocal(null)
      setDialogoErroSalvarAberto(false)
    }
  }, [salvamento.estado, salvamento.erro])

  const tentarSalvarNovamente = useCallback(async () => {
    setSalvandoAgora(true)
    try {
      await chamar('editor.flush', {})
      setErroFlushLocal(null)
      setDialogoErroSalvarAberto(false)
      salvamento.limparErro()
    } catch (erro) {
      setErroFlushLocal(erro instanceof ErroCore ? erro : new ErroCore('project_write', String(erro ?? '')))
    } finally {
      setSalvandoAgora(false)
    }
  }, [salvamento])

  const modoMinimo = rotaAtiva.tela === 'assistente'
  const etapa = etapaDaRota(rotaAtiva)

  const chaveProjeto = projeto ? `${projeto.id ?? ''}|${projeto.name}|${projeto.path ?? ''}` : null

  useEffect(() => {
    if (!chaveProjeto || modoMinimo || !projeto) {
      setRecentesDisponiveis([])
      return
    }
    let cancelado = false
    chamar<ProjetoRecente[]>('projects.recent', {})
      .then((lista) => {
        if (cancelado || !Array.isArray(lista)) return
        const filtrados = lista.filter(
          (item) =>
            item.available &&
            item.path !== projeto.path &&
            item.name !== projeto.name,
        )
        setRecentesDisponiveis(filtrados)
      })
      .catch(() => {
        if (!cancelado) setRecentesDisponiveis([])
      })
    return () => {
      cancelado = true
    }
  }, [chaveProjeto, modoMinimo, projeto])

  const outrosProjetos = useMemo(
    () => [...new Set(recentesDisponiveis.map((item) => item.name))],
    [recentesDisponiveis],
  )

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

  const notificarErroProjeto = useCallback(
    (erro: unknown) => {
      const coreErr = paraErroCore(erro)
      const traducao = mensagemDeErro(coreErr)
      toast.add({
        type: 'erro',
        title: traducao.titulo,
        actionProps:
          traducao.recuperacao?.acao === 'abrir-fila'
            ? { children: traducao.recuperacao.rotulo, onClick: abrirFilaPadrao }
            : undefined,
      })
    },
    [abrirFilaPadrao, toast],
  )

  const aoTrocarProjeto = useCallback(() => {
    window.location.hash = '#/inicio'
  }, [])

  const aoConfigurarProjeto = useCallback(() => {
    window.location.hash = '#/config/projeto'
  }, [])

  const aoFecharProjeto = useCallback(async () => {
    try {
      await chamar('projects.close', {})
      notificarMudancaProjeto(null)
      window.location.hash = '#/inicio'
    } catch (erro) {
      notificarErroProjeto(erro)
    }
  }, [notificarErroProjeto])

  const aoSelecionarProjeto = useCallback(
    async (nomeOutro: string) => {
      const alvo = recentesDisponiveis.find((item) => item.name === nomeOutro)
      if (!alvo) {
        window.location.hash = '#/inicio'
        return
      }
      try {
        const aberto = await chamar<ProjetoAtual>('projects.open', { path: alvo.path })
        notificarMudancaProjeto(aberto)
        const id = aberto.id ?? aberto.name
        window.location.hash = `#/projeto/${encodeURIComponent(id)}/fontes`
      } catch (erro) {
        notificarErroProjeto(erro)
      }
    },
    [notificarErroProjeto, recentesDisponiveis],
  )

  const aoAbrirSomenteLocal = useCallback(() => {
    window.location.hash = projeto ? '#/config/projeto' : '#/config/provedores'
  }, [projeto])

  const ciclarRegiao = useCallback((direcao: 1 | -1) => {
    const raiz = mainRef.current?.closest('[data-tela]') ?? document
    const topo = raiz.querySelector<HTMLElement>('[data-regiao="topo"]')
    const conteudo = mainRef.current ?? raiz.querySelector<HTMLElement>('[data-regiao="conteudo"]')
    const rodape = raiz.querySelector<HTMLElement>('[data-regiao="rodape"]')
    const regioes = [topo, conteudo, rodape].filter((el): el is HTMLElement => el !== null)
    if (regioes.length === 0) return

    const ativo = document.activeElement
    const idxAtual = regioes.findIndex(
      (r) => r === ativo || (ativo instanceof Node && r.contains(ativo)),
    )
    const proximoIdx =
      idxAtual < 0
        ? direcao > 0
          ? 0
          : regioes.length - 1
        : (idxAtual + direcao + regioes.length) % regioes.length
    focarRegiao(regioes[proximoIdx])
  }, [])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented || paletaAberta) return
      const temDialogoModal = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"]'))
      if (temDialogoModal) return

      if (e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        ciclarRegiao(e.shiftKey ? -1 : 1)
        return
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '/') {
        e.preventDefault()
        setAjudaAtalhosAberta((v) => !v)
      }
    }
    window.addEventListener('keydown', aoTeclar, { capture: true })
    return () => window.removeEventListener('keydown', aoTeclar, { capture: true })
  }, [ciclarRegiao, paletaAberta])

  const atalhosShell = useMemo<Atalho[]>(() => {
    const lista: Atalho[] = [
      {
        id: 'shell.regioes',
        titulo: 'Ciclar entre regiões macro da janela',
        grupo: 'Navegação',
        tecla: 'F6',
        teclaUnica: false,
        executar: () => ciclarRegiao(1),
      },
      {
        id: 'fila.alternar',
        titulo: 'Abrir/fechar Fila de Jobs',
        grupo: 'Navegação',
        tecla: 'Mod+J',
        executar: abrirFilaPadrao,
      },
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
      {
        id: 'atalhos.ajuda',
        titulo: 'Folha de ajuda rápida de atalhos',
        grupo: 'App',
        tecla: '?',
        teclaUnica: true,
        executar: () => setAjudaAtalhosAberta((v) => !v),
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
  }, [abrirFilaPadrao, ciclarRegiao, projetoAberto])

  useAtalhos(atalhosShell)

  const aoIrEtapa = useCallback(
    (proximaEtapa: Etapa) => {
      if (!projetoAberto) return
      window.location.hash = `#/projeto/${encodeURIComponent(projetoAberto)}/${proximaEtapa}`
    },
    [projetoAberto],
  )

  const ehMac =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
  const atalhoConfig = ehMac ? '⌘,' : 'Ctrl+,'

  const erroSalvamentoAtivo = erroFlushLocal ?? salvamento.erro ?? new ErroCore('project_write', '')
  const msgErroSalvamento = mensagemDeErro(erroSalvamentoAtivo)

  const indicadorSalvamento =
    salvamento.estado === 'erro' ? (
      <span role="alert" className="flex items-center gap-1.5 text-erro">
        <AlertCircle className="size-[13px] shrink-0 stroke-[1.75]" aria-hidden />
        <span>Falha ao salvar</span>
        <button
          type="button"
          onClick={() => setDialogoErroSalvarAberto(true)}
          className="foco cursor-pointer rounded-controle border-0 bg-transparent px-1 py-0.5 text-pequeno text-erro underline hover:bg-hover"
        >
          Tentar novamente
        </button>
      </span>
    ) : (
      (statusSalvamento ?? (salvamento.estado === 'salvo' ? <Status tom="sucesso">Salvo</Status> : null))
    )

  return (
    <Tela
      titulo={titulo ?? tituloDaRota(rotaAtiva)}
      meio={meio}
      direita={direita}
      aposPaleta={
        <>
          <BotaoIcone
            rotulo="Configurações"
            atalho={atalhoConfig}
            onClick={() => {
              window.location.hash = '#/config/provedores'
            }}
          >
            <Settings />
          </BotaoIcone>
          <Menu
            alinhar="end"
            gatilho={
              <BotaoIcone semDica rotulo="Mais ações" title="Mais ações">
                <MoreHorizontal />
              </BotaoIcone>
            }
          >
            <MenuItem
              icone={<MessageSquareWarning />}
              aoSelecionar={() => {
                window.location.hash = '#/relatos'
              }}
            >
              Relatos e diagnóstico
            </MenuItem>
            <MenuItem
              icone={<Info />}
              aoSelecionar={() => {
                window.location.hash = '#/sobre'
              }}
            >
              Sobre e atualizações
            </MenuItem>
            <MenuSeparador />
            <MenuItem
              icone={<Keyboard />}
              atalho="?"
              aoSelecionar={() => setAjudaAtalhosAberta(true)}
            >
              Ajuda de atalhos
            </MenuItem>
          </Menu>
        </>
      }
      modoMinimo={modoMinimo}
      mostrarEtapas={Boolean(projeto)}
      projeto={projeto ? { nome: projeto.name, outros: outrosProjetos } : null}
      aoSelecionarProjeto={aoSelecionarProjeto}
      aoTrocarProjeto={aoTrocarProjeto}
      aoConfigurarProjeto={aoConfigurarProjeto}
      aoFecharProjeto={aoFecharProjeto}
      etapa={etapa}
      aoIrEtapa={aoIrEtapa}
      fila={{ ativos: jobsAtivos.length, resumo: resumoFila }}
      aoAbrirFila={abrirFilaPadrao}
      aoAbrirPaleta={abrirPaleta}
      somenteLocal={somenteLocal}
      aoAbrirSomenteLocal={aoAbrirSomenteLocal}
      status={
        modoMinimo
          ? undefined
          : {
              esquerda: (
                <>
                  {indicadorSalvamento}
                  {primeiroAtivo ? (
                    <Status tom="rodando">
                      <span className="truncate">{primeiroAtivo.mensagem || primeiroAtivo.etapa}</span>
                      <span className="num text-t3">{Math.round(primeiroAtivo.percentual)}%</span>
                    </Status>
                  ) : (
                    <span>Sem jobs ativos</span>
                  )}
                </>
              ),
              direita: (
                <>
                  <DicaAtalho tecla="F6">Região</DicaAtalho>
                  <DicaAtalho tecla="?">Atalhos</DicaAtalho>
                  <DicaAtalho tecla="Ctrl K">Comandos</DicaAtalho>
                  <DicaAtalho tecla="Ctrl ,">Configurações</DicaAtalho>
                </>
              ),
            }
      }
    >
      <main
        ref={mainRef}
        data-regiao="conteudo"
        tabIndex={-1}
        className={cn(
          'foco-interno flex min-h-0 flex-1 flex-col',
          semPaddingConteudo ? 'overflow-hidden' : 'overflow-auto p-4',
        )}
      >
        {children}
      </main>
      <FechamentoJanela jobs={jobs} />
      <ConfirmDialog
        aberto={salvamento.estado === 'erro' && dialogoErroSalvarAberto}
        aoMudarAberto={(proximo) => {
          if (!salvandoAgora) setDialogoErroSalvarAberto(proximo)
        }}
        titulo="Falha ao salvar alterações do Editor"
        descricao={msgErroSalvamento.titulo}
        rotuloConfirmar="Tentar salvar novamente"
        rotuloCancelar="Continuar editando"
        variante="primario"
        focoInicial="confirmar"
        ocupado={salvandoAgora}
        aoConfirmar={tentarSalvarNovamente}
      />
      <FolhaAtalhos aberto={ajudaAtalhosAberta} aoMudarAberto={setAjudaAtalhosAberta} />
    </Tela>
  )
}
