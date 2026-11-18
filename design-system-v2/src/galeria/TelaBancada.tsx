// Tela de prova 2: Bancada de revisão, variante A aprovada (lista e detalhe).
// Teclado: ↑ ↓ na lista, A aprova, R rejeita, Enter abre no editor, Ctrl+Z desfaz a última decisão.
import { ArrowDown, ArrowUp, Check, Pause, Play, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AjusteBorda, ItemCorte, type DecisaoCorte } from '@/componentes/Linhas'
import { ListaVirtual } from '@/componentes/Listas'
import { PlayerProxy } from '@/componentes/Midia'
import { Paleta, useAtalhoPaleta, type Comando } from '@/componentes/Paleta'
import { BadgeNota, EixosNota } from '@/componentes/Selos'
import { Tela } from '@/componentes/Tela'
import { duracao, tc } from '@/lib/formato'
import { Botao } from '@/primitivas/Botao'
import { Progresso, Status, useToast } from '@/primitivas/Indicadores'
import { cortesSugeridos, eixos, quadro2, type CorteSugerido } from './dados'

const rotuloDecisao: Record<DecisaoCorte, string> = { pendente: 'Pendente', aprovado: 'Aprovado', rejeitado: 'Rejeitado' }

export function TelaBancada() {
  const [cortes, setCortes] = useState(cortesSugeridos)
  const [selId, setSelId] = useState('c3')
  const [ultima, setUltima] = useState<{ id: string; antes: DecisaoCorte } | null>(null)
  const [tocando, setTocando] = useState(false)
  const [paleta, setPaleta] = useState(false)
  const toast = useToast()
  useAtalhoPaleta(useCallback(() => setPaleta((v) => !v), []))

  const sel = cortes.find((c) => c.id === selId)!
  const indice = cortes.indexOf(sel)
  const aprovados = cortes.filter((c) => c.decisao === 'aprovado').length

  const decidir = useCallback(
    (decisao: DecisaoCorte) => {
      setUltima({ id: sel.id, antes: sel.decisao })
      setCortes((cs) => cs.map((c) => (c.id === sel.id ? { ...c, decisao } : c)))
      const proximo = cortes.slice(indice + 1).find((c) => c.decisao === 'pendente')
      if (proximo) setSelId(proximo.id)
      toast.add({ title: decisao === 'aprovado' ? 'Corte aprovado' : 'Corte rejeitado', description: sel.titulo })
    },
    [cortes, indice, sel, toast],
  )
  const desfazer = useCallback(() => {
    if (!ultima) return
    setCortes((cs) => cs.map((c) => (c.id === ultima.id ? { ...c, decisao: ultima.antes } : c)))
    setSelId(ultima.id)
    setUltima(null)
  }, [ultima])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [role=dialog]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') return e.preventDefault(), desfazer()
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'a') decidir('aprovado')
      else if (e.key.toLowerCase() === 'r') decidir('rejeitado')
      else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button, a')) location.assign('#/tela/editor')
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [decidir, desfazer])

  const comandos: Comando[] = [
    { id: 'apr', rotulo: 'Aprovar Corte', grupo: 'Revisão', atalho: 'A', aoExecutar: () => (setPaleta(false), decidir('aprovado')) },
    { id: 'rej', rotulo: 'Rejeitar Corte', grupo: 'Revisão', atalho: 'R', aoExecutar: () => (setPaleta(false), decidir('rejeitado')) },
    { id: 'des', rotulo: 'Desfazer última decisão', grupo: 'Revisão', atalho: 'Ctrl Z', desabilitado: !ultima, aoExecutar: () => (setPaleta(false), desfazer()) },
  ]

  return (
    <Tela
      titulo="Bancada de revisão"
      projeto={{ nome: 'Canal de Cortes', outros: ['Canal Dark História'] }}
      etapa="cortes"
      fila={{ ativos: 1 }}
      aoAbrirPaleta={() => setPaleta(true)}
      meio={
        <div className="flex h-9 shrink-0 items-center gap-2.5 px-4 text-pequeno text-t3">
          <span className="num">
            <span className="text-t2">{indice + 1} de {cortes.length}</span> · {aprovados} aprovados
          </span>
          <span aria-hidden>·</span>
          <span>Revisão 2 de 2</span>
          <Botao tamanho="p" icone={<Undo2 />} atalho="Ctrl Z" disabled={!ultima} onClick={desfazer} className="ml-auto">
            Desfazer
          </Botao>
        </div>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,37%)_1fr] gap-5 px-4 pb-4">
        <section aria-label="Cortes sugeridos" className="flex min-h-0 flex-col rounded-area bg-area">
          <header className="flex h-9 shrink-0 items-center justify-between px-4 text-pequeno text-t3">
            <span className="num">{cortes.length} Cortes sugeridos</span>
            <span className="flex items-center gap-0.5">
              <ArrowUp className="size-3 stroke-[1.75]" aria-hidden />
              <ArrowDown className="size-3 stroke-[1.75]" aria-hidden />
              <span className="ml-1">navegar</span>
            </span>
          </header>
          <ListaVirtual<CorteSugerido>
            ariaLabel="Cortes sugeridos, por Nota"
            itens={cortes}
            total={cortes.length}
            alturaItem={56}
            selecionadoId={selId}
            aoSelecionar={(c) => setSelId(c.id)}
            renderizarItem={(c, _i, s) => <ItemCorte titulo={c.titulo} inicioUs={c.inicioUs} duracaoUs={c.duracaoUs} nota={c.nota} decisao={c.decisao} selecionado={s} />}
            className="flex-1 px-1.5 pb-1.5"
          />
        </section>

        <section aria-label="Corte em revisão" className="flex min-w-0 gap-6 overflow-y-auto pt-2">
          <div className="flex w-[clamp(200px,16vw,260px)] shrink-0 flex-col gap-2.5">
            <PlayerProxy sourceId={2} fonteDisponivel startUs={sel.inicioUs} endUs={sel.inicioUs + sel.duracaoUs} poster={quadro2} modo="previa_9_16"
              legenda={{ antes: 'Em março', ativa: 'de 2019', depois: 'eu perdi tudo que tinha juntado' }} tempoAtualUs={14_000_000}
              reproduzindo={tocando} aoMudarTempoUs={() => undefined} aoMudarReproduzindo={setTocando}
            />
            <Progresso compacto valor={(14 / 48) * 100} rotulo="Posição na prévia" />
            <div className="flex items-center gap-3 whitespace-nowrap">
              <Botao variante="suave" icone={tocando ? <Pause /> : <Play />} atalho="Espaço" onClick={() => setTocando((v) => !v)}>
                {tocando ? 'Pausar' : 'Reproduzir'}
              </Botao>
              <span className="num text-pequeno text-t3">
                {tc(14_000_000).slice(0, 5)} / {tc(sel.duracaoUs).slice(0, 5)}
              </span>
            </div>
          </div>

          <div className="flex max-w-[640px] min-w-0 flex-1 flex-col gap-4">
            <p className="flex items-center gap-2.5 text-pequeno text-t3">
              <Status tom={sel.decisao === 'aprovado' ? 'sucesso' : sel.decisao === 'rejeitado' ? 'perigo' : 'pendente'}>{rotuloDecisao[sel.decisao]}</Status>
              <span aria-hidden>·</span>
              <span className="num">{duracao(sel.duracaoUs)}</span>
              <span aria-hidden>·</span>
              <span>Revisão 2 de 2</span>
            </p>
            <div className="flex flex-col gap-3">
              <h2 className="text-titulo font-forte text-t1">{sel.titulo}</h2>
              <BadgeNota nota={sel.nota} motivo="Gancho forte: abre com ‘perdi tudo em 2019’" />
              <EixosNota key={sel.id} eixos={eixos} />
            </div>
            <div className="flex flex-col gap-2">
              <AjusteBorda rotulo="Início" posicaoUs={sel.inicioUs} previa="“Em março de 2019 eu perdi tudo que tinha juntado em dez anos de empresa”" atalho="Alt ← / Alt →" />
              <AjusteBorda rotulo="Fim" posicaoUs={sel.inicioUs + sel.duracaoUs} previa="“…ali eu entendi que depender de um único cliente era o erro”" atalho="Alt Shift ← / Alt Shift →" />
            </div>
            <div className="flex items-center gap-2">
              <Botao variante="primario" icone={<Check />} atalho="A" onClick={() => decidir('aprovado')}>
                Aprovar
              </Botao>
              <Botao variante="secundario" icone={<X />} atalho="R" onClick={() => decidir('rejeitado')}>
                Rejeitar
              </Botao>
              <Botao variante="fantasma" atalho="Enter" onClick={() => location.assign('#/tela/editor')}>
                Abrir no editor
              </Botao>
            </div>
          </div>
        </section>
      </div>
      <Paleta aberto={paleta} aoMudarAberto={setPaleta} comandos={comandos} />
    </Tela>
  )
}
