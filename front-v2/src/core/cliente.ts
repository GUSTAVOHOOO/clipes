import { coreDispatch } from '@core'

/** Erro normalizado retornado pelo cliente do núcleo. */
export class ErroCore extends Error {
  readonly code: string
  readonly detalhe: string
  /** Dados que o núcleo anexa ao erro (ex.: custo estimado em `confirmation_required`). */
  readonly usage?: unknown

  constructor(code: string, detalhe = '', usage?: unknown) {
    super(detalhe || code)
    this.name = 'ErroCore'
    this.code = code
    this.detalhe = detalhe
    if (usage !== undefined) this.usage = usage
  }
}

/** Normaliza qualquer falha (ErroCore, Error, objeto do núcleo, string ou nulo) em `ErroCore`. */
export function paraErroCore(erro: unknown): ErroCore {
  if (erro instanceof ErroCore) return erro

  if (typeof erro === 'string') {
    return new ErroCore('desconhecido', erro)
  }

  if (erro instanceof Error) {
    const comCodigo = erro as Error & { code?: unknown; usage?: unknown }
    const code =
      typeof comCodigo.code === 'string' && comCodigo.code.trim().length > 0
        ? comCodigo.code.trim()
        : 'desconhecido'
    return new ErroCore(code, erro.message, comCodigo.usage)
  }

  if (erro !== null && typeof erro === 'object') {
    const registro = erro as { code?: unknown; message?: unknown; usage?: unknown }
    const code =
      typeof registro.code === 'string' && registro.code.trim().length > 0
        ? registro.code.trim()
        : 'desconhecido'
    const detalhe = typeof registro.message === 'string' ? registro.message : ''
    return new ErroCore(code, detalhe, registro.usage)
  }

  if (erro === undefined || erro === null) {
    return new ErroCore('desconhecido', '')
  }

  return new ErroCore('desconhecido', String(erro))
}

/** Despacha um comando ao núcleo e normaliza qualquer falha em `ErroCore`. */
export async function chamar<T>(comando: string, args: object = {}): Promise<T> {
  try {
    return await coreDispatch<T>(comando, args)
  } catch (erro) {
    throw paraErroCore(erro)
  }
}
