import {
  BannerErroCore,
  Botao,
  Campo,
  ConfirmDialog,
  Entrada,
  EstadoTela,
  FaixaJob,
  Progresso,
  ResumoCustoPrivacidade,
  Select,
  Status,
  cn,
} from '@ds'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ListaChips } from '~/componentes/ListaChips'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila } from '~/core/progresso'
import { orcamentoParaResumo } from '~/stores/selecaoProjeto'
import type { AnguloItem, AngulosDoc, useTransformarCorte } from '~/stores/transformarCorte'

export type StoreTransformarPasso = Pick<
  ReturnType<typeof useTransformarCorte>,
  | 'angulos'
  | 'roteiro'
  | 'orcamento'
  | 'somenteLocal'
  | 'perfis'
  | 'recarregarAngulos'
  | 'recarregarRoteiro'
  | 'resolverDestino'
>

export interface AlvoRefsEmFoco {
  chave: string
  refs: number[]
  alternarId: (id: number) => void
}

export interface EstimativaProvedorBruta {
  kind: 'zero' | 'plan_quota' | 'unknown' | 'usd' | string
  minMicroUsd?: number | null
  maxMicroUsd?: number | null
  inputTokens?: number
}

export interface PassoAnguloProps {
  candidateId: number
  store: StoreTransformarPasso
  fila?: Fila
  modalPaiAberto?: boolean
  aoClicarChipFrase?: (fraseId: number) => void
  aoMudarRefEmFoco?: (alvo: AlvoRefsEmFoco | null) => void
  aoAvancarPasso?: () => void
}

interface RespostaEstimativaAngulos {
  paid: boolean
  profile?: string
  estimate: EstimativaProvedorBruta
}

type EscolhaPendente =
  | { tipo: 'sugestao'; generation: number | null; index: number; angle: AnguloItem }
  | { tipo: 'manual'; angle: AnguloItem }

export const OPCOES_IDIOMA = [
  { valor: 'pt-BR' as const, rotulo: 'PT-BR' },
  { valor: 'en' as const, rotulo: 'EN' },
]

export function normalizarIdioma(raw: string | null | undefined): 'pt-BR' | 'en' | null {
  if (!raw) return null
  const baixo = raw.toLowerCase()
  if (baixo.startsWith('pt')) return 'pt-BR'
  if (baixo.startsWith('en')) return 'en'
  return null
}

export function converterEstimativa(est: EstimativaProvedorBruta) {
  if (est.kind === 'usd') {
    return {
      kind: 'usd' as const,
      minMicroUsd: est.minMicroUsd ?? 0,
      maxMicroUsd: est.maxMicroUsd ?? 0,
      inputTokens: est.inputTokens,
    }
  }
  if (est.kind === 'plan_quota') return { kind: 'plan_quota' as const }
  if (est.kind === 'zero') return { kind: 'zero' as const }
  return { kind: 'unknown' as const }
}

export function parsearIdsFrase(itens: string[]): { ids: number[]; invalido: boolean } {
  const ids: number[] = []
  let invalido = false
  for (const item of itens) {
    const limpo = item.replace(/^#/, '').trim()
    if (!/^\d+$/.test(limpo)) {
      invalido = true
      continue
    }
    const num = Number(limpo)
    if (!Number.isInteger(num) || num <= 0) {
      invalido = true
      continue
    }
    if (!ids.includes(num)) ids.push(num)
  }
  return { ids, invalido }
}

function mesmoAngulo(a: AnguloItem | null | undefined, b: AnguloItem): boolean {
  if (!a) return false
  return a.name === b.name && a.promise === b.promise
}

/**
 * Passo 1 de Transformar: escolha/sugestão de Ângulo (com guarda de custo `<ResumoCustoPrivacidade>`),
 * formulário manual validado (`1..60` / `1..200`) e confirmação em `angle_change_confirmation`.
 */
export function PassoAngulo({
  candidateId,
  store,
  fila,
  modalPaiAberto = false,
  aoClicarChipFrase,
  aoMudarRefEmFoco,
  aoAvancarPasso,
}: PassoAnguloProps) {
  const jobs = useFila(fila)
  const angulos = store.angulos as (AngulosDoc & { generation?: number | null; busy?: boolean }) | null
  const roteiro = store.roteiro

  const languageRequired = Boolean(angulos?.languageRequired || roteiro?.languageRequired)
  const [idioma, setIdioma] = useState<'pt-BR' | 'en' | null>(() =>
    normalizarIdioma(angulos?.detectedLanguage ?? roteiro?.detectedLanguage),
  )
  const [erroIdioma, setErroIdioma] = useState<string | null>(null)

  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [estimando, setEstimando] = useState(false)
  const [confirmacaoGerar, setConfirmacaoGerar] = useState<RespostaEstimativaAngulos | null>(null)
  const [gerandoDisparo, setGerandoDisparo] = useState(false)

  const [manualAberto, setManualAberto] = useState(false)
  const [nomeManual, setNomeManual] = useState('')
  const [promessaManual, setPromessaManual] = useState('')
  const [publicoManual, setPublicoManual] = useState('')
  const [refsManual, setRefsManual] = useState<number[]>([])
  const [errosManual, setErrosManual] = useState<{
    nome?: string
    promessa?: string
    publico?: string
    refs?: string
  }>({})
  const [salvandoEscolha, setSalvandoEscolha] = useState(false)
  const [trocaPendente, setTrocaPendente] = useState<EscolhaPendente | null>(null)

  const selectIdiomaRef = useRef<HTMLDivElement | null>(null)
  const nomeRef = useRef<HTMLInputElement | null>(null)
  const promessaRef = useRef<HTMLInputElement | null>(null)
  const publicoRef = useRef<HTMLInputElement | null>(null)
  const aoMudarRefEmFocoRef = useRef(aoMudarRefEmFoco)
  aoMudarRefEmFocoRef.current = aoMudarRefEmFoco

  useEffect(() => {
    const detectado = normalizarIdioma(angulos?.detectedLanguage ?? roteiro?.detectedLanguage)
    if (detectado && !idioma) {
      setIdioma(detectado)
    }
  }, [angulos?.detectedLanguage, roteiro?.detectedLanguage, idioma])

  // Mantém o alvo de inserção de Frases sincronizado enquanto o formulário manual estiver aberto
  useEffect(() => {
    if (!manualAberto) {
      aoMudarRefEmFocoRef.current?.(null)
      return
    }
    aoMudarRefEmFocoRef.current?.({
      chave: 'angulo-manual',
      refs: refsManual,
      alternarId: (id) => {
        setRefsManual((atual) => {
          if (atual.includes(id)) {
            setErrosManual((e) => ({ ...e, refs: undefined }))
            return atual.filter((x) => x !== id)
          }
          if (atual.length >= 12) {
            setErrosManual((e) => ({ ...e, refs: 'Selecione no máximo 12 Frases de apoio.' }))
            return atual
          }
          setErrosManual((e) => ({ ...e, refs: undefined }))
          return [...atual, id]
        })
      },
    })
  }, [manualAberto, refsManual])

  useEffect(() => {
    return () => {
      aoMudarRefEmFocoRef.current?.(null)
    }
  }, [])

  const jobAnguloFila = useMemo(
    () =>
      jobs.find(
        (j) => j.etapa.startsWith('ai:angles:') && j.estado === 'rodando',
      ) ?? null,
    [jobs],
  )

  const gerandoAngulos =
    gerandoDisparo ||
    Boolean(angulos?.busy) ||
    angulos?.job?.state === 'running' ||
    angulos?.job?.state === 'queued' ||
    Boolean(jobAnguloFila)

  const jobIdAtivo = jobAnguloFila ? Number(jobAnguloFila.id) : angulos?.job?.id ?? null

  const cancelarGeracao = async () => {
    if (jobIdAtivo == null || !Number.isFinite(jobIdAtivo)) return
    setErroAcao(null)
    try {
      await chamar('jobs.cancel', { id: jobIdAtivo })
      await store.recarregarAngulos()
    } catch (e) {
      setErroAcao(paraErroCore(e))
    }
  }

  const dispararGeracao = async (confirmed: boolean) => {
    setErroAcao(null)
    setGerandoDisparo(true)
    try {
      await chamar('angles.generate', {
        candidate: candidateId,
        ...(idioma ? { language: idioma } : {}),
        confirmed,
      })
      setConfirmacaoGerar(null)
      await store.recarregarAngulos()
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'confirmation_required' && !confirmed) {
        const est = await chamar<RespostaEstimativaAngulos>('angles.estimate', {
          candidate: candidateId,
          ...(idioma ? { language: idioma } : {}),
        }).catch(() => null)
        if (est) {
          setConfirmacaoGerar(est)
        } else {
          setErroAcao(err)
        }
      } else {
        setConfirmacaoGerar(null)
        setErroAcao(err)
      }
    } finally {
      setGerandoDisparo(false)
    }
  }

  const aoClicarSugerir = async () => {
    setErroAcao(null)
    setErroIdioma(null)
    if (languageRequired && !idioma) {
      setErroIdioma('Escolha o idioma do Corte (PT-BR ou EN) antes de sugerir ângulos.')
      selectIdiomaRef.current?.querySelector('button')?.focus()
      return
    }
    setEstimando(true)
    try {
      const est = await chamar<RespostaEstimativaAngulos>('angles.estimate', {
        candidate: candidateId,
        ...(idioma ? { language: idioma } : {}),
      })
      const destino = store.resolverDestino(est.profile)
      if (est.paid || destino.localidade === 'cli' || destino.saiDaMaquina) {
        setConfirmacaoGerar(est)
        return
      }
      await dispararGeracao(false)
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'language_required') {
        setErroIdioma('Escolha o idioma do Corte (PT-BR ou EN) antes de sugerir ângulos.')
        selectIdiomaRef.current?.querySelector('button')?.focus()
      } else {
        setErroAcao(err)
      }
    } finally {
      setEstimando(false)
    }
  }

  const executarEscolha = async (escolha: EscolhaPendente, confirmed: boolean) => {
    setErroAcao(null)
    setSalvandoEscolha(true)
    try {
      const payload =
        escolha.tipo === 'sugestao' && escolha.generation
          ? {
              candidate: candidateId,
              generation: escolha.generation,
              index: escolha.index,
              ...(confirmed ? { confirmed: true } : {}),
            }
          : {
              candidate: candidateId,
              angle: escolha.angle,
              ...(confirmed ? { confirmed: true } : {}),
            }

      await chamar('angles.choose', payload)
      setTrocaPendente(null)
      await Promise.all([store.recarregarAngulos(), store.recarregarRoteiro()])
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'angle_change_confirmation' && !confirmed) {
        setTrocaPendente(escolha)
      } else if (err.code === 'angle_invalid') {
        setErroAcao(err)
        setManualAberto(true)
      } else {
        setTrocaPendente(null)
        setErroAcao(err)
      }
    } finally {
      setSalvandoEscolha(false)
    }
  }

  const aoSubmeterManual = () => {
    const nome = nomeManual.trim()
    const promessa = promessaManual.trim()
    const publico = publicoManual.trim()

    const novosErros: typeof errosManual = {}
    if (!nome) {
      novosErros.nome = 'Informe o nome do ângulo.'
    } else if ([...nome].length > 60) {
      novosErros.nome = 'O nome do ângulo deve ter no máximo 60 caracteres.'
    }

    if (!promessa) {
      novosErros.promessa = 'Informe a promessa em uma frase.'
    } else if (promessa.includes('\n')) {
      novosErros.promessa = 'A promessa deve caber em uma única linha.'
    } else if ([...promessa].length > 200) {
      novosErros.promessa = 'A promessa deve ter no máximo 200 caracteres.'
    }

    if ([...publico].length > 120) {
      novosErros.publico = 'O campo Para quem é deve ter no máximo 120 caracteres.'
    }

    if (refsManual.length > 12) {
      novosErros.refs = 'Selecione no máximo 12 Frases de apoio.'
    }

    setErrosManual(novosErros)
    if (novosErros.nome) {
      nomeRef.current?.focus()
      return
    }
    if (novosErros.promessa) {
      promessaRef.current?.focus()
      return
    }
    if (novosErros.publico) {
      publicoRef.current?.focus()
      return
    }
    if (novosErros.refs) {
      return
    }

    const angle: AnguloItem = {
      name: nome,
      promise: promessa,
      ...(publico ? { audience: publico } : {}),
      ...(refsManual.length > 0 ? { sentence_ids: refsManual } : {}),
    }

    void executarEscolha({ tipo: 'manual', angle }, false)
  }

  const aoAlterarChipsManual = (itens: string[]) => {
    const { ids, invalido } = parsearIdsFrase(itens)
    if (invalido) {
      setErrosManual((e) => ({ ...e, refs: 'Informe apenas IDs numéricos de Frase (ex.: #104).' }))
      return
    }
    setErrosManual((e) => ({ ...e, refs: undefined }))
    setRefsManual(ids)
  }

  const abertoManual = () => {
    setManualAberto(true)
    window.requestAnimationFrame(() => nomeRef.current?.focus())
  }

  const sugestoes = angulos?.angles ?? []
  const escolhido = angulos?.selected ?? null
  const generationAtual = angulos?.generation ?? (angulos?.generations?.length ? angulos.generations.length : null)
  const vazioInicial = !escolhido && sugestoes.length === 0 && !gerandoAngulos && !manualAberto
  const modalAberto = Boolean(modalPaiAberto || confirmacaoGerar !== null || trocaPendente !== null)
  const sugestoesRestantes = sugestoes
    .map((ang, idx) => ({ ang, idx }))
    .filter(({ ang }) => !mesmoAngulo(escolhido, ang))
  const temEscolhidoNasSugestoes = Boolean(escolhido && sugestoesRestantes.length < sugestoes.length)

  const destinoConfirmacao = confirmacaoGerar
    ? store.resolverDestino(confirmacaoGerar.profile)
    : null

  return (
    <div className="mx-auto flex w-full max-w-[68ch] flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-titulo font-forte tracking-[-0.01em] text-t1">
            1. Escolha o ângulo da Transformação
          </h2>
          <p className="mt-1 mb-0 text-base text-t2">
            Escolha a promessa central do Vídeo transformado. Ela guia o Roteiro, o título e a ideia de capa.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!vazioInicial && (
            <Botao
              variante={escolhido || modalAberto ? 'secundario' : 'primario'}
              carregando={estimando || gerandoAngulos}
              disabled={gerandoAngulos}
              onClick={() => void aoClicarSugerir()}
            >
              {sugestoes.length > 0 ? 'Sugerir novos ângulos' : 'Sugerir ângulos'}
            </Botao>
          )}
          {escolhido && aoAvancarPasso && (
            <Botao variante={modalAberto ? 'secundario' : 'primario'} onClick={aoAvancarPasso}>
              Avançar para Roteiro <ChevronRight aria-hidden />
            </Botao>
          )}
        </div>
      </header>

      {languageRequired && (
        <div ref={selectIdiomaRef} className="rounded-area bg-area p-3">
          <Campo
            rotulo="Idioma do Corte"
            ajuda="O idioma deste Corte não ficou claro na Transcrição; escolha em que idioma gerar."
            erro={erroIdioma ?? undefined}
          >
            {(props) => (
              <Select
                {...props}
                valor={idioma}
                opcoes={OPCOES_IDIOMA}
                placeholder="Escolha o idioma"
                aoMudar={(v) => {
                  setIdioma(v)
                  setErroIdioma(null)
                }}
              />
            )}
          </Campo>
        </div>
      )}

      {erroAcao && (
        <BannerErroCore
          erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
          traduzir={(code) => ({
            titulo: mensagemDeErro(new ErroCore(code, erroAcao.detalhe)).titulo,
          })}
          aoDispensar={() => setErroAcao(null)}
          permitirRelato
        />
      )}

      {gerandoAngulos && (
        <FaixaJob
          rotulo="Sugerindo ângulos…"
          detalhe={jobAnguloFila?.mensagem}
          aoCancelar={jobIdAtivo != null ? () => void cancelarGeracao() : undefined}
        >
          <Progresso
            valor={jobAnguloFila?.percentual ?? null}
            rotulo="Progresso da sugestão de ângulos"
            compacto
          />
        </FaixaJob>
      )}

      {escolhido && (
        <section
          aria-label="Ângulo escolhido"
          className="marcado flex flex-col gap-2 rounded-area bg-elevado p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Status tom="sucesso" forte>
              Ângulo escolhido
            </Status>
            {escolhido.audience && (
              <span className="text-pequeno text-t3">Público: {escolhido.audience}</span>
            )}
          </div>
          <h3 className="m-0 text-base font-forte text-t1">{escolhido.name}</h3>
          <p className="m-0 text-base text-t2">{escolhido.promise}</p>
          {escolhido.sentence_ids && escolhido.sentence_ids.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-pequeno text-t3">Frases vinculadas:</span>
              {escolhido.sentence_ids.map((id) => (
                <Botao
                  key={id}
                  tamanho="p"
                  variante="suave"
                  className="num"
                  onClick={() => aoClicarChipFrase?.(id)}
                >
                  #{id}
                </Botao>
              ))}
            </div>
          )}
        </section>
      )}

      {vazioInicial && (
        <div className="flex flex-col items-center gap-3">
          <EstadoTela
            tipo="vazio"
            titulo="Nenhum ângulo sugerido ainda"
            descricao="Peça sugestões ao Provedor ou escreva o seu próprio ângulo."
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Botao
              variante={modalAberto ? 'secundario' : 'primario'}
              carregando={estimando || gerandoAngulos}
              disabled={gerandoAngulos}
              onClick={() => void aoClicarSugerir()}
            >
              Sugerir ângulos
            </Botao>
            <Botao variante="fantasma" onClick={abertoManual}>
              Escrever meu próprio ângulo
            </Botao>
          </div>
        </div>
      )}

      {sugestoesRestantes.length > 0 && (
        <section aria-label="Sugestões do Provedor" className="flex flex-col gap-2">
          <h3 className="m-0 text-pequeno font-medio text-t2">
            {temEscolhidoNasSugestoes
              ? `Outras sugestões do Provedor (${sugestoesRestantes.length})`
              : `Sugestões do Provedor (${sugestoesRestantes.length})`}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sugestoesRestantes.map(({ ang, idx }) => (
              <li
                key={`${ang.name}-${idx}`}
                className="flex flex-col gap-2 rounded-area bg-area p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong className="text-base font-forte text-t1">{ang.name}</strong>
                  {ang.audience && (
                    <span className="text-pequeno text-t3">Público: {ang.audience}</span>
                  )}
                </div>
                <p className="m-0 text-base text-t2">{ang.promise}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ang.sentence_ids?.map((id) => (
                      <Botao
                        key={id}
                        tamanho="p"
                        variante="suave"
                        className="num"
                        onClick={() => aoClicarChipFrase?.(id)}
                      >
                        #{id}
                      </Botao>
                    ))}
                  </div>
                  <Botao
                    variante="secundario"
                    tamanho="p"
                    disabled={salvandoEscolha}
                    onClick={() =>
                      void executarEscolha(
                        { tipo: 'sugestao', generation: generationAtual, index: idx, angle: ang },
                        false,
                      )
                    }
                  >
                    Escolher este ângulo
                  </Botao>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!vazioInicial && (
        <details
          open={manualAberto}
          onToggle={(e) => setManualAberto((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-area bg-area p-3"
        >
          <summary className="foco cursor-pointer list-none text-base font-medio text-t1 select-none">
            Escrever meu próprio ângulo
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            <Campo
              rotulo="Nome do ângulo"
              extra={`${[...nomeManual].length}/60`}
              erro={errosManual.nome}
            >
              {(props) => (
                <Entrada
                  {...props}
                  ref={nomeRef}
                  value={nomeManual}
                  placeholder="Ex.: O custo escondido da escolha"
                  onChange={(e) => {
                    setNomeManual(e.target.value)
                    if (errosManual.nome) setErrosManual((prev) => ({ ...prev, nome: undefined }))
                  }}
                />
              )}
            </Campo>

            <Campo
              rotulo="Promessa em uma frase"
              extra={`${[...promessaManual].length}/200`}
              erro={errosManual.promessa}
            >
              {(props) => (
                <Entrada
                  {...props}
                  ref={promessaRef}
                  value={promessaManual}
                  placeholder="Uma frase única explicando o ganho para quem assiste"
                  onChange={(e) => {
                    setPromessaManual(e.target.value)
                    if (errosManual.promessa) {
                      setErrosManual((prev) => ({ ...prev, promessa: undefined }))
                    }
                  }}
                />
              )}
            </Campo>

            <Campo
              rotulo="Para quem é (opcional)"
              extra={`${[...publicoManual].length}/120`}
              erro={errosManual.publico}
            >
              {(props) => (
                <Entrada
                  {...props}
                  ref={publicoRef}
                  value={publicoManual}
                  placeholder="Ex.: iniciantes que tomam decisões rápidas"
                  onChange={(e) => {
                    setPublicoManual(e.target.value)
                    if (errosManual.publico) {
                      setErrosManual((prev) => ({ ...prev, publico: undefined }))
                    }
                  }}
                />
              )}
            </Campo>

            <ListaChips
              rotulo="Frases de apoio (opcional)"
              itens={refsManual.map((id) => `#${id}`)}
              maxItens={12}
              prefixo="#"
              placeholder="Digite o ID (ex.: 104) e pressione Enter"
              ajuda="Até 12 Frases. Você também pode clicar nas Frases no painel Transcrição do Corte."
              erro={errosManual.refs}
              aoClicarChip={(chip) => {
                const n = Number(chip.replace(/^#/, ''))
                if (Number.isInteger(n) && n > 0) aoClicarChipFrase?.(n)
              }}
              aoAlterar={aoAlterarChipsManual}
            />

            <div className="flex justify-end">
              <Botao
                variante="secundario"
                carregando={salvandoEscolha}
                onClick={aoSubmeterManual}
              >
                Usar meu ângulo
              </Botao>
            </div>
          </div>
        </details>
      )}

      <ConfirmDialog
        aberto={confirmacaoGerar !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !gerandoDisparo) setConfirmacaoGerar(null)
        }}
        titulo="Confirmar sugestão de ângulos"
        descricao="Confira o Perfil de Provedor, destino de privacidade e custo estimado antes de gerar sugestões."
        rotuloConfirmar="Confirmar e sugerir"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={gerandoDisparo}
        confirmarDesabilitado={Boolean(destinoConfirmacao?.bloqueadoSomenteLocal)}
        aoConfirmar={() => void dispararGeracao(true)}
      >
        {confirmacaoGerar && destinoConfirmacao && (
          <ResumoCustoPrivacidade
            tarefa="Sugestão de ângulos"
            perfil={destinoConfirmacao.perfil}
            localidade={destinoConfirmacao.localidade}
            saiDaMaquina={destinoConfirmacao.saiDaMaquina}
            host={destinoConfirmacao.host}
            estimativa={converterEstimativa(confirmacaoGerar.estimate)}
            orcamento={orcamentoParaResumo(store.orcamento)}
            bloqueadoSomenteLocal={destinoConfirmacao.bloqueadoSomenteLocal}
          />
        )}
      </ConfirmDialog>

      <ConfirmDialog
        aberto={trocaPendente !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !salvandoEscolha) setTrocaPendente(null)
        }}
        titulo="Trocar ângulo do Corte?"
        descricao="Já existe um Roteiro gerado para este Corte. Ao trocar o ângulo, os blocos do Roteiro ficarão desatualizados e voltarão para Pendente para sua revisão."
        rotuloConfirmar="Trocar ângulo"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={salvandoEscolha}
        aoConfirmar={() => {
          if (trocaPendente) {
            void executarEscolha(trocaPendente, true)
          }
        }}
      />
    </div>
  )
}
