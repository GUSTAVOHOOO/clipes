// Lote de Fontes simulado (#56) e orçamentos por escopo (`task` | `batch`, ADR-0009).
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);

type Item = { position: number; sourceId: number; name: string; state: string; error: string | null; progress: number | null; transcriptionJob: number | null; selectionRun: number | null };
type Mock = { id: number; videoKind: string; paused: boolean; cancelled: boolean; cap: number | null; pause: string | null; spent: number; items: Item[] };
let batch: Mock | null = null;

export type BudgetMockEntry = {
  scope: 'task' | 'batch';
  key: string;
  maxCalls: number | null;
  maxTokens: number | null;
  maxWallMs: number | null;
  maxCostMicroUsd: number | null;
  unknownConfirmed: boolean;
  since: number;
  usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    microUsd: number;
    audioMicroUsd: number;
    unknownCostCalls: number;
    planQuotaCalls: number;
    durationMs: number;
    costLabel: string | null;
  };
  paused: string | null;
};

const budgets = new Map<string, BudgetMockEntry>([
  [
    'task:selection',
    {
      scope: 'task',
      key: 'selection',
      maxCalls: 20,
      maxTokens: 100_000,
      maxWallMs: null,
      maxCostMicroUsd: 1_000_000,
      unknownConfirmed: false,
      since: 1794900000000000,
      usage: {
        calls: 8,
        inputTokens: 32_000,
        outputTokens: 10_100,
        microUsd: 420_000,
        audioMicroUsd: 0,
        unknownCostCalls: 0,
        planQuotaCalls: 0,
        durationMs: 12_000,
        costLabel: null,
      },
      paused: null,
    },
  ],
  [
    'batch:sources-3',
    {
      scope: 'batch',
      key: 'sources-3',
      maxCalls: null,
      maxTokens: null,
      maxWallMs: null,
      maxCostMicroUsd: 1_000_000,
      unknownConfirmed: false,
      since: 1794900000000000,
      usage: {
        calls: 4,
        inputTokens: 18_000,
        outputTokens: 2_400,
        microUsd: 0,
        audioMicroUsd: 0,
        unknownCostCalls: 1,
        planQuotaCalls: 0,
        durationMs: 8_000,
        costLabel: 'custo desconhecido',
      },
      paused: 'cost_unknown',
    },
  ],
]);

const names: Record<number, string> = { 1: 'changed.mp4', 2: 'offline.mp4', 3: 'mismatch.mp4' };

function budgetFromBatch(b: Mock): BudgetMockEntry {
  return {
    scope: 'batch',
    key: `sources-${b.id}`,
    maxCalls: null,
    maxTokens: null,
    maxWallMs: null,
    maxCostMicroUsd: b.cap,
    unknownConfirmed: false,
    since: 1794900000000000,
    usage: {
      calls: 4,
      inputTokens: 12_000,
      outputTokens: 1_600,
      microUsd: b.spent,
      audioMicroUsd: 0,
      unknownCostCalls: flag('batch-unknown') ? 1 : 0,
      planQuotaCalls: 0,
      durationMs: 5_000,
      costLabel: flag('batch-unknown') ? 'custo desconhecido' : null,
    },
    paused: b.paused ? 'user' : b.pause,
  };
}

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
    budget: budgetFromBatch(b),
    counts: { total: b.items.length, completed: count('completed'), paused: count('paused'), active: count('transcribing', 'selecting'), pending: count('pending'), cancelled: count('cancelled') },
    items: b.items.map(i => ({ ...i, engine: 'local' })),
  };
}

function parseLimit(val: unknown, current: number | null): number | null {
  if (val === undefined) return current;
  if (val === null) return null;
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
    throw { code: 'invalid_budget', message: 'Orçamento inválido.' };
  }
  return Math.trunc(val);
}

function saveBudget(args: Record<string, unknown>, resume: boolean) {
  const scope = args.scope;
  const key = typeof args.key === 'string' ? args.key.trim() : '';
  if ((scope !== 'task' && scope !== 'batch') || !key || key.length > 80) {
    throw { code: 'invalid_budget', message: 'Orçamento inválido.' };
  }
  const mapKey = `${scope}:${key}`;
  const prev = budgets.get(mapKey) ?? (scope === 'batch' && batch && key === `sources-${batch.id}` ? budgetFromBatch(batch) : null);

  const maxCalls = parseLimit(args.maxCalls, prev?.maxCalls ?? null);
  const maxTokens = parseLimit(args.maxTokens, prev?.maxTokens ?? null);
  const maxWallMs = parseLimit(args.maxWallMs, prev?.maxWallMs ?? null);
  const maxCostMicroUsd = parseLimit(args.maxCostMicroUsd, prev?.maxCostMicroUsd ?? null);
  const confirmed = args.confirmed === true || Boolean(prev?.unknownConfirmed);

  if (resume && prev?.paused === 'cost_unknown' && !confirmed) {
    throw { code: 'confirmation_required', message: 'Confirme que o custo deste lote é desconhecido.', usage: { reason: 'cost_unknown' } };
  }

  const reset = args.resetUsage === true;
  const next: BudgetMockEntry = {
    scope,
    key,
    maxCalls,
    maxTokens,
    maxWallMs,
    maxCostMicroUsd,
    unknownConfirmed: confirmed,
    since: reset ? Date.now() * 1000 : (prev?.since ?? Date.now() * 1000),
    usage: reset || !prev ? { calls: 0, inputTokens: 0, outputTokens: 0, microUsd: 0, audioMicroUsd: 0, unknownCostCalls: 0, planQuotaCalls: 0, durationMs: 0, costLabel: null } : { ...prev.usage },
    paused: resume ? null : (prev?.paused ?? null),
  };

  budgets.set(mapKey, next);

  if (scope === 'batch' && batch && key === `sources-${batch.id}`) {
    batch.cap = maxCostMicroUsd;
    if (resume) batch.pause = null;
  }

  return { budgets: [next] };
}

/** `undefined` quando o comando não é do lote ou orçamento. */
export function batchMockDispatch(name: string, args: object): unknown {
  const a = args as { sourceIds?: number[]; engine?: string; videoKind?: string; confirmed?: boolean; maxCostMicroUsd?: number | null; sourceId?: number; scope?: string };
  if (name === 'jobs.budget.get') {
    const lista = [...budgets.values()];
    if (batch) {
      const bKey = `batch:sources-${batch.id}`;
      if (!budgets.has(bKey)) lista.push(budgetFromBatch(batch));
    }
    return { budgets: lista };
  }
  if (name === 'jobs.budget.set') return saveBudget(args as Record<string, unknown>, false);
  if (name === 'jobs.budget.continue') return saveBudget(args as Record<string, unknown>, true);
  if (name === 'batches.create') {
    if (flag('batch-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória', usage: { selectionPaid: true, transcriptionPaid: a.engine === 'groq', audioEstimateMicroUsd: a.engine === 'groq' ? 12000 : null, profile: 'legacy', maxCostMicroUsd: a.maxCostMicroUsd ?? null, sources: a.sourceIds?.length ?? 0 } };
    const ids = a.sourceIds ?? [];
    batch = {
      id: 1, videoKind: a.videoKind ?? 'direct', paused: false, cancelled: false, cap: a.maxCostMicroUsd ?? null, pause: flag('batch-unknown') ? 'cost_unknown' : null, spent: 1200,
      items: ids.map((sourceId, position) => ({ position, sourceId, name: names[sourceId] ?? `live-${sourceId}.mp4`, state: position === 0 ? 'completed' : position === 1 ? 'paused' : 'selecting', error: position === 1 ? 'provider_http' : null, progress: position === 2 ? 40 : null, transcriptionJob: null, selectionRun: position + 1 })),
    };
    budgets.set(`batch:sources-${batch.id}`, budgetFromBatch(batch));
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
  return undefined;
}
