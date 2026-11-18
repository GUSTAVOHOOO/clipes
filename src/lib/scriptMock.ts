// Roteiro simulado (#73, Pacote E).
// Indexado por candidate; suporta ?script-paid / ?script-language para compatibilidade V1 e resolução real de rota no V2.
const hasFlag = (name: string) => {
  if (typeof location === 'undefined') return false
  if (new URLSearchParams(location.search).has(name)) return true
  const hash = location.hash ?? ''
  const qIdx = hash.indexOf('?')
  return qIdx >= 0 && new URLSearchParams(hash.slice(qIdx + 1)).has(name)
}

export type MockAngle = {
  name: string
  promise: string
  audience?: string
  sentence_ids?: number[]
}

export type MockScriptVersion = {
  title: string
  narration: string
  refs: number[]
  edited: boolean
  profile?: string
}

export type MockScriptBlock = {
  id: number
  position: number
  intent: string
  versions: MockScriptVersion[]
  approved: number
  approvedAngleRev: number
  stale: boolean
  busy?: boolean
  jobId?: number | null
}

export type ScriptMockHost = {
  checkTransformed?: (candidate: number) => void
  resolveRoute?: (
    task: 'script',
    profileId?: string,
  ) => {
    profile: string
    local: boolean
    cli: boolean
    paid: boolean
    blockedLocalOnly: boolean
    estimate: { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null; inputTokens?: number }
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

type CandidateScriptState = {
  angle: MockAngle | null
  angleRevision: number
  angles: MockAngle[]
  anglePolls: number
  angleGeneration: number
  angleJobId: number | null
  angleTimer: ReturnType<typeof setTimeout> | null
  blocks: MockScriptBlock[]
  generation: number
  language: string
  detectedLanguage: string | null
  languageRequired: boolean
  pendingPolls: number
  regenBlockId: number | null
  scriptJobId: number | null
  scriptTimer: ReturnType<typeof setTimeout> | null
  profile: string
}

const DEFAULT_SUGGESTIONS: MockAngle[] = [
  {
    name: 'Custo da escolha',
    promise: 'Entenda por que decidir cedo muda o resultado.',
    audience: 'Quem precisa decidir',
    sentence_ids: [10, 11],
  },
  {
    name: 'Aprender com o erro',
    promise: 'Descubra como transformar uma falha em aprendizado.',
    audience: 'Iniciantes',
    sentence_ids: [12],
  },
]

const limits = { minBlocks: 3, maxBlocks: 12, titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 }

const statesByCandidate = new Map<number, CandidateScriptState>()
let nextJobSeq = 100

function createDefaultState(): CandidateScriptState {
  const langReq = hasFlag('script-language')
  return {
    angle: null,
    angleRevision: 0,
    angles: [],
    anglePolls: 0,
    angleGeneration: 0,
    angleJobId: null,
    angleTimer: null,
    blocks: [],
    generation: 0,
    language: langReq ? '' : 'pt-BR',
    detectedLanguage: langReq ? null : 'pt-BR',
    languageRequired: langReq,
    pendingPolls: 0,
    regenBlockId: null,
    scriptJobId: null,
    scriptTimer: null,
    profile: 'legacy',
  }
}

function getState(candidate: number): CandidateScriptState {
  let st = statesByCandidate.get(candidate)
  if (!st) {
    st = createDefaultState()
    statesByCandidate.set(candidate, st)
  }
  return st
}

export function resetScriptMockState(): void {
  for (const st of statesByCandidate.values()) {
    if (st.angleTimer) clearTimeout(st.angleTimer)
    if (st.scriptTimer) clearTimeout(st.scriptTimer)
  }
  statesByCandidate.clear()
  nextJobSeq = 100
}

export function seedScriptMockCandidate(
  candidate: number,
  seed: {
    angle?: MockAngle | null
    angles?: MockAngle[]
    detectedLanguage?: string | null
    languageRequired?: boolean
    blocks?: Array<{
      id: number
      position?: number
      title: string
      intent?: string
      refs?: number[]
      narration: string
      approved?: boolean
      edited?: boolean
      stale?: boolean
    }>
  },
): void {
  const st = createDefaultState()
  if (seed.detectedLanguage !== undefined) {
    st.detectedLanguage = seed.detectedLanguage
    st.language = seed.detectedLanguage ?? ''
  }
  if (seed.languageRequired !== undefined) {
    st.languageRequired = seed.languageRequired
  }
  if (seed.angle !== undefined) {
    st.angle = seed.angle
    st.angleRevision = seed.angle ? 1 : 0
  }
  if (seed.angles) {
    st.angles = seed.angles
    st.angleGeneration = seed.angles.length > 0 ? 1 : 0
  }
  if (seed.blocks && seed.blocks.length > 0) {
    st.generation = 1
    st.language = st.detectedLanguage ?? 'pt-BR'
    st.blocks = seed.blocks.map((b, idx) => ({
      id: b.id,
      position: b.position ?? idx + 1,
      intent: b.intent ?? 'Comenta o trecho do Corte.',
      versions: [
        {
          title: b.title,
          narration: b.narration,
          refs: b.refs ?? [10],
          edited: b.edited ?? false,
          profile: 'legacy',
        },
      ],
      approved: b.approved ? 1 : 0,
      approvedAngleRev: st.angleRevision,
      stale: b.stale ?? false,
    }))
  }
  statesByCandidate.set(candidate, st)
}

export function cancelScriptMockJob(jobId: number, host?: ScriptMockHost): boolean {
  const project = host?.projectId?.() ?? null
  for (const st of statesByCandidate.values()) {
    if (st.angleJobId === jobId && st.anglePolls > 0) {
      if (st.angleTimer) clearTimeout(st.angleTimer)
      st.angleTimer = null
      st.anglePolls = 0
      st.angleJobId = null
      host?.emitProgress?.({
        job: String(jobId),
        project,
        stage: 'ai:angles:done',
        percentage: 0,
        message: 'Sugestão de ângulos cancelada.',
        error: { code: 'cancelled', message: 'Cancelado.' },
      })
      return true
    }
    if (st.scriptJobId === jobId && st.pendingPolls > 0) {
      if (st.scriptTimer) clearTimeout(st.scriptTimer)
      st.scriptTimer = null
      const wasRegen = st.regenBlockId
      st.pendingPolls = 0
      st.regenBlockId = null
      st.scriptJobId = null
      for (const b of st.blocks) {
        b.busy = false
        b.jobId = null
      }
      host?.emitProgress?.({
        job: String(jobId),
        project,
        stage: wasRegen !== null ? 'ai:script_block:done' : 'ai:script:done',
        percentage: 0,
        message: 'Geração de Roteiro cancelada.',
        error: { code: 'cancelled', message: 'Cancelado.' },
      })
      return true
    }
  }
  return false
}

function isBlockApproved(b: MockScriptBlock, angleRevision: number): boolean {
  return (
    b.versions.length > 0 &&
    !b.stale &&
    b.approved === b.versions.length &&
    b.approvedAngleRev === angleRevision
  )
}

function anglesView(st: CandidateScriptState) {
  return {
    angles: st.angleGeneration > 0 ? st.angles : [],
    generation: st.angleGeneration || null,
    selected: st.angle,
    busy: st.anglePolls > 0,
    job:
      st.angleGeneration || st.anglePolls
        ? {
            id: st.angleJobId ?? 100,
            state: st.anglePolls > 0 ? 'running' : 'completed',
            code: null,
            violations: [],
          }
        : null,
  }
}

function scriptView(candidate: number, st: CandidateScriptState) {
  const shown = st.blocks.map((b, i) => {
    const now = b.versions.length > 0 ? b.versions[b.versions.length - 1] : null
    const approved = isBlockApproved(b, st.angleRevision)
    return {
      id: b.id,
      position: b.position ?? i + 1,
      title: now?.title ?? `Bloco ${i + 1}`,
      intent: b.intent,
      refs: now?.refs ?? [10],
      narration: now?.narration ?? null,
      status: (approved ? 'aprovado' : 'pendente') as 'aprovado' | 'pendente',
      stale: b.stale,
      version: b.versions.length,
      edited: now?.edited ?? false,
      job: b.busy && b.jobId ? { id: b.jobId, state: 'running', code: null, violations: [] } : null,
    }
  })
  const pending = shown.filter((b) => b.status !== 'aprovado').length
  const totalChars = shown.reduce((n, b) => n + [...(b.narration ?? '')].length, 0)
  const scriptBusy = st.pendingPolls > 0 && st.regenBlockId === null
  const anyBusy = st.pendingPolls > 0
  return {
    schemaVersion: 1,
    revision:
      st.angleRevision +
      st.generation +
      st.blocks.reduce((n, b) => n + b.versions.length + (b.approved > 0 ? 1 : 0), 0),
    candidate: { run: 1, startId: 10, endId: 14 },
    detectedLanguage: st.detectedLanguage,
    languageRequired: st.languageRequired,
    angle: st.angle,
    current:
      st.generation > 0
        ? {
            generation: st.generation,
            language: st.language || 'pt-BR',
            blocks: shown,
            totalChars,
            pending,
            approved: shown.length - pending,
            complete: shown.every((b) => b.narration !== null),
          }
        : null,
    narrationAllowed: st.generation > 0 && !anyBusy && pending === 0 && shown.length > 0,
    job:
      st.scriptJobId !== null
        ? {
            id: st.scriptJobId,
            state: scriptBusy ? 'running' : 'completed',
            code: null,
            violations: [],
          }
        : null,
    busy: anyBusy,
    limits,
    generations:
      st.generation > 0
        ? [
            {
              generation: st.generation,
              jobId: st.scriptJobId ?? 1,
              language: st.language || 'pt-BR',
              taskVersion: 1,
              promptSha256: 'a'.repeat(64),
              profile: st.profile,
              createdAt: '2026-11-15T12:00:00Z',
            },
          ]
        : [],
  }
}

function finalizeAngleGeneration(st: CandidateScriptState, host?: ScriptMockHost) {
  if (st.angleTimer) {
    clearTimeout(st.angleTimer)
    st.angleTimer = null
  }
  if (st.anglePolls === 0) return
  st.anglePolls = 0
  st.angleGeneration += 1
  st.angles = DEFAULT_SUGGESTIONS.map((s) => ({ ...s, sentence_ids: s.sentence_ids ? [...s.sentence_ids] : undefined }))
  const project = host?.projectId?.() ?? null
  const job = String(st.angleJobId ?? 100)
  host?.emitProgress?.({
    job,
    project,
    stage: 'ai:angles:verify',
    percentage: 80,
    message: 'Validando ângulos sugeridos…',
    error: null,
  })
  host?.emitProgress?.({
    job,
    project,
    stage: 'ai:angles:done',
    percentage: 100,
    message: 'Sugestões de ângulo prontas.',
    error: null,
  })
}

function finalizeScriptGeneration(candidate: number, st: CandidateScriptState, host?: ScriptMockHost) {
  if (st.scriptTimer) {
    clearTimeout(st.scriptTimer)
    st.scriptTimer = null
  }
  if (st.pendingPolls === 0) return
  st.pendingPolls = 0
  const project = host?.projectId?.() ?? null
  const job = String(st.scriptJobId ?? 1)
  if (st.regenBlockId !== null) {
    const target = st.blocks.find((b) => b.id === st.regenBlockId)
    if (target) {
      const prev = target.versions[target.versions.length - 1]
      target.versions.push({
        title: prev?.title ?? `Bloco ${target.position}`,
        narration: `Nova fala do bloco ${target.id} sobre o Corte.`,
        refs: prev?.refs ?? [10],
        edited: false,
        profile: st.profile,
      })
      target.stale = false
      target.busy = false
      target.jobId = null
    }
    st.regenBlockId = null
    host?.emitProgress?.({
      job,
      project,
      stage: 'ai:script_block:verify',
      percentage: 80,
      message: 'Validando bloco regenerado…',
      error: null,
    })
    host?.emitProgress?.({
      job,
      project,
      stage: 'ai:script_block:done',
      percentage: 100,
      message: 'Bloco atualizado.',
      error: null,
    })
    return
  }

  st.generation += 1
  const baseId = candidate * 100 + st.generation * 10
  st.blocks = [1, 2, 3].map((n) => ({
    id: baseId + n,
    position: n,
    intent: 'Comenta o trecho do Corte.',
    versions: [
      {
        title: `Bloco ${n}`,
        narration: `Fala do bloco ${n} sobre o Corte.`,
        refs: [10],
        edited: false,
        profile: st.profile,
      },
    ],
    approved: 0,
    approvedAngleRev: st.angleRevision,
    stale: false,
  }))
  host?.emitProgress?.({
    job,
    project,
    stage: 'ai:script:verify',
    percentage: 80,
    message: 'Validando estrutura do Roteiro…',
    error: null,
  })
  host?.emitProgress?.({
    job,
    project,
    stage: 'ai:script:done',
    percentage: 100,
    message: 'Esboço do Roteiro pronto.',
    error: null,
  })
  host?.emitProgress?.({
    job: String(job) + '-b',
    project,
    stage: 'ai:script_block:done',
    percentage: 100,
    message: 'Blocos do Roteiro prontos.',
    error: null,
  })
}

const violation = (code: string, path: string, message: string) => ({ code, path, message })
const hasForbidden = (text: string) => text.includes('<') || text.includes('>')
const hasUrl = (text: string) => /https?:\/\/|:\/\/|www\./i.test(text)

function resolveRouteInfo(host: ScriptMockHost | undefined, profileId?: string) {
  const paidFlag = hasFlag('script-paid')
  if (host?.resolveRoute) {
    const r = host.resolveRoute('script', profileId)
    if (r.blockedLocalOnly) {
      throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' }
    }
    const paid = paidFlag || r.paid
    const estimate = paidFlag && r.estimate.kind === 'zero'
      ? { kind: 'usd', minMicroUsd: 400, maxMicroUsd: 2000 }
      : r.estimate
    return { paid, profile: r.profile, estimate }
  }
  return {
    paid: paidFlag,
    profile: profileId ?? 'legacy',
    estimate: paidFlag ? { kind: 'usd', minMicroUsd: 400, maxMicroUsd: 2000 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 },
  }
}

/** `undefined` quando o comando não é do Roteiro/Ângulos. */
export function scriptMockDispatch(name: string, args: object, host?: ScriptMockHost): unknown {
  if (!name.startsWith('angles.') && !name.startsWith('script.')) return undefined

  const a = args as {
    candidate?: number
    block?: number
    title?: string | null
    narration?: string | null
    refs?: number[] | null
    confirmed?: boolean
    angle?: MockAngle
    index?: number
    generation?: number
    language?: string
    profileId?: string
  }
  const candidate = a.candidate ?? 1
  host?.checkTransformed?.(candidate)

  const st = getState(candidate)

  if (name === 'angles.estimate') {
    if (st.languageRequired && !a.language) {
      throw { code: 'language_required', message: 'Escolha o idioma: PT-BR ou EN.' }
    }
    const route = resolveRouteInfo(host)
    const paidFlag = hasFlag('script-paid')
    return {
      paid: route.paid,
      profile: route.profile,
      estimate: paidFlag
        ? { kind: 'usd', minMicroUsd: 100, maxMicroUsd: 300 }
        : route.estimate,
    }
  }

  if (name === 'angles.generate') {
    if (st.languageRequired && !a.language) {
      throw { code: 'language_required', message: 'Escolha o idioma: PT-BR ou EN.' }
    }
    const route = resolveRouteInfo(host)
    if (route.paid && !a.confirmed) {
      throw { code: 'confirmation_required', message: 'Confirmação obrigatória.', usage: { estimate: route.estimate } }
    }
    if (st.anglePolls > 0) {
      throw { code: 'generation_in_progress', message: 'Já há uma sugestão de ângulos em andamento.' }
    }
    st.anglePolls = 2
    const jobId = nextJobSeq++
    st.angleJobId = jobId
    const project = host?.projectId?.() ?? null
    host?.emitProgress?.({
      job: String(jobId),
      project,
      stage: 'ai:angles:prepare',
      percentage: 0,
      message: 'Preparando sugestões de ângulo…',
      error: null,
    })
    host?.emitProgress?.({
      job: String(jobId),
      project,
      stage: 'ai:angles:call',
      percentage: 10,
      message: 'Consultando Provedor para ângulos…',
      error: null,
    })
    st.angleTimer = setTimeout(() => finalizeAngleGeneration(st, host), 20)
    return { job: jobId }
  }

  if (name === 'angles.get') {
    if (st.anglePolls > 0 && --st.anglePolls === 0) {
      finalizeAngleGeneration(st, host)
    }
    return anglesView(st)
  }

  if (name === 'angles.choose') {
    const next = a.generation ? st.angles[a.index ?? -1] : a.angle
    const nameStr = next?.name?.trim() ?? ''
    const promiseStr = next?.promise?.trim() ?? ''
    const audienceStr = next?.audience?.trim() ?? ''
    const invalidManual =
      !nameStr ||
      [...nameStr].length > 60 ||
      !promiseStr ||
      [...promiseStr].length > 200 ||
      promiseStr.includes('\n') ||
      [...audienceStr].length > 120 ||
      (next?.sentence_ids !== undefined &&
        (!Array.isArray(next.sentence_ids) ||
          next.sentence_ids.length > 12 ||
          next.sentence_ids.some((id) => typeof id !== 'number' || !Number.isInteger(id))))
    if (!next || invalidManual) {
      throw { code: 'angle_invalid', message: 'Dados do ângulo inválidos.' }
    }
    if (st.pendingPolls > 0) {
      throw { code: 'generation_in_progress', message: 'Aguarde a geração do Roteiro antes de trocar o ângulo.' }
    }
    if (JSON.stringify(next) !== JSON.stringify(st.angle)) {
      if (st.generation > 0 && !a.confirmed) {
        throw {
          code: 'angle_change_confirmation',
          message: 'Confirme a troca do ângulo: os blocos do Roteiro ficarão desatualizados.',
        }
      }
      st.angle = {
        name: nameStr,
        promise: promiseStr,
        ...(audienceStr ? { audience: audienceStr } : {}),
        ...(next.sentence_ids ? { sentence_ids: [...next.sentence_ids] } : {}),
      }
      st.angleRevision += 1
      st.blocks.forEach((b) => {
        b.stale = true
      })
    }
    return anglesView(st)
  }

  if (name === 'script.estimate') {
    if (!st.angle) throw { code: 'angle_required', message: 'Escolha um ângulo antes.' }
    if (st.languageRequired && !a.language && !st.language) {
      throw { code: 'language_required', message: 'Escolha o idioma: PT-BR ou EN.' }
    }
    const route = resolveRouteInfo(host, a.profileId)
    return {
      paid: route.paid,
      profile: route.profile,
      language: a.language || st.language || 'pt-BR',
      estimate: route.estimate,
    }
  }

  if (name === 'script.generate' || name === 'script.regenerate') {
    if (!st.angle) throw { code: 'angle_required', message: 'Escolha um ângulo antes.' }
    if (st.languageRequired && !a.language && !st.language) {
      throw { code: 'language_required', message: 'Escolha o idioma: PT-BR ou EN.' }
    }
    const route = resolveRouteInfo(host, name === 'script.regenerate' ? a.profileId : undefined)
    if (route.paid && !a.confirmed) {
      throw { code: 'confirmation_required', message: 'Confirmação obrigatória.', usage: { estimate: route.estimate } }
    }
    if (st.pendingPolls > 0) {
      throw { code: 'generation_in_progress', message: 'Já há uma geração em andamento para este Roteiro.' }
    }
    if (a.language) {
      st.language = a.language
    }
    st.profile = route.profile

    const jobId = nextJobSeq++
    if (name === 'script.regenerate') {
      const target = st.blocks.find((b) => b.id === a.block)
      if (!target) throw { code: 'block_not_found', message: 'Bloco não encontrado.' }
      st.regenBlockId = target.id
      target.busy = true
      target.jobId = jobId
    } else {
      st.regenBlockId = null
    }
    st.pendingPolls = 2
    st.scriptJobId = jobId
    const project = host?.projectId?.() ?? null
    const stagePrefix = name === 'script.regenerate' ? 'ai:script_block' : 'ai:script'
    host?.emitProgress?.({
      job: String(jobId),
      project,
      stage: `${stagePrefix}:prepare`,
      percentage: 0,
      message: name === 'script.regenerate' ? 'Preparando regeneração do bloco…' : 'Preparando geração do Roteiro…',
      error: null,
    })
    host?.emitProgress?.({
      job: String(jobId),
      project,
      stage: `${stagePrefix}:call`,
      percentage: 10,
      message: 'Consultando Provedor…',
      error: null,
    })
    st.scriptTimer = setTimeout(() => finalizeScriptGeneration(candidate, st, host), 20)
    return name === 'script.regenerate' ? { job: jobId, block: a.block } : { job: jobId }
  }

  if (name === 'script.get') {
    if (st.pendingPolls > 0 && --st.pendingPolls === 0) {
      finalizeScriptGeneration(candidate, st, host)
    }
    return scriptView(candidate, st)
  }

  if (name === 'script.narration_allowed') {
    if (st.pendingPolls > 0) {
      throw {
        code: 'script_not_approved',
        message: 'A Narração só é liberada quando todos os blocos do Roteiro estão aprovados.',
        usage: { reason: 'generating', pending: 0 },
      }
    }
    if (st.generation === 0 || st.blocks.length === 0) {
      throw {
        code: 'script_not_approved',
        message: 'A Narração só é liberada quando todos os blocos do Roteiro estão aprovados.',
        usage: { reason: 'no_script', pending: 0 },
      }
    }
    const pending = st.blocks.filter((b) => !isBlockApproved(b, st.angleRevision)).length
    if (pending > 0) {
      throw {
        code: 'script_not_approved',
        message: 'A Narração só é liberada quando todos os blocos do Roteiro estão aprovados.',
        usage: { reason: 'pending_blocks', pending },
      }
    }
    return { allowed: true }
  }

  if (name === 'script.edit' || name === 'script.approve') {
    if (st.pendingPolls > 0) {
      throw { code: 'generation_in_progress', message: 'Já há uma geração em andamento para este bloco.' }
    }
    const target = st.blocks.find((b) => b.id === a.block)
    if (!target) throw { code: 'block_not_found', message: 'Bloco não encontrado.' }
    const latest = target.versions[target.versions.length - 1]
    if (!latest) {
      throw {
        code: name === 'script.edit' ? 'nothing_to_edit' : 'nothing_to_approve',
        message: 'O bloco ainda não tem texto.',
      }
    }

    if (name === 'script.approve') {
      target.approved = target.versions.length
      target.approvedAngleRev = st.angleRevision
      target.stale = false
      return scriptView(candidate, st)
    }

    const nextTitle = typeof a.title === 'string' ? a.title.trim() : latest.title
    const nextNarration = typeof a.narration === 'string' ? a.narration.trim() : latest.narration
    const nextRefs = Array.isArray(a.refs) ? [...a.refs] : [...latest.refs]
    if (a.title !== undefined && a.title !== null && typeof a.title !== 'string') {
      throw { code: 'invalid_edit', message: 'Edição inválida.' }
    }
    if (a.narration !== undefined && a.narration !== null && typeof a.narration !== 'string') {
      throw { code: 'invalid_edit', message: 'Edição inválida.' }
    }
    if (
      a.refs !== undefined &&
      a.refs !== null &&
      (!Array.isArray(a.refs) || a.refs.some((r) => typeof r !== 'number' || !Number.isInteger(r)))
    ) {
      throw { code: 'invalid_edit', message: 'Edição inválida.' }
    }

    const othersChars = st.blocks
      .filter((b) => b.id !== target.id)
      .reduce((sum, b) => {
        const cur = b.versions[b.versions.length - 1]
        return sum + [...(cur?.narration ?? '')].length
      }, 0)

    const violations: Array<{ code: string; path: string; message: string }> = []
    if (!nextTitle) violations.push(violation('title_empty', '/title', 'Title is empty'))
    else if ([...nextTitle].length > limits.titleChars) violations.push(violation('title_too_long', '/title', 'Title is too long'))
    const narrationLen = [...nextNarration].length
    if (!nextNarration) violations.push(violation('narration_empty', '/narration', 'Narration is empty'))
    else if (narrationLen > limits.narrationChars) violations.push(violation('narration_too_long', '/narration', 'Narration is too long'))
    if (othersChars + narrationLen > limits.scriptChars) violations.push(violation('script_too_long', '/narration', 'Script is too long in total'))
    if (hasForbidden(nextTitle) || hasForbidden(nextNarration)) {
      violations.push(violation('forbidden_character', '/narration', 'Text contains a forbidden character'))
    }
    if (hasUrl(nextTitle) || hasUrl(nextNarration)) {
      violations.push(violation('invented_url', '/narration', 'Text contains a URL'))
    }
    if (nextRefs.length > limits.refs) {
      violations.push(violation('too_many_refs', '/refs', 'Too many references'))
    }
    if (violations.length > 0) {
      throw {
        code: 'edit_invalid',
        message: 'A edição passa de um limite do Roteiro ou tem formato inválido.',
        usage: { violations },
      }
    }

    if (
      nextTitle !== latest.title ||
      nextNarration !== latest.narration ||
      JSON.stringify(nextRefs) !== JSON.stringify(latest.refs) ||
      target.stale
    ) {
      target.versions.push({
        title: nextTitle,
        narration: nextNarration,
        refs: nextRefs,
        edited: true,
        profile: latest.profile,
      })
      target.stale = false
    }
    return scriptView(candidate, st)
  }

  return undefined
}
