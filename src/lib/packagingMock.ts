// Empacotamento simulado (#68). `?packaging-paid` pede a confirmação de custo; `?packaging-nopermission`
// tira o crédito; `?packaging-language` deixa o idioma do Corte indefinido.
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);
type Fields = { title: string; description: string; tags: string[]; hashtags: string[] };
type Gen = { language: string; generated: Fields; edits: Fields[] };
const gens: Gen[] = [];
let pendingPolls = 0;
const limits = { titleChars: 100, descriptionBytes: 5000, tagsChars: 500, tags: 30, tagChars: 60, hashtags: 15 };
const credit = () => flag('packaging-nopermission') ? null : 'Crédito: vídeo original de Canal Exemplo.\nFonte: https://example.com/watch?v=abc';
const violation = (code: string) => ({ code, message: 'Edição inválida.', usage: { violations: [{ code }] } });

function view() {
  const done = gens.length;
  const last = gens[done - 1];
  const now = last ? (last.edits[last.edits.length - 1] ?? last.generated) : null;
  const text = credit();
  return {
    schemaVersion: 1, revision: gens.reduce((n, g) => n + 1 + g.edits.length, 0),
    detectedLanguage: flag('packaging-language') ? null : 'pt-BR', languageRequired: flag('packaging-language'),
    current: now && last ? { generation: done, language: last.language, edited: last.edits.length > 0, ...now, fullDescription: text ? `${now.description}\n\n${text}` : now.description } : null,
    credit: { text, warning: text ? null : 'no_permission' },
    job: pendingPolls > 0 ? { id: 1, state: 'running', code: null, violations: [] } : null,
    limits, source: 1,
    generations: gens.map((g, i) => ({ generation: i + 1, jobId: i + 1, language: g.language, taskVersion: 1, promptSha256: 'a'.repeat(64), profile: 'legacy', createdAt: '2026-11-15T12:00:00Z', generated: g.generated, edits: g.edits })),
  };
}

/** `undefined` quando o comando não é do empacotamento. */
export function packagingMockDispatch(name: string, args: object): unknown {
  const a = args as { language?: string; confirmed?: boolean } & Partial<Fields>;
  if (name === 'packaging.estimate') return { paid: flag('packaging-paid'), profile: 'legacy', language: a.language ?? 'pt-BR', estimate: flag('packaging-paid') ? { kind: 'usd', minMicroUsd: 300, maxMicroUsd: 900 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 } };
  if (name === 'packaging.generate') {
    if (flag('packaging-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
    pendingPolls = 2;
    return { job: gens.length + 1, language: a.language ?? 'pt-BR' };
  }
  if (name === 'packaging.get') {
    if (pendingPolls > 0 && --pendingPolls === 0) gens.push({ language: a.language ?? 'pt-BR', generated: { title: `Título gerado ${gens.length + 1}`, description: 'Resumo curto do que acontece no Corte.', tags: ['corte', 'live'], hashtags: ['#corte', '#live'] }, edits: [] });
    return view();
  }
  if (name === 'packaging.edit') {
    const last = gens[gens.length - 1];
    if (!last) throw { code: 'nothing_to_edit', message: 'Gere o empacotamento antes de editar.' };
    const f: Fields = { title: a.title ?? '', description: a.description ?? '', tags: a.tags ?? [], hashtags: a.hashtags ?? [] };
    if ([...f.title].length > limits.titleChars) throw violation('title_too_long');
    if (f.hashtags.some(h => !/^#[\p{L}\p{N}_]+$/u.test(h))) throw violation('invalid_hashtag');
    last.edits.push(f);
    return view();
  }
  return undefined;
}
