import {
  AreaRolagem,
  BannerErroCore,
  Botao,
  Dialogo,
  Dica,
  Esqueleto,
  EstadoTela,
  Kbd,
  Skeleton,
  Status,
  cn,
  useToast,
} from '@ds'
import { Lock, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatarTecla, useAtalhos, type Atalho } from '~/comandos/atalhos'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type { Fila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { parsearCorteId } from '~/stores/editorCorte'
import {
  storeFontesProjeto,
  useFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import type {
  DetalheExecucaoSelecao,
  ResumoRunSelecao,
  RevisaoExecucaoSelecao,
} from '~/stores/selecaoProjeto'
import { useTransformarCorte } from '~/stores/transformarCorte'
import type { MetaCorteResolvida } from '~/telas/corte/EditarCorte'
import { PainelTranscricaoTransformar } from '~/telas/corte/transformar/PainelTranscricaoTransformar'
import { PassoAngulo, type AlvoRefsEmFoco } from '~/telas/corte/transformar/PassoAngulo'
import { PassoNarracao } from '~/telas/corte/transformar/PassoNarracao'
import { PassoRoteiro } from '~/telas/corte/transformar/PassoRoteiro'

export type PassoTransformacao = 1 | 2 | 3

export type TransformarCorteProps = {
  projetoId: string
  projetoPath: string | null
  corteId: string
  runId?: string
  storeFontes?: StoreFontesProjeto
  fila?: Fila
  aoAtualizarMeta?: (meta: MetaCorteResolvida) => void
  aoMudarStatusSalvamento?: (status: ReactNode) => void
}

type CorteResolvidoTransformar = {
  corteId: string
  candidateId: number
  sourceId: number
  startId: number
  endId: number
  videoKind: 'transformed'
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

async function listarRunsDaFonte(sourceId: number): Promise<ResumoRunSelecao[]> {
  try {
    const lista = await chamar<ResumoRunSelecao[]>('selection.list', { source_id: sourceId })
    return Array.isArray(lista) ? lista : []
  } catch (err) {
    const coreErr = paraErroCore(err)
    if (coreErr.code === 'transcript_missing') return []
    throw coreErr
  }
}

function hashDoCorte(
  encProjeto: string,
  corteId: string,
  aba: 'editar' | 'empacotar',
  runId?: string,
): string {
  const encCorte = encodeURIComponent(corteId)
  const sufixoRun = runId && runId.trim() !== '' ? `?run=${encodeURIComponent(runId.trim())}` : ''
  return `#/projeto/${encProjeto}/corte/${encCorte}/${aba}${sufixoRun}`
}

/**
 * Tela E.1 — Sub-aba `Transformar` (`#/projeto/:id/corte/:corteId/transformar`).
 * Orquestra Painel esquerdo recolhível (`Ctrl+[`) da Transcrição do Corte, Stepper fixo de 3 etapas
 * com trava humana-no-loop (ADR-0001), guardas de rota, todos os 6 estados §6, atalhos e ciclo `F6`.
 */
export function TransformarCorte({
  projetoId,
  projetoPath,
  corteId,
  runId,
  storeFontes = storeFontesProjeto,
  fila,
  aoAtualizarMeta,
  aoMudarStatusSalvamento,
}: TransformarCorteProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const forcado = useEstadoForcado()
  const encProjeto = encodeURIComponent(projetoId)

  const identidade = useMemo(() => parsearCorteId(corteId), [corteId])

  const {
    fontes,
    projetoPath: projetoPathFontes,
    carregando: carregandoFontes,
    erro: erroFontes,
    recarregarFontes,
  } = useFontesProjeto(projetoPath, { store: storeFontes, fila })

  const [resolvendoEntrada, setResolvendoEntrada] = useState(true)
  const [erroResolucao, setErroResolucao] = useState<ErroCore | null>(null)
  const [corteResolvido, setCorteResolvido] = useState<CorteResolvidoTransformar | null>(null)

  const [passoAtivo, setPassoAtivo] = useState<PassoTransformacao>(1)
  const [blocoFocadoInicial, setBlocoFocadoInicial] = useState<number | null>(null)
  const [painelTranscricaoAberto, setPainelTranscricaoAberto] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1440 : false,
  )
  const [alvoRefsEmFoco, setAlvoRefsEmFoco] = useState<AlvoRefsEmFoco | null>(null)
  const [fraseDestacadaId, setFraseDestacadaId] = useState<number | null>(null)

  const [dialogoRelocalizarAberto, setDialogoRelocalizarAberto] = useState(false)
  const [caminhoRelocalizar, setCaminhoRelocalizar] = useState('')
  const [relocalizando, setRelocalizando] = useState(false)
  const [erroRelocalizar, setErroRelocalizar] = useState<ErroCore | null>(null)

  const redirecionouRef = useRef<string | null>(null)
  const passoInicializadoParaRef = useRef<number | null>(null)
  const acaoPendentePassoRef = useRef<'sugerirRoteiro' | 'abrirGravador' | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const areaTransformarRef = useRef<HTMLElement>(null)
  const regiaoFocoRef = useRef<{ prev: number; curr: number }>({ prev: -1, curr: -1 })

  const painelAbertoRef = useRef(painelTranscricaoAberto)
  painelAbertoRef.current = painelTranscricaoAberto

  const redirecionarPara = useCallback((chave: string, hash: string, aviso: string) => {
    if (redirecionouRef.current === chave) return
    redirecionouRef.current = chave
    toastRef.current.add({ title: aviso })
    window.location.replace(hash)
  }, [])

  // Guarda de entrada + resolução de :corteId (rejeita avulso-*, Corte direto e ausentes)
  useEffect(() => {
    if (forcado === 'carregando' || forcado === 'vazio' || forcado === 'erro') {
      setResolvendoEntrada(false)
      return
    }

    if (!identidade) {
      setResolvendoEntrada(false)
      setCorteResolvido(null)
      redirecionarPara(
        `invalido:${projetoId}:${corteId}`,
        `#/projeto/${encProjeto}/cortes`,
        'Este Corte não está disponível para Transformação.',
      )
      return
    }

    if (identidade.kind === 'avulso') {
      setResolvendoEntrada(false)
      setCorteResolvido(null)
      redirecionarPara(
        `avulso:${projetoId}:${corteId}`,
        hashDoCorte(encProjeto, corteId, 'editar', runId),
        'Transformar está disponível apenas para Vídeo transformado',
      )
      return
    }

    if (!projetoPath || carregandoFontes || projetoPathFontes !== projetoPath) {
      return
    }

    if (erroFontes) {
      setResolvendoEntrada(false)
      setErroResolucao(erroFontes)
      return
    }

    let cancelado = false
    setResolvendoEntrada(true)
    setErroResolucao(null)

    void (async () => {
      try {
        const runNum = runId !== undefined && runId.trim() !== '' ? Number(runId) : NaN
        const temRun = Number.isInteger(runNum) && runNum > 0

        if (temRun) {
          const [execucao, revisao] = await Promise.all([
            chamar<DetalheExecucaoSelecao>('selection.get', { run: runNum }),
            chamar<RevisaoExecucaoSelecao>('selection.review', { run: runNum }),
          ])
          if (cancelado) return

          const item = revisao.items.find((it) => it.candidate === identidade.candidateId)
          if (!item || item.status !== 'approved') {
            setResolvendoEntrada(false)
            setCorteResolvido(null)
            redirecionarPara(
              `nao-aprovado:${projetoId}:${corteId}:${runNum}`,
              `#/projeto/${encProjeto}/cortes`,
              'Este Corte não está disponível para Transformação.',
            )
            return
          }

          const itemComKind = item as typeof item & { videoKind?: 'direct' | 'transformed' }
          const videoKind =
            itemComKind.videoKind ??
            (execucao.run.videoKind === 'transformed' ? 'transformed' : 'direct')

          if (videoKind !== 'transformed') {
            setResolvendoEntrada(false)
            setCorteResolvido(null)
            redirecionarPara(
              `direto:${projetoId}:${corteId}:${runNum}`,
              hashDoCorte(encProjeto, corteId, 'editar', runId),
              'Transformar está disponível apenas para Vídeo transformado',
            )
            return
          }

          let sourceId = fontes[0]?.id ?? 1
          for (const f of fontes) {
            const runs = await listarRunsDaFonte(f.id)
            if (cancelado) return
            if (runs.some((r) => r.id === runNum)) {
              sourceId = f.id
              break
            }
          }

          setCorteResolvido({
            corteId,
            candidateId: identidade.candidateId,
            sourceId,
            startId: item.startId,
            endId: item.endId,
            videoKind: 'transformed',
          })
          setResolvendoEntrada(false)
          return
        }

        for (const f of fontes) {
          const runs = await listarRunsDaFonte(f.id)
          if (cancelado) return
          for (const r of runs) {
            const [execucao, revisao] = await Promise.all([
              chamar<DetalheExecucaoSelecao>('selection.get', { run: r.id }),
              chamar<RevisaoExecucaoSelecao>('selection.review', { run: r.id }),
            ])
            if (cancelado) return

            const item = revisao.items.find((it) => it.candidate === identidade.candidateId)
            if (item) {
              if (item.status !== 'approved') {
                setResolvendoEntrada(false)
                setCorteResolvido(null)
                redirecionarPara(
                  `nao-aprovado:${projetoId}:${corteId}`,
                  `#/projeto/${encProjeto}/cortes`,
                  'Este Corte não está disponível para Transformação.',
                )
                return
              }

              const itemComKind = item as typeof item & { videoKind?: 'direct' | 'transformed' }
              const videoKind =
                itemComKind.videoKind ??
                (execucao.run.videoKind === 'transformed' ? 'transformed' : 'direct')

              if (videoKind !== 'transformed') {
                setResolvendoEntrada(false)
                setCorteResolvido(null)
                redirecionarPara(
                  `direto:${projetoId}:${corteId}`,
                  hashDoCorte(encProjeto, corteId, 'editar', runId),
                  'Transformar está disponível apenas para Vídeo transformado',
                )
                return
              }

              setCorteResolvido({
                corteId,
                candidateId: identidade.candidateId,
                sourceId: f.id,
                startId: item.startId,
                endId: item.endId,
                videoKind: 'transformed',
              })
              setResolvendoEntrada(false)
              return
            }
          }
        }

        if (!cancelado) {
          setResolvendoEntrada(false)
          setCorteResolvido(null)
          redirecionarPara(
            `ausente:${projetoId}:${corteId}`,
            `#/projeto/${encProjeto}/cortes`,
            'Este Corte não está disponível para Transformação.',
          )
        }
      } catch (err) {
        if (!cancelado) {
          setResolvendoEntrada(false)
          setErroResolucao(paraErroCore(err))
        }
      }
    })()

    return () => {
      cancelado = true
    }
  }, [
    carregandoFontes,
    corteId,
    encProjeto,
    erroFontes,
    fontes,
    forcado,
    identidade,
    projetoId,
    projetoPath,
    projetoPathFontes,
    redirecionarPara,
    runId,
  ])

  const candidateIdAtivo =
    forcado === 'carregando' || forcado === 'erro' || forcado === 'vazio'
      ? null
      : (corteResolvido?.candidateId ?? null)

  const storeTransformar = useTransformarCorte(candidateIdAtivo, fila)

  const candidateIdParaPassos =
    candidateIdAtivo ?? (identidade?.kind === 'candidate' ? identidade.candidateId : 0)

  // Em ?estado=vazio, força estado vazio no Passo 1 e travas nos Passos 2 e 3
  const storeParaPassos = useMemo(() => {
    if (forcado !== 'vazio') return storeTransformar
    return {
      ...storeTransformar,
      carregando: false,
      erro: null,
      angulos: {
        schemaVersion: 1,
        revision: 1,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        selected: null,
        angles: [],
        generations: [],
        job: null,
      },
      roteiro: {
        schemaVersion: 1,
        revision: 1,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        angle: null,
        current: null,
        narrationAllowed: false,
        busy: false,
        job: null,
        generations: [],
        limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
      },
      narracao: {
        candidate: candidateIdParaPassos,
        narrationAllowed: false,
        gateReason: 'no_script' as const,
        language: 'pt-BR',
        defaultVoiceId: '13063',
        activeModelId: 'portuguese_24l',
        busy: false,
        job: null,
        importBusy: false,
        importJob: null,
        alignBusy: false,
        alignJob: null,
        alignPrerequisitesReady: true,
        vadReady: true,
        blocks: [],
        totalDurationUs: 0,
      },
    }
  }, [candidateIdParaPassos, forcado, storeTransformar])

  const fonteAtual = useMemo(() => {
    if (!corteResolvido) return null
    return fontes.find((f) => f.id === corteResolvido.sourceId) ?? null
  }, [corteResolvido, fontes])

  const fonteDisponivel =
    forcado !== 'offline' &&
    (fonteAtual ? Boolean(fonteAtual.available && fonteAtual.status === 'available') : true)

  useEffect(() => {
    aoAtualizarMeta?.({
      clipId: undefined,
      fonte: fonteAtual,
      videoKind: 'transformed',
    })
  }, [aoAtualizarMeta, fonteAtual])

  // Sincroniza estado inicial do painel Transcrição (fechado em 1366, aberto em >= 1440)
  useEffect(() => {
    setPainelTranscricaoAberto(typeof window !== 'undefined' ? window.innerWidth >= 1440 : false)
    setFraseDestacadaId(null)
    setBlocoFocadoInicial(null)
    passoInicializadoParaRef.current = null
  }, [corteId])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(min-width: 1440px)')
    const aoMudar = (ev: MediaQueryListEvent) => setPainelTranscricaoAberto(ev.matches)
    media.addEventListener?.('change', aoMudar)
    return () => media.removeEventListener?.('change', aoMudar)
  }, [])

  // Escolhe o passo inicial uma única vez quando o candidato carrega
  useEffect(() => {
    if (forcado === 'vazio') {
      setPassoAtivo(1)
      return
    }
    if (!corteResolvido || storeTransformar.carregando || !storeTransformar.angulos) return
    if (passoInicializadoParaRef.current === corteResolvido.candidateId) return
    passoInicializadoParaRef.current = corteResolvido.candidateId

    const temAngulo = Boolean(storeTransformar.angulos.selected)
    const narracaoLiberada = Boolean(
      storeTransformar.roteiro?.narrationAllowed && storeTransformar.narracao?.narrationAllowed,
    )
    if (!temAngulo) {
      setPassoAtivo(1)
    } else if (narracaoLiberada) {
      setPassoAtivo(3)
    } else {
      setPassoAtivo(2)
    }
  }, [
    corteResolvido,
    forcado,
    storeTransformar.angulos,
    storeTransformar.carregando,
    storeTransformar.narracao?.narrationAllowed,
    storeTransformar.roteiro?.narrationAllowed,
  ])

  const anguloSelecionado = storeParaPassos.angulos?.selected ?? null
  const roteiroAtual = storeParaPassos.roteiro
  const narracaoAtual = storeParaPassos.narracao
  const podePasso2 = anguloSelecionado !== null
  const narracaoLiberada = Boolean(
    roteiroAtual?.narrationAllowed && (narracaoAtual ? narracaoAtual.narrationAllowed : true),
  )

  useEffect(() => {
    if (!aoMudarStatusSalvamento) return
    const rotuloPasso =
      passoAtivo === 1 ? '1. Ângulo' : passoAtivo === 2 ? '2. Roteiro' : '3. Narração'
    aoMudarStatusSalvamento(<Status tom="info">Transformar · {rotuloPasso}</Status>)
  }, [aoMudarStatusSalvamento, passoAtivo])

  // Executa ações pendentes disparadas via Paleta após troca de passo
  useEffect(() => {
    const pendente = acaoPendentePassoRef.current
    if (!pendente) return
    if (pendente === 'sugerirRoteiro' && passoAtivo === 2) {
      acaoPendentePassoRef.current = null
      window.setTimeout(() => {
        const btn = Array.from(
          areaTransformarRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
            [],
        ).find((b) => /Sugerir (novo )?Roteiro/i.test(b.textContent ?? ''))
        btn?.click()
      }, 0)
    } else if (pendente === 'abrirGravador' && passoAtivo === 3) {
      acaoPendentePassoRef.current = null
      window.setTimeout(() => {
        const btn = Array.from(
          areaTransformarRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
            [],
        ).find((b) => /Gravar no microfone/i.test(b.textContent ?? ''))
        btn?.click()
      }, 0)
    }
  }, [passoAtivo])

  const acionarSalvarBlocoEmFoco = useCallback(() => {
    if (passoAtivo !== 2 || !areaTransformarRef.current) return
    const blocoFocado = areaTransformarRef.current.querySelector<HTMLElement>('li.marcado')
    const buscarBotaoSalvar = (escopo: ParentNode | null) =>
      Array.from(escopo?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).find(
        (b) => /Salvar edição/i.test(b.textContent ?? ''),
      )
    const alvo = buscarBotaoSalvar(blocoFocado) ?? buscarBotaoSalvar(areaTransformarRef.current)
    alvo?.click()
  }, [passoAtivo])

  const acionarAprovarBlocoAtual = useCallback(() => {
    if (passoAtivo !== 2 || !areaTransformarRef.current) return
    const blocoFocado = areaTransformarRef.current.querySelector<HTMLElement>('li.marcado')
    const buscarBotaoAprovar = (escopo: ParentNode | null) =>
      Array.from(escopo?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).find(
        (b) => /Aprovar bloco/i.test(b.textContent ?? ''),
      )
    const alvo = buscarBotaoAprovar(blocoFocado) ?? buscarBotaoAprovar(areaTransformarRef.current)
    alvo?.click()
  }, [passoAtivo])

  const atalhosTela = useMemo<Atalho[]>(() => {
    const lista: Atalho[] = [
      {
        id: 'editor.transcricao.alternar',
        titulo: 'Recolher/expandir Transcrição à esquerda',
        grupo: 'Transformar',
        tecla: 'Mod+[',
        executar: () => setPainelTranscricaoAberto((v) => !v),
      },
      {
        id: 'corte.salvar',
        titulo: 'Salvar alterações da sub-aba ativa',
        grupo: 'Corte',
        tecla: 'Mod+S',
        executar: acionarSalvarBlocoEmFoco,
      },
      {
        id: 'transformar.passo.angulo',
        titulo: 'Passo 1: Ângulo',
        grupo: 'Transformar',
        executar: () => setPassoAtivo(1),
      },
      {
        id: 'transformar.passo.roteiro',
        titulo: 'Passo 2: Roteiro',
        grupo: 'Transformar',
        executar: () => {
          if (podePasso2) {
            setPassoAtivo(2)
          } else {
            toastRef.current.add({
              title: 'Escolha ou escreva um ângulo no Passo 1 para liberar o Roteiro.',
            })
          }
        },
      },
      {
        id: 'transformar.passo.narracao',
        titulo: 'Passo 3: Narração',
        grupo: 'Transformar',
        executar: () => setPassoAtivo(3),
      },
      {
        id: 'transformar.sugerirRoteiro',
        titulo: 'Sugerir Roteiro',
        grupo: 'Transformar',
        executar: () => {
          if (!podePasso2) {
            toastRef.current.add({
              title: 'Escolha ou escreva um ângulo no Passo 1 para liberar o Roteiro.',
            })
            return
          }
          if (passoAtivo === 2) {
            const btn = Array.from(
              areaTransformarRef.current?.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              ) ?? [],
            ).find((b) => /Sugerir (novo )?Roteiro/i.test(b.textContent ?? ''))
            btn?.click()
          } else {
            acaoPendentePassoRef.current = 'sugerirRoteiro'
            setPassoAtivo(2)
          }
        },
      },
      {
        id: 'transformar.aprovarBloco',
        titulo: 'Aprovar bloco atual',
        grupo: 'Transformar',
        executar: acionarAprovarBlocoAtual,
      },
      {
        id: 'transformar.abrirGravador',
        titulo: 'Abrir gravador',
        grupo: 'Transformar',
        executar: () => {
          if (!narracaoLiberada) {
            setPassoAtivo(3)
            return
          }
          if (passoAtivo === 3) {
            const btn = Array.from(
              areaTransformarRef.current?.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              ) ?? [],
            ).find((b) => /Gravar no microfone/i.test(b.textContent ?? ''))
            btn?.click()
          } else {
            acaoPendentePassoRef.current = 'abrirGravador'
            setPassoAtivo(3)
          }
        },
      },
    ]
    return lista
  }, [
    acionarAprovarBlocoAtual,
    acionarSalvarBlocoEmFoco,
    narracaoLiberada,
    passoAtivo,
    podePasso2,
  ])

  useAtalhos(atalhosTela)

  // Ciclo F6 / Shift+F6: Topo -> Contexto -> Transcrição do Corte -> Stepper + Passo ativo -> Fila (se aberta) -> Barra de Status
  useEffect(() => {
    const obterRegioes = (): HTMLElement[] => {
      const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')
      const contexto = document.querySelector<HTMLElement>('[data-regiao="contexto"]')
      const painel =
        containerRef.current?.querySelector<HTMLElement>(
          painelAbertoRef.current
            ? 'aside[aria-label="Transcrição do Corte"]'
            : 'aside[aria-label="Transcrição do Corte recolhida"]',
        ) ?? null
      const principal = areaTransformarRef.current
      const filaRegiao = document.querySelector<HTMLElement>('[data-regiao="fila"]')
      const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')
      return [topo, contexto, painel, principal, filaRegiao, rodape].filter(
        (el): el is HTMLElement => el !== null,
      )
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
      ).some((el) => !el.closest('[aria-label="Notifications"], [data-nao-modal]'))
      if (temDialogoModal) return

      const regioes = obterRegioes()
      if (regioes.length === 0) return

      const idxAtual = indiceDoElemento(document.activeElement, regioes)

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

  const abrirRelocalizarFonte = useCallback(() => {
    setErroRelocalizar(null)
    setCaminhoRelocalizar(fonteAtual?.path ?? '')
    setDialogoRelocalizarAberto(true)
  }, [fonteAtual?.path])

  const confirmarRelocalizar = useCallback(async () => {
    const idFonte = fonteAtual?.id ?? corteResolvido?.sourceId
    if (!idFonte || !caminhoRelocalizar.trim() || relocalizando) return
    setRelocalizando(true)
    setErroRelocalizar(null)
    try {
      await chamar('sources.relocate', {
        id: idFonte,
        path: caminhoRelocalizar.trim(),
        confirmed: true,
      })
      await recarregarFontes()
      setDialogoRelocalizarAberto(false)
      toastRef.current.add({ title: 'Fonte relocalizada.' })
    } catch (err) {
      setErroRelocalizar(paraErroCore(err))
    } finally {
      setRelocalizando(false)
    }
  }, [caminhoRelocalizar, corteResolvido?.sourceId, fonteAtual?.id, recarregarFontes, relocalizando])

  const aoMudarRefEmFocoEstavel = useCallback((proximo: AlvoRefsEmFoco | null) => {
    setAlvoRefsEmFoco((atual) => {
      if (atual === null && proximo === null) return atual
      if (
        atual &&
        proximo &&
        atual.chave === proximo.chave &&
        atual.refs.length === proximo.refs.length &&
        atual.refs.every((v, i) => v === proximo.refs[i])
      ) {
        return atual
      }
      return proximo
    })
  }, [])

  const aoClicarChipFrase = useCallback((fraseId: number) => {
    setFraseDestacadaId(fraseId)
    setPainelTranscricaoAberto(true)
  }, [])

  const aoClicarFrasePainel = useCallback(
    (fraseId: number) => {
      setFraseDestacadaId(fraseId)
      if (alvoRefsEmFoco) {
        alvoRefsEmFoco.alternarId(fraseId)
      } else {
        toastRef.current.add({
          title: `Frase #${fraseId}`,
          description:
            passoAtivo === 1
              ? 'Abra "Escrever meu próprio ângulo" para vincular Frases de apoio.'
              : passoAtivo === 2
                ? 'Foque um bloco do Roteiro para vincular ou remover Frases.'
                : 'Navegue para o Passo 1 ou Passo 2 para editar referências.',
        })
      }
    },
    [alvoRefsEmFoco, passoAtivo],
  )

  const erroTela =
    forcado === 'erro'
      ? new ErroCore('project_write', 'Erro simulado via ?estado=erro.')
      : (erroResolucao ?? (forcado === 'vazio' ? null : storeParaPassos.erro))

  if (erroTela) {
    const traducao = mensagemDeErro(erroTela)
    const acaoRecuperacao =
      erroTela.code === 'script_requires_transformed'
        ? {
            rotulo: 'Voltar para Editar',
            aoAcionar: () => {
              window.location.hash = hashDoCorte(encProjeto, corteId, 'editar', runId)
            },
          }
        : traducao.recuperacao
          ? {
              rotulo: traducao.recuperacao.rotulo,
              aoAcionar: () => {
                if (traducao.recuperacao?.acao === 'relocalizar-fonte') {
                  abrirRelocalizarFonte()
                } else if (traducao.recuperacao?.rota) {
                  window.location.hash = traducao.recuperacao.rota
                } else {
                  void storeTransformar.recarregar()
                }
              },
            }
          : {
              rotulo: 'Tentar novamente',
              aoAcionar: () => void storeTransformar.recarregar(),
            }

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[68ch]">
          <BannerErroCore
            erro={{ code: erroTela.code, message: erroTela.detalhe || erroTela.message }}
            traduzir={() => traducao}
            acaoRecuperacao={acaoRecuperacao}
            permitirRelato
          />
        </div>
      </div>
    )
  }

  const carregandoTela =
    forcado === 'carregando' ||
    (forcado !== 'vazio' &&
      (resolvendoEntrada ||
        storeTransformar.carregando ||
        storeTransformar.candidateId !== candidateIdAtivo ||
        !storeTransformar.angulos))

  if (carregandoTela) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Carregando Transformação do Corte"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-linha bg-area px-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="mx-auto flex w-full max-w-[68ch] flex-1 flex-col gap-4 p-4">
          <Esqueleto variante="painel" quantidade={3} rotuloAcessivel="Carregando blocos da Transformação" />
          <Esqueleto variante="painel" quantidade={3} rotuloAcessivel="Carregando etapas" />
        </div>
      </div>
    )
  }

  // Status do Stepper
  const badgePasso1 = anguloSelecionado ? `Definido: ${anguloSelecionado.name}` : 'Pendente'
  const badgePasso2 = !roteiroAtual?.current
    ? 'Não gerado'
    : roteiroAtual.current.pending === 0
      ? 'Todos aprovados'
      : `${roteiroAtual.current.approved}/${roteiroAtual.current.blocks.length} aprovados`

  const qtdPendentesPasso2 = roteiroAtual?.current?.pending ?? 0
  const motivoTravaPasso3 =
    narracaoAtual?.gateReason === 'no_script' || !roteiroAtual?.current
      ? 'Travado · Sem Roteiro'
      : narracaoAtual?.gateReason === 'generating' || roteiroAtual?.busy
        ? 'Travado · Gerando Roteiro'
        : `Travado · ${Math.max(1, qtdPendentesPasso2)} ${Math.max(1, qtdPendentesPasso2) === 1 ? 'bloco pendente' : 'blocos pendentes'}`

  const blocosNarracao = narracaoAtual?.blocks ?? []
  const blocosComAudio = blocosNarracao.filter((b) => Boolean(b.audio)).length
  const todosProntosEmpacotar =
    blocosNarracao.length > 0 &&
    blocosComAudio === blocosNarracao.length &&
    blocosNarracao.every(
      (b) =>
        !b.audio?.stale &&
        !(b.audio?.engineId === 'recorded' && !b.audio.trimmed) &&
        b.alignment?.status !== 'needs_review',
    )
  const badgePasso3 = !narracaoLiberada
    ? motivoTravaPasso3
    : todosProntosEmpacotar
      ? 'Pronto para Empacotar'
      : `${blocosComAudio}/${blocosNarracao.length} blocos com voz`

  const atalhoTranscricao = formatarTecla('Mod+[')
  const mostrarBannerParcialForcado =
    forcado === 'parcial' && passoAtivo === 1

  return (
    <div ref={containerRef} data-f6-proprio="" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!fonteDisponivel && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-linha bg-area px-4 py-1.5 text-pequeno"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Status tom="aviso">Fonte offline</Status>
            <span className="truncate text-t2">
              O arquivo original da Fonte foi movido ou alterado. Você ainda pode editar Ângulo, Roteiro e Narração salvos no Projeto.
            </span>
          </div>
          <Botao tamanho="p" variante="secundario" onClick={abrirRelocalizarFonte}>
            Relocalizar Fonte
          </Botao>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PainelTranscricaoTransformar
          sourceId={corteResolvido?.sourceId ?? null}
          startId={corteResolvido?.startId ?? null}
          endId={corteResolvido?.endId ?? null}
          aberto={painelTranscricaoAberto}
          refsAtivas={alvoRefsEmFoco?.refs ?? []}
          fraseDestacadaId={fraseDestacadaId}
          aoAlternarAberto={() => setPainelTranscricaoAberto((v) => !v)}
          aoClicarFrase={aoClicarFrasePainel}
        />

        <section
          ref={areaTransformarRef}
          data-regiao="transformar-principal"
          tabIndex={-1}
          aria-label="Etapas e passo ativo da Transformação"
          className="foco-interno flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {/* Stepper fixo */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-linha bg-area px-4 py-2">
            <Botao
              variante="fantasma"
              tamanho="p"
              icone={painelTranscricaoAberto ? <PanelLeftClose /> : <PanelLeftOpen />}
              onClick={() => setPainelTranscricaoAberto((v) => !v)}
            >
              <span>{painelTranscricaoAberto ? 'Fechar Transcrição' : 'Abrir Transcrição do Corte'}</span>
              <Kbd>{atalhoTranscricao}</Kbd>
            </Botao>

            <nav aria-label="Etapas da Transformação" className="flex min-w-0 flex-wrap items-center">
              <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
                <li>
                  <button
                    type="button"
                    aria-current={passoAtivo === 1 ? 'step' : undefined}
                    onClick={() => setPassoAtivo(1)}
                    className={cn(
                      'foco inline-flex min-h-7 cursor-pointer items-center gap-2 rounded-controle border-0 px-2.5 py-1 text-pequeno transition-colors duration-(--dur-rapida) ease-saida',
                      passoAtivo === 1
                        ? 'marcado bg-elevado font-medio text-t1'
                        : 'bg-transparent text-t2 hover:bg-hover hover:text-t1',
                    )}
                  >
                    <span className="num font-forte">1. Ângulo</span>
                    <Status tom={anguloSelecionado ? 'sucesso' : 'pendente'}>
                      <span className="max-w-44 truncate">{badgePasso1}</span>
                    </Status>
                  </button>
                </li>

                <li aria-hidden className="text-t3 select-none">
                  →
                </li>

                <li>
                  <Dica
                    texto={
                      podePasso2
                        ? 'Editar e aprovar blocos do Roteiro'
                        : 'Escolha ou escreva um ângulo no Passo 1 para liberar o Roteiro'
                    }
                  >
                    <button
                      type="button"
                      aria-current={passoAtivo === 2 ? 'step' : undefined}
                      aria-disabled={!podePasso2 ? 'true' : undefined}
                      aria-describedby={!podePasso2 ? 'desc-trava-passo-2' : undefined}
                      onClick={() => {
                        if (!podePasso2) {
                          toastRef.current.add({
                            title: 'Escolha ou escreva um ângulo no Passo 1 para liberar o Roteiro.',
                          })
                          return
                        }
                        setPassoAtivo(2)
                      }}
                      className={cn(
                        'foco inline-flex min-h-7 items-center gap-2 rounded-controle border-0 px-2.5 py-1 text-pequeno transition-colors duration-(--dur-rapida) ease-saida',
                        !podePasso2
                          ? 'cursor-not-allowed text-t3 opacity-75'
                          : passoAtivo === 2
                            ? 'marcado cursor-pointer bg-elevado font-medio text-t1'
                            : 'cursor-pointer bg-transparent text-t2 hover:bg-hover hover:text-t1',
                      )}
                    >
                      <span className="num font-forte">2. Roteiro</span>
                      <Status
                        tom={
                          roteiroAtual?.current && roteiroAtual.current.pending === 0
                            ? 'sucesso'
                            : 'pendente'
                        }
                      >
                        <span className="num">{badgePasso2}</span>
                      </Status>
                    </button>
                  </Dica>
                </li>

                <li aria-hidden className="text-t3 select-none">
                  →
                </li>

                <li>
                  <Dica
                    texto={
                      narracaoLiberada
                        ? 'Gerar TTS local, gravar no teleprompter ou importar Narração'
                        : 'Aprove todos os blocos do Roteiro antes de narrar (clique para ver detalhes)'
                    }
                  >
                    <button
                      type="button"
                      aria-current={passoAtivo === 3 ? 'step' : undefined}
                      aria-describedby={!narracaoLiberada ? 'desc-trava-passo-3' : undefined}
                      onClick={() => setPassoAtivo(3)}
                      className={cn(
                        'foco inline-flex min-h-7 cursor-pointer items-center gap-2 rounded-controle border-0 px-2.5 py-1 text-pequeno transition-colors duration-(--dur-rapida) ease-saida',
                        passoAtivo === 3
                          ? 'marcado bg-elevado font-medio text-t1'
                          : !narracaoLiberada
                            ? 'bg-transparent text-t3 hover:bg-hover hover:text-t2'
                            : 'bg-transparent text-t2 hover:bg-hover hover:text-t1',
                      )}
                    >
                      {!narracaoLiberada && (
                        <Lock className="size-[13px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
                      )}
                      <span className="num font-forte">3. Narração</span>
                      <Status tom={todosProntosEmpacotar ? 'sucesso' : 'pendente'}>
                        <span className="num">{badgePasso3}</span>
                      </Status>
                    </button>
                  </Dica>
                </li>
              </ol>

              <span id="desc-trava-passo-2" className="sr-only">
                Escolha ou escreva um ângulo no Passo 1 para liberar o Roteiro.
              </span>
              <span id="desc-trava-passo-3" className="sr-only">
                A Narração permanece travada até que todos os blocos do Roteiro sejam aprovados.
              </span>
            </nav>
          </div>

          <AreaRolagem rotulo="Conteúdo do passo ativo da Transformação" className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 p-4">
              {mostrarBannerParcialForcado && (
                <div className="mx-auto w-full max-w-[68ch]">
                  <EstadoTela
                    tipo="parcial"
                    compacto
                    titulo="Transformação parcial:"
                    descricao="Parte das etapas já foi concluída; revise e aprove os blocos pendentes para liberar a Narração."
                  />
                </div>
              )}

              {passoAtivo === 1 && (
                <PassoAngulo
                  candidateId={candidateIdParaPassos}
                  store={storeParaPassos}
                  fila={fila}
                  modalPaiAberto={dialogoRelocalizarAberto}
                  aoClicarChipFrase={aoClicarChipFrase}
                  aoMudarRefEmFoco={aoMudarRefEmFocoEstavel}
                  aoAvancarPasso={() => setPassoAtivo(2)}
                />
              )}

              {passoAtivo === 2 && (
                <PassoRoteiro
                  candidateId={candidateIdParaPassos}
                  store={storeParaPassos}
                  fila={fila}
                  modalPaiAberto={dialogoRelocalizarAberto}
                  aoClicarChipFrase={aoClicarChipFrase}
                  aoMudarRefEmFoco={aoMudarRefEmFocoEstavel}
                  aoAvancarNarracao={() => setPassoAtivo(3)}
                  blocoFocadoInicial={blocoFocadoInicial}
                />
              )}

              {passoAtivo === 3 && (
                <PassoNarracao
                  candidateId={candidateIdParaPassos}
                  store={storeParaPassos}
                  modalPaiAberto={dialogoRelocalizarAberto}
                  aoVoltarBlocoPendente={(blockId) => {
                    setBlocoFocadoInicial(blockId ?? null)
                    setPassoAtivo(2)
                  }}
                  aoIrParaEmpacotar={() => {
                    window.location.hash = hashDoCorte(encProjeto, corteId, 'empacotar', runId)
                  }}
                  aoIrParaEditar={() => {
                    window.location.hash = hashDoCorte(encProjeto, corteId, 'editar', runId)
                  }}
                />
              )}
            </div>
          </AreaRolagem>
        </section>
      </div>

      {/* Diálogo de relocalização da Fonte */}
      <Dialogo
        aberto={dialogoRelocalizarAberto}
        aoMudarAberto={setDialogoRelocalizarAberto}
        titulo="Relocalizar arquivo da Fonte"
        descricao="Informe o novo caminho no disco para restaurar a prévia e a exportação deste Corte."
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={relocalizando}
              onClick={() => setDialogoRelocalizarAberto(false)}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={relocalizando}
              disabled={!caminhoRelocalizar.trim()}
              onClick={() => void confirmarRelocalizar()}
            >
              Confirmar relocalização
            </Botao>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {erroRelocalizar && (
            <BannerErroCore
              erro={{
                code: erroRelocalizar.code,
                message: erroRelocalizar.detalhe || erroRelocalizar.message,
              }}
              traduzir={(code) =>
                mensagemDeErro(new ErroCore(code, erroRelocalizar.detalhe ?? ''))
              }
            />
          )}
          <SeletorCaminho
            modo="arquivo"
            rotulo="Arquivo de vídeo da Fonte"
            valor={caminhoRelocalizar}
            aoMudar={setCaminhoRelocalizar}
            placeholder="Selecione ou informe o caminho completo do vídeo"
          />
        </div>
      </Dialogo>
    </div>
  )
}
