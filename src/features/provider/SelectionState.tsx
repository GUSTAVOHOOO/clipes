import { useContext, useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText } from '@/lib/i18n';
import { guideDocs, selectionTexts } from './selectionTexts';

type Guide = keyof typeof guideDocs;
export type SelectionEstimate =
  | { applicable: false }
  | {
    applicable: true; profileId: string; model: string; contextTokens: number; origin: 'user' | 'loaded' | 'server' | 'catalog' | 'fallback' | 'measured';
    state: 'full' | 'reduced' | 'blocked';
    reference: { sourceMinutes: number; maxWindowMinutes: number; minWindowMinutes: number; firstWindowMinutes: number | null; windows: number | null };
    guides: Guide[];
  };

/**
 * Estado do perfil para a seleção de Cortes (#146): estimativa para fala densa, só informativa.
 * Nunca desativa uma escolha; `version` refaz a consulta quando o contexto do perfil muda.
 */
export function SelectionState({ profileId, version = '', variant = 'profile', onEstimate }: { profileId: string; version?: string; variant?: 'profile' | 'assistant'; onEstimate?: (estimate: SelectionEstimate | null) => void }) {
  const t = useText(selectionTexts);
  const language = useContext(LanguageContext);
  const [estimate, setEstimate] = useState<SelectionEstimate | null | 'failed'>(null);
  const number = new Intl.NumberFormat(language);
  useEffect(() => {
    let current = true;
    coreDispatch<SelectionEstimate>('provider.selection_state', { profileId })
      .then(result => { if (current) { setEstimate(result); onEstimate?.(result); } })
      .catch(() => { if (current) { setEstimate('failed'); onEstimate?.(null); } });
    return () => { current = false; };
  }, [profileId, version]);
  if (estimate === null) return <p className="mt-2 text-sm text-fg-2" role="status">{t.loading}</p>;
  if (estimate === 'failed') return <p className="mt-2 text-sm text-fg-2" role="status">{t.unavailable}</p>;
  if (!estimate.applicable) return null;
  const { reference, state } = estimate;
  const body = state === 'full' ? t.fullBody.replace('{max}', String(reference.maxWindowMinutes))
    : state === 'reduced' ? t.reducedBody.replace('{first}', String(reference.firstWindowMinutes ?? reference.minWindowMinutes))
      : t.blockedBody.replace('{min}', String(reference.minWindowMinutes));
  const label = state === 'full' ? t.full : state === 'reduced' ? t.reduced : t.blocked;
  const tone = state === 'full' ? 'border-line-strong' : 'border-danger/40';
  return <section aria-label={t.title} data-selection-state={state} className={`mt-3 rounded-md border ${tone} p-3 text-sm`}>
    <h4 className="font-semibold">{t.title}: <span>{label}</span></h4>
    {variant === 'assistant' && <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
      {estimate.model && <><dt className="text-fg-2">{t.model}</dt><dd className="break-all">{estimate.model}</dd></>}
      <dt className="text-fg-2">{t.context}</dt><dd>{number.format(estimate.contextTokens)} {t.tokens}</dd>
      <dt className="text-fg-2">{t.origin}</dt><dd>{t.origins[estimate.origin]}</dd>
    </dl>}
    <p className="mt-2">{body}</p>
    <p className="mt-1 text-xs text-fg-2">{t.estimate}</p>
    {state !== 'full' && <div className="mt-2">
      <h5 className="font-medium">{t.fixTitle}</h5>
      {estimate.guides.length === 0 ? <p className="mt-1">{t.fixDefault}</p> : <ul className="mt-1 list-disc pl-5">
        {estimate.guides.map(guide => <li key={guide}>{t[guide]} <a className="foco underline" href={guideDocs[guide]} target="_blank" rel="noreferrer">{t.docs}</a></li>)}
      </ul>}
    </div>}
  </section>;
}
