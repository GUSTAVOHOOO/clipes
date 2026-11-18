import { Paleta, type Comando } from '@ds'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { usePreferencias } from '~/preferencias/preferencias'

export type Atalho = {
  id: string
  titulo: string
  grupo: string
  tecla?: string
  teclaUnica?: boolean
  executar(): void
}

export type OpcoesTratar = {
  teclasUnicas: boolean
  remapeados?: Record<string, string>
}

export type RegistroAtalhos = {
  registrar(a: Atalho[]): () => void
  lista(): Atalho[]
  tratar(e: KeyboardEvent, opcoes: OpcoesTratar): boolean
  assinar?(fn: () => void): () => void
}

type Combo = { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; tecla: string }

const ALIAS: Record<string, string> = {
  space: ' ',
  espaço: ' ',
  esc: 'escape',
  del: 'delete',
}

const SIMBOLO_COM_SHIFT = new Set(['?', '{', '}', '+', '_', ':', '"', '<', '>', '|', '~', '!'])

function lerCombo(tecla: string): Combo {
  if (tecla === '+') {
    return { mod: false, ctrl: false, alt: false, shift: false, tecla: '+' }
  }
  const terminaMais = tecla.endsWith('++')
  const bruto = terminaMais ? tecla.slice(0, -2) : tecla
  const partes = bruto.split('+').map((p) => p.trim()).filter(Boolean)
  const principal = (terminaMais ? '+' : partes.pop() ?? '').toLowerCase()
  const mods = new Set(partes.map((p) => p.toLowerCase()))

  return {
    mod: mods.has('mod') || mods.has('cmd'),
    ctrl: mods.has('ctrl'),
    alt: mods.has('alt'),
    shift: mods.has('shift'),
    tecla: ALIAS[principal] ?? principal,
  }
}

function ehTeclaUnica(atalho: Atalho, teclaEfetiva: string): boolean {
  if (atalho.teclaUnica === true) return true
  if (atalho.teclaUnica === false) return false
  const combo = lerCombo(teclaEfetiva)
  return !combo.mod && !combo.ctrl && !combo.alt && combo.tecla.length === 1
}

function combina(e: KeyboardEvent, tecla: string): boolean {
  const combo = lerCombo(tecla)
  const temMod = e.ctrlKey || e.metaKey
  const esperaMod = combo.mod || combo.ctrl
  if (temMod !== esperaMod || e.altKey !== combo.alt) return false

  if (!SIMBOLO_COM_SHIFT.has(combo.tecla) && e.shiftKey !== combo.shift) {
    return false
  }

  const k = e.key.toLowerCase()
  if (k === combo.tecla) return true
  return combo.tecla.length === 1 && /[a-z]/.test(combo.tecla) && e.code === `Key${combo.tecla.toUpperCase()}`
}

function emCampoDeTexto(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false
  if (
    el.closest(
      'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]),textarea,select,[role="textbox"]',
    )
  ) {
    return true
  }
  const editable = el.closest('[contenteditable]')
  return !!editable && editable.getAttribute('contenteditable') !== 'false'
}

function emControleAtivavel(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false
  return !!el.closest(
    'button,a[href],summary,input[type=checkbox],input[type=radio],input[type=button],input[type=submit],input[type=reset],' +
      '[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"]',
  )
}

function formatarTecla(tecla: string): string {
  const ehMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
  return tecla.replace(/\bMod\b/gi, ehMac ? '⌘' : 'Ctrl')
}

/** Cria um registro puro de comandos e atalhos, dando prioridade ao último bloco registrado. */
export function criarRegistro() {
  type Entrada = { ordem: number; atalhos: Atalho[] }
  const entradas = new Map<number, Entrada>()
  const assinantes = new Set<() => void>()
  let contador = 0
  let cacheLista: Atalho[] | null = null

  function notificar() {
    cacheLista = null
    for (const fn of assinantes) fn()
  }

  function registrar(atalhos: Atalho[]): () => void {
    const id = ++contador
    entradas.set(id, { ordem: id, atalhos })
    notificar()
    return () => {
      if (entradas.delete(id)) notificar()
    }
  }

  function entradasOrdenadas(): Entrada[] {
    return [...entradas.values()].sort((a, b) => b.ordem - a.ordem)
  }

  function lista(): Atalho[] {
    if (cacheLista) return cacheLista
    const vistos = new Set<string>()
    const out: Atalho[] = []
    for (const entrada of entradasOrdenadas()) {
      for (const atalho of entrada.atalhos) {
        if (!vistos.has(atalho.id)) {
          vistos.add(atalho.id)
          out.push(atalho)
        }
      }
    }
    cacheLista = out
    return out
  }

  function tratar(e: KeyboardEvent, opcoes: OpcoesTratar): boolean {
    if (e.defaultPrevented || e.isComposing) return false

    const emCampo = emCampoDeTexto(e.target)
    const semMods = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
    if (semMods && (e.key === 'Enter' || e.key === ' ') && emControleAtivavel(e.target)) {
      return false
    }

    for (const atalho of lista()) {
      const teclaEfetiva = opcoes.remapeados?.[atalho.id] || atalho.tecla
      if (!teclaEfetiva) continue

      const combo = lerCombo(teclaEfetiva)
      const temModOuAlt = combo.mod || combo.ctrl || combo.alt
      if (emCampo && !temModOuAlt) continue
      if (!opcoes.teclasUnicas && ehTeclaUnica(atalho, teclaEfetiva)) continue
      if (!combina(e, teclaEfetiva)) continue

      e.preventDefault()
      atalho.executar()
      return true
    }

    return false
  }

  function assinar(fn: () => void): () => void {
    assinantes.add(fn)
    return () => {
      assinantes.delete(fn)
    }
  }

  return { registrar, lista, tratar, assinar }
}

type CtxAtalhos = {
  registro: ReturnType<typeof criarRegistro>
  aberta: boolean
  abrir: () => void
  fechar: () => void
  alternar: () => void
}

const AtalhosCtx = createContext<CtxAtalhos | null>(null)

/** Retorna o controle da Paleta de comandos para botões externos (ex.: `<GatilhoPaleta>` no Shell). */
export function usePaleta() {
  const ctx = useContext(AtalhosCtx)
  if (!ctx) throw new Error('usePaleta precisa estar dentro de <ProvedorAtalhos>')
  return {
    aberta: ctx.aberta,
    abrir: ctx.abrir,
    fechar: ctx.fechar,
    alternar: ctx.alternar,
  }
}

/** Registra um conjunto de atalhos enquanto o componente estiver montado; o último montado vence conflitos. */
export function useAtalhos(atalhos: Atalho[]): void {
  const ctx = useContext(AtalhosCtx)
  if (!ctx) throw new Error('useAtalhos precisa estar dentro de <ProvedorAtalhos>')

  const ref = useRef(atalhos)
  ref.current = atalhos

  const assinatura = atalhos
    .map((a) => `${a.id}:${a.titulo}:${a.grupo}:${a.tecla ?? ''}:${a.teclaUnica ?? ''}`)
    .join('|')

  useEffect(() => {
    const proxies: Atalho[] = ref.current.map((a, idx) => ({
      id: a.id,
      titulo: a.titulo,
      grupo: a.grupo,
      tecla: a.tecla,
      teclaUnica: a.teclaUnica,
      executar: () => ref.current[idx]?.executar(),
    }))
    return ctx.registro.registrar(proxies)
  }, [ctx.registro, assinatura])
}

/** Provedor global de atalhos (único listener `keydown` em `window`) integrado à `<Paleta>` em `Mod+K`. */
export function ProvedorAtalhos({ children }: { children: ReactNode }) {
  const [preferencias] = usePreferencias()
  const [aberta, setAberta] = useState(false)

  const abertaRef = useRef(aberta)
  abertaRef.current = aberta

  const prefsRef = useRef(preferencias)
  prefsRef.current = preferencias

  const alternar = useCallback(() => setAberta((v) => !v), [])
  const abrir = useCallback(() => setAberta(true), [])
  const fechar = useCallback(() => setAberta(false), [])

  const [registro] = useState(() => {
    const r = criarRegistro()
    r.registrar([
      {
        id: 'paleta.abrir',
        titulo: 'Abrir paleta de comandos',
        grupo: 'App',
        tecla: 'Mod+K',
        executar: () => setAberta((v) => !v),
      },
    ])
    return r
  })

  const atalhosRegistrados = useSyncExternalStore(registro.assinar, registro.lista, registro.lista)

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (abertaRef.current) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
          e.preventDefault()
          setAberta(false)
        }
        return
      }

      registro.tratar(e, {
        teclasUnicas: prefsRef.current.teclasUnicas,
        remapeados: prefsRef.current.atalhos,
      })
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [registro])

  const comandosPaleta: Comando[] = useMemo(() => {
    return atalhosRegistrados
      .filter((a) => a.id !== 'paleta.abrir')
      .map((a) => {
        const teclaEfetiva = preferencias.atalhos[a.id] || a.tecla
        return {
          id: a.id,
          rotulo: a.titulo,
          grupo: a.grupo,
          atalho: teclaEfetiva ? formatarTecla(teclaEfetiva) : undefined,
          aoExecutar: a.executar,
        }
      })
  }, [atalhosRegistrados, preferencias.atalhos])

  const valor = useMemo<CtxAtalhos>(
    () => ({ registro, aberta, abrir, fechar, alternar }),
    [registro, aberta, abrir, fechar, alternar],
  )

  return (
    <AtalhosCtx.Provider value={valor}>
      {children}
      <Paleta aberto={aberta} aoMudarAberto={setAberta} comandos={comandosPaleta} />
    </AtalhosCtx.Provider>
  )
}
