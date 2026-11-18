// <ListaVirtual>: listbox com um único tab stop e aria-activedescendant; só renderiza o que está à vista.
// <TabelaGrade>: role="grid" com navegação por setas entre células.
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ListaVirtualProps<T> {
  itens?: T[]
  total: number
  alturaItem: number | ((indice: number) => number)
  obterItem?: (indice: number) => T | undefined
  carregarPagina?: (offset: number, limit: number) => Promise<void>
  obterId?: (item: T) => string | number
  selecionadoId?: string | number | null
  aoSelecionar?: (item: T) => void
  rolarParaIndice?: number | null
  renderizarItem: (item: T, indice: number, selecionado: boolean) => ReactNode
  ariaLabel: string
  papel?: 'listbox' | 'region'
  className?: string
}

export function ListaVirtual<T>({ itens, total, alturaItem, obterItem, carregarPagina, obterId = (i) => (i as { id: string | number }).id, selecionadoId, aoSelecionar, rolarParaIndice, renderizarItem, ariaLabel, papel = 'listbox', className }: ListaVirtualProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const prefixo = useId()
  const pegar = (i: number) => itens?.[i] ?? obterItem?.(i)
  const v = useVirtualizer({
    count: total,
    getScrollElement: () => ref.current,
    estimateSize: typeof alturaItem === 'number' ? () => alturaItem : alturaItem,
    overscan: 6,
  })
  const idxSel = itens ? itens.findIndex((it) => obterId(it) === selecionadoId) : -1
  const [ativo, setAtivo] = useState(Math.max(0, idxSel))

  useEffect(() => {
    if (idxSel >= 0) setAtivo(idxSel)
  }, [idxSel])
  useEffect(() => {
    if (rolarParaIndice != null) v.scrollToIndex(rolarParaIndice, { align: 'auto' })
  }, [rolarParaIndice, v])

  // paginação sob demanda: pede o que falta no que está visível
  const visiveis = v.getVirtualItems()
  useEffect(() => {
    if (!carregarPagina || !visiveis.length) return
    const faltando = visiveis.find((it) => pegar(it.index) === undefined)
    if (faltando) void carregarPagina(Math.floor(faltando.index / 50) * 50, 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis.map((i) => i.index).join(',')])

  const mover = (para: number) => {
    const n = Math.min(total - 1, Math.max(0, para))
    setAtivo(n)
    v.scrollToIndex(n, { align: 'auto' })
    const it = pegar(n)
    if (it) aoSelecionar?.(it)
  }
  const teclas = (e: KeyboardEvent) => {
    const pagina = Math.max(1, Math.floor((ref.current?.clientHeight ?? 300) / (typeof alturaItem === 'number' ? alturaItem : 40)))
    const mapa: Record<string, number> = { ArrowDown: ativo + 1, ArrowUp: ativo - 1, Home: 0, End: total - 1, PageDown: ativo + pagina, PageUp: ativo - pagina }
    if (e.key in mapa) {
      e.preventDefault()
      mover(mapa[e.key])
    }
  }

  return (
    <div ref={ref} role={papel} aria-label={ariaLabel} tabIndex={0} onKeyDown={papel === 'listbox' ? teclas : undefined}
      aria-activedescendant={papel === 'listbox' && total ? `${prefixo}-${ativo}` : undefined}
      className={cn('foco-interno min-h-0 overflow-y-auto', className)}
    >
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {visiveis.map((it) => {
          const item = pegar(it.index)
          const sel = item !== undefined && obterId(item) === selecionadoId
          return (
            <div key={it.key} id={`${prefixo}-${it.index}`} role={papel === 'listbox' ? 'option' : undefined} aria-selected={papel === 'listbox' ? sel : undefined}
              data-index={it.index} ref={v.measureElement} onClick={() => item && (setAtivo(it.index), aoSelecionar?.(item))}
              className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${it.start}px)` }}
            >
              {item === undefined ? <div className="mx-3 my-3 h-3 w-2/3 animate-pulso rounded-controle bg-elevado" /> : renderizarItem(item, it.index, sel)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export type ColunaGrade<T> = { id: string; titulo: string; largura?: string; alinhar?: 'esq' | 'dir'; render: (linha: T) => ReactNode }

/** Tabela com navegação por setas entre células (roving tabindex). */
export function TabelaGrade<T>({ linhas, colunas, obterId, rotulo, className }: { linhas: T[]; colunas: ColunaGrade<T>[]; obterId: (l: T) => string; rotulo: string; className?: string }) {
  const [pos, setPos] = useState<[number, number]>([0, 0])
  const ref = useRef<HTMLTableElement>(null)
  const ir = (l: number, c: number) => {
    const nl = Math.min(linhas.length, Math.max(0, l))
    const nc = Math.min(colunas.length - 1, Math.max(0, c))
    setPos([nl, nc])
    requestAnimationFrame(() => (ref.current?.querySelector(`[data-cel="${nl}-${nc}"]`) as HTMLElement | null)?.focus())
  }
  const teclas = (e: KeyboardEvent) => {
    const [l, c] = pos
    const m: Record<string, [number, number]> = { ArrowDown: [l + 1, c], ArrowUp: [l - 1, c], ArrowRight: [l, c + 1], ArrowLeft: [l, c - 1], Home: [l, 0], End: [l, colunas.length - 1] }
    if (e.key in m && !(e.target as HTMLElement).matches('input, textarea, [role=combobox]')) {
      e.preventDefault()
      ir(...m[e.key])
    }
  }
  const cel = (l: number, c: number) => ({ 'data-cel': `${l}-${c}`, tabIndex: pos[0] === l && pos[1] === c ? 0 : -1, onFocus: () => setPos([l, c]) })
  return (
    <table ref={ref} role="grid" aria-label={rotulo} onKeyDown={teclas} className={cn('w-full border-collapse text-left', className)}>
      <thead>
        <tr>
          {colunas.map((col, c) => (
            <th key={col.id} {...cel(0, c)} style={{ width: col.largura }} className={cn('foco-interno h-8 px-3 text-pequeno font-normal text-t3', col.alinhar === 'dir' && 'text-right')}>
              {col.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((linha, i) => (
          <tr key={obterId(linha)} className="transition-colors duration-(--dur-rapida) hover:bg-elevado">
            {colunas.map((col, c) => (
              <td key={col.id} {...cel(i + 1, c)} className={cn('foco-interno h-10 px-3 text-t2 first:rounded-l-controle last:rounded-r-controle', col.alinhar === 'dir' && 'num text-right')}>
                {col.render(linha)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
