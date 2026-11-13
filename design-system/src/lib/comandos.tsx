// Comandos e atalhos: uma ação, um registro. Toda ação entra na paleta Ctrl+K; as frequentes ganham tecla.
//
//   useComandos([{ id: 'exportar', titulo: 'Exportar Corte', grupo: 'Corte', atalho: 'Ctrl+E', executar }])
//
// A tecla e o item da paleta saem do mesmo objeto, então o atalho mostrado em <Kbd> nunca mente.
// Regras do teclado (por ordem):
//   1. Com a paleta aberta, só ela ouve.
//   2. Num campo de texto, só combinações com Ctrl disparam (Ctrl+K, Ctrl+E…). Letras soltas são texto.
//   3. Dentro de diálogo ou menu aberto, só comandos `global`.
//   4. Se um componente já tratou a tecla (preventDefault), ninguém mais trata. Ex.: setas numa alça da timeline.
//   5. Enter e Espaço em controle interativo ativam o controle focado, antes do atalho da tela.
//   6. O registro montado por último ganha: o editor sobrepõe a tela, uma gaveta sobrepõe o editor.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

export type Comando = {
  id: string
  titulo: string
  /** Cabeçalho do grupo na paleta: "Corte", "Mostrar", "Legenda", "Navegar", "App"… */
  grupo: string
  /** 'Ctrl+E', 'Shift+ArrowLeft', 'Space', 'Escape', '[', 'C'. Ctrl vale também para ⌘. */
  atalho?: string
  /** Sinônimos para a busca da paleta. */
  palavras?: string[]
  /** Texto curto à direita do item na paleta (ex.: "2/4"). */
  dica?: string
  executar?: () => void
  /** Abre uma subpágina da paleta (ex.: "Ir para o Corte…"). */
  filhos?: () => Comando[]
  desabilitado?: boolean
  /** Fica fora da paleta (atalho de navegação fina, como ← → por palavra). */
  oculto?: boolean
  /** Dispara mesmo com diálogo ou menu aberto. */
  global?: boolean
  /** Deixa a tecla repetir quando segurada (setas). Padrão: não repete. */
  repete?: boolean
}

type Registro = { escopo: string; ordem: number; comandos: { current: Comando[] } }

type Ctx = {
  registrar: (escopo: string, comandos: { current: Comando[] }) => void
  remover: (escopo: string) => void
  lista: () => Comando[]
  versao: number
  paleta: { aberta: boolean; pagina: string | null }
  abrirPaleta: (pagina?: string | null) => void
  fecharPaleta: () => void
  focoRetornoPaleta: RefObject<HTMLElement | null>
}

const ComandosCtx = createContext<Ctx | null>(null)

export function useComandosCtx() {
  const c = useContext(ComandosCtx)
  if (!c) throw new Error('useComandos precisa do <ComandosProvider>')
  return c
}

/* ------------------------------------------------------------------ atalhos */

const ALIAS: Record<string, string> = { space: ' ', espaço: ' ', esc: 'escape', del: 'delete' }
const ROTULO: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  ' ': 'Espaço',
  escape: 'Esc',
  enter: 'Enter',
  backspace: '⌫',
  delete: 'Del',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
}

type Combo = { ctrl: boolean; shift: boolean; alt: boolean; tecla: string }

export function lerAtalho(a: string): Combo {
  const partes = a.split('+').map((p) => p.trim())
  const tecla = partes.pop()!.toLowerCase()
  const mods = new Set(partes.map((p) => p.toLowerCase()))
  return {
    ctrl: mods.has('ctrl') || mods.has('mod'),
    shift: mods.has('shift'),
    alt: mods.has('alt'),
    tecla: ALIAS[tecla] ?? tecla,
  }
}

/** Rótulos para <Kbd>: 'Ctrl+Shift+ArrowLeft' → ['Ctrl', 'Shift', '←']. */
export function teclasDe(a: string): string[] {
  const c = lerAtalho(a)
  const t =
    ROTULO[c.tecla] ?? (c.tecla.length === 1 ? c.tecla.toUpperCase() : c.tecla[0].toUpperCase() + c.tecla.slice(1))
  return [...(c.ctrl ? ['Ctrl'] : []), ...(c.alt ? ['Alt'] : []), ...(c.shift ? ['Shift'] : []), t]
}

const SIMBOLO_COM_SHIFT = new Set(['?', '{', '}', '+', '_', ':', '"', '<', '>', '|', '~', '!'])

export function combina(e: KeyboardEvent, a: string) {
  const c = lerAtalho(a)
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl !== c.ctrl || e.altKey !== c.alt) return false
  const k = e.key.toLowerCase()
  if (!SIMBOLO_COM_SHIFT.has(c.tecla) && e.shiftKey !== c.shift) return false
  // Com Ctrl, alguns layouts trocam e.key; e.code dá a letra física (KeyE).
  if (k === c.tecla) return true
  return c.tecla.length === 1 && /[a-z]/.test(c.tecla) && e.code === `Key${c.tecla.toUpperCase()}`
}

const emCampo = (el: Element | null) =>
  !!el?.closest?.(
    'input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select,[contenteditable="true"],[role="textbox"]',
  )
const emCamada = (el: Element | null) =>
  !!el?.closest?.('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')
const emMenu = (el: Element | null) => !!el?.closest?.('[role="menu"],[role="listbox"]')
const temAtivacao = (el: Element | null) =>
  !!el?.closest?.(
    'button,a[href],summary,input[type=checkbox],input[type=radio],input[type=button],input[type=submit],input[type=reset],' +
      '[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"]',
  )

/* ------------------------------------------------------------------ provider */

export function ComandosProvider({ children }: { children: ReactNode }) {
  const registros = useRef(new Map<string, Registro>())
  const contador = useRef(0)
  const [versao, setVersao] = useState(0)
  const [paleta, setPaleta] = useState<{ aberta: boolean; pagina: string | null }>(() => ({
    aberta: typeof location !== 'undefined' && /[?&]paleta(?![\w-])/.test(location.search + location.hash),
    pagina: null,
  }))
  const paletaRef = useRef(paleta)
  const focoRetornoPaleta = useRef<HTMLElement | null>(null)
  const ultimoControle = useRef<HTMLElement | null>(null)
  paletaRef.current = paleta
  useEffect(() => {
    const lembrar = (evento: FocusEvent) => {
      const el = evento.target
      if (
        !paletaRef.current.aberta &&
        el instanceof HTMLElement &&
        el.tabIndex >= 0 &&
        !emMenu(el) &&
        !el.hasAttribute('data-base-ui-focus-guard')
      )
        ultimoControle.current = el
    }
    addEventListener('focusin', lembrar)
    return () => removeEventListener('focusin', lembrar)
  }, [])

  const registrar = useCallback((escopo: string, comandos: { current: Comando[] }) => {
    registros.current.set(escopo, { escopo, ordem: ++contador.current, comandos })
    setVersao((v) => v + 1)
  }, [])
  const remover = useCallback((escopo: string) => {
    registros.current.delete(escopo)
    setVersao((v) => v + 1)
  }, [])
  /** Mais recente primeiro; ids repetidos ficam com o mais recente. */
  const lista = useCallback(() => {
    const vistos = new Set<string>()
    const out: Comando[] = []
    ;[...registros.current.values()]
      .sort((a, b) => b.ordem - a.ordem)
      .forEach((r) =>
        r.comandos.current.forEach((c) => {
          if (!vistos.has(c.id)) {
            vistos.add(c.id)
            out.push(c)
          }
        }),
      )
    return out
  }, [])

  const abrirPaleta = useCallback((pagina: string | null = null) => {
    if (!paletaRef.current.aberta) {
      const el = document.activeElement
      // Um select/menu pode ainda estar encerrando: restaure o seu gatilho, não a opção transitória.
      focoRetornoPaleta.current = el instanceof HTMLElement && !emMenu(el) ? el : ultimoControle.current
    }
    setPaleta({ aberta: true, pagina })
  }, [])
  const fecharPaleta = useCallback(() => setPaleta({ aberta: false, pagina: null }), [])

  useEffect(() => {
    const ouvir = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const alvo = e.target as Element | null
      const ctrl = e.ctrlKey || e.metaKey
      // Ctrl+K abre e fecha a paleta de qualquer lugar.
      if (ctrl && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault()
        paletaRef.current.aberta ? fecharPaleta() : abrirPaleta()
        return
      }
      if (paletaRef.current.aberta) return
      if (emCampo(alvo) && !ctrl) return
      // O comportamento nativo ocorre depois de keydown. Interceptá-lo aqui impediria, por exemplo,
      // Enter em "Aprovar" e abriria o editor pelo atalho Enter da lista.
      if (!ctrl && !e.altKey && !e.shiftKey && (e.key === 'Enter' || e.key === ' ') && temAtivacao(alvo)) return
      const camada = emCamada(alvo)
      for (const c of lista()) {
        if (!c.atalho || c.desabilitado || (camada && !c.global)) continue
        if (!combina(e, c.atalho)) continue
        if (e.repeat && !c.repete) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        if (c.filhos) abrirPaleta(c.id)
        else c.executar?.()
        return
      }
    }
    addEventListener('keydown', ouvir)
    return () => removeEventListener('keydown', ouvir)
  }, [lista, abrirPaleta, fecharPaleta])

  const valor = useMemo<Ctx>(
    () => ({ registrar, remover, lista, versao, paleta, abrirPaleta, fecharPaleta, focoRetornoPaleta }),
    [registrar, remover, lista, versao, paleta, abrirPaleta, fecharPaleta],
  )
  return <ComandosCtx.Provider value={valor}>{children}</ComandosCtx.Provider>
}

/**
 * Registra comandos enquanto o componente está montado. Os objetos podem mudar a cada render
 * (rótulo "Pausar"/"Reproduzir", ação com estado novo): o registro lê sempre a versão do último render,
 * sem re-registrar. Só montar e desmontar mexem na lista.
 */
export function useComandos(comandos: Comando[]) {
  const { registrar, remover } = useComandosCtx()
  const escopo = useId()
  const ref = useRef(comandos)
  ref.current = comandos
  useEffect(() => {
    registrar(escopo, ref)
    return () => remover(escopo)
  }, [registrar, remover, escopo])
}
