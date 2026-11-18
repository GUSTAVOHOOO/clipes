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
import { usePreferencias, type ModoTeclasUnicas } from '~/preferencias/preferencias'

export type Atalho = {
  id: string
  titulo: string
  grupo: string
  tecla?: string
  teclaUnica?: boolean
  executar(): void
}

export type DefinicaoAtalho = {
  id: string
  escopo: string
  titulo: string
  tecla: string
  teclaUnica?: boolean
  observacao?: string
}

export type OpcoesTratar = {
  teclasUnicas?: boolean
  modoTeclasUnicas?: ModoTeclasUnicas
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
  espaco: ' ',
  esc: 'escape',
  del: 'delete',
}

const SIMBOLO_COM_SHIFT = new Set(['?', '{', '}', '+', '_', ':', '"', '<', '>', '|', '~', '!'])

/** Mapa completo de atalhos oficiais da arquitetura (§8) para exibição, busca e remapeamento. */
export const MAPA_ATALHOS_OFICIAL: readonly DefinicaoAtalho[] = [
  { id: 'paleta.abrir', escopo: 'Global', titulo: 'Abrir paleta de comandos', tecla: 'Mod+K' },
  { id: 'shell.regioes', escopo: 'Global', titulo: 'Ciclar entre regiões macro da janela', tecla: 'F6' },
  { id: 'navegar.config', escopo: 'Global', titulo: 'Abrir Configurações', tecla: 'Mod+,' },
  { id: 'fila.alternar', escopo: 'Global', titulo: 'Abrir/fechar Fila de Jobs', tecla: 'Mod+J' },
  { id: 'busca.focar', escopo: 'Global', titulo: 'Buscar na Transcrição ou tela atual', tecla: 'Mod+F' },
  {
    id: 'atalhos.ajuda',
    escopo: 'Global',
    titulo: 'Folha de ajuda rápida de atalhos',
    tecla: '?',
    teclaUnica: true,
    observacao: 'Alternativa sempre ativa: Ctrl/Cmd+/',
  },
  { id: 'editor.transcricao.alternar', escopo: 'Global', titulo: 'Recolher/expandir Transcrição à esquerda', tecla: 'Mod+[' },
  { id: 'editor.popover.alternar', escopo: 'Global', titulo: 'Abrir/fechar último popover da barra de ações', tecla: 'Mod+]' },
  { id: 'transporte.reproduzir', escopo: 'Transporte', titulo: 'Reproduzir / Pausar', tecla: 'Espaço', teclaUnica: true },
  { id: 'transporte.rebobinar', escopo: 'Transporte', titulo: 'Rebobinar (1×, 2×, 4×)', tecla: 'J', teclaUnica: true },
  { id: 'transporte.pausar', escopo: 'Transporte', titulo: 'Pausar transporte', tecla: 'K', teclaUnica: true },
  { id: 'transporte.avancar', escopo: 'Transporte', titulo: 'Avançar (1×, 2×, 4×)', tecla: 'L', teclaUnica: true },
  { id: 'transporte.quadroAnterior', escopo: 'Transporte', titulo: 'Voltar 1 quadro ou palavra', tecla: 'ArrowLeft' },
  { id: 'transporte.quadroProximo', escopo: 'Transporte', titulo: 'Avançar 1 quadro ou palavra', tecla: 'ArrowRight' },
  { id: 'revisao.aprovar', escopo: 'Revisão de Cortes', titulo: 'Aprovar candidato', tecla: 'A', teclaUnica: true },
  { id: 'revisao.rejeitar', escopo: 'Revisão de Cortes', titulo: 'Rejeitar candidato', tecla: 'R', teclaUnica: true },
  { id: 'revisao.bordaInicio', escopo: 'Revisão de Cortes', titulo: 'Recuar borda inicial em 1 Frase', tecla: 'I', teclaUnica: true },
  { id: 'revisao.bordaFim', escopo: 'Revisão de Cortes', titulo: 'Avançar borda final em 1 Frase', tecla: 'O', teclaUnica: true },
  { id: 'revisao.abrirEditor', escopo: 'Revisão de Cortes', titulo: 'Abrir Corte selecionado no Editor', tecla: 'Enter' },
  { id: 'revisao.desfazer', escopo: 'Revisão de Cortes', titulo: 'Desfazer última decisão/ajuste', tecla: 'Mod+Z' },
  { id: 'editor.entrada', escopo: 'Editor do Corte', titulo: 'Mover borda Entrada para a agulha', tecla: 'I', teclaUnica: true },
  { id: 'editor.saida', escopo: 'Editor do Corte', titulo: 'Mover borda Saída para a agulha', tecla: 'O', teclaUnica: true },
  { id: 'editor.zoomMais', escopo: 'Editor do Corte', titulo: 'Aumentar zoom da timeline', tecla: '+', teclaUnica: true },
  { id: 'editor.zoomMenos', escopo: 'Editor do Corte', titulo: 'Diminuir zoom da timeline', tecla: '-', teclaUnica: true },
  { id: 'editor.desfazer', escopo: 'Editor do Corte', titulo: 'Desfazer edição do Corte', tecla: 'Mod+Z' },
  { id: 'editor.refazer', escopo: 'Editor do Corte', titulo: 'Refazer edição do Corte', tecla: 'Mod+Shift+Z' },
  { id: 'corte.anterior', escopo: 'Tela do Corte', titulo: 'Corte aprovado anterior', tecla: 'Alt+PageUp' },
  { id: 'corte.proximo', escopo: 'Tela do Corte', titulo: 'Próximo Corte aprovado', tecla: 'Alt+PageDown' },
  { id: 'corte.salvar', escopo: 'Tela do Corte', titulo: 'Salvar alterações da sub-aba ativa', tecla: 'Mod+S' },
  { id: 'corte.exportar', escopo: 'Tela do Corte', titulo: 'Exportar Corte atual', tecla: 'Mod+E' },
  { id: 'transcricao.corrigir', escopo: 'Transcrição', titulo: 'Corrigir grafia da palavra focada', tecla: 'F2' },
  { id: 'transcricao.desfazer', escopo: 'Transcrição', titulo: 'Desfazer correção de Transcrição', tecla: 'Mod+Z' },
]

function lerCombo(tecla: string): Combo {
  if (tecla === '+') {
    return { mod: false, ctrl: false, alt: false, shift: false, tecla: '+' }
  }
  const terminaMais = tecla.endsWith('++')
  const terminaEspaco = tecla.endsWith('+ ')
  const bruto = terminaMais ? tecla.slice(0, -2) : terminaEspaco ? tecla.slice(0, -2) : tecla
  const partes = bruto.split('+').map((p) => p.trim()).filter(Boolean)
  const principal = (terminaMais ? '+' : terminaEspaco ? ' ' : partes.pop() ?? '').toLowerCase()
  const mods = new Set(partes.map((p) => p.toLowerCase()))

  return {
    mod: mods.has('mod') || mods.has('cmd'),
    ctrl: mods.has('ctrl'),
    alt: mods.has('alt'),
    shift: mods.has('shift'),
    tecla: ALIAS[principal] ?? principal,
  }
}

export function ehTeclaUnica(atalho: Pick<Atalho, 'teclaUnica'>, teclaEfetiva: string): boolean {
  if (atalho.teclaUnica === true) return true
  if (atalho.teclaUnica === false) return false
  const combo = lerCombo(teclaEfetiva)
  return !combo.mod && !combo.ctrl && !combo.alt && combo.tecla.length === 1
}

function aplicarModo(tecla: string, modo: ModoTeclasUnicas, teclaUnicaProp?: boolean): string | undefined {
  if (!tecla) return undefined
  if (!ehTeclaUnica({ teclaUnica: teclaUnicaProp }, tecla)) return tecla
  if (modo === 'desligadas') return undefined
  if (modo === 'alt') {
    const combo = lerCombo(tecla)
    if (combo.alt) return tecla
    return combo.tecla === ' ' ? 'Alt+Espaço' : `Alt+${tecla}`
  }
  return tecla
}

/** Resolve a tecla efetiva a ser exibida em `<Kbd>` / Paleta segundo o modo WCAG 2.1.4. */
export function resolverTeclaExibida(
  tecla: string | undefined,
  modo: ModoTeclasUnicas,
  teclaUnicaProp?: boolean,
): string | undefined {
  if (!tecla) return undefined
  return aplicarModo(tecla, modo, teclaUnicaProp)
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

const ROTULO_TECLA: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  ' ': 'Espaço',
  space: 'Espaço',
}

/** Formata combinação de atalho para exibição acessível em `<Kbd>`. */
export function formatarTecla(tecla: string): string {
  const ehMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
  const substituido = tecla.replace(/\bMod\b/gi, ehMac ? '⌘' : 'Ctrl')
  const partes = substituido.split('+')
  if (partes.length === 1) {
    const chave = partes[0].toLowerCase()
    return ROTULO_TECLA[chave] ?? (partes[0].length === 1 ? partes[0].toUpperCase() : partes[0])
  }
  return partes
    .map((p) => {
      const chave = p.toLowerCase()
      if (ROTULO_TECLA[chave]) return ROTULO_TECLA[chave]
      return p.length === 1 ? p.toUpperCase() : p
    })
    .join('+')
}

function normalizarCombo(tecla: string): string {
  const c = lerCombo(tecla)
  const mods: string[] = []
  if (c.mod || c.ctrl) mods.push('mod')
  if (c.alt) mods.push('alt')
  if (c.shift && !SIMBOLO_COM_SHIFT.has(c.tecla)) mods.push('shift')
  mods.push(c.tecla === ' ' ? 'space' : c.tecla)
  return mods.join('+')
}

const TECLAS_MODIFICADORAS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS'])
const COMBOS_RESERVADOS_SO = new Set(['alt+f4', 'mod+w', 'mod+q', 'escape', 'tab'])

/** Verifica se a combinação é reservada pelo SO ou navegação básica. */
export function ehAtalhoReservado(tecla: string): boolean {
  return COMBOS_RESERVADOS_SO.has(normalizarCombo(tecla))
}

/** Converte um `KeyboardEvent` de captura em string de atalho canônica; retorna `null` para tecla modificadora isolada. */
export function formatarEventoTeclado(e: KeyboardEvent): string | null {
  if (TECLAS_MODIFICADORAS.has(e.key)) return null

  const partes: string[] = []
  if (e.ctrlKey || e.metaKey) partes.push('Mod')
  if (e.altKey) partes.push('Alt')
  if (e.shiftKey && !SIMBOLO_COM_SHIFT.has(e.key)) partes.push('Shift')

  let principal = e.key
  if (principal === ' ') principal = 'Espaço'
  else if (principal.length === 1) principal = principal.toUpperCase()

  partes.push(principal)
  return partes.join('+')
}

function escoposConflitam(a: string, b: string): boolean {
  if (a === b) return true
  if (a === 'Global' || b === 'Global') return true
  const ehEdicaoOuRevisao = (s: string) => s === 'Revisão de Cortes' || s === 'Editor do Corte'
  if (a === 'Transporte' && ehEdicaoOuRevisao(b)) return true
  if (b === 'Transporte' && ehEdicaoOuRevisao(a)) return true
  return false
}

/** Detecta conflito com outro atalho no mesmo escopo, escopo Global ou Transporte compartilhado. */
export function detectarConflitoAtalho(
  idAlvo: string,
  novaTecla: string,
  catalogo: readonly DefinicaoAtalho[],
  remapeados: Record<string, string>,
): DefinicaoAtalho | null {
  const alvo = catalogo.find((item) => item.id === idAlvo)
  if (!alvo) return null
  const comboNovo = normalizarCombo(novaTecla)
  if (!comboNovo) return null

  for (const item of catalogo) {
    if (item.id === idAlvo) continue
    if (!escoposConflitam(alvo.escopo, item.escopo)) continue
    const teclaItem = remapeados[item.id] !== undefined ? remapeados[item.id] : item.tecla
    if (!teclaItem) continue
    if (normalizarCombo(teclaItem) === comboNovo) {
      return item
    }
  }
  return null
}

/** Aplica um remapeamento limpando eventual atalho conflitante substituído. */
export function substituirAtalho(
  remapeados: Record<string, string>,
  idAlvo: string,
  novaTecla: string,
  idConflito?: string | null,
): Record<string, string> {
  const proximo = { ...remapeados, [idAlvo]: novaTecla }
  if (idConflito && idConflito !== idAlvo) {
    proximo[idConflito] = ''
  }
  return proximo
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

    const modo: ModoTeclasUnicas =
      opcoes.modoTeclasUnicas ?? (opcoes.teclasUnicas === false ? 'desligadas' : 'ativas')

    for (const atalho of lista()) {
      const teclaBase =
        opcoes.remapeados && Object.hasOwn(opcoes.remapeados, atalho.id)
          ? opcoes.remapeados[atalho.id]
          : atalho.tecla
      if (!teclaBase) continue

      const teclaEfetiva = aplicarModo(teclaBase, modo, atalho.teclaUnica)
      if (!teclaEfetiva) continue

      const combo = lerCombo(teclaEfetiva)
      const temModOuAlt = combo.mod || combo.ctrl || combo.alt
      if (emCampo && !temModOuAlt) continue
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
        modoTeclasUnicas: prefsRef.current.modoTeclasUnicas,
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
        const teclaBase = Object.hasOwn(preferencias.atalhos, a.id)
          ? preferencias.atalhos[a.id]
          : a.tecla
        const teclaEfetiva = resolverTeclaExibida(teclaBase, preferencias.modoTeclasUnicas, a.teclaUnica)
        return {
          id: a.id,
          rotulo: a.titulo,
          grupo: a.grupo,
          atalho: teclaEfetiva ? formatarTecla(teclaEfetiva) : undefined,
          aoExecutar: a.executar,
        }
      })
  }, [atalhosRegistrados, preferencias.atalhos, preferencias.modoTeclasUnicas])

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
