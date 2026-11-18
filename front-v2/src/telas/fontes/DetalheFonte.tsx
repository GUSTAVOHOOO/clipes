import {
  BannerErroCore,
  Botao,
  ConfirmDialog,
  Dialogo,
  Esqueleto,
  EstadoTela,
  Select,
  Status,
  tcLongo,
  useToast,
} from '@ds'
import { ArrowLeft, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CampoPermissao, permissaoValida } from '~/componentes/CampoPermissao'
import { PlayerReferenciaFonte } from '~/componentes/PlayerReferenciaFonte'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import type {
  FonteProjeto,
  PermissaoFonte,
  TranscriptStatusFonte,
} from '~/stores/fontesProjeto'
import {
  IDIOMAS_FALLBACK,
  basenameCaminho,
  opcoesIdiomaDe,
  type IdiomaOpcao,
} from '~/telas/fontes/EntradaFonte'
import { LeitorTranscricao } from '~/telas/fontes/LeitorTranscricao'
import { PainelMotorSinais, type MotorEscolha } from '~/telas/fontes/PainelMotorSinais'

export type DetalheFonteProps = {
  projetoId: string
  projetoPath: string | null
  fonteId: string
  frase?: number
  row?: number
}

function formatarCabecalhoMeta(fonte: FonteProjeto): string {
  const seg = Number(fonte.metadata?.format?.duration ?? 0)
  const durUs = Number.isFinite(seg) && seg > 0 ? Math.round(seg * 1_000_000) : 0
  const video = fonte.metadata?.streams?.find((s) => s.codec_type === 'video')
  const audio = fonte.metadata?.streams?.find(
    (s) => s.codec_type === 'audio' && s.index === fonte.audio_track,
  )
  const res = video?.height ? `${video.height}p` : null
  const faixaTitulo = audio?.tags?.title ? ` (${audio.tags.title})` : ''
  const faixa = `Faixa ${fonte.audio_track}${faixaTitulo}`
  return [durUs > 0 ? tcLongo(durUs) : null, res, faixa].filter(Boolean).join(' · ')
}

/** Tela 3 — Detalhe da Fonte, Motor, Blocos, Sinais e Leitor Virtualizado (`#/projeto/:id/fontes/:fonteId`). */
export function DetalheFonte({
  projetoId,
  projetoPath,
  fonteId,
  frase,
  row,
}: DetalheFonteProps) {
  const forcado = useEstadoForcado()
  const toast = useToast()
  const encProjeto = encodeURIComponent(projetoId)

  const [carregando, setCarregando] = useState(true)
  const [erroFatal, setErroFatal] = useState<ErroCore | null>(null)
  const [erroLeitor, setErroLeitor] = useState<ErroCore | null>(null)
  const [fonte, setFonte] = useState<FonteProjeto | null>(null)
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatusFonte | null>(null)
  const [localOnly, setLocalOnly] = useState(false)
  const [idiomas, setIdiomas] = useState<IdiomaOpcao[]>(IDIOMAS_FALLBACK)
  const [blocosCount, setBlocosCount] = useState(0)

  const [seekUs, setSeekUs] = useState<number | null>(null)
  const [tempoAtualUs, setTempoAtualUs] = useState(0)

  // Modais do cabeçalho (Permissão, Relocalizar, Verificar hash)
  const [editandoPerm, setEditandoPerm] = useState(false)
  const [permDraft, setPermDraft] = useState<PermissaoFonte>({ status: 'none' })
  const [salvandoPerm, setSalvandoPerm] = useState(false)

  const [relocalizando, setRelocalizando] = useState(false)
  const [caminhoRelocalizar, setCaminhoRelocalizar] = useState('')
  const [ocupadoIntegridade, setOcupadoIntegridade] = useState(false)
  const [confirmacaoIntegridade, setConfirmacaoIntegridade] = useState<
    { tipo: 'relocate'; path: string } | { tipo: 'hash' } | null
  >(null)

  const motorRef = useRef<HTMLButtonElement | null>(null)
  const iniciarTranscricaoRef = useRef<((opcoes?: { engine?: MotorEscolha }) => Promise<void>) | null>(null)
  const redirecionadoRef = useRef(false)
  const toastRef = useRef(toast)
  toastRef.current = toast

  const carregarTudo = useCallback(async () => {
    if (!projetoPath) return
    const idNum = Number(fonteId)
    setCarregando(true)
    setErroFatal(null)

    try {
      const [lista, localOnlyRes, langsRes] = await Promise.all([
        chamar<FonteProjeto[]>('sources.list', { project: projetoPath }),
        chamar<{ enabled?: boolean }>('projects.local_only.get', {}).catch(() => ({
          enabled: false,
        })),
        chamar<IdiomaOpcao[]>('channel_profile.languages', {}).catch(() => IDIOMAS_FALLBACK),
      ])

      const encontrada = Array.isArray(lista)
        ? lista.find((f) => f.id === idNum) ?? null
        : null

      if (!encontrada) {
        if (!redirecionadoRef.current && forcado !== 'carregando' && forcado !== 'erro') {
          redirecionadoRef.current = true
          toastRef.current.add({
            type: 'aviso',
            title: 'A Fonte selecionada não foi encontrada neste Projeto.',
          })
          window.location.hash = `#/projeto/${encProjeto}/fontes`
        }
        setFonte(null)
        setCarregando(false)
        return
      }

      setFonte(encontrada)
      setLocalOnly(Boolean(localOnlyRes?.enabled))
      if (Array.isArray(langsRes) && langsRes.length > 0) setIdiomas(langsRes)

      const [st, bl] = await Promise.all([
        chamar<TranscriptStatusFonte>('transcription.status', { source_id: encontrada.id }),
        chamar<Array<unknown>>('transcription.blocks', { source_id: encontrada.id }).catch(
          () => [],
        ),
      ])
      setTranscriptStatus(st)
      setBlocosCount(Array.isArray(bl) ? bl.length : 0)
    } catch (err) {
      setErroFatal(paraErroCore(err))
    } finally {
      setCarregando(false)
    }
  }, [encProjeto, fonteId, forcado, projetoPath])

  const atualizarStatus = useCallback(async () => {
    if (!fonte) return
    try {
      const [st, bl] = await Promise.all([
        chamar<TranscriptStatusFonte>('transcription.status', { source_id: fonte.id }),
        chamar<Array<unknown>>('transcription.blocks', { source_id: fonte.id }).catch(
          () => [],
        ),
      ])
      setTranscriptStatus(st)
      setBlocosCount(Array.isArray(bl) ? bl.length : 0)
    } catch {
      // mantém estado anterior
    }
  }, [fonte])

  useEffect(() => {
    redirecionadoRef.current = false
    void carregarTudo()
  }, [carregarTudo])

  const opcoesIdioma = useMemo(() => opcoesIdiomaDe(idiomas), [idiomas])

  const fonteEfetiva = useMemo(() => {
    if (!fonte) return null
    if (forcado === 'offline') {
      return { ...fonte, status: 'offline' as const, available: false }
    }
    return fonte
  }, [fonte, forcado])

  const statusEfetivo = useMemo<TranscriptStatusFonte | null>(() => {
    if (!fonte) return transcriptStatus
    if (forcado === 'vazio') {
      return { language: fonte.language, transcript: null, job: null }
    }
    return transcriptStatus
  }, [fonte, forcado, transcriptStatus])

  const alterarIdioma = async (novoIdioma: string) => {
    if (!fonte || !projetoPath) return
    setErroLeitor(null)
    try {
      const atualizada = await chamar<FonteProjeto>('sources.language.set', {
        project: projetoPath,
        id: fonte.id,
        language: novoIdioma,
      })
      setFonte(atualizada ?? { ...fonte, language: novoIdioma })
      toast.add({ title: 'Idioma da Fonte atualizado.' })
    } catch (err) {
      setErroLeitor(paraErroCore(err))
    }
  }

  const salvarPermissao = async () => {
    if (!fonte || !projetoPath || !permissaoValida(permDraft)) return
    setSalvandoPerm(true)
    setErroLeitor(null)
    try {
      const atualizada = await chamar<FonteProjeto>('sources.permission.set', {
        project: projetoPath,
        id: fonte.id,
        permission: permDraft,
      })
      setFonte(atualizada ?? { ...fonte, permission: permDraft })
      setEditandoPerm(false)
      toast.add({ title: 'Permissão da Fonte atualizada.' })
    } catch (err) {
      setErroLeitor(paraErroCore(err))
    } finally {
      setSalvandoPerm(false)
    }
  }

  const executarHash = async (confirmed: boolean) => {
    if (!fonte || !projetoPath) return
    setOcupadoIntegridade(true)
    setErroLeitor(null)
    try {
      await chamar('sources.hash', {
        project: projetoPath,
        id: fonte.id,
        job: 'source-hash',
        ...(confirmed ? { confirmed: true } : {}),
      })
      setConfirmacaoIntegridade(null)
      await carregarTudo()
      toast.add({ title: 'Identidade da Fonte verificada.' })
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'confirmation_required' && !confirmed) {
        setConfirmacaoIntegridade({ tipo: 'hash' })
      } else {
        setErroLeitor(e)
      }
    } finally {
      setOcupadoIntegridade(false)
    }
  }

  const executarRelocalizar = async (path: string, confirmed: boolean) => {
    if (!fonte || !projetoPath) return
    setOcupadoIntegridade(true)
    setErroLeitor(null)
    try {
      await chamar('sources.relocate', {
        project: projetoPath,
        id: fonte.id,
        path,
        job: 'source-relocate',
        ...(confirmed ? { confirmed: true } : {}),
      })
      setRelocalizando(false)
      setConfirmacaoIntegridade(null)
      await carregarTudo()
      toast.add({ title: 'Fonte relocalizada com sucesso.' })
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'confirmation_required' && !confirmed) {
        setRelocalizando(false)
        setConfirmacaoIntegridade({ tipo: 'relocate', path })
      } else {
        setErroLeitor(e)
      }
    } finally {
      setOcupadoIntegridade(false)
    }
  }

  const submeterRelocalizar = (e: FormEvent) => {
    e.preventDefault()
    if (!caminhoRelocalizar.trim()) return
    void executarRelocalizar(caminhoRelocalizar.trim(), false)
  }

  const retomarParcial = async () => {
    if (!fonte || !projetoPath || !statusEfetivo?.transcript) return
    setErroLeitor(null)
    const engine: MotorEscolha = statusEfetivo.transcript.engine === 'groq' ? 'groq' : 'local'
    await iniciarTranscricaoRef.current?.({ engine })
  }

  if (forcado === 'carregando' || carregando) {
    return (
      <div
        role="status"
        aria-label="Carregando detalhes da Fonte"
        aria-busy="true"
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <h1 className="sr-only">Detalhe da Fonte</h1>
        <div className="rounded-area bg-area p-3">
          <Esqueleto variante="linha" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className="flex w-full flex-col gap-3 lg:w-[38%] lg:max-w-[440px]">
            <div className="rounded-area bg-area p-3">
              <Esqueleto variante="painel" />
            </div>
            <div className="rounded-area bg-area p-3">
              <Esqueleto variante="painel" />
            </div>
          </div>
          <div className="min-w-0 flex-1 rounded-area bg-area p-3">
            <Esqueleto variante="transcricao" quantidade={6} />
          </div>
        </div>
      </div>
    )
  }

  const erroExibido =
    erroFatal ??
    (forcado === 'erro'
      ? new ErroCore('out_of_memory', 'Simulação de erro via ?estado=erro.')
      : null)

  if (erroExibido) {
    const trad = mensagemDeErro(erroExibido)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <h1 className="sr-only">Detalhe da Fonte</h1>
        <div>
          <Botao
            variante="fantasma"
            tamanho="p"
            icone={<ArrowLeft />}
            onClick={() => {
              window.location.hash = `#/projeto/${encProjeto}/fontes`
            }}
          >
            Voltar para Fontes
          </Botao>
        </div>
        <BannerErroCore
          erro={{
            code: erroExibido.code,
            message: erroExibido.detalhe || erroExibido.message,
          }}
          traduzir={() => ({ titulo: trad.titulo })}
          acaoRecuperacao={
            trad.recuperacao?.rota
              ? {
                  rotulo: trad.recuperacao.rotulo,
                  aoAcionar: () => {
                    window.location.hash = trad.recuperacao!.rota!
                  },
                }
              : { rotulo: 'Tentar novamente', aoAcionar: () => void carregarTudo() }
          }
          permitirRelato
        />
      </div>
    )
  }

  if (!fonteEfetiva || !projetoPath) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <h1 className="sr-only">Detalhe da Fonte</h1>
      </div>
    )
  }

  const nomeFonte = basenameCaminho(fonteEfetiva.path)
  const metaTexto = formatarCabecalhoMeta(fonteEfetiva)
  const transcript = statusEfetivo?.transcript ?? null
  const job = statusEfetivo?.job ?? null
  const transcricaoRodando = job?.state === 'queued' || job?.state === 'running'
  const pronta = transcript?.state === 'complete'
  const idiomaTravado =
    Boolean(transcript && (transcript.resume_us > 0 || transcript.state === 'complete')) ||
    transcricaoRodando
  const temTraducao =
    fonteEfetiva.permission.status === 'granted' &&
    fonteEfetiva.permission.scope.toLowerCase().includes('tradu')

  const seg = Number(fonteEfetiva.metadata?.format?.duration ?? 0)
  const duracaoTotalUs =
    transcript?.duration_us && transcript.duration_us > 0
      ? transcript.duration_us
      : Number.isFinite(seg) && seg > 0
        ? Math.round(seg * 1_000_000)
        : 0
  const totalBlocos = Math.max(1, Math.ceil(duracaoTotalUs / 600_000_000))
  const parcial =
    forcado === 'parcial' ||
    Boolean(transcript && transcript.state === 'running' && transcript.resume_us > 0 && !transcricaoRodando)

  const scrollPara = frase != null || row != null ? { frase, row } : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Cabeçalho da Fonte */}
      <header className="flex flex-wrap items-center gap-2.5 border-b border-linha pb-2.5">
        <Botao
          variante="fantasma"
          tamanho="p"
          icone={<ArrowLeft />}
          onClick={() => {
            window.location.hash = `#/projeto/${encProjeto}/fontes`
          }}
        >
          Fontes
        </Botao>

        <h1
          className="min-w-0 truncate text-titulo font-forte tracking-[-0.01em] text-t1"
          title={fonteEfetiva.path}
        >
          {nomeFonte}
        </h1>

        {metaTexto && <span className="num text-pequeno text-t3">{metaTexto}</span>}

        {fonteEfetiva.status === 'available' ? (
          <Status tom="sucesso">Disponível</Status>
        ) : fonteEfetiva.status === 'offline' ? (
          <Status tom="aviso">Offline</Status>
        ) : (
          <Status tom="aviso">Alterada</Status>
        )}

        {fonteEfetiva.status === 'offline' && (
          <Botao
            variante="secundario"
            tamanho="p"
            icone={<Wrench />}
            onClick={() => {
              setCaminhoRelocalizar('')
              setRelocalizando(true)
            }}
          >
            Relocalizar arquivo
          </Botao>
        )}

        {(fonteEfetiva.status === 'changed' || !fonteEfetiva.verified) &&
          fonteEfetiva.status !== 'offline' && (
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<RefreshCw />}
              carregando={ocupadoIntegridade}
              onClick={() => void executarHash(false)}
            >
              Verificar identidade
            </Botao>
          )}

        <div className="w-36 shrink-0">
          <Select
            valor={fonteEfetiva.language}
            aoMudar={(v) => void alterarIdioma(v)}
            opcoes={opcoesIdioma}
            rotulo="Idioma da Fonte"
            desabilitado={idiomaTravado}
            className="w-36 min-w-36"
          />
        </div>

        <Botao
          variante="fantasma"
          tamanho="p"
          icone={<ShieldCheck />}
          onClick={() => {
            setPermDraft(fonteEfetiva.permission)
            setEditandoPerm(true)
          }}
        >
          {fonteEfetiva.permission.status === 'granted'
            ? temTraducao
              ? 'Permissão: Autorizada (tradução)'
              : 'Permissão: Autorizada'
            : 'Permissão: Sem permissão'}
        </Botao>

        <Botao
          variante={pronta ? 'primario' : 'secundario'}
          className="ml-auto"
          disabled={!pronta}
          onClick={() => {
            window.location.hash = `#/projeto/${encProjeto}/cortes?fonte=${fonteEfetiva.id}`
          }}
        >
          Selecionar Cortes →
        </Botao>
      </header>

      {/* Corpo em 2 colunas com rolagem interna própria */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
        <aside
          aria-label="Motor, blocos e sinais"
          className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto lg:w-[38%] lg:max-w-[440px]"
        >
          <PainelMotorSinais
            projetoPath={projetoPath}
            fonte={fonteEfetiva}
            transcriptStatus={statusEfetivo}
            localOnly={localOnly}
            aoAtualizarStatus={atualizarStatus}
            aoPedirRelocalizacao={() => {
              if (fonteEfetiva.status === 'offline') {
                setCaminhoRelocalizar('')
                setRelocalizando(true)
              } else {
                void executarHash(false)
              }
            }}
            aoFocarMotorRef={motorRef}
            aoRegistrarIniciarRef={iniciarTranscricaoRef}
          />
        </aside>

        <section
          aria-label="Leitor da Transcrição"
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden"
        >
          {erroLeitor && (
            <BannerErroCore
              erro={{
                code: erroLeitor.code,
                message: erroLeitor.detalhe || erroLeitor.message,
              }}
              traduzir={() => ({ titulo: mensagemDeErro(erroLeitor).titulo })}
              aoDispensar={() => setErroLeitor(null)}
              permitirRelato
            />
          )}

          {transcript === null && !transcricaoRodando ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
              <EstadoTela
                tipo="vazio"
                titulo="Esta Fonte ainda não foi transcrita."
                descricao="Escolha o Motor ao lado (Local grátis ou Groq remoto) e clique em Iniciar transcrição."
                acaoSecundaria={{
                  rotulo: 'Focar configuração do Motor',
                  aoAcionar: () => motorRef.current?.focus(),
                }}
              />
            </div>
          ) : transcricaoRodando && !pronta ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area p-6">
              <div className="flex max-w-[52ch] flex-col gap-3">
                <h2 className="text-titulo font-forte text-t1">
                  Transcrição em andamento — {blocosCount} de {totalBlocos} blocos salvos
                </h2>
                <p className="text-t2">
                  Você pode navegar para outras Fontes ou revisar Cortes de outra live enquanto esta
                  Transcrição continua na Fila de Jobs.
                </p>
                <div className="rounded-controle bg-elevado p-3 text-pequeno text-t2">
                  Progresso salvo até{' '}
                  <strong className="num text-t1">{tcLongo(transcript?.resume_us ?? 0)}</strong>. Se
                  pausar agora, poderá retomar exatamente desse ponto sem refazer os blocos prontos.
                </div>
              </div>
            </div>
          ) : (
            <>
              {parcial && (
                <EstadoTela
                  tipo="parcial"
                  compacto
                  titulo={`Transcrição parcial salva até ${tcLongo(transcript?.resume_us ?? 1_200_000_000)}.`}
                  descricao={`(${blocosCount} de ${totalBlocos} blocos concluídos). Você pode retomar de onde parou sem refazer o que já foi processado.`}
                  acaoPrimaria={{
                    rotulo: `Retomar de ${tcLongo(transcript?.resume_us ?? 1_200_000_000)}`,
                    aoAcionar: () => void retomarParcial(),
                  }}
                />
              )}

              <PlayerReferenciaFonte
                fonteId={fonteEfetiva.id}
                disponivel={fonteEfetiva.status === 'available'}
                seekUs={seekUs}
                duracaoUs={duracaoTotalUs}
                aoMudarTempoUs={setTempoAtualUs}
                aoPedirRelocalizacao={() => {
                  if (fonteEfetiva.status === 'offline') {
                    setCaminhoRelocalizar('')
                    setRelocalizando(true)
                  } else {
                    void executarHash(false)
                  }
                }}
              />

              <LeitorTranscricao
                projetoId={projetoId}
                fonteId={fonteEfetiva.id}
                totalPalavras={transcript?.words}
                tempoAtualUs={tempoAtualUs}
                scrollPara={scrollPara}
                aoFocarPalavraTempo={(us) => setSeekUs(us)}
                aoErro={(e) => setErroLeitor(e)}
              />
            </>
          )}
        </section>
      </div>

      {/* Diálogo: Editar Permissão */}
      <Dialogo
        aberto={editandoPerm}
        aoMudarAberto={(v) => {
          if (!v && !salvandoPerm) setEditandoPerm(false)
        }}
        titulo={`Editar Permissão — ${nomeFonte}`}
        largura={500}
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={salvandoPerm}
              onClick={() => setEditandoPerm(false)}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={salvandoPerm}
              disabled={!permissaoValida(permDraft)}
              onClick={() => void salvarPermissao()}
            >
              Salvar Permissão
            </Botao>
          </>
        }
      >
        <CampoPermissao
          valor={permDraft}
          aoMudar={setPermDraft}
          obrigatorio
          somenteLeitura={salvandoPerm}
        />
      </Dialogo>

      {/* Diálogo: Relocalizar arquivo offline */}
      <Dialogo
        aberto={relocalizando}
        aoMudarAberto={(v) => {
          if (!v && !ocupadoIntegridade) setRelocalizando(false)
        }}
        titulo={`Relocalizar arquivo — ${nomeFonte}`}
        descricao="Escolha o arquivo correspondente no disco. A Transcrição existente será preservada."
        largura={500}
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={ocupadoIntegridade}
              onClick={() => setRelocalizando(false)}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              type="submit"
              form="form-relocalizar-detalhe"
              carregando={ocupadoIntegridade}
              disabled={!caminhoRelocalizar.trim()}
            >
              Relocalizar
            </Botao>
          </>
        }
      >
        <form id="form-relocalizar-detalhe" onSubmit={submeterRelocalizar}>
          <SeletorCaminho
            rotulo="Arquivo de vídeo"
            modo="arquivo"
            valor={caminhoRelocalizar}
            aoMudar={setCaminhoRelocalizar}
            desabilitado={ocupadoIntegridade}
          />
        </form>
      </Dialogo>

      {/* Confirmação de relocalização / hash */}
      <ConfirmDialog
        aberto={Boolean(confirmacaoIntegridade)}
        aoMudarAberto={(v) => {
          if (!v && !ocupadoIntegridade) setConfirmacaoIntegridade(null)
        }}
        titulo="Confirmar que o arquivo é a mesma Fonte?"
        descricao={`A Fonte ${nomeFonte} mudou ou não tinha verificação completa salva. Confirmar que continua sendo o mesmo arquivo?`}
        rotuloConfirmar={
          confirmacaoIntegridade?.tipo === 'relocate'
            ? 'Confirmar relocalização'
            : 'Confirmar verificação'
        }
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={ocupadoIntegridade}
        aoConfirmar={() =>
          confirmacaoIntegridade?.tipo === 'relocate'
            ? executarRelocalizar(confirmacaoIntegridade.path, true)
            : executarHash(true)
        }
      />
    </div>
  )
}
