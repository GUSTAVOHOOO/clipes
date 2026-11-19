// Escolhas: Checkbox, Switch, Slider, Segmentado (2–4 opções exclusivas) e GradeOpcoes (opções com ícone).
// Ligado/selecionado é mostrado por forma (marca, posição, contorno), não só por cor.
import { Checkbox as C } from '@base-ui/react/checkbox'
import { Slider as Sl } from '@base-ui/react/slider'
import { Switch as Sw } from '@base-ui/react/switch'
import { Check, Minus } from 'lucide-react'
import { isValidElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

function semRotuloVisivel(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return true
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim().length === 0
  if (Array.isArray(node)) return node.every(semRotuloVisivel)
  if (isValidElement<{ className?: unknown }>(node)) {
    const cls = typeof node.props.className === 'string' ? node.props.className.split(/\s+/) : []
    return cls.includes('sr-only')
  }
  return false
}

type CheckboxProps = {
  marcado: boolean | 'misto'
  aoMudar: (v: boolean) => void
  children?: ReactNode
  desabilitado?: boolean
  className?: string
}

export function Checkbox({ marcado, aoMudar, children, desabilitado, className }: CheckboxProps) {
  const soLeitor = semRotuloVisivel(children)
  return (
    <label
      className={cn(
        'inline-flex min-h-6 min-w-6 cursor-pointer items-center gap-2 text-base text-t2 select-none has-data-disabled:pointer-events-none has-data-disabled:opacity-40',
        soLeitor && 'justify-center',
        className,
      )}
    >
      <C.Root
        checked={marcado === true}
        indeterminate={marcado === 'misto'}
        onCheckedChange={(v) => aoMudar(v)}
        disabled={desabilitado}
        className="grid size-4 shrink-0 place-items-center rounded-mini bg-transparent shadow-[inset_0_0_0_1px_var(--linha-forte)] transition-colors duration-(--dur-rapida) ease-saida data-checked:bg-t1 data-checked:shadow-none data-indeterminate:bg-t1 data-indeterminate:shadow-none"
      >
        <C.Indicator className="text-chao" render={(p, s) => <span {...p}>{s.indeterminate ? <Minus className="size-3 stroke-[2.5]" /> : <Check className="size-3 stroke-[2.5]" />}</span>} />
      </C.Root>
      {children}
    </label>
  )
}

type SwitchProps = { ligado: boolean; aoMudar: (v: boolean) => void; children?: ReactNode; desabilitado?: boolean; className?: string }

export function Switch({ ligado, aoMudar, children, desabilitado, className }: SwitchProps) {
  return (
    <label className={cn('inline-flex min-h-6 cursor-pointer items-center gap-2 text-base text-t2 select-none has-data-disabled:pointer-events-none has-data-disabled:opacity-40', className)}>
      <Sw.Root
        checked={ligado}
        onCheckedChange={(v) => aoMudar(v)}
        disabled={desabilitado}
        className="relative flex h-4 w-7 shrink-0 items-center rounded-full bg-transparent p-0.5 shadow-[inset_0_0_0_1px_var(--linha-forte)] transition-colors duration-(--dur-base) ease-saida data-checked:bg-t1 data-checked:shadow-none"
      >
        <Sw.Thumb className="size-3 rounded-full bg-t3 transition-[translate,background-color] duration-(--dur-base) ease-saida data-checked:translate-x-3 data-checked:bg-chao" />
      </Sw.Root>
      {children}
    </label>
  )
}

type SliderProps = {
  valor: number
  aoMudar: (v: number) => void
  min?: number
  max?: number
  passo?: number
  rotulo: string
  /** texto lido pelo leitor de tela, ex.: "−6 dB" */
  textoValor?: (v: number) => string
  desabilitado?: boolean
  className?: string
}

/** Trilho fino (4 px) com polegar claro; alvo de 24 px pela área do controle. */
export function Slider({ valor, aoMudar, min = 0, max = 100, passo = 1, rotulo, textoValor, desabilitado, className }: SliderProps) {
  return (
    <Sl.Root value={valor} onValueChange={(v) => aoMudar(v as number)} min={min} max={max} step={passo} disabled={desabilitado} className={cn('w-full data-disabled:opacity-40', className)}>
      <Sl.Control className="flex h-6 w-full cursor-pointer touch-none items-center select-none">
        <Sl.Track className="relative h-1 w-full rounded-full bg-chao shadow-[inset_0_0_0_1px_var(--linha)]">
          <Sl.Indicator className="rounded-full bg-t3" />
          <Sl.Thumb
            aria-label={rotulo}
            getAriaValueText={textoValor ? (_f: string, v: number) => textoValor(v) : undefined}
            className="size-3 rounded-full bg-t1 outline-none has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-offset-2 has-focus-visible:outline-foco"
          />
        </Sl.Track>
      </Sl.Control>
    </Sl.Root>
  )
}

type OpcaoSeg<V extends string> = { valor: V; rotulo: ReactNode; desabilitada?: boolean }

/** Escolha exclusiva curta (Preencher · Ajustar · Duplo). Usa radiogroup com setas. */
export function Segmentado<V extends string>({ valor, aoMudar, opcoes, rotulo, className }: { valor: V; aoMudar: (v: V) => void; opcoes: OpcaoSeg<V>[]; rotulo: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={cn('flex gap-0.5 rounded-controle bg-chao p-0.5 shadow-[inset_0_0_0_1px_var(--contorno-controle)]', className)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const ativas = opcoes.filter((o) => !o.desabilitada)
        const i = ativas.findIndex((o) => o.valor === valor)
        const prox = ativas[(i + (e.key === 'ArrowRight' ? 1 : -1) + ativas.length) % ativas.length]
        aoMudar(prox.valor)
        requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus())
      }}
    >
      {opcoes.map((o) => {
        const sel = o.valor === valor
        return (
          <button key={o.valor} type="button" role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1} disabled={o.desabilitada} onClick={() => aoMudar(o.valor)}
            className={cn('min-h-6.5 flex-1 cursor-pointer rounded-mini border-0 px-2.5 text-pequeno whitespace-nowrap transition-colors duration-(--dur-rapida) ease-saida disabled:opacity-40',
              sel ? 'bg-elevado font-medio text-t1 shadow-[inset_0_0_0_1px_var(--contorno-controle)]' : 'bg-transparent text-t3 hover:text-t2')}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}

type OpcaoGrade<V extends string> = { valor: V; rotulo: string; icone: ReactNode }

/** Opções grandes com ícone (modos de enquadramento, estilos de legenda). A escolhida leva a marca de sinal. */
export function GradeOpcoes<V extends string>({ valor, aoMudar, opcoes, rotulo, colunas = 3 }: { valor: V; aoMudar: (v: V) => void; opcoes: OpcaoGrade<V>[]; rotulo: string; colunas?: 2 | 3 }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={cn('grid gap-1.5', colunas === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {opcoes.map((o) => {
        const sel = o.valor === valor
        return (
          <button key={o.valor} type="button" role="radio" aria-checked={sel} onClick={() => aoMudar(o.valor)}
            className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-controle border-0 px-1.5 py-2 text-pequeno transition-colors duration-(--dur-base) ease-saida [&_svg]:size-4 [&_svg]:stroke-[1.75]',
              sel ? 'marcado bg-hover font-medio text-t1' : 'bg-chao text-t2 shadow-[inset_0_0_0_1px_var(--contorno-controle)] hover:bg-hover hover:text-t1')}
          >
            {o.icone}
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}
