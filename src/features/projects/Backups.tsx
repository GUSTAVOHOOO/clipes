import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { Button } from '@/components/ui/Button';
import { useText } from '@/lib/i18n';

type Backup = { id: string; created_at: number; before_restore: boolean };
type Settings = { interval_seconds: number; copies: number; warning: { message: string } | null };
const texts = {
  'pt-BR': { title: 'Backups', intro: 'Cópias automáticas do banco do Projeto. O cache não é incluído.', interval: 'Intervalo (minutos)', copies: 'Cópias mantidas', save: 'Salvar configuração', create: 'Criar backup agora', empty: 'Nenhum backup disponível.', restore: 'Restaurar', preserved: 'Antes da restauração', confirm: 'Restaurar este backup? O estado atual será preservado em uma cópia antes da restauração.', failed: 'Não foi possível concluir a operação.', saved: 'Configuração salva.' },
  en: { title: 'Backups', intro: 'Automatic copies of the Project database. Cache is not included.', interval: 'Interval (minutes)', copies: 'Copies retained', save: 'Save settings', create: 'Create backup now', empty: 'No backups available.', restore: 'Restore', preserved: 'Before restore', confirm: 'Restore this backup? The current state will be preserved in a copy before restoring.', failed: 'The operation could not be completed.', saved: 'Settings saved.' },
};
export function Backups({ projectPath, onRestored }: { projectPath: string; onRestored: () => Promise<void> }) {
  const t = useText(texts);
  const [items, setItems] = useState<Backup[]>([]); const [minutes, setMinutes] = useState('30'); const [copies, setCopies] = useState('10');
  const [warning, setWarning] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function refresh() { const [list, settings] = await Promise.all([coreDispatch<Backup[]>('backups.list', {}), coreDispatch<Settings>('backups.settings.get', {})]); setItems(list); setWarning(settings.warning?.message ?? ''); return settings; }
  useEffect(() => { let active = true; (async () => { try { const s = await refresh(); if (active) { setMinutes(String(s.interval_seconds / 60)); setCopies(String(s.copies)); } } catch (e) { if (active) setError(String((e as {message?: string})?.message ?? e)); } })(); const timer = setInterval(() => { refresh().catch(() => {}); }, 10000); return () => { active = false; clearInterval(timer); }; }, [projectPath]);
  async function perform(action: () => Promise<unknown>, success = '') { setBusy(true); setError(''); setNotice(''); try { await action(); const s = await refresh(); setMinutes(String(s.interval_seconds / 60)); setCopies(String(s.copies)); setNotice(success); } catch (e) { setError(String((e as {message?: string})?.message ?? e)); } finally { setBusy(false); } }
  const intervalSeconds = Number(minutes) * 60; const copyCount = Number(copies);
  return <section className="mt-8 border-t border-line pt-6" aria-labelledby="backups-title">
    <h2 id="backups-title" className="text-base font-semibold">{t.title}</h2><p className="mt-2 text-sm text-fg-2">{t.intro}</p>
    {warning && <p role="alert" className="mt-3 text-danger">{warning}</p>}{error && <p role="alert" className="mt-3 text-danger">{t.failed} {error}</p>}{notice && <p role="status" className="mt-3">{notice}</p>}
    <div className="mt-4 flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-sm">{t.interval}<input className="foco h-8 w-32 rounded-md border border-line-strong bg-field px-3 text-fg" type="number" min="1" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} /></label><label className="flex flex-col gap-1 text-sm">{t.copies}<input className="foco h-8 w-32 rounded-md border border-line-strong bg-field px-3 text-fg" type="number" min="1" step="1" value={copies} onChange={e => setCopies(e.target.value)} /></label>
      <Button disabled={busy || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60 || !Number.isSafeInteger(copyCount) || copyCount < 1} onClick={() => perform(() => coreDispatch('backups.settings.set', {interval_seconds: intervalSeconds, copies: copyCount}), t.saved)}>{t.save}</Button><Button disabled={busy} onClick={() => perform(() => coreDispatch('backups.create', {}))}>{t.create}</Button></div>
    {items.length === 0 ? <p className="mt-4 text-sm text-fg-2">{t.empty}</p> : <ul className="mt-4 divide-y divide-line border-y border-line">{items.map(item => <li key={item.id} className="flex items-center justify-between gap-3 py-3"><span><time dateTime={new Date(item.created_at * 1000).toISOString()}>{new Date(item.created_at * 1000).toLocaleString()}</time>{item.before_restore && <> · {t.preserved}</>}</span><Button disabled={busy} onClick={() => { if (window.confirm(t.confirm)) void perform(async () => { await coreDispatch('backups.restore', {id: item.id}); await onRestored(); }); }}>{t.restore}</Button></li>)}</ul>}
  </section>;
}
