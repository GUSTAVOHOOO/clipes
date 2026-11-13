import { useEffect } from 'react'
import { Download, Pause, Play, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Progresso } from '@/components/ui/Progress'
import { Status } from '@/components/ui/Status'
import { useEdicao } from '@/lib/app'
import { useRota } from '@/lib/rota'
import { useComandos } from '@/lib/comandos'

const itens = [
  {
    id: 'ffmpeg',
    nome: 'FFmpeg',
    uso: 'Renderização e legendas',
    tamanho: '≈ 150 MB',
    licenca: 'GPL · processo separado',
    url: 'https://github.com/BtbN/FFmpeg-Builds',
    fonte: 'https://github.com/FFmpeg/FFmpeg',
  },
  {
    id: 'whisper',
    nome: 'Whisper large-v3-turbo',
    uso: 'Transcrição local',
    tamanho: '≈ 1,6 GB',
    licenca: 'MIT',
    url: 'https://github.com/openai/whisper',
    fonte: 'https://github.com/openai/whisper',
  },
  {
    id: 'kokoro',
    nome: 'Kokoro',
    uso: 'Narração por TTS',
    tamanho: '≈ 330 MB',
    licenca: 'Apache-2.0',
    url: 'https://huggingface.co/hexgrad/Kokoro-82M',
    fonte: 'https://github.com/hexgrad/kokoro',
  },
]
type DownloadEstado = { estado: 'disponivel' | 'baixando' | 'pausado' | 'pronto'; progresso: number }
export function Componentes() {
  const [dados, mudar] = useEdicao('config', 'componentes', () => ({ itens: {} as Record<string, DownloadEstado> }))
  const ativo = Object.keys(dados.itens).find((id) => dados.itens[id].estado === 'baixando') ?? null
  const { query } = useRota()
  useEffect(() => {
    if (!ativo) return
    const timer = setInterval(
      () =>
        mudar((v) => {
          const anterior = v.itens[ativo]
          if (!anterior || anterior.estado !== 'baixando') return v
          const progresso = Math.min(1, anterior.progresso + 0.08)
          return { itens: { ...v.itens, [ativo]: { progresso, estado: progresso >= 1 ? 'pronto' : 'baixando' } } }
        }),
      350,
    )
    return () => clearInterval(timer)
  }, [ativo, mudar])
  const alterar = (id: string, estado: DownloadEstado['estado']) =>
    mudar((v) => ({
      itens: { ...v.itens, [id]: { estado, progresso: estado === 'disponivel' ? 0 : (v.itens[id]?.progresso ?? 0) } },
    }))
  useComandos(
    itens.flatMap((item) => {
      const d = dados.itens[item.id]
      return [
        {
          id: `componente-${item.id}`,
          titulo: `${d?.estado === 'baixando' ? 'Pausar' : 'Simular download de'} ${item.nome}`,
          grupo: 'Componentes',
          desabilitado: d?.estado === 'pronto' || (!!ativo && ativo !== item.id),
          executar: () => alterar(item.id, d?.estado === 'baixando' ? 'pausado' : 'baixando'),
        },
        {
          id: `cancelar-${item.id}`,
          titulo: `Cancelar download de ${item.nome}`,
          grupo: 'Componentes',
          desabilitado: !d || d.estado === 'disponivel' || d.estado === 'pronto',
          executar: () => alterar(item.id, 'disponivel'),
        },
      ]
    }),
  )
  return (
    <div>
      <p className="mb-5 text-xs text-fg-3">
        Catálogo de demonstração. Tamanhos aproximados; nenhum pacote é baixado nesta página.
      </p>
      {query.get('estado') === 'erro' && (
        <p role="alert" className="mb-4 text-sm text-danger">
          Não foi possível consultar o catálogo. Exibindo os componentes de exemplo.
        </p>
      )}
      <div className="divide-y divide-line border-y border-line">
        {itens.map((item) => {
          const d = dados.itens[item.id] ?? { estado: 'disponivel', progresso: 0 }
          return (
            <div key={item.id} className="py-5">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h2 className="text-sm font-medium">{item.nome}</h2>
                  <p className="mt-1 text-xs text-fg-2">
                    {item.uso} · {item.tamanho}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-fg-3">
                    <a href={item.url} target="_blank" rel="noreferrer" className="foco underline underline-offset-4">
                      {item.licenca}
                    </a>
                    <a href={item.fonte} target="_blank" rel="noreferrer" className="foco underline underline-offset-4">
                      Código-fonte
                    </a>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {d.estado === 'pronto' ? (
                    <Status tom="sucesso">Instalado · simulação</Status>
                  ) : d.estado === 'baixando' ? (
                    <>
                      <IconButton rotulo={`Pausar ${item.nome}`} onClick={() => alterar(item.id, 'pausado')}>
                        <Pause size={14} />
                      </IconButton>
                      <IconButton rotulo={`Cancelar ${item.nome}`} onClick={() => alterar(item.id, 'disponivel')}>
                        <X size={14} />
                      </IconButton>
                    </>
                  ) : (
                    <Button
                      tamanho="sm"
                      disabled={!!ativo && ativo !== item.id && dados.itens[ativo]?.estado === 'baixando'}
                      icone={d.estado === 'pausado' ? <Play size={14} /> : <Download size={14} />}
                      onClick={() => alterar(item.id, 'baixando')}
                    >
                      {d.estado === 'pausado' ? 'Retomar simulação' : 'Simular download'}
                    </Button>
                  )}
                </div>
              </div>
              {(d.estado === 'baixando' || d.estado === 'pausado') && (
                <div className="mt-4">
                  <div className="mb-2 flex justify-between text-xs text-fg-3">
                    <span>{d.estado === 'pausado' ? 'Pausado' : 'Baixando · simulação'}</span>
                    <span className="timecode">{Math.round(d.progresso * 100)}%</span>
                  </div>
                  <Progresso valor={d.progresso} rotulo={`Download ${item.nome}`} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-5 text-xs text-fg-3">
        Também será possível escolher um FFmpeg já instalado no computador pelo app desktop. Os modelos só são
        necessários quando a função correspondente for usada.
      </p>
    </div>
  )
}
