import { useContext, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText } from '@/lib/i18n';
import { texts } from './texts';

type Cost = { kind: 'zero' | 'plan_quota' | 'usd' | 'unknown'; inputPerMillion?: number; outputPerMillion?: number };
type Row = {
  task: string; choice: string; source: 'task' | 'default' | 'none';
  profile: { id: string; label: string; kind: string; model: string | null; local: boolean; cli: boolean; cost: Cost } | null;
  localOnly: boolean; blocked: boolean; missing: string | null;
  suggestion: { choice: string; label: string; measured: boolean } | null;
};
type Profile = { id: string; label: string; cli: boolean; confirmed: boolean };

const TASKS = ['selection', 'packaging', 'script', 'translation'] as const;

/** Tabela "Tarefas": perfil de cada Tarefa de IA, selo de localidade, custo e "somente local". */
export function TaskTable({ status, onChange }: { status: unknown; onChange: () => void }) {
  const t = useText(texts);
  const language = useContext(LanguageContext);
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [message, setMessage] = useState('');
  const [projectVeto, setProjectVeto] = useState(false);
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 6 });
  const select = 'foco block h-9 w-full min-w-44 rounded-md border border-line-strong bg-field px-2 text-fg';
  async function load() {
    const [table, list] = await Promise.all([
      coreDispatch<{ tasks: Row[]; projectLocalOnly: boolean }>('assistant.tasks', {}),
      coreDispatch<{ profiles: Profile[] }>('provider.profiles.list', {}),
    ]);
    setRows(table.tasks); setProjectVeto(table.projectLocalOnly); setProfiles(list.profiles);
  }
  useEffect(() => { void load().catch(() => setMessage(t.failed)); }, [status]);
  async function act(name: string, args: object) {
    setMessage('');
    try { await coreDispatch(name, args); await load(); onChange(); setMessage(t.saved); } catch { setMessage(t.failed); }
  }
  const labels: Record<string, string> = { selection: t.taskSelection, packaging: t.taskPackaging, script: t.taskScript, translation: t.taskTranslation };
  const cli = (kind: 'codex' | 'claude' | 'opencode' | 'opencode') => profiles.find(p => p.id === kind);
  const saved = profiles.filter(p => !p.cli && p.id !== 'legacy');
  const seal = (row: Row) => !row.profile ? t.sealNone : row.profile.cli ? t.sealCli : row.profile.local ? t.sealLocal : t.sealRemote;
  function cost(row: Row) {
    const c = row.profile?.cost;
    if (!c) return '—';
    if (c.kind === 'zero') return row.profile?.kind === 'opencode' ? t.costFreeCli : t.costZero;
    if (c.kind === 'plan_quota') return t.costQuota;
    if (c.kind === 'unknown') return t.costUnknown;
    return `US$ ${number.format(c.inputPerMillion ?? 0)} / ${number.format(c.outputPerMillion ?? 0)} ${t.costUnit}`;
  }
  return <div className="mt-6" role="group" aria-labelledby="task-table-title">
    <h3 id="task-table-title" className="font-semibold">{t.tasksTitle}</h3>
    <p className="mt-1 text-sm text-fg-2">{t.tasksBody}</p>
    {projectVeto && <p className="mt-3 rounded-md border border-line-strong px-3 py-2 text-sm" role="status">{t.projectVeto}</p>}
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-fg-2"><tr>
          <th scope="col" className="py-2 pr-3 font-medium">{t.colTask}</th>
          <th scope="col" className="py-2 pr-3 font-medium">{t.colProfile}</th>
          <th scope="col" className="py-2 pr-3 font-medium">{t.colLocality}</th>
          <th scope="col" className="py-2 pr-3 font-medium">{t.colCost}</th>
          <th scope="col" className="py-2 font-medium">{t.colLocalOnly}</th>
        </tr></thead>
        <tbody>
          {TASKS.map(task => {
            const row = rows.find(r => r.task === task);
            if (!row) return null;
            return <tr key={task} className="border-t border-line align-top">
              <th scope="row" className="py-3 pr-3 font-normal">{labels[task]}</th>
              <td className="py-3 pr-3">
                <select aria-label={labels[task]} className={select} value={row.choice} onChange={e => void act('assistant.task.set', { task, choice: e.target.value })}>
                  <option value="">{t.useDefault}</option>
                  <option value="endpoint">{t.endpointName}</option>
                  <option value="codex" disabled={!cli('codex')?.confirmed}>{`${t.codex}${cli('codex')?.confirmed ? '' : ` (${t.needsConfirm})`}`}</option>
                  <option value="claude" disabled={!cli('claude')?.confirmed}>{`${t.claude}${cli('claude')?.confirmed ? '' : ` (${t.needsConfirm})`}`}</option>
                  <option value="opencode" disabled={!cli('opencode')?.confirmed}>{`${t.opencode}${cli('opencode')?.confirmed ? '' : ` (${t.needsConfirm})`}`}</option>
                  <option value="opencode" disabled={!cli('opencode')?.confirmed}>{`${t.opencode}${cli('opencode')?.confirmed ? '' : ` (${t.needsConfirm})`}`}</option>
                  {saved.map(p => <option key={p.id} value={`profile:${p.id}`}>{p.label}</option>)}
                </select>
                {row.profile && <p className="mt-1 text-xs text-fg-2">{row.profile.label}{row.profile.model ? ` · ${row.profile.model}` : ''}{row.source === 'default' ? ` ${t.viaDefault}` : ''}</p>}
              </td>
              <td className="py-3 pr-3"><span className="rounded-md border border-line-strong px-2 py-0.5 text-xs text-fg-2">{seal(row)}</span></td>
              <td className="py-3 pr-3">{cost(row)}</td>
              <td className="py-3">
                <label className="flex items-center gap-2"><input type="checkbox" aria-label={`${t.colLocalOnly} (${labels[task]})`} checked={row.localOnly} onChange={e => void act('assistant.local_only.set', { task, enabled: e.target.checked })} /><span className="sr-only">{t.colLocalOnly}</span></label>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-fg-2">{t.localOnlyHelp}</p>
    {rows.filter(r => r.blocked).map(r => <p key={`b-${r.task}`} className="mt-2 text-sm text-danger" role="alert">{`${labels[r.task]}: ${t.blocked}`}</p>)}
    {rows.filter(r => r.missing).map(r => <p key={`m-${r.task}`} className="mt-2 text-sm" role="alert">{`${labels[r.task]}: ${t.missing.replace('{id}', r.missing ?? '')}`}</p>)}
    {rows.filter(r => r.suggestion).map(r => <p key={`s-${r.task}`} className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-2">
      <span>{`${labels[r.task]} — ${t.suggestion} ${r.suggestion!.label}`}</span>
      <Button onClick={() => void act('assistant.task.set', { task: r.task, choice: r.suggestion!.choice })}>{`${t.apply} (${labels[r.task]})`}</Button>
    </p>)}
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </div>;
}
