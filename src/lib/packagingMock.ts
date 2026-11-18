// Empacotamento simulado (#68, #80, Pacote E).
// Indexado por candidate; usa rota/Permissão real quando fornecida pelo host, mantendo compatibilidade
// com ?packaging-paid, ?packaging-nopermission e ?packaging-language.
const flag = (name: string) => {
  if (typeof location === 'undefined') return false
  if (new URLSearchParams(location.search).has(name)) return true
  const hash = location.hash ?? ''
  const qIdx = hash.indexOf('?')
  return qIdx >= 0 && new URLSearchParams(hash.slice(qIdx + 1)).has(name)
}

type Fields = { title: string; description: string; tags: string[]; hashtags: string[] }
type Gen = { language: string; profile: string; generated: Fields; edits: Fields[] }

export type PackagingMockContext = {
  videoKind: 'direct' | 'transformed'
  scriptAllowed: boolean
  blocks: { id: number; position: number; title: string; durationUs: number | null }[]
  source?: number
  permission?: { status: string; who?: string; where?: string; scope?: string }
  originUrl?: string | null
  detectedLanguage?: string | null
  languageRequired?: boolean
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

type PendingState = {
  polls: number
  jobId: number
  language: string
  profile: string
  timer: ReturnType<typeof setTimeout> | null
}

const gensByCandidate = new Map<number, Gen[]>()
const pendingByCandidate = new Map<number, PendingState>()
let nextPackJobSeq = 500
const limits = { titleChars: 100, descriptionBytes: 5000, tagsChars: 500, tags: 30, tagChars: 60, hashtags: 15 }

let permissionOverride: { status: string; who?: string } | null = null
export function setPackagingMockPermission(permission: { status: string; who?: string } | null) {
  permissionOverride = permission
}

export function resetPackagingMockState(): void {
  for (const p of pendingByCandidate.values()) {
    if (p.timer) clearTimeout(p.timer)
  }
  pendingByCandidate.clear()
  gensByCandidate.clear()
  permissionOverride = null
  nextPackJobSeq = 500
}

export function seedPackagingMockCandidate(
  candidate: number,
  seed: { language?: string; generated: Fields; edits?: Fields[] },
): void {
  gensByCandidate.set(candidate, [
    {
      language: seed.language ?? 'pt-BR',
      profile: 'legacy',
      generated: seed.generated,
      edits: seed.edits ?? [],
    },
  ])
}

export function cancelPackagingMockJob(
  jobId: number,
  ctx?: Pick<PackagingMockContext, 'emitProgress' | 'projectId'>,
): boolean {
  const project = ctx?.projectId?.() ?? null
  for (const [candidate, p] of pendingByCandidate.entries()) {
    if (p.jobId === jobId && p.polls > 0) {
      if (p.timer) clearTimeout(p.timer)
      pendingByCandidate.delete(candidate)
      ctx?.emitProgress?.({
        job: String(jobId),
        project,
        stage: 'ai:packaging:done',
        percentage: 0,
        message: 'Empacotamento cancelado.',
        error: { code: 'cancelled', message: 'Cancelado.' },
      })
      return true
    }
  }
  return false
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length

function buildCreditText(lang: string, ctx?: PackagingMockContext): string | null {
  if (flag('packaging-nopermission')) return null
  if (permissionOverride !== null) {
    if (permissionOverride.status !== 'granted' || !permissionOverride.who?.trim()) return null
    const who = permissionOverride.who.trim()
    return lang === 'en'
      ? `Credit: original video by ${who}.`
      : `Crédito: vídeo original de ${who}.`
  }
  if (ctx?.permission) {
    if (ctx.permission.status !== 'granted' || !ctx.permission.who?.trim()) return null
    const who = ctx.permission.who.trim()
    const base =
      lang === 'en'
        ? `Credit: original video by ${who}.`
        : `Crédito: vídeo original de ${who}.`
    const url = ctx.originUrl && /^https?:\/\//i.test(ctx.originUrl) ? ctx.originUrl : null
    if (!url) return base
    return lang === 'en' ? `${base}\nSource: ${url}` : `${base}\nFonte: ${url}`
  }
  return 'Crédito: vídeo original de Canal Exemplo.\nFonte: https://example.com/watch?v=abc'
}

const violation = (code: string, path: string, message: string) => ({ code, path, message })

const DELIM_PT = ['--- Capítulos ---', '--- Fim dos capítulos ---'] as const
const DELIM_EN = ['--- Chapters ---', '--- End chapters ---'] as const

function fmtTs(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  const h = Math.floor(s / 3600)
  const m = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`
}

function findDelimiters(text: string): { start: number; end: number; inner: string } | null {
  const lines = text.split('\n')
  let offset = 0
  let found: { start: number; innerStart: number; endMarker: string } | null = null
  for (const raw of lines) {
    const trimmed = raw.replace(/\r$/, '')
    if (found) {
      if (trimmed === found.endMarker) {
        return { start: found.start, end: offset + trimmed.length, inner: text.slice(found.innerStart, offset) }
      }
    } else if (trimmed === DELIM_PT[0] || trimmed === DELIM_EN[0]) {
      const endMarker = trimmed === DELIM_PT[0] ? DELIM_PT[1] : DELIM_EN[1]
      found = { start: offset, innerStart: Math.min(text.length, offset + raw.length + 1), endMarker }
    }
    offset += raw.length + 1
  }
  return null
}

function parseHms(token: string): number | null {
  const parts = token.split(':')
  if (parts.length === 2) {
    const [mStr, sStr] = parts
    if (!/^\d{1,3}$/.test(mStr) || !/^\d{2}$/.test(sStr)) return null
    const m = Number(mStr)
    const s = Number(sStr)
    return s < 60 ? m * 60 + s : null
  }
  if (parts.length === 3) {
    const [hStr, mStr, sStr] = parts
    if (!/^\d{1,2}$/.test(hStr) || !/^\d{2}$/.test(mStr) || !/^\d{2}$/.test(sStr)) return null
    const h = Number(hStr)
    const m = Number(mStr)
    const s = Number(sStr)
    return m < 60 && s < 60 ? h * 3600 + m * 60 + s : null
  }
  return null
}

function validateDescriptionChapters(
  description: string,
  totalDurationSecs: number | null = null,
): { code: string; message: string }[] {
  const delim = findDelimiters(description)
  const lines = delim
    ? delim.inner.split('\n').map((l) => l.trim()).filter(Boolean)
    : description.split('\n').map((l) => l.trim()).filter((l) => /^\d{1,3}:\d{2}(?::\d{2})?(?:\s|$)/.test(l))
  if (!delim && lines.length === 0) return []
  const warnings: { code: string; message: string }[] = []
  const push = (code: string, message: string) => {
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, message })
  }
  const secs: number[] = []
  for (const line of lines) {
    const m = /^(\S+)\s+(.+)$/.exec(line)
    const parsed = m ? parseHms(m[1]) : null
    if (parsed === null || !m?.[2].trim()) {
      push('invalid_chapter_format', 'Cada linha de capítulo deve ter timestamp (ex.: 00:00) e título.')
    } else {
      secs.push(parsed)
    }
  }
  if (secs.length > 0 && secs[0] !== 0) push('first_chapter_not_zero', 'O primeiro capítulo deve começar em 00:00.')
  if (secs.length < 3) push('too_few_chapters', 'O YouTube exige pelo menos 3 capítulos.')
  for (let i = 0; i + 1 < secs.length; i += 1) {
    if (secs[i + 1] < secs[i]) push('chapters_not_ordered', 'Os timestamps dos capítulos devem estar em ordem crescente.')
    else if (secs[i + 1] - secs[i] < 10) push('chapter_too_short', 'Cada capítulo no YouTube precisa durar pelo menos 10 s.')
  }
  if (totalDurationSecs !== null && secs.length > 0) {
    const last = secs[secs.length - 1]
    if (last > totalDurationSecs) {
      push('chapter_past_end', 'Um capítulo começa após o fim do vídeo.')
    } else if (totalDurationSecs - last < 10) {
      push('chapter_too_short', 'Cada capítulo no YouTube precisa durar pelo menos 10 s.')
    }
  }
  return warnings
}

function resolveChapters(ctx: PackagingMockContext | undefined, lang: string, currentDesc: string | null) {
  const [start, end] = lang === 'en' ? DELIM_EN : DELIM_PT
  const hasDelimiters = currentDesc ? findDelimiters(currentDesc) !== null : false
  if (!ctx || ctx.videoKind !== 'transformed') {
    return {
      applicable: false,
      canGenerate: false,
      status: 'not_transformed',
      hasDelimiters,
      delimiters: { start, end },
      suggested: [],
      block: null,
      generationWarning: null,
      editWarnings: currentDesc ? validateDescriptionChapters(currentDesc) : [],
    }
  }
  if (!ctx.scriptAllowed || ctx.blocks.length === 0) {
    return {
      applicable: true,
      canGenerate: false,
      status: 'script_not_approved',
      hasDelimiters,
      delimiters: { start, end },
      suggested: [],
      block: null,
      generationWarning: {
        code: 'script_not_approved',
        message: 'Aprove todos os blocos do Roteiro e gere a Narração para ter capítulos.',
      },
      editWarnings: currentDesc ? validateDescriptionChapters(currentDesc) : [],
    }
  }
  if (ctx.blocks.some((b) => b.durationUs === null)) {
    return {
      applicable: true,
      canGenerate: false,
      status: 'narration_required',
      hasDelimiters,
      delimiters: { start, end },
      suggested: [],
      block: null,
      generationWarning: { code: 'narration_required', message: 'Gere a Narração para ter capítulos.' },
      editWarnings: currentDesc ? validateDescriptionChapters(currentDesc) : [],
    }
  }
  let cursorUs = 0
  const items = ctx.blocks.map((b, i) => {
    const startSecs = i === 0 ? 0 : Math.floor(cursorUs / 1_000_000)
    cursorUs += (b.durationUs ?? 0) + 300_000
    return { startSecs, title: b.title }
  })
  const totalSecs = Math.floor(Math.max(0, cursorUs - 300_000) / 1_000_000)
  const editWarnings = currentDesc ? validateDescriptionChapters(currentDesc, totalSecs) : []
  while (items.length >= 2) {
    const idx = items.findIndex((it, i) => ((i + 1 < items.length ? items[i + 1].startSecs : totalSecs) - it.startSecs) < 10)
    if (idx === -1) break
    items.splice(idx === 0 ? 1 : idx, 1)
  }
  if (items.length < 3 || totalSecs < 30) {
    return {
      applicable: true,
      canGenerate: false,
      status: 'too_few_chapters',
      hasDelimiters,
      delimiters: { start, end },
      suggested: [],
      block: null,
      generationWarning: {
        code: 'too_few_chapters',
        message: 'O YouTube exige pelo menos 3 capítulos de 10 s cada, começando em 00:00.',
      },
      editWarnings,
    }
  }
  const suggested = items.map((it) => ({ startSecs: it.startSecs, timestamp: fmtTs(it.startSecs), title: it.title }))
  const block = [start, ...suggested.map((s) => `${s.timestamp} ${s.title}`), end].join('\n')
  return {
    applicable: true,
    canGenerate: true,
    status: 'ready',
    hasDelimiters,
    delimiters: { start, end },
    suggested,
    block,
    generationWarning: null,
    editWarnings,
  }
}

function tagsChars(tags: string[]): number {
  const items = tags.reduce((acc, t) => acc + [...t].length + (t.includes(' ') ? 2 : 0), 0)
  return items + Math.max(0, tags.length - 1)
}

function validHashtag(h: string): boolean {
  if (!h.startsWith('#')) return false
  const rest = h.slice(1)
  if (!rest || [...h].length > 60) return false
  if (!/^[\p{L}\p{N}_]+$/u.test(rest)) return false
  if (/^\d+$/.test(rest)) return false
  return true
}

function checkLimits(f: Fields, creditBytes: number) {
  const out: Array<{ code: string; path: string; message: string }> = []
  const title = f.title.trim()
  if (!title) out.push(violation('title_empty', '/title', 'Title is empty'))
  else if ([...title].length > limits.titleChars) out.push(violation('title_too_long', '/title', 'Title is too long'))
  if (utf8Bytes(f.description) + creditBytes > limits.descriptionBytes) {
    out.push(violation('description_too_long', '/description', 'Description is too long'))
  }
  if (f.title.includes('<') || f.title.includes('>') || f.description.includes('<') || f.description.includes('>')) {
    out.push(violation('forbidden_character', '/title', 'Text contains a forbidden character'))
  }
  if (f.tags.length > limits.tags) out.push(violation('too_many_tags', '/tags', 'Too many tags'))
  f.tags.forEach((t, i) => {
    const p = `/tags/${i}`
    if (!t.trim() || t.includes(',') || t.includes('<') || t.includes('>')) {
      out.push(violation('invalid_tag', p, 'Tag is empty or has a forbidden character'))
    } else if ([...t].length > limits.tagChars) {
      out.push(violation('tag_too_long', p, 'Tag is too long'))
    }
  })
  if (tagsChars(f.tags) > limits.tagsChars) {
    out.push(violation('tags_too_long', '/tags', 'Tags are too long together'))
  }
  if (f.hashtags.length > limits.hashtags) {
    out.push(violation('too_many_hashtags', '/hashtags', 'Too many hashtags'))
  }
  f.hashtags.forEach((h, i) => {
    if (!validHashtag(h)) {
      out.push(violation('invalid_hashtag', `/hashtags/${i}`, 'Hashtag must start with # and have no spaces'))
    }
  })
  return out
}

function view(candidate: number, ctx?: PackagingMockContext) {
  const gens = gensByCandidate.get(candidate) ?? []
  const done = gens.length
  const last = gens[done - 1]
  const now = last ? (last.edits[last.edits.length - 1] ?? last.generated) : null
  const lang = last?.language ?? ctx?.detectedLanguage ?? 'pt-BR'
  const text = buildCreditText(lang, ctx)
  const chapters = resolveChapters(ctx, lang, now?.description ?? null)
  const pending = pendingByCandidate.get(candidate)
  const languageRequired = flag('packaging-language') || Boolean(ctx?.languageRequired)
  const detectedLanguage = languageRequired ? null : (ctx?.detectedLanguage ?? 'pt-BR')
  return {
    schemaVersion: 1,
    revision: gens.reduce((n, g) => n + 1 + g.edits.length, 0),
    detectedLanguage,
    languageRequired,
    current:
      now && last
        ? {
            generation: done,
            language: last.language,
            edited: last.edits.length > 0,
            ...now,
            fullDescription: text ? `${now.description.trimEnd()}\n\n${text}` : now.description,
          }
        : null,
    credit: { text, warning: text ? null : 'no_permission' },
    chapters,
    job:
      pending && pending.polls > 0
        ? { id: pending.jobId, state: 'running', code: null, violations: [] }
        : done > 0
          ? { id: done, state: 'completed', code: null, violations: [] }
          : null,
    limits,
    source: ctx?.source ?? 1,
    generations: gens.map((g, i) => ({
      generation: i + 1,
      jobId: i + 1,
      language: g.language,
      taskVersion: 2,
      promptSha256: 'a'.repeat(64),
      profile: g.profile,
      createdAt: '2026-11-15T12:00:00Z',
      generated: g.generated,
      edits: g.edits,
    })),
  }
}

function finalizeGeneration(candidate: number, ctx?: PackagingMockContext) {
  const pending = pendingByCandidate.get(candidate)
  if (!pending) return
  if (pending.timer) {
    clearTimeout(pending.timer)
    pending.timer = null
  }
  if (pending.polls === 0) return
  pending.polls = 0
  pendingByCandidate.delete(candidate)
  const gens = gensByCandidate.get(candidate) ?? []
  const lang = pending.language || 'pt-BR'
  const ch = resolveChapters(ctx, lang, null)
  const summary = 'Resumo curto do que acontece no Corte.'
  const description = ch.block ? `${summary}\n\n${ch.block}` : summary
  gens.push({
    language: lang,
    profile: pending.profile,
    generated: {
      title: `Título gerado ${gens.length + 1}`,
      description,
      tags: ['corte', 'live'],
      hashtags: ['#corte', '#live'],
    },
    edits: [],
  })
  gensByCandidate.set(candidate, gens)
  const project = ctx?.projectId?.() ?? null
  ctx?.emitProgress?.({
    job: String(pending.jobId),
    project,
    stage: 'ai:packaging:verify',
    percentage: 80,
    message: 'Validando limites de Empacotamento…',
    error: null,
  })
  ctx?.emitProgress?.({
    job: String(pending.jobId),
    project,
    stage: 'ai:packaging:done',
    percentage: 100,
    message: 'Empacotamento sugerido pronto.',
    error: null,
  })
}

function resolveRouteInfo(ctx?: PackagingMockContext) {
  const paidFlag = flag('packaging-paid')
  if (ctx?.resolveRoute) {
    const r = ctx.resolveRoute()
    if (r.blockedLocalOnly) {
      throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' }
    }
    const paid = paidFlag || r.paid
    const estimate = paidFlag && r.estimate.kind === 'zero'
      ? { kind: 'usd', minMicroUsd: 300, maxMicroUsd: 900 }
      : r.estimate
    return { paid, profile: r.profile, estimate }
  }
  return {
    paid: paidFlag,
    profile: 'legacy',
    estimate: paidFlag ? { kind: 'usd', minMicroUsd: 300, maxMicroUsd: 900 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 },
  }
}

/** `undefined` quando o comando não é do empacotamento. */
export function packagingMockDispatch(name: string, args: object, ctx?: PackagingMockContext): unknown {
  if (!name.startsWith('packaging.')) return undefined

  const a = args as { candidate?: number; language?: string; confirmed?: boolean } & Partial<Fields>
  const candidate = a.candidate ?? 1
  const gens = gensByCandidate.get(candidate) ?? []
  const langReq = flag('packaging-language') || Boolean(ctx?.languageRequired)

  if (name === 'packaging.estimate') {
    if (langReq && !a.language) {
      throw { code: 'language_required', message: 'Escolha o idioma do empacotamento: PT-BR ou EN.' }
    }
    const route = resolveRouteInfo(ctx)
    return {
      paid: route.paid,
      profile: route.profile,
      language: a.language ?? ctx?.detectedLanguage ?? 'pt-BR',
      estimate: route.estimate,
    }
  }

  if (name === 'packaging.generate') {
    if (langReq && !a.language) {
      throw { code: 'language_required', message: 'Escolha o idioma do empacotamento: PT-BR ou EN.' }
    }
    const route = resolveRouteInfo(ctx)
    if (route.paid && !a.confirmed) {
      throw { code: 'confirmation_required', message: 'confirmação obrigatória', usage: { estimate: route.estimate } }
    }
    const existing = pendingByCandidate.get(candidate)
    if (existing && existing.polls > 0) {
      throw { code: 'generation_in_progress', message: 'Já há uma sugestão de Empacotamento em andamento.' }
    }
    const lang = a.language ?? ctx?.detectedLanguage ?? 'pt-BR'
    const jobId = nextPackJobSeq++
    const pending: PendingState = {
      polls: 2,
      jobId,
      language: lang,
      profile: route.profile,
      timer: setTimeout(() => finalizeGeneration(candidate, ctx), 20),
    }
    pendingByCandidate.set(candidate, pending)
    const project = ctx?.projectId?.() ?? null
    ctx?.emitProgress?.({
      job: String(jobId),
      project,
      stage: 'ai:packaging:prepare',
      percentage: 0,
      message: 'Preparando sugestões de Empacotamento…',
      error: null,
    })
    ctx?.emitProgress?.({
      job: String(jobId),
      project,
      stage: 'ai:packaging:call',
      percentage: 10,
      message: 'Consultando Provedor para Empacotamento…',
      error: null,
    })
    return { job: jobId, language: lang }
  }

  if (name === 'packaging.get') {
    const pending = pendingByCandidate.get(candidate)
    if (pending && pending.polls > 0 && --pending.polls === 0) {
      finalizeGeneration(candidate, ctx)
    }
    return view(candidate, ctx)
  }

  if (name === 'packaging.edit') {
    const last = gens[gens.length - 1]
    if (!last) throw { code: 'nothing_to_edit', message: 'Gere o empacotamento antes de editar.' }
    const prev = last.edits[last.edits.length - 1] ?? last.generated
    const f: Fields = {
      title: (typeof a.title === 'string' ? a.title : prev.title).trim(),
      description: typeof a.description === 'string' ? a.description : prev.description,
      tags: Array.isArray(a.tags) ? a.tags.map((t) => String(t).trim()) : prev.tags,
      hashtags: Array.isArray(a.hashtags) ? a.hashtags.map((h) => String(h).trim()) : prev.hashtags,
    }
    const creditText = buildCreditText(last.language, ctx)
    const creditBytes = creditText ? utf8Bytes(creditText) + 2 : 0
    const violations = checkLimits(f, creditBytes)
    if (violations.length > 0) {
      throw {
        code: 'edit_invalid',
        message: 'A edição passa de um limite do YouTube ou tem formato inválido.',
        usage: { violations },
      }
    }
    last.edits.push(f)
    return view(candidate, ctx)
  }

  if (name === 'packaging.refresh_chapters') {
    const last = gens[gens.length - 1]
    if (!last) throw { code: 'nothing_to_edit', message: 'Gere o empacotamento antes de atualizar capítulos.' }
    const current = last.edits[last.edits.length - 1] ?? last.generated
    const desc = typeof a.description === 'string' ? a.description : current.description
    const ch = resolveChapters(ctx, last.language, desc)
    if (!ch.applicable) {
      throw { code: 'chapters_require_transformed', message: 'Capítulos automáticos só existem para Vídeo transformado.' }
    }
    const delim = findDelimiters(desc)
    if (!delim) {
      throw {
        code: 'chapter_delimiters_missing',
        message: 'Os delimitadores de capítulos foram removidos da descrição. Nada foi alterado.',
      }
    }
    if (!ch.block) {
      throw ch.generationWarning ?? { code: 'chapters_unavailable', message: 'Não foi possível gerar capítulos válidos.' }
    }
    const nextDesc = `${desc.slice(0, delim.start)}${ch.block}${desc.slice(delim.end)}`
    last.edits.push({ ...current, description: nextDesc })
    return view(candidate, ctx)
  }

  return undefined
}
