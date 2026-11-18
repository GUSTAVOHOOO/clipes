import {
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Dialogo,
  Dica,
  Entrada,
  Progresso,
  Segmentado,
  Select,
  Status,
  tcLongo,
  useToast,
  type OpcaoSelect,
} from '@ds'
import { Download, FolderCog, Search, Upload } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import { CampoPermissao, permissaoValida } from '~/componentes/CampoPermissao'
import { InstaladorJustInTime } from '~/componentes/InstaladorJustInTime'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import type { FonteProjeto, PermissaoFonte, StreamMetadata } from '~/stores/fontesProjeto'

export type ModoEntradaFonte = 'local' | 'url'

export type IdiomaOpcao = {
  code: string
  name: string
}

export type InspectResponse = {
  format?: { duration?: string }
  streams?: StreamMetadata[]
}

const NOME_IDIOMA_PADRAO: Record<string, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: '日本語',
}

export const IDIOMAS_FALLBACK: IdiomaOpcao[] = [
  { code: 'pt', name: 'portuguese' },
  { code: 'en', name: 'english' },
  { code: 'es', name: 'spanish' },
]

/** Converte lista de idiomas do núcleo em opções acessíveis para `<Select>`. */
export function opcoesIdiomaDe(idiomas: IdiomaOpcao[]): OpcaoSelect<string>[] {
  const lista = idiomas.length > 0 ? idiomas : IDIOMAS_FALLBACK
  let display: Intl.DisplayNames | null = null
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      display = new Intl.DisplayNames(['pt-BR'], { type: 'language' })
    }
  } catch {
    display = null
  }
  return lista.map((item) => {
    const conhecido = NOME_IDIOMA_PADRAO[item.code]
    const traduzido = display?.of(item.code)
    const nome = conhecido ?? (traduzido ? traduzido.charAt(0).toUpperCase() + traduzido.slice(1) : item.name)
    return {
      valor: item.code,
      rotulo: `${nome} (${item.code})`,
    }
  })
}

/** Formata um código de idioma para exibição humana em cartões de Fonte. */
export function formatarNomeIdioma(codigo: string): string {
  const conhecido = NOME_IDIOMA_PADRAO[codigo]
  if (conhecido) return conhecido
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const n = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(codigo)
      if (n) return n.charAt(0).toUpperCase() + n.slice(1)
    }
  } catch {
    // fallback para o código bruto
  }
  return codigo.toUpperCase()
}

export function basenameCaminho(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter(Boolean)
  return partes[partes.length - 1] ?? caminho
}

function normalizarErro(err: unknown): ErroCore {
  if (err instanceof ErroCore) return err
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code?: unknown; message?: unknown }
    return new ErroCore(
      typeof e.code === 'string' && e.code ? e.code : 'desconhecido',
      typeof e.message === 'string' ? e.message : '',
    )
  }
  return new ErroCore('desconhecido', err instanceof Error ? err.message : String(err ?? ''))
}

function calcularFps(avgFrameRate?: string): string | null {
  if (!avgFrameRate) return null
  const [numStr, denStr] = avgFrameRate.split('/')
  const num = Number(numStr)
  const den = denStr ? Number(denStr) : 1
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) return null
  const fps = Math.round((num / den) * 10) / 10
  return Number.isInteger(fps) ? `${fps} fps` : `${fps.toLocaleString('pt-BR')} fps`
}

function formatarResumoVideo(meta: InspectResponse): string {
  const seg = Number(meta.format?.duration ?? 0)
  const durUs = Number.isFinite(seg) && seg > 0 ? Math.round(seg * 1_000_000) : 0
  const video = meta.streams?.find((s) => s.codec_type === 'video')
  const res = video?.width && video?.height ? `${video.width}×${video.height}` : null
  const fps = calcularFps(video?.avg_frame_rate)
  return [durUs > 0 ? tcLongo(durUs) : null, res, fps].filter(Boolean).join(' · ')
}

export type EntradaFonteProps = {
  projetoPath: string
  copiaEmAndamento: boolean
  aoImportar: (fonte: FonteProjeto) => void | Promise<void>
  aoMudarCopiaAtiva: (ativo: boolean) => void
  refPrimeiroControle?: RefObject<HTMLInputElement | null>
  modo?: ModoEntradaFonte
  aoMudarModo?: (modo: ModoEntradaFonte) => void
}

/** Painel de entrada e pré-inspeção de Fonte (arquivo local ou URL VOD com JIT). */
export function EntradaFonte({
  projetoPath,
  copiaEmAndamento,
  aoImportar,
  aoMudarCopiaAtiva,
  refPrimeiroControle,
  modo: modoProp,
  aoMudarModo,
}: EntradaFonteProps) {
  const toast = useToast()
  const jobs = useFila()

  const [modoInterno, setModoInterno] = useState<ModoEntradaFonte>('local')
  const modo = modoProp ?? modoInterno
  const definirModo = useCallback(
    (proximo: ModoEntradaFonte) => {
      if (aoMudarModo) aoMudarModo(proximo)
      else setModoInterno(proximo)
    },
    [aoMudarModo],
  )

  const inputLocalRef = useRef<HTMLInputElement>(null)
  const inputUrlRef = useRef<HTMLInputElement>(null)
  const inspecionarAoMudarRef = useRef(false)
  const refEfetivoLocal = refPrimeiroControle ?? inputLocalRef

  const [caminhoArquivo, setCaminhoArquivo] = useState('')
  const [urlVideo, setUrlVideo] = useState('')
  const [originUrl, setOriginUrl] = useState<string | null>(null)
  const [caminhoInspecionado, setCaminhoInspecionado] = useState('')
  const [inspecao, setInspecao] = useState<InspectResponse | null>(null)
  const [inspecionando, setInspecionando] = useState(false)

  const [faixaAudio, setFaixaAudio] = useState('1')
  const [idioma, setIdioma] = useState('pt')
  const [idiomaPadrao, setIdiomaPadrao] = useState('pt')
  const [idiomas, setIdiomas] = useState<IdiomaOpcao[]>(IDIOMAS_FALLBACK)
  const [permissao, setPermissao] = useState<PermissaoFonte>({ status: 'none' })
  const [copiarParaProjeto, setCopiarParaProjeto] = useState(false)

  const [urlCfg, setUrlCfg] = useState<{ terms_accepted: boolean; download_dir: string }>({
    terms_accepted: false,
    download_dir: '',
  })
  const [ytdlpAusente, setYtdlpAusente] = useState(false)
  const [mostrarJit, setMostrarJit] = useState(false)
  const [dialogoTermosAberto, setDialogoTermosAberto] = useState(false)
  const [dialogoPastaAberto, setDialogoPastaAberto] = useState(false)
  const [pastaEditada, setPastaEditada] = useState('')
  const [salvandoPasta, setSalvandoPasta] = useState(false)

  const [jobUrlAtivo, setJobUrlAtivo] = useState<string | null>(null)
  const [jobFonteAtivo, setJobFonteAtivo] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)

  const carregarConfigInicial = useCallback(async () => {
    const [resPerfil, resLangs, resUrl, resYtdlp] = await Promise.allSettled([
      chamar<{ language?: string }>('channel_profile.get', {}),
      chamar<IdiomaOpcao[]>('channel_profile.languages', {}),
      chamar<{ terms_accepted: boolean; download_dir: string }>('sources.url.settings.get', {}),
      chamar<{ installed: boolean }>('components.ytdlp.status', {}),
    ])

    if (resPerfil.status === 'fulfilled' && resPerfil.value?.language) {
      setIdiomaPadrao(resPerfil.value.language)
      setIdioma(resPerfil.value.language)
    }
    if (resLangs.status === 'fulfilled' && Array.isArray(resLangs.value) && resLangs.value.length > 0) {
      setIdiomas(resLangs.value)
    }
    if (resUrl.status === 'fulfilled' && resUrl.value) {
      setUrlCfg({
        terms_accepted: Boolean(resUrl.value.terms_accepted),
        download_dir: resUrl.value.download_dir ?? '',
      })
    }
    if (resYtdlp.status === 'fulfilled') {
      const ausente = !resYtdlp.value?.installed
      setYtdlpAusente(ausente)
      if (ausente) setMostrarJit(true)
    } else if (resYtdlp.reason instanceof ErroCore && resYtdlp.reason.code === 'component_integrity') {
      setYtdlpAusente(true)
      setMostrarJit(true)
    }
  }, [])

  useEffect(() => {
    void carregarConfigInicial()
  }, [carregarConfigInicial])

  const audioStreams = useMemo(
    () => (inspecao?.streams ?? []).filter((s) => s.codec_type === 'audio'),
    [inspecao],
  )

  const opcoesAudio = useMemo<OpcaoSelect<string>[]>(
    () =>
      audioStreams.map((s) => {
        const desc = s.tags?.title || s.codec_name || 'Áudio'
        const lang = s.tags?.language ? ` (${s.tags.language})` : ''
        return {
          valor: String(s.index),
          rotulo: `${s.index} · ${desc}${lang}`,
        }
      }),
    [audioStreams],
  )

  const opcoesIdioma = useMemo(() => opcoesIdiomaDe(idiomas), [idiomas])

  const inspecionarArquivo = useCallback(
    async (caminho: string, urlOrigem: string | null = null) => {
      const limpo = caminho.trim()
      if (!limpo) return
      setErro(null)
      setInspecionando(true)
      try {
        const meta = await chamar<InspectResponse>('sources.inspect', { path: limpo })
        setInspecao(meta)
        setCaminhoInspecionado(limpo)
        setOriginUrl(urlOrigem)
        if (urlOrigem) setCopiarParaProjeto(false)
        const audios = (meta.streams ?? []).filter((s) => s.codec_type === 'audio')
        if (audios.length > 0) {
          setFaixaAudio(String(audios[0].index))
        } else {
          setFaixaAudio('0')
        }
        setIdioma(idiomaPadrao)
      } catch (err) {
        setErro(normalizarErro(err))
        setInspecao(null)
      } finally {
        setInspecionando(false)
      }
    },
    [idiomaPadrao],
  )

  const limparSelecao = useCallback(() => {
    setCaminhoArquivo('')
    setCaminhoInspecionado('')
    setInspecao(null)
    setOriginUrl(null)
    setPermissao({ status: 'none' })
    setCopiarParaProjeto(false)
    setIdioma(idiomaPadrao)
    setErro(null)
  }, [idiomaPadrao])

  const executarDownloadUrl = useCallback(
    async (url: string) => {
      const jobId = `url-${Date.now()}`
      setErro(null)
      setJobUrlAtivo(jobId)
      try {
        const res = await chamar<{ path: string; url: string }>('sources.url.download', {
          project: projetoPath,
          url,
          job: jobId,
        })
        setJobUrlAtivo(null)
        setCaminhoArquivo(res.path)
        await inspecionarArquivo(res.path, res.url || url)
      } catch (err) {
        setJobUrlAtivo(null)
        const coreErr = normalizarErro(err)
        if (coreErr.code === 'component_missing' || coreErr.code === 'js_runtime_missing') {
          setMostrarJit(true)
        }
        if (coreErr.code !== 'cancelled') {
          setErro(coreErr)
        }
      }
    },
    [inspecionarArquivo, projetoPath],
  )

  const iniciarBaixarUrl = async () => {
    const limpo = urlVideo.trim()
    setErro(null)
    if (!limpo || !/^https?:\/\//i.test(limpo)) {
      setErro(new ErroCore('invalid_url', limpo))
      inputUrlRef.current?.focus()
      return
    }
    if (!urlCfg.terms_accepted) {
      setDialogoTermosAberto(true)
      return
    }
    await executarDownloadUrl(limpo)
  }

  const confirmarTermosEbaixar = async () => {
    setDialogoTermosAberto(false)
    try {
      const atualizado = await chamar<{ terms_accepted: boolean; download_dir: string }>(
        'sources.url.settings.set',
        {
          terms_accepted: true,
          download_dir: urlCfg.download_dir,
        },
      )
      setUrlCfg(atualizado)
      await executarDownloadUrl(urlVideo.trim())
    } catch (err) {
      setErro(normalizarErro(err))
    }
  }

  const cancelarDownloadUrl = async () => {
    if (!jobUrlAtivo) return
    const alvo = jobUrlAtivo
    try {
      await chamar('sources.url.cancel', { job: alvo })
    } finally {
      setJobUrlAtivo(null)
    }
  }

  const salvarPastaDownload = async (e: FormEvent) => {
    e.preventDefault()
    const limpo = pastaEditada.trim()
    if (!limpo) return
    setSalvandoPasta(true)
    try {
      const atualizado = await chamar<{ terms_accepted: boolean; download_dir: string }>(
        'sources.url.settings.set',
        {
          terms_accepted: urlCfg.terms_accepted,
          download_dir: limpo,
        },
      )
      setUrlCfg(atualizado)
      setDialogoPastaAberto(false)
      toast.add({ title: 'Pasta de downloads atualizada.' })
    } catch (err) {
      setErro(normalizarErro(err))
    } finally {
      setSalvandoPasta(false)
    }
  }

  const importarFonte = async () => {
    if (!inspecao || !caminhoInspecionado) return
    if (!permissaoValida(permissao)) return
    const usarCopia = !originUrl && copiarParaProjeto
    if (usarCopia && copiaEmAndamento) return

    setErro(null)
    setImportando(true)
    if (usarCopia) {
      aoMudarCopiaAtiva(true)
      setJobFonteAtivo('source-copy-original')
    }

    try {
      const importado = await chamar<FonteProjeto>('sources.import', {
        project: projetoPath,
        path: caminhoInspecionado,
        audio_track: Number(faixaAudio),
        language: idioma,
        copy: usarCopia,
        origin_url: originUrl,
        permission: permissao,
      })

      if (!usarCopia && !importado.verified) {
        const jobHash = `source-hash-${importado.id}`
        setJobFonteAtivo(jobHash)
        await chamar('sources.hash', {
          project: projetoPath,
          id: importado.id,
          job: jobHash,
        })
      }

      setJobFonteAtivo(null)
      limparSelecao()
      setUrlVideo('')
      toast.add({ title: `Fonte ${basenameCaminho(importado.path)} importada.` })
      await aoImportar(importado)
    } catch (err) {
      const coreErr = normalizarErro(err)
      if (coreErr.code !== 'cancelled') {
        setErro(coreErr)
      }
    } finally {
      if (usarCopia) {
        aoMudarCopiaAtiva(false)
      }
      setJobFonteAtivo(null)
      setImportando(false)
    }
  }

  const cancelarJobFonte = async () => {
    const jobAtivo =
      jobs.find(
        (j) =>
          j.estado === 'rodando' &&
          (j.id === jobFonteAtivo || j.id === 'source-copy-original' || j.id === 'source-copy-check'),
      )?.id ?? jobFonteAtivo
    if (!jobAtivo) return
    await chamar('sources.cancel', { job: jobAtivo })
  }

  const jobFilaUrl = useMemo(
    () => (jobUrlAtivo ? jobs.find((j) => j.id === jobUrlAtivo) : undefined),
    [jobUrlAtivo, jobs],
  )

  const jobFilaFonte = useMemo(() => {
    if (!jobFonteAtivo) return undefined
    return (
      jobs.find(
        (j) =>
          j.estado === 'rodando' &&
          (j.id === 'source-copy-check' || j.id === 'source-copy-original' || j.id === jobFonteAtivo),
      ) ?? jobs.find((j) => j.id === jobFonteAtivo)
    )
  }, [jobFonteAtivo, jobs])

  const traducaoErro = erro ? mensagemDeErro(erro) : null
  const copiaTravada = !originUrl && copiarParaProjeto && copiaEmAndamento
  const podeImportar =
    Boolean(inspecao) &&
    permissaoValida(permissao) &&
    !importando &&
    !copiaTravada &&
    (audioStreams.length === 0 || faixaAudio !== '')

  const botaoImportar = (
    <Botao
      variante="primario"
      icone={<Upload />}
      carregando={importando}
      disabled={!podeImportar}
      onClick={() => void importarFonte()}
    >
      Importar Fonte
    </Botao>
  )

  return (
    <aside
      aria-label="Entrada de Fonte"
      className="flex min-h-0 flex-col gap-3 rounded-area bg-area p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-forte text-t1">Entrada de Fonte</h2>
        <Segmentado
          rotulo="Modo de entrada"
          valor={modo}
          aoMudar={(v) => {
            definirModo(v)
            setErro(null)
          }}
          className="shrink-0 whitespace-nowrap"
          opcoes={[
            { valor: 'local', rotulo: <span className="whitespace-nowrap">Arquivo local</span> },
            { valor: 'url', rotulo: <span className="whitespace-nowrap">URL (VOD)</span> },
          ]}
        />
      </div>

      {erro && traducaoErro && (
        <BannerErroCore
          erro={{ code: erro.code, message: erro.detalhe || erro.message }}
          traduzir={() => ({ titulo: traducaoErro.titulo })}
          acaoRecuperacao={
            traducaoErro.recuperacao
              ? {
                  rotulo: traducaoErro.recuperacao.rotulo,
                  aoAcionar: () => {
                    const rec = traducaoErro.recuperacao!
                    if (rec.acao === 'importar-local') {
                      definirModo('local')
                      setErro(null)
                      requestAnimationFrame(() => refEfetivoLocal.current?.focus())
                      return
                    }
                    if (rec.acao === 'instalar-componente') {
                      setMostrarJit(true)
                      return
                    }
                    if (rec.acao === 'aceitar-termos') {
                      setDialogoTermosAberto(true)
                      return
                    }
                    if (rec.rota) {
                      window.location.hash = rec.rota
                    }
                  },
                }
              : undefined
          }
          aoDispensar={() => setErro(null)}
          permitirRelato
        />
      )}

      {modo === 'local' ? (
        <div
          className="flex flex-col gap-2"
          onClickCapture={(e) => {
            const target = e.target as HTMLElement
            inspecionarAoMudarRef.current = Boolean(target.closest('button'))
          }}
        >
          <SeletorCaminho
            rotulo="Arquivo de vídeo"
            modo="arquivo"
            valor={caminhoArquivo}
            aoMudar={(v) => {
              setCaminhoArquivo(v)
              if (inspecionarAoMudarRef.current && v.trim()) {
                inspecionarAoMudarRef.current = false
                void inspecionarArquivo(v, null)
              }
            }}
            ajuda="Formatos aceitos: mp4, mkv, mov, webm, avi, m4v"
            placeholder="C:\Videos\live.mkv ou /videos/live.mkv"
            desabilitado={inspecionando || importando}
            inputRef={refEfetivoLocal}
          />
          {caminhoArquivo.trim() && caminhoArquivo.trim() !== caminhoInspecionado && (
            <div className="flex justify-end">
              <Botao
                variante="secundario"
                tamanho="p"
                icone={<Search />}
                carregando={inspecionando}
                onClick={() => void inspecionarArquivo(caminhoArquivo, null)}
              >
                Inspecionar arquivo
              </Botao>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Campo rotulo="URL do vídeo (YouTube VOD)">
            {(propsAria) => (
              <div className="flex items-center gap-2">
                <Entrada
                  {...propsAria}
                  ref={inputUrlRef}
                  value={urlVideo}
                  onChange={(e) => setUrlVideo(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={Boolean(jobUrlAtivo) || importando}
                  className="min-w-0 flex-1"
                />
                <Botao
                  variante={inspecao ? 'secundario' : 'primario'}
                  icone={<Download />}
                  disabled={Boolean(jobUrlAtivo) || importando || ytdlpAusente}
                  onClick={() => void iniciarBaixarUrl()}
                >
                  Baixar por URL
                </Botao>
              </div>
            )}
          </Campo>

          <div className="flex flex-wrap items-center justify-between gap-2 text-pequeno text-t3">
            <span className="min-w-0 truncate">
              Pasta:{' '}
              <span className="font-mono text-t2">
                {urlCfg.download_dir || 'Pasta padrão de downloads'}
              </span>
            </span>
            <Botao
              variante="fantasma"
              tamanho="p"
              icone={<FolderCog />}
              disabled={Boolean(jobUrlAtivo)}
              onClick={() => {
                setPastaEditada(urlCfg.download_dir)
                setDialogoPastaAberto(true)
              }}
            >
              Trocar pasta
            </Botao>
          </div>

          {mostrarJit && (
            <InstaladorJustInTime
              recurso="url_import"
              modo="inline"
              aoFechar={ytdlpAusente ? undefined : () => setMostrarJit(false)}
              aoConcluir={() => {
                setMostrarJit(false)
                setYtdlpAusente(false)
                setErro(null)
                void carregarConfigInicial()
              }}
            />
          )}

          {jobUrlAtivo && (
            <div className="flex items-center gap-3 rounded-controle bg-elevado px-3 py-2">
              <Progresso
                valor={jobFilaUrl?.percentual ?? 0}
                rotulo={jobFilaUrl?.mensagem || 'Baixando VOD por URL…'}
                className="flex-1"
              />
              <Botao
                variante="secundario"
                tamanho="p"
                onClick={() => void cancelarDownloadUrl()}
              >
                Cancelar download
              </Botao>
            </div>
          )}
        </div>
      )}

      {jobFonteAtivo && (
        <div className="flex items-center gap-3 rounded-controle bg-elevado px-3 py-2">
          <Progresso
            valor={jobFilaFonte?.percentual ?? 0}
            rotulo={
              copiarParaProjeto
                ? 'Copiando e verificando Fonte…'
                : 'Verificando integridade da Fonte…'
            }
            className="flex-1"
          />
          <Botao tamanho="p" variante="secundario" onClick={() => void cancelarJobFonte()}>
            Cancelar
          </Botao>
        </div>
      )}

      {inspecao && (
        <div className="flex flex-col gap-3 rounded-controle bg-chao p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="truncate text-base font-medio text-t1">
              {basenameCaminho(caminhoInspecionado)}
            </strong>
            <span className="num text-pequeno text-t2">{formatarResumoVideo(inspecao)}</span>
          </div>
          <span className="truncate font-mono text-pequeno text-t3" title={caminhoInspecionado}>
            {caminhoInspecionado}
          </span>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Campo rotulo="Faixa de áudio (microfone)">
              {(propsAria) =>
                opcoesAudio.length > 0 ? (
                  <Select
                    {...propsAria}
                    valor={faixaAudio}
                    aoMudar={setFaixaAudio}
                    opcoes={opcoesAudio}
                    rotulo="Faixa de áudio (microfone)"
                    desabilitado={importando}
                  />
                ) : (
                  <Status tom="aviso">Nenhuma faixa de áudio detectada</Status>
                )
              }
            </Campo>

            <Campo rotulo="Idioma falado">
              {(propsAria) => (
                <Select
                  {...propsAria}
                  valor={idioma}
                  aoMudar={setIdioma}
                  opcoes={opcoesIdioma}
                  rotulo="Idioma falado"
                  desabilitado={importando}
                />
              )}
            </Campo>
          </div>

          <CampoPermissao
            valor={permissao}
            aoMudar={setPermissao}
            obrigatorio
            somenteLeitura={importando}
          />

          {!originUrl && (
            <Checkbox
              marcado={copiarParaProjeto}
              aoMudar={setCopiarParaProjeto}
              desabilitado={importando}
              className="text-pequeno"
            >
              Copiar vídeo para dentro do Projeto (evita que a Fonte fique offline)
            </Checkbox>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Botao
              variante="fantasma"
              disabled={importando}
              onClick={limparSelecao}
            >
              Limpar seleção
            </Botao>
            {copiaTravada ? (
              <Dica texto="Aguarde a cópia em andamento concluir antes de copiar outra Fonte (#307).">
                <span tabIndex={0} className="inline-flex">
                  {botaoImportar}
                </span>
              </Dica>
            ) : (
              botaoImportar
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        aberto={dialogoTermosAberto}
        aoMudarAberto={setDialogoTermosAberto}
        titulo="Termos de uso do YouTube"
        descricao="Os Termos do YouTube proíbem baixar conteúdo sem autorização do dono. A responsabilidade pelo download e pelo uso é sua."
        rotuloConfirmar="Aceitar e baixar"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        aoConfirmar={confirmarTermosEbaixar}
      />

      <Dialogo
        aberto={dialogoPastaAberto}
        aoMudarAberto={(v) => {
          if (!salvandoPasta) setDialogoPastaAberto(v)
        }}
        titulo="Pasta de downloads por URL"
        largura={480}
        rodape={
          <>
            <Botao
              variante="fantasma"
              disabled={salvandoPasta}
              onClick={() => setDialogoPastaAberto(false)}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              type="submit"
              form="form-pasta-url"
              carregando={salvandoPasta}
              disabled={!pastaEditada.trim()}
            >
              Salvar pasta
            </Botao>
          </>
        }
      >
        <form id="form-pasta-url" onSubmit={(e) => void salvarPastaDownload(e)}>
          <SeletorCaminho
            rotulo="Pasta de destino"
            modo="pasta"
            valor={pastaEditada}
            aoMudar={setPastaEditada}
            desabilitado={salvandoPasta}
          />
        </form>
      </Dialogo>
    </aside>
  )
}
