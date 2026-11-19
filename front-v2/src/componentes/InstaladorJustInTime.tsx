import {
  BannerErroCore,
  Botao,
  Checkbox,
  Dialogo,
  Dica,
  Esqueleto,
  Progresso,
  Status,
  tamanho,
} from '@ds'
import { Download } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'

export type RecursoJustInTime = 'url_import' | 'yunet' | 'tts'

export type InstaladorJustInTimeProps = {
  recurso: RecursoJustInTime
  idioma?: 'pt' | 'en'
  modo?: 'inline' | 'modal'
  varianteAcao?: 'primario' | 'secundario'
  aberto?: boolean
  aoFechar?: () => void
  aoConcluir: () => void
}

type ManifestoItem = {
  id: string
  version: string
  size: number
  license: string
  source_url: string
}

type ModeloWorkerItem = {
  id: string
  label: string
  license: string
  source_url: string
  size: number
  installed: boolean
  worker_installed: boolean
}

type TtsMotor = {
  id: string
  label: string
  componentId: string
  codeLicense?: string
  sourceUrl?: string
  prohibitedUse?: {
    textEn?: string
    summaryPt?: string
    version?: string
  }
}

type TtsModelo = {
  id: string
  engineId: string
  language: string
  label: string
  description?: string
  defaultForLanguage?: boolean
  active?: boolean
  installed: boolean
  updateAvailable?: boolean
  termsAccepted?: boolean
  license?: string
  sourceUrl?: string
  size: number
}

type TtsCatalogo = {
  componentInstalled?: boolean
  activeModels?: Record<string, string>
  engines?: TtsMotor[]
  models?: TtsModelo[]
}

type ConfigComponentes = {
  data_dir: string
  cache_dir: string
  cache_limit_bytes: number
}

type ConfigUrl = {
  terms_accepted: boolean
  download_dir: string
}

type ItemPendente = {
  chave: string
  nome: string
  instalado: boolean
  bytes?: number
  licenca?: string
  origem?: string
  nota?: string
  indisponivelManifesto?: boolean
}

type JobAtivo = {
  jobId: string
  rotulo: string
  tipoCancelamento: 'componente' | 'tts'
  cancelId: string
}

type DadosCarregados = {
  itens: ItemPendente[]
  destino: string
  pronto: boolean
  precisaTermoUrl: boolean
  downloadDir: string
  termoTts?: {
    summaryPt: string
    textEn?: string
  }
  ttsModeloId?: string
  workerInstalado?: boolean
  ytdlpInstalado?: boolean
  denoInstalado?: boolean
  yunetInstalado?: boolean
  pocketTtsInstalado?: boolean
  ttsModeloInstalado?: boolean
  indisponivelPlataforma: boolean
}

function formatarBytes(bytes: number): string {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1000))} KB`
  }
  return tamanho(bytes)
}

function dominioDe(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function traduzirErroJit(erro: ErroCore): { titulo: string; explicacao?: string } {
  switch (erro.code) {
    case 'component_integrity':
      return {
        titulo: 'O arquivo do yt-dlp não passou na verificação de integridade. Reinstale para continuar.',
      }
    case 'terms_acceptance_required':
      return {
        titulo: 'Marque a caixa confirmando os termos de uso antes de baixar o modelo de voz.',
      }
    case 'hash_mismatch':
    case 'download':
      return {
        titulo: 'Falha ao baixar ou verificar o arquivo. Você pode retomar de onde parou.',
      }
    case 'unknown_component':
      // Pendência de manifesto macOS (#301)
      return {
        titulo:
          'Este componente ainda não tem instalador automático para este sistema operacional.',
      }
    case 'cancelled':
      return {
        titulo: 'Download cancelado.',
      }
    default:
      return mensagemDeErro(erro)
  }
}

// Pendência de manifesto macOS (#301)
const DICA_INDISPONIVEL_PLATAFORMA =
  'Download automático indisponível nesta plataforma; disponível em breve.'

const TITULO_ACAO: Record<RecursoJustInTime, string> = {
  url_import: 'baixar vídeos por URL',
  yunet: 'detectar rostos no reenquadramento automático 9:16',
  tts: 'gerar Narração por voz local',
}

/** Instalador sob demanda para `yt-dlp`/`deno`, `YuNet` e `pocket-tts` em modo `inline` ou `modal`. */
export function InstaladorJustInTime({
  recurso,
  idioma = 'pt',
  modo = 'inline',
  varianteAcao = 'primario',
  aberto = true,
  aoFechar,
  aoConcluir,
}: InstaladorJustInTimeProps) {
  const jobs = useFila()
  const [carregando, setCarregando] = useState(true)
  const [dados, setDados] = useState<DadosCarregados | null>(null)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [termoUrlAceito, setTermoUrlAceito] = useState(false)
  const [termoTtsAceito, setTermoTtsAceito] = useState(false)
  const [jobAtivo, setJobAtivo] = useState<JobAtivo | null>(null)
  const [reinstalarYtdlp, setReinstalarYtdlp] = useState(false)

  const concluiuRef = useRef(false)
  const seqRef = useRef(0)

  const notificarConclusao = useCallback(() => {
    if (concluiuRef.current) return
    concluiuRef.current = true
    aoConcluir()
  }, [aoConcluir])

  const carregar = useCallback(async () => {
    const seq = ++seqRef.current
    setCarregando(true)
    setErro(null)
    setReinstalarYtdlp(false)

    try {
      if (recurso === 'url_import') {
        const [resManifesto, resConfig, resYtdlp, resDeno, resUrl] = await Promise.all([
          chamar<ManifestoItem[]>('components.manifest', {}),
          chamar<ConfigComponentes>('components.settings.get', {}),
          chamar<{ installed: boolean; version?: string }>('components.ytdlp.status', {}).then(
            (v) => ({ ok: true as const, value: v }),
            (e) => ({ ok: false as const, reason: e }),
          ),
          chamar<{ installed: boolean; version?: string | null }>('components.deno.status', {}).then(
            (v) => ({ ok: true as const, value: v }),
            (e) => ({ ok: false as const, reason: e }),
          ),
          chamar<ConfigUrl>('sources.url.settings.get', {}).then(
            (v) => ({ ok: true as const, value: v }),
            (e) => ({ ok: false as const, reason: e }),
          ),
        ])
        if (seq !== seqRef.current) return

        const manifesto = new Map((resManifesto ?? []).map((m) => [m.id, m]))
        const destino = resConfig?.data_dir ?? ''

        let ytdlpErroIntegridade = false
        let ytdlpInstalado = false
        if (resYtdlp.ok) {
          ytdlpInstalado = Boolean(resYtdlp.value?.installed)
        } else {
          const e = paraErroCore(resYtdlp.reason)
          if (e.code === 'component_integrity') {
            ytdlpErroIntegridade = true
            setErro(e)
            setReinstalarYtdlp(true)
          } else {
            throw e
          }
        }

        const denoInstalado = resDeno.ok ? Boolean(resDeno.value?.installed) : false
        const urlCfg = resUrl.ok
          ? resUrl.value
          : { terms_accepted: false, download_dir: '' }

        const mYtdlp = manifesto.get('yt-dlp')
        const mDeno = manifesto.get('deno')
        const precisaTermoUrl = !urlCfg.terms_accepted
        const pronto =
          !ytdlpErroIntegridade && ytdlpInstalado && denoInstalado && !precisaTermoUrl

        const itens: ItemPendente[] = [
          {
            chave: 'yt-dlp',
            nome: 'yt-dlp — extrator de vídeo por URL',
            instalado: ytdlpInstalado && !ytdlpErroIntegridade,
            bytes: mYtdlp?.size,
            licenca: mYtdlp?.license ?? 'Unlicense',
            origem: dominioDe(mYtdlp?.source_url),
            indisponivelManifesto: !ytdlpInstalado && !mYtdlp,
          },
          {
            chave: 'deno',
            nome: 'deno — runtime JavaScript (YouTube)',
            instalado: denoInstalado,
            bytes: mDeno?.size,
            licenca: mDeno?.license ?? 'MIT',
            origem: dominioDe(mDeno?.source_url),
            indisponivelManifesto: !denoInstalado && !mDeno,
          },
        ]

        const prox: DadosCarregados = {
          itens,
          destino,
          pronto,
          precisaTermoUrl,
          downloadDir: urlCfg.download_dir ?? '',
          ytdlpInstalado: ytdlpInstalado && !ytdlpErroIntegridade,
          denoInstalado,
          indisponivelPlataforma: itens.some((i) => !i.instalado && i.indisponivelManifesto),
        }
        setDados(prox)
        setTermoUrlAceito(Boolean(urlCfg.terms_accepted))
        setCarregando(false)
        if (pronto) notificarConclusao()
        return
      }

      const [resManifesto, resConfig] = await Promise.all([
        chamar<ManifestoItem[]>('components.manifest', {}),
        chamar<ConfigComponentes>('components.settings.get', {}),
      ])
      if (seq !== seqRef.current) return

      const manifesto = new Map((resManifesto ?? []).map((m) => [m.id, m]))
      const destino = resConfig?.data_dir ?? ''

      if (recurso === 'yunet') {
        const [resWorker, resModelos] = await Promise.all([
          chamar<{ installed: boolean }>('components.worker.status', {}),
          chamar<ModeloWorkerItem[]>('components.models.manifest', {}),
        ])
        if (seq !== seqRef.current) return

        const workerInstalado = Boolean(resWorker?.installed)
        const yunet = (resModelos ?? []).find((m) => m.id === 'yunet')
        const yunetInstalado = Boolean(yunet?.installed)
        const mUv = manifesto.get('uv')
        const pronto = workerInstalado && yunetInstalado

        const itens: ItemPendente[] = [
          {
            chave: 'worker',
            nome: 'Ambiente Python isolado (Worker)',
            instalado: workerInstalado,
            licenca: mUv?.license ?? 'Apache-2.0',
            // Tamanho varia por CUDA/CPU (#307)
            nota: workerInstalado
              ? undefined
              : 'Tamanho variável conforme ambiente CUDA/CPU',
            indisponivelManifesto: !workerInstalado && !mUv,
          },
          {
            chave: 'yunet',
            nome: yunet?.label || 'YuNet — detector de rostos',
            instalado: yunetInstalado,
            bytes: yunet?.size ?? 232_589,
            licenca: yunet?.license ?? 'MIT',
            origem: dominioDe(yunet?.source_url),
          },
        ]

        const prox: DadosCarregados = {
          itens,
          destino,
          pronto,
          precisaTermoUrl: false,
          downloadDir: '',
          workerInstalado,
          yunetInstalado,
          indisponivelPlataforma: itens.some((i) => !i.instalado && i.indisponivelManifesto),
        }
        setDados(prox)
        setCarregando(false)
        if (pronto) notificarConclusao()
        return
      }

      // recurso === 'tts'
      const [resPocket, resCatalogo] = await Promise.all([
        chamar<{ installed: boolean }>('components.pocket_tts.status', {}),
        chamar<TtsCatalogo>('tts.catalog', {}),
      ])
      if (seq !== seqRef.current) return

      const pocketInstalado = Boolean(resPocket?.installed)
      const ativoId = resCatalogo?.activeModels?.[idioma]
      const modelos = resCatalogo?.models ?? []
      const modelo =
        modelos.find((m) => m.id === ativoId) ??
        modelos.find((m) => m.language === idioma && m.defaultForLanguage) ??
        modelos.find((m) => m.language === idioma) ??
        modelos[0]
      const modeloInstalado = Boolean(modelo?.installed)
      const motor = (resCatalogo?.engines ?? []).find((e) => e.id === (modelo?.engineId ?? 'pocket-tts'))
      const mPocket = manifesto.get('pocket-tts')
      const pronto = pocketInstalado && modeloInstalado

      const itens: ItemPendente[] = [
        {
          chave: 'pocket-tts',
          nome: 'pocket-tts — motor de voz local',
          instalado: pocketInstalado,
          bytes: mPocket?.size,
          licenca: mPocket?.license ?? motor?.codeLicense ?? 'MIT',
          origem: dominioDe(mPocket?.source_url ?? motor?.sourceUrl),
          indisponivelManifesto: !pocketInstalado && !mPocket,
        },
        ...(modelo
          ? [
              {
                chave: `tts:${modelo.id}`,
                nome: modelo.label,
                instalado: modeloInstalado,
                bytes: modelo.size,
                licenca: modelo.license ?? 'CC-BY-4.0',
                origem: dominioDe(modelo.sourceUrl),
              },
            ]
          : []),
      ]

      const prox: DadosCarregados = {
        itens,
        destino,
        pronto,
        precisaTermoUrl: false,
        downloadDir: '',
        termoTts:
          !modeloInstalado && motor?.prohibitedUse?.summaryPt
            ? {
                summaryPt: motor.prohibitedUse.summaryPt,
                textEn: motor.prohibitedUse.textEn,
              }
            : undefined,
        ttsModeloId: modelo?.id,
        pocketTtsInstalado: pocketInstalado,
        ttsModeloInstalado: modeloInstalado,
        indisponivelPlataforma: itens.some((i) => !i.instalado && i.indisponivelManifesto),
      }
      setDados(prox)
      setTermoTtsAceito(Boolean(modelo?.termsAccepted))
      setCarregando(false)
      if (pronto) notificarConclusao()
    } catch (err) {
      if (seq !== seqRef.current) return
      setErro(paraErroCore(err))
      setCarregando(false)
    }
  }, [idioma, notificarConclusao, recurso])

  useEffect(() => {
    concluiuRef.current = false
    void carregar()
  }, [carregar])

  const jobFilaAtual = useMemo(() => {
    if (!jobAtivo) return undefined
    return jobs.find((j) => j.id === jobAtivo.jobId)
  }, [jobAtivo, jobs])

  async function instalar(forcarYtdlp = false) {
    if (!dados) return
    setErro(null)
    setReinstalarYtdlp(false)

    try {
      if (recurso === 'url_import') {
        if (dados.precisaTermoUrl) {
          await chamar('sources.url.settings.set', {
            terms_accepted: true,
            download_dir: dados.downloadDir,
          })
        }
        if (forcarYtdlp || !dados.ytdlpInstalado) {
          setJobAtivo({
            jobId: 'yt-dlp',
            rotulo: 'Baixando yt-dlp…',
            tipoCancelamento: 'componente',
            cancelId: 'yt-dlp',
          })
          await chamar('components.download', { id: 'yt-dlp', confirmed: true })
        }
        if (!dados.denoInstalado) {
          setJobAtivo({
            jobId: 'deno',
            rotulo: 'Baixando deno…',
            tipoCancelamento: 'componente',
            cancelId: 'deno',
          })
          await chamar('components.download', { id: 'deno', confirmed: true })
        }
      } else if (recurso === 'yunet') {
        if (!dados.workerInstalado) {
          setJobAtivo({
            jobId: 'worker',
            rotulo: 'Preparando ambiente Python isolado…',
            tipoCancelamento: 'componente',
            cancelId: 'worker',
          })
          await chamar('components.worker.install', { confirmed: true })
        }
        if (!dados.yunetInstalado) {
          setJobAtivo({
            jobId: 'yunet',
            rotulo: 'Baixando YuNet…',
            tipoCancelamento: 'componente',
            cancelId: 'yunet',
          })
          await chamar('components.models.download', { id: 'yunet', confirmed: true })
        }
      } else if (recurso === 'tts') {
        if (!dados.pocketTtsInstalado) {
          setJobAtivo({
            jobId: 'pocket-tts',
            rotulo: 'Baixando pocket-tts…',
            tipoCancelamento: 'componente',
            cancelId: 'pocket-tts',
          })
          await chamar('components.download', { id: 'pocket-tts', confirmed: true })
        }
        if (dados.ttsModeloId && !dados.ttsModeloInstalado) {
          setJobAtivo({
            jobId: `tts:${dados.ttsModeloId}`,
            rotulo: 'Baixando modelo TTS…',
            tipoCancelamento: 'tts',
            cancelId: dados.ttsModeloId,
          })
          await chamar('tts.models.download', {
            id: dados.ttsModeloId,
            confirmed: true,
            termsAccepted: true,
          })
        }
      }

      setJobAtivo(null)
      notificarConclusao()
    } catch (err) {
      setJobAtivo(null)
      const coreErr = paraErroCore(err)
      if (coreErr.code === 'component_integrity') {
        setReinstalarYtdlp(true)
      }
      setErro(coreErr)
    }
  }

  async function cancelarDownload() {
    if (!jobAtivo) return
    const alvo = jobAtivo
    try {
      if (alvo.tipoCancelamento === 'tts') {
        await chamar('tts.models.cancel', { id: alvo.cancelId })
      } else {
        await chamar('components.cancel', { id: alvo.cancelId })
      }
    } finally {
      setJobAtivo(null)
    }
  }

  if (carregando) {
    const esqueleto = (
      <div className="rounded-area bg-area p-3">
        <Esqueleto variante="lista" quantidade={2} rotuloAcessivel="Verificando requisitos" />
      </div>
    )
    if (modo === 'modal') {
      return (
        <Dialogo
          aberto={aberto}
          aoMudarAberto={(v) => {
            if (!v) aoFechar?.()
          }}
          titulo="Recurso necessário para esta ação"
          largura={520}
        >
          {esqueleto}
        </Dialogo>
      )
    }
    return esqueleto
  }

  if (dados?.pronto && !erro && !jobAtivo) {
    return null
  }

  const precisaAceiteUrl = Boolean(dados?.precisaTermoUrl && !termoUrlAceito)
  const precisaAceiteTts = Boolean(dados?.termoTts && !termoTtsAceito)
  const bloqueadoPorPlataforma = Boolean(dados?.indisponivelPlataforma)
  const desabilitarBaixar =
    Boolean(jobAtivo) || bloqueadoPorPlataforma || precisaAceiteUrl || precisaAceiteTts

  const botaoBaixar = (
    <Botao
      variante={varianteAcao}
      icone={<Download />}
      disabled={desabilitarBaixar}
      onClick={() => void instalar(false)}
    >
      Baixar e continuar
    </Botao>
  )

  const acaoBaixar = bloqueadoPorPlataforma ? (
    <Dica texto={DICA_INDISPONIVEL_PLATAFORMA}>
      <span className="inline-flex">
        {botaoBaixar}
      </span>
    </Dica>
  ) : (
    botaoBaixar
  )

  const conteudo = (
    <div className="flex flex-col gap-3">
      <p className="text-base text-t2">
        Para <strong className="font-medio text-t1">{TITULO_ACAO[recurso]}</strong>, o Clipes
        precisa instalar:
      </p>

      {erro && (
        <BannerErroCore
          erro={{ code: erro.code, message: erro.detalhe || erro.message }}
          traduzir={() => traduzirErroJit(erro)}
          acaoRecuperacao={
            reinstalarYtdlp
              ? {
                  rotulo: 'Reinstalar yt-dlp',
                  aoAcionar: () => void instalar(true),
                }
              : erro.code === 'hash_mismatch' || erro.code === 'download'
                ? {
                    rotulo: 'Tentar novamente',
                    aoAcionar: () => void instalar(false),
                  }
                : undefined
          }
          permitirRelato
        />
      )}

      {dados && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {dados.itens.map((item) => (
            <li
              key={item.chave}
              className="flex flex-col gap-1 rounded-controle bg-elevado px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medio text-t1">{item.nome}</span>
                {item.instalado ? (
                  <Status tom="sucesso">Instalado</Status>
                ) : (
                  <span className="num text-pequeno text-t3">
                    {[
                      item.bytes != null ? formatarBytes(item.bytes) : null,
                      item.licenca,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </div>
              {!item.instalado && item.origem && (
                <span className="font-mono text-pequeno text-t3">Origem: {item.origem}</span>
              )}
              {!item.instalado && item.nota && (
                <span className="text-pequeno text-t3">{item.nota}</span>
              )}
              {!item.instalado && item.indisponivelManifesto && (
                // Pendência de manifesto macOS (#301)
                <span className="text-pequeno text-t2">
                  Download automático indisponível nesta plataforma.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {dados?.precisaTermoUrl && (
        <Checkbox
          marcado={termoUrlAceito}
          aoMudar={setTermoUrlAceito}
          desabilitado={Boolean(jobAtivo)}
          className="text-pequeno"
        >
          Confirmo que tenho direito de uso do material e não contornarei proteção DRM ou login
          privado.
        </Checkbox>
      )}

      {dados?.termoTts && (
        <div className="flex flex-col gap-2 rounded-controle bg-elevado px-3 py-2.5">
          <strong className="text-pequeno font-medio text-t1">Termo de uso responsável</strong>
          <p className="text-pequeno text-t2">{dados.termoTts.summaryPt}</p>
          {dados.termoTts.textEn && (
            <details className="text-pequeno text-t3">
              <summary className="foco w-fit cursor-pointer rounded-controle hover:text-t2">
                Ver texto original completo
              </summary>
              <p className="mt-1 text-t2">{dados.termoTts.textEn}</p>
            </details>
          )}
          <Checkbox
            marcado={termoTtsAceito}
            aoMudar={setTermoTtsAceito}
            desabilitado={Boolean(jobAtivo)}
            className="text-pequeno"
          >
            Li e concordo com os termos de uso deste modelo de voz
          </Checkbox>
        </div>
      )}

      {dados?.destino && (
        <p className="truncate font-mono text-pequeno text-t3">Destino: {dados.destino}</p>
      )}

      {jobAtivo && (
        <div className="flex items-center gap-3 rounded-controle bg-elevado px-3 py-2">
          <Progresso
            valor={jobFilaAtual?.percentual ?? 0}
            rotulo={jobFilaAtual?.mensagem || jobAtivo.rotulo}
            className="flex-1"
          />
          <Botao tamanho="p" variante="secundario" onClick={() => void cancelarDownload()}>
            Cancelar
          </Botao>
        </div>
      )}

      {modo === 'inline' && (
        <div className="flex items-center justify-end gap-2 pt-1">
          {aoFechar && !jobAtivo && (
            <Botao variante="fantasma" onClick={aoFechar}>
              Agora não
            </Botao>
          )}
          {acaoBaixar}
        </div>
      )}
    </div>
  )

  if (modo === 'modal') {
    return (
      <Dialogo
        aberto={aberto}
        aoMudarAberto={(v) => {
          if (!v && !jobAtivo) aoFechar?.()
        }}
        titulo="Recurso necessário para esta ação"
        largura={520}
        rodape={
          <>
            {aoFechar && (
              <Botao variante="fantasma" disabled={Boolean(jobAtivo)} onClick={aoFechar}>
                Cancelar
              </Botao>
            )}
            {acaoBaixar}
          </>
        }
      >
        {conteudo}
      </Dialogo>
    )
  }

  return (
    <section
      aria-label="Instalação necessária"
      className="flex flex-col gap-3 rounded-area bg-area p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-forte text-t1">Recurso necessário para esta ação</h3>
        <span className="text-pequeno text-t3">Instalação sob demanda</span>
      </div>
      {conteudo}
    </section>
  )
}
