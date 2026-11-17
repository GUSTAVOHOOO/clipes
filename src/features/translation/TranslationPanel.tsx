import { useCallback, useContext, useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText, type Language } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SOURCE_PERMISSION_UPDATED_EVENT } from '@/features/projects/Sources';
import { clock, fill } from '@/features/projects/selectionFormat';

type SentenceLine = {
  id: number;
  startUs: number;
  endUs: number;
  originalText: string;
  translatedText: string | null;
  edited: boolean;
};

type RunJob = { id: number; batchIndex: number; state: string; code: string | null; violations: string[] };
type TranslationRun = {
  id: number;
  state: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  sourceLanguage: string;
  targetLanguage: string;
  taskVersion: number;
  promptSha256: string;
  profile: string;
  batchesTotal: number;
  batchesCompleted: number;
  batchesFailed: number;
  jobs: RunJob[];
};

type TranslationDoc = {
  schemaVersion: 1;
  clipId: number;
  sourceId: number;
  permitted: boolean;
  permissionError: { code: string; message: string } | null;
  detectedLanguage: string | null;
  languageRequired: boolean;
  defaultTargetLanguage: string | null;
  activeTrack: 'original' | 'translated';
  targetLanguage: string | null;
  hasTranslation: boolean;
  missingSentenceIds: number[];
  sentences: SentenceLine[];
  run: TranslationRun | null;
};

type Estimate = {
  paid: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  batches: number;
  sentenceCount: number;
  estimate: { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null };
};

const texts = {
  'pt-BR': {
    loading: 'Carregando tradução…',
    loadError: 'Não foi possível carregar a tradução.',
    retry: 'Tentar de novo',
    permissionBlocked: 'Tradução bloqueada pela Permissão',
    permissionHint: 'A tradução só pode ser gerada quando a Permissão da Fonte inclui o escopo “tradução”. A Transcrição original nunca é alterada.',
    directionAuto: 'Idioma detectado: {from} → traduzir para {to}',
    targetLanguage: 'Idioma de destino',
    targetHint: 'O idioma deste Corte não é claro. Escolha PT-BR ou EN.',
    translate: 'Traduzir legenda',
    retranslate: 'Traduzir de novo',
    translating: 'Traduzindo…',
    trackLabel: 'Legenda usada no preview e no export',
    trackOriginal: 'Original',
    trackTranslated: 'Traduzida ({lang})',
    trackTranslatedEmpty: 'Traduzida',
    linesTitle: 'Frases do Corte',
    linesHint: 'A edição muda apenas a legenda traduzida e mantém os tempos da Frase. A Transcrição original não muda.',
    originalLabel: 'Original',
    translatedLabel: 'Tradução',
    saveLine: 'Salvar',
    edited: 'Editada',
    saved: 'Tradução salva.',
    missingNotice: '{count} Frase(s) deste Corte ainda não têm tradução; traduza de novo para cobrir todas.',
    runStatus: 'Lote {done}/{total} · Tarefa v{task} · perfil {profile}',
    free: 'sem custo (modelo local)',
    unknown: 'custo desconhecido',
    quota: 'consome a cota do plano',
    range: 'entre US$ {min} e US$ {max}',
    confirmTitle: 'Usar o Provedor pago?',
    confirmBody: 'O texto das Frases do Corte vai ao Provedor escolhido ({batches} lote(s)). Custo estimado: {cost}.',
    cancel: 'Cancelar',
    confirm: 'Confirmar e traduzir',
    failed: 'Não foi possível concluir a tradução: {reason}',
    reasons: {
      language_mismatch: 'a resposta não veio no idioma pedido.',
      verification_failed: 'a tradução falhou na validação de IDs, linhas, números ou URLs.',
      cancelled: 'a tradução foi cancelada.',
      timeout_uncertain: 'o resultado ficou incerto.',
      local_only_violation: 'o modo “somente local” impede este Provedor.',
      context_too_small: 'o contexto do Perfil de Provedor é pequeno demais.',
      default: 'o Provedor não devolveu uma tradução válida.',
    } as Record<string, string>,
    errors: {
      translation_permission_required: 'A Permissão desta Fonte não inclui o escopo “tradução”.',
      language_required: 'Escolha o idioma de destino: PT-BR ou EN.',
      translation_in_progress: 'Já há uma tradução em andamento para este Corte.',
      local_only_violation: 'O modo “somente local” impede este Provedor.',
      context_too_small: 'O contexto do Perfil de Provedor é pequeno demais para estas Frases.',
      translation_empty: 'O texto da legenda traduzida não pode ficar vazio.',
      invalid_translation_edit: 'O texto contém caracteres não permitidos na legenda.',
      translation_too_long: 'O texto traduzido passa do limite de caracteres da legenda.',
      translation_missing: 'Gere a legenda traduzida antes de selecioná-la ou editar.',
      invalid_settings: 'Configure um Provedor em Preferências antes de traduzir.',
      default: 'Não foi possível concluir a operação.',
    } as Record<string, string>,
  },
  en: {
    loading: 'Loading translation…',
    loadError: 'Could not load translation.',
    retry: 'Try again',
    permissionBlocked: 'Translation blocked by Permission',
    permissionHint: 'Translation can only be generated when the Source Permission includes the “translation” scope. The original Transcript is never changed.',
    directionAuto: 'Detected language: {from} → translate to {to}',
    targetLanguage: 'Target language',
    targetHint: 'This Clip’s language is unclear. Pick PT-BR or EN.',
    translate: 'Translate captions',
    retranslate: 'Translate again',
    translating: 'Translating…',
    trackLabel: 'Captions used in preview and export',
    trackOriginal: 'Original',
    trackTranslated: 'Translated ({lang})',
    trackTranslatedEmpty: 'Translated',
    linesTitle: 'Clip Sentences',
    linesHint: 'Editing updates only the translated captions and preserves Sentence timings. The original Transcript does not change.',
    originalLabel: 'Original',
    translatedLabel: 'Translation',
    saveLine: 'Save',
    edited: 'Edited',
    saved: 'Translation saved.',
    missingNotice: '{count} Sentence(s) in this Clip are not translated yet; translate again to cover all.',
    runStatus: 'Batch {done}/{total} · Task v{task} · profile {profile}',
    free: 'free (local model)',
    unknown: 'unknown cost',
    quota: 'uses the plan quota',
    range: 'between US$ {min} and US$ {max}',
    confirmTitle: 'Use the paid Provider?',
    confirmBody: 'The Clip Sentences are sent to the chosen Provider ({batches} batch(es)). Estimated cost: {cost}.',
    cancel: 'Cancel',
    confirm: 'Confirm and translate',
    failed: 'Could not complete translation: {reason}',
    reasons: {
      language_mismatch: 'the reply was not in the requested language.',
      verification_failed: 'the translation failed ID, line, number, or URL validation.',
      cancelled: 'translation was cancelled.',
      timeout_uncertain: 'the result is uncertain.',
      local_only_violation: '“Local only” blocks this Provider.',
      context_too_small: 'the Provider Profile context window is too small.',
      default: 'the Provider did not return a valid translation.',
    } as Record<string, string>,
    errors: {
      translation_permission_required: 'This Source’s Permission does not include the “translation” scope.',
      language_required: 'Pick the target language: PT-BR or EN.',
      translation_in_progress: 'A translation is already running for this Clip.',
      local_only_violation: '“Local only” blocks this Provider.',
      context_too_small: 'The Provider Profile context window is too small for these Sentences.',
      translation_empty: 'Translated caption text cannot be empty.',
      invalid_translation_edit: 'Text contains characters not allowed in captions.',
      translation_too_long: 'Translated text exceeds the caption length limit.',
      translation_missing: 'Generate translated captions before selecting or editing them.',
      invalid_settings: 'Configure a Provider in Preferences before translating.',
      default: 'Could not complete the operation.',
    } as Record<string, string>,
  },
};

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
const langLabel = (code: string | null) => (code === 'pt-BR' ? 'PT-BR' : code === 'en' ? 'EN' : '');
const field = 'foco w-full rounded-md border border-line-strong bg-field px-2.5 py-1.5 text-fg disabled:opacity-50';

export function TranslationPanel({
  clipId,
  clipRevision,
  onChanged,
  onSeek,
}: {
  clipId: number;
  clipRevision: number;
  onChanged: () => void;
  onSeek?: (sourceUs: number) => void;
}) {
  const t = useText(texts);
  const uiLang: Language = useContext(LanguageContext);
  const [doc, setDoc] = useState<TranslationDoc | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [targetLang, setTargetLang] = useState<string>(uiLang === 'pt-BR' ? 'en' : 'pt-BR');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<Estimate | null>(null);

  const applyDoc = useCallback((next: TranslationDoc) => {
    setDoc(next);
    setLoadError(false);
    setDrafts(prev => {
      const updated: Record<number, string> = {};
      for (const s of next.sentences) {
        updated[s.id] = s.translatedText ?? prev[s.id] ?? '';
      }
      return updated;
    });
  }, []);

  const refresh = useCallback(async () => {
    const next = await coreDispatch<TranslationDoc>('translation.get', { clip_id: clipId });
    applyDoc(next);
    return next;
  }, [clipId, applyDoc]);

  useEffect(() => {
    let active = true;
    refresh().catch(() => { if (active) setLoadError(true); });
    const onPermission = () => { if (active) void refresh().catch(() => {}); };
    window.addEventListener(SOURCE_PERMISSION_UPDATED_EVENT, onPermission);
    return () => { active = false; window.removeEventListener(SOURCE_PERMISSION_UPDATED_EVENT, onPermission); };
  }, [refresh, clipRevision]);

  const running = doc?.run?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void refresh().then(next => {
        if (next.run?.state !== 'running') onChanged();
      }).catch(() => {});
    }, 600);
    return () => window.clearInterval(timer);
  }, [running, refresh, onChanged]);

  const costText = (e: Estimate['estimate']) =>
    e.kind === 'zero' ? t.free :
    e.kind === 'plan_quota' ? t.quota :
    e.kind === 'usd' && e.minMicroUsd !== null && e.maxMicroUsd !== null ? fill(t.range, { min: usd(e.minMicroUsd), max: usd(e.maxMicroUsd) }) :
    t.unknown;

  const langArgs = () => (doc?.languageRequired ? { target_language: targetLang } : {});

  async function startTranslation(confirmed: boolean) {
    setBusy(true); setError(''); setNote('');
    try {
      await coreDispatch('translation.start', { clip_id: clipId, ...langArgs(), ...(confirmed ? { confirmed: true } : {}) });
      await refresh();
      onChanged();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    } finally {
      setBusy(false);
    }
  }

  async function requestTranslate() {
    setBusy(true); setError(''); setNote('');
    try {
      const est = await coreDispatch<Estimate>('translation.estimate', { clip_id: clipId, ...langArgs() });
      if (est.paid) {
        setPending(est);
        setBusy(false);
      } else {
        await startTranslation(false);
      }
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
      setBusy(false);
    }
  }

  async function selectTrack(track: 'original' | 'translated') {
    setBusy(true); setError(''); setNote('');
    try {
      applyDoc(await coreDispatch<TranslationDoc>('translation.track.set', { clip_id: clipId, track }));
      onChanged();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    } finally {
      setBusy(false);
    }
  }

  async function saveLine(sentenceId: number) {
    const text = drafts[sentenceId] ?? '';
    setBusy(true); setError(''); setNote('');
    try {
      applyDoc(await coreDispatch<TranslationDoc>('translation.edit', { clip_id: clipId, sentence_id: sentenceId, text }));
      setNote(t.saved);
      onChanged();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !doc) {
    return (
      <div className="p-3 text-sm">
        <p role="alert" className="text-danger">{t.loadError}</p>
        <Button tamanho="sm" onClick={() => void refresh().catch(() => setLoadError(true))}>{t.retry}</Button>
      </div>
    );
  }
  if (!doc) {
    return <div className="p-3 text-sm"><p role="status">{t.loading}</p></div>;
  }

  const run = doc.run;
  const failedRun = run && (run.state === 'failed' || run.state === 'partial' || run.state === 'cancelled');
  const firstBadJob = run?.jobs.find(j => j.state !== 'completed');
  const failReason = firstBadJob
    ? (firstBadJob.violations.length > 0 ? t.reasons.verification_failed : t.reasons[firstBadJob.code ?? ''] ?? t.reasons.default)
    : t.reasons.default;

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm" data-translation-panel>
      {!doc.permitted && (
        <div role="alert" data-translation-blocked className="flex flex-col gap-1 rounded-md border border-danger bg-danger-subtle p-2.5 text-xs text-danger">
          <p className="font-semibold">{t.permissionBlocked}</p>
          <p>{doc.permissionError?.message ?? t.permissionHint}</p>
        </div>
      )}

      {doc.permitted && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
          {doc.languageRequired ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t.targetLanguage}</span>
              <select className={field} value={targetLang} disabled={busy || running} onChange={e => setTargetLang(e.target.value)} data-foco-inicial>
                <option value="en">EN</option>
                <option value="pt-BR">PT-BR</option>
              </select>
              <span className="text-fg-2">{t.targetHint}</span>
            </label>
          ) : (
            <p className="text-xs text-fg-2">
              {fill(t.directionAuto, { from: langLabel(doc.detectedLanguage), to: langLabel(doc.defaultTargetLanguage) })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variante={doc.hasTranslation ? 'secundario' : 'primario'}
              tamanho="sm"
              disabled={busy || running}
              carregando={running}
              data-foco-inicial={!doc.languageRequired ? true : undefined}
              onClick={() => void requestTranslate()}
            >
              {running ? t.translating : doc.hasTranslation ? t.retranslate : t.translate}
            </Button>
          </div>
          {run && (
            <p className="text-xs text-fg-2" data-translation-run>
              {fill(t.runStatus, { done: run.batchesCompleted, total: run.batchesTotal, task: run.taskVersion, profile: run.profile || '—' })}
            </p>
          )}
          {failedRun && <p role="alert" className="text-xs text-danger">{fill(t.failed, { reason: failReason })}</p>}
        </div>
      )}

      <fieldset disabled={busy} className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
        <legend className="px-1 text-xs font-medium">{t.trackLabel}</legend>
        <div className="flex flex-wrap gap-2">
          <Button
            tamanho="sm"
            variante={doc.activeTrack === 'original' ? 'primario' : 'secundario'}
            aria-pressed={doc.activeTrack === 'original'}
            onClick={() => void selectTrack('original')}
          >
            {t.trackOriginal}
          </Button>
          <Button
            tamanho="sm"
            variante={doc.activeTrack === 'translated' ? 'primario' : 'secundario'}
            aria-pressed={doc.activeTrack === 'translated'}
            disabled={!doc.hasTranslation}
            onClick={() => void selectTrack('translated')}
          >
            {doc.targetLanguage ? fill(t.trackTranslated, { lang: langLabel(doc.targetLanguage) }) : t.trackTranslatedEmpty}
          </Button>
        </div>
      </fieldset>

      {doc.missingSentenceIds.length > 0 && (
        <p role="status" className="text-xs text-fg-2">
          {fill(t.missingNotice, { count: doc.missingSentenceIds.length })}
        </p>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {note && <p role="status" aria-live="polite" className="text-xs text-fg-2">{note}</p>}

      <section aria-label={t.linesTitle} className="flex flex-col gap-2">
        <h4 className="font-semibold">{t.linesTitle}</h4>
        <p className="text-xs text-fg-2">{t.linesHint}</p>
        <ol className="flex flex-col gap-2">
          {doc.sentences.map(s => (
            <li key={s.id} data-translation-sentence={s.id} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="foco font-mono text-fg-2 hover:text-fg"
                  onClick={() => onSeek?.(s.startUs)}
                >
                  #{s.id} · {clock(s.startUs)}
                </button>
                {s.edited && <span className="rounded-sm bg-accent-subtle px-1.5 py-0.5 text-[11px]">{t.edited}</span>}
              </div>
              <p className="text-fg-2" data-translation-original={s.id}>
                <span className="font-medium">{t.originalLabel}: </span>{s.originalText}
              </p>
              {s.translatedText !== null && (
                <form
                  className="flex flex-col gap-1.5"
                  onSubmit={e => { e.preventDefault(); void saveLine(s.id); }}
                >
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">{t.translatedLabel}</span>
                    <input
                      className={field}
                      maxLength={2000}
                      value={drafts[s.id] ?? s.translatedText}
                      disabled={busy}
                      onChange={e => setDrafts(prev => ({ ...prev, [s.id]: e.target.value }))}
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button
                      tamanho="sm"
                      type="submit"
                      disabled={busy || (drafts[s.id] ?? s.translatedText).trim() === s.translatedText.trim()}
                    >
                      {t.saveLine}
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ol>
      </section>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={open => { if (!open) setPending(null); }}
        title={t.confirmTitle}
        description={pending ? fill(t.confirmBody, { batches: pending.batches, cost: costText(pending.estimate) }) : ''}
        cancelLabel={t.cancel}
        confirmLabel={t.confirm}
        onConfirm={() => { setPending(null); void startTranslation(true); }}
      />
    </div>
  );
}
