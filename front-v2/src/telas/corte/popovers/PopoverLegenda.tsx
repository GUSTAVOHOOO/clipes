import {
  BannerErroCore,
  Botao,
  Campo,
  ConfirmDialog,
  Entrada,
  GrupoAjuste,
  Progresso,
  ResumoCustoPrivacidade,
  Segmentado,
  Select,
  Status,
  Switch,
  useToast,
} from '@ds'
import { useEffect, useMemo, useState } from 'react'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { type CaptionStyle } from '~/stores/editorCorte'
import {
  resolverDestinoSelecao,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
} from '~/stores/selecaoProjeto'
import { useSessaoEditorCorte, type SessaoEditorCorte } from '~/telas/corte/PalcoEditor'

export type PopoverLegendaProps = {
  projetoId: string
  projetoPath?: string | null
  corteId?: string | null
  videoKind: 'direct' | 'transformed'
  palavraSelecionadaPosition?: number | null
  aoIrParaTranscricaoPalavra?: (position: number) => void
  estadoEditor?: SessaoEditorCorte
}

type FaixaOpcao = 'auto' | 'original' | 'translated' | 'narration'

type EstimativaTraducao = {
  paid: boolean
  profile: string
  sourceLanguage: string
  targetLanguage: string
  batches: number
  sentenceCount: number
  contextTokens: number
  estimate: {
    kind: 'zero' | 'usd' | 'unknown' | 'plan_quota'
    minMicroUsd?: number
    maxMicroUsd?: number
  }
}

type OrcamentoItem = {
  scope: string
  target?: string | null
  maxCostMicroUsd?: number | null
  maxCalls?: number | null
  usage: { microUsd: number; calls: number }
  paused?: boolean
}

export function PopoverLegenda({
  projetoId,
  projetoPath = null,
  corteId = null,
  videoKind,
  palavraSelecionadaPosition,
  aoIrParaTranscricaoPalavra,
  estadoEditor,
}: PopoverLegendaProps) {
  const editor = useSessaoEditorCorte(projetoPath, corteId, estadoEditor)
  const doc = editor.documentoAtivo
  const legendas = editor.legendas
  const traducao = editor.traducao
  const jobs = useFila()
  const toast = useToast()

  const [faixaEscolhida, setFaixaEscolhida] = useState<FaixaOpcao>('auto')
  const [rascunhoEstilo, setRascunhoEstilo] = useState<CaptionStyle | null>(
    legendas?.style ?? null,
  )
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [conflitoEstilo, setConflitoEstilo] = useState(false)
  const [posicaoLocal, setPosicaoLocal] = useState<number | null>(null)

  const [idiomaAlvo, setIdiomaAlvo] = useState<'pt-BR' | 'en'>(
    (traducao?.targetLanguage as 'pt-BR' | 'en' | null) ??
      (traducao?.defaultTargetLanguage as 'pt-BR' | 'en' | null) ??
      'en',
  )
  const [calculandoTraducao, setCalculandoTraducao] = useState(false)
  const [estimativa, setEstimativa] = useState<EstimativaTraducao | null>(null)
  const [perfis, setPerfis] = useState<PerfilProvedorLista[]>([])
  const [tarefas, setTarefas] = useState<RespostaTarefasAssistente | null>(null)
  const [orcamento, setOrcamento] = useState<OrcamentoItem | null>(null)
  const [somenteLocalProjeto, setSomenteLocalProjeto] = useState(false)
  const [confirmarTraducao, setConfirmarTraducao] = useState(false)
  const [iniciandoTraducao, setIniciandoTraducao] = useState(false)
  const [rascunhosFrases, setRascunhosFrases] = useState<Record<number, string>>({})

  useEffect(() => {
    if (legendas?.style) {
      setRascunhoEstilo(legendas.style)
    }
  }, [legendas?.style])

  useEffect(() => {
    if (traducao?.targetLanguage === 'pt-BR' || traducao?.targetLanguage === 'en') {
      setIdiomaAlvo(traducao.targetLanguage)
    }
  }, [traducao?.targetLanguage])

  const posAtiva = useMemo(() => {
    if (typeof palavraSelecionadaPosition === 'number') return palavraSelecionadaPosition
    if (typeof posicaoLocal === 'number') return posicaoLocal
    const primeira = legendas?.words.find((w) => w.position >= 0)
    return primeira?.position ?? null
  }, [legendas?.words, palavraSelecionadaPosition, posicaoLocal])

  const palavraAtiva = useMemo(
    () => legendas?.words.find((w) => w.position === posAtiva) ?? null,
    [legendas?.words, posAtiva],
  )

  const opcoesFaixa = useMemo(() => {
    const base: Array<{ valor: FaixaOpcao; rotulo: string; desabilitada?: boolean }> = [
      { valor: 'auto', rotulo: 'Automático' },
      { valor: 'original', rotulo: 'Original' },
      { valor: 'translated', rotulo: 'Traduzida', desabilitada: !traducao?.hasTranslation },
    ]
    if (videoKind === 'transformed') {
      base.push({ valor: 'narration', rotulo: 'Narração' })
    }
    return base
  }, [traducao?.hasTranslation, videoKind])

  const selecionarFaixa = async (proxima: FaixaOpcao) => {
    if (!doc) return
    setErroAcao(null)
    setFaixaEscolhida(proxima)
    try {
      await chamar('captions.track.set', {
        clip_id: doc.clipId,
        ...(typeof doc.request.candidate_id === 'number'
          ? { candidate_id: doc.request.candidate_id }
          : {}),
        track: proxima,
      })
      await editor.store.recarregarLegendas()
    } catch (err) {
      setErroAcao(paraErroCore(err))
    }
  }

  const aplicarPreset = async (preset: 'vertical' | 'cinema' | 'simple') => {
    setErroAcao(null)
    setConflitoEstilo(false)
    try {
      await editor.store.aplicarPresetLegenda(preset)
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'caption_style_conflict') setConflitoEstilo(true)
      setErroAcao(e)
    }
  }

  const salvarEstilo = async (proximo: CaptionStyle) => {
    setRascunhoEstilo(proximo)
    setErroAcao(null)
    setConflitoEstilo(false)
    try {
      await editor.store.definirEstiloLegenda(proximo)
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'caption_style_conflict') setConflitoEstilo(true)
      setErroAcao(e)
    }
  }

  const recarregarEstilo = async () => {
    setErroAcao(null)
    setConflitoEstilo(false)
    await editor.store.recarregarLegendas()
  }

  const calcularTraducao = async () => {
    if (!doc) return
    setCalculandoTraducao(true)
    setErroAcao(null)
    try {
      const [resEst, resPerfis, resTarefas, resOrcamentos, resLocal] = await Promise.all([
        chamar<EstimativaTraducao>('translation.estimate', {
          clip_id: doc.clipId,
          target_language: idiomaAlvo,
        }),
        chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {}).catch(() => ({
          profiles: [],
        })),
        chamar<RespostaTarefasAssistente>('assistant.tasks', {}).catch(() => null),
        chamar<{ budgets: OrcamentoItem[] }>('jobs.budget.get', {}).catch(() => ({ budgets: [] })),
        chamar<{ enabled: boolean }>('projects.local_only.get', {}).catch(() => ({ enabled: false })),
      ])
      setEstimativa(resEst)
      setPerfis(resPerfis.profiles ?? [])
      setTarefas(resTarefas)
      setSomenteLocalProjeto(Boolean(resLocal?.enabled))
      const orcTraducao =
        (resOrcamentos.budgets ?? []).find(
          (b) => b.scope === 'task' && b.target === 'translation',
        ) ?? null
      setOrcamento(orcTraducao)
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setCalculandoTraducao(false)
    }
  }

  const destinoTraducao = useMemo(() => {
    if (!estimativa) return null
    const tarefasAdaptadas: RespostaTarefasAssistente | null = tarefas
      ? {
          projectLocalOnly: somenteLocalProjeto || Boolean(tarefas.projectLocalOnly),
          tasks: tarefas.tasks
            .filter((t) => t.task === 'translation')
            .map((t) => ({ ...t, task: 'selection' })),
        }
      : { projectLocalOnly: somenteLocalProjeto, tasks: [] }
    return resolverDestinoSelecao(estimativa.profile, perfis, tarefasAdaptadas)
  }, [estimativa, perfis, somenteLocalProjeto, tarefas])

  const executarTraducao = async (confirmed: boolean) => {
    setIniciandoTraducao(true)
    setErroAcao(null)
    try {
      await editor.store.iniciarTraducao({
        target_language: idiomaAlvo,
        confirmed,
      })
      setConfirmarTraducao(false)
      toast.add({ title: 'Tradução das legendas iniciada.' })
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'confirmation_required') {
        setConfirmarTraducao(true)
      } else {
        setErroAcao(e)
      }
    } finally {
      setIniciandoTraducao(false)
    }
  }

  const aoClicarTraduzir = () => {
    if (!estimativa) return
    if (destinoTraducao?.bloqueadoSomenteLocal) return
    if (estimativa.paid || destinoTraducao?.saiDaMaquina) {
      setConfirmarTraducao(true)
      return
    }
    void executarTraducao(true)
  }

  const jobsTraducaoAtivos = useMemo(() => {
    if (!doc) return []
    const idsDoClip = new Set(
      Object.entries(editor.translationJobToClip)
        .filter(([, cid]) => cid === doc.clipId)
        .map(([jid]) => jid),
    )
    return jobs.filter((j) => idsDoClip.has(j.id) && j.estado === 'rodando')
  }, [doc, editor.translationJobToClip, jobs])

  const estimativaDs = useMemo(() => {
    if (!estimativa) return { kind: 'zero' as const }
    if (estimativa.estimate.kind === 'usd') {
      return {
        kind: 'usd' as const,
        minMicroUsd: estimativa.estimate.minMicroUsd ?? 0,
        maxMicroUsd: estimativa.estimate.maxMicroUsd ?? 0,
      }
    }
    if (estimativa.estimate.kind === 'unknown') return { kind: 'unknown' as const }
    if (estimativa.estimate.kind === 'plan_quota') return { kind: 'plan_quota' as const }
    return { kind: 'zero' as const }
  }, [estimativa])

  const estilo = rascunhoEstilo ?? legendas?.style ?? null
  const missingGlyphs = legendas?.missingGlyphs ?? []

  return (
    <div className="flex flex-col gap-3 text-pequeno">
      {editor.remapDescartados > 0 && (
        <Status tom="aviso">
          {editor.remapDescartados} destaque(s) por palavra descartado(s) após retranscrição.
        </Status>
      )}

      {erroAcao && (
        <BannerErroCore
          erro={{ code: erroAcao.code, message: erroAcao.detalhe }}
          traduzir={(code) => mensagemDeErro(new (erroAcao.constructor as typeof ErroCore)(code, erroAcao.detalhe))}
          acaoRecuperacao={
            conflitoEstilo
              ? { rotulo: 'Recarregar estilo', aoAcionar: () => void recarregarEstilo() }
              : undefined
          }
          aoDispensar={() => {
            setErroAcao(null)
            setConflitoEstilo(false)
          }}
        />
      )}

      <GrupoAjuste rotulo="Faixa da legenda">
        <Segmentado<FaixaOpcao>
          rotulo="Faixa da legenda"
          valor={faixaEscolhida}
          aoMudar={(v) => void selecionarFaixa(v)}
          opcoes={opcoesFaixa}
          className={opcoesFaixa.length > 3 ? 'grid grid-cols-2' : undefined}
        />
      </GrupoAjuste>

      {estilo && (
        <GrupoAjuste rotulo="Estilo da legenda">
          <Segmentado<'vertical' | 'cinema' | 'simple'>
            rotulo="Estilo de legenda"
            valor={estilo.preset}
            aoMudar={(v) => void aplicarPreset(v)}
            opcoes={[
              { valor: 'vertical', rotulo: 'Vertical' },
              { valor: 'cinema', rotulo: 'Cinema' },
              { valor: 'simple', rotulo: 'Simples' },
            ]}
          />
          <p className="text-pequeno text-t3">
            Trocar o estilo preserva seus destaques por palavra.
          </p>
        </GrupoAjuste>
      )}

      {estilo && (
        <GrupoAjuste rotulo="Personalização">
          <Select<'Noto Sans' | 'Noto Serif'>
            rotulo="Fonte da legenda"
            valor={estilo.font}
            aoMudar={(font) => void salvarEstilo({ ...estilo, font })}
            opcoes={[
              { valor: 'Noto Sans', rotulo: 'Noto Sans' },
              { valor: 'Noto Serif', rotulo: 'Noto Serif' },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Tamanho (24–96)">
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  type="number"
                  min={24}
                  max={96}
                  value={estilo.fontSize}
                  onChange={(e) =>
                    setRascunhoEstilo({ ...estilo, fontSize: Number(e.target.value) })
                  }
                  onBlur={() => void salvarEstilo(estilo)}
                  className="num"
                />
              )}
            </Campo>
            <Campo rotulo="Contorno (0–10)">
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  type="number"
                  min={0}
                  max={10}
                  value={estilo.outline}
                  onChange={(e) =>
                    setRascunhoEstilo({ ...estilo, outline: Number(e.target.value) })
                  }
                  onBlur={() => void salvarEstilo(estilo)}
                  className="num"
                />
              )}
            </Campo>
            <Campo rotulo="Sombra (0–10)">
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  type="number"
                  min={0}
                  max={10}
                  value={estilo.shadow}
                  onChange={(e) =>
                    setRascunhoEstilo({ ...estilo, shadow: Number(e.target.value) })
                  }
                  onBlur={() => void salvarEstilo(estilo)}
                  className="num"
                />
              )}
            </Campo>
            <Campo rotulo="Posição X (80–1000)">
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  type="number"
                  min={80}
                  max={1000}
                  value={estilo.x}
                  onChange={(e) => setRascunhoEstilo({ ...estilo, x: Number(e.target.value) })}
                  onBlur={() => void salvarEstilo(estilo)}
                  className="num"
                />
              )}
            </Campo>
            <Campo rotulo="Posição Y (192–1600)">
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  type="number"
                  min={192}
                  max={1600}
                  value={estilo.y}
                  onChange={(e) => setRascunhoEstilo({ ...estilo, y: Number(e.target.value) })}
                  onBlur={() => void salvarEstilo(estilo)}
                  className="num"
                />
              )}
            </Campo>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['color', 'Cor'],
                ['activeColor', 'Cor ativa'],
                ['dimColor', 'Cor já falada'],
                ['outlineColor', 'Cor contorno'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-2 text-t2">
                <span>{label}</span>
                <input
                  type="color"
                  aria-label={label}
                  value={estilo[key]}
                  onChange={(e) => void salvarEstilo({ ...estilo, [key]: e.target.value })}
                  className="h-6 w-8 cursor-pointer rounded-mini border-0 bg-transparent p-0"
                />
              </label>
            ))}
          </div>
          <Switch
            ligado={estilo.highlight}
            aoMudar={(highlight) => void salvarEstilo({ ...estilo, highlight })}
          >
            Karaokê (destaque palavra a palavra)
          </Switch>
          <Botao
            tamanho="p"
            variante="secundario"
            onClick={() => void editor.store.definirEstiloPadraoLegenda()}
          >
            Usar como padrão do Projeto
          </Botao>
        </GrupoAjuste>
      )}

      {legendas && legendas.emojiRemoved > 0 && (
        <Status tom="info">
          {legendas.emojiRemoved} emoji(s) removido(s) da legenda para manter compatibilidade com a fonte.
        </Status>
      )}

      {missingGlyphs.length > 0 && (
        <div role="status" className="flex flex-col gap-2 rounded-controle bg-area p-2">
          <Status tom="aviso">Caracteres sem suporte na fonte ({missingGlyphs.length}):</Status>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {missingGlyphs.map((g) => (
              <li key={`${g.position}-${g.codepoint}`} className="num text-t2">
                “{g.word}” ({g.char} · {g.codepoint})
              </li>
            ))}
          </ul>
          {aoIrParaTranscricaoPalavra && (
            <Botao
              tamanho="p"
              variante="secundario"
              onClick={() => aoIrParaTranscricaoPalavra(missingGlyphs[0].position)}
            >
              Corrigir palavras na Transcrição
            </Botao>
          )}
        </div>
      )}

      {legendas && legendas.words.some((w) => w.position >= 0) && (
        <GrupoAjuste rotulo="Destaque da palavra selecionada">
          <Select<string>
            rotulo="Palavra para destaque"
            valor={posAtiva !== null ? String(posAtiva) : null}
            aoMudar={(v) => setPosicaoLocal(Number(v))}
            opcoes={legendas.words
              .filter((w) => w.position >= 0)
              .map((w) => ({ valor: String(w.position), rotulo: w.text.trim() || `#${w.position}` }))}
          />
          {palavraAtiva && palavraAtiva.position >= 0 && (
            <div className="flex flex-col gap-2 rounded-controle bg-area p-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-t2">
                  <span>Cor palavra</span>
                  <input
                    type="color"
                    aria-label="Cor da palavra selecionada"
                    value={palavraAtiva.overrides.color ?? estilo?.color ?? '#FFFFFF'}
                    onChange={(e) =>
                      void editor.store.sobrescreverPalavraLegenda(palavraAtiva.position, {
                        ...palavraAtiva.overrides,
                        color: e.target.value,
                      })
                    }
                    className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                </label>
                <label className="flex items-center gap-2 text-t2">
                  <span>Ativa</span>
                  <input
                    type="color"
                    aria-label="Cor ativa da palavra selecionada"
                    value={palavraAtiva.overrides.activeColor ?? estilo?.activeColor ?? '#FACC15'}
                    onChange={(e) =>
                      void editor.store.sobrescreverPalavraLegenda(palavraAtiva.position, {
                        ...palavraAtiva.overrides,
                        activeColor: e.target.value,
                      })
                    }
                    className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                </label>
              </div>
              <Switch
                ligado={palavraAtiva.overrides.highlight ?? true}
                aoMudar={(highlight) =>
                  void editor.store.sobrescreverPalavraLegenda(palavraAtiva.position, {
                    ...palavraAtiva.overrides,
                    highlight,
                  })
                }
              >
                Destacar palavra no karaokê
              </Switch>
              <Switch
                ligado={Boolean(palavraAtiva.overrides.hidden)}
                aoMudar={(hidden) =>
                  void editor.store.sobrescreverPalavraLegenda(palavraAtiva.position, {
                    ...palavraAtiva.overrides,
                    hidden,
                  })
                }
              >
                Ocultar na legenda
              </Switch>
              <Botao
                tamanho="p"
                variante="fantasma"
                onClick={() =>
                  void editor.store.sobrescreverPalavraLegenda(palavraAtiva.position, {})
                }
              >
                Limpar destaque
              </Botao>
            </div>
          )}
        </GrupoAjuste>
      )}

      {traducao && (
        <GrupoAjuste rotulo="Tradução (PT-BR ↔ EN)">
          {!traducao.permitted ? (
            <div className="flex flex-col gap-2 rounded-controle bg-area p-2">
              <Status tom="aviso">
                {traducao.permissionError?.message ??
                  'A Permissão desta Fonte não autoriza tradução.'}
              </Status>
              <a
                href={`#/projeto/${encodeURIComponent(projetoId)}/fontes/${traducao.sourceId}`}
                className="inline-flex min-h-6 items-center text-pequeno text-t1 underline hover:text-t2"
              >
                Revisar Permissão da Fonte
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Select<'pt-BR' | 'en'>
                rotulo="Idioma de destino"
                valor={idiomaAlvo}
                aoMudar={(v) => {
                  setIdiomaAlvo(v)
                  setEstimativa(null)
                }}
                opcoes={[
                  { valor: 'en', rotulo: 'Inglês (EN)' },
                  { valor: 'pt-BR', rotulo: 'Português (PT-BR)' },
                ]}
              />

              <div className="flex flex-wrap gap-2">
                <Botao
                  tamanho="p"
                  variante="secundario"
                  carregando={calculandoTraducao}
                  onClick={() => void calcularTraducao()}
                >
                  Calcular tradução
                </Botao>
                {estimativa && (
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    disabled={Boolean(destinoTraducao?.bloqueadoSomenteLocal) || iniciandoTraducao}
                    carregando={iniciandoTraducao}
                    onClick={aoClicarTraduzir}
                  >
                    Traduzir Corte
                  </Botao>
                )}
              </div>

              {estimativa && destinoTraducao && (
                <ResumoCustoPrivacidade
                  compacto
                  tarefa={`Tradução (${estimativa.sourceLanguage} → ${estimativa.targetLanguage})`}
                  perfil={destinoTraducao.perfil}
                  localidade={destinoTraducao.localidade}
                  saiDaMaquina={destinoTraducao.saiDaMaquina}
                  host={destinoTraducao.host}
                  estimativa={estimativaDs}
                  orcamento={
                    orcamento
                      ? {
                          restanteMicroUsd:
                            orcamento.maxCostMicroUsd != null
                              ? Math.max(0, orcamento.maxCostMicroUsd - orcamento.usage.microUsd)
                              : null,
                          callsRestantes:
                            orcamento.maxCalls != null
                              ? Math.max(0, orcamento.maxCalls - orcamento.usage.calls)
                              : null,
                          pausado: Boolean(orcamento.paused),
                        }
                      : null
                  }
                  bloqueadoSomenteLocal={destinoTraducao.bloqueadoSomenteLocal}
                />
              )}

              {(traducao.run?.state === 'running' || jobsTraducaoAtivos.length > 0) && (
                <Progresso
                  valor={
                    traducao.run && traducao.run.batchesTotal > 0
                      ? Math.round((traducao.run.batchesCompleted / traducao.run.batchesTotal) * 100)
                      : jobsTraducaoAtivos[0]?.percentual ?? null
                  }
                  rotulo="Traduzindo legendas…"
                />
              )}

              {((traducao.missingSentenceIds?.length ?? 0) > 0 ||
                (traducao.run?.batchesFailed ?? 0) > 0) && (
                <Status tom="aviso">Tradução parcial: algumas frases precisam de nova tentativa.</Status>
              )}

              {traducao.sentences.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {traducao.sentences.map((s) => {
                    const valor = rascunhosFrases[s.id] ?? s.translatedText ?? ''
                    return (
                      <li key={s.id} className="flex flex-col gap-1 rounded-controle bg-area p-2">
                        <span className="text-micro text-t3">{s.originalText}</span>
                        <div className="flex items-center gap-1.5">
                          <Entrada
                            tamanho="p"
                            aria-label={`Tradução da frase ${s.id}`}
                            value={valor}
                            onChange={(e) =>
                              setRascunhosFrases((prev) => ({
                                ...prev,
                                [s.id]: e.target.value,
                              }))
                            }
                            className="min-w-0 flex-1"
                          />
                          <Botao
                            tamanho="p"
                            variante="secundario"
                            onClick={() => void editor.store.editarTraducao(s.id, valor)}
                          >
                            Salvar frase {s.id}
                          </Botao>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </GrupoAjuste>
      )}

      <p className="text-micro text-t3">
        Estilo, destaques e tradução são salvos automaticamente fora do Desfazer da timeline.
      </p>

      <ConfirmDialog
        aberto={confirmarTraducao}
        aoMudarAberto={setConfirmarTraducao}
        titulo="Confirmar tradução do Corte"
        descricao="Esta ação envia o texto das Frases deste Corte ao Provedor configurado."
        rotuloConfirmar="Confirmar tradução"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={iniciandoTraducao}
        aoConfirmar={() => void executarTraducao(true)}
      >
        {estimativa && destinoTraducao && (
          <ResumoCustoPrivacidade
            compacto
            tarefa={`Tradução (${estimativa.sourceLanguage} → ${estimativa.targetLanguage})`}
            perfil={destinoTraducao.perfil}
            localidade={destinoTraducao.localidade}
            saiDaMaquina={destinoTraducao.saiDaMaquina}
            host={destinoTraducao.host}
            estimativa={estimativaDs}
            bloqueadoSomenteLocal={destinoTraducao.bloqueadoSomenteLocal}
          />
        )}
      </ConfirmDialog>
    </div>
  )
}
