// Empacotamento simulado (#68, #80). `?packaging-paid` pede a confirmação de custo; `?packaging-nopermission`
// tira o crédito; `?packaging-language` deixa o idioma do Corte indefinido; `?packaging-chapters`
// usa durações >= 10 s por bloco para testar capítulos válidos na UI.
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);
type Fields = { title: string; description: string; tags: string[]; hashtags: string[] };
type Gen = { language: string; generated: Fields; edits: Fields[] };
export type PackagingMockContext = {
  videoKind: 'direct' | 'transformed';
  scriptAllowed: boolean;
  blocks: { id: number; position: number; title: string; durationUs: number | null }[];
};
const gensByCandidate = new Map<number, Gen[]>();
let pendingPolls = 0;
let pendingCandidate = 1;
const limits = { titleChars: 100, descriptionBytes: 5000, tagsChars: 500, tags: 30, tagChars: 60, hashtags: 15 };
let permissionOverride: { status: string; who?: string } | null = null;
export function setPackagingMockPermission(permission: { status: string; who?: string } | null) {
  permissionOverride = permission;
}
const credit = () => {
  if (permissionOverride !== null) {
    if (permissionOverride.status !== 'granted' || !permissionOverride.who?.trim()) return null;
    return `Crédito: vídeo original de ${permissionOverride.who.trim()}.`;
  }
  return flag('packaging-nopermission') ? null : 'Crédito: vídeo original de Canal Exemplo.\nFonte: https://example.com/watch?v=abc';
};
const violation = (code: string) => ({ code: 'edit_invalid', message: 'Edição inválida.', usage: { violations: [{ code }] } });

const DELIM_PT = ['--- Capítulos ---', '--- Fim dos capítulos ---'] as const;
const DELIM_EN = ['--- Chapters ---', '--- End chapters ---'] as const;

function fmtTs(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}

function findDelimiters(text: string): { start: number; end: number; inner: string } | null {
  const lines = text.split('\n');
  let offset = 0;
  let found: { start: number; innerStart: number; endMarker: string } | null = null;
  for (const raw of lines) {
    const trimmed = raw.replace(/\r$/, '');
    if (found) {
      if (trimmed === found.endMarker) {
        return { start: found.start, end: offset + trimmed.length, inner: text.slice(found.innerStart, offset) };
      }
    } else if (trimmed === DELIM_PT[0] || trimmed === DELIM_EN[0]) {
      const endMarker = trimmed === DELIM_PT[0] ? DELIM_PT[1] : DELIM_EN[1];
      found = { start: offset, innerStart: Math.min(text.length, offset + raw.length + 1), endMarker };
    }
    offset += raw.length + 1;
  }
  return null;
}

function parseHms(token: string): number | null {
  const parts = token.split(':');
  if (parts.length === 2) {
    const [mStr, sStr] = parts;
    if (!/^\d{1,3}$/.test(mStr) || !/^\d{2}$/.test(sStr)) return null;
    const m = Number(mStr); const s = Number(sStr);
    return s < 60 ? m * 60 + s : null;
  }
  if (parts.length === 3) {
    const [hStr, mStr, sStr] = parts;
    if (!/^\d{1,2}$/.test(hStr) || !/^\d{2}$/.test(mStr) || !/^\d{2}$/.test(sStr)) return null;
    const h = Number(hStr); const m = Number(mStr); const s = Number(sStr);
    return m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
  }
  return null;
}

function validateDescriptionChapters(description: string): { code: string; message: string }[] {
  const delim = findDelimiters(description);
  const lines = delim
    ? delim.inner.split('\n').map(l => l.trim()).filter(Boolean)
    : description.split('\n').map(l => l.trim()).filter(l => /^\d{1,3}:\d{2}(?::\d{2})?(?:\s|$)/.test(l));
  if (!delim && lines.length === 0) return [];
  const warnings: { code: string; message: string }[] = [];
  const push = (code: string, message: string) => {
    if (!warnings.some(w => w.code === code)) warnings.push({ code, message });
  };
  const secs: number[] = [];
  for (const line of lines) {
    const m = /^(\S+)\s+(.+)$/.exec(line);
    const parsed = m ? parseHms(m[1]) : null;
    if (parsed === null || !m?.[2].trim()) push('invalid_chapter_format', 'Cada linha de capítulo deve ter timestamp (ex.: 00:00) e título.');
    else secs.push(parsed);
  }
  if (secs.length > 0 && secs[0] !== 0) push('first_chapter_not_zero', 'O primeiro capítulo deve começar em 00:00.');
  if (secs.length < 3) push('too_few_chapters', 'O YouTube exige pelo menos 3 capítulos.');
  for (let i = 0; i + 1 < secs.length; i += 1) {
    if (secs[i + 1] < secs[i]) push('chapters_not_ordered', 'Os timestamps dos capítulos devem estar em ordem crescente.');
    else if (secs[i + 1] - secs[i] < 10) push('chapter_too_short', 'Cada capítulo no YouTube precisa durar pelo menos 10 s.');
  }
  return warnings;
}

function resolveChapters(ctx: PackagingMockContext | undefined, lang: string, currentDesc: string | null) {
  const [start, end] = lang === 'en' ? DELIM_EN : DELIM_PT;
  const hasDelimiters = currentDesc ? findDelimiters(currentDesc) !== null : false;
  const editWarnings = currentDesc ? validateDescriptionChapters(currentDesc) : [];
  if (!ctx || ctx.videoKind !== 'transformed') {
    return {
      applicable: false, canGenerate: false, status: 'not_transformed', hasDelimiters,
      delimiters: { start, end }, suggested: [], block: null, generationWarning: null, editWarnings,
    };
  }
  if (!ctx.scriptAllowed || ctx.blocks.length === 0) {
    return {
      applicable: true, canGenerate: false, status: 'script_not_approved', hasDelimiters,
      delimiters: { start, end }, suggested: [], block: null,
      generationWarning: { code: 'script_not_approved', message: 'Aprove todos os blocos do Roteiro e gere a Narração para ter capítulos.' },
      editWarnings,
    };
  }
  if (ctx.blocks.some(b => b.durationUs === null)) {
    return {
      applicable: true, canGenerate: false, status: 'narration_required', hasDelimiters,
      delimiters: { start, end }, suggested: [], block: null,
      generationWarning: { code: 'narration_required', message: 'Gere a Narração para ter capítulos.' },
      editWarnings,
    };
  }
  let cursorUs = 0;
  const items = ctx.blocks.map((b, i) => {
    const startSecs = i === 0 ? 0 : Math.floor(cursorUs / 1_000_000);
    cursorUs += (b.durationUs ?? 0) + 300_000;
    return { startSecs, title: b.title };
  });
  const totalSecs = Math.floor(Math.max(0, cursorUs - 300_000) / 1_000_000);
  while (items.length >= 2) {
    const idx = items.findIndex((it, i) => ((i + 1 < items.length ? items[i + 1].startSecs : totalSecs) - it.startSecs) < 10);
    if (idx === -1) break;
    items.splice(idx === 0 ? 1 : idx, 1);
  }
  if (items.length < 3 || totalSecs < 30) {
    return {
      applicable: true, canGenerate: false, status: 'too_few_chapters', hasDelimiters,
      delimiters: { start, end }, suggested: [], block: null,
      generationWarning: { code: 'too_few_chapters', message: 'O YouTube exige pelo menos 3 capítulos de 10 s cada, começando em 00:00.' },
      editWarnings,
    };
  }
  const suggested = items.map(it => ({ startSecs: it.startSecs, timestamp: fmtTs(it.startSecs), title: it.title }));
  const block = [start, ...suggested.map(s => `${s.timestamp} ${s.title}`), end].join('\n');
  return {
    applicable: true, canGenerate: true, status: 'ready', hasDelimiters,
    delimiters: { start, end }, suggested, block, generationWarning: null, editWarnings,
  };
}

function view(candidate: number, ctx?: PackagingMockContext) {
  const gens = gensByCandidate.get(candidate) ?? [];
  const done = gens.length;
  const last = gens[done - 1];
  const now = last ? (last.edits[last.edits.length - 1] ?? last.generated) : null;
  const text = credit();
  const lang = last?.language ?? 'pt-BR';
  const chapters = resolveChapters(ctx, lang, now?.description ?? null);
  return {
    schemaVersion: 1, revision: gens.reduce((n, g) => n + 1 + g.edits.length, 0),
    detectedLanguage: flag('packaging-language') ? null : 'pt-BR', languageRequired: flag('packaging-language'),
    current: now && last ? { generation: done, language: last.language, edited: last.edits.length > 0, ...now, fullDescription: text ? `${now.description}\n\n${text}` : now.description } : null,
    credit: { text, warning: text ? null : 'no_permission' },
    chapters,
    job: pendingPolls > 0 && pendingCandidate === candidate ? { id: 1, state: 'running', code: null, violations: [] } : null,
    limits, source: 1,
    generations: gens.map((g, i) => ({ generation: i + 1, jobId: i + 1, language: g.language, taskVersion: 2, promptSha256: 'a'.repeat(64), profile: 'legacy', createdAt: '2026-11-15T12:00:00Z', generated: g.generated, edits: g.edits })),
  };
}

/** `undefined` quando o comando não é do empacotamento. */
export function packagingMockDispatch(name: string, args: object, ctx?: PackagingMockContext): unknown {
  const a = args as { candidate?: number; language?: string; confirmed?: boolean } & Partial<Fields>;
  const candidate = a.candidate ?? 1;
  const gens = gensByCandidate.get(candidate) ?? [];
  if (name === 'packaging.estimate') return { paid: flag('packaging-paid'), profile: 'legacy', language: a.language ?? 'pt-BR', estimate: flag('packaging-paid') ? { kind: 'usd', minMicroUsd: 300, maxMicroUsd: 900 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 } };
  if (name === 'packaging.generate') {
    if (flag('packaging-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
    pendingPolls = 2;
    pendingCandidate = candidate;
    return { job: gens.length + 1, language: a.language ?? 'pt-BR' };
  }
  if (name === 'packaging.get') {
    if (pendingPolls > 0 && pendingCandidate === candidate && --pendingPolls === 0) {
      const lang = a.language ?? 'pt-BR';
      const ch = resolveChapters(ctx, lang, null);
      const summary = 'Resumo curto do que acontece no Corte.';
      const description = ch.block ? `${summary}\n\n${ch.block}` : summary;
      gens.push({ language: lang, generated: { title: `Título gerado ${gens.length + 1}`, description, tags: ['corte', 'live'], hashtags: ['#corte', '#live'] }, edits: [] });
      gensByCandidate.set(candidate, gens);
    }
    return view(candidate, ctx);
  }
  if (name === 'packaging.edit') {
    const last = gens[gens.length - 1];
    if (!last) throw { code: 'nothing_to_edit', message: 'Gere o empacotamento antes de editar.' };
    const f: Fields = { title: a.title ?? '', description: a.description ?? '', tags: a.tags ?? [], hashtags: a.hashtags ?? [] };
    if ([...f.title].length > limits.titleChars) throw violation('title_too_long');
    if (f.hashtags.some(h => !/^#[\p{L}\p{N}_]+$/u.test(h))) throw violation('invalid_hashtag');
    last.edits.push(f);
    return view(candidate, ctx);
  }
  if (name === 'packaging.refresh_chapters') {
    const last = gens[gens.length - 1];
    if (!last) throw { code: 'nothing_to_edit', message: 'Gere o empacotamento antes de atualizar capítulos.' };
    const current = last.edits[last.edits.length - 1] ?? last.generated;
    const desc = typeof a.description === 'string' ? a.description : current.description;
    const ch = resolveChapters(ctx, last.language, desc);
    if (!ch.applicable) throw { code: 'chapters_require_transformed', message: 'Capítulos automáticos só existem para Vídeo transformado.' };
    const delim = findDelimiters(desc);
    if (!delim) throw { code: 'chapter_delimiters_missing', message: 'Os delimitadores de capítulos foram removidos da descrição. Nada foi alterado.' };
    if (!ch.block) throw ch.generationWarning ?? { code: 'chapters_unavailable', message: 'Não foi possível gerar capítulos válidos.' };
    const nextDesc = `${desc.slice(0, delim.start)}${ch.block}${desc.slice(delim.end)}`;
    last.edits.push({ ...current, description: nextDesc });
    return view(candidate, ctx);
  }
  return undefined;
}
