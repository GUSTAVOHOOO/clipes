// Tradução de legenda simulada (#75) para VITE_CORE_MOCK + editor-test.
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);

type TranslatedLine = { id: number; startUs: number; endUs: number; originalText: string; translatedText: string | null; edited: boolean };
type ClipTranslationState = {
  activeTrack: 'original' | 'translated';
  targetLanguage: 'pt-BR' | 'en' | null;
  pendingPolls: number;
  runId: number;
  lines: Map<number, { text: string; edited: boolean }>;
  sentenceRange: [number, number];
};

const clips = new Map<number, ClipTranslationState>();
type MockPermission = { status: string; who?: string; where?: string; scope?: string };
const permissionOverrides = new Map<number, MockPermission>();

export function setTranslationMockPermission(sourceId: number, permission: MockPermission) {
  permissionOverrides.set(sourceId, permission);
}

function hasTranslationScope(scope?: string): boolean {
  if (!scope) return false;
  return scope
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[,\s]+/)
    .map(tok => tok.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .some(tok => tok === 'traducao' || tok === 'translation');
}

function permissionStateOf(sourceId: number): { permitted: boolean; permissionError: { code: string; message: string } | null } {
  const override = permissionOverrides.get(sourceId);
  if (override) {
    if (override.status !== 'granted') {
      return {
        permitted: false,
        permissionError: {
          code: 'translation_permission_required',
          message: 'Esta Fonte não tem Permissão registrada com escopo “tradução”. Registre a Permissão antes de traduzir.',
        },
      };
    }
    if (!hasTranslationScope(override.scope)) {
      return {
        permitted: false,
        permissionError: {
          code: 'translation_permission_required',
          message: 'A Permissão desta Fonte não inclui o escopo “tradução”. Atualize a Permissão da Fonte para incluir tradução.',
        },
      };
    }
    return { permitted: true, permissionError: null };
  }
  const permitted = !flag('translation-nopermission');
  return {
    permitted,
    permissionError: permitted ? null : { code: 'translation_permission_required', message: 'A Permissão desta Fonte não inclui o escopo “tradução”.' },
  };
}

function stateOf(clipId: number): ClipTranslationState {
  let st = clips.get(clipId);
  if (!st) {
    st = { activeTrack: 'original', targetLanguage: null, pendingPolls: 0, runId: 0, lines: new Map(), sentenceRange: [1, 3] };
    clips.set(clipId, st);
  }
  return st;
}

export function getMockActiveTranslation(clipId: number): { activeTrack: 'original' | 'translated'; lines: { id: number; text: string }[] } | null {
  const st = clips.get(clipId);
  if (!st || st.activeTrack !== 'translated' || st.lines.size === 0) return null;
  return {
    activeTrack: st.activeTrack,
    lines: [...st.lines.entries()].sort((a, b) => a[0] - b[0]).map(([id, v]) => ({ id, text: v.text })),
  };
}

function buildDoc(clipId: number) {
  const st = stateOf(clipId);
  if (st.pendingPolls > 0 && --st.pendingPolls === 0) {
    for (let id = st.sentenceRange[0]; id <= st.sentenceRange[1]; id++) {
      st.lines.set(id, { text: st.targetLanguage === 'pt-BR' ? `Frase traduzida ${id}` : `Translated sentence ${id}`, edited: false });
    }
  }
  const { permitted, permissionError } = permissionStateOf(1);
  const languageRequired = flag('translation-language');
  const detectedLanguage = languageRequired ? null : 'pt-BR';
  const sentences: TranslatedLine[] = [];
  for (let id = st.sentenceRange[0]; id <= st.sentenceRange[1]; id++) {
    const entry = st.lines.get(id);
    sentences.push({
      id,
      startUs: (id - 1) * 10_000_000,
      endUs: id * 10_000_000,
      originalText: `Frase ${id} original`,
      translatedText: entry?.text ?? null,
      edited: entry?.edited ?? false,
    });
  }
  const hasTranslation = sentences.some(s => s.translatedText !== null);
  const run = st.runId > 0 ? {
    id: st.runId,
    state: st.pendingPolls > 0 ? 'running' : 'completed',
    sourceLanguage: detectedLanguage ?? 'pt-BR',
    targetLanguage: st.targetLanguage ?? 'en',
    taskVersion: 1,
    promptSha256: 'a'.repeat(64),
    profile: 'legacy',
    batchesTotal: 1,
    batchesCompleted: st.pendingPolls > 0 ? 0 : 1,
    batchesFailed: 0,
    createdAt: '2026-11-16T12:00:00Z',
    jobs: [{ id: st.runId, batchIndex: 0, state: st.pendingPolls > 0 ? 'running' : 'completed', code: null, violations: [] }],
  } : null;
  return {
    schemaVersion: 1,
    clipId,
    sourceId: 1,
    transcriptId: 1,
    permitted,
    permissionError,
    detectedLanguage,
    languageRequired,
    defaultTargetLanguage: detectedLanguage ? 'en' : null,
    activeTrack: st.activeTrack,
    targetLanguage: st.targetLanguage,
    hasTranslation,
    missingSentenceIds: [],
    sentences,
    run,
  };
}

/** `undefined` quando o comando não é de tradução. */
export function translationMockDispatch(name: string, args: object): unknown {
  if (!name.startsWith('translation.')) return undefined;
  const a = args as { clip_id?: number; target_language?: string; source_language?: string; confirmed?: boolean; track?: string; sentence_id?: number; text?: string };
  const clipId = a.clip_id ?? 1;
  const st = stateOf(clipId);
  if (name === 'translation.get') return buildDoc(clipId);
  if (name === 'translation.estimate') {
    const perm = permissionStateOf(1);
    if (!perm.permitted) throw perm.permissionError;
    const targetLanguage = a.target_language ?? (flag('translation-language') ? undefined : 'en');
    if (!targetLanguage) throw { code: 'language_required', message: 'O idioma do Corte não é claro. Escolha o idioma de destino: PT-BR ou EN.' };
    return {
      paid: flag('translation-paid'),
      profile: 'legacy',
      sourceLanguage: a.source_language ?? (targetLanguage === 'en' ? 'pt-BR' : 'en'),
      targetLanguage,
      batches: 1,
      sentenceCount: st.sentenceRange[1] - st.sentenceRange[0] + 1,
      contextTokens: 32768,
      estimate: flag('translation-paid') ? { kind: 'usd', minMicroUsd: 200, maxMicroUsd: 600 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 },
    };
  }
  if (name === 'translation.start') {
    const perm = permissionStateOf(1);
    if (!perm.permitted) throw perm.permissionError;
    const targetLanguage = (a.target_language ?? (flag('translation-language') ? undefined : 'en')) as 'pt-BR' | 'en' | undefined;
    if (!targetLanguage) throw { code: 'language_required', message: 'O idioma do Corte não é claro. Escolha o idioma de destino: PT-BR ou EN.' };
    if (flag('translation-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'Esta tradução usa um Provedor pago.' };
    st.targetLanguage = targetLanguage;
    st.runId += 1;
    st.pendingPolls = 1;
    return { run: st.runId, jobs: [st.runId], batches: 1, sourceLanguage: targetLanguage === 'en' ? 'pt-BR' : 'en', targetLanguage };
  }
  if (name === 'translation.track.set') {
    const track = a.track === 'translated' ? 'translated' : 'original';
    if (track === 'translated' && st.lines.size === 0) throw { code: 'translation_missing', message: 'Gere uma legenda traduzida antes de selecioná-la.' };
    st.activeTrack = track;
    return buildDoc(clipId);
  }
  if (name === 'translation.edit') {
    const text = (a.text ?? '').normalize('NFC').trim();
    if (!text) throw { code: 'translation_empty', message: 'O texto da legenda traduzida não pode ficar vazio.' };
    if (!a.sentence_id || !st.lines.has(a.sentence_id)) throw { code: 'translation_missing', message: 'Frase traduzida não encontrada neste Corte.' };
    st.lines.set(a.sentence_id, { text, edited: true });
    return buildDoc(clipId);
  }
  return undefined;
}
