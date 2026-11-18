// Lote de Fontes simulado (#56) e orçamentos por escopo (`task` | `batch`, ADR-0009).
const flag = (name: string) => {
  if (typeof location === 'undefined') return false;
  if (new URLSearchParams(location.search).has(name)) return true;
  const hash = location.hash ?? '';
  const qIdx = hash.indexOf('?');
  return qIdx >= 0 && new URLSearchParams(hash.slice(qIdx + 1)).has(name);
};

export type BatchProgressEmitter = (evento: {
  job: string;
  project?: string | null;
  stage: string;
  percentage: number;
  message: string;
  error: { code: string; message: string } | null;
}) => void;

type Item = {
  position: number;
  sourceId: number;
  name: string;
  state: string;
  error: string | null;
  resetAtMs: number | null;
  progress: number | null;
  transcriptionJob: number | null;
  selectionRun: number | null;
};

type Mock = {
  id: number;
  engine: string;
  videoKind: string;
  minUs: number | null;
  maxUs: number | null;
  paused: boolean;
  cancelled: boolean;
  cap: number | null;
  pause: string | null;
  spent: number;
  items: Item[];
};

let nextBatchId = 1;
const batchesList: Mock[] = [];

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

const names: Record<number, string> = {
  1: 'changed.mp4',
  2: 'offline.mp4',
  3: 'mismatch.mp4',
  4: 'Live_12_11_final.mp4',
};

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
  const count = (...states: string[]) => b.items.filter((i) => states.includes(i.state)).length;
  const status = b.cancelled
    ? 'cancelled'
    : count('completed', 'cancelled') === b.items.length
      ? 'completed'
      : b.paused
        ? 'paused'
        : b.pause
          ? 'budget_paused'
          : count('transcribing', 'selecting', 'pending') === 0
            ? 'attention'
            : 'running';
  return {
    id: b.id,
    key: `sources-${b.id}`,
    state: b.cancelled ? 'cancelled' : b.paused ? 'paused' : status === 'completed' ? 'completed' : 'running',
    status,
    engine: b.engine,
    videoKind: b.videoKind,
    minUs: b.minUs,
    maxUs: b.maxUs,
    pause: b.paused ? 'user' : b.pause,
    budget: budgets.get(`batch:sources-${b.id}`) ?? budgetFromBatch(b),
    counts: {
      total: b.items.length,
      completed: count('completed'),
      paused: count('paused'),
      active: count('transcribing', 'selecting'),
      pending: count('pending'),
      cancelled: count('cancelled'),
    },
    items: b.items.map((i) => ({ ...i, engine: b.engine })),
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
  const matchingBatch = scope === 'batch' ? batchesList.find((b) => `sources-${b.id}` === key) : undefined;
  const prev = budgets.get(mapKey) ?? (matchingBatch ? budgetFromBatch(matchingBatch) : null);

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
    usage:
      reset || !prev
        ? { calls: 0, inputTokens: 0, outputTokens: 0, microUsd: 0, audioMicroUsd: 0, unknownCostCalls: 0, planQuotaCalls: 0, durationMs: 0, costLabel: null }
        : { ...prev.usage },
    paused: resume ? null : (prev?.paused ?? null),
  };

  budgets.set(mapKey, next);

  if (matchingBatch) {
    matchingBatch.cap = maxCostMicroUsd;
    if (resume) matchingBatch.pause = null;
  }

  return { budgets: [next] };
}

function findBatch(id?: number): Mock | undefined {
  if (typeof id === 'number') return batchesList.find((b) => b.id === id);
  return batchesList[batchesList.length - 1];
}

/** `undefined` quando o comando não é do lote ou orçamento. */
export function batchMockDispatch(
  name: string,
  args: object,
  emitProgress?: BatchProgressEmitter,
  projectId: string | null = 'test-project',
  sourceNames?: Record<number, string>,
): unknown {
  const a = args as {
    id?: number;
    sourceIds?: number[];
    engine?: string;
    videoKind?: string;
    minUs?: number | null;
    maxUs?: number | null;
    confirmed?: boolean;
    maxCostMicroUsd?: number | null;
    sourceId?: number;
    scope?: string;
  };
  if (name === 'jobs.budget.get') {
    const lista = [...budgets.values()];
    for (const b of batchesList) {
      const bKey = `batch:sources-${b.id}`;
      if (!budgets.has(bKey)) lista.push(budgetFromBatch(b));
    }
    return { budgets: lista };
  }
  if (name === 'jobs.budget.set') return saveBudget(args as Record<string, unknown>, false);
  if (name === 'jobs.budget.continue') return saveBudget(args as Record<string, unknown>, true);

  const emit = (
    b: Mock,
    stage: string,
    message: string,
    error: { code: string; message: string } | null = null,
  ) => {
    const done = b.items.filter((i) => i.state === 'completed' || i.state === 'cancelled').length;
    const pct = b.items.length > 0 ? Math.round((done / b.items.length) * 100) : 0;
    emitProgress?.({
      job: `batch-${b.id}`,
      project: projectId,
      stage,
      percentage: pct,
      message,
      error,
    });
  };

  if (name === 'batches.create') {
    const uniqueIds = [...new Set(a.sourceIds ?? [])];
    if (uniqueIds.length === 0 || uniqueIds.length > 500) {
      throw { code: 'invalid_batch', message: 'Selecione entre 1 e 500 Fontes.' };
    }
    if (a.engine && a.engine !== 'local' && a.engine !== 'groq') {
      throw { code: 'invalid_engine', message: 'Motor de transcrição inválido.' };
    }
    if (a.videoKind && a.videoKind !== 'direct' && a.videoKind !== 'transformed') {
      throw { code: 'invalid_video_kind', message: 'Tipo de vídeo inválido.' };
    }
    if (
      (a.minUs !== undefined && a.minUs !== null && a.minUs <= 0) ||
      (a.maxUs !== undefined && a.maxUs !== null && a.minUs !== undefined && a.minUs !== null && a.maxUs <= a.minUs)
    ) {
      throw { code: 'invalid_batch', message: 'Faixa de duração inválida.' };
    }
    if (a.maxCostMicroUsd !== undefined && a.maxCostMicroUsd !== null && (!Number.isFinite(a.maxCostMicroUsd) || a.maxCostMicroUsd < 0)) {
      throw { code: 'invalid_budget', message: 'Orçamento inválido.' };
    }
    const engine = a.engine ?? 'local';
    if ((flag('batch-paid') || engine === 'groq') && !a.confirmed) {
      throw {
        code: 'confirmation_required',
        message: 'confirmação obrigatória',
        usage: {
          selectionPaid: flag('batch-paid'),
          transcriptionPaid: engine === 'groq',
          audioEstimateMicroUsd: engine === 'groq' ? 12000 : null,
          profile: 'legacy',
          maxCostMicroUsd: a.maxCostMicroUsd ?? null,
          sources: uniqueIds.length,
        },
      };
    }

    const id = nextBatchId++;
    const items: Item[] = uniqueIds.map((sourceId, position) => {
      const resolvedName = sourceNames?.[sourceId] ?? names[sourceId] ?? `live-${sourceId}.mp4`;
      if (position === 0) {
        return {
          position,
          sourceId,
          name: resolvedName,
          state: 'completed',
          error: null,
          resetAtMs: null,
          progress: 100,
          transcriptionJob: null,
          selectionRun: position + 1,
        };
      }
      if (position === 1) {
        return {
          position,
          sourceId,
          name: resolvedName,
          state: 'paused',
          error: flag('batch-uncertain') ? 'timeout_uncertain' : 'provider_http',
          resetAtMs: null,
          progress: null,
          transcriptionJob: null,
          selectionRun: position + 1,
        };
      }
      if (position === 2) {
        return {
          position,
          sourceId,
          name: resolvedName,
          state: 'selecting',
          error: null,
          resetAtMs: null,
          progress: 40,
          transcriptionJob: null,
          selectionRun: position + 1,
        };
      }
      if (position === 3) {
        return {
          position,
          sourceId,
          name: resolvedName,
          state: 'paused',
          error: 'timeout_uncertain',
          resetAtMs: null,
          progress: null,
          transcriptionJob: 200 + position,
          selectionRun: position + 1,
        };
      }
      return {
        position,
        sourceId,
        name: resolvedName,
        state: 'pending',
        error: null,
        resetAtMs: null,
        progress: 0,
        transcriptionJob: null,
        selectionRun: null,
      };
    });

    const created: Mock = {
      id,
      engine,
      videoKind: a.videoKind ?? 'direct',
      minUs: a.minUs ?? null,
      maxUs: a.maxUs ?? null,
      paused: false,
      cancelled: false,
      cap: a.maxCostMicroUsd ?? null,
      pause: flag('batch-unknown') ? 'cost_unknown' : null,
      spent: 1200,
      items,
    };
    batchesList.push(created);
    budgets.set(`batch:sources-${created.id}`, budgetFromBatch(created));

    emit(created, 'batch:created', 'Lote de Fontes criado');
    emit(created, 'batch:item', 'Item do lote atualizado');
    const pausedItem = items.find((i) => i.state === 'paused');
    if (pausedItem && pausedItem.error) {
      emit(created, 'batch:item-paused', 'Item pausado no lote', {
        code: pausedItem.error,
        message: pausedItem.error,
      });
    }
    if (items.every((i) => i.state === 'completed' || i.state === 'cancelled')) {
      emit(created, 'batch:completed', 'Lote concluído');
    }

    return view(created);
  }
  if (name === 'batches.list') return [...batchesList].reverse().map(view);
  if (name === 'batches.get') {
    const b = findBatch(a.id);
    if (!b) throw { code: 'batch_not_found', message: 'Lote não encontrado.' };
    return view(b);
  }
  if (name === 'batches.pause') {
    const b = findBatch(a.id);
    if (!b) throw { code: 'batch_not_found', message: 'Lote não encontrado.' };
    if (b.cancelled) throw { code: 'invalid_batch_state', message: 'Lote já cancelado.' };
    b.paused = true;
    const budget = budgets.get(`batch:sources-${b.id}`) ?? budgetFromBatch(b);
    budget.paused = 'user';
    budgets.set(`batch:sources-${b.id}`, budget);
    emit(b, 'batch:paused', 'Lote pausado');
    return view(b);
  }
  if (name === 'batches.resume') {
    const b = findBatch(a.id);
    if (!b) throw { code: 'batch_not_found', message: 'Lote não encontrado.' };
    if (b.cancelled) throw { code: 'invalid_batch_state', message: 'Lote já cancelado.' };
    b.paused = false;
    const budget = budgets.get(`batch:sources-${b.id}`) ?? budgetFromBatch(b);
    budget.paused = b.pause;
    budgets.set(`batch:sources-${b.id}`, budget);
    emit(b, 'batch:resumed', 'Lote retomado');
    return view(b);
  }
  if (name === 'batches.cancel') {
    const b = findBatch(a.id);
    if (!b) throw { code: 'batch_not_found', message: 'Lote não encontrado.' };
    b.cancelled = true;
    b.items = b.items.map((i) => (i.state === 'completed' ? i : { ...i, state: 'cancelled' }));
    emit(b, 'batch:cancelled', 'Lote cancelado');
    return view(b);
  }
  if (name === 'batches.item.resume') {
    const b = findBatch(a.id);
    if (!b) throw { code: 'batch_not_found', message: 'Lote não encontrado.' };
    if (b.cancelled) throw { code: 'invalid_batch_state', message: 'Lote já cancelado.' };
    const item = b.items.find((i) => i.sourceId === a.sourceId);
    if (!item) throw { code: 'source_missing', message: 'Fonte não encontrada no lote.' };
    if (item.state !== 'paused') throw { code: 'invalid_item_state', message: 'Item não está pausado.' };
    if (item.error === 'timeout_uncertain') throw { code: 'uncertain_job', message: 'incerto' };
    if ((flag('batch-paid') || b.engine === 'groq') && !a.confirmed) {
      throw {
        code: 'confirmation_required',
        message: 'confirmação obrigatória',
        usage: { estimate: { kind: 'usd', minMicroUsd: 1200, maxMicroUsd: 5400 } },
      };
    }
    item.state = 'selecting';
    item.error = null;
    item.progress = 10;
    emit(b, 'batch:item', 'Item retomado');
    if (b.items.every((i) => i.state === 'completed' || i.state === 'cancelled')) {
      emit(b, 'batch:completed', 'Lote concluído');
    }
    return view(b);
  }
  return undefined;
}
