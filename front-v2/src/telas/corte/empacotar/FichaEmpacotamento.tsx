import {
  AreaTexto,
  Botao,
  Campo,
  ChecklistGuardaCorpos,
  ConfirmDialog,
  Dica,
  Entrada,
  EstadoTela,
  FaixaJob,
  ResumoCustoPrivacidade,
  Select,
  Status,
  cn,
  type ItemGuarda,
  useToast,
} from '@ds'
import { Lock } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { ContadorLimite, contarBytesUtf8 } from '~/componentes/ContadorLimite'
import { ListaChips } from '~/componentes/ListaChips'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import {
  validarCapitulosTempoReal,
  type EmpacotamentoDoc,
  type GuardrailsDoc,
  type useEmpacotarCorte,
} from '~/stores/empacotarCorte'
import {
  converterEstimativa,
  normalizarIdioma,
  OPCOES_IDIOMA,
  type EstimativaProvedorBruta,
} from '~/telas/corte/transformar/PassoAngulo'
import { copiarTexto } from './dialogosNativos'
import { ErroEmpacotar } from './ErroEmpacotar'

type StoreEmpacotar = ReturnType<typeof useEmpacotarCorte>

export interface FichaEmpacotamentoProps {
  projetoId: string
  corteId: string
  fonteId: number | null
  fonteDisponivel: boolean
  store: StoreEmpacotar
  aoAbrirExportacao: () => void
  aoIrParaFonte: () => void
  aoIrParaTransformar: () => void
  aoIrParaMesaExportacao: () => void
}

/** Limites como o núcleo e o mock devolvem (a store tipa nomes diferentes). */
type LimitesLidos = {
  titleChars?: number
  descriptionBytes?: number
  tagsChars?: number
  tags?: number
  tagChars?: number
  hashtags?: number
  maxTags?: number
  tagTotalChars?: number
  maxHashtags?: number
}

/** Documento de `guardrails.check { scope: "single" }` além do que a store tipa. */
type GuardrailsSingle = GuardrailsDoc & {
  needsDirectNotice?: boolean
  videoKind?: 'direct' | 'transformed'
  over60s?: boolean
  permission?: { status?: string; who?: string | null; where?: string | null }
  script?: { applicable?: boolean; approved?: boolean; pendingBlocks?: number }
  narration?: {
    applicable?: boolean
    hasTts?: boolean
    voices?: string[]
    freezeTailUs?: number
    longFreezeTail?: boolean
  }
  audio?: { unverifiedCount?: number }
}

type AvisoCapitulo = { chave: string; mensagem: string }

interface RespostaEstimativaPacote {
  paid: boolean
  profile?: string
  language?: string
  estimate: EstimativaProvedorBruta
}

const DELIMITADORES = [
  ['--- Capítulos ---', '--- Fim dos capítulos ---'],
  ['--- Chapters ---', '--- End chapters ---'],
  ['<!-- clipes:chapters:start -->', '<!-- clipes:chapters:end -->'],
] as const

function temDelimitadores(descricao: string): boolean {
  return DELIMITADORES.some(([ini, fim]) => {
    const i = descricao.indexOf(ini)
    return i >= 0 && descricao.indexOf(fim, i + ini.length) >= 0
  })
}

const MENSAGEM_CAPITULOS_INDISPONIVEIS: Record<string, string> = {
  script_not_approved:
    'Aprove todos os blocos do Roteiro e gere ou grave a Narração para gerar os horários reais dos capítulos.',
  narration_required:
    'Aprove todos os blocos do Roteiro e gere ou grave a Narração para gerar os horários reais dos capítulos.',
  too_few_chapters: 'O YouTube exige pelo menos 3 capítulos com duração mínima de 10 s cada.',
}

const NOTA_IA =
  'Divulgação de conteúdo gerado por IA: obrigatória quando houver voz sintética realista imitando pessoa real ou cena realista gerada por IA; não obrigatória para roteiro, título ou legenda feitos com IA.'

function mesmosItens(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Coluna direita de Empacotar: ficha de publicação (título, descrição, capítulos, crédito protegido,
 * tags e hashtags) com validadores do YouTube não bloqueantes, Guardrails e ações de saída.
 */
export function FichaEmpacotamento({
  projetoId,
  corteId,
  fonteId,
  fonteDisponivel,
  store,
  aoAbrirExportacao,
  aoIrParaFonte,
  aoIrParaTransformar,
  aoIrParaMesaExportacao,
}: FichaEmpacotamentoProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const candidateId = store.candidateId ?? 0
  const doc = store.empacotamento as EmpacotamentoDoc | null
  const atual = doc?.current ?? null
  const rascunho = store.rascunho
  const guardrails = store.guardrails as GuardrailsSingle | null
  const limites = (doc?.limits ?? {}) as LimitesLidos
  const maxTitulo = limites.titleChars ?? 100
  const maxBytes = limites.descriptionBytes ?? 5000
  const maxTags = limites.tags ?? limites.maxTags ?? 30
  const maxTagChars = limites.tagChars ?? 60
  const maxTagsTotal = limites.tagsChars ?? limites.tagTotalChars ?? 500
  const maxHashtags = limites.hashtags ?? limites.maxHashtags ?? 15

  const [idioma, setIdioma] = useState<'pt-BR' | 'en' | null>(null)
  const [erroIdioma, setErroIdioma] = useState<string | null>(null)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [estimando, setEstimando] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [atualizandoCapitulos, setAtualizandoCapitulos] = useState(false)
  const [confirmacao, setConfirmacao] = useState<RespostaEstimativaPacote | null>(null)
  const [confirmandoAck, setConfirmandoAck] = useState(false)
  const idiomaRef = useRef<HTMLDivElement>(null)

  const idiomaEfetivo =
    idioma ?? normalizarIdioma(doc?.detectedLanguage) ?? normalizarIdioma(atual?.language)
  const languageRequired = Boolean(doc?.languageRequired)

  const textoDescricao = rascunho?.description ?? ''
  const creditText = doc?.credit.text ?? null
  const creditBytes = creditText ? contarBytesUtf8(creditText) + 2 : 0
  const bytesDescricao = contarBytesUtf8(textoDescricao) + creditBytes
  const tituloChars = [...(rascunho?.title ?? '')].length
  const tags = rascunho?.tags ?? []
  const hashtags = rascunho?.hashtags ?? []
  const tagsChars = tags.reduce((n, t) => n + [...t].length, 0)
  const ganchoChars = Math.min([...textoDescricao].length, 150)

  const tituloVazio = tituloChars === 0
  const tituloExcedido = tituloChars > maxTitulo
  const descricaoExcedida = bytesDescricao > maxBytes
  const tagsExcedidas = tags.length > maxTags || tagsChars > maxTagsTotal
  const hashtagsExcedidas = hashtags.length > maxHashtags
  const rascunhoInvalido =
    tituloVazio || tituloExcedido || descricaoExcedida || tagsExcedidas || hashtagsExcedidas

  const capitulos = doc?.chapters
  const capitulosAplicaveis = Boolean(capitulos?.applicable)
  const delimitadoresPresentes = capitulosAplicaveis ? temDelimitadores(textoDescricao) : false

  const avisosCapitulos = useMemo<AvisoCapitulo[]>(() => {
    if (!capitulosAplicaveis) return []
    const vistos = new Set<string>()
    const lista: AvisoCapitulo[] = []
    const empurrar = (chave: string, mensagem: string) => {
      if (vistos.has(mensagem)) return
      vistos.add(mensagem)
      lista.push({ chave, mensagem })
    }
    for (const e of validarCapitulosTempoReal(textoDescricao, null)) {
      empurrar(e.codigo, e.mensagem)
    }
    const doServidor = (capitulos as { editWarnings?: Array<{ code: string; message: string }> })
      ?.editWarnings
    for (const w of doServidor ?? []) {
      empurrar(w.code, w.message)
    }
    return lista
  }, [capitulos, capitulosAplicaveis, textoDescricao])

  const delimitadoresIncompletosOuAusentes =
    capitulosAplicaveis && textoDescricao.trim() !== '' && !delimitadoresPresentes

  const jobPacote = doc?.job ?? null
  const gerandoPacote =
    gerando || jobPacote?.state === 'running' || jobPacote?.state === 'queued'

  const destinoConfirmacao = confirmacao ? store.resolverDestino(confirmacao.profile) : null

  const dispararGeracao = async (confirmed: boolean) => {
    setErro(null)
    setGerando(true)
    try {
      await chamar('packaging.generate', {
        candidate: candidateId,
        ...(idiomaEfetivo ? { language: idiomaEfetivo } : {}),
        confirmed,
      })
      setConfirmacao(null)
      await store.recarregarEmpacotamento(candidateId)
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'confirmation_required' && !confirmed) {
        const est = await chamar<RespostaEstimativaPacote>('packaging.estimate', {
          candidate: candidateId,
          ...(idiomaEfetivo ? { language: idiomaEfetivo } : {}),
        }).catch(() => null)
        if (est) setConfirmacao(est)
        else setErro(err)
      } else {
        setConfirmacao(null)
        if (err.code === 'language_required') {
          setErroIdioma('Escolha o idioma do Corte (PT-BR ou EN) antes de sugerir o Empacotamento.')
          idiomaRef.current?.querySelector('button')?.focus()
        } else {
          setErro(err)
        }
      }
    } finally {
      setGerando(false)
    }
  }

  const sugerir = async () => {
    setErro(null)
    setErroIdioma(null)
    if (languageRequired && !idiomaEfetivo) {
      setErroIdioma('Escolha o idioma do Corte (PT-BR ou EN) antes de sugerir o Empacotamento.')
      idiomaRef.current?.querySelector('button')?.focus()
      return
    }
    setEstimando(true)
    try {
      const est = await chamar<RespostaEstimativaPacote>('packaging.estimate', {
        candidate: candidateId,
        ...(idiomaEfetivo ? { language: idiomaEfetivo } : {}),
      })
      const destino = store.resolverDestino(est.profile)
      if (est.paid || destino.localidade === 'cli' || destino.saiDaMaquina) {
        setConfirmacao(est)
        return
      }
      await dispararGeracao(false)
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'language_required') {
        setErroIdioma('Escolha o idioma do Corte (PT-BR ou EN) antes de sugerir o Empacotamento.')
        idiomaRef.current?.querySelector('button')?.focus()
      } else {
        setErro(err)
      }
    } finally {
      setEstimando(false)
    }
  }

  const salvar = async () => {
    if (!rascunho || !atual || !store.sujo || rascunhoInvalido || salvando) return
    setErro(null)
    setSalvando(true)
    try {
      const salvo = await chamar<EmpacotamentoDoc>('packaging.edit', {
        candidate: candidateId,
        title: rascunho.title,
        description: rascunho.description,
        tags: rascunho.tags,
        hashtags: rascunho.hashtags,
      })
      store.marcarSalvo(salvo)
      void store.recarregarGuardrails(candidateId)
      toastRef.current.add({ title: 'Alterações salvas' })
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setSalvando(false)
    }
  }

  const atualizarCapitulos = async () => {
    if (!rascunho || atualizandoCapitulos) return
    setErro(null)
    setAtualizandoCapitulos(true)
    try {
      const resposta = await chamar<EmpacotamentoDoc>('packaging.refresh_chapters', {
        candidate: candidateId,
        description: rascunho.description,
      })
      const novo = resposta?.current
      if (novo) {
        const restoIgual =
          novo.title === rascunho.title &&
          mesmosItens(novo.tags, rascunho.tags) &&
          mesmosItens(novo.hashtags, rascunho.hashtags)
        if (restoIgual) {
          store.marcarSalvo(resposta)
        } else {
          store.editarRascunho({ description: novo.description })
        }
      }
      toastRef.current.add({ title: 'Capítulos atualizados' })
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setAtualizandoCapitulos(false)
    }
  }

  const descricaoCompleta = (): string => {
    if (!store.sujo && atual?.fullDescription) return atual.fullDescription
    const base = textoDescricao.trimEnd()
    return creditText ? `${base}\n\n${creditText}` : base
  }

  const copiarDescricao = async () => {
    try {
      await copiarTexto(descricaoCompleta())
      toastRef.current.add({ title: 'Descrição copiada' })
    } catch (e) {
      setErro(paraErroCore(e))
    }
  }

  const confirmarCienciaDireto = async () => {
    if (confirmandoAck) return
    setConfirmandoAck(true)
    try {
      await chamar('guardrails.ack_direct_notice', {})
      await store.recarregarGuardrails(candidateId)
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setConfirmandoAck(false)
    }
  }

  const acoesRef = useRef({ sugerir, salvar, atualizarCapitulos })
  acoesRef.current = { sugerir, salvar, atualizarCapitulos }

  const atalhos = useMemo<Atalho[]>(
    () => [
      {
        id: 'corte.salvar',
        titulo: 'Salvar alterações da sub-aba ativa',
        grupo: 'Corte',
        tecla: 'Mod+S',
        executar: () => void acoesRef.current.salvar(),
      },
      {
        id: 'empacotar.sugerirPacote',
        titulo: 'Sugerir Empacotamento',
        grupo: 'Empacotar',
        executar: () => void acoesRef.current.sugerir(),
      },
      {
        id: 'empacotar.atualizarCapitulos',
        titulo: 'Atualizar capítulos',
        grupo: 'Empacotar',
        executar: () => void acoesRef.current.atualizarCapitulos(),
      },
    ],
    [],
  )
  useAtalhos(atalhos)

  const itensGuarda = useMemo<ItemGuarda[]>(() => {
    if (!guardrails) return []
    const itens: ItemGuarda[] = []
    const transformado = guardrails.videoKind === 'transformed'
    itens.push({
      id: 'tipo',
      estado: 'ok',
      titulo: transformado ? 'Vídeo transformado' : 'Corte direto',
      detalhe: 'Legenda, crop, filtros e trilha não contam como Transformação.',
    })
    const permitido = guardrails.permission?.status === 'granted'
    itens.push(
      permitido
        ? {
            id: 'permissao',
            estado: 'ok',
            titulo: 'Permissão registrada',
            detalhe: [guardrails.permission?.who, guardrails.permission?.where]
              .filter(Boolean)
              .join(' · '),
          }
        : {
            id: 'permissao',
            estado: 'atencao',
            titulo: 'Fonte sem Permissão registrada',
            detalhe: 'O crédito da Fonte não entra na descrição sem Permissão.',
            acao: { rotulo: 'Registrar Permissão', aoAcionar: aoIrParaFonte },
          },
    )
    if (transformado && guardrails.script?.applicable !== false) {
      const pendentes = guardrails.script?.pendingBlocks ?? 0
      itens.push(
        guardrails.script?.approved
          ? { id: 'roteiro', estado: 'ok', titulo: 'Roteiro aprovado' }
          : {
              id: 'roteiro',
              estado: 'pendente',
              titulo: 'Roteiro com blocos pendentes',
              detalhe: pendentes > 0 ? `${pendentes} bloco${pendentes === 1 ? '' : 's'} sem aprovação.` : undefined,
              acao: { rotulo: 'Ir para Transformar', aoAcionar: aoIrParaTransformar },
            },
      )
    }
    if (guardrails.narration?.applicable) {
      const sobra = guardrails.narration.freezeTailUs ?? 0
      itens.push({
        id: 'narracao',
        estado: guardrails.narration.longFreezeTail ? 'atencao' : 'ok',
        titulo: guardrails.narration.hasTts ? 'Narração com voz sintética' : 'Narração própria',
        detalhe: guardrails.narration.longFreezeTail
          ? `A sobra final do vídeo (imagem parada) tem ${Math.round(sobra / 1_000_000)} s, acima de 5 s.`
          : undefined,
      })
    }
    const semLicenca = guardrails.audio?.unverifiedCount ?? 0
    if (semLicenca > 0) {
      itens.push({
        id: 'audio',
        estado: 'atencao',
        titulo: `${semLicenca} faixa${semLicenca === 1 ? '' : 's'} de áudio sem licença registrada`,
        detalhe: 'Confirme a licença na aba Editar antes de publicar.',
      })
    }
    if (guardrails.over60s) {
      itens.push({
        id: 'duracao',
        estado: 'atencao',
        titulo: 'Duração acima de 60 s',
        detalhe:
          'Corte acima de 60 s: Shorts com mais de 1 minuto contendo música protegida ficam inelegíveis para monetização.',
      })
    }
    return itens
  }, [aoIrParaFonte, aoIrParaTransformar, guardrails])

  const enlaceFonte =
    fonteId != null ? `#/projeto/${encodeURIComponent(projetoId)}/fontes/${fonteId}` : `#/projeto/${encodeURIComponent(projetoId)}/fontes`

  const faixaIdealTitulo: [number, number] = [50, 70]

  return (
    <section
      aria-label="Ficha de Empacotamento"
      data-corte={corteId}
      className="mx-auto flex w-full max-w-[68ch] min-w-0 flex-col gap-4 p-4"
    >
      {erro && (
        <ErroEmpacotar
          erro={erro}
          acoes={{
            relocalizarFonte: aoIrParaFonte,
            focarCampo: () => idiomaRef.current?.querySelector('button')?.focus(),
            abrirFila: () => {
              window.location.hash = '#/fila'
            },
            irPara: (hash) => {
              window.location.hash = hash
            },
          }}
          aoDispensar={() => setErro(null)}
        />
      )}

      {store.conflitoRemoto && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-area bg-area px-3 py-2 text-pequeno">
          <span className="text-t2">
            A ficha mudou enquanto você editava. Escolha qual versão manter.
          </span>
          <Botao tamanho="p" variante="secundario" onClick={store.aceitarRemoto}>
            Usar versão nova
          </Botao>
          <Botao tamanho="p" variante="fantasma" onClick={store.manterRascunho}>
            Manter meu rascunho
          </Botao>
        </div>
      )}

      {gerandoPacote && (
        <FaixaJob
          rotulo="Sugerindo Empacotamento…"
          aoCancelar={
            jobPacote?.id != null
              ? () => {
                  void chamar('jobs.cancel', { id: jobPacote.id })
                    .then(() => store.recarregarEmpacotamento(candidateId))
                    .catch((e) => setErro(paraErroCore(e)))
                }
              : undefined
          }
        />
      )}

      {!atual ? (
        <div className="flex flex-col gap-3">
          <EstadoTela
            tipo="vazio"
            titulo="Nenhum texto de publicação gerado ainda."
            descricao="Peça uma sugestão ao Provedor para preencher título, descrição, tags e capítulos editáveis."
          />
          <div className="flex flex-wrap items-end gap-3">
            {languageRequired && (
              <div ref={idiomaRef} className="w-40">
                <Campo rotulo="Idioma" erro={erroIdioma ?? undefined}>
                  {(propsAria) => (
                    <Select
                      {...propsAria}
                      valor={idioma}
                      aoMudar={(v) => {
                        setIdioma(v)
                        setErroIdioma(null)
                      }}
                      opcoes={OPCOES_IDIOMA}
                      placeholder="Escolha"
                    />
                  )}
                </Campo>
              </div>
            )}
            <Botao
              variante="secundario"
              carregando={estimando}
              disabled={gerandoPacote}
              onClick={() => void sugerir()}
            >
              Sugerir Empacotamento
            </Botao>
            <Dica texto="Preencher manualmente ainda não está disponível.">
              <span tabIndex={0} aria-describedby="desc-preencher-manual" className="inline-flex">
                <Botao variante="fantasma" disabled>
                  Preencher manualmente
                </Botao>
              </span>
            </Dica>
            <span id="desc-preencher-manual" className="sr-only">
              Preencher manualmente ainda não está disponível.
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Botao
              variante="secundario"
              carregando={estimando}
              disabled={gerandoPacote}
              onClick={() => void sugerir()}
            >
              Sugerir novamente
            </Botao>
            <div ref={idiomaRef} className="w-40">
              <Campo rotulo="Idioma" erro={erroIdioma ?? undefined}>
                {(propsAria) => (
                  <Select
                    {...propsAria}
                    valor={idiomaEfetivo}
                    aoMudar={(v) => {
                      setIdioma(v)
                      setErroIdioma(null)
                    }}
                    opcoes={OPCOES_IDIOMA}
                    placeholder="Escolha"
                  />
                )}
              </Campo>
            </div>
            <Status tom={store.sujo ? 'pendente' : 'sucesso'} className="ml-auto">
              {store.sujo ? 'Alterações não salvas' : 'Salvo'}
            </Status>
          </div>
          <p className="text-pequeno text-t3">
            Sugestão gerada pelo Provedor — revise título, descrição e tags antes de publicar.
          </p>

          <Campo
            rotulo="Título"
            erro={
              tituloVazio
                ? 'O título não pode ficar vazio.'
                : tituloExcedido
                  ? `O título passa de ${maxTitulo} caracteres.`
                  : undefined
            }
          >
            {(propsAria) => (
              <Entrada
                {...propsAria}
                value={rascunho?.title ?? ''}
                onChange={(e) => store.editarRascunho({ title: e.target.value })}
              />
            )}
          </Campo>
          <ContadorLimite
            usado={tituloChars}
            maximo={maxTitulo}
            unidade="caracteres"
            faixaIdeal={faixaIdealTitulo}
          />
          <p className="-mt-2 text-pequeno text-t3">Faixa recomendada YouTube: 50–70 caracteres.</p>

          <Campo
            rotulo="Descrição"
            erro={descricaoExcedida ? `A descrição passa de ${maxBytes} bytes.` : undefined}
          >
            {(propsAria) => (
              <AreaTexto
                {...propsAria}
                rows={8}
                value={textoDescricao}
                onChange={(e) => store.editarRascunho({ description: e.target.value })}
              />
            )}
          </Campo>
          <div className="-mt-2 flex flex-col gap-1">
            <ContadorLimite usado={bytesDescricao} maximo={maxBytes} unidade="bytes" />
            <p className="num text-pequeno text-t3">
              Gancho inicial: {ganchoChars}/150 caracteres visíveis antes de “Mostrar mais”
            </p>
          </div>

          {capitulosAplicaveis && (
            <section aria-label="Capítulos" className="flex flex-col gap-2 rounded-area bg-area px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-medio text-t1">Capítulos</h3>
                {capitulos?.status === 'ready' && (
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    carregando={atualizandoCapitulos}
                    onClick={() => void atualizarCapitulos()}
                  >
                    Atualizar capítulos
                  </Botao>
                )}
              </div>
              {capitulos?.status !== 'ready' && (
                <div className="flex flex-col gap-1.5 text-pequeno text-t2">
                  <p>
                    {MENSAGEM_CAPITULOS_INDISPONIVEIS[capitulos?.status ?? ''] ??
                      capitulos?.generationWarning?.message ??
                      'Os capítulos automáticos ainda não estão disponíveis.'}
                  </p>
                  {(capitulos?.status === 'script_not_approved' ||
                    capitulos?.status === 'narration_required') && (
                    <div>
                      <Botao tamanho="p" variante="fantasma" onClick={aoIrParaTransformar}>
                        Ir para Transformar
                      </Botao>
                    </div>
                  )}
                </div>
              )}
              {delimitadoresIncompletosOuAusentes && (
                <p role="status" className="text-pequeno text-t2">
                  Os marcadores de capítulos foram removidos da descrição; restaure-os para atualizar
                  os capítulos automaticamente.
                </p>
              )}
              {avisosCapitulos.length > 0 && (
                <ul role="status" className="m-0 flex list-none flex-col gap-0.5 p-0 text-pequeno text-t2">
                  {avisosCapitulos.map((a) => (
                    <li key={a.chave + a.mensagem}>{a.mensagem}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {creditText !== null ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-pequeno text-t2">
                <Lock className="size-[13px] stroke-[1.75] text-t3" aria-hidden />
                <span id="rotulo-credito">
                  Crédito da Fonte (preenchido pela Permissão — não editável)
                </span>
              </div>
              <div
                role="textbox"
                tabIndex={0}
                aria-readonly="true"
                aria-multiline="true"
                aria-label="Crédito da Fonte (preenchido pela Permissão — não editável)"
                className="foco rounded-area bg-area px-3 py-2 text-t2"
              >
                {creditText}
              </div>
            </div>
          ) : (
            doc?.credit.warning === 'no_permission' && (
              <div role="alert" className="flex flex-col gap-1.5 rounded-area bg-area px-3 py-2.5 text-pequeno">
                <p className="text-t2">
                  Esta Fonte está sem Permissão registrada: nenhum crédito será incluído na descrição.
                </p>
                <a href={enlaceFonte} className="foco self-start text-t1 underline">
                  Registrar Permissão na Fonte
                </a>
              </div>
            )
          )}

          <div className="flex flex-col gap-1.5">
            <ListaChips
              rotulo="Tags"
              itens={tags}
              aoAlterar={(proximos) => store.editarRascunho({ tags: proximos })}
              maxItens={maxTags}
              maxCharsItem={maxTagChars}
              placeholder="Adicione uma tag e pressione Enter"
              desabilitado={salvando}
            />
            <div className="flex flex-wrap gap-3">
              <ContadorLimite usado={tags.length} maximo={maxTags} unidade="tags" />
              <ContadorLimite usado={tagsChars} maximo={maxTagsTotal} unidade="caracteres" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <ListaChips
              rotulo="Hashtags"
              itens={hashtags}
              aoAlterar={(proximos) => store.editarRascunho({ hashtags: proximos })}
              maxItens={maxHashtags}
              prefixo="#"
              placeholder="#hashtag e pressione Enter"
              ajuda="Recomendado: até 3 hashtags (o YouTube ignora todas se houver mais de 15)."
              desabilitado={salvando}
            />
            <span className={cn('num text-pequeno', hashtags.length > maxHashtags ? 'text-erro' : 'text-t3')}>
              {hashtags.length}/{maxHashtags} hashtags
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Botao
              variante="secundario"
              carregando={salvando}
              disabled={!store.sujo || rascunhoInvalido}
              onClick={() => void salvar()}
            >
              Salvar alterações
            </Botao>
            <Botao variante="fantasma" onClick={() => void copiarDescricao()}>
              Copiar descrição completa
            </Botao>
          </div>
        </>
      )}

      <div className="flex flex-col gap-3 border-t border-linha pt-4">
        <h3 className="text-base font-medio text-t1">Guardrails e saída</h3>
        {guardrails && (
          <ChecklistGuardaCorpos
            escopo="single"
            itens={itensGuarda}
            abertoPorPadrao
            mostrarDivulgacaoIa={Boolean(guardrails.narration?.hasTts)}
            aoConfirmarDireto={guardrails.needsDirectNotice ? confirmarCienciaDireto : undefined}
            confirmado={false}
          />
        )}
        <div role="note" className="rounded-controle bg-area px-3 py-2 text-pequeno text-t2">
          {NOTA_IA}
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao variante="secundario" disabled={!fonteDisponivel} onClick={aoAbrirExportacao}>
            Exportar vídeo (MP4)
          </Botao>
          <Botao variante="fantasma" onClick={aoIrParaMesaExportacao}>
            Ir para Mesa de Prontidão (Lote) →
          </Botao>
        </div>
      </div>

      <ConfirmDialog
        aberto={confirmacao !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !gerando) setConfirmacao(null)
        }}
        titulo="Confirmar sugestão de Empacotamento"
        descricao="Confira o Perfil de Provedor, o destino de privacidade e o custo estimado antes de gerar título, descrição e tags."
        rotuloConfirmar="Confirmar e sugerir"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={gerando}
        confirmarDesabilitado={Boolean(destinoConfirmacao?.bloqueadoSomenteLocal)}
        aoConfirmar={() => void dispararGeracao(true)}
      >
        {confirmacao && destinoConfirmacao && (
          <ResumoCustoPrivacidade
            tarefa="Sugestão de Empacotamento"
            perfil={destinoConfirmacao.perfil}
            localidade={destinoConfirmacao.localidade}
            saiDaMaquina={destinoConfirmacao.saiDaMaquina}
            host={destinoConfirmacao.host}
            estimativa={converterEstimativa(confirmacao.estimate)}
            orcamento={
              store.orcamento
                ? {
                    restanteMicroUsd: store.orcamento.remainingMicroUsd ?? null,
                    callsRestantes: store.orcamento.callsRemaining ?? null,
                    pausado: Boolean(store.orcamento.paused),
                  }
                : null
            }
            bloqueadoSomenteLocal={destinoConfirmacao.bloqueadoSomenteLocal}
          />
        )}
      </ConfirmDialog>
    </section>
  )
}
