import { useState } from 'react'
import {
  AudioWaveform,
  Captions,
  Check,
  Crop,
  Download,
  Pause,
  Play,
  Rows3,
  ScrollText,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { cortes, img, presets } from '@/data/dados'
import { useApp } from '@/lib/app'
import { useComandos } from '@/lib/comandos'
import { dur, num, tc } from '@/lib/formato'
import { cn } from '@/lib/cn'
import { ir, useRota } from '@/lib/rota'
import { Tela } from '@/components/shell/Tela'
import { ContextoCorte, irCorte, useCorteDaRota } from '@/components/shell/ContextoCorte'
import { CabecalhoGaveta, GavetaBorda, Puxador, useGaveta, ZonaBorda } from '@/components/shell/Gaveta'
import { Button, IconButton } from '@/components/ui/Button'
import { Abas } from '@/components/ui/Tabs'
import { Kbd } from '@/components/ui/Kbd'
import { Status } from '@/components/ui/Status'
import { Tip } from '@/components/ui/Tooltip'
import { PreviewCorte } from '@/components/editor/Preview'
import { Timeline } from '@/components/editor/Timeline'
import { useEditor } from '@/components/editor/estado'
import { FerrAudio, FerrEnquadrar, FerrLegenda, FerrTranscricao } from '@/components/editor/Ferramentas'

const ferramentas = [
  { id: 'transcricao', nome: 'Transcrição', tecla: 'T', icone: <ScrollText size={15} /> },
  { id: 'legenda', nome: 'Legenda', tecla: 'L', icone: <Captions size={15} /> },
  { id: 'enquadrar', nome: 'Enquadrar', tecla: 'F', icone: <Crop size={15} /> },
  { id: 'audio', nome: 'Áudio', tecla: 'A', icone: <AudioWaveform size={15} /> },
] as const
type Ferramenta = (typeof ferramentas)[number]['id']

export default function Editor() {
  const { corte } = useCorteDaRota()
  const { query } = useRota()
  return <EditorCorte key={`${corte.id}:${query.get('painel') ?? ''}`} />
}

function EditorCorte() {
  const { corte, indice } = useCorteDaRota()
  const { query } = useRota()
  const estado = query.get('estado')
  const ed = useEditor(corte)
  const { status, setStatus } = useApp()
  const inicial = query.get('painel')
  const esq = useGaveta(inicial === 'cortes' ? 'fixa' : null)
  const dir = useGaveta(ferramentas.some((f) => f.id === inicial) ? 'fixa' : null)
  const [ferr, setFerr] = useState<Ferramenta>(ferramentas.find((f) => f.id === inicial)?.id ?? 'transcricao')
  const [zoom, setZoom] = useState(1)
  const abrir = (f: Ferramenta) => {
    if (f === ferr && dir.estado === 'fixa') dir.fechar()
    else {
      setFerr(f)
      dir.fixar()
    }
  }
  const fechar = () => {
    esq.fechar()
    dir.fechar()
  }
  const indisponivel = ['erro', 'vazio', 'carregando'].includes(query.get('estado') ?? '')
  const exportar = () => {
    if (!indisponivel) ir(`/exportar?corte=${corte.id}`)
  }
  useComandos([
    {
      id: 'editor-tocar',
      titulo: ed.tocando ? 'Pausar prévia' : 'Reproduzir prévia',
      grupo: 'Corte',
      atalho: 'Space',
      executar: ed.alternar,
    },
    { id: 'editor-cortes', titulo: 'Mostrar Cortes', grupo: 'Mostrar', atalho: 'C', executar: esq.alternar },
    ...ferramentas.map((f) => ({
      id: `editor-${f.id}`,
      titulo: `Mostrar ${f.nome}`,
      grupo: 'Mostrar',
      atalho: f.tecla,
      executar: () => abrir(f.id),
    })),
    { id: 'editor-fechar', titulo: 'Só preview e timeline', grupo: 'Mostrar', atalho: 'Escape', executar: fechar },
    {
      id: 'editor-exportar',
      titulo: 'Exportar este Corte',
      grupo: 'Corte',
      atalho: 'Ctrl+E',
      desabilitado: indisponivel,
      executar: exportar,
    },
    {
      id: 'editor-aprovar',
      titulo: status[corte.id] === 'aprovado' ? 'Voltar este Corte para revisão' : 'Aprovar este Corte',
      grupo: 'Corte',
      atalho: 'V',
      executar: () => setStatus(corte.id, status[corte.id] === 'aprovado' ? 'sugerido' : 'aprovado'),
    },
    {
      id: 'editor-silencio',
      titulo: ed.e.sil ? 'Restaurar silêncios' : 'Remover silêncios',
      grupo: 'Áudio',
      atalho: 'S',
      executar: () => ed.mudar({ sil: !ed.e.sil }),
    },
    {
      id: 'editor-pal-ant',
      titulo: 'Palavra anterior',
      grupo: 'Corte',
      atalho: 'ArrowLeft',
      oculto: true,
      repete: true,
      executar: () => ed.passoPalavra(-1),
    },
    {
      id: 'editor-pal-prox',
      titulo: 'Próxima palavra',
      grupo: 'Corte',
      atalho: 'ArrowRight',
      oculto: true,
      repete: true,
      executar: () => ed.passoPalavra(1),
    },
    {
      id: 'editor-ext-in',
      titulo: 'Começar uma Frase antes',
      grupo: 'Corte',
      atalho: 'Shift+ArrowLeft',
      executar: () => ed.passoBorda('in', -1),
    },
    {
      id: 'editor-ext-out',
      titulo: 'Terminar uma Frase depois',
      grupo: 'Corte',
      atalho: 'Shift+ArrowRight',
      executar: () => ed.passoBorda('out', 1),
    },
    {
      id: 'editor-enc-in',
      titulo: 'Começar uma Frase depois',
      grupo: 'Corte',
      atalho: 'Ctrl+Shift+ArrowRight',
      executar: () => ed.passoBorda('in', 1),
    },
    {
      id: 'editor-enc-out',
      titulo: 'Terminar uma Frase antes',
      grupo: 'Corte',
      atalho: 'Ctrl+Shift+ArrowLeft',
      executar: () => ed.passoBorda('out', -1),
    },
    ...presets.map((p, i) => ({
      id: `editor-preset-${p.id}`,
      titulo: `Legenda ${p.nome}`,
      grupo: 'Legenda',
      atalho: String(i + 1),
      executar: () => ed.aplicarPreset(p.id),
    })),
    {
      id: 'editor-zoom-in',
      titulo: 'Aproximar timeline',
      grupo: 'Timeline',
      executar: () => setZoom((v) => Math.min(4, v + 1)),
    },
    {
      id: 'editor-zoom-out',
      titulo: 'Afastar timeline',
      grupo: 'Timeline',
      executar: () => setZoom((v) => Math.max(1, v - 1)),
    },
    {
      id: 'editor-keyframe',
      titulo: 'Adicionar keyframe de enquadramento',
      grupo: 'Enquadrar',
      executar: ed.adicionarKeyframe,
    },
    {
      id: 'editor-centralizar',
      titulo: 'Centralizar recorte',
      grupo: 'Enquadrar',
      executar: () => ed.definirCentro(0.5),
    },
  ])
  return (
    <Tela
      titulo={`Editar · ${corte.titulo}`}
      meio={<ContextoCorte />}
      direita={
        <Button
          variante="primario"
          icone={<Download size={14} />}
          atalho="Ctrl+E"
          disabled={indisponivel}
          onClick={exportar}
        >
          Exportar
        </Button>
      }
      className="flex flex-col overflow-hidden"
    >
      {estado === 'erro' || estado === 'vazio' ? (
        <div className="grid h-full place-items-center">
          <div className="max-w-[420px] text-center">
            <h1 className="text-lg font-semibold">
              {estado === 'erro' ? 'A Fonte está offline' : 'Nenhum Corte para editar'}
            </h1>
            <p className="mt-2 text-sm text-fg-2">
              {estado === 'erro'
                ? 'Relocalize a Fonte no Projeto para voltar a editar este Corte.'
                : 'Importe uma Fonte e revise os Cortes sugeridos para começar.'}
            </p>
            <Button className="mt-5" onClick={() => ir('/fontes')}>
              Abrir Fontes
            </Button>
          </div>
        </div>
      ) : estado === 'carregando' ? (
        <div
          role="status"
          aria-label="Carregando Corte"
          aria-busy="true"
          className="flex h-full flex-col items-center justify-between p-8"
        >
          <div className="h-3/5 aspect-9/16 rounded-md bg-field animate-[pulso-carregando_1.5s_ease-in-out_infinite]" />
          <div className="h-32 w-full space-y-3">
            <div className="h-9 rounded-md bg-field" />
            <div className="h-7 rounded-md bg-field" />
            <div className="h-6 rounded-md bg-field" />
          </div>
          <span className="sr-only">Carregando Corte</span>
        </div>
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="absolute top-4 left-6 flex items-center gap-3 text-xs text-fg-3">
              <Status tom={status[corte.id] === 'aprovado' ? 'sucesso' : 'rascunho'}>
                {status[corte.id] === 'aprovado' ? 'Aprovado' : 'Em revisão'}
              </Status>
              <span>Nota {num(corte.nota.total)}</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center px-12 pt-6 pb-3" onPointerDown={fechar}>
              <PreviewCorte
                corte={corte}
                t={ed.t}
                cx={ed.cx}
                layout={ed.e.layout}
                grupo={ed.grupo}
                ativa={ed.ativa?.id}
                preset={ed.preset}
                pos={ed.e.pos}
                escala={ed.e.escala}
                className="h-full max-h-[620px]"
              />
            </div>
            <div className="flex h-14 shrink-0 items-center justify-center gap-5 px-6">
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-fg-3">Início</span>
                <Tip rotulo="Começar uma Frase antes" atalho="Shift+ArrowLeft">
                  <Button
                    tamanho="sm"
                    variante="fantasma"
                    disabled={ed.e.inn <= corte.inicio}
                    onClick={() => ed.passoBorda('in', -1)}
                  >
                    +1 Frase
                  </Button>
                </Tip>
                <Tip rotulo="Começar uma Frase depois" atalho="Ctrl+Shift+ArrowRight">
                  <Button tamanho="sm" variante="fantasma" onClick={() => ed.passoBorda('in', 1)}>
                    −1
                  </Button>
                </Tip>
              </div>
              <div className="flex items-center gap-3">
                <Tip rotulo={ed.tocando ? 'Pausar prévia' : 'Reproduzir prévia'} atalho="Space">
                  <IconButton
                    rotulo={ed.tocando ? 'Pausar prévia' : 'Reproduzir prévia'}
                    tamanho="lg"
                    variante="secundario"
                    onClick={ed.alternar}
                  >
                    {ed.tocando ? <Pause size={16} /> : <Play size={16} />}
                  </IconButton>
                </Tip>
                <span className="timecode min-w-[140px] text-sm">
                  {tc(ed.tRel, true)}
                  <span className="text-fg-3"> / {tc(ed.duracao, true)}</span>
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Tip rotulo="Terminar uma Frase antes" atalho="Ctrl+Shift+ArrowLeft">
                  <Button tamanho="sm" variante="fantasma" onClick={() => ed.passoBorda('out', -1)}>
                    −1
                  </Button>
                </Tip>
                <Tip rotulo="Terminar uma Frase depois" atalho="Shift+ArrowRight">
                  <Button
                    tamanho="sm"
                    variante="fantasma"
                    disabled={ed.e.out >= corte.fim}
                    onClick={() => ed.passoBorda('out', 1)}
                  >
                    +1 Frase
                  </Button>
                </Tip>
                <span className="ml-1 text-xs text-fg-3">Fim</span>
              </div>
            </div>
            <ZonaBorda lado="esq" g={esq} />
            <ZonaBorda lado="dir" g={dir} />
            <Puxador
              lado="esq"
              g={esq}
              itens={[
                { id: 'cortes', rotulo: 'Cortes', icone: <Rows3 size={15} />, atalho: 'C', onClick: esq.alternar },
              ]}
            />
            <Puxador
              lado="dir"
              g={dir}
              itens={ferramentas.map((f) => ({
                id: f.id,
                rotulo: f.nome,
                icone: f.icone,
                atalho: f.tecla,
                onClick: () => abrir(f.id),
              }))}
            />
            <GavetaBorda lado="esq" g={esq} rotulo="Cortes do Projeto">
              <CabecalhoGaveta
                acoes={
                  <IconButton rotulo="Fechar Cortes" tamanho="sm" onClick={esq.fechar}>
                    <X size={14} />
                  </IconButton>
                }
              >
                <h2 className="font-medium">Cortes</h2>
                <span className="text-xs text-fg-3">{cortes.length}</span>
              </CabecalhoGaveta>
              <ul className="min-h-0 flex-1 overflow-auto p-1.5">
                {cortes.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-foco-inicial={i === indice ? '' : undefined}
                      aria-current={i === indice ? 'true' : undefined}
                      onClick={() => {
                        fechar()
                        irCorte(i)
                      }}
                      className={cn(
                        'foco flex w-full gap-3 rounded-md p-2 text-left hover:bg-hover',
                        i === indice && 'bg-selected',
                      )}
                    >
                      <img src={img(c.thumbs[3])} alt="" className="h-10 w-[70px] shrink-0 rounded-sm object-cover" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{c.titulo}</span>
                        <span className="mt-1 flex items-center gap-2 text-2xs text-fg-3">
                          {dur(c.fim - c.inicio)} · Nota {num(c.nota.total)}
                          {status[c.id] === 'aprovado' && <Check size={12} aria-label="Aprovado" />}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line p-3 text-xs text-fg-3">
                <Kbd teclas={['[', ']']} /> Trocar Corte · <Kbd atalho="G" /> Buscar
              </p>
            </GavetaBorda>
            <GavetaBorda lado="dir" g={dir} rotulo="Ferramentas do Corte" largura={430}>
              <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <Abas
                    valor={ferr}
                    onChange={setFerr}
                    rotulo="Ferramentas do Corte"
                    abas={ferramentas.map((f) => ({ valor: f.id, rotulo: f.nome }))}
                  />
                </div>
                <IconButton rotulo="Fechar ferramentas" tamanho="sm" onClick={dir.fechar}>
                  <X size={14} />
                </IconButton>
              </div>
              <div key={ferr} className="min-h-0 flex-1 overflow-auto">
                {ferr === 'transcricao' ? (
                  <FerrTranscricao ed={ed} onRevelar={dir.fixar} />
                ) : ferr === 'legenda' ? (
                  <FerrLegenda ed={ed} />
                ) : ferr === 'enquadrar' ? (
                  <FerrEnquadrar ed={ed} />
                ) : (
                  <FerrAudio ed={ed} />
                )}
              </div>
            </GavetaBorda>
          </div>
          <div className="flex h-9 shrink-0 items-center justify-between gap-3 px-6 text-2xs text-fg-3">
            <span>Prévia demonstrativa · quadros da Fonte, sem áudio</span>
            <div className="flex items-center gap-1">
              <span className="mr-2">
                {ed.e.sil ? `${num(ed.economia)} s de silêncio removidos` : 'Silêncios preservados'}
              </span>
              <IconButton
                tamanho="sm"
                rotulo="Afastar timeline"
                disabled={zoom === 1}
                onClick={() => setZoom((v) => v - 1)}
              >
                <ZoomOut size={14} />
              </IconButton>
              <span className="timecode w-8 text-center">{zoom}×</span>
              <IconButton
                tamanho="sm"
                rotulo="Aproximar timeline"
                disabled={zoom === 4}
                onClick={() => setZoom((v) => v + 1)}
              >
                <ZoomIn size={14} />
              </IconButton>
            </div>
          </div>
          <Timeline ed={ed} zoom={zoom} onEditar={fechar} />
        </>
      )}
    </Tela>
  )
}
