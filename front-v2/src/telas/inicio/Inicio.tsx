import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  BannerErroCore,
  Botao,
  Busca,
  Dialogo,
  Esqueleto,
  EstadoTela,
  Status,
  useToast,
} from '@ds'
import { AlertTriangle, FolderOpen, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro, type Recuperacao } from '~/core/erros'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { notificarMudancaProjeto, type ProjetoAtual } from '~/shell/Shell'
import { DialogoNovoProjeto } from '~/telas/inicio/DialogoNovoProjeto'

export type ProjetoRecente = {
  available: boolean
  name: string
  path: string
}

type RespostaAssistente = {
  needsSetup?: boolean
}

type ErroTraduzido = {
  titulo: string
  explicacao?: string
  recuperacao?: Recuperacao
}

function atalhoMod(tecla: string): string {
  const ehMac =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
  return ehMac ? `⌘${tecla}` : `Ctrl+${tecla}`
}

function normalizarErro(erro: unknown): ErroCore {
  if (erro instanceof ErroCore) return erro
  if (erro && typeof erro === 'object' && 'code' in erro) {
    const e = erro as { code?: unknown; message?: unknown }
    return new ErroCore(
      typeof e.code === 'string' ? e.code : 'desconhecido',
      typeof e.message === 'string' ? e.message : '',
    )
  }
  return new ErroCore('desconhecido', erro instanceof Error ? erro.message : String(erro ?? ''))
}

function traduzirErroInicio(erro: ErroCore): ErroTraduzido {
  switch (erro.code) {
    case 'invalid_project':
      return {
        titulo: 'Escolha um nome válido (sem barras ou dois-pontos) e uma pasta .clipes válida.',
      }
    case 'project_create':
    case 'project_open':
    case 'migration':
    case 'backup':
      return {
        titulo:
          'Não foi possível abrir ou criar a pasta do Projeto. Verifique permissões e espaço em disco.',
        recuperacao: { rotulo: 'Tentar novamente', acao: 'recarregar' },
      }
    case 'library':
      return {
        titulo:
          'Não foi possível ler a lista de Projetos recentes, mas você ainda pode abrir qualquer pasta .clipes diretamente.',
      }
    default:
      return mensagemDeErro(erro)
  }
}

function destinoDoProjeto(projeto: ProjetoAtual): string {
  const id = projeto.id || projeto.name
  return `#/projeto/${encodeURIComponent(id)}/fontes`
}

/** Tela Início e Projetos (`#/inicio`): criação, abertura (inclusive V1) e retomada de Projetos `.clipes`. */
export function Inicio() {
  const forcado = useEstadoForcado()
  const toast = useToast()

  const [carregando, setCarregando] = useState(true)
  const [recentes, setRecentes] = useState<ProjetoRecente[]>([])
  const [projetoAtual, setProjetoAtual] = useState<ProjetoAtual | null>(null)
  const [erroBanner, setErroBanner] = useState<ErroCore | null>(null)
  const [filtro, setFiltro] = useState('')

  const [dialogoNovoAberto, setDialogoNovoAberto] = useState(false)
  const [dialogoAbrirAberto, setDialogoAbrirAberto] = useState(false)
  const [alvoLocalizar, setAlvoLocalizar] = useState<ProjetoRecente | null>(null)
  const [caminhoAbrir, setCaminhoAbrir] = useState('')
  const [erroAbrir, setErroAbrir] = useState<string | undefined>()
  const [abrindoCaminho, setAbrindoCaminho] = useState<string | null>(null)
  const [fechando, setFechando] = useState(false)

  const inputAbrirRef = useRef<HTMLInputElement>(null)
  const versaoCargaRef = useRef(0)

  const carregar = useCallback(async () => {
    const seq = ++versaoCargaRef.current
    setCarregando(true)
    setErroBanner(null)

    const [resRecentes, resAtual, resAssistente] = await Promise.allSettled([
      chamar<ProjetoRecente[]>('projects.recent', {}),
      chamar<ProjetoAtual | null>('projects.current', {}),
      chamar<RespostaAssistente>('assistant.status', {}),
    ])

    if (seq !== versaoCargaRef.current) return

    if (
      resAssistente.status === 'fulfilled' &&
      resAssistente.value?.needsSetup === true &&
      !forcado
    ) {
      window.location.replace('#/assistente?passo=1')
      return
    }

    if (resAtual.status === 'fulfilled') {
      setProjetoAtual(resAtual.value ?? null)
    }

    if (resRecentes.status === 'fulfilled') {
      setRecentes(Array.isArray(resRecentes.value) ? resRecentes.value : [])
    } else {
      setRecentes([])
      setErroBanner(normalizarErro(resRecentes.reason))
    }

    setCarregando(false)
  }, [forcado])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    if (!dialogoAbrirAberto) {
      setErroAbrir(undefined)
      return
    }
    queueMicrotask(() => {
      inputAbrirRef.current?.focus()
    })
  }, [dialogoAbrirAberto])

  const abrirProjeto = useCallback(
    async (caminho: string, fecharDialogoAbrir = false) => {
      const limpo = caminho.trim()
      if (!limpo || !limpo.toLowerCase().endsWith('.clipes')) {
        if (fecharDialogoAbrir) {
          setErroAbrir('Escolha uma pasta .clipes válida.')
          inputAbrirRef.current?.focus()
          return
        }
        setErroBanner(new ErroCore('invalid_project', limpo))
        return
      }

      setAbrindoCaminho(limpo)
      setErroBanner(null)
      try {
        const aberto = await chamar<ProjetoAtual>('projects.open', { path: limpo })
        notificarMudancaProjeto(aberto)
        setProjetoAtual(aberto)
        if (fecharDialogoAbrir) {
          setDialogoAbrirAberto(false)
          setAlvoLocalizar(null)
          setCaminhoAbrir('')
        }
        window.location.hash = destinoDoProjeto(aberto)
      } catch (erro) {
        const coreErr = normalizarErro(erro)
        if (fecharDialogoAbrir && coreErr.code === 'invalid_project') {
          setErroAbrir('Escolha uma pasta .clipes válida.')
          inputAbrirRef.current?.focus()
        } else {
          if (fecharDialogoAbrir) {
            setDialogoAbrirAberto(false)
            setAlvoLocalizar(null)
          }
          setErroBanner(coreErr)
        }
      } finally {
        setAbrindoCaminho(null)
      }
    },
    [],
  )

  const acionarSeletorAbrir = useCallback(
    async (itemLocalizar: ProjetoRecente | null = null) => {
      const e2e = typeof window !== 'undefined' ? window.__CLIPES_E2E__ : undefined
      if (e2e && e2e.dialogQueue.length > 0) {
        e2e.dialogCalls.push({ kind: 'open', options: { directory: true, multiple: false } })
        const proximo = e2e.dialogQueue.shift() ?? null
        if (proximo) await abrirProjeto(proximo)
        return
      }

      if (isTauri()) {
        const selecionado = await invoke<string | string[] | null>('plugin:dialog|open', {
          options: { directory: true, multiple: false },
        })
        const caminho = Array.isArray(selecionado) ? (selecionado[0] ?? null) : selecionado
        if (caminho) await abrirProjeto(caminho)
        return
      }

      setAlvoLocalizar(itemLocalizar)
      setCaminhoAbrir(itemLocalizar ? itemLocalizar.path : '')
      setErroAbrir(undefined)
      setDialogoAbrirAberto(true)
    },
    [abrirProjeto],
  )

  const fecharProjetoAtivo = useCallback(async () => {
    if (fechando) return
    setFechando(true)
    setErroBanner(null)
    try {
      await chamar('projects.close', {})
      setProjetoAtual(null)
      notificarMudancaProjeto(null)
    } catch (erro) {
      setErroBanner(normalizarErro(erro))
    } finally {
      setFechando(false)
    }
  }, [fechando])

  const atalhos = useMemo<Atalho[]>(
    () => [
      {
        id: 'inicio.novo-projeto',
        titulo: 'Novo Projeto',
        grupo: 'Projetos',
        tecla: 'Mod+N',
        executar: () => setDialogoNovoAberto(true),
      },
      {
        id: 'inicio.abrir-pasta',
        titulo: 'Abrir pasta .clipes',
        grupo: 'Projetos',
        tecla: 'Mod+O',
        executar: () => void acionarSeletorAbrir(null),
      },
    ],
    [acionarSeletorAbrir],
  )
  useAtalhos(atalhos)

  const estadoEfetivo: 'carregando' | 'vazio' | 'pronto' = useMemo(() => {
    if (forcado === 'carregando') return 'carregando'
    if (forcado === 'vazio') return 'vazio'
    if (carregando) return 'carregando'
    if (recentes.length === 0) return 'vazio'
    return 'pronto'
  }, [forcado, carregando, recentes.length])

  const erroExibido = useMemo(() => {
    if (erroBanner) return erroBanner
    if (forcado === 'erro') {
      return new ErroCore('project_open', 'Simulação de erro via ?estado=erro.')
    }
    return null
  }, [erroBanner, forcado])

  const erroTraduzido = erroExibido ? traduzirErroInicio(erroExibido) : null

  const recentesFiltrados = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return recentes
    return recentes.filter(
      (item) => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q),
    )
  }, [recentes, filtro])

  function acaoErroBanner() {
    if (!erroTraduzido?.recuperacao) return undefined
    const rec = erroTraduzido.recuperacao
    return {
      rotulo: rec.rotulo,
      aoAcionar: () => {
        if (rec.rota) {
          window.location.hash = rec.rota
          return
        }
        if (rec.acao === 'abrir-fila') {
          toast.add({
            title: 'Fila de Jobs',
            description: 'Use o botão Fila no topo ou Ctrl+J para acompanhar tarefas ativas.',
          })
          return
        }
        if (rec.acao === 'recarregar') {
          void carregar()
        }
      },
    }
  }

  async function submeterDialogoAbrir(e: FormEvent) {
    e.preventDefault()
    await abrirProjeto(caminhoAbrir, true)
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col gap-4 py-2">
      {erroExibido && erroTraduzido && (
        <BannerErroCore
          erro={{
            code: erroExibido.code,
            message: erroExibido.detalhe || erroExibido.message,
          }}
          traduzir={() => ({
            titulo: erroTraduzido.titulo,
            explicacao: erroTraduzido.explicacao,
          })}
          acaoRecuperacao={acaoErroBanner()}
          acaoSecundaria={
            erroExibido.code === 'library'
              ? {
                  rotulo: 'Abrir pasta .clipes',
                  aoAcionar: () => void acionarSeletorAbrir(null),
                }
              : undefined
          }
          permitirRelato
          aoDispensar={erroBanner ? () => setErroBanner(null) : undefined}
        />
      )}

      {projetoAtual && (
        <section
          aria-label="Projeto ativo"
          className="flex flex-wrap items-center justify-between gap-3 rounded-area bg-area px-4 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-pequeno text-t2">Projeto ativo:</span>
              <strong className="font-forte text-t1">{projetoAtual.name}</strong>
              <span className="truncate font-mono text-pequeno text-t3">{projetoAtual.path}</span>
            </div>
            {projetoAtual.warning && (
              <button
                type="button"
                onClick={() => {
                  window.location.hash = '#/config/projeto'
                }}
                className="flex w-fit cursor-pointer items-center gap-1.5 rounded-controle border-0 bg-transparent px-0 text-left text-pequeno text-t2 hover:text-t1"
              >
                <AlertTriangle className="size-[13px] shrink-0 stroke-[1.75]" aria-hidden />
                <span>Falha no backup automático: {projetoAtual.warning}</span>
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Botao
              variante="secundario"
              onClick={() => {
                window.location.hash = destinoDoProjeto(projetoAtual)
              }}
            >
              Continuar no Projeto
            </Botao>
            <Botao
              variante="fantasma"
              carregando={fechando}
              onClick={() => void fecharProjetoAtivo()}
            >
              Fechar Projeto
            </Botao>
          </div>
        </section>
      )}

      <header className="flex flex-col gap-1.5">
        <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">Projetos</h1>
        <p className="max-w-[68ch] text-base text-t2">
          Cada canal pode ter seu Projeto em uma pasta{' '}
          <code className="font-mono text-pequeno text-t1">.clipes</code> portátil, com backups
          próprios.
        </p>
        {estadoEfetivo !== 'vazio' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Botao
              variante="primario"
              icone={<Plus />}
              atalho={atalhoMod('N')}
              onClick={() => setDialogoNovoAberto(true)}
            >
              Novo Projeto
            </Botao>
            <Botao
              variante="secundario"
              icone={<FolderOpen />}
              atalho={atalhoMod('O')}
              disabled={Boolean(abrindoCaminho)}
              onClick={() => void acionarSeletorAbrir(null)}
            >
              Abrir pasta .clipes
            </Botao>
          </div>
        )}
      </header>

      {estadoEfetivo === 'carregando' && (
        <section aria-label="Projetos recentes" className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2 pt-1">
            <h2 className="text-base font-medio text-t1">Projetos recentes</h2>
          </div>
          <div className="rounded-area bg-area p-2">
            <Esqueleto
              variante="lista"
              quantidade={4}
              rotuloAcessivel="Carregando Projetos recentes"
            />
          </div>
        </section>
      )}

      {estadoEfetivo === 'vazio' && (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
          <EstadoTela
            tipo="vazio"
            titulo="Nenhum Projeto recente ainda"
            descricao="Crie seu primeiro Projeto para importar Fontes e gerar Cortes, ou abra uma pasta .clipes existente."
            acaoPrimaria={{
              rotulo: 'Criar primeiro Projeto',
              aoAcionar: () => setDialogoNovoAberto(true),
            }}
            acaoSecundaria={{
              rotulo: 'Abrir pasta .clipes',
              aoAcionar: () => void acionarSeletorAbrir(null),
            }}
          />
        </div>
      )}

      {estadoEfetivo === 'pronto' && (
        <section aria-label="Projetos recentes" className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <h2 className="text-base font-medio text-t1">Projetos recentes</h2>
            <span className="num text-pequeno text-t3">({recentes.length})</span>
            {recentes.length > 8 && (
              <Busca
                rotulo="Filtrar projetos recentes"
                placeholder="Filtrar projetos recentes…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="ml-auto w-64"
              />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-area bg-area p-1">
            {recentesFiltrados.length === 0 ? (
              <p className="px-3 py-6 text-center text-pequeno text-t3">
                Nenhum Projeto recente corresponde ao filtro.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {recentesFiltrados.map((item) => {
                  const carregandoItem = abrindoCaminho === item.path
                  return (
                    <li
                      key={item.path}
                      className="flex items-center justify-between gap-3 rounded-controle px-3 py-2.5 transition-colors duration-(--dur-rapida) hover:bg-hover"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medio text-t1">{item.name}</span>
                          {!item.available && <Status tom="aviso">Indisponível no disco</Status>}
                        </div>
                        <span className="truncate font-mono text-pequeno text-t3">{item.path}</span>
                      </div>
                      {item.available ? (
                        <Botao
                          variante="secundario"
                          tamanho="p"
                          carregando={carregandoItem}
                          disabled={Boolean(abrindoCaminho)}
                          aria-label={`Abrir Projeto ${item.name}`}
                          onClick={() => void abrirProjeto(item.path)}
                        >
                          Abrir
                        </Botao>
                      ) : (
                        <Botao
                          variante="secundario"
                          tamanho="p"
                          carregando={carregandoItem}
                          disabled={Boolean(abrindoCaminho)}
                          aria-label={`Localizar pasta… (${item.name})`}
                          onClick={() => void acionarSeletorAbrir(item)}
                        >
                          Localizar pasta…
                        </Botao>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      <DialogoNovoProjeto aberto={dialogoNovoAberto} aoMudarAberto={setDialogoNovoAberto} />

      <Dialogo
        aberto={dialogoAbrirAberto}
        aoMudarAberto={(v) => {
          if (!abrindoCaminho) {
            setDialogoAbrirAberto(v)
            if (!v) setAlvoLocalizar(null)
          }
        }}
        titulo={alvoLocalizar ? `Localizar pasta de ${alvoLocalizar.name}` : 'Abrir pasta .clipes'}
        descricao="Selecione ou informe o caminho de uma pasta .clipes existente (inclusive Projetos da V1)."
        largura={500}
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={Boolean(abrindoCaminho)}
              onClick={() => {
                setDialogoAbrirAberto(false)
                setAlvoLocalizar(null)
              }}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              type="submit"
              form="form-abrir-projeto"
              carregando={Boolean(abrindoCaminho)}
            >
              Abrir Projeto
            </Botao>
          </>
        }
      >
        <form id="form-abrir-projeto" onSubmit={(e) => void submeterDialogoAbrir(e)}>
          <SeletorCaminho
            rotulo="Pasta .clipes"
            valor={caminhoAbrir}
            aoMudar={(v) => {
              setCaminhoAbrir(v)
              if (erroAbrir) setErroAbrir(undefined)
            }}
            erro={erroAbrir}
            placeholder="C:\Videos\MeuCanal.clipes ou /projetos/MeuCanal.clipes"
            desabilitado={Boolean(abrindoCaminho)}
            inputRef={inputAbrirRef}
          />
        </form>
      </Dialogo>
    </div>
  )
}
