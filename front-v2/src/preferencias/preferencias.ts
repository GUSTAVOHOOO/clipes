import { useSyncExternalStore } from 'react'

export type ModoTeclasUnicas = 'ativas' | 'alt' | 'desligadas'

export type Preferencias = {
  tema: 'escuro' | 'claro' | 'sistema'
  escala: 100 | 115
  altoContraste: boolean
  idioma: 'pt' | 'en'
  teclasUnicas: boolean
  modoTeclasUnicas: ModoTeclasUnicas
  paineisSoPorClique: boolean
  atalhos: Record<string, string>
}

export const CHAVE_PREFERENCIAS = 'clipes.preferencias.v1'

export const PADRAO: Preferencias = {
  tema: 'escuro',
  escala: 100,
  altoContraste: false,
  idioma: 'pt',
  teclasUnicas: true,
  modoTeclasUnicas: 'ativas',
  paineisSoPorClique: true,
  atalhos: {},
}

export type Armazenamento = Pick<Storage, 'getItem' | 'setItem'>

function storagePadrao(): Armazenamento | undefined {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined
  } catch {
    return undefined
  }
}

function sanitizarAtalhos(valor: unknown): Record<string, string> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(valor)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function ehModoTeclasUnicas(valor: unknown): valor is ModoTeclasUnicas {
  return valor === 'ativas' || valor === 'alt' || valor === 'desligadas'
}

function sanitizar(bruto: unknown): Preferencias {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { ...PADRAO, atalhos: {} }
  }
  const obj = bruto as Record<string, unknown>
  const modoTeclasUnicas: ModoTeclasUnicas = ehModoTeclasUnicas(obj.modoTeclasUnicas)
    ? obj.modoTeclasUnicas
    : obj.teclasUnicas === false
      ? 'desligadas'
      : PADRAO.modoTeclasUnicas

  const teclasUnicas =
    typeof obj.teclasUnicas === 'boolean' && !ehModoTeclasUnicas(obj.modoTeclasUnicas)
      ? obj.teclasUnicas
      : modoTeclasUnicas !== 'desligadas'

  return {
    tema: obj.tema === 'escuro' || obj.tema === 'claro' || obj.tema === 'sistema' ? obj.tema : PADRAO.tema,
    escala: obj.escala === 100 || obj.escala === 115 ? obj.escala : PADRAO.escala,
    altoContraste: typeof obj.altoContraste === 'boolean' ? obj.altoContraste : PADRAO.altoContraste,
    idioma: obj.idioma === 'pt' || obj.idioma === 'en' ? obj.idioma : PADRAO.idioma,
    teclasUnicas,
    modoTeclasUnicas,
    paineisSoPorClique:
      typeof obj.paineisSoPorClique === 'boolean' ? obj.paineisSoPorClique : PADRAO.paineisSoPorClique,
    atalhos: sanitizarAtalhos(obj.atalhos),
  }
}

function parsear(texto: string | null): Preferencias {
  if (!texto) return { ...PADRAO, atalhos: {} }
  try {
    return sanitizar(JSON.parse(texto))
  } catch {
    return { ...PADRAO, atalhos: {} }
  }
}

/** Cria um store local de preferências com fallback seguro para `PADRAO` quando o `Storage` falha ou contém dados inválidos. */
export function criarPreferencias(armazenamento?: Armazenamento) {
  const obterStorage = () => armazenamento ?? storagePadrao()
  const assinantes = new Set<() => void>()

  let inicializado = false
  let ultimoBruto: string | null | undefined
  let atual: Preferencias = { ...PADRAO, atalhos: {} }

  function ler(): Preferencias {
    try {
      const bruto = obterStorage()?.getItem(CHAVE_PREFERENCIAS) ?? null
      if (!inicializado || bruto !== ultimoBruto) {
        ultimoBruto = bruto
        atual = parsear(bruto)
        inicializado = true
      }
    } catch {
      if (!inicializado) {
        atual = { ...PADRAO, atalhos: {} }
        inicializado = true
      }
    }
    return atual
  }

  function mudar(parcial: Partial<Preferencias>): void {
    const corrente = ler()
    const mesclado: Partial<Preferencias> = {
      ...corrente,
      ...parcial,
      atalhos: parcial.atalhos !== undefined ? parcial.atalhos : corrente.atalhos,
    }
    if (parcial.modoTeclasUnicas !== undefined && parcial.teclasUnicas === undefined) {
      mesclado.teclasUnicas = parcial.modoTeclasUnicas !== 'desligadas'
    } else if (parcial.teclasUnicas !== undefined && parcial.modoTeclasUnicas === undefined) {
      mesclado.modoTeclasUnicas = parcial.teclasUnicas
        ? corrente.modoTeclasUnicas === 'alt'
          ? 'alt'
          : 'ativas'
        : 'desligadas'
    }

    const proximo = sanitizar(mesclado)
    atual = proximo
    inicializado = true
    const serializado = JSON.stringify(proximo)
    try {
      obterStorage()?.setItem(CHAVE_PREFERENCIAS, serializado)
      ultimoBruto = serializado
    } catch {
      // Mantém a alteração em memória quando o armazenamento está indisponível.
    }
    for (const fn of assinantes) fn()
  }

  function assinar(fn: () => void): () => void {
    assinantes.add(fn)
    return () => {
      assinantes.delete(fn)
    }
  }

  return { ler, mudar, assinar }
}

const storeGlobal = criarPreferencias()

/** Hook React sobre o store global de preferências em `localStorage`. */
export function usePreferencias(): [Preferencias, (p: Partial<Preferencias>) => void] {
  const prefs = useSyncExternalStore(storeGlobal.assinar, storeGlobal.ler, () => PADRAO)
  return [prefs, storeGlobal.mudar]
}
