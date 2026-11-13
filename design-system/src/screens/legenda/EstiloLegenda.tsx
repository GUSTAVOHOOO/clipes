import { Check, Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { cortes } from '@/data/dados'
import { useApp } from '@/lib/app'
import { useComandos } from '@/lib/comandos'
import { tc } from '@/lib/formato'
import { ir, useRota } from '@/lib/rota'
import { Tela, CabecalhoPagina } from '@/components/shell/Tela'
import { Button, IconButton } from '@/components/ui/Button'
import { Campo, Input } from '@/components/ui/Field'
import { NumberScrub } from '@/components/ui/NumberScrub'
import { Popover } from '@/components/ui/Popover'
import { Select } from '@/components/ui/Select'
import { avisar } from '@/components/ui/Toast'
import { PreviewCorte } from '@/components/editor/Preview'
import { FerrLegenda, SecaoFerramenta } from '@/components/editor/Ferramentas'
import { padraoEditor, useEditor, type EdicaoEditor } from '@/components/editor/estado'

function CorLegenda({ rotulo, valor, mudar }: { rotulo: string; valor: string; mudar: (v: string) => void }) {
  const [texto, setTexto] = useState(valor)
  useEffect(() => setTexto(valor), [valor])
  const confirmar = () => {
    if (/^#[0-9a-f]{6}$/i.test(texto)) mudar(texto)
    else setTexto(valor)
  }
  return (
    <Campo rotulo={rotulo}>
      <Popover
        titulo={rotulo}
        gatilho={
          <button
            type="button"
            className="foco flex h-8 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-left text-xs"
          >
            <span className="size-4 rounded-xs border border-control-border" style={{ background: valor }} />
            <span className="timecode">{valor.toUpperCase()}</span>
          </button>
        }
      >
        <HexColorPicker color={valor} onChange={mudar} style={{ width: '100%' }} />
        <Input
          className="mt-3"
          aria-label={`${rotulo} em hexadecimal`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmar()
          }}
        />
      </Popover>
    </Campo>
  )
}

export default function EstiloLegenda() {
  const { query } = useRota()
  const corte = cortes.find((c) => c.id === query.get('corte')) ?? cortes[0]
  if (query.get('estado') === 'vazio' || query.get('estado') === 'erro')
    return (
      <Tela titulo="Estilo da legenda">
        <div className="grid h-full place-items-center">
          <div className="max-w-[420px] px-6 text-center">
            <h1 className="text-lg font-semibold">
              {query.get('estado') === 'erro' ? 'Não foi possível carregar os estilos' : 'Comece por um Corte'}
            </h1>
            <p className="mt-2 text-sm text-fg-2">
              {query.get('estado') === 'erro'
                ? 'Tente abrir os estilos novamente.'
                : 'Importe uma Fonte e escolha um Corte para conferir a legenda com a fala.'}
            </p>
            <Button className="mt-5" onClick={() => ir(query.get('estado') === 'erro' ? '/legenda' : '/fontes')}>
              {query.get('estado') === 'erro' ? 'Tentar novamente' : 'Abrir Fontes'}
            </Button>
          </div>
        </div>
      </Tela>
    )
  if (query.get('estado') === 'carregando')
    return (
      <Tela titulo="Estilo da legenda">
        <div
          role="status"
          aria-label="Carregando estilos"
          aria-busy="true"
          className="mx-auto flex h-full max-w-[1000px] items-center justify-around gap-12 p-8"
        >
          <div className="h-3/4 w-80 rounded-lg bg-field animate-[pulso-carregando_1.5s_ease-in-out_infinite]" />
          <div className="h-3/4 aspect-9/16 rounded-lg bg-field" />
        </div>
      </Tela>
    )
  return <Conteudo key={corte.id} corteId={corte.id} />
}

function Conteudo({ corteId }: { corteId: string }) {
  const corte = cortes.find((c) => c.id === corteId)!
  const ed = useEditor(corte)
  const { status, edicoes, setEdicao } = useApp()
  const aprovados = cortes.filter((c) => status[c.id] === 'aprovado')
  const aplicar = () => {
    for (const c of aprovados) {
      const base = edicoes[c.id]?.editor as EdicaoEditor | undefined
      setEdicao(c.id, 'editor', {
        ...(base ?? padraoEditor(c)),
        preset: ed.e.preset,
        palavras: ed.e.palavras,
        pos: ed.e.pos,
        escala: ed.e.escala,
        cor: ed.e.cor,
        destaque: ed.e.destaque,
        contorno: ed.e.contorno,
        fonte: ed.e.fonte,
      })
    }
    avisar.sucesso(
      `Estilo aplicado a ${aprovados.length} ${aprovados.length === 1 ? 'Corte aprovado' : 'Cortes aprovados'}`,
    )
  }
  useComandos([
    {
      id: 'legenda-aplicar',
      titulo: 'Aplicar estilo aos Cortes aprovados',
      grupo: 'Legenda',
      atalho: 'Ctrl+Enter',
      desabilitado: !aprovados.length,
      executar: aplicar,
    },
    {
      id: 'legenda-previa',
      titulo: ed.tocando ? 'Pausar prévia da legenda' : 'Reproduzir prévia da legenda',
      grupo: 'Legenda',
      atalho: 'Space',
      executar: ed.alternar,
    },
    ...['classico', 'impacto', 'limpo', 'caixa'].map((id, i) => ({
      id: `legenda-preset-${id}`,
      titulo: `Aplicar estilo ${['Clássico', 'Impacto', 'Limpo', 'Caixa'][i]}`,
      grupo: 'Legenda',
      atalho: String(i + 1),
      executar: () => ed.aplicarPreset(id),
    })),
  ])
  return (
    <Tela
      titulo="Estilo da legenda"
      direita={
        <Button
          variante="primario"
          icone={<Check size={14} />}
          atalho="Ctrl+Enter"
          disabled={!aprovados.length}
          onClick={aplicar}
        >
          Aplicar aos aprovados
        </Button>
      }
      className="overflow-auto"
    >
      <div className="mx-auto flex min-h-full max-w-[1120px] flex-col px-8 py-7">
        <CabecalhoPagina
          titulo="Estilo da legenda"
          descricao="O texto acompanha a fala. Ajuste a aparência e confira o ritmo antes de aplicar ao lote."
        />
        <div className="mt-7 grid min-h-0 flex-1 grid-cols-[380px_1fr] gap-14 max-[900px]:grid-cols-[320px_1fr] max-[720px]:grid-cols-1">
          <div className="rounded-lg border border-line bg-surface">
            <FerrLegenda ed={ed} />
            <SecaoFerramenta titulo="Tipografia e cores">
              <div className="space-y-4">
                <Campo rotulo="Fonte da legenda">
                  <Select
                    rotulo="Fonte da legenda"
                    valor={ed.preset.fonte}
                    onChange={(fonte) => ed.mudar({ fonte })}
                    opcoes={[
                      { valor: 'Inter', rotulo: 'Inter' },
                      { valor: 'Geist', rotulo: 'Geist Mono' },
                    ]}
                  />
                </Campo>
                <div className="grid grid-cols-2 gap-3">
                  <CorLegenda rotulo="Texto" valor={ed.preset.cor} mudar={(cor) => ed.mudar({ cor })} />
                  <CorLegenda
                    rotulo="Palavra ativa"
                    valor={ed.preset.destaque}
                    mudar={(destaque) => ed.mudar({ destaque })}
                  />
                </div>
                <NumberScrub
                  rotulo="Contorno"
                  valor={ed.preset.contorno}
                  onChange={(contorno) => contorno !== null && ed.mudar({ contorno })}
                  min={0}
                  max={12}
                  unidade="px"
                />
              </div>
            </SecaoFerramenta>
          </div>
          <div className="flex flex-col items-center">
            <div className="mb-4 flex w-full max-w-[290px] items-center justify-between text-xs text-fg-3">
              <span>Prévia em 9:16</span>
              <span>{ed.preset.nome}</span>
            </div>
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
              className="w-[min(100%,260px)]"
            />
            <div className="mt-4 flex items-center gap-3">
              <IconButton
                variante="secundario"
                rotulo={ed.tocando ? 'Pausar prévia' : 'Reproduzir prévia'}
                onClick={ed.alternar}
              >
                {ed.tocando ? <Pause size={15} /> : <Play size={15} />}
              </IconButton>
              <span className="timecode text-xs text-fg-2">
                {tc(ed.tRel, true)} / {tc(ed.duracao, true)}
              </span>
            </div>
            <p className="mt-3 text-center text-2xs text-fg-3">Quadros de demonstração · sem áudio</p>
            <p className="mt-6 max-w-[36ch] text-center text-xs leading-relaxed text-fg-3">
              As alterações ficam neste Corte. Aplicar aos aprovados copia só o estilo para {aprovados.length}{' '}
              {aprovados.length === 1 ? 'Corte' : 'Cortes'} do Projeto.
            </p>
          </div>
        </div>
      </div>
    </Tela>
  )
}
