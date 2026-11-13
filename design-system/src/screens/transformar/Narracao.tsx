import { ArrowDownToLine, Mic, Pause, Play, Square, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Abas } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { NumberScrub } from '@/components/ui/NumberScrub'
import { Progresso } from '@/components/ui/Progress'
import { Select } from '@/components/ui/Select'
import { Status } from '@/components/ui/Status'
import { Switch } from '@/components/ui/Switch'
import { avisar } from '@/components/ui/Toast'
import { useComandos } from '@/lib/comandos'
import { bytes, tc } from '@/lib/formato'
import { ir } from '@/lib/rota'
import type { ModoNarracao, Transformacao } from './modelo'

type Props = {
  edicao: Transformacao
  mudar: (v: Partial<Transformacao>) => void
  aprovado: boolean
  ativo: boolean
}

export function Narracao({ edicao, mudar, aprovado, ativo }: Props) {
  const [erro, setErro] = useState('')
  const [etapa, setEtapa] = useState<'parado' | 'permissao' | 'gravando' | 'pausado'>('parado')
  const [segundos, setSegundos] = useState(0)
  const [velocidade, setVelocidade] = useState(24)
  const [progresso, setProgresso] = useState<number | null>(null)
  const arquivo = useRef<HTMLInputElement>(null)
  const teleprompter = useRef<HTMLDivElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const ocupado = useRef(false)
  const montagem = useRef(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const ultima = useRef({ edicao, mudar, aprovado, ativo })
  ultima.current = { edicao, mudar, aprovado, ativo }

  function parar() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (montagem.current) setEtapa('parado')
  }

  useEffect(() => {
    montagem.current = true
    return () => {
      montagem.current = false
      if (timer.current) clearInterval(timer.current)
      parar()
    }
  }, [])
  useEffect(() => {
    if (!ativo || !aprovado || edicao.modo !== 'voz') parar()
  }, [ativo, aprovado, edicao.modo])
  useEffect(() => {
    if (etapa !== 'gravando') return
    const inicio = Date.now()
    const base = segundos
    const id = window.setInterval(() => {
      setSegundos(base + (Date.now() - inicio) / 1000)
      if (teleprompter.current) teleprompter.current.scrollTop += velocidade / 10
    }, 100)
    return () => clearInterval(id)
  }, [etapa, velocidade])

  function guardarAudio(url: string, nome: string, origem: 'gravacao' | 'arquivo', roteiro: string) {
    const atual = ultima.current
    if (atual.edicao.audio) URL.revokeObjectURL(atual.edicao.audio.url)
    atual.mudar({ audio: { url, nome, origem, roteiro } })
  }

  async function gravar() {
    if (!aprovado || ocupado.current || etapa !== 'parado') return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErro('Este navegador não oferece gravação. Importe um arquivo de áudio.')
      return
    }
    ocupado.current = true
    setErro('')
    setEtapa('permissao')
    try {
      const captura = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (
        !montagem.current ||
        !ultima.current.ativo ||
        !ultima.current.aprovado ||
        ultima.current.edicao.modo !== 'voz'
      ) {
        captura.getTracks().forEach((t) => t.stop())
        return
      }
      stream.current = captura
      const roteiroGravado = ultima.current.edicao.roteiro
      const gravador = new MediaRecorder(captura)
      recorder.current = gravador
      const partes: Blob[] = []
      gravador.ondataavailable = (evento) => {
        if (evento.data.size) partes.push(evento.data)
      }
      gravador.onstop = () => {
        captura.getTracks().forEach((t) => t.stop())
        if (!partes.length) return
        const blob = new Blob(partes, { type: gravador.mimeType })
        const extensao = gravador.mimeType.includes('mp4') ? 'm4a' : gravador.mimeType.includes('ogg') ? 'ogg' : 'webm'
        guardarAudio(URL.createObjectURL(blob), `Minha Narração.${extensao}`, 'gravacao', roteiroGravado)
        if (montagem.current) setEtapa('parado')
        avisar.sucesso('Gravação disponível nesta sessão')
      }
      gravador.onerror = () => {
        setErro('A gravação foi interrompida. Confira o microfone e tente novamente.')
        parar()
      }
      setSegundos(0)
      if (teleprompter.current) teleprompter.current.scrollTop = 0
      gravador.start(250)
      setEtapa('gravando')
    } catch (e) {
      const nome = e instanceof DOMException ? e.name : ''
      setErro(
        nome === 'NotAllowedError'
          ? 'Permissão do microfone negada. Libere o acesso no navegador ou importe um áudio.'
          : 'Não foi possível acessar o microfone. Verifique a conexão e tente novamente.',
      )
      parar()
    } finally {
      ocupado.current = false
    }
  }

  async function importar(file?: File) {
    if (!file || !ultima.current.aprovado) return
    const roteiroImportado = ultima.current.edicao.roteiro
    setErro('')
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|ogg|webm|flac)$/i.test(file.name)) {
      setErro('Escolha um arquivo de áudio WAV, MP3, M4A, OGG, WebM ou FLAC.')
      return
    }
    if (file.size > 100 * 1000 * 1000) {
      setErro('O áudio deve ter até 100 MB.')
      return
    }
    const url = URL.createObjectURL(file)
    try {
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio()
        audio.onloadedmetadata = () => {
          audio.removeAttribute('src')
          resolve()
        }
        audio.onerror = () => {
          audio.removeAttribute('src')
          reject(new Error('formato'))
        }
        audio.src = url
      })
      if (!montagem.current || !ultima.current.aprovado || ultima.current.edicao.roteiro !== roteiroImportado) {
        URL.revokeObjectURL(url)
        return
      }
      guardarAudio(url, file.name, 'arquivo', roteiroImportado)
      avisar.sucesso('Áudio importado nesta sessão', bytes(file.size))
    } catch {
      URL.revokeObjectURL(url)
      setErro('Este áudio não pôde ser lido. Tente WAV ou MP3.')
    }
  }

  function demonstrar(tipo: 'download' | 'tts') {
    if (progresso !== null || (tipo === 'tts' && !aprovado)) return
    setProgresso(0)
    let p = 0
    timer.current = setInterval(() => {
      p += 0.2
      if (p >= 1) {
        if (timer.current) clearInterval(timer.current)
        setProgresso(null)
        ultima.current.mudar(tipo === 'download' ? { modeloPronto: true } : { ttsDemonstrado: true })
        avisar(
          tipo === 'download' ? 'Fluxo de download demonstrado' : 'Fluxo de Narração demonstrado',
          tipo === 'download' ? 'Nenhum modelo foi baixado.' : 'Nenhum áudio foi gerado.',
        )
      } else setProgresso(p)
    }, 160)
  }

  function mudarModo(modo: ModoNarracao) {
    parar()
    setErro('')
    mudar({ modo })
  }
  function pausar() {
    if (recorder.current?.state === 'recording') {
      recorder.current.pause()
      setEtapa('pausado')
    } else if (recorder.current?.state === 'paused') {
      recorder.current.resume()
      setEtapa('gravando')
    }
  }

  useComandos(
    ativo
      ? [
          {
            id: 'narracao-gravar',
            titulo: etapa === 'gravando' || etapa === 'pausado' ? 'Parar gravação' : 'Iniciar gravação',
            grupo: 'Narração',
            atalho: 'Ctrl+R',
            desabilitado: !aprovado || edicao.modo !== 'voz',
            executar: () => (etapa === 'parado' ? void gravar() : parar()),
          },
          {
            id: 'narracao-importar',
            titulo: 'Importar áudio para Narração',
            grupo: 'Narração',
            desabilitado: !aprovado,
            executar: () => {
              mudarModo('arquivo')
              arquivo.current?.click()
            },
          },
          {
            id: 'narracao-ducking',
            titulo: edicao.ducking ? 'Desativar ducking' : 'Ativar ducking',
            grupo: 'Narração',
            executar: () => mudar({ ducking: !edicao.ducking }),
          },
          {
            id: 'narracao-tts',
            titulo: 'Demonstrar geração de Narração',
            grupo: 'Narração',
            desabilitado: !aprovado || !edicao.modeloPronto || progresso !== null,
            executar: () => demonstrar('tts'),
          },
        ]
      : [],
  )

  return (
    <div className="flex-1 overflow-auto px-4 py-4">
      {!aprovado && (
        <div className="mb-5">
          <Status tom="atencao">Aprove e salve o Roteiro para começar.</Status>
        </div>
      )}
      <Abas
        valor={edicao.modo}
        onChange={mudarModo}
        rotulo="Origem da Narração"
        abas={[
          { valor: 'tts', rotulo: 'TTS' },
          { valor: 'voz', rotulo: 'Voz do usuário' },
          { valor: 'arquivo', rotulo: 'Áudio importado' },
        ]}
      />
      <div className="pt-5">
        {edicao.modo === 'tts' ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">Uma voz lê a versão que você revisou.</p>
            <div>
              <label className="mb-2 block text-xs text-fg-2">Voz em português</label>
              <Select
                valor={edicao.voz}
                onChange={(voz) => mudar({ voz, ttsDemonstrado: false })}
                rotulo="Voz em português"
                opcoes={[
                  { valor: 'pf_dora', rotulo: 'Dora · Kokoro', descricao: 'Português brasileiro · feminina' },
                  { valor: 'pm_alex', rotulo: 'Alex · Kokoro', descricao: 'Português brasileiro · masculina' },
                ]}
                className="w-full"
              />
            </div>
            <div className="border-y border-line py-4">
              <div className="flex items-center justify-between text-sm">
                <span>Modelo Kokoro</span>
                <span className="timecode text-xs text-fg-3">326 MB</span>
              </div>
              <p className="mt-2 text-xs text-fg-3">Apache-2.0 · roda localmente após o download.</p>
              <p className="mt-3 text-xs leading-relaxed text-fg-3">
                Demonstração de interface: o modelo não é baixado e o TTS não gera áudio aqui.
              </p>
              {edicao.modeloPronto ? (
                <div className="mt-3">
                  <Status tom="info">Download demonstrado</Status>
                </div>
              ) : (
                <Button
                  className="mt-3"
                  tamanho="sm"
                  icone={<ArrowDownToLine size={14} />}
                  disabled={progresso !== null}
                  onClick={() => demonstrar('download')}
                >
                  Demonstrar download
                </Button>
              )}
              <Button tamanho="sm" variante="fantasma" className="mt-3 ml-1" onClick={() => ir('/config/componentes')}>
                Ver Componentes
              </Button>
            </div>
            {progresso !== null && <Progresso valor={progresso} rotulo="Progresso da demonstração" />}
            <Button
              onClick={() => demonstrar('tts')}
              disabled={!aprovado || !edicao.modeloPronto || progresso !== null}
            >
              Demonstrar Narração
            </Button>
            {edicao.ttsDemonstrado && (
              <div role="status">
                <Status tom="info">Fluxo concluído · nenhum áudio gerado</Status>
              </div>
            )}
          </div>
        ) : edicao.modo === 'voz' ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">Leia o Roteiro no teleprompter. O áudio fica neste dispositivo.</p>
            <div
              ref={teleprompter}
              tabIndex={0}
              aria-label="Teleprompter"
              className="foco h-48 overflow-auto rounded-md bg-field px-4 py-5 text-lg leading-[1.85] text-fg whitespace-pre-wrap"
            >
              {edicao.roteiro || 'Escreva seu Roteiro primeiro.'}
            </div>
            <NumberScrub
              rotulo="Rolagem"
              unidade="px/s"
              valor={velocidade}
              onChange={(v) => setVelocidade(v ?? 24)}
              min={5}
              max={80}
              passo={1}
            />
            <div className="flex items-center gap-2">
              {etapa === 'parado' ? (
                <Button icone={<Mic size={14} />} disabled={!aprovado} onClick={() => void gravar()} atalho="Ctrl+R">
                  Iniciar gravação
                </Button>
              ) : etapa === 'permissao' ? (
                <Status tom="andamento">Aguardando permissão do microfone…</Status>
              ) : (
                <>
                  <Button icone={<Square size={13} />} onClick={parar} atalho="Ctrl+R">
                    Parar gravação
                  </Button>
                  <Button
                    tamanho="sm"
                    variante="fantasma"
                    icone={etapa === 'pausado' ? <Play size={13} /> : <Pause size={13} />}
                    onClick={pausar}
                  >
                    {etapa === 'pausado' ? 'Continuar' : 'Pausar'}
                  </Button>
                  <span className="timecode text-xs text-fg-2" role="timer">
                    {tc(segundos)}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">Use uma Narração gravada por você ou preparada em outra ferramenta.</p>
            <p className="text-xs text-fg-3">WAV, MP3, M4A, OGG, WebM ou FLAC · até 100 MB.</p>
            <Button disabled={!aprovado} icone={<Upload size={14} />} onClick={() => arquivo.current?.click()}>
              Escolher áudio…
            </Button>
          </div>
        )}
        <input
          ref={arquivo}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac"
          aria-label="Arquivo de Narração"
          className="hidden"
          onChange={(e) => {
            void importar(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {erro && (
          <div role="alert" className="mt-4">
            <Status tom="perigo" className="whitespace-normal!">
              {erro}
            </Status>
          </div>
        )}
        {edicao.audio && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-fg-2">{edicao.audio.nome}</span>
              <a
                href={edicao.audio.url}
                download={edicao.audio.nome}
                className="foco shrink-0 rounded-md px-2 py-1.5 text-xs text-fg-2 hover:bg-hover"
              >
                Salvar áudio
              </a>
            </div>
            <audio controls src={edicao.audio.url} aria-label="Ouvir Narração" className="mt-3 h-9 w-full" />
            {edicao.audio.roteiro !== edicao.roteiro && (
              <p className="mt-2 text-xs text-warning">
                O Roteiro mudou após este áudio. Confira a Narração antes de exportar.
              </p>
            )}
            <p className="mt-2 text-xs text-fg-3">Áudio local · salve uma cópia antes de recarregar.</p>
          </div>
        )}
      </div>
      <section className="mt-6 border-t border-line pt-5" aria-label="Mixagem">
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm text-fg-2" htmlFor="ducking">
            Reduzir áudio da Fonte
          </label>
          <Switch
            id="ducking"
            ligado={edicao.ducking}
            onChange={(ducking) => mudar({ ducking })}
            rotulo="Reduzir áudio da Fonte durante a Narração"
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-fg-3">
          Ducking: a Fonte recua quando a Narração fala. Ajuste aplicado na exportação do app.
        </p>
        <NumberScrub
          className="mt-3"
          rotulo="Redução"
          unidade="dB"
          valor={edicao.reducao}
          onChange={(v) => mudar({ reducao: v ?? -18 })}
          min={-48}
          max={0}
          passo={1}
          desabilitado={!edicao.ducking}
        />
      </section>
    </div>
  )
}
