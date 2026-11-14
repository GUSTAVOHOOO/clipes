import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { REOPEN_EVENT, type AssistantStatus, type Choice } from './Assistant';
import { texts } from './texts';

const TASKS = ['selection', 'packaging', 'script', 'translation'] as const;

/** Provedor padrão do app e trocas por tarefa; fica nas Preferências, não no Projeto. */
export function AssistantSettings() {
  const t = useText(texts);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [confirmed, setConfirmed] = useState({ codex: false, claude: false });
  const [message, setMessage] = useState('');
  const select = 'foco mt-1 block h-9 w-full max-w-sm rounded-md border border-line-strong bg-field px-3 text-fg';
  async function refresh() {
    setStatus(await coreDispatch<AssistantStatus>('assistant.status', {}));
    const cli = await coreDispatch<{ codexConfirmed: boolean; claudeConfirmed: boolean }>('provider.cli.status', {});
    setConfirmed({ codex: cli.codexConfirmed, claude: cli.claudeConfirmed });
  }
  useEffect(() => { void refresh().catch(() => setMessage(t.failed)); }, []);
  async function set(name: string, args: object, choice: Choice) {
    setMessage('');
    try { await coreDispatch(name, { ...args, choice }); await refresh(); setMessage(t.saved); } catch { setMessage(t.failed); }
  }
  const options = (empty: string) => <>
    <option value="">{empty}</option>
    <option value="endpoint">{t.endpointName}</option>
    <option value="codex" disabled={!confirmed.codex}>{`${t.codex}${confirmed.codex ? '' : ` (${t.needsConfirm})`}`}</option>
    <option value="claude" disabled={!confirmed.claude}>{`${t.claude}${confirmed.claude ? '' : ` (${t.needsConfirm})`}`}</option>
  </>;
  const labels = { selection: t.taskSelection, packaging: t.taskPackaging, script: t.taskScript, translation: t.taskTranslation };
  return <section className="mt-10 max-w-xl border-t border-line pt-8" aria-labelledby="assistant-settings-title">
    <h2 id="assistant-settings-title" className="text-lg font-semibold">{t.settingsTitle}</h2>
    <p className="mt-2 text-sm text-fg-2">{t.settingsBody}</p>
    <div className="mt-4 flex flex-col gap-4">
      <label>{t.defaultLabel}<select className={select} value={status?.default ?? ''} onChange={e => void set('assistant.default.set', {}, e.target.value as Choice)}>{options(t.notChosen)}</select></label>
      {TASKS.map(task => <label key={task}>{labels[task]}<select className={select} value={status?.tasks[task] ?? ''} onChange={e => void set('assistant.task.set', { task }, e.target.value as Choice)}>{options(t.useDefault)}</select></label>)}
    </div>
    <div className="mt-4"><Button onClick={() => window.dispatchEvent(new Event(REOPEN_EVENT))}>{t.reopen}</Button></div>
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </section>;
}
