// Camadas flutuantes: Dica (tooltip), Popover, Menu, Dialogo e ConfirmDialog.
// São as únicas superfícies com sombra. Entram com opacidade e escala curtas; somem com reduced-motion.
import { AlertDialog as AD } from '@base-ui/react/alert-dialog'
import { Dialog as D } from '@base-ui/react/dialog'
import { Menu as M } from '@base-ui/react/menu'
import { Popover as P } from '@base-ui/react/popover'
import { Tooltip as T } from '@base-ui/react/tooltip'
import { Check, X } from 'lucide-react'
import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/cn'
import { Botao, Kbd } from './Botao'

export const camadaBase =
  'origin-(--transform-origin) rounded-area bg-elevado text-t1 shadow-flutuante outline-none ' +
  'transition-[opacity,scale] duration-(--dur-base) ease-saida ' +
  'data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0'

export const itemBase =
  'flex h-8 w-full cursor-default items-center gap-2.5 rounded-controle px-2.5 text-base text-t2 outline-none select-none ' +
  'data-highlighted:bg-hover data-highlighted:text-t1 data-disabled:pointer-events-none data-disabled:opacity-40 ' +
  '[&_svg]:size-[15px] [&_svg]:stroke-[1.75]'

const SELETOR_FOCAVEL =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function primeiroFocavel(
  raiz: HTMLElement | null,
  ignorar?: HTMLElement | null,
): HTMLElement | null {
  if (!raiz) return null
  for (const el of raiz.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)) {
    if (ignorar && (el === ignorar || ignorar.contains(el))) continue
    if (el.closest('[hidden], [aria-hidden="true"]')) continue
    const estilo = window.getComputedStyle(el)
    if (estilo.display === 'none' || estilo.visibility === 'hidden') continue
    return el
  }
  return null
}

/* ---------- Dica ---------- */

export function ProvedorDicas({ children }: { children: ReactNode }) {
  return (
    <T.Provider delay={450} closeDelay={0}>
      {children}
    </T.Provider>
  )
}

type DicaProps = {
  texto: ReactNode
  atalho?: string
  lado?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactElement
}

/** Dica curta: nome da ação + atalho. Nunca guarda informação que só existe nela. */
export function Dica({ texto, atalho, lado = 'top', children }: DicaProps) {
  return (
    <T.Root>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner side={lado} sideOffset={6} style={{ zIndex: 'var(--z-tooltip)' }}>
          <T.Popup className={cn(camadaBase, 'flex items-center gap-2 rounded-controle px-2 py-1 text-pequeno text-t2')}>
            {texto}
            {atalho && <Kbd tom="forte">{atalho}</Kbd>}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  )
}

/* ---------- Popover ---------- */

type PopoverProps = {
  gatilho: ReactElement
  children: ReactNode
  titulo?: string
  lado?: 'top' | 'bottom' | 'left' | 'right'
  alinhar?: 'start' | 'center' | 'end'
  aberto?: boolean
  aoMudarAberto?: (aberto: boolean) => void
  /** fecha com Esc e clique fora, mas não prende o foco (ajuste ao lado do vídeo) */
  modal?: boolean
  className?: string
}

export function Popover({ gatilho, children, titulo, lado = 'bottom', alinhar = 'start', aberto, aoMudarAberto, modal = false, className }: PopoverProps) {
  const refPopup = useRef<HTMLDivElement>(null)
  const refFechar = useRef<HTMLButtonElement>(null)
  const refGatilho = useRef<HTMLButtonElement>(null)
  return (
    <P.Root
      open={aberto}
      onOpenChange={(v, details) => {
        aoMudarAberto?.(v)
        if (!v && (details?.reason === 'escape-key' || details?.reason === 'close-press')) {
          const g = refGatilho.current
          if (g) queueMicrotask(() => g.focus())
        }
      }}
      modal={modal}
    >
      <P.Trigger ref={refGatilho} render={gatilho} />
      <P.Portal>
        <P.Positioner side={lado} align={alinhar} sideOffset={8} collisionPadding={12} style={{ zIndex: 'var(--z-popover)' }}>
          <P.Popup
            ref={refPopup}
            data-nao-modal={modal ? undefined : ''}
            initialFocus={() => primeiroFocavel(refPopup.current, refFechar.current) ?? refFechar.current ?? true}
            finalFocus={() => refGatilho.current ?? true}
            className={cn(camadaBase, 'w-[268px] p-3', className)}
          >
            {titulo && (
              <div className="mb-2.5 flex items-center justify-between">
                <P.Title className="text-base font-forte">{titulo}</P.Title>
                <P.Close render={<Botao ref={refFechar} tamanho="p" className="w-6 px-0" aria-label="Fechar (Esc)" />}>
                  <X />
                </P.Close>
              </div>
            )}
            {children}
          </P.Popup>
        </P.Positioner>
      </P.Portal>
    </P.Root>
  )
}

/* ---------- Menu ---------- */

type MenuProps = {
  gatilho: ReactElement
  children: ReactNode
  lado?: 'top' | 'bottom' | 'left' | 'right'
  alinhar?: 'start' | 'center' | 'end'
  className?: string
}

export function Menu({ gatilho, children, lado = 'bottom', alinhar = 'start', className }: MenuProps) {
  return (
    <M.Root>
      <M.Trigger render={gatilho} />
      <M.Portal>
        <M.Positioner side={lado} align={alinhar} sideOffset={6} style={{ zIndex: 'var(--z-popover)' }}>
          <M.Popup className={cn(camadaBase, 'min-w-52 p-1', className)}>{children}</M.Popup>
        </M.Positioner>
      </M.Portal>
    </M.Root>
  )
}

type MenuItemProps = {
  children: ReactNode
  icone?: ReactNode
  atalho?: string
  perigo?: boolean
  desabilitado?: boolean
  aoSelecionar?: () => void
}

export function MenuItem({ children, icone, atalho, perigo, desabilitado, aoSelecionar }: MenuItemProps) {
  return (
    <M.Item disabled={desabilitado} onClick={aoSelecionar} className={cn(itemBase, perigo && 'text-erro data-highlighted:text-erro')}>
      {icone && <span className="grid w-4 place-items-center text-t3 [[data-highlighted]_&]:text-current">{icone}</span>}
      <span className="flex-1 truncate">{children}</span>
      {atalho && <Kbd tom="forte">{atalho}</Kbd>}
    </M.Item>
  )
}

export function MenuMarcavel({ children, marcado, aoMudar }: { children: ReactNode; marcado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <M.CheckboxItem checked={marcado} onCheckedChange={aoMudar} closeOnClick={false} className={itemBase}>
      <span className="grid w-4 place-items-center">
        <M.CheckboxItemIndicator>
          <Check />
        </M.CheckboxItemIndicator>
      </span>
      <span className="flex-1">{children}</span>
    </M.CheckboxItem>
  )
}

export const MenuSeparador = () => <M.Separator className="mx-1 my-1 h-px bg-linha" />

export function MenuGrupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <M.Group>
      <M.GroupLabel className="px-2.5 pt-2 pb-1 text-micro text-t3">{titulo}</M.GroupLabel>
      {children}
    </M.Group>
  )
}

/* ---------- Diálogo ---------- */

const veu =
  'fixed inset-0 bg-veu transition-opacity duration-(--dur-base) ease-saida data-starting-style:opacity-0 data-ending-style:opacity-0'
const janela =
  'fixed top-[14vh] left-1/2 w-[min(var(--largura),calc(100vw-32px))] -translate-x-1/2 rounded-area bg-elevado p-4 text-t1 shadow-flutuante outline-none ' +
  'transition-[opacity,scale] duration-(--dur-base) ease-saida data-starting-style:scale-[0.985] data-starting-style:opacity-0 data-ending-style:scale-[0.985] data-ending-style:opacity-0'

type DialogoProps = {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  titulo: string
  descricao?: ReactNode
  children?: ReactNode
  rodape?: ReactNode
  largura?: number
}

export function Dialogo({ aberto, aoMudarAberto, titulo, descricao, children, rodape, largura = 440 }: DialogoProps) {
  const refPopup = useRef<HTMLDivElement>(null)
  const refFechar = useRef<HTMLButtonElement>(null)
  return (
    <D.Root open={aberto} onOpenChange={(v) => aoMudarAberto(v)}>
      <D.Portal>
        <D.Backdrop className={veu} style={{ zIndex: 'var(--z-dialogo)' }} />
        <D.Popup
          ref={refPopup}
          initialFocus={() => primeiroFocavel(refPopup.current, refFechar.current) ?? refFechar.current ?? true}
          finalFocus
          className={janela}
          style={{ zIndex: 'var(--z-dialogo)', ['--largura' as string]: `${largura}px` }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <D.Title className="text-titulo font-forte tracking-[-0.01em]">{titulo}</D.Title>
              {descricao && <D.Description className="mt-1 text-t2">{descricao}</D.Description>}
            </div>
            <D.Close render={<Botao ref={refFechar} tamanho="p" className="-mt-0.5 -mr-1 w-6 px-0" aria-label="Fechar (Esc)" />}>
              <X />
            </D.Close>
          </div>
          {children && <div className="mt-4">{children}</div>}
          {rodape && <div className="mt-5 flex justify-end gap-2">{rodape}</div>}
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}

/* ---------- ConfirmDialog ---------- */

export interface ConfirmDialogProps {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  titulo: string
  descricao: string | ReactNode
  rotuloConfirmar: string
  rotuloCancelar?: string
  variante?: 'primario' | 'perigo'
  confirmarDesabilitado?: boolean
  ocupado?: boolean
  /** padrão "cancelar" em ação de perigo ou paga, para Enter acidental não confirmar */
  focoInicial?: 'cancelar' | 'confirmar'
  focoFinal?: RefObject<HTMLElement | null>
  aoConfirmar: () => void | Promise<void>
  children?: ReactNode
}

export function ConfirmDialog({
  aberto,
  aoMudarAberto,
  titulo,
  descricao,
  rotuloConfirmar,
  rotuloCancelar = 'Cancelar',
  variante = 'primario',
  confirmarDesabilitado,
  ocupado,
  focoInicial = 'cancelar',
  focoFinal,
  aoConfirmar,
  children,
}: ConfirmDialogProps) {
  const refCancelar = useRef<HTMLButtonElement>(null)
  const refConfirmar = useRef<HTMLButtonElement>(null)
  return (
    <AD.Root open={aberto} onOpenChange={(v) => aoMudarAberto(v)}>
      <AD.Portal>
        <AD.Backdrop className={veu} style={{ zIndex: 'var(--z-dialogo)' }} />
        <AD.Popup
          className={janela}
          style={{ zIndex: 'var(--z-dialogo)', ['--largura' as string]: '440px' }}
          initialFocus={focoInicial === 'cancelar' ? refCancelar : refConfirmar}
          finalFocus={focoFinal ?? true}
        >
          <AD.Title className="text-titulo font-forte tracking-[-0.01em]">{titulo}</AD.Title>
          <AD.Description className="mt-1 text-t2" render={typeof descricao === 'string' ? <p /> : <div />}>
            {descricao}
          </AD.Description>
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <AD.Close render={<Botao variante="fantasma" ref={refCancelar} />}>{rotuloCancelar}</AD.Close>
            <Botao
              ref={refConfirmar}
              variante={variante === 'perigo' ? 'perigo' : 'primario'}
              disabled={confirmarDesabilitado}
              carregando={ocupado}
              onClick={() => void aoConfirmar()}
            >
              {rotuloConfirmar}
            </Botao>
          </div>
        </AD.Popup>
      </AD.Portal>
    </AD.Root>
  )
}
