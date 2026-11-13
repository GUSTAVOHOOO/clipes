import { useState } from 'react'
import { ShieldCheck, KeyRound, Terminal, Server } from 'lucide-react'
import { Abas } from '@/components/ui/Tabs'
import { Campo, Input } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Status } from '@/components/ui/Status'
import { useComandos } from '@/lib/comandos'
import { useEdicao } from '@/lib/app'

type Tipo = 'api' | 'local' | 'codex'
export function Provedor() {
  const [opcoes, mudar] = useEdicao('config', 'provedor', () => ({
    tipo: 'codex' as Tipo,
    endpoint: '',
    modelo: '',
    consentimento: false,
  }))
  const [chave, setChave] = useState('')
  const [resultado, setResultado] = useState('')
  const [erro, setErro] = useState('')
  const tipo = opcoes.tipo
  const testar = () => {
    if (tipo !== 'local' && !opcoes.consentimento) return
    setErro('')
    if (tipo !== 'codex') {
      try {
        const url = new URL(opcoes.endpoint)
        if (!['http:', 'https:'].includes(url.protocol) || (tipo === 'api' && url.protocol !== 'https:'))
          throw new Error()
        if (tipo === 'local' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error()
      } catch {
        setErro(
          tipo === 'local' ? 'Use um endereço local, como http://localhost:11434/v1.' : 'Use um endpoint HTTPS válido.',
        )
        return
      }
    }
    setChave('')
    setResultado('Conexão simulada. Nenhuma Transcrição ou chave foi enviada.')
  }
  useComandos([
    {
      id: 'provedor-testar',
      titulo: 'Testar conexão do Provedor',
      grupo: 'Provedor',
      executar: testar,
      desabilitado: tipo !== 'local' && !opcoes.consentimento,
    },
  ])
  return (
    <div className="space-y-6">
      <Abas
        valor={tipo}
        onChange={(v) => {
          mudar({ tipo: v, endpoint: v === 'local' ? 'http://localhost:11434/v1' : '', consentimento: false })
          setChave('')
          setResultado('')
          setErro('')
        }}
        rotulo="Tipo de Provedor"
        estilo="sublinhado"
        abas={[
          { valor: 'codex', rotulo: 'Codex CLI', icone: <Terminal size={14} /> },
          { valor: 'api', rotulo: 'API', icone: <KeyRound size={14} /> },
          { valor: 'local', rotulo: 'Local', icone: <Server size={14} /> },
        ]}
      />
      {tipo === 'codex' ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-2">
            Use a sessão do Codex CLI instalada no computador. No app desktop, a conexão é feita pelo núcleo local.
          </p>
          <div className="rounded-md border border-line bg-surface p-4">
            <Status tom="rascunho">Sessão de exemplo · CLI não consultada</Status>
            <p className="mt-2 text-xs text-fg-3">A demonstração não abre o terminal nem acessa credenciais.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Campo rotulo={tipo === 'api' ? 'Endpoint da API' : 'Endpoint local'} erro={erro}>
            <Input
              aria-label={tipo === 'api' ? 'Endpoint da API' : 'Endpoint local'}
              placeholder={tipo === 'api' ? 'https://seu-provedor.example/v1' : 'http://localhost:11434/v1'}
              value={opcoes.endpoint}
              onChange={(e) => {
                mudar({ endpoint: e.target.value })
                setResultado('')
              }}
              mono
            />
          </Campo>
          <Campo rotulo="Modelo" descricao="Informe o identificador oferecido pelo seu Provedor.">
            <Input
              value={opcoes.modelo}
              placeholder="Nome do modelo"
              onChange={(e) => mudar({ modelo: e.target.value })}
            />
          </Campo>
          {tipo === 'api' && (
            <Campo
              rotulo="Chave da API"
              descricao="Campo de demonstração: valor apenas em memória, apagado ao testar ou sair desta tela. O cofre nativo será integrado no app desktop."
            >
              <Input
                aria-label="Chave da API"
                type="password"
                autoComplete="off"
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                placeholder="Cole uma chave fictícia para experimentar"
                mono
              />
            </Campo>
          )}
        </div>
      )}
      {tipo !== 'local' && (
        <div className="flex items-start justify-between gap-6 border-y border-line py-5">
          <div>
            <h2 className="text-sm font-medium">Permitir envio de Transcrição ao Provedor</h2>
            <p className="mt-1 max-w-[58ch] text-xs text-fg-3">
              Somente texto e tempos das Frases selecionadas. Nenhum vídeo ou áudio é enviado. O serviço escolhido pode
              ter cobrança e política de retenção próprias.
            </p>
          </div>
          <Switch
            rotulo="Permitir envio de Transcrição ao Provedor"
            ligado={opcoes.consentimento}
            onChange={(v) => {
              mudar({ consentimento: v })
              setResultado('')
            }}
          />
        </div>
      )}
      {tipo === 'local' && (
        <p className="flex items-center gap-2 text-xs text-fg-2">
          <ShieldCheck size={15} /> O endereço fica restrito ao próprio computador.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={testar} disabled={tipo !== 'local' && !opcoes.consentimento}>
          Testar conexão
        </Button>
        <span className="text-xs text-fg-3">Demonstração · sem chamadas externas</span>
      </div>
      {resultado && (
        <p role="status" className="text-sm text-success">
          {resultado}
        </p>
      )}
    </div>
  )
}
