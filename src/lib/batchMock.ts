// Lote de Fontes simulado (#56) para `?source-test=1&batch-test=1`. `batch-paid` pede a confirmação
// de custo na criação; `batch-unknown` deixa o lote parado por custo desconhecido.
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);

type Item = { position: number; sourceId: number; name: string; state: string; error: string | null; progress: number | null; transcriptionJob: number | null; selectionRun: number | null };
type Mock = { id: number; videoKind: string; paused: boolean; cancelled: boolean; cap: number | null; pause: string | null; spent: number; items: Item[] };
let batch: Mock | null = null;

const names: Record<number, string> = { 1: 'changed.mp4', 2: 'offline.mp4', 3: 'mismatch.mp4' };

function view(b: Mock) {
  const count = (...states: string[]) => b.items.filter(i => states.includes(i.state)).length;
  const status = b.cancelled ? 'cancelled'
    : count('completed', 'cancelled') === b.items.length ? 'completed'
    : b.paused ? 'paused'
    : b.pause ? 'budget_paused'
    : count('transcribing', 'selecting', 'pending') === 0 ? 'attention' : 'running';
  return {
    id: b.id, key: `sources-${b.id}`, state: b.cancelled ? 'cancelled' : b.paused ? 'paused' : 'running', status, engine: 'local', videoKind: b.videoKind, minUs: null, maxUs: null,
    pause: b.paused ? 'user' : b.pause,
    budget: { scope: 'batch', key: `sources-${b.id}`, maxCostMicroUsd: b.cap, unknownConfirmed: false, paused: b.paused ? 'user' : b.pause, usage: { microUsd: b.spent, audioMicroUsd: 0, calls: 4, costLabel: flag('batch-unknown') ? 'custo desconhecido' : null } },
    counts: { total: b.items.length, completed: count('completed'), paused: count('paused'), active: count('transcribing', 'selecting'), pending: count('pending'), cancelled: count('cancelled') },
    items: b.items.map(i => ({ ...i, engine: 'local' })),
  };
}

/** `undefined` quando o comando não é do lote. */
export function batchMockDispatch(name: string, args: object): unknown {
  const a = args as { sourceIds?: number[]; engine?: string; videoKind?: string; confirmed?: boolean; maxCostMicroUsd?: number | null; sourceId?: number; scope?: string };
  if (name === 'batches.create') {
    if (flag('batch-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória', usage: { selectionPaid: true, transcriptionPaid: a.engine === 'groq', audioEstimateMicroUsd: a.engine === 'groq' ? 12000 : null, profile: 'legacy', maxCostMicroUsd: a.maxCostMicroUsd ?? null, sources: a.sourceIds?.length ?? 0 } };
    const ids = a.sourceIds ?? [];
    batch = {
      id: 1, videoKind: a.videoKind ?? 'direct', paused: false, cancelled: false, cap: a.maxCostMicroUsd ?? null, pause: flag('batch-unknown') ? 'cost_unknown' : null, spent: 1200,
      items: ids.map((sourceId, position) => ({ position, sourceId, name: names[sourceId] ?? `live-${sourceId}.mp4`, state: position === 0 ? 'completed' : position === 1 ? 'paused' : 'selecting', error: position === 1 ? 'provider_http' : null, progress: position === 2 ? 40 : null, transcriptionJob: null, selectionRun: position + 1 })),
    };
    return view(batch);
  }
  if (name === 'batches.list') return batch ? [view(batch)] : [];
  if (name === 'batches.get') return view(batch!);
  if (name === 'batches.pause' && batch) { batch.paused = true; return view(batch); }
  if (name === 'batches.resume' && batch) { batch.paused = false; return view(batch); }
  if (name === 'batches.cancel' && batch) { batch.cancelled = true; batch.items = batch.items.map(i => i.state === 'completed' ? i : { ...i, state: 'cancelled' }); return view(batch); }
  if (name === 'batches.item.resume' && batch) {
    const item = batch.items.find(i => i.sourceId === a.sourceId);
    if (item?.error === 'timeout_uncertain') throw { code: 'uncertain_job', message: 'incerto' };
    if (flag('batch-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória', usage: { estimate: { kind: 'usd', minMicroUsd: 1200, maxMicroUsd: 5400 } } };
    if (item) { item.state = 'selecting'; item.error = null; item.progress = 10; }
    return view(batch);
  }
  if (name === 'jobs.budget.set' && batch && a.scope === 'batch') { batch.cap = a.maxCostMicroUsd ?? null; return view(batch).budget; }
  if (name === 'jobs.budget.continue' && batch && a.scope === 'batch') {
    if (batch.pause === 'cost_unknown' && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória', usage: { reason: 'cost_unknown' } };
    if ('maxCostMicroUsd' in a) batch.cap = a.maxCostMicroUsd ?? null;
    batch.pause = null;
    return view(batch).budget;
  }
  return undefined;
}
