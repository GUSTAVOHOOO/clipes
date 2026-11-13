// Paleta de comandos Ctrl+K (cmdk). Lê o registro de useComandos: o que a tela atual registrou vem primeiro.
// Subpáginas ("Ir para o Corte…") abrem com Enter; ⌫ com a busca vazia volta, Esc fecha.
import { Command } from 'cmdk'
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useComandosCtx, type Comando } from '@/lib/comandos'
import { Kbd } from '@/components/ui/Kbd'

export function Paleta() {
  const { paleta, fecharPaleta, abrirPaleta, lista, versao } = useComandosCtx()
  const [busca, setBusca] = useState('')
  const voltarFoco = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (paleta.aberta) voltarFoco.current = document.activeElement as HTMLElement | null
    else {
      setBusca('')
      // devolve o foco para onde estava (botão, alça da timeline…)
      const el = voltarFoco.current
      if (el && document.contains(el)) el.focus({ preventScroll: true })
    }
  }, [paleta.aberta])
  useEffect(() => setBusca(''), [paleta.pagina])

  const todos = useMemo(() => (paleta.aberta ? lista().filter(c => !c.oculto) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paleta.aberta, versao, lista])
  const pagina = paleta.pagina ? todos.find(c => c.id === paleta.pagina) ?? null : null
  const itens = pagina?.filhos ? pagina.filhos() : todos
  const grupos = useMemo(() => [...new Set(itens.map(c => c.grupo))], [itens])

  const executar = (c: Comando) => {
    if (c.desabilitado) return
    if (c.filhos) return abrirPaleta(c.id)
    fecharPaleta()
    // depois de fechar, para o foco já ter voltado quando a ação abrir outra camada
    requestAnimationFrame(() => c.executar?.())
  }

  if (!paleta.aberta) return null
  return (
    <div
      className="fixed inset-0 flex justify-center bg-scrim pt-[13vh] animate-[entra-fade_var(--dur-base)_var(--ease-out)]"
      style={{ zIndex: 'var(--z-palette)' }}
      onMouseDown={fecharPaleta}
    >
      <Command
        label="Paleta de comandos"
        loop
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (pagina) abrirPaleta(null)
            else fecharPaleta()
          }
          if (e.key === 'Backspace' && !busca && pagina) {
            e.preventDefault()
            abrirPaleta(null)
          }
        }}
        className="flex h-fit max-h-[min(500px,72vh)] w-[600px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-line-strong bg-raised shadow-dialog animate-[entra-cima_var(--dur-base)_var(--ease-out)]"
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-fg-3" aria-hidden />
          {pagina && (
            <span className="grid h-6 shrink-0 place-items-center rounded-sm bg-selected px-2 text-xs text-fg-2">
              {pagina.titulo.replace('…', '')}
            </span>
          )}
          <Command.Input
            autoFocus
            value={busca}
            onValueChange={setBusca}
            placeholder={pagina ? 'Procure pelo título ou por um trecho da fala' : 'Digite um comando ou procure'}
            className="h-full min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-3"
          />
          <Kbd atalho="Escape" />
        </div>
        <Command.List className="overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3">
          <Command.Empty className="px-3 py-10 text-center text-sm text-fg-3">
            Nenhum comando com “{busca}”.
          </Command.Empty>
          {grupos.map(g => (
            <Command.Group key={g} heading={g}>
              {itens
                .filter(c => c.grupo === g)
                .map(c => (
                  <Command.Item
                    key={c.id}
                    value={`${c.id} ${c.titulo}`}
                    keywords={c.palavras}
                    disabled={c.desabilitado}
                    onSelect={() => executar(c)}
                    className="flex h-9 cursor-default items-center gap-3 rounded-md px-2.5 text-sm text-fg-2 data-[disabled=true]:text-fg-disabled data-[selected=true]:bg-selected data-[selected=true]:text-fg"
                  >
                    <span className="flex-1 truncate">{c.titulo}</span>
                    {c.dica && <span className="timecode text-2xs text-fg-3">{c.dica}</span>}
                    {c.atalho && <Kbd atalho={c.atalho} />}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-line px-4 text-2xs text-fg-3">
          <span className="flex items-center gap-1.5">
            <Kbd teclas={['↑', '↓']} /> mover
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-sm border border-line-strong bg-field text-fg-2">
              <CornerDownLeft size={10} />
            </span>
            executar
          </span>
          {pagina && (
            <span className="flex items-center gap-1.5">
              <Kbd teclas={['⌫']} /> voltar
            </span>
          )}
        </div>
      </Command>
    </div>
  )
}

/** Botão da barra superior que abre a paleta. */
export function GatilhoPaleta() {
  const { abrirPaleta } = useComandosCtx()
  return (
    <button
      type="button"
      onClick={() => abrirPaleta()}
      className="foco flex h-7 items-center gap-2 rounded-md border border-line bg-canvas pr-1.5 pl-2.5 text-fg-3 transition-colors duration-(--dur-fast) hover:border-line-strong hover:text-fg-2"
    >
      <span className="text-xs">Comandos</span>
      <Kbd atalho="Ctrl+K" />
    </button>
  )
}
