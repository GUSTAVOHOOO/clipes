import {
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Dialogo,
  Entrada,
  Select,
  type OpcaoSelect,
} from '@ds'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'

export type TipoProvedor = 'openai' | 'anthropic' | 'gemini' | 'ollama'

export type PerfilProvedor = {
  id: string
  label: string
  kind: string
  endpoint: string | null
  model: string | null
  nativeSchema?: boolean
  ownKey?: boolean
  context?: number | null
  maxOutput?: number | null
  timeoutSecs?: number | null
  tokensPerRequest?: number | null
  tokensPerMinute?: number | null
  tokensPerDay?: number | null
  keyLastFour: string | null
  local: boolean
  confirmed: boolean
  active?: boolean
  cli: boolean
  experimental?: boolean
  cost?: { kind: string } | null
}

const MENSAGENS_PROVEDOR: Record<string, string> = {
  local_only_violation:
    'Bloqueado pelo modo Somente local: esta ação tenta acessar um endereço externo.',
  vault: 'Não foi possível acessar o cofre de senhas do sistema operacional.',
  invalid_endpoint: 'Endereço inválido. Endpoints remotos com chave exigem HTTPS.',
  insecure_endpoint: 'Endereço inválido. Endpoints remotos com chave exigem HTTPS.',
  groq_key: 'A chave do Groq foi recusada. Verifique se foi copiada corretamente.',
  cli_auth_required:
    'O CLI escolhido não está autenticado. Faça login no terminal e teste novamente.',
  probe_not_local:
    'A medição automática de contexto funciona apenas para modelos locais em loopback.',
}

/** Traduz `ErroCore` com mensagens específicas da área de Provedores antes do fallback global. */
export function traduzirErroProvedor(erro: ErroCore) {
  const especifico = MENSAGENS_PROVEDOR[erro.code]
  const global = mensagemDeErro(erro)
  if (especifico) {
    return { titulo: especifico, recuperacao: global.recuperacao }
  }
  return global
}

const OPCOES_TIPO: OpcaoSelect<TipoProvedor>[] = [
  { valor: 'openai', rotulo: 'OpenAI / Compatível' },
  { valor: 'anthropic', rotulo: 'Anthropic' },
  { valor: 'gemini', rotulo: 'Gemini' },
  { valor: 'ollama', rotulo: 'Ollama (local)' },
]

type PresetProvedor = {
  id: string
  rotulo: string
  kind: TipoProvedor
  endpoint: string
  model: string
}

const PRESETS: PresetProvedor[] = [
  { id: 'custom', rotulo: 'Personalizado', kind: 'openai', endpoint: '', model: '' },
  {
    id: 'openai',
    rotulo: 'OpenAI',
    kind: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    rotulo: 'Anthropic',
    kind: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'gemini',
    rotulo: 'Gemini',
    kind: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash-lite',
  },
  {
    id: 'ollama',
    rotulo: 'Ollama (loopback)',
    kind: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen2.5:14b',
  },
  {
    id: 'lmstudio',
    rotulo: 'LM Studio (loopback)',
    kind: 'openai',
    endpoint: 'http://127.0.0.1:1234/v1',
    model: 'qwen2.5-14b-instruct',
  },
  {
    id: 'llamacpp',
    rotulo: 'llama.cpp (loopback)',
    kind: 'openai',
    endpoint: 'http://127.0.0.1:8080/v1',
    model: 'local-model',
  },
]

const OPCOES_PRESET: OpcaoSelect<string>[] = PRESETS.map((p) => ({
  valor: p.id,
  rotulo: p.rotulo,
}))

function slugPerfil(texto: string): string {
  const base = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
  return base || `perfil-${Date.now().toString(36).slice(-6)}`
}

function extrairHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).host || null
  } catch {
    return null
  }
}

function ehLoopback(endpoint: string): boolean {
  try {
    const h = new URL(endpoint).hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
  } catch {
    return false
  }
}

function inteiroOpcional(valor: string): number | null {
  const limpo = valor.trim()
  if (!limpo) return null
  const n = Number(limpo)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

export type FormPerfilProvedorProps = {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  perfilInicial: PerfilProvedor | null
  idsExistentes: string[]
  aoSalvar: () => Promise<void> | void
}

/** Diálogo para criar ou editar Perfil de Provedor (API HTTP ou modelo local em loopback). */
export function FormPerfilProvedor({
  aberto,
  aoMudarAberto,
  perfilInicial,
  idsExistentes,
  aoSalvar,
}: FormPerfilProvedorProps) {
  const editando = perfilInicial !== null
  const ehLegacy = perfilInicial?.id === 'legacy'

  const [preset, setPreset] = useState('openai')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<TipoProvedor>('openai')
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')
  const [chave, setChave] = useState('')
  const [mostrarChave, setMostrarChave] = useState(false)
  const [ownKey, setOwnKey] = useState(false)
  const [consentido, setConsentido] = useState(false)
  const [contexto, setContexto] = useState('')
  const [maxOutput, setMaxOutput] = useState('')
  const [timeoutSecs, setTimeoutSecs] = useState('')
  const [nativeSchema, setNativeSchema] = useState(false)
  const [tokensReq, setTokensReq] = useState('')
  const [tokensMin, setTokensMin] = useState('')
  const [tokensDia, setTokensDia] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [confirmarRemoverChave, setConfirmarRemoverChave] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setErro(null)
    setChave('')
    setMostrarChave(false)
    if (perfilInicial) {
      setLabel(perfilInicial.label)
      setKind((perfilInicial.kind as TipoProvedor) || 'openai')
      setEndpoint(perfilInicial.endpoint ?? '')
      setModel(perfilInicial.model ?? '')
      setOwnKey(Boolean(perfilInicial.ownKey))
      setConsentido(Boolean(perfilInicial.confirmed))
      setContexto(perfilInicial.context != null ? String(perfilInicial.context) : '')
      setMaxOutput(perfilInicial.maxOutput != null ? String(perfilInicial.maxOutput) : '')
      setTimeoutSecs(perfilInicial.timeoutSecs != null ? String(perfilInicial.timeoutSecs) : '')
      setNativeSchema(Boolean(perfilInicial.nativeSchema))
      setTokensReq(perfilInicial.tokensPerRequest != null ? String(perfilInicial.tokensPerRequest) : '')
      setTokensMin(perfilInicial.tokensPerMinute != null ? String(perfilInicial.tokensPerMinute) : '')
      setTokensDia(perfilInicial.tokensPerDay != null ? String(perfilInicial.tokensPerDay) : '')
    } else {
      setPreset('openai')
      setLabel('')
      setKind('openai')
      setEndpoint('https://api.openai.com/v1')
      setModel('gpt-4o-mini')
      setOwnKey(false)
      setConsentido(false)
      setContexto('')
      setMaxOutput('')
      setTimeoutSecs('')
      setNativeSchema(false)
      setTokensReq('')
      setTokensMin('')
      setTokensDia('')
    }
  }, [aberto, perfilInicial])

  const host = extrairHost(endpoint)
  const remoto = Boolean(host) && !ehLoopback(endpoint)

  function aplicarPreset(id: string) {
    setPreset(id)
    const p = PRESETS.find((item) => item.id === id)
    if (!p || p.id === 'custom') return
    setKind(p.kind)
    setEndpoint(p.endpoint)
    setModel(p.model)
    if (!label.trim()) setLabel(p.rotulo)
  }

  function gerarProfileId(): string {
    if (editando && perfilInicial) return perfilInicial.id
    const base = slugPerfil(label || model || kind)
    let candidato = base
    let n = 2
    while (idsExistentes.includes(candidato) || ['legacy', 'codex', 'claude', 'opencode'].includes(candidato)) {
      candidato = `${base}-${n++}`
    }
    return candidato
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!endpoint.trim() || !model.trim()) {
      setErro(new ErroCore('invalid_settings', 'Preencha endereço da API e modelo.'))
      return
    }
    const timeoutVal = timeoutSecs.trim() ? Number(timeoutSecs.trim()) : null
    if (timeoutVal !== null && (!Number.isInteger(timeoutVal) || timeoutVal < 1 || timeoutVal > 3600)) {
      setErro(new ErroCore('invalid_settings', 'O timeout deve estar entre 1 e 3600 segundos.'))
      return
    }

    const profileId = gerarProfileId()
    setSalvando(true)
    try {
      await chamar('provider.configure', {
        profileId,
        label: label.trim() || model.trim(),
        kind,
        endpoint: endpoint.trim(),
        model: model.trim(),
        nativeSchema,
        ownKey: ehLegacy ? false : ownKey,
        context: inteiroOpcional(contexto),
        maxOutput: inteiroOpcional(maxOutput),
        timeoutSecs: timeoutVal,
        tokensPerRequest: inteiroOpcional(tokensReq),
        tokensPerMinute: inteiroOpcional(tokensMin),
        tokensPerDay: inteiroOpcional(tokensDia),
      })

      if (chave.trim()) {
        await chamar('provider.key.set', { profileId, key: chave.trim() })
      }
      if (remoto && consentido) {
        await chamar('provider.confirm', { profileId, endpoint: endpoint.trim() })
      }

      await aoSalvar()
      aoMudarAberto(false)
    } catch (err) {
      setErro(err instanceof ErroCore ? err : new ErroCore('desconhecido', String(err)))
    } finally {
      setSalvando(false)
    }
  }

  async function removerChave() {
    if (!perfilInicial) return
    setErro(null)
    setSalvando(true)
    try {
      await chamar('provider.key.remove', { profileId: perfilInicial.id })
      setConfirmarRemoverChave(false)
      await aoSalvar()
    } catch (err) {
      setErro(err instanceof ErroCore ? err : new ErroCore('desconhecido', String(err)))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Dialogo
        aberto={aberto}
        aoMudarAberto={aoMudarAberto}
        titulo={editando ? `Editar Perfil: ${perfilInicial?.label}` : 'Novo Perfil de Provedor'}
        descricao="Configure um modelo local em loopback ou uma API compatível. Apenas texto de transcrições é enviado ao Provedor."
        largura={520}
      >
        <form onSubmit={(e) => void salvar(e)} className="flex flex-col gap-3">
          {erro && (
            <BannerErroCore
              erro={{ code: erro.code, message: erro.detalhe || erro.message }}
              traduzir={(code) => traduzirErroProvedor(new ErroCore(code, erro.detalhe))}
            />
          )}

          {!editando && (
            <Campo rotulo="Modelo rápido">
              {(props) => (
                <Select
                  {...props}
                  valor={preset}
                  aoMudar={aplicarPreset}
                  opcoes={OPCOES_PRESET}
                />
              )}
            </Campo>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Nome do Perfil">
              {(props) => (
                <Entrada
                  {...props}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: OpenAI Rápido"
                  disabled={ehLegacy}
                  required={!ehLegacy}
                />
              )}
            </Campo>

            <Campo rotulo="Tipo">
              {(props) => (
                <Select
                  {...props}
                  valor={kind}
                  aoMudar={(v) => setKind(v)}
                  opcoes={OPCOES_TIPO}
                />
              )}
            </Campo>
          </div>

          <div className="grid grid-cols-[1.4fr_1fr] gap-3">
            <Campo rotulo="Endpoint">
              {(props) => (
                <Entrada
                  {...props}
                  type="url"
                  className="font-mono"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  required
                />
              )}
            </Campo>

            <Campo rotulo="Modelo">
              {(props) => (
                <Entrada
                  {...props}
                  className="font-mono"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  required
                />
              )}
            </Campo>
          </div>

          <Campo
            rotulo={
              perfilInicial?.keyLastFour
                ? `Chave de API no cofre (salva: ••••${perfilInicial.keyLastFour})`
                : 'Chave de API no cofre'
            }
            ajuda="Nunca exibimos a chave já salva; preencha apenas para gravar ou substituir."
          >
            {(props) => (
              <div className="flex items-center gap-2">
                <Entrada
                  {...props}
                  type={mostrarChave ? 'text' : 'password'}
                  autoComplete="off"
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  placeholder={
                    perfilInicial?.keyLastFour
                      ? 'Nova chave para substituir…'
                      : 'Opcional para modelos locais'
                  }
                />
                <Botao
                  variante="secundario"
                  aria-label="Mostrar/ocultar chave durante digitação"
                  onClick={() => setMostrarChave((v) => !v)}
                  icone={mostrarChave ? <EyeOff /> : <Eye />}
                >
                  {mostrarChave ? 'Ocultar' : 'Mostrar'}
                </Botao>
                {editando && perfilInicial?.keyLastFour && (
                  <Botao
                    variante="perigo"
                    onClick={() => setConfirmarRemoverChave(true)}
                  >
                    Remover chave
                  </Botao>
                )}
              </div>
            )}
          </Campo>

          {!ehLegacy && (
            <Checkbox marcado={ownKey} aoMudar={setOwnKey}>
              Chave própria por perfil (não compartilhar por endpoint)
            </Checkbox>
          )}

          {remoto && (
            <Checkbox marcado={consentido} aoMudar={setConsentido}>
              {`Concordo em enviar apenas texto de transcrições para ${host}`}
            </Checkbox>
          )}

          <details className="rounded-controle bg-area px-3 py-2">
            <summary className="foco cursor-pointer text-pequeno text-t2 select-none">
              Limites avançados (contexto, timeout e taxa)
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Campo rotulo="Janela de contexto">
                  {(props) => (
                    <Entrada
                      {...props}
                      type="number"
                      min={1}
                      className="num"
                      value={contexto}
                      onChange={(e) => setContexto(e.target.value)}
                      placeholder="Auto"
                    />
                  )}
                </Campo>
                <Campo rotulo="Máx. saída">
                  {(props) => (
                    <Entrada
                      {...props}
                      type="number"
                      min={1}
                      className="num"
                      value={maxOutput}
                      onChange={(e) => setMaxOutput(e.target.value)}
                      placeholder="4096"
                    />
                  )}
                </Campo>
                <Campo rotulo="Timeout (s)">
                  {(props) => (
                    <Entrada
                      {...props}
                      type="number"
                      min={1}
                      max={3600}
                      className="num"
                      value={timeoutSecs}
                      onChange={(e) => setTimeoutSecs(e.target.value)}
                      placeholder="60 / 300"
                    />
                  )}
                </Campo>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Campo rotulo="Tokens / req.">
                  {(props) => (
                    <Entrada
                      {...props}
                      type="number"
                      min={1}
                      className="num"
                      value={tokensReq}
                      onChange={(e) => setTokensReq(e.target.value)}
                    />
                  )}
                </Campo>
                <Campo rotulo="Tokens / min.">
                  {(props) => (
                    <Entrada
                      {...props}
                      type="number"
                      min={1}
                      className="num"
                      value={tokensMin}
                      onChange={(e) => setTokensMin(e.target.value)}
                    />
                  )}
                </Campo>
                <Campo rotulo="Tokens / dia">
                  {(props) => (
                    <Entrada
                      {...props}
                      type="number"
                      min={1}
                      className="num"
                      value={tokensDia}
                      onChange={(e) => setTokensDia(e.target.value)}
                    />
                  )}
                </Campo>
              </div>
              <Checkbox marcado={nativeSchema} aoMudar={setNativeSchema}>
                Usar schema JSON nativo do Provedor
              </Checkbox>
            </div>
          </details>

          <div className="mt-2 flex justify-end gap-2">
            <Botao onClick={() => aoMudarAberto(false)} disabled={salvando}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="primario" carregando={salvando}>
              Salvar Perfil
            </Botao>
          </div>
        </form>
      </Dialogo>

      <ConfirmDialog
        aberto={confirmarRemoverChave}
        aoMudarAberto={setConfirmarRemoverChave}
        titulo="Remover chave salva?"
        descricao="Remover chave salva do cofre do sistema? Você poderá informar outra chave depois."
        rotuloConfirmar="Remover chave"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={salvando}
        aoConfirmar={removerChave}
      />
    </>
  )
}
