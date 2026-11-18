export type SecaoConfig =
  | 'provedores'
  | 'custos'
  | 'componentes'
  | 'exportacao'
  | 'aparencia'
  | 'projeto'

export type Rota =
  | { tela: 'inicio' }
  | { tela: 'assistente'; passo: 1 | 2; retorno?: 'config' }
  | { tela: 'fontes'; projeto: string; sub: 'fontes' | 'lotes' }
  | { tela: 'fonte'; projeto: string; fonte: string; frase?: number; row?: number }
  | { tela: 'cortes'; projeto: string; fonte?: string; run?: string; rev?: number }
  | { tela: 'revisao'; projeto: string; run: string; rev?: number; corte?: string }
  | { tela: 'corte'; projeto: string; corte: string; aba: 'editar' | 'transformar' | 'empacotar'; run?: string }
  | { tela: 'exportacao'; projeto: string; sub: 'prontidao' | 'lotes' }
  | { tela: 'config'; secao: SecaoConfig }
  | { tela: 'relatos' }
  | { tela: 'sobre' }

export type Contexto = {
  projetoAberto: string | null
  corteTipo?: (corte: string) => 'direto' | 'transformado' | 'avulso'
}

export type Resolucao = { rota: Rota } | { redirecionar: string; aviso?: string }

const SECOES_CONFIG = new Set<SecaoConfig>([
  'provedores',
  'custos',
  'componentes',
  'exportacao',
  'aparencia',
  'projeto',
])

const ABAS_CORTE = new Set(['editar', 'transformar', 'empacotar'] as const)

function decodificar(segmento: string): string {
  try {
    return decodeURIComponent(segmento)
  } catch {
    return segmento
  }
}

function textoOpcional(valor: string | null): string | undefined {
  return valor ? valor : undefined
}

function numeroOpcional(valor: string | null): number | undefined {
  if (!valor) return undefined
  const n = Number(valor)
  return Number.isFinite(n) ? n : undefined
}

function semIndefinidos<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

function resolverProjeto(partes: string[], query: URLSearchParams, ctx: Contexto): Resolucao {
  if (partes.length < 3) return { redirecionar: '#/inicio' }
  const projeto = decodificar(partes[1])
  const area = partes[2]

  // Nunca abre outro Projeto pela URL; exige correspondência com o Projeto ativo.
  if (!projeto || !ctx.projetoAberto || ctx.projetoAberto !== projeto) {
    return { redirecionar: '#/inicio' }
  }

  const projetoEnc = encodeURIComponent(projeto)

  if (area === 'fontes') {
    if (partes.length === 3) {
      const sub = query.get('sub') === 'lotes' ? 'lotes' : 'fontes'
      return { rota: { tela: 'fontes', projeto, sub } }
    }
    if (partes.length === 4) {
      return {
        rota: semIndefinidos({
          tela: 'fonte',
          projeto,
          fonte: decodificar(partes[3]),
          frase: numeroOpcional(query.get('frase')),
          row: numeroOpcional(query.get('row')),
        }),
      }
    }
    return { redirecionar: `#/projeto/${projetoEnc}/fontes` }
  }

  if (area === 'cortes') {
    if (partes.length === 3) {
      return {
        rota: semIndefinidos({
          tela: 'cortes',
          projeto,
          fonte: textoOpcional(query.get('fonte')),
          run: textoOpcional(query.get('run')),
          rev: numeroOpcional(query.get('rev')),
        }),
      }
    }
    if (partes[3] === 'revisao') {
      if (partes.length === 5) {
        return {
          rota: semIndefinidos({
            tela: 'revisao',
            projeto,
            run: decodificar(partes[4]),
            rev: numeroOpcional(query.get('rev')),
            corte: textoOpcional(query.get('corte')),
          }),
        }
      }
      return { redirecionar: `#/projeto/${projetoEnc}/cortes` }
    }
    return { redirecionar: `#/projeto/${projetoEnc}/cortes` }
  }

  if (area === 'corte' && partes.length >= 4) {
    const corte = decodificar(partes[3])
    const aba = partes[4]
    const run = textoOpcional(query.get('run'))
    const sufixoRun = run ? `?run=${encodeURIComponent(run)}` : ''
    const editarHash = `#/projeto/${projetoEnc}/corte/${encodeURIComponent(corte)}/editar${sufixoRun}`

    if (partes.length !== 5 || !ABAS_CORTE.has(aba as 'editar' | 'transformar' | 'empacotar')) {
      return { redirecionar: editarHash }
    }

    const abaTipada = aba as 'editar' | 'transformar' | 'empacotar'
    const tipo = corte.startsWith('avulso-') ? 'avulso' : ctx.corteTipo?.(corte)

    if (abaTipada === 'transformar' && (tipo === 'direto' || tipo === 'avulso')) {
      return {
        redirecionar: editarHash,
        aviso: 'Transformar está disponível apenas para Vídeo transformado',
      }
    }
    if (abaTipada === 'empacotar' && tipo === 'avulso') {
      return { redirecionar: editarHash }
    }

    return {
      rota: semIndefinidos({
        tela: 'corte',
        projeto,
        corte,
        aba: abaTipada,
        run,
      }),
    }
  }

  if (area === 'exportacao') {
    if (partes.length === 3) {
      const sub = query.get('sub') === 'lotes' ? 'lotes' : 'prontidao'
      return { rota: { tela: 'exportacao', projeto, sub } }
    }
    if (partes.length === 4 && partes[3] === 'lotes') {
      return { redirecionar: `#/projeto/${projetoEnc}/exportacao?sub=lotes` }
    }
    return { redirecionar: `#/projeto/${projetoEnc}/exportacao` }
  }

  return { redirecionar: '#/inicio' }
}

/** Resolve um hash de rota aplicando as guardas de Projeto, tipo de Corte e seção de Configurações. */
export function resolver(hash: string, ctx: Contexto): Resolucao {
  const limpo = hash.replace(/^#/, '')
  if (!limpo || limpo === '/') return { redirecionar: '#/inicio' }

  const [caminho, queryStr = ''] = limpo.split('?')
  const partes = caminho.split('/').filter(Boolean)
  const query = new URLSearchParams(queryStr)

  if (partes.length === 0) return { redirecionar: '#/inicio' }

  const raiz = partes[0]
  if (raiz === 'inicio' && partes.length === 1) {
    return { rota: { tela: 'inicio' } }
  }
  if (raiz === 'assistente' && partes.length === 1) {
    const retorno = query.get('retorno') === 'config' ? ('config' as const) : undefined
    return {
      rota: semIndefinidos({
        tela: 'assistente',
        passo: query.get('passo') === '2' ? 2 : 1,
        retorno,
      }),
    }
  }
  if (raiz === 'relatos' && partes.length === 1) {
    return { rota: { tela: 'relatos' } }
  }
  if (raiz === 'sobre' && partes.length === 1) {
    return { rota: { tela: 'sobre' } }
  }
  if (raiz === 'config') {
    const secao = partes.length === 2 ? partes[1] : ''
    if (!SECOES_CONFIG.has(secao as SecaoConfig)) {
      return { redirecionar: '#/config/provedores' }
    }
    const secaoTipada = secao as SecaoConfig
    if (secaoTipada === 'projeto' && !ctx.projetoAberto) {
      return {
        redirecionar: '#/config/provedores',
        aviso: 'Abra um Projeto para editar estas configurações.',
      }
    }
    return { rota: { tela: 'config', secao: secaoTipada } }
  }
  if (raiz === 'projeto') {
    return resolverProjeto(partes, query, ctx)
  }

  return { redirecionar: '#/inicio' }
}
