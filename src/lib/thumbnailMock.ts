// Capa simulada (#74, Pacote E).
// Indexado por candidate; remove portões obrigatórios ?thumbnail-paid/?thumbnail-offline,
// preservando compatibilidade V1 quando essas flags forem passadas explicitamente.
const hasFlag = (name: string) => {
  if (typeof location === 'undefined') return false
  if (new URLSearchParams(location.search).has(name)) return true
  const hash = location.hash ?? ''
  const qIdx = hash.indexOf('?')
  return qIdx >= 0 && new URLSearchParams(hash.slice(qIdx + 1)).has(name)
}

type Choice = {
  id: number
  instantUs: number
  origin: 'provider' | 'user'
  suggestionId: number | null
  createdAt: string
}

type Suggestion = {
  id: number
  jobId: number
  sentenceId: number
  instantUs: number
  why: string
  taskVersion: number
  promptSha256: string
  profile: string
  createdAt: string
}

export type ThumbnailMockHost = {
  getCandidateInfo?: (candidate: number) => {
    source: number
    cut: { startUs: number; endUs: number }
    sourceStatus: 'available' | 'offline' | 'changed'
  } | null
  isFfmpegInstalled?: () => boolean
  isSourceTest?: () => boolean
  resolveRoute?: () => {
    profile: string
    local: boolean
    cli: boolean
    paid: boolean
    blockedLocalOnly: boolean
    estimate: { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null }
  }
  emitProgress?: (evento: {
    job: string
    project?: string | null
    stage: string
    percentage: number
    message: string
    error: { code: string; message: string } | null
  }) => void
  projectId?: () => string | null
}

type CandidateThumbState = {
  suggestions: Suggestion[]
  choices: Choice[]
  pendingPolls: number
  activeJobId: number | null
  timer: ReturnType<typeof setTimeout> | null
  lastProfile: string
}

const DEFAULT_CUT = { startUs: 60_000_000, endUs: 120_000_000 }
const statesByCandidate = new Map<number, CandidateThumbState>()
const exportedOutputs = new Set<string>()
let nextThumbJobSeq = 400

function getState(candidate: number): CandidateThumbState {
  let st = statesByCandidate.get(candidate)
  if (!st) {
    st = {
      suggestions: [],
      choices: [],
      pendingPolls: 0,
      activeJobId: null,
      timer: null,
      lastProfile: 'legacy',
    }
    statesByCandidate.set(candidate, st)
  }
  return st
}

export function resetThumbnailMockState(): void {
  for (const st of statesByCandidate.values()) {
    if (st.timer) clearTimeout(st.timer)
  }
  statesByCandidate.clear()
  exportedOutputs.clear()
  nextThumbJobSeq = 400
}

export function seedThumbnailMockCandidate(
  candidate: number,
  seed: { instantUs: number; origin?: 'provider' | 'user'; why?: string },
): void {
  const st = getState(candidate)
  const suggId = seed.origin === 'provider' ? 1 : null
  if (seed.origin === 'provider') {
    st.suggestions = [
      {
        id: 1,
        jobId: 1,
        sentenceId: 11,
        instantUs: seed.instantUs,
        why: seed.why ?? 'Expressão marcante do trecho.',
        taskVersion: 1,
        promptSha256: 'a'.repeat(64),
        profile: 'legacy',
        createdAt: '2026-11-15T12:00:00Z',
      },
    ]
  }
  st.choices = [
    {
      id: 1,
      instantUs: seed.instantUs,
      origin: seed.origin ?? 'user',
      suggestionId: suggId,
      createdAt: '2026-11-15T12:00:00Z',
    },
  ]
}

export function cancelThumbnailMockJob(jobId: number, host?: ThumbnailMockHost): boolean {
  const project = host?.projectId?.() ?? null
  for (const st of statesByCandidate.values()) {
    if (st.activeJobId === jobId && st.pendingPolls > 0) {
      if (st.timer) clearTimeout(st.timer)
      st.timer = null
      st.pendingPolls = 0
      st.activeJobId = null
      host?.emitProgress?.({
        job: String(jobId),
        project,
        stage: 'ai:thumbnail:done',
        percentage: 0,
        message: 'Sugestão de capa cancelada.',
        error: { code: 'cancelled', message: 'Cancelado.' },
      })
      return true
    }
  }
  return false
}

function getCandidateContext(candidate: number, host?: ThumbnailMockHost) {
  const info = host?.getCandidateInfo?.(candidate)
  return {
    source: info?.source ?? 1,
    cut: info?.cut ?? DEFAULT_CUT,
    sourceStatus: info?.sourceStatus ?? ('available' as const),
  }
}

function view(candidate: number, st: CandidateThumbState, host?: ThumbnailMockHost) {
  const ctx = getCandidateContext(candidate, host)
  const last = st.choices[st.choices.length - 1] ?? null
  const why = last?.suggestionId
    ? st.suggestions.find((s) => s.id === last.suggestionId)?.why ?? null
    : null
  const lastJobId = st.activeJobId ?? (st.suggestions.length > 0 ? st.suggestions[st.suggestions.length - 1].jobId : null)
  return {
    schemaVersion: 1,
    candidate: { run: 1, startId: 1, endId: 2 },
    source: ctx.source,
    cut: ctx.cut,
    current: last ? { ...last, why } : null,
    job:
      st.pendingPolls > 0
        ? { id: lastJobId ?? 1, state: 'running', code: null, violations: [] }
        : lastJobId !== null
          ? { id: lastJobId, state: 'completed', code: null, violations: [] }
          : null,
    suggestions: st.suggestions,
    choices: st.choices,
    maxWhyChars: 200,
  }
}

function finalizeSuggestion(candidate: number, st: CandidateThumbState, host?: ThumbnailMockHost) {
  if (st.timer) {
    clearTimeout(st.timer)
    st.timer = null
  }
  if (st.pendingPolls === 0) return
  st.pendingPolls = 0
  const ctx = getCandidateContext(candidate, host)
  const id = st.suggestions.length + 1
  const jobId = st.activeJobId ?? id
  const span = Math.max(1_000_000, ctx.cut.endUs - ctx.cut.startUs)
  const offset = Math.min(span - 1_000_000, 5_000_000 * id)
  const instantUs = ctx.cut.startUs + Math.max(0, offset)
  st.suggestions.push({
    id,
    jobId,
    sentenceId: 10 + id,
    instantUs,
    why: 'O momento de maior impacto do Corte.',
    taskVersion: 1,
    promptSha256: 'a'.repeat(64),
    profile: st.lastProfile,
    createdAt: '2026-11-15T12:00:00Z',
  })
  st.choices.push({
    id: st.choices.length + 1,
    instantUs,
    origin: 'provider',
    suggestionId: id,
    createdAt: '2026-11-15T12:00:00Z',
  })
  const project = host?.projectId?.() ?? null
  host?.emitProgress?.({
    job: String(jobId),
    project,
    stage: 'ai:thumbnail:verify',
    percentage: 80,
    message: 'Validando instante sugerido para capa…',
    error: null,
  })
  host?.emitProgress?.({
    job: String(jobId),
    project,
    stage: 'ai:thumbnail:done',
    percentage: 100,
    message: 'Sugestão de capa pronta.',
    error: null,
  })
}

function resolveRouteInfo(host?: ThumbnailMockHost) {
  const paidFlag = hasFlag('thumbnail-paid')
  if (host?.resolveRoute) {
    const r = host.resolveRoute()
    if (r.blockedLocalOnly) {
      throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' }
    }
    const paid = paidFlag || r.paid
    const estimate = paidFlag && r.estimate.kind === 'zero'
      ? { kind: 'usd', minMicroUsd: 100, maxMicroUsd: 300 }
      : r.estimate
    return { paid, profile: r.profile, estimate }
  }
  return {
    paid: paidFlag,
    profile: 'legacy',
    estimate: paidFlag ? { kind: 'usd', minMicroUsd: 100, maxMicroUsd: 300 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 },
  }
}

/** `undefined` quando o comando não é da capa. */
export function thumbnailMockDispatch(name: string, args: object, host?: ThumbnailMockHost): unknown {
  if (!name.startsWith('thumbnail.')) return undefined

  const a = args as { candidate?: number; confirmed?: boolean; instant_us?: number; output?: string }
  const candidate = a.candidate ?? 1
  const st = getState(candidate)

  if (name === 'thumbnail.estimate') {
    const route = resolveRouteInfo(host)
    return {
      paid: route.paid,
      profile: route.profile,
      estimate: route.estimate,
    }
  }

  if (name === 'thumbnail.suggest') {
    const route = resolveRouteInfo(host)
    if (route.paid && !a.confirmed) {
      throw { code: 'confirmation_required', message: 'confirmação obrigatória', usage: { estimate: route.estimate } }
    }
    if (st.pendingPolls > 0) {
      throw { code: 'suggestion_in_progress', message: 'Já há uma sugestão de capa em andamento para este Corte.' }
    }
    st.lastProfile = route.profile
    st.pendingPolls = 2
    const jobId = nextThumbJobSeq++
    st.activeJobId = jobId
    const project = host?.projectId?.() ?? null
    host?.emitProgress?.({
      job: String(jobId),
      project,
      stage: 'ai:thumbnail:prepare',
      percentage: 0,
      message: 'Preparando sugestão de capa…',
      error: null,
    })
    host?.emitProgress?.({
      job: String(jobId),
      project,
      stage: 'ai:thumbnail:call',
      percentage: 10,
      message: 'Consultando Provedor para momento da capa…',
      error: null,
    })
    st.timer = setTimeout(() => finalizeSuggestion(candidate, st, host), 20)
    return { job: jobId }
  }

  if (name === 'thumbnail.get') {
    if (st.pendingPolls > 0 && --st.pendingPolls === 0) {
      finalizeSuggestion(candidate, st, host)
    }
    return view(candidate, st, host)
  }

  if (name === 'thumbnail.choose') {
    const ctx = getCandidateContext(candidate, host)
    const us = a.instant_us ?? -1
    if (typeof a.instant_us !== 'number' || !Number.isFinite(us) || us < ctx.cut.startUs || us > ctx.cut.endUs) {
      throw { code: 'instant_out_of_cut', message: 'O instante da capa precisa estar dentro do Corte.' }
    }
    if (st.choices[st.choices.length - 1]?.instantUs !== us) {
      st.choices.push({
        id: st.choices.length + 1,
        instantUs: us,
        origin: 'user',
        suggestionId: null,
        createdAt: '2026-11-15T12:01:00Z',
      })
    }
    return view(candidate, st, host)
  }

  if (name === 'thumbnail.export') {
    const ctx = getCandidateContext(candidate, host)
    const output = typeof a.output === 'string' ? a.output.trim() : ''
    const isAbs = /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(output)
    if (!output || !isAbs || !/\.png$/i.test(output)) {
      throw { code: 'thumbnail_destination', message: 'Escolha uma pasta existente e um nome PNG válido.' }
    }
    if (exportedOutputs.has(output) || output.toLowerCase().includes('existente')) {
      throw { code: 'thumbnail_exists', message: 'Já existe um arquivo no destino. Escolha outro nome.' }
    }
    const instantUs =
      typeof a.instant_us === 'number'
        ? a.instant_us
        : st.choices[st.choices.length - 1]?.instantUs
    if (instantUs === undefined) {
      throw { code: 'no_instant', message: 'Escolha um instante para a capa antes de exportar.' }
    }
    if (instantUs < ctx.cut.startUs || instantUs > ctx.cut.endUs) {
      throw { code: 'instant_out_of_cut', message: 'O instante da capa precisa estar dentro do Corte.' }
    }
    if (hasFlag('thumbnail-offline') || ctx.sourceStatus === 'offline') {
      throw { code: 'source_offline', message: 'A Fonte está offline: relocalize antes de exportar a capa.' }
    }
    if (ctx.sourceStatus === 'changed') {
      throw { code: 'source_changed', message: 'A Fonte foi alterada no disco: verifique a identidade antes de exportar.' }
    }
    if (host?.isFfmpegInstalled && !host.isFfmpegInstalled() && !host?.isSourceTest?.()) {
      throw { code: 'component_missing', message: 'Instale o Componente FFmpeg.' }
    }
    exportedOutputs.add(output)
    return { output, instantUs }
  }

  return undefined
}
