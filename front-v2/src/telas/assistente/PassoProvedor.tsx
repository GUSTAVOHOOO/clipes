import {
  BannerErroCore,
  Botao,
  BotaoIcone,
  Checkbox,
  cn,
  Entrada,
  Esqueleto,
  Select,
  Status,
} from '@ds'
import { ArrowLeft, Check, Eye, EyeOff, Lock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'

type ServidorDetectado = {
  found: boolean
  endpoint: string | null
  models: string[]
}

type RespostaDeteccao = {
  ollama: ServidorDetectado
  lmStudio: ServidorDetectado
  llamaCpp: ServidorDetectado
  codex: { found: boolean }
  claude: { found: boolean }
  opencode: { found: boolean }
}

type OpcaoProvedor =
  | { id: 'ollama' | 'lmStudio' | 'llamaCpp'; tipo: 'local'; rotulo: string; servidor: ServidorDetectado }
  | { id: 'codex' | 'claude' | 'opencode'; tipo: 'cli'; rotulo: string }
  | { id: 'api'; tipo: 'api'; rotulo: string }

type PresetApi = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'compat'

const PRESETS_API: Record<
  PresetApi,
  { rotulo: string; kind: string; endpoint: string; modelo: string }
> = {
  openai: {
    rotulo: 'OpenAI',
    kind: 'openai',
    endpoint: 'https://api.openai.com/v1',
    modelo: 'gpt-4o-mini',
  },
  anthropic: {
    rotulo: 'Anthropic',
    kind: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    modelo: 'claude-sonnet-4-20250514',
  },
  gemini: {
    rotulo: 'Gemini',
    kind: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelo: 'gemini-2.5-flash',
  },
  openrouter: {
    rotulo: 'OpenRouter',
    kind: 'openai',
    endpoint: 'https://openrouter.ai/api/v1',
    modelo: 'openai/gpt-4o-mini',
  },
  compat: {
    rotulo: 'Compatível (OpenAI)',
    kind: 'openai',
    endpoint: '',
    modelo: '',
  },
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url || 'endpoint remoto'
  }
}

type PassoProvedorProps = {
  aoVoltar: () => void
  aoConcluir: () => void
  aoPular: () => Promise<void>
  pulando: boolean
}

export function PassoProvedor({ aoVoltar, aoConcluir, aoPular, pulando }: PassoProvedorProps) {
  const forcado = useEstadoForcado()
  const jobs = useFila()

  const [carregando, setCarregando] = useState(true)
  const [deteccao, setDeteccao] = useState<RespostaDeteccao | null>(null)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [selecionada, setSelecionada] = useState<OpcaoProvedor['id']>('api')

  const [modeloPorServidor, setModeloPorServidor] = useState<Record<string, string>>({})
  const [cliConsentido, setCliConsentido] = useState<Record<string, boolean>>({})
  const [modeloOpencode, setModeloOpencode] = useState('opencode/big-pickle')

  const [presetApi, setPresetApi] = useState<PresetApi>('openai')
  const [endpointApi, setEndpointApi] = useState(PRESETS_API.openai.endpoint)
  const [modeloApi, setModeloApi] = useState(PRESETS_API.openai.modelo)
  const [chaveApi, setChaveApi] = useState('')
  const [mostrarChave, setMostrarChave] = useState(false)
  const [consentimentoApi, setConsentimentoApi] = useState(false)

  const [testando, setTestando] = useState(false)
  const [testeOk, setTesteOk] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const radioRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const detectar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await chamar<RespostaDeteccao>('assistant.detect', {})
      setDeteccao(res)

      const modelosIniciais: Record<string, string> = {}
      for (const k of ['ollama', 'lmStudio', 'llamaCpp'] as const) {
        if (res[k]?.found && res[k].models.length > 0) {
          modelosIniciais[k] = res[k].models[0]
        }
      }
      setModeloPorServidor((prev) => ({ ...modelosIniciais, ...prev }))

      if (res.ollama?.found) setSelecionada('ollama')
      else if (res.lmStudio?.found) setSelecionada('lmStudio')
      else if (res.llamaCpp?.found) setSelecionada('llamaCpp')
      else if (res.codex?.found) setSelecionada('codex')
      else if (res.claude?.found) setSelecionada('claude')
      else if (res.opencode?.found) setSelecionada('opencode')
      else setSelecionada('api')
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void detectar()
  }, [detectar])

  const opcoes = useMemo<OpcaoProvedor[]>(() => {
    const lista: OpcaoProvedor[] = []
    if (deteccao && forcado !== 'vazio') {
      const servidores: Array<['ollama' | 'lmStudio' | 'llamaCpp', string]> = [
        ['ollama', 'Ollama'],
        ['lmStudio', 'LM Studio'],
        ['llamaCpp', 'llama.cpp'],
      ]
      for (const [id, rotulo] of servidores) {
        if (deteccao[id]?.found) {
          lista.push({ id, tipo: 'local', rotulo, servidor: deteccao[id] })
        }
      }
      const clis: Array<['codex' | 'claude' | 'opencode', string]> = [
        ['codex', 'Codex CLI'],
        ['claude', 'Claude Code CLI'],
        ['opencode', 'OpenCode CLI'],
      ]
      for (const [id, rotulo] of clis) {
        if (deteccao[id]?.found) {
          lista.push({ id, tipo: 'cli', rotulo })
        }
      }
    }
    lista.push({
      id: 'api',
      tipo: 'api',
      rotulo: 'Chave de API (OpenAI, Anthropic, Gemini, OpenRouter…)',
    })
    return lista
  }, [deteccao, forcado])

  const nadaEncontrado = opcoes.length === 1 && opcoes[0].id === 'api'

  const jobTesteRodando = jobs.some(
    (j) => j.id === 'provider.structured' && j.estado === 'rodando',
  )

  function aoMudarPreset(novo: PresetApi) {
    setPresetApi(novo)
    const p = PRESETS_API[novo]
    setEndpointApi(p.endpoint)
    setModeloApi(p.modelo)
    setTesteOk(null)
  }

  function navegarSetas(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return
    e.preventDefault()
    const idx = opcoes.findIndex((o) => o.id === selecionada)
    if (idx < 0) return
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
    const prox = opcoes[(idx + delta + opcoes.length) % opcoes.length]
    setSelecionada(prox.id)
    setTesteOk(null)
    requestAnimationFrame(() => radioRefs.current[prox.id]?.focus())
  }

  async function gravarEscolhaAtual(): Promise<string> {
    const atual = opcoes.find((o) => o.id === selecionada)
    if (!atual) throw new ErroCore('invalid_settings', 'Nenhuma opção selecionada.')

    if (atual.tipo === 'local') {
      const modelo = modeloPorServidor[atual.id] || atual.servidor.models[0] || ''
      const endpoint = atual.servidor.endpoint || 'http://127.0.0.1:11434'
      const kind = atual.id === 'ollama' ? 'ollama' : 'openai'
      await chamar('provider.configure', {
        profileId: atual.id,
        label: atual.rotulo,
        kind,
        endpoint,
        model: modelo,
        nativeSchema: false,
      })
      return `profile:${atual.id}`
    }

    if (atual.tipo === 'cli') {
      if (!cliConsentido[atual.id]) {
        throw new ErroCore(
          'confirmation_required',
          'Confirme o consentimento de envio pela CLI antes de continuar.',
        )
      }
      await chamar('provider.cli.configure', {
        kind: atual.id,
        ...(atual.id === 'opencode' ? { model: modeloOpencode.trim() } : {}),
      })
      await chamar('provider.cli.confirm', { kind: atual.id })
      return atual.id
    }

    // tipo === 'api'
    if (!consentimentoApi) {
      throw new ErroCore(
        'confirmation_required',
        'Confirme o consentimento de envio remoto antes de continuar.',
      )
    }
    const profileId = `api-${presetApi}`
    const kind = PRESETS_API[presetApi].kind
    await chamar('provider.configure', {
      profileId,
      label: PRESETS_API[presetApi].rotulo,
      kind,
      endpoint: endpointApi.trim(),
      model: modeloApi.trim(),
      nativeSchema: false,
      ownKey: true,
    })
    if (chaveApi.trim()) {
      await chamar('provider.key.set', { profileId, key: chaveApi.trim() })
    }
    await chamar('provider.confirm', { profileId, endpoint: endpointApi.trim() })
    return `profile:${profileId}`
  }

  async function testarConexao() {
    setTestando(true)
    setErro(null)
    setTesteOk(null)
    try {
      const escolha = await gravarEscolhaAtual()
      const profileId = escolha.startsWith('profile:') ? escolha.slice(8) : undefined
      await chamar('provider.test', profileId ? { profileId } : {})
      setTesteOk('Conexão verificada com sucesso.')
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setTestando(false)
    }
  }

  async function concluir() {
    setSalvando(true)
    setErro(null)
    try {
      const escolha = await gravarEscolhaAtual()
      await chamar('assistant.default.set', { choice: escolha })
      await chamar('assistant.complete', { skipped: false })
      aoConcluir()
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setSalvando(false)
    }
  }

  if (forcado === 'carregando' || carregando) {
    return (
      <div className="flex flex-col gap-3 rounded-area bg-area p-4">
        <p className="text-pequeno text-t2">Procurando modelos locais e CLIs no computador…</p>
        <Esqueleto
          variante="cards"
          rotuloAcessivel="Procurando modelos locais e CLIs no computador…"
        />
      </div>
    )
  }

  const erroExibido =
    erro ??
    (forcado === 'erro'
      ? new ErroCore('network', 'Simulação de erro via ?estado=erro.')
      : null)

  const podeTestarApi =
    consentimentoApi &&
    endpointApi.trim().length > 0 &&
    modeloApi.trim().length > 0 &&
    chaveApi.trim().length > 0

  const desabilitarConcluir =
    salvando ||
    testando ||
    (selecionada === 'api' &&
      (!consentimentoApi || !endpointApi.trim() || !modeloApi.trim())) ||
    ((selecionada === 'codex' || selecionada === 'claude' || selecionada === 'opencode') &&
      !cliConsentido[selecionada]) ||
    (selecionada === 'opencode' && !modeloOpencode.trim())

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-area bg-area p-4">
        <h1 className="text-titulo font-forte text-t1">
          Passo 2: Quem escolhe os Cortes e sugere títulos
        </h1>

        {erroExibido && (
          <BannerErroCore
            erro={{
              code: erroExibido.code,
              message: erroExibido.detalhe || erroExibido.message,
            }}
            traduzir={(c) => mensagemDeErro(new ErroCore(c, erroExibido.message))}
            acaoRecuperacao={{
              rotulo: 'Testar novamente',
              aoAcionar: () => void detectar(),
            }}
            permitirRelato
            aoDispensar={erro ? () => setErro(null) : undefined}
          />
        )}

        {testeOk && (
          <div role="status" className="rounded-controle bg-elevado px-3 py-2 text-pequeno text-t1">
            <Status tom="sucesso" forte>
              {testeOk}
            </Status>
          </div>
        )}

        {nadaEncontrado && (
          <p className="text-pequeno text-t2">
            Nenhum servidor local ou CLI encontrado automaticamente. Configure uma chave de API
            abaixo ou pule para configurar depois.
          </p>
        )}

        <div
          role="radiogroup"
          aria-label="Escolha de Provedor"
          onKeyDown={navegarSetas}
          className="flex flex-col gap-2"
        >
          {opcoes.map((opcao) => {
            const ativa = selecionada === opcao.id
            return (
              <div
                key={opcao.id}
                className={cn(
                  'flex flex-col gap-2 rounded-controle p-3 transition-colors duration-(--dur-rapida)',
                  ativa ? 'marcado bg-elevado' : 'bg-chao',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    ref={(el) => {
                      radioRefs.current[opcao.id] = el
                    }}
                    type="button"
                    role="radio"
                    aria-checked={ativa}
                    tabIndex={ativa ? 0 : -1}
                    onClick={() => {
                      setSelecionada(opcao.id)
                      setTesteOk(null)
                    }}
                    className="foco flex min-h-6 cursor-pointer items-center gap-2 rounded-controle border-0 bg-transparent px-1 py-0.5 text-left text-base font-medio text-t1"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-3.5 place-items-center rounded-full border',
                        ativa ? 'border-t1 bg-t1 text-chao' : 'border-linha-forte',
                      )}
                    >
                      {ativa && <span className="size-1.5 rounded-full bg-chao" />}
                    </span>
                    <span>{opcao.rotulo}</span>
                    {opcao.tipo === 'local' && opcao.servidor.endpoint && (
                      <span className="font-mono text-pequeno font-normal text-t3">
                        ({opcao.servidor.endpoint})
                      </span>
                    )}
                  </button>

                  {opcao.tipo === 'local' && (
                    <Status icone={<Lock className="size-[13px] stroke-[1.75]" aria-hidden />}>
                      Local · US$ 0,00 · não sai do computador
                    </Status>
                  )}
                  {opcao.tipo === 'cli' && (
                    <div className="flex items-center gap-2">
                      {opcao.id === 'claude' && <Status tom="aviso">Experimental</Status>}
                      <Status tom="info">Assinatura via CLI · consome cota do seu plano</Status>
                    </div>
                  )}
                </div>

                {opcao.tipo === 'local' && ativa && (
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    {opcao.servidor.models.length > 0 ? (
                      <Select
                        rotulo={`Modelo de ${opcao.rotulo}`}
                        valor={modeloPorServidor[opcao.id] ?? opcao.servidor.models[0]}
                        aoMudar={(v) =>
                          setModeloPorServidor((prev) => ({ ...prev, [opcao.id]: v }))
                        }
                        opcoes={opcao.servidor.models.map((m) => ({ valor: m, rotulo: m }))}
                        className="w-56"
                      />
                    ) : (
                      <Entrada
                        aria-label={`Modelo de ${opcao.rotulo}`}
                        value={modeloPorServidor[opcao.id] ?? ''}
                        onChange={(e) =>
                          setModeloPorServidor((prev) => ({
                            ...prev,
                            [opcao.id]: e.target.value,
                          }))
                        }
                        placeholder="Nome do modelo"
                        className="w-56"
                      />
                    )}
                    <Botao
                      variante="suave"
                      carregando={testando || jobTesteRodando}
                      onClick={() => void testarConexao()}
                    >
                      Testar conexão
                    </Botao>
                  </div>
                )}

                {opcao.tipo === 'cli' && ativa && (
                  <div className="flex flex-col gap-2 pl-6">
                    {opcao.id === 'opencode' && (
                      <Entrada
                        aria-label="Modelo do OpenCode"
                        value={modeloOpencode}
                        onChange={(e) => setModeloOpencode(e.target.value)}
                        placeholder="opencode/big-pickle"
                        className="max-w-72"
                      />
                    )}
                    <Checkbox
                      marcado={Boolean(cliConsentido[opcao.id])}
                      aoMudar={(v) =>
                        setCliConsentido((prev) => ({ ...prev, [opcao.id]: v }))
                      }
                      className="text-pequeno"
                    >
                      Concordo em enviar apenas texto de transcrições pela {opcao.rotulo} (consome
                      cota do seu plano)
                    </Checkbox>
                  </div>
                )}

                {opcao.tipo === 'api' && (
                  <div className="flex flex-col gap-2 pl-6">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr_1.4fr]">
                      <Select
                        rotulo="Provedor de API"
                        valor={presetApi}
                        aoMudar={(v) => aoMudarPreset(v)}
                        opcoes={Object.entries(PRESETS_API).map(([k, v]) => ({
                          valor: k as PresetApi,
                          rotulo: v.rotulo,
                        }))}
                      />
                      <Entrada
                        aria-label="Modelo da API"
                        value={modeloApi}
                        onChange={(e) => {
                          setSelecionada('api')
                          setModeloApi(e.target.value)
                        }}
                        placeholder="Modelo (ex.: gpt-4o-mini)"
                      />
                      <div className="flex items-center gap-1">
                        <Entrada
                          aria-label="Chave de API"
                          type={mostrarChave ? 'text' : 'password'}
                          value={chaveApi}
                          onChange={(e) => {
                            setSelecionada('api')
                            setChaveApi(e.target.value)
                          }}
                          placeholder="Cole sua chave (cofre do SO)"
                          className="min-w-0 flex-1"
                        />
                        <BotaoIcone
                          variante="suave"
                          rotulo={mostrarChave ? 'Ocultar chave' : 'Mostrar chave'}
                          onClick={() => setMostrarChave((v) => !v)}
                        >
                          {mostrarChave ? <EyeOff /> : <Eye />}
                        </BotaoIcone>
                      </div>
                    </div>

                    {presetApi === 'compat' && (
                      <Entrada
                        aria-label="Endpoint compatível"
                        value={endpointApi}
                        onChange={(e) => {
                          setSelecionada('api')
                          setEndpointApi(e.target.value)
                        }}
                        placeholder="https://seu-servidor/v1"
                      />
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Checkbox
                        marcado={consentimentoApi}
                        aoMudar={(v) => {
                          setSelecionada('api')
                          setConsentimentoApi(v)
                        }}
                        className="text-pequeno"
                      >
                        Concordo em enviar apenas texto de transcrições para{' '}
                        <span className="font-mono">{hostDe(endpointApi)}</span> (nunca vídeo ou
                        áudio)
                      </Checkbox>
                      <Botao
                        variante="suave"
                        disabled={!podeTestarApi || testando || jobTesteRodando}
                        carregando={testando || jobTesteRodando}
                        onClick={() => void testarConexao()}
                      >
                        Testar conexão
                      </Botao>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <Botao
            variante="secundario"
            icone={<ArrowLeft />}
            disabled={salvando || pulando}
            onClick={aoVoltar}
          >
            Voltar
          </Botao>
          <Botao variante="fantasma" disabled={salvando || pulando} onClick={() => void aoPular()}>
            Pular por enquanto
          </Botao>
        </div>
        <Botao
          variante="primario"
          icone={<Check />}
          carregando={salvando}
          disabled={desabilitarConcluir}
          onClick={() => void concluir()}
        >
          Concluir configuração
        </Botao>
      </footer>
    </div>
  )
}
