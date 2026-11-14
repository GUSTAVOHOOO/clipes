import { useEffect, useRef, useState } from 'react';
import { Dialog as D } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { texts as cliTexts } from '@/features/provider/CliSettings';
import { texts } from './texts';

export const REOPEN_EVENT = 'clipes:assistant-open';
export type Choice = '' | 'endpoint' | 'codex' | 'claude';
export type AssistantStatus = { completed: boolean; skipped: boolean; needsSetup: boolean; default: Choice; tasks: Record<string, Choice> };
type Server = { found: boolean; endpoint: string | null; models: string[] };
type Detection = { ollama: Server; lmStudio: Server; llamaCpp: Server; codex: { found: boolean }; claude: { found: boolean } };

const SERVERS = [['ollama', 'Ollama'], ['lmStudio', 'LM Studio'], ['llamaCpp', 'llama.cpp']] as const;

/** Abre sozinho na primeira execução e quando o usuário pede nas Preferências. */
export function Assistant() {
  const t = useText(texts);
  const cli = useText(cliTexts);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detectFailed, setDetectFailed] = useState(false);
  const [pendingCli, setPendingCli] = useState<'codex' | 'claude' | null>(null);
  const [models, setModels] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  async function refresh() { setStatus(await coreDispatch<AssistantStatus>('assistant.status', {})); }
  async function detect() {
    setDetection(null); setDetectFailed(false);
    try { setDetection(await coreDispatch<Detection>('assistant.detect', {})); } catch { setDetectFailed(true); }
  }
  useEffect(() => {
    coreDispatch<AssistantStatus>('assistant.status', {}).then(s => { setStatus(s); if (s.needsSetup) setOpen(true); }).catch(() => {});
    const reopen = () => { setMessage(''); setOpen(true); void refresh().catch(() => {}); };
    window.addEventListener(REOPEN_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_EVENT, reopen);
  }, []);
  useEffect(() => { if (open) void detect(); }, [open]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); await refresh(); } catch { setMessage(t.failed); } finally { setBusy(false); }
  }
  const finish = (skipped: boolean) => run(async () => { await coreDispatch('assistant.complete', { skipped }); setOpen(false); });
  const useEndpoint = (server: Server, name: string) => run(async () => {
    const model = models[name] ?? server.models[0] ?? '';
    await coreDispatch('provider.configure', { kind: 'openai', endpoint: server.endpoint, model, nativeSchema: false });
    await coreDispatch('assistant.default.set', { choice: 'endpoint' });
  });
  const useApi = () => run(async () => { await coreDispatch('assistant.default.set', { choice: 'endpoint' }); setMessage(t.apiNext); });
  const activateCli = (kind: 'codex' | 'claude') => run(async () => {
    await coreDispatch('provider.cli.configure', { kind });
    await coreDispatch('provider.cli.confirm', { kind });
    await coreDispatch('assistant.default.set', { choice: kind });
  });
  const name = (choice: Choice) => choice === 'codex' ? t.codex : choice === 'claude' ? t.claude : choice === 'endpoint' ? t.endpointName : '';
  const card = 'rounded-lg border border-line bg-field p-4';
  const anyCli = detection && (detection.codex.found || detection.claude.found);
  const anyServer = detection && SERVERS.some(([key]) => detection[key].found);

  return <><D.Root open={open} onOpenChange={setOpen}>
    <D.Portal>
      <D.Backdrop className="fixed inset-0 bg-scrim" style={{ zIndex: 'var(--z-scrim)' }} />
      <D.Popup initialFocus={first} className="fixed top-[6vh] left-1/2 flex max-h-[88vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line-strong bg-surface text-fg shadow-dialog outline-none" style={{ zIndex: 'var(--z-dialog)' }}>
        <div className="px-5 pt-4 pb-3"><D.Title className="text-lg font-semibold">{t.title}</D.Title><D.Description className="mt-1 text-sm text-fg-2">{t.intro}</D.Description></div>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 pb-4">
          <section className={card} aria-labelledby="assistant-detected">
            <h3 id="assistant-detected" className="font-semibold">{t.detected}</h3>
            {!detection && !detectFailed && <p className="mt-2 text-sm text-fg-2" role="status">{t.detecting}</p>}
            {detectFailed && <p className="mt-2 text-sm" role="status">{t.detectFailed}</p>}
            {detection && !anyServer && !anyCli && <p className="mt-2 text-sm text-fg-2">{t.nothing}</p>}
            {detection && <ul className="mt-2 text-sm">
              {SERVERS.filter(([key]) => detection[key].found).map(([key, label]) => <li key={key}>{label}{detection[key].models.length ? ` — ${t.models}: ${detection[key].models.slice(0, 5).join(', ')}` : ''}</li>)}
              {detection.codex.found && <li>{t.codex}</li>}
              {detection.claude.found && <li>{t.claude}</li>}
            </ul>}
          </section>
          <section className={card} aria-labelledby="assistant-api">
            <h3 id="assistant-api" className="font-semibold">{t.apiTitle}</h3>
            <p className="mt-1 text-sm text-fg-2">{t.apiBody}</p>
            <div className="mt-3"><Button ref={first} disabled={busy} onClick={() => void useApi()}>{t.apiAction}</Button></div>
          </section>
          <section className={card} aria-labelledby="assistant-cli">
            <h3 id="assistant-cli" className="font-semibold">{t.cliTitle}</h3>
            <p className="mt-1 text-sm text-fg-2">{t.cliBody}</p>
            {detection && !anyCli && <p className="mt-2 text-sm">{t.cliMissing}</p>}
            {detection && <div className="mt-3 flex flex-wrap gap-2">
              {detection.codex.found && <Button disabled={busy} onClick={() => setPendingCli('codex')}>{`${t.useCli} ${t.codex}`}</Button>}
              {detection.claude.found && <Button disabled={busy} onClick={() => setPendingCli('claude')}>{`${t.useCli} ${t.claude}`}</Button>}
            </div>}
          </section>
          <section className={card} aria-labelledby="assistant-local">
            <h3 id="assistant-local" className="font-semibold">{t.localTitle}</h3>
            <p className="mt-1 text-sm text-fg-2">{t.localBody}</p>
            {detection && SERVERS.filter(([key]) => detection[key].found && detection[key].models.length).map(([key, label]) => <div key={key} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-sm">{`${label} — ${t.model}`}<select className="foco mt-1 block h-8 rounded-md border border-line-strong bg-field px-2 text-fg" value={models[key] ?? detection[key].models[0]} onChange={e => setModels({ ...models, [key]: e.target.value })}>{detection[key].models.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
              <Button disabled={busy} onClick={() => void useEndpoint(detection[key], key)}>{`${t.localAction} ${label}`}</Button>
            </div>)}
          </section>
          <p className="text-sm" role="status">{status?.default ? `${t.selected} ${name(status.default)}` : t.none}</p>
          {message && <p className="text-sm" role="status">{message}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button disabled={busy} onClick={() => void finish(true)}>{t.skip}</Button>
          <Button variante="primario" disabled={busy || !status?.default} onClick={() => void finish(false)}>{t.done}</Button>
        </div>
      </D.Popup>
    </D.Portal>
  </D.Root>
    <ConfirmDialog open={pendingCli !== null} onOpenChange={o => { if (!o) setPendingCli(null); }} title={cli.confirmTitle} description={cli.confirm} cancelLabel={cli.cancel} confirmLabel={cli.accept} onConfirm={() => { const kind = pendingCli; setPendingCli(null); if (kind) void activateCli(kind); }}>
      <p className="px-5 pb-3 text-sm">{pendingCli === 'codex' ? cli.codexWarning : cli.claudeWarning}</p>
      <p className="px-5 pb-3 text-sm">{cli.quota}</p>
    </ConfirmDialog></>;
}
