// Estado de demonstração do app (no app real, o núcleo Rust é o dono dos dados e a UI só exibe e edita).
// Guarda o que precisa sobreviver à troca de tela: Projeto atual, status dos Cortes e edições.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cortes, projetos as projetosIniciais, type Projeto } from '@/data/dados'

export type StatusCorte = 'sugerido' | 'aprovado' | 'rejeitado' | 'exportado'

type Ctx = {
  projeto: Projeto
  projetos: Projeto[]
  criarProjeto: (dados: Pick<Projeto, 'nome' | 'perfil' | 'pasta'>) => void
  setProjeto: (id: string) => void
  status: Record<string, StatusCorte>
  setStatus: (id: string, s: StatusCorte) => void
  /** Edições por Corte. Cada tela guarda o seu pedaço sob uma chave própria: edicoes[corteId][chave]. */
  edicoes: Record<string, Record<string, unknown>>
  setEdicao: <T>(corteId: string, chave: string, valor: T) => void
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [projetos, setProjetos] = useState(projetosIniciais)
  const [pid, setPid] = useState(projetosIniciais[0].id)
  const [statusPorProjeto, setSt] = useState<Record<string, Record<string, StatusCorte>>>({})
  const [edicoesPorProjeto, setEd] = useState<Record<string, Record<string, Record<string, unknown>>>>({})
  // Configuração do app e fila multiprojeto não pertencem a um Corte.
  const [edicoesGlobais, setGlobais] = useState<Record<string, Record<string, unknown>>>({})
  const statusInicial = useMemo<Record<string, StatusCorte>>(
    () => Object.fromEntries(cortes.map((c) => [c.id, c.id === 'c1' ? 'aprovado' : 'sugerido'])),
    [],
  )
  const status = statusPorProjeto[pid] ?? statusInicial
  const edicoes = useMemo(
    () => ({ ...edicoesPorProjeto[pid], ...edicoesGlobais }),
    [pid, edicoesPorProjeto, edicoesGlobais],
  )
  const criarProjeto = useCallback((dados: Pick<Projeto, 'nome' | 'perfil' | 'pasta'>) => {
    const id = crypto.randomUUID()
    setProjetos((ps) => [...ps, { ...dados, id, fontes: 0, cortes: 4 }])
    // As amostras de um Projeto novo precisam de uma revisão própria.
    setSt((m) => ({ ...m, [id]: Object.fromEntries(cortes.map((c) => [c.id, 'sugerido' as const])) }))
    setPid(id)
  }, [])
  const setStatus = useCallback(
    (id: string, s: StatusCorte) => setSt((m) => ({ ...m, [pid]: { ...(m[pid] ?? statusInicial), [id]: s } })),
    [pid, statusInicial],
  )
  const setEdicao = useCallback(
    <T,>(corteId: string, chave: string, valor: T) => {
      if (corteId === 'fontes' || corteId === 'config')
        setGlobais((m) => ({ ...m, [corteId]: { ...m[corteId], [chave]: valor } }))
      else setEd((m) => ({ ...m, [pid]: { ...m[pid], [corteId]: { ...m[pid]?.[corteId], [chave]: valor } } }))
    },
    [pid],
  )
  const valor = useMemo<Ctx>(
    () => ({
      projeto: projetos.find((p) => p.id === pid)!,
      projetos,
      criarProjeto,
      setProjeto: setPid,
      status,
      setStatus,
      edicoes,
      setEdicao,
    }),
    [pid, projetos, criarProjeto, status, setStatus, edicoes, setEdicao],
  )
  return <AppCtx.Provider value={valor}>{children}</AppCtx.Provider>
}

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp precisa do <AppProvider>')
  return c
}

/** Edição de um Corte sob uma chave, com valor padrão. */
export function useEdicao<T>(corteId: string, chave: string, padrao: () => T) {
  const { edicoes, setEdicao } = useApp()
  const valor = (edicoes[corteId]?.[chave] as T | undefined) ?? padrao()
  const mudar = useCallback(
    (p: Partial<T> | ((v: T) => T)) => {
      const novo = typeof p === 'function' ? (p as (v: T) => T)(valor) : { ...valor, ...p }
      setEdicao(corteId, chave, novo)
    },
    [corteId, chave, valor, setEdicao],
  )
  return [valor, mudar] as const
}
