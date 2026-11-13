import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { LAYOUTS, presets } from '@/data/dados'
import { cn } from '@/lib/cn'
import { num, tc } from '@/lib/formato'
import { useComandos } from '@/lib/comandos'
import { Button, IconButton } from '@/components/ui/Button'
import { Campo, Input } from '@/components/ui/Field'
import { Kbd } from '@/components/ui/Kbd'
import { NumberScrub } from '@/components/ui/NumberScrub'
import { Segmented } from '@/components/ui/Segmented'
import { Switch } from '@/components/ui/Switch'
import { LinhaLegenda, QuadroFonte } from './Preview'
import type { EstadoEditor } from './estado'

export function SecaoFerramenta({
  titulo,
  children,
  extra,
}: {
  titulo: string
  children: ReactNode
  extra?: ReactNode
}) {
  return (
    <section className="border-b border-line p-4 last:border-b-0">
      <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-fg-2">{titulo}</h3>
        {extra}
      </div>
      {children}
    </section>
  )
}

export function FerrTranscricao({ ed, onRevelar }: { ed: EstadoEditor; onRevelar?: () => void }) {
  const [editando, setEditando] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const atual = useRef<HTMLLIElement>(null)
  useComandos([
    {
      id: 'transcricao-corrigir',
      titulo: 'Corrigir palavra da prévia',
      grupo: 'Transcrição',
      desabilitado: !ed.ativa,
      executar: () => {
        if (!ed.ativa) return
        onRevelar?.()
        setTexto(ed.ativa.t)
        setEditando(ed.ativa.id)
      },
    },
  ])
  useEffect(() => {
    if (ed.tocando) atual.current?.scrollIntoView({ block: 'nearest' })
  }, [ed.frase?.id, ed.tocando])
  const salvar = () => {
    if (editando && texto.trim()) ed.mudar({ textos: { ...ed.e.textos, [editando]: texto.trim() } })
    setEditando(null)
  }
  return (
    <div>
      <p className="border-b border-line px-4 py-3 text-xs text-fg-3">
        Clique para posicionar a prévia. Para corrigir uma palavra, clique duas vezes ou use F2 com ela em foco.
      </p>
      {editando && (
        <div className="border-b border-line bg-field p-3">
          <Input
            autoFocus
            aria-label="Corrigir palavra"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                salvar()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setEditando(null)
              }
            }}
            sufixo={
              <Button tamanho="sm" variante="fantasma" onClick={salvar}>
                Salvar
              </Button>
            }
          />
          <p className="mt-1.5 text-2xs text-fg-3">A correção muda o texto da legenda e preserva os tempos da Fonte.</p>
        </div>
      )}
      <ol className="space-y-1 py-2">
        {ed.c.frases.map((f) => {
          const dentro = f.s >= ed.e.inn - 0.01 && f.e <= ed.e.out + 0.01
          return (
            <li
              key={f.id}
              ref={ed.frase?.id === f.id ? atual : undefined}
              className={cn(
                'mx-1.5 grid grid-cols-[52px_1fr] gap-2 rounded-md px-2.5 py-2',
                ed.frase?.id === f.id && 'bg-field',
              )}
            >
              <span className="timecode pt-1 text-2xs text-fg-3">{tc(f.s - ed.e.inn, true)}</span>
              <p className="text-sm leading-[1.8] text-fg-2">
                {ed.palavrasTexto
                  .filter((w) => w.f === f.id)
                  .map((w, i) => (
                    <span key={w.id}>
                      {i > 0 && ' '}
                      <button
                        type="button"
                        data-palavra={w.id}
                        onClick={() => ed.ir(w.s + 0.001)}
                        onDoubleClick={() => {
                          setTexto(w.t)
                          setEditando(w.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'F2') {
                            e.preventDefault()
                            e.stopPropagation()
                            setTexto(w.t)
                            setEditando(w.id)
                          }
                        }}
                        className={cn(
                          'foco -mx-0.5 min-h-6 rounded-xs px-0.5 hover:bg-hover',
                          w.id === ed.ativa?.id && 'bg-accent-subtle text-accent-text',
                          ed.e.textos[w.id] && 'underline decoration-dotted underline-offset-4',
                        )}
                      >
                        {w.t}
                      </button>
                    </span>
                  ))}
                {!dentro && <span className="ml-2 text-2xs text-fg-3">fora do Corte</span>}
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function SeletorPreset({ ed }: { ed: EstadoEditor }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4" aria-label="Estilos de legenda">
      {presets.map((p, i) => (
        <button
          key={p.id}
          type="button"
          aria-label={`Legenda ${p.nome}`}
          aria-pressed={ed.e.preset === p.id}
          onClick={() => ed.aplicarPreset(p.id)}
          className="foco rounded-md text-left"
        >
          <span
            className={cn(
              'flex h-[68px] items-center justify-center overflow-hidden rounded-md border bg-letterbox px-1',
              ed.e.preset === p.id ? 'border-accent ring-1 ring-accent' : 'border-line-strong',
            )}
          >
            <LinhaLegenda palavras={ed.c.palavras.slice(0, 2)} ativa={ed.c.palavras[1]?.id} preset={p} escala="P" />
          </span>
          <span className="mt-2 flex items-center justify-between text-xs text-fg-2">
            {p.nome}
            <Kbd atalho={String(i + 1)} />
          </span>
        </button>
      ))}
    </div>
  )
}

export function FerrLegenda({ ed }: { ed: EstadoEditor }) {
  return (
    <>
      <SecaoFerramenta titulo="Estilo">
        <SeletorPreset ed={ed} />
      </SecaoFerramenta>
      <SecaoFerramenta titulo="Tamanho e ritmo">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-fg-3">Tamanho</span>
            <Segmented
              rotulo="Tamanho da legenda"
              valor={ed.e.escala}
              onChange={(escala) => ed.mudar({ escala })}
              opcoes={(['P', 'M', 'G'] as const).map((v) => ({ valor: v, rotulo: v }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-fg-3">Palavras por vez</span>
            <Segmented
              rotulo="Palavras por vez"
              valor={ed.e.palavras}
              onChange={(palavras) => ed.mudar({ palavras })}
              opcoes={[2, 3, 4, 5].map((v) => ({ valor: v, rotulo: v }))}
            />
          </div>
          <NumberScrub
            rotulo="Posição vertical"
            valor={Math.round(ed.e.pos * 100)}
            onChange={(v) => v !== null && ed.mudar({ pos: v / 100 })}
            min={15}
            max={90}
            unidade="%"
          />
        </div>
      </SecaoFerramenta>
    </>
  )
}

export function FerrEnquadrar({ ed }: { ed: EstadoEditor }) {
  return (
    <>
      <SecaoFerramenta
        titulo="Quadro da Fonte"
        extra={<span className="timecode text-xs text-fg-3">{num(ed.cx * 100, 0)}%</span>}
      >
        <QuadroFonte corte={ed.c} t={ed.t} cx={ed.cx} onCx={ed.definirCentro} />
        <p className="mt-3 text-xs leading-relaxed text-fg-3">
          Arraste o recorte ou use ← → com ele em foco. Shift faz um passo maior.
        </p>
        <div className="mt-3 flex gap-2">
          <Button tamanho="sm" onClick={() => ed.definirCentro(0.5)}>
            Centralizar
          </Button>
          <Button tamanho="sm" variante="fantasma" onClick={() => ed.definirCentro(ed.c.cx)}>
            Usar sugestão
          </Button>
        </div>
      </SecaoFerramenta>
      <SecaoFerramenta titulo="Layout">
        <div className="flex flex-col gap-1">
          {LAYOUTS.map((l) => (
            <button
              type="button"
              key={l.id}
              aria-pressed={ed.e.layout === l.id}
              onClick={() => ed.mudar({ layout: l.id })}
              className={cn(
                'foco flex h-8 items-center justify-between rounded-md px-2.5 text-sm text-fg-2 hover:bg-hover',
                ed.e.layout === l.id && 'bg-selected text-fg',
              )}
            >
              {l.nome}
              {ed.e.layout === l.id && <Check size={14} />}
            </button>
          ))}
        </div>
      </SecaoFerramenta>
      <SecaoFerramenta
        titulo="Keyframes"
        extra={
          <Button tamanho="sm" variante="fantasma" icone={<Plus size={14} />} onClick={ed.adicionarKeyframe}>
            Adicionar keyframe
          </Button>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-fg-3">
          O centro do recorte acompanha os pontos ao reproduzir. Ajustar o recorte cria um ponto na posição atual.
        </p>
        {!ed.e.keyframes.length ? (
          <p className="text-xs text-fg-2">Recorte fixo durante todo o Corte.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ed.e.keyframes.map((k, i) => (
              <li key={k.t} className="flex items-center justify-between gap-2 py-1">
                <button
                  type="button"
                  className="foco flex min-h-7 flex-1 items-center justify-between rounded-sm px-1 text-xs text-fg-2 hover:bg-hover"
                  aria-label={`Ir ao keyframe ${i + 1}`}
                  onClick={() => ed.ir(k.t)}
                >
                  <span className="timecode">{tc(k.t - ed.e.inn, true)}</span>
                  <span>{num(k.cx * 100, 0)}%</span>
                </button>
                <IconButton
                  rotulo={`Excluir keyframe ${i + 1}`}
                  tamanho="sm"
                  onClick={() => ed.mudar({ keyframes: ed.e.keyframes.filter((_, n) => n !== i) })}
                >
                  <Trash2 size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </SecaoFerramenta>
    </>
  )
}

export function FerrAudio({ ed }: { ed: EstadoEditor }) {
  return (
    <SecaoFerramenta
      titulo="Remover silêncios"
      extra={
        <span className="flex items-center gap-2">
          <Kbd atalho="S" />
          <Switch rotulo="Remover silêncios" ligado={ed.e.sil} onChange={(sil) => ed.mudar({ sil })} />
        </span>
      }
    >
      <p className="mb-4 text-xs leading-relaxed text-fg-3">
        Trechos de pelo menos esta duração abaixo de −40 dB são hachurados na timeline. A prévia pula os trechos
        removidos.
      </p>
      <Campo rotulo="Duração mínima do silêncio">
        <Segmented
          rotulo="Duração mínima do silêncio"
          valor={ed.e.minimo}
          onChange={(minimo) => ed.mudar({ minimo })}
          opcoes={[0.3, 0.5, 1].map((v) => ({ valor: v, rotulo: `${num(v)} s` }))}
        />
      </Campo>
      <ul className="mt-4 divide-y divide-line">
        {ed.silencios.map((s) => (
          <li key={s.s}>
            <button
              type="button"
              onClick={() => ed.ir(s.s)}
              className="foco flex h-8 w-full items-center justify-between rounded-sm px-1 text-xs hover:bg-hover"
            >
              <span className="timecode text-fg-2">{tc(s.s - ed.e.inn, true)}</span>
              <span className={cn('text-fg-3', ed.e.sil && 'line-through')}>{num(s.e - s.s)} s</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-fg-2">
        {ed.silencios.length
          ? `${ed.e.sil ? 'Removidos' : 'Detectados'}: ${num(ed.economia)} s em ${ed.silencios.length} trechos.`
          : 'Nenhum silêncio com essa duração neste Corte.'}
      </p>
    </SecaoFerramenta>
  )
}
