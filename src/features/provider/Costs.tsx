import { useContext, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText } from '@/lib/i18n';
import { costTexts } from './costTexts';

type Price = { provider: string; model: string; inputPerMillion: number; outputPerMillion: number };
type Prices = { updatedAt: string; prices: Price[]; overrides: Price[] };
type Kind = 'usd' | 'zero' | 'plan_quota' | 'unknown';
type Estimate = { kind: Kind; inputTokens: number; maxOutputTokens: number | null; minMicroUsd: number | null; maxMicroUsd: number | null };
type Row = { id: number; task: string; batch: string | null; provider: string; model: string; costKind: Kind; microUsd: number | null };

export function ProviderCosts() {
  const t = useText(costTexts);
  const language = useContext(LanguageContext);
  const usd = (micro: number) => new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micro / 1_000_000);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState({ provider: 'openai', model: '', input: '', output: '' });
  const [sample, setSample] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [message, setMessage] = useState('');
  const input = 'foco mt-2 block h-9 w-full rounded-md border border-line-strong bg-field px-3 text-fg';
  async function load() {
    setPrices(await coreDispatch<Prices>('provider.prices.get', {}));
    try { setRows(await coreDispatch<Row[]>('provider.cost.list', {})); } catch { setRows([]); }
  }
  useEffect(() => { void load().catch(() => setMessage(t.failed)); }, []);
  async function guarded(action: () => Promise<void>) {
    setMessage('');
    try { await action(); } catch { setMessage(t.failed); }
  }
  function describe(e: Estimate) {
    if (e.kind === 'plan_quota') return t.planQuota;
    if (e.kind === 'zero') return t.zero;
    if (e.kind === 'unknown') return t.unknown;
    const range = e.maxMicroUsd === null ? `${t.from} ${usd(e.minMicroUsd ?? 0)}, ${t.noCeiling}` : `${usd(e.minMicroUsd ?? 0)} – ${usd(e.maxMicroUsd)}`;
    return `${t.estimated}: ${range}`;
  }
  const rowCost = (r: Row) => r.costKind === 'plan_quota' ? t.planQuota : r.costKind === 'zero' ? usd(0) : r.microUsd === null ? t.unknownShort : usd(r.microUsd);
  const total = rows.reduce((sum, r) => sum + (r.costKind === 'usd' ? r.microUsd ?? 0 : 0), 0);
  const hasUnknown = rows.some(r => r.costKind === 'unknown');
  const overridden = (p: Price) => prices?.overrides.some(o => o.provider === p.provider && o.model === p.model);
  return <section className="mt-10 max-w-xl border-t border-line pt-8" aria-labelledby="costs-title">
    <h2 id="costs-title" className="text-lg font-semibold">{t.title}</h2>
    <h3 className="mt-5 font-semibold">{t.estimateTitle}</h3>
    <form className="mt-3 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void guarded(async () => { const n = ceiling.trim() ? Number(ceiling) : undefined; setEstimate(await coreDispatch<Estimate>('provider.cost.estimate', { instruction: '', transcript: sample, schema: {}, nativeSchema: false, ...(n ? { maxOutputTokens: n } : {}) })); }); }}>
      <label>{t.sample}<textarea className={`${input} h-24 py-2`} value={sample} onChange={e => setSample(e.target.value)} /></label>
      <label>{t.ceiling}<input className={input} type="number" min="1" value={ceiling} onChange={e => setCeiling(e.target.value)} /></label>
      <div><Button type="submit">{t.estimate}</Button></div>
    </form>
    {estimate && <p className="mt-3 text-sm" role="status">{describe(estimate)} <span className="text-fg-2">({estimate.inputTokens} {t.inputTokens}{estimate.maxOutputTokens !== null ? `, ${t.ceilingTokens} ${estimate.maxOutputTokens}` : ''}; {t.heuristic})</span></p>}
    <h3 className="mt-8 font-semibold">{t.pricesTitle}</h3>
    {prices && <p className="mt-2 text-sm text-fg-2">{t.tableDate} {prices.updatedAt}. {t.noNetwork}</p>}
    <table className="mt-3 w-full text-left text-sm"><thead><tr><th scope="col">{t.model}</th><th scope="col">{t.input}</th><th scope="col">{t.output}</th><th scope="col">{t.source}</th></tr></thead><tbody>
      {(prices?.overrides ?? []).map(p => <tr key={`o-${p.provider}-${p.model}`}><td>{p.provider} / {p.model}</td><td>{p.inputPerMillion}</td><td>{p.outputPerMillion}</td><td>{t.override} <Button type="button" onClick={() => void guarded(async () => { setPrices(await coreDispatch<Prices>('provider.prices.clear', { provider: p.provider, model: p.model })); })}>{t.removeOverride} {p.model}</Button></td></tr>)}
      {(prices?.prices ?? []).filter(p => !overridden(p)).map(p => <tr key={`t-${p.provider}-${p.model}`}><td>{p.provider} / {p.model}</td><td>{p.inputPerMillion}</td><td>{p.outputPerMillion}</td><td>{t.table}</td></tr>)}
    </tbody></table>
    <form className="mt-4 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void guarded(async () => { setPrices(await coreDispatch<Prices>('provider.prices.set', { provider: draft.provider, model: draft.model.trim(), inputPerMillion: Number(draft.input), outputPerMillion: Number(draft.output) })); setDraft({ ...draft, model: '', input: '', output: '' }); }); }}>
      <label>{t.kind}<select className={input} value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label>
      <label>{t.overrideModel}<input className={input} required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
      <label>{t.overrideInput}<input className={input} required type="number" min="0" step="any" value={draft.input} onChange={e => setDraft({ ...draft, input: e.target.value })} /></label>
      <label>{t.overrideOutput}<input className={input} required type="number" min="0" step="any" value={draft.output} onChange={e => setDraft({ ...draft, output: e.target.value })} /></label>
      <div><Button type="submit">{t.saveOverride}</Button></div>
    </form>
    <h3 className="mt-8 font-semibold">{t.recordsTitle}</h3>
    {rows.length === 0 ? <p className="mt-2 text-sm text-fg-2">{t.noRecords}</p> : <>
      <table className="mt-3 w-full text-left text-sm"><thead><tr><th scope="col">{t.task}</th><th scope="col">{t.batch}</th><th scope="col">{t.model}</th><th scope="col">{t.cost}</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}><td>{r.task}</td><td>{r.batch ?? '—'}</td><td>{r.provider}{r.model ? ` / ${r.model}` : ''}</td><td>{rowCost(r)}</td></tr>)}
      </tbody></table>
      <p className="mt-2 text-sm">{t.total}: {usd(total)}{hasUnknown ? ` ${t.plusUnknown}` : ''}</p></>}
    {message && <p className="mt-4 text-sm" role="status">{message}</p>}
  </section>;
}
