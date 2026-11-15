import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText } from '@/lib/i18n';
import { texts as cliTexts } from './CliSettings';
import { profileTexts } from './profileTexts';

type Price = { inputPerMillion: number; outputPerMillion: number; source: 'override' | 'table' };
type Profile = {
  id: string; label: string; kind: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'codex' | 'claude' | 'opencode'; endpoint: string | null; model: string | null;
  nativeSchema: boolean; ownKey: boolean; context: number | null; keyLastFour: string | null; local: boolean; confirmed: boolean; price: Price | null;
  cost?: { kind: string }; cli: boolean; active?: boolean; experimental?: boolean;
};
type Draft = { id: string | null; label: string; kind: 'openai' | 'anthropic' | 'gemini' | 'ollama'; endpoint: string; model: string; nativeSchema: boolean; ownKey: boolean; context: string };
const emptyDraft: Draft = { id: null, label: '', kind: 'openai', endpoint: '', model: '', nativeSchema: false, ownKey: false, context: '' };

function slug(label: string, taken: string[]) {
  const base = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'perfil';
  let id = base;
  for (let n = 2; taken.includes(id) || id === 'legacy' || id === 'codex' || id === 'claude' || id === 'opencode'; n++) id = `${base}-${n}`;
  return id;
}

export function ProviderProfiles({ refreshKey = 0, onChange }: { refreshKey?: number; onChange?: () => void } = {}) {
  const t = useText(profileTexts);
  const cli = useText(cliTexts);
  const language = useContext(LanguageContext);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState<Profile | null>(null);
  const [removing, setRemoving] = useState<Profile | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const field = 'foco mt-2 block h-9 w-full max-w-lg rounded-md border border-line-strong bg-field px-3 text-fg';
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 6 });
  async function refresh() { setProfiles((await coreDispatch<{ profiles: Profile[] }>('provider.profiles.list', {})).profiles); }
  useEffect(() => { void refresh().catch(() => setMessage(t.failed)); }, [refreshKey]);
  async function run(action: () => Promise<void | boolean>, result: string) {
    setBusy(true); setMessage('');
    try { const completed = await action(); await refresh(); onChange?.(); if (completed !== false) setMessage(result); } catch (error) { const code = (error as { code?: string })?.code; setMessage(code === 'timeout_uncertain' ? t.timeoutUncertain : code === 'insecure_endpoint' ? t.insecureEndpoint : t.failed); } finally { setBusy(false); }
  }
  async function test(profile: Profile) {
    if (!profile.local && !profile.confirmed) { setConsent(profile); return false; }
    await coreDispatch('provider.test', { profileId: profile.id });
  }
  function seal(profile: Profile) {
    if (profile.cli) return [t.subscription, t.experimental];
    return [profile.local ? t.local : t.remote];
  }
  function price(profile: Profile) {
    if (profile.kind === 'opencode') return profile.cost?.kind === 'zero' ? cli.free : t.unknown;
    if (profile.cli) return t.quota;
    if (profile.local) return t.free;
    if (!profile.price) return t.unknown;
    return `US$ ${number.format(profile.price.inputPerMillion)} / ${number.format(profile.price.outputPerMillion)} ${t.priceUnit} · ${profile.price.source === 'override' ? t.priceOverride : t.priceTable}`;
  }
  function consentText(profile: Profile) {
    if (profile.local) return t.consentLocal;
    return profile.confirmed ? t.consentYes : t.consentNo;
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const id = draft.id ?? slug(draft.label, profiles.map(p => p.id));
    const current = draft;
    void run(async () => {
      await coreDispatch('provider.configure', { profileId: id, label: current.label, kind: current.kind, endpoint: current.endpoint, model: current.model, nativeSchema: current.nativeSchema, ownKey: current.ownKey, context: current.kind === 'ollama' && current.context ? Number(current.context) : null });
      setDraft(null);
    }, t.saved);
  }
  return <section className="mt-10 max-w-3xl border-t border-line pt-8" aria-labelledby="profiles-title">
    <h2 id="profiles-title" className="text-lg font-semibold">{t.title}</h2>
    <p className="mt-2 text-sm text-fg-2">{t.intro}</p>
    <div className="mt-5 flex flex-col gap-3">
      {profiles.map(profile => <article key={profile.id} aria-label={profile.label} className="rounded-md border border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{profile.label}</h3>
          {seal(profile).map(text => <span key={text} className={`rounded-md border px-2 py-0.5 text-xs ${text === t.experimental ? 'border-danger/40 text-danger' : 'border-line-strong text-fg-2'}`}>{text}</span>)}
          {profile.cli && <span className="text-xs text-fg-2">{profile.active ? t.cliActive : t.cliOff}</span>}
        </div>
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
          {profile.kind === 'opencode' && <><dt className="text-fg-2">{t.model}</dt><dd className="break-all">{profile.model || '—'}</dd></>}
          {!profile.cli && <><dt className="text-fg-2">{t.model}</dt><dd className="break-all">{profile.kind} · {profile.model}</dd>
            <dt className="text-fg-2">{t.endpoint}</dt><dd className="break-all">{profile.endpoint}</dd>
            <dt className="text-fg-2">{t.key}</dt><dd>{profile.keyLastFour ? `…${profile.keyLastFour}` : t.noKey}{profile.keyLastFour && ` · ${profile.ownKey ? t.ownKey : t.sharedKey}`}</dd></>}
          <dt className="text-fg-2">{t.price}</dt><dd>{price(profile)}</dd>
          {!profile.cli && <><dt className="text-fg-2">{t.consent}</dt><dd>{consentText(profile)}</dd></>}
        </dl>
        {profile.cli ? <p className="mt-3 text-sm text-fg-2">{profile.kind === 'opencode' ? cli.opencodeWarning : t.cliHelp}</p> : <div className="mt-4 flex flex-col gap-3">
          <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); const submitted = keys[profile.id] ?? ''; setKeys({ ...keys, [profile.id]: '' }); void run(async () => { await coreDispatch('provider.key.set', { profileId: profile.id, key: submitted }); }, t.keySaved); }}>
            <label className="text-sm">{t.keyLabel}<input aria-label={`${t.keyLabel} (${profile.label})`} className={field} type="password" autoComplete="off" value={keys[profile.id] ?? ''} onChange={e => setKeys({ ...keys, [profile.id]: e.target.value })} /></label>
            <Button type="submit" disabled={busy || !(keys[profile.id] ?? '')}>{t.setKey}</Button>
            <Button type="button" disabled={busy || !profile.keyLastFour} onClick={() => void run(async () => { await coreDispatch('provider.key.remove', { profileId: profile.id }); }, t.saved)}>{t.removeKey}</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void run(() => test(profile), t.success)}>{t.test}</Button>
            {profile.id !== 'legacy' && <Button type="button" disabled={busy} onClick={() => setDraft({ id: profile.id, label: profile.label, kind: profile.kind as Draft['kind'], endpoint: profile.endpoint ?? '', model: profile.model ?? '', nativeSchema: profile.nativeSchema, ownKey: profile.ownKey, context: profile.context?.toString() ?? '' })}>{t.edit}</Button>}
            {profile.id !== 'legacy' && <Button type="button" variante="perigo" disabled={busy} onClick={() => setRemoving(profile)}>{t.remove}</Button>}
          </div>
        </div>}
      </article>)}
    </div>
    {draft ? <form className="mt-5 flex flex-col gap-4 rounded-md border border-line p-4" aria-label={draft.id ? t.edit : t.add} onSubmit={submit}>
      <label>{t.label}<input className={field} required value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
      <label>{t.kind}<select className={field} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="ollama">Ollama</option></select></label>
      <label>{t.endpoint}<input className={field} type="url" required value={draft.endpoint} onChange={e => setDraft({ ...draft, endpoint: e.target.value })} /></label>
      <label>{t.model}<input className={field} required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
      {draft.kind === 'ollama' && <label>{t.context}<input className={field} type="number" min="1" max="4294967295" step="1" placeholder="4096" value={draft.context} onChange={e => setDraft({ ...draft, context: e.target.value })} /></label>}
      {draft.kind !== 'ollama' && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.nativeSchema} onChange={e => setDraft({ ...draft, nativeSchema: e.target.checked })} />{t.schema}</label>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.ownKey} onChange={e => setDraft({ ...draft, ownKey: e.target.checked })} />{t.ownKeyOption}</label>
      <div className="flex gap-2"><Button type="submit" variante="primario" disabled={busy}>{t.save}</Button><Button type="button" onClick={() => setDraft(null)}>{t.cancel}</Button></div>
    </form> : <div className="mt-5"><Button ref={addButton} type="button" disabled={busy} onClick={() => setDraft(emptyDraft)}>{t.add}</Button></div>}
    {message && <p className="mt-4 text-sm" role="status">{message}</p>}
    <ConfirmDialog open={consent !== null} onOpenChange={open => { if (!open) setConsent(null); }} title={t.confirmTitle} description={t.confirm} cancelLabel={t.cancel} confirmLabel={t.send} finalFocus={addButton} onConfirm={() => { const target = consent; setConsent(null); if (target) void run(async () => { await coreDispatch('provider.confirm', { profileId: target.id, endpoint: target.endpoint }); await coreDispatch('provider.test', { profileId: target.id }); }, t.success); }}>
      <p className="break-all px-5 pb-4">{consent?.endpoint}</p>
    </ConfirmDialog>
    <ConfirmDialog open={removing !== null} onOpenChange={open => { if (!open) setRemoving(null); }} title={t.removeTitle} description={t.removeText} cancelLabel={t.cancel} confirmLabel={t.remove} finalFocus={addButton} onConfirm={() => { const target = removing; setRemoving(null); if (target) void run(async () => { await coreDispatch('provider.profiles.remove', { profileId: target.id }); }, t.removed); }}>
      <p className="break-all px-5 pb-4">{removing?.label}</p>
    </ConfirmDialog>
  </section>;
}
