// <Paleta>: Ctrl/Cmd+K em qualquer tela (inclusive dentro de campos). Filtra comandos por escopo,
// mostra o mesmo atalho do manipulador ativo e devolve o foco ao fechar.
import { Dialog as D } from '@base-ui/react/dialog'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Kbd } from '@/primitivas/Botao'
import { camadaBase } from '@/primitivas/Flutuantes'
import { cn } from '@/lib/cn'

export type Comando = {
  id: string
  rotulo: string
  grupo?: string
  atalho?: string
  icone?: ReactNode
  desabilitado?: boolean
  /** palavras extras para a busca */
  termos?: string[]
  aoExecutar: () => void
}

type PaletaProps = {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  comandos: Comando[]
  placeholder?: string
}

/** Liga Ctrl/Cmd+K para abrir/fechar a paleta. */
export function useAtalhoPaleta(alternar: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        alternar()
      }
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [alternar])
}

export function Paleta({ aberto, aoMudarAberto, comandos, placeholder = 'Digitar comando…' }: PaletaProps) {
  const grupos = [...new Set(comandos.map((c) => c.grupo ?? ''))]
  return (
    <D.Root open={aberto} onOpenChange={(v) => aoMudarAberto(v)}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 bg-veu transition-opacity duration-(--dur-base) data-ending-style:opacity-0 data-starting-style:opacity-0" style={{ zIndex: 'var(--z-dialogo)' }} />
        <D.Popup aria-label="Paleta de comandos" className={cn(camadaBase, 'fixed top-[14vh] left-1/2 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 p-2')} style={{ zIndex: 'var(--z-dialogo)' }}>
          <D.Title className="sr-only">Paleta de comandos</D.Title>
          <Command label="Comandos" loop>
            <div className="mb-1.5 flex items-center gap-2 border-b border-linha px-2 pt-1 pb-2">
              <Search className="size-[15px] stroke-[1.75] text-t3" aria-hidden />
              <Command.Input autoFocus placeholder={placeholder} className="h-7 flex-1 border-0 bg-transparent text-campo text-t1 outline-none placeholder:text-t3" />
              <Kbd tom="forte">Esc</Kbd>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto">
              <Command.Empty className="px-2.5 py-6 text-center text-t3">Nenhum comando com esse nome.</Command.Empty>
              {grupos.map((g) => (
                <Command.Group key={g} heading={g || undefined} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:text-t3">
                  {comandos
                    .filter((c) => (c.grupo ?? '') === g)
                    .map((c) => (
                      <Command.Item key={c.id} value={`${c.rotulo} ${c.id}`} keywords={c.termos} disabled={c.desabilitado}
                        onSelect={() => {
                          aoMudarAberto(false)
                          c.aoExecutar()
                        }}
                        className="flex h-9 cursor-pointer items-center gap-2.5 rounded-controle px-2.5 text-t2 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40 data-[selected=true]:bg-hover data-[selected=true]:text-t1 data-[selected=true]:shadow-marca [&_svg]:size-[15px] [&_svg]:stroke-[1.75] [&_svg]:text-t3"
                      >
                        {c.icone}
                        <span className="flex-1 truncate">{c.rotulo}</span>
                        {c.atalho && <Kbd tom="forte">{c.atalho}</Kbd>}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}
