// Abas, Status (ícone + palavra cinza), Progresso, Skeleton, Separador, AreaRolagem e Toast.
import { Progress as Pr } from '@base-ui/react/progress'
import { ScrollArea as SA } from '@base-ui/react/scroll-area'
import { Separator as Se } from '@base-ui/react/separator'
import { Tabs as Tb } from '@base-ui/react/tabs'
import { Toast as To } from '@base-ui/react/toast'
import {
  AlertTriangle,
  Check,
  CircleDashed,
  CircleX,
  Info,
  Loader2,
  Pause,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/* ---------- Abas ---------- */

export type Aba<V extends string> = { valor: V; rotulo: ReactNode; desabilitada?: boolean; dica?: string }

/** Abas de texto: a ativa sobe um degrau (elevado), as outras ficam em t3. */
export function Abas<V extends string>({ valor, aoMudar, abas, rotulo, tamanho = 'm', className }: { valor: V; aoMudar: (v: V) => void; abas: Aba<V>[]; rotulo: string; tamanho?: 'p' | 'm'; className?: string }) {
  return (
    <Tb.Root value={valor} onValueChange={(v) => aoMudar(v as V)}>
      <Tb.List aria-label={rotulo} className={cn('flex gap-0.5', className)}>
        {abas.map((a) => (
          <Tb.Tab key={a.valor} value={a.valor} disabled={a.desabilitada} title={a.dica}
            className={cn('cursor-pointer rounded-controle border-0 bg-transparent text-t3 transition-colors duration-(--dur-rapida) ease-saida hover:text-t2 data-active:bg-elevado data-active:text-t1 data-active:shadow-[inset_0_0_0_1px_var(--contorno-controle)] data-disabled:cursor-default data-disabled:opacity-50 data-disabled:hover:text-t3',
              tamanho === 'p' ? 'h-6 px-2 text-pequeno' : 'h-7 px-2.5 text-base')}
          >
            {a.rotulo}
          </Tb.Tab>
        ))}
      </Tb.List>
    </Tb.Root>
  )
}

/* ---------- Status ---------- */

export type TomStatus = 'neutro' | 'info' | 'sucesso' | 'aviso' | 'perigo' | 'rodando' | 'pausado' | 'pendente'

const iconesTom: Record<TomStatus, LucideIcon> = {
  neutro: CircleDashed,
  pendente: CircleDashed,
  info: Info,
  sucesso: Check,
  aviso: AlertTriangle,
  perigo: CircleX,
  rodando: Loader2,
  pausado: Pause,
}

/** Estado = ícone + palavra, sempre cinza (SC 1.4.1). O tom só escolhe o ícone. */
export function Status({ tom = 'neutro', icone, children, className, forte }: { tom?: TomStatus; icone?: ReactNode; children: ReactNode; className?: string; forte?: boolean }) {
  const Icone = iconesTom[tom]
  return (
    <span className={cn('inline-flex items-center gap-1 text-pequeno whitespace-nowrap', forte ? 'text-t2' : 'text-t3', className)}>
      {icone ?? <Icone aria-hidden className={cn('size-[13px] shrink-0 stroke-[1.75]', tom === 'rodando' && 'animate-spin motion-reduce:animate-none')} />}
      {children}
    </span>
  )
}

/* ---------- Progresso ---------- */

type ProgressoProps = { valor: number | null; rotulo: string; detalhe?: ReactNode; compacto?: boolean; className?: string }

/** Barra de 2 px, cinza; indeterminado (null) pulsa. O número fica em texto tabular ao lado. */
export function Progresso({ valor, rotulo, detalhe, compacto, className }: ProgressoProps) {
  return (
    <Pr.Root value={valor} className={cn('flex w-full flex-col gap-1.5', className)}>
      {!compacto && (
        <div className="flex items-baseline justify-between gap-3 text-pequeno">
          <Pr.Label className="text-t2">{rotulo}</Pr.Label>
          <span className="num text-t3">{detalhe ?? (valor != null ? `${Math.round(valor)}%` : 'calculando…')}</span>
        </div>
      )}
      <Pr.Track aria-label={compacto ? rotulo : undefined} className="h-0.5 w-full overflow-hidden rounded-full bg-elevado">
        <Pr.Indicator className={cn('block h-full bg-t2 transition-[width] duration-(--dur-lenta) ease-saida', valor == null && 'w-1/3 animate-pulso')} />
      </Pr.Track>
    </Pr.Root>
  )
}

/* ---------- Skeleton ---------- */

/** Contorno neutro no formato do que vai chegar. Estático com reduced-motion. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('rounded-controle bg-elevado animate-pulso motion-reduce:animate-none', className)} />
}

/* ---------- Separador ---------- */

export function Separador({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <Se orientation={vertical ? 'vertical' : 'horizontal'} className={cn('shrink-0 bg-linha', vertical ? 'h-3.5 w-px' : 'h-px w-full', className)} />
}

/* ---------- AreaRolagem ---------- */

/** Rolagem com barra fina do sistema; o conteúdo recebe foco por teclado quando rolável. */
export function AreaRolagem({ children, className, rotulo }: { children: ReactNode; className?: string; rotulo?: string }) {
  return (
    <SA.Root className={cn('relative min-h-0', className)}>
      <SA.Viewport aria-label={rotulo} className="foco-interno h-full overscroll-contain rounded-controle">
        <SA.Content>{children}</SA.Content>
      </SA.Viewport>
      <SA.Scrollbar className="flex w-2 justify-center p-0.5 opacity-0 transition-opacity duration-(--dur-base) data-hovering:opacity-100 data-scrolling:opacity-100">
        <SA.Thumb className="w-1 rounded-full bg-linha-forte/60" />
      </SA.Scrollbar>
    </SA.Root>
  )
}

/* ---------- Toast ---------- */

export const useToast = To.useToastManager

function ListaToasts() {
  const { toasts } = To.useToastManager()
  return toasts.map((t) => (
    <To.Root key={t.id} toast={t}
      className="flex items-center gap-2 rounded-controle bg-elevado py-2 pr-1.5 pl-3 text-pequeno text-t2 shadow-toast transition-[opacity,translate] duration-(--dur-lenta) ease-saida data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0"
    >
      <To.Content className="flex min-w-0 flex-1 items-center gap-2">
        {t.type === 'erro' ? (
          <CircleX className="size-[14px] shrink-0 stroke-[1.75] text-erro" aria-hidden />
        ) : t.type === 'aviso' ? (
          <AlertTriangle className="size-[14px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
        ) : (
          <Check className="size-[14px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <To.Title className="text-t1" />
          <To.Description className="text-t3" />
        </div>
        {t.actionProps && <To.Action className="h-6 cursor-pointer rounded-controle border-0 bg-transparent px-2 text-pequeno font-medio text-t1 hover:bg-hover" />}
        <To.Close aria-label="Dispensar" className="grid size-6 cursor-pointer place-items-center rounded-controle border-0 bg-transparent text-t3 hover:bg-hover hover:text-t1">
          <X className="size-[14px] stroke-[1.75]" />
        </To.Close>
      </To.Content>
    </To.Root>
  ))
}

export type PosicaoToast =
  | 'acima-acoes'
  | 'inferior-direita'
  | 'inferior-esquerda'
  | 'inferior-centro'
  | 'superior-centro'

const classesPosicaoToast: Record<PosicaoToast, string> = {
  'acima-acoes': 'fixed flex w-[min(340px,calc(100vw-32px))] flex-col gap-2 outline-none',
  'inferior-direita': 'fixed right-4 bottom-10 flex w-[min(340px,calc(100vw-32px))] flex-col gap-2 outline-none',
  'inferior-esquerda': 'fixed left-4 bottom-10 flex w-[min(340px,calc(100vw-32px))] flex-col gap-2 outline-none',
  'inferior-centro': 'fixed bottom-10 left-1/2 flex w-[min(340px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2 outline-none',
  'superior-centro': 'fixed top-12 left-1/2 flex w-[min(340px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2 outline-none',
}

/** Toasts discretos posicionados acima da faixa inferior de ações por padrão. */
export function ProvedorToast({
  children,
  posicao = 'acima-acoes',
}: {
  children: ReactNode
  posicao?: PosicaoToast
}) {
  const estiloViewport =
    posicao === 'acima-acoes'
      ? {
          zIndex: 'var(--z-toast)',
          right: 'var(--toast-right, 1rem)',
          bottom: 'var(--toast-bottom, 7rem)',
        }
      : { zIndex: 'var(--z-toast)' }

  return (
    <To.Provider timeout={4000} limit={3}>
      {children}
      <To.Portal>
        <To.Viewport className={classesPosicaoToast[posicao]} style={estiloViewport}>
          <ListaToasts />
        </To.Viewport>
      </To.Portal>
    </To.Provider>
  )
}
