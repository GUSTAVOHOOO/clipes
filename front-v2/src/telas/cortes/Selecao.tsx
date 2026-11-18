import {
  AreaRolagem,
  BannerErroCore,
  Botao,
  Esqueleto,
  EstadoTela,
  Select,
  Status,
  tcLongo,
  type OpcaoSelect,
} from '@ds'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type { Fila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import {
  storeFontesProjeto,
  useFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import { useSelecaoProjeto } from '~/stores/selecaoProjeto'
import { AcompanhamentoSelecao } from '~/telas/cortes/AcompanhamentoSelecao'
import { ConfiguradorSelecao } from '~/telas/cortes/ConfiguradorSelecao'

export type SelecaoProps = {
  projetoId: string
  projetoPath: string | null
  fonteParam?: string
  runParam?: string
  revParam?: number
  storeFontes?: StoreFontesProjeto
  fila?: Fila
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

function nomeArquivo(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function duracaoFonteUs(fonte: FonteProjeto, transcriptDurationUs?: number | null): number {
  if (transcriptDurationUs && transcriptDurationUs > 0) return transcriptDurationUs
  const seg = Number(fonte.metadata?.format?.duration ?? 0)
  return Number.isFinite(seg) && seg > 0 ? Math.round(seg * 1_000_000) : 0
}

function atualizarQueryCortes(
  projetoId: string,
  patch: { fonte?: number; run?: number | null; rev?: number | null },
) {
  const hashAtual = window.location.hash || ''
  const qIdx = hashAtual.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? hashAtual.slice(qIdx + 1) : '')

  if (patch.fonte !== undefined) params.set('fonte', String(patch.fonte))
  if (patch.run === null) params.delete('run')
  else if (patch.run !== undefined) params.set('run', String(patch.run))
  if (patch.rev === null) params.delete('rev')
  else if (patch.rev !== undefined) params.set('rev', String(patch.rev))

  const qs = params.toString()
  const enc = encodeURIComponent(projetoId)
  const novoHash = `#/projeto/${enc}/cortes${qs ? `?${qs}` : ''}`
  if (window.location.hash !== novoHash) {
    window.location.hash = novoHash
  }
}

/**
 * Tela C.1 — Configurador e Acompanhamento de Seleção (`#/projeto/:id/cortes`).
 * Consome `useFontesProjeto` (#302) e `useSelecaoProjeto`, com duas colunas independentes
 * e rolagem interna (`AreaRolagem`) para caber em 1366×768 e 1440×900 sem scroll externo.
 */
export function Selecao({
  projetoId,
  projetoPath,
  fonteParam,
  runParam,
  revParam,
  storeFontes = storeFontesProjeto,
  fila,
}: SelecaoProps) {
  const forcado = useEstadoForcado()
  const encProjeto = encodeURIComponent(projetoId)

  const {
    fontes,
    carregando: carregandoFontes,
    erro: erroFontes,
    transcriptStatusBySource,
    recarregarFontes,
  } = useFontesProjeto(projetoPath, { store: storeFontes, fila })

  const {
    runsPorFonte,
    carregandoRunsPorFonte,
    erroRunsPorFonte,
    execucaoAtiva,
    carregandoExecucao,
    erroExecucao,
    carregarRuns,
    carregarExecucao,
  } = useSelecaoProjeto(projetoPath, fila)

  const [fonteSelecionadaId, setFonteSelecionadaId] = useState<number | null>(null)
  const [runSelecionadoId, setRunSelecionadoId] = useState<number | null>(null)
  const refCampoMaxUs = useRef<HTMLInputElement | null>(null)
  const refBotaoDisparar = useRef<HTMLButtonElement | null>(null)
  const configuradorRef = useRef<HTMLElement | null>(null)
  const acompanhamentoRef = useRef<HTMLElement | null>(null)
  const regiaoFocoRef = useRef<{ prev: number; curr: number }>({ prev: -1, curr: -1 })

  // Registra F6 / Shift+F6 com 4 regiões (Topo -> Configurador -> Acompanhamento -> Rodapé)
  useEffect(() => {
    const obterRegioes = (): HTMLElement[] => {
      if (!configuradorRef.current && !acompanhamentoRef.current) return []
      const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')
      const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')
      return [
        topo,
        configuradorRef.current,
        acompanhamentoRef.current,
        rodape,
      ].filter((el): el is HTMLElement => el !== null)
    }

    const indiceDoElemento = (el: EventTarget | null, regioes: HTMLElement[]): number => {
      if (!(el instanceof Node)) return -1
      return regioes.findIndex((r) => r === el || r.contains(el))
    }

    const aoFocusIn = (e: FocusEvent) => {
      const regioes = obterRegioes()
      const idx = indiceDoElemento(e.target, regioes)
      regiaoFocoRef.current = { prev: regiaoFocoRef.current.curr, curr: idx }
    }

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || e.ctrlKey || e.metaKey || e.altKey) return
      const temDialogoModal = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"]'))
      if (temDialogoModal) return

      const regioes = obterRegioes()
      if (regioes.length === 0) return

      // Se o Shell já tratou este F6 em capture antes de nós, recupera a região anterior ao Shell
      const idxAtual = e.defaultPrevented
        ? regiaoFocoRef.current.prev
        : indiceDoElemento(document.activeElement, regioes)

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      const dir = e.shiftKey ? -1 : 1
      const proximoIdx =
        idxAtual < 0
          ? dir > 0
            ? 0
            : regioes.length - 1
          : (idxAtual + dir + regioes.length) % regioes.length

      focarRegiao(regioes[proximoIdx])
      regiaoFocoRef.current = { prev: proximoIdx, curr: proximoIdx }
    }

    document.addEventListener('focusin', aoFocusIn, true)
    window.addEventListener('keydown', aoTeclar, { capture: true })
    return () => {
      document.removeEventListener('focusin', aoFocusIn, true)
      window.removeEventListener('keydown', aoTeclar, { capture: true })
    }
  }, [])

  const fontesTranscritas = useMemo(() => {
    const prontas = fontes.filter(
      (f) => transcriptStatusBySource[f.id]?.transcript?.state === 'complete',
    )
    return [...prontas].sort((a, b) => b.id - a.id)
  }, [fontes, transcriptStatusBySource])

  const aguardandoStatusTranscricao =
    fontes.length > 0 && Object.keys(transcriptStatusBySource).length === 0

  const carregandoInicial = carregandoFontes || aguardandoStatusTranscricao

  // Resolve Fonte ativa a partir de ?fonte= ou da primeira Fonte transcrita
  useEffect(() => {
    if (fontesTranscritas.length === 0) {
      setFonteSelecionadaId(null)
      return
    }
    const idParam = fonteParam ? Number(fonteParam) : NaN
    if (Number.isFinite(idParam) && fontesTranscritas.some((f) => f.id === idParam)) {
      setFonteSelecionadaId(idParam)
      return
    }
    setFonteSelecionadaId((atual) =>
      atual !== null && fontesTranscritas.some((f) => f.id === atual)
        ? atual
        : fontesTranscritas[0].id,
    )
  }, [fonteParam, fontesTranscritas])

  const fonteAtiva = useMemo(
    () => fontesTranscritas.find((f) => f.id === fonteSelecionadaId) ?? null,
    [fontesTranscritas, fonteSelecionadaId],
  )

  // Carrega execuções da Fonte ativa (inclusive ao alternar ?estado= no hash)
  useEffect(() => {
    if (!fonteAtiva) return
    void carregarRuns(fonteAtiva.id)
  }, [fonteAtiva, forcado, carregarRuns])

  const runsCarregadosParaFonte = fonteAtiva ? Object.hasOwn(runsPorFonte, fonteAtiva.id) : false
  const runsDaFonte = useMemo(
    () => (fonteAtiva ? runsPorFonte[fonteAtiva.id] ?? [] : []),
    [fonteAtiva, runsPorFonte],
  )
  const erroRuns = fonteAtiva ? erroRunsPorFonte[fonteAtiva.id] ?? null : null
  const carregandoRuns = fonteAtiva
    ? Boolean(carregandoRunsPorFonte[fonteAtiva.id]) || (!runsCarregadosParaFonte && !erroRuns)
    : false

  // Resolve Run ativo a partir de ?run= ou do mais recente da Fonte
  useEffect(() => {
    if (runsDaFonte.length === 0) {
      setRunSelecionadoId(null)
      return
    }
    const idParam = runParam ? Number(runParam) : NaN
    if (Number.isFinite(idParam) && runsDaFonte.some((r) => r.id === idParam)) {
      setRunSelecionadoId(idParam)
      return
    }
    setRunSelecionadoId((atual) =>
      atual !== null && runsDaFonte.some((r) => r.id === atual) ? atual : runsDaFonte[0].id,
    )
  }, [runParam, runsDaFonte])

  // Carrega detalhes da execução e revisão ativa
  useEffect(() => {
    if (runSelecionadoId === null) return
    void carregarExecucao(runSelecionadoId, revParam)
  }, [runSelecionadoId, revParam, forcado, carregarExecucao])

  const opcoesFonte = useMemo<OpcaoSelect<string>[]>(
    () =>
      fontesTranscritas.map((f) => {
        const durUs = duracaoFonteUs(f, transcriptStatusBySource[f.id]?.transcript?.duration_us)
        return {
          valor: String(f.id),
          rotulo: `${nomeArquivo(f.path)}${durUs > 0 ? ` · ${tcLongo(durUs)}` : ''}`,
          descricao: f.status === 'available' ? 'Disponível no disco' : 'Fonte offline/alterada',
        }
      }),
    [fontesTranscritas, transcriptStatusBySource],
  )

  const aoRecarregarExecucaoERuns = useCallback(async () => {
    if (!fonteAtiva) return
    await carregarRuns(fonteAtiva.id, { silencioso: true })
    if (runSelecionadoId !== null) {
      await carregarExecucao(runSelecionadoId, revParam, { silencioso: true })
    }
  }, [fonteAtiva, runSelecionadoId, revParam, carregarRuns, carregarExecucao])

  const atalhos = useMemo<Atalho[]>(() => {
    const lista: Atalho[] = [
      {
        id: 'cortes.irFontes',
        titulo: 'Ir para Fontes e Transcrição',
        grupo: 'Cortes',
        executar: () => {
          window.location.hash = `#/projeto/${encProjeto}/fontes`
        },
      },
    ]
    if (fonteAtiva) {
      lista.push({
        id: 'cortes.verTranscricao',
        titulo: 'Ver Transcrição da Fonte atual',
        grupo: 'Cortes',
        executar: () => {
          window.location.hash = `#/projeto/${encProjeto}/fontes/${fonteAtiva.id}`
        },
      })
    }
    return lista
  }, [encProjeto, fonteAtiva])

  useAtalhos(atalhos)

  const estadoTela = useMemo<'carregando' | 'erro' | 'vazio' | 'pronto'>(() => {
    if (forcado === 'carregando') return 'carregando'
    if (forcado === 'vazio') return 'vazio'
    if (forcado === 'erro') return 'erro'
    if (carregandoInicial) return 'carregando'
    if (erroFontes) return 'erro'
    if (fontesTranscritas.length === 0) return 'vazio'
    return 'pronto'
  }, [forcado, carregandoInicial, erroFontes, fontesTranscritas.length])

  const erroFatalExibido = useMemo(() => {
    if (erroFontes) return erroFontes
    if (forcado === 'erro') {
      return new ErroCore(
        'local_only_violation',
        'O Provedor configurado para seleção envia texto para fora da máquina.',
      )
    }
    return null
  }, [erroFontes, forcado])

  const execucaoEmAndamento = useMemo(
    () =>
      runsDaFonte.some((r) => r.state === 'running') ||
      execucaoAtiva?.run.state === 'running',
    [runsDaFonte, execucaoAtiva?.run.state],
  )

  if (estadoTela === 'carregando') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between border-b border-linha pb-2.5">
          <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">
            Seleção de Cortes
          </h1>
          <Esqueleto variante="linha" rotuloAcessivel="Carregando seleção de Cortes" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[42%_1fr] min-[1440px]:grid-cols-[38%_1fr]">
          <div className="rounded-area bg-area p-3">
            <Esqueleto variante="formulario" quantidade={4} rotuloAcessivel="Carregando configurador" />
          </div>
          <div className="flex flex-col gap-3 rounded-area bg-area p-3">
            <Esqueleto variante="painel" quantidade={1} rotuloAcessivel="Carregando acompanhamento" />
            <Esqueleto variante="lista" quantidade={4} rotuloAcessivel="Carregando janelas" />
          </div>
        </div>
      </div>
    )
  }

  if (estadoTela === 'erro' && erroFatalExibido) {
    const trad = mensagemDeErro(erroFatalExibido)
    const ehLocalOnly = erroFatalExibido.code === 'local_only_violation'
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">Seleção de Cortes</h1>
        <BannerErroCore
          erro={{
            code: erroFatalExibido.code,
            message: erroFatalExibido.detalhe || erroFatalExibido.message,
          }}
          traduzir={() => ({ titulo: trad.titulo })}
          acaoRecuperacao={
            ehLocalOnly
              ? {
                  rotulo: 'Escolher Perfil local',
                  aoAcionar: () => {
                    window.location.hash = '#/config/provedores'
                  },
                }
              : trad.recuperacao
                ? {
                    rotulo: trad.recuperacao.rotulo,
                    aoAcionar: () => {
                      if (trad.recuperacao?.rota) {
                        window.location.hash = trad.recuperacao.rota
                      } else {
                        void recarregarFontes()
                      }
                    },
                  }
                : { rotulo: 'Tentar novamente', aoAcionar: () => void recarregarFontes() }
          }
          acaoSecundaria={
            ehLocalOnly
              ? {
                  rotulo: 'Ver veto do Projeto',
                  aoAcionar: () => {
                    window.location.hash = '#/config/projeto'
                  },
                }
              : undefined
          }
          permitirRelato
        />
      </div>
    )
  }

  if (estadoTela === 'vazio' || !fonteAtiva) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
        <EstadoTela
          tipo="vazio"
          nivelTitulo="h1"
          titulo="Nenhuma Fonte transcrita ainda"
          descricao="Transcreva uma Fonte na etapa anterior antes de selecionar Cortes."
          acaoPrimaria={{
            rotulo: 'Ir para Fontes e Transcrição',
            aoAcionar: () => {
              window.location.hash = `#/projeto/${encProjeto}/fontes`
            },
          }}
        />
      </div>
    )
  }

  const fonteOfflineOuAlterada = fonteAtiva.status !== 'available'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Cabeçalho fixo da Fonte e contagem de execuções */}
      <div className="flex flex-wrap items-center gap-3 border-b border-linha pb-2.5">
        <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">Seleção de Cortes</h1>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-pequeno text-t3">Fonte transcrita:</span>
          <Select
            rotulo="Fonte transcrita"
            valor={String(fonteAtiva.id)}
            aoMudar={(val) => {
              const id = Number(val)
              setFonteSelecionadaId(id)
              setRunSelecionadoId(null)
              atualizarQueryCortes(projetoId, { fonte: id, run: null, rev: null })
            }}
            opcoes={opcoesFonte}
            className="min-w-64"
          />
        </div>

        {fonteOfflineOuAlterada ? (
          <div className="flex flex-wrap items-center gap-2">
            <Status tom="aviso" forte>
              {fonteAtiva.status === 'changed'
                ? 'Arquivo alterado no disco'
                : 'Fonte offline no disco'}
            </Status>
            <span className="text-pequeno text-t3">
              A seleção usa a Transcrição do Projeto; o preview 9:16 exigirá relocalizar o vídeo.
            </span>
          </div>
        ) : (
          <Status tom="sucesso">Disponível no disco</Status>
        )}

        <span className="num text-pequeno text-t3">
          Execuções anteriores: <strong className="font-medio text-t2">{runsDaFonte.length}</strong>
        </span>

        <div className="ml-auto">
          <Botao
            variante="fantasma"
            tamanho="p"
            onClick={() => {
              window.location.hash = `#/projeto/${encProjeto}/fontes/${fonteAtiva.id}`
            }}
          >
            Ver Transcrição →
          </Botao>
        </div>
      </div>

      {/* Duas colunas com rolagem independente */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[42%_1fr] min-[1440px]:grid-cols-[38%_1fr]">
        <aside
          ref={configuradorRef}
          tabIndex={-1}
          aria-label="Configurador de Seleção"
          className="flex min-h-0 flex-col overflow-hidden outline-none"
        >
          <AreaRolagem rotulo="Configurador de Seleção" className="h-full min-h-0">
            <div className="pr-2 pb-2">
              <ConfiguradorSelecao
                projetoId={projetoId}
                fonte={fonteAtiva}
                execucaoEmAndamento={execucaoEmAndamento}
                refCampoMaxUs={refCampoMaxUs}
                refBotaoDisparar={refBotaoDisparar}
                aoIniciarSelecao={(res) => {
                  setRunSelecionadoId(res.run)
                  atualizarQueryCortes(projetoId, {
                    fonte: fonteAtiva.id,
                    run: res.run,
                    rev: null,
                  })
                  void carregarRuns(fonteAtiva.id, { silencioso: true })
                  void carregarExecucao(res.run)
                }}
              />
            </div>
          </AreaRolagem>
        </aside>

        <section
          ref={acompanhamentoRef}
          tabIndex={-1}
          aria-label="Acompanhamento de Seleção"
          className="flex min-h-0 flex-col overflow-hidden outline-none"
        >
          <AreaRolagem rotulo="Acompanhamento de Seleção" className="h-full min-h-0">
            <div className="pr-2 pb-2">
              <AcompanhamentoSelecao
                projetoId={projetoId}
                fonteId={fonteAtiva.id}
                runs={runsDaFonte}
                runSelecionadoId={runSelecionadoId}
                revSelecionada={revParam}
                execucao={
                  execucaoAtiva && execucaoAtiva.run.id === runSelecionadoId
                    ? execucaoAtiva
                    : null
                }
                carregandoRuns={carregandoRuns}
                carregandoExecucao={carregandoExecucao}
                erroRuns={erroRuns}
                erroExecucao={erroExecucao}
                fila={fila}
                aoSelecionarRun={(runId) => {
                  setRunSelecionadoId(runId)
                  atualizarQueryCortes(projetoId, {
                    fonte: fonteAtiva.id,
                    run: runId,
                    rev: null,
                  })
                }}
                aoMudarRevisao={(rev) => {
                  if (runSelecionadoId === null) return
                  atualizarQueryCortes(projetoId, {
                    fonte: fonteAtiva.id,
                    run: runSelecionadoId,
                    rev,
                  })
                  void carregarExecucao(runSelecionadoId, rev)
                }}
                aoFocarDisparar={() => refBotaoDisparar.current?.focus()}
                aoRecarregar={aoRecarregarExecucaoERuns}
              />
            </div>
          </AreaRolagem>
        </section>
      </div>
    </div>
  )
}
