// Capa simulada (#74). `?thumbnail-paid` pede a confirmação de custo; `?thumbnail-offline` faz o export falhar com Fonte offline.
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);
type Choice = { id: number; instantUs: number; origin: 'provider' | 'user'; suggestionId: number | null; createdAt: string };
type Suggestion = { id: number; jobId: number; sentenceId: number; instantUs: number; why: string; taskVersion: number; promptSha256: string; profile: string; createdAt: string };
const cut = { startUs: 60_000_000, endUs: 120_000_000 };
const suggestions: Suggestion[] = [];
const choices: Choice[] = [];
let pendingPolls = 0;

function view() {
  const last = choices[choices.length - 1] ?? null;
  const why = last?.suggestionId ? suggestions.find(s => s.id === last.suggestionId)?.why ?? null : null;
  return {
    schemaVersion: 1, candidate: { run: 1, startId: 1, endId: 2 }, source: 1, cut,
    current: last ? { ...last, why } : null,
    job: pendingPolls > 0 ? { id: suggestions.length + 1, state: 'running', code: null, violations: [] } : null,
    suggestions, choices, maxWhyChars: 200,
  };
}

/** `undefined` quando o comando não é da capa. */
export function thumbnailMockDispatch(name: string, args: object): unknown {
  const a = args as { confirmed?: boolean; instant_us?: number; output?: string };
  if (name === 'thumbnail.estimate') return { paid: flag('thumbnail-paid'), profile: 'legacy', estimate: flag('thumbnail-paid') ? { kind: 'usd', minMicroUsd: 100, maxMicroUsd: 300 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 } };
  if (name === 'thumbnail.suggest') {
    if (flag('thumbnail-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
    pendingPolls = 2;
    return { job: suggestions.length + 1 };
  }
  if (name === 'thumbnail.get') {
    if (pendingPolls > 0 && --pendingPolls === 0) {
      const id = suggestions.length + 1;
      const instantUs = cut.startUs + 5_000_000 * id;
      suggestions.push({ id, jobId: id, sentenceId: 10 + id, instantUs, why: 'O momento de maior impacto do Corte.', taskVersion: 1, promptSha256: 'a'.repeat(64), profile: 'legacy', createdAt: '2026-11-15T12:00:00Z' });
      choices.push({ id: choices.length + 1, instantUs, origin: 'provider', suggestionId: id, createdAt: '2026-11-15T12:00:00Z' });
    }
    return view();
  }
  if (name === 'thumbnail.choose') {
    const us = a.instant_us ?? -1;
    if (us < cut.startUs || us > cut.endUs) throw { code: 'instant_out_of_cut', message: 'fora do Corte' };
    if (choices[choices.length - 1]?.instantUs !== us) choices.push({ id: choices.length + 1, instantUs: us, origin: 'user', suggestionId: null, createdAt: '2026-11-15T12:01:00Z' });
    return view();
  }
  if (name === 'thumbnail.export') {
    if (flag('thumbnail-offline')) throw { code: 'source_offline', message: 'Fonte offline' };
    return { output: a.output, instantUs: choices[choices.length - 1]?.instantUs };
  }
  return undefined;
}
