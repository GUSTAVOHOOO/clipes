import {
  Abas,
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Dica,
  Entrada,
  Esqueleto,
  EstadoTela,
  Select,
  Status,
  Switch,
  TabelaGrade,
  cn,
  useToast,
  type Aba,
  type ColunaGrade,
  type OpcaoSelect,
} from '@ds'
import { AlertCircle, Lock, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila } from '~/core/progresso'
import { ComEstado, useEstadoForcado } from '~/shell/EstadoForcado'
import { notificarMudancaProjeto, type ProjetoAtual } from '~/shell/Shell'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'

type AbaProjeto = 'perfil' | 'privacidade' | 'backups'

type AllowedSource = {
  label: string
  url?: string | null
  note?: string | null
}

type CaptionStyle = {
  schemaVersion: number
  revision: number
  preset: string
  font: string
  fontSize: number
  color: string
  activeColor: string
  dimColor: string
  outlineColor: string
  outline: number
  shadow: number
  x: number
  y: number
  highlight: boolean
}

type ChannelProfileResp = {
  videoKind: 'direct' | 'transformed'
  language: string
  minUs: number
  maxUs: number
  allowedSources: AllowedSource[]
  narrationVoice: string | null
  directMonetizationAck: boolean
  captionStyle: CaptionStyle
  limits?: {
    defaultMinUs: number
    defaultMaxUs: number
    maxUs: number
    technicalMaxUs: number
  }
}

type LanguageOpt = {
  code: string
  name: string
}

type TtsVoice = {
  id: string
  label: string
  language: string
}

type BackupItem = {
  id: string
  created_at: number
  before_restore: boolean
}

type BackupSettings = {
  interval_seconds: number
  copies: number
  default_interval_seconds?: number
  default_copies?: number
  warning?: { code?: string; message: string } | null
}

const ABAS_PROJETO: Aba<AbaProjeto>[] = [
  { valor: 'perfil', rotulo: 'Perfil de canal' },
  { valor: 'privacidade', rotulo: 'Privacidade (Somente local)' },
  { valor: 'backups', rotulo: 'Backups do Projeto' },
]

const MENSAGENS_PROJETO: Record<string, string> = {
  invalid_cut_range:
    'A duração mínima deve ser maior que zero e menor que a máxima (até 180 segundos).',
  backup_invalid: 'Este arquivo de backup está corrompido ou é de uma versão incompatível.',
  restore_failed: 'Este arquivo de backup está corrompido ou é de uma versão incompatível.',
  backup_settings: 'Informe intervalo e número de cópias inteiros maiores que zero.',
  backup_failed: 'Não foi possível criar ou ler o backup do Projeto.',
  channel_profile_invalid: 'Verifique os campos do Perfil de canal antes de salvar.',
  invalid_url: 'Informe uma URL válida iniciando com http:// ou https://.',
}

function traduzirErroProjeto(erro: ErroCore) {
  const esp = MENSAGENS_PROJETO[erro.code]
  const global = mensagemDeErro(erro)
  return esp ? { titulo: esp, recuperacao: global.recuperacao } : global
}

const NOME_IDIOMA: Record<string, string> = {
  pt: 'Português (pt)',
  en: 'English (en)',
  es: 'Español (es)',
}

const OPCOES_PRESET_LEGENDA: OpcaoSelect<string>[] = [
  { valor: 'vertical', rotulo: 'Vertical' },
  { valor: 'cinema', rotulo: 'Cinema' },
  { valor: 'simple', rotulo: 'Simples' },
]

const OPCOES_FONTE_LEGENDA: OpcaoSelect<string>[] = [
  { valor: 'Noto Sans', rotulo: 'Noto Sans' },
  { valor: 'Noto Serif', rotulo: 'Noto Serif' },
]

function formatarDataHora(unixSec: number): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(unixSec * 1000))
  } catch {
    return String(unixSec)
  }
}

export type ConfigProjetoProps = {
  projetoAberto: string | null
  projeto?: ProjetoAtual | null
  fila?: Fila
}

/** Tela de Configurações do Projeto atual: Perfil de canal, Privacidade (Somente local) e Backups (#/config/projeto). */
export function ConfigProjeto({ projetoAberto, projeto, fila: filaProp }: ConfigProjetoProps) {
  const toast = useToast()
  const forcado = useEstadoForcado()
  const fila = useFila(filaProp)

  const [aba, setAba] = useState<AbaProjeto>('perfil')
  const [carregando, setCarregando] = useState(true)
  const [erroFatal, setErroFatal] = useState<ErroCore | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Perfil de canal
  const [perfil, setPerfil] = useState<ChannelProfileResp | null>(null)
  const [idiomas, setIdiomas] = useState<LanguageOpt[]>([])
  const [vozes, setVozes] = useState<TtsVoice[]>([])
  const [videoKind, setVideoKind] = useState<'direct' | 'transformed'>('direct')
  const [idioma, setIdioma] = useState('pt')
  const [minSeg, setMinSeg] = useState('20')
  const [maxSeg, setMaxSeg] = useState('60')
  const [vozPadrao, setVozPadrao] = useState('')
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle | null>(null)
  const [allowedSources, setAllowedSources] = useState<AllowedSource[]>([])
  const [mostraFormFonte, setMostraFormFonte] = useState(false)
  const [novaFonteLabel, setNovaFonteLabel] = useState('')
  const [novaFonteUrl, setNovaFonteUrl] = useState('')
  const [novaFonteNota, setNovaFonteNota] = useState('')
  const [erroValidacaoPerfil, setErroValidacaoPerfil] = useState<string | null>(null)

  // Privacidade
  const [somenteLocal, setSomenteLocal] = useState(false)

  // Backups
  const [carregandoBackups, setCarregandoBackups] = useState(true)
  const [backupCfg, setBackupCfg] = useState<BackupSettings | null>(null)
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [intervaloSeg, setIntervaloSeg] = useState('1800')
  const [copiasMantidas, setCopiasMantidas] = useState('10')
  const [backupParaRestaurar, setBackupParaRestaurar] = useState<BackupItem | null>(null)

  const aplicarPerfilCarregado = useCallback((p: ChannelProfileResp) => {
    setPerfil(p)
    setVideoKind(p.videoKind)
    setIdioma(p.language)
    setMinSeg(String(Math.round(p.minUs / 1_000_000)))
    setMaxSeg(String(Math.round(p.maxUs / 1_000_000)))
    setVozPadrao(p.narrationVoice ?? '')
    setCaptionStyle(p.captionStyle)
    setAllowedSources(p.allowedSources ?? [])
  }, [])

  const carregarBackups = useCallback(async () => {
    setCarregandoBackups(true)
    try {
      const [cfg, lista] = await Promise.all([
        chamar<BackupSettings>('backups.settings.get', {}),
        chamar<BackupItem[]>('backups.list', {}),
      ])
      setBackupCfg(cfg)
      setIntervaloSeg(String(cfg.interval_seconds))
      setCopiasMantidas(String(cfg.copies))
      setBackups(lista)
    } catch (e) {
      setErroFatal(e instanceof ErroCore ? e : new ErroCore('desconhecido', String(e)))
    } finally {
      setCarregandoBackups(false)
    }
  }, [])

  const carregarTudo = useCallback(async () => {
    setCarregando(true)
    setErroFatal(null)
    setErroAcao(null)
    try {
      const [p, langs, tts, local, cfg, listaBackups] = await Promise.all([
        chamar<ChannelProfileResp>('channel_profile.get', {}),
        chamar<LanguageOpt[]>('channel_profile.languages', {}).catch(() => [
          { code: 'pt', name: 'portuguese' },
          { code: 'en', name: 'english' },
        ]),
        chamar<{ voices?: TtsVoice[] }>('tts.catalog', {}).catch(() => ({ voices: [] })),
        chamar<{ enabled: boolean }>('projects.local_only.get', {}),
        chamar<BackupSettings>('backups.settings.get', {}),
        chamar<BackupItem[]>('backups.list', {}),
      ])
      aplicarPerfilCarregado(p)
      setIdiomas(langs)
      setVozes(tts.voices ?? [])
      setSomenteLocal(Boolean(local.enabled))
      setBackupCfg(cfg)
      setIntervaloSeg(String(cfg.interval_seconds))
      setCopiasMantidas(String(cfg.copies))
      setBackups(listaBackups)
      setCarregandoBackups(false)
    } catch (e) {
      setErroFatal(e instanceof ErroCore ? e : new ErroCore('desconhecido', String(e)))
    } finally {
      setCarregando(false)
    }
  }, [aplicarPerfilCarregado])

  useEffect(() => {
    void carregarTudo()
  }, [carregarTudo, projetoAberto])

  // Nota #297: recarrega backups.list e backups.settings.get ao focar a aba Backups e após jobs concluírem na Fila.
  const jobsAtivos = useMemo(
    () => fila.filter((j) => j.estado === 'rodando').length,
    [fila],
  )
  const jobsAtivosAntesRef = useRef(jobsAtivos)

  useEffect(() => {
    const antes = jobsAtivosAntesRef.current
    jobsAtivosAntesRef.current = jobsAtivos
    if (antes > 0 && jobsAtivos < antes) {
      void carregarBackups()
    }
  }, [jobsAtivos, carregarBackups])

  useEffect(() => {
    if (aba !== 'backups') return
    void carregarBackups()
    const aoFocar = () => {
      void carregarBackups()
    }
    window.addEventListener('focus', aoFocar)
    return () => window.removeEventListener('focus', aoFocar)
  }, [aba, carregarBackups])

  const opcoesIdioma = useMemo<OpcaoSelect<string>[]>(
    () =>
      idiomas.map((l) => ({
        valor: l.code,
        rotulo: NOME_IDIOMA[l.code] ?? `${l.name} (${l.code})`,
      })),
    [idiomas],
  )

  const opcoesVoz = useMemo<OpcaoSelect<string>[]>(
    () => [
      { valor: '', rotulo: 'Sem voz padrão' },
      ...vozes.map((v) => ({ valor: v.id, rotulo: v.label })),
    ],
    [vozes],
  )

  const adicionarFontePermitida = () => {
    const label = novaFonteLabel.trim()
    const url = novaFonteUrl.trim()
    const note = novaFonteNota.trim()
    if (!label || label.length > 120) {
      setErroValidacaoPerfil('Informe o nome do criador ou canal (até 120 caracteres).')
      return
    }
    if (url && !/^https?:\/\//i.test(url)) {
      setErroValidacaoPerfil('A URL da fonte permitida deve começar com http:// ou https://.')
      return
    }
    if (allowedSources.length >= 200) {
      setErroValidacaoPerfil('O limite é de 200 Fontes permitidas por Projeto.')
      return
    }
    setErroValidacaoPerfil(null)
    setAllowedSources((prev) => [
      ...prev,
      { label, url: url || null, note: note || null },
    ])
    setNovaFonteLabel('')
    setNovaFonteUrl('')
    setNovaFonteNota('')
    setMostraFormFonte(false)
  }

  const removerFontePermitida = (idx: number) => {
    setAllowedSources((prev) => prev.filter((_, i) => i !== idx))
  }

  const salvarPerfil = async () => {
    setErroValidacaoPerfil(null)
    setErroAcao(null)
    const min = Number(minSeg)
    const max = Number(maxSeg)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || min >= max || max > 180) {
      setErroValidacaoPerfil(
        'A duração mínima deve ser maior que zero e menor que a máxima (até 180 segundos).',
      )
      return
    }

    setOcupado(true)
    try {
      const atualizado = await chamar<ChannelProfileResp>('channel_profile.set', {
        videoKind,
        language: idioma,
        minUs: Math.round(min * 1_000_000),
        maxUs: Math.round(max * 1_000_000),
        narrationVoice: vozPadrao || null,
        allowedSources,
        ...(captionStyle ? { captionStyle } : {}),
      })
      aplicarPerfilCarregado(atualizado)
      toast.add({ title: 'Perfil de canal salvo.' })
    } catch (e) {
      setErroAcao(e instanceof ErroCore ? e : new ErroCore('desconhecido', String(e)))
    } finally {
      setOcupado(false)
    }
  }

  const alternarSomenteLocal = async (habilitado: boolean) => {
    setErroAcao(null)
    setOcupado(true)
    try {
      const res = await chamar<{ enabled: boolean }>('projects.local_only.set', {
        enabled: habilitado,
      })
      setSomenteLocal(Boolean(res.enabled))
      notificarMudancaProjeto()
      toast.add({
        title: res.enabled
          ? 'Modo Somente local ativado neste Projeto.'
          : 'Modo Somente local desativado neste Projeto.',
      })
    } catch (e) {
      setErroAcao(e instanceof ErroCore ? e : new ErroCore('desconhecido', String(e)))
    } finally {
      setOcupado(false)
    }
  }

  const salvarConfigBackup = async (intervalo: number, copias: number) => {
    setErroAcao(null)
    if (!Number.isInteger(intervalo) || intervalo <= 0 || !Number.isInteger(copias) || copias <= 0) {
      setErroAcao(
        new ErroCore(
          'backup_settings',
          'Informe intervalo e número de cópias inteiros maiores que zero.',
        ),
      )
      return
    }
    setOcupado(true)
    try {
      await chamar('backups.settings.set', { interval_seconds: intervalo, copies: copias })
      await carregarBackups()
      toast.add({ title: 'Configuração de backups salva.' })
    } catch (e) {
      setErroAcao(e instanceof ErroCore ? e : new ErroCore('desconhecido', String(e)))
    } finally {
      setOcupado(false)
    }
  }

  const criarBackupAgora = async () => {
    setErroAcao(null)
    setOcupado(true)
    try {
      await chamar('backups.create', {})
      await carregarBackups()
      toast.add({ title: 'Backup criado com sucesso.' })
    } catch (e) {
      setErroAcao(e instanceof ErroCore ? e : new ErroCore('desconhecido', String(e)))
    } finally {
      setOcupado(false)
    }
  }

  const confirmarRestauracao = async () => {
    if (!backupParaRestaurar) return
    setErroAcao(null)
    setOcupado(true)
    try {
      await chamar('backups.restore', { id: backupParaRestaurar.id })
      setBackupParaRestaurar(null)
      await carregarTudo()
      notificarMudancaProjeto()
      toast.add({ title: 'Backup restaurado com sucesso.' })
    } catch (e) {
      setBackupParaRestaurar(null)
      setErroAcao(e instanceof ErroCore ? e : new ErroCore('desconhecido', String(e)))
    } finally {
      setOcupado(false)
    }
  }

  const aoTeclarTipoVideo = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') {
      return
    }
    e.preventDefault()
    const proximo = videoKind === 'direct' ? 'transformed' : 'direct'
    setVideoKind(proximo)
    const cont = e.currentTarget
    requestAnimationFrame(() => {
      ;(cont.querySelector(`[data-video-kind="${proximo}"]`) as HTMLElement | null)?.focus()
    })
  }

  const colunasBackups = useMemo<ColunaGrade<BackupItem>[]>(
    () => [
      {
        id: 'data',
        titulo: 'Data e hora',
        largura: '180px',
        render: (item) => (
          <time
            dateTime={new Date(item.created_at * 1000).toISOString()}
            className="num text-t1"
          >
            {formatarDataHora(item.created_at)}
          </time>
        ),
      },
      {
        id: 'arquivo',
        titulo: 'Arquivo',
        render: (item) => <span className="font-mono text-pequeno text-t2">{item.id}</span>,
      },
      {
        id: 'tipo',
        titulo: 'Tipo',
        largura: '150px',
        render: (item) => (
          <Status tom={item.before_restore ? 'info' : 'neutro'}>
            {item.before_restore ? 'Pré-restauração' : 'Automático'}
          </Status>
        ),
      },
      {
        id: 'acao',
        titulo: 'Ação',
        largura: '130px',
        alinhar: 'dir',
        render: (item) => {
          const rotulo = `Restaurar backup de ${formatarDataHora(item.created_at)}`
          const bloqueado = jobsAtivos > 0 || ocupado
          const botao = (
            <Botao
              tamanho="p"
              variante="secundario"
              disabled={bloqueado}
              aria-label={rotulo}
              onClick={() => setBackupParaRestaurar(item)}
            >
              Restaurar
            </Botao>
          )
          if (jobsAtivos > 0) {
            return (
              <Dica texto="Aguarde ou cancele os jobs ativos na Fila antes de restaurar um backup.">
                <span tabIndex={0} className="inline-flex">
                  {botao}
                </span>
              </Dica>
            )
          }
          return botao
        },
      },
    ],
    [jobsAtivos, ocupado],
  )

  const backupsVisiveis = forcado === 'vazio' ? [] : backups
  const warningVisivel =
    backupCfg?.warning ??
    (forcado === 'parcial'
      ? {
          code: 'backup_failed',
          message: 'O último backup automático falhou por falta de espaço ou permissão.',
        }
      : null)

  const erroExibir =
    erroFatal ?? (forcado === 'erro' ? new ErroCore('project_busy', 'Simulação de erro.') : null)
  const estadoTela =
    carregando || forcado === 'carregando'
      ? 'carregando'
      : erroExibir
        ? 'erro'
        : 'pronto'

  const tituloPagina = projeto?.name ? `Projeto atual: ${projeto.name}` : 'Projeto atual'
  const subtituloPagina =
    projeto?.path ?? 'Perfil de canal, privacidade Somente local e backups do Projeto.'

  const erroParaExibirBanner = erroAcao ? traduzirErroProjeto(erroAcao) : null

  return (
    <ConfiguracoesLayout
      secao="projeto"
      projetoAberto={projetoAberto}
      titulo={tituloPagina}
      subtitulo={subtituloPagina}
    >
      <ComEstado
        estado={estadoTela}
        carregando={<Esqueleto variante="formulario" quantidade={5} />}
        erro={
          erroExibir ? (
            <BannerErroCore
              erro={{
                code: erroExibir.code,
                message: erroExibir.detalhe || erroExibir.message,
              }}
              traduzir={() => traduzirErroProjeto(erroExibir)}
              acaoRecuperacao={
                traduzirErroProjeto(erroExibir).recuperacao
                  ? {
                      rotulo: traduzirErroProjeto(erroExibir).recuperacao!.rotulo,
                      aoAcionar: () => {
                        const r = traduzirErroProjeto(erroExibir).recuperacao
                        if (r?.rota) window.location.hash = r.rota
                      },
                    }
                  : { rotulo: 'Tentar novamente', aoAcionar: () => void carregarTudo() }
              }
              permitirRelato
            />
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <Abas
            rotulo="Seções do Projeto atual"
            valor={aba}
            aoMudar={setAba}
            abas={ABAS_PROJETO}
          />

          {erroAcao && erroParaExibirBanner && (
            <BannerErroCore
              erro={{
                code: erroAcao.code,
                message: erroAcao.detalhe || erroAcao.message,
              }}
              traduzir={() => erroParaExibirBanner}
              aoDispensar={() => setErroAcao(null)}
              permitirRelato
            />
          )}

          {aba === 'perfil' && (
            <div className="flex max-w-[68ch] flex-col gap-4 rounded-area bg-area p-4">
              <div className="flex flex-col gap-2">
                <span className="text-pequeno font-medio text-t1">Tipo de vídeo padrão</span>
                <div
                  role="radiogroup"
                  aria-label="Tipo de vídeo padrão"
                  onKeyDown={aoTeclarTipoVideo}
                  className="flex flex-col gap-1.5"
                >
                  <button
                    type="button"
                    role="radio"
                    data-video-kind="direct"
                    aria-checked={videoKind === 'direct'}
                    aria-describedby="desc-corte-direto"
                    tabIndex={videoKind === 'direct' ? 0 : -1}
                    onClick={() => setVideoKind('direct')}
                    className={cn(
                      'foco flex cursor-pointer flex-col items-start gap-0.5 rounded-controle border-0 px-3 py-2 text-left transition-colors duration-(--dur-rapida)',
                      videoKind === 'direct'
                        ? 'marcado bg-elevado text-t1'
                        : 'bg-chao/60 text-t2 hover:bg-hover hover:text-t1',
                    )}
                  >
                    <span className={cn(videoKind === 'direct' && 'font-medio')}>Corte direto</span>
                    <span id="desc-corte-direto" className="text-pequeno text-t3">
                      Canal de cortes — legenda e enquadramento, sem Roteiro ou Narração.
                    </span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    data-video-kind="transformed"
                    aria-checked={videoKind === 'transformed'}
                    aria-describedby="desc-video-transformado"
                    tabIndex={videoKind === 'transformed' ? 0 : -1}
                    onClick={() => setVideoKind('transformed')}
                    className={cn(
                      'foco flex cursor-pointer flex-col items-start gap-0.5 rounded-controle border-0 px-3 py-2 text-left transition-colors duration-(--dur-rapida)',
                      videoKind === 'transformed'
                        ? 'marcado bg-elevado text-t1'
                        : 'bg-chao/60 text-t2 hover:bg-hover hover:text-t1',
                    )}
                  >
                    <span className={cn(videoKind === 'transformed' && 'font-medio')}>
                      Vídeo transformado
                    </span>
                    <span id="desc-video-transformado" className="text-pequeno text-t3">
                      Canal dark — exige Roteiro revisado pelo usuário e Narração bloco a bloco.
                    </span>
                  </button>
                </div>
                <p className="text-pequeno text-t3">
                  Aviso único de monetização de Corte direto:{' '}
                  <strong className="font-medio text-t2">
                    {perfil?.directMonetizationAck ? 'já visualizado' : 'ainda não visualizado'}
                  </strong>
                  .
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Idioma principal">
                  {(props) => (
                    <Select
                      {...props}
                      rotulo="Idioma principal"
                      valor={idioma}
                      aoMudar={setIdioma}
                      opcoes={opcoesIdioma}
                    />
                  )}
                </Campo>

                <Campo rotulo="Voz padrão da Narração">
                  {(props) => (
                    <Select
                      {...props}
                      rotulo="Voz padrão da Narração"
                      valor={vozPadrao}
                      aoMudar={setVozPadrao}
                      opcoes={opcoesVoz}
                    />
                  )}
                </Campo>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-pequeno text-t2">Duração dos Cortes (máx. 180 s)</span>
                <div className="grid max-w-md grid-cols-2 gap-3">
                  <Campo rotulo="Duração mínima (s)">
                    {(props) => (
                      <Entrada
                        {...props}
                        type="number"
                        min={1}
                        max={179}
                        value={minSeg}
                        onChange={(e) => setMinSeg(e.target.value)}
                        className="num"
                      />
                    )}
                  </Campo>
                  <Campo rotulo="Duração máxima (s)">
                    {(props) => (
                      <Entrada
                        {...props}
                        type="number"
                        min={2}
                        max={180}
                        value={maxSeg}
                        onChange={(e) => setMaxSeg(e.target.value)}
                        className="num"
                      />
                    )}
                  </Campo>
                </div>
                {erroValidacaoPerfil && (
                  <p role="alert" className="flex items-start gap-1.5 text-pequeno text-erro">
                    <AlertCircle className="mt-px size-[13px] shrink-0" aria-hidden />
                    <span>{erroValidacaoPerfil}</span>
                  </p>
                )}
              </div>

              {captionStyle && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-pequeno font-medio text-t1">Estilo padrão de legenda</span>
                    <span className="text-pequeno text-t3">
                      Atualiza apenas o padrão para novos Cortes; Cortes já editados preservam sua revisão.
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Campo rotulo="Estilo de legenda">
                      {(props) => (
                        <Select
                          {...props}
                          rotulo="Estilo de legenda"
                          valor={captionStyle.preset}
                          aoMudar={(preset) => setCaptionStyle({ ...captionStyle, preset })}
                          opcoes={OPCOES_PRESET_LEGENDA}
                        />
                      )}
                    </Campo>
                    <Campo rotulo="Fonte da legenda">
                      {(props) => (
                        <Select
                          {...props}
                          rotulo="Fonte da legenda"
                          valor={captionStyle.font}
                          aoMudar={(font) => setCaptionStyle({ ...captionStyle, font })}
                          opcoes={OPCOES_FONTE_LEGENDA}
                        />
                      )}
                    </Campo>
                    <Campo rotulo="Tamanho (px)">
                      {(props) => (
                        <Entrada
                          {...props}
                          type="number"
                          min={24}
                          max={96}
                          value={captionStyle.fontSize}
                          onChange={(e) =>
                            setCaptionStyle({
                              ...captionStyle,
                              fontSize: Number(e.target.value) || 54,
                            })
                          }
                          className="num"
                        />
                      )}
                    </Campo>
                  </div>
                  <Checkbox
                    marcado={captionStyle.highlight}
                    aoMudar={(highlight) => setCaptionStyle({ ...captionStyle, highlight })}
                  >
                    Destaque karaokê por palavra falada
                  </Checkbox>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-pequeno font-medio text-t1">
                    Fontes e criadores permitidos ({allowedSources.length}/200)
                  </span>
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    icone={<Plus />}
                    onClick={() => setMostraFormFonte((v) => !v)}
                  >
                    Adicionar criador/canal
                  </Botao>
                </div>

                {mostraFormFonte && (
                  <div className="flex flex-col gap-2 rounded-controle bg-chao/60 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Campo rotulo="Nome do criador ou canal">
                        {(props) => (
                          <Entrada
                            {...props}
                            placeholder="Ex.: Podcast Exemplo"
                            value={novaFonteLabel}
                            onChange={(e) => setNovaFonteLabel(e.target.value)}
                          />
                        )}
                      </Campo>
                      <Campo rotulo="URL (opcional)">
                        {(props) => (
                          <Entrada
                            {...props}
                            placeholder="https://youtube.com/@canal"
                            value={novaFonteUrl}
                            onChange={(e) => setNovaFonteUrl(e.target.value)}
                          />
                        )}
                      </Campo>
                    </div>
                    <Campo rotulo="Observação da Permissão (opcional)">
                      {(props) => (
                        <Entrada
                          {...props}
                          placeholder="Ex.: Autorização por e-mail"
                          value={novaFonteNota}
                          onChange={(e) => setNovaFonteNota(e.target.value)}
                        />
                      )}
                    </Campo>
                    <div className="flex justify-end gap-2">
                      <Botao tamanho="p" onClick={() => setMostraFormFonte(false)}>
                        Cancelar
                      </Botao>
                      <Botao tamanho="p" variante="secundario" onClick={adicionarFontePermitida}>
                        Incluir na lista
                      </Botao>
                    </div>
                  </div>
                )}

                {allowedSources.length === 0 ? (
                  <EstadoTela
                    tipo="vazio"
                    compacto
                    titulo="Nenhuma Fonte permitida cadastrada ainda."
                    descricao="Cadastre criadores autorizados para agilizar a Permissão ao importar Fontes."
                  />
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {allowedSources.map((src, idx) => (
                      <li
                        key={`${src.label}-${idx}`}
                        className="flex items-center justify-between gap-3 rounded-controle bg-elevado px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-pequeno font-medio text-t1">{src.label}</p>
                          {(src.url || src.note) && (
                            <p className="truncate text-micro text-t3">
                              {[src.url, src.note].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                        <Botao
                          tamanho="p"
                          variante="fantasma"
                          icone={<Trash2 />}
                          aria-label={`Remover ${src.label}`}
                          onClick={() => removerFontePermitida(idx)}
                        >
                          Remover
                        </Botao>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-controle bg-chao/70 px-3 py-2.5 text-pequeno text-t2">
                Ritmo de publicação sugerido: publique em ritmo regular e moderado (por exemplo, 1 a 3
                vídeos por dia por canal) e evite enviar lotes grandes de vídeos parecidos em
                sequência, para reduzir risco de filtros de spam.
              </div>

              <div className="flex justify-end">
                <Botao variante="primario" carregando={ocupado} onClick={() => void salvarPerfil()}>
                  Salvar Perfil
                </Botao>
              </div>
            </div>
          )}

          {aba === 'privacidade' && (
            <div className="flex max-w-[68ch] flex-col gap-3 rounded-area bg-area p-4">
              <div className="flex items-center gap-2 text-t1">
                <Lock className="size-4 text-t3" aria-hidden />
                <h2 className="text-base font-forte">Privacidade e modo Somente local</h2>
              </div>

              <Switch
                ligado={somenteLocal}
                desabilitado={ocupado}
                aoMudar={(v) => void alternarSomenteLocal(v)}
              >
                Ativar veto Somente local para este Projeto
              </Switch>

              <p className="text-pequeno text-t2">
                Quando ligado, nenhuma chamada deste Projeto pode enviar texto ou áudio para fora
                deste computador (incluindo APIs remotas, Groq e CLIs). Este veto apenas bloqueia
                envios externos; ele nunca troca seu Provedor sozinho.
              </p>

              {somenteLocal && (
                <div role="status" className="rounded-controle bg-elevado px-3 py-2 text-pequeno text-t2">
                  As Tarefas de IA atribuídas a Provedores remotos ou CLIs ficam bloqueadas até
                  você escolher um Perfil local em{' '}
                  <a href="#/config/provedores" className="underline hover:text-t1">
                    Configurações → Provedores
                  </a>
                  .
                </div>
              )}
            </div>
          )}

          {aba === 'backups' && (
            <div className="flex flex-col gap-4">
              {warningVisivel && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-area bg-area px-3 py-2.5 text-pequeno text-t1"
                >
                  <AlertCircle className="mt-0.5 size-[15px] shrink-0 text-erro" aria-hidden />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medio">O último backup automático falhou</span>
                    <span className="text-t2">{warningVisivel.message}</span>
                  </div>
                </div>
              )}

              <div className="flex max-w-[68ch] flex-col gap-3 rounded-area bg-area p-4">
                <h2 className="text-base font-forte text-t1">Rotação automática de backups</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo
                    rotulo="Intervalo (segundos)"
                    ajuda={`Equivale a ${Math.max(1, Math.round(Number(intervaloSeg || 0) / 60))} min`}
                  >
                    {(props) => (
                      <Entrada
                        {...props}
                        type="number"
                        min={1}
                        step={1}
                        value={intervaloSeg}
                        onChange={(e) => setIntervaloSeg(e.target.value)}
                        className="num"
                      />
                    )}
                  </Campo>
                  <Campo rotulo="Cópias mantidas">
                    {(props) => (
                      <Entrada
                        {...props}
                        type="number"
                        min={1}
                        step={1}
                        value={copiasMantidas}
                        onChange={(e) => setCopiasMantidas(e.target.value)}
                        className="num"
                      />
                    )}
                  </Campo>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Botao
                    variante="secundario"
                    carregando={ocupado}
                    onClick={() =>
                      void salvarConfigBackup(Number(intervaloSeg), Number(copiasMantidas))
                    }
                  >
                    Salvar configuração
                  </Botao>
                  <Botao
                    variante="fantasma"
                    disabled={ocupado}
                    onClick={() =>
                      void salvarConfigBackup(
                        backupCfg?.default_interval_seconds ?? 1800,
                        backupCfg?.default_copies ?? 10,
                      )
                    }
                  >
                    Restaurar padrão (30 min · 10 cópias)
                  </Botao>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-area bg-area p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-forte text-t1">
                    Backups salvos ({backupsVisiveis.length})
                  </h2>
                  <Botao
                    variante="primario"
                    carregando={ocupado}
                    onClick={() => void criarBackupAgora()}
                  >
                    Criar backup agora
                  </Botao>
                </div>

                {jobsAtivos > 0 && (
                  <Status tom="aviso" forte>
                    Há {jobsAtivos} tarefa(s) em andamento na Fila. Aguarde concluir ou cancele na
                    Fila para restaurar um backup.
                  </Status>
                )}

                {carregandoBackups ? (
                  <Esqueleto variante="lista" quantidade={3} />
                ) : backupsVisiveis.length === 0 ? (
                  <EstadoTela
                    tipo="vazio"
                    compacto
                    titulo="Nenhum backup salvo ainda."
                    descricao="Crie uma cópia imediata do banco do Projeto antes de fazer alterações grandes."
                    acaoPrimaria={{
                      rotulo: 'Criar primeiro backup agora',
                      aoAcionar: () => void criarBackupAgora(),
                    }}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <TabelaGrade
                      rotulo="Backups do Projeto"
                      linhas={backupsVisiveis}
                      colunas={colunasBackups}
                      obterId={(b) => b.id}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ComEstado>

      <ConfirmDialog
        aberto={backupParaRestaurar !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setBackupParaRestaurar(null)
        }}
        titulo={
          backupParaRestaurar
            ? `Restaurar backup de ${formatarDataHora(backupParaRestaurar.created_at)}?`
            : 'Restaurar backup?'
        }
        descricao="Restaurar este backup substituirá o estado atual do Projeto. O estado atual será preservado em uma cópia 'Pré-restauração' antes da troca. Deseja continuar?"
        rotuloCancelar="Cancelar"
        rotuloConfirmar="Restaurar backup"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={ocupado}
        aoConfirmar={confirmarRestauracao}
      />
    </ConfiguracoesLayout>
  )
}
