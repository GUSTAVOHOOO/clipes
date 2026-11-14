import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { coreDispatch } from '@/lib/core';
import { Button } from '@/components/ui/Button';
import { useText } from '@/lib/i18n';
import { texts } from './texts';

type Kind = 'bug' | 'idea' | 'provider';
const templates: Record<Kind, string> = { bug: 'bug.yml', idea: 'ideia.yml', provider: 'provedor-modelo.yml' };
const base = 'https://github.com/GUSTAVOHOOO/clipes/issues/new';
async function copy(text: string) { if (isTauri()) await writeText(text); else await navigator.clipboard.writeText(text); }
export function Report() {
  const t = useText(texts);
  const [kind, setKind] = useState<Kind>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [diagnostic, setDiagnostic] = useState('');
  const [include, setInclude] = useState(true);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { coreDispatch<{text:string}>('diagnostic.get', {}).then(v => setDiagnostic(v.text)).catch(() => setStatus(t.loadError)); }, [t.loadError]);
  const choose = (next: Kind) => { setKind(next); setInclude(next === 'bug'); setPreview(false); setStatus(''); };
  const fullText = [description, include && diagnostic ? `${t.diagnostic}\n${diagnostic}` : ''].filter(Boolean).join('\n\n');
  const issueUrl = (body: string) => `${base}?${new URLSearchParams({ template: templates[kind], title, body }).toString()}`;
  const action = async (fn: () => Promise<void>, success: string) => { try { await fn(); setStatus(success); } catch { setStatus(t.actionError); } };
  const exportDiagnostic = async () => {
    if (isTauri()) {
      const path = await save({ defaultPath: 'diagnostico-clipes.txt', filters: [{ name: 'Texto', extensions: ['txt'] }] });
      if (path) await coreDispatch('diagnostic.export', { path, text: diagnostic });
    } else {
      const url = URL.createObjectURL(new Blob([diagnostic], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'diagnostico-clipes.txt'; a.click(); URL.revokeObjectURL(url);
    }
  };
  const send = async () => {
    let copiedDiagnostic = false;
    let url = issueUrl(fullText);
    if (new TextEncoder().encode(url).length > 8000 && include && diagnostic) {
      await copy(diagnostic);
      url = issueUrl(`${description}\n\n${t.copiedForPaste}`);
      if (new TextEncoder().encode(url).length > 8000) throw new Error('too long');
      copiedDiagnostic = true;
    }
    if (new TextEncoder().encode(url).length > 8000) throw new Error('too long');
    if (isTauri()) await openUrl(url); else window.open(url, '_blank', 'noopener,noreferrer');
    return copiedDiagnostic;
  };
  return <article className="mx-auto max-w-4xl px-8 py-10"><h1 className="text-xl font-semibold">{t.heading}</h1>
    <div className="mt-4 flex flex-wrap gap-2">{(['bug','idea','provider'] as const).map(k => <Button key={k} onClick={() => choose(k)} aria-pressed={kind === k}>{t[k]}</Button>)}</div>
    <p className="mt-5 text-fg-2">{t.intro}</p>
    <label className="mt-5 block font-semibold">{t.title}<input className="mt-2 block w-full rounded border border-line bg-canvas p-2 font-normal" value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label className="mt-5 block font-semibold">{t.description}<textarea className="mt-2 block min-h-32 w-full rounded border border-line bg-canvas p-2 font-normal" value={description} onChange={e => setDescription(e.target.value)} /></label>
    {/token|chave|\bkey\b/i.test(`${title} ${description}`) && <p role="alert" className="mt-2 text-fg-2">{t.warning}</p>}
    <label className="mt-5 flex items-center gap-2"><input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)} />{t.include}</label>
    {!preview ? <Button className="mt-5" onClick={() => setPreview(true)}>{t.review}</Button> : <section className="mt-6"><h2 className="text-lg font-semibold">{t.reviewHeading}</h2><p className="mt-2 text-fg-2">{t.reviewHelp}</p>
      {include && <label className="mt-4 block font-semibold">{t.diagnostic}<textarea aria-label={t.diagnostic} className="mt-2 block min-h-48 w-full rounded border border-line bg-canvas p-2 font-mono text-sm font-normal" value={diagnostic} onChange={e => setDiagnostic(e.target.value)} /></label>}
      <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => void action(() => copy(fullText), t.copied)}>{t.copy}</Button><Button onClick={() => void action(exportDiagnostic, t.exported)}>{t.export}</Button><Button onClick={() => void (async () => { try { setStatus(await send() ? t.copiedForPaste : t.opened); } catch { setStatus(t.actionError); } })()}>{t.send}</Button><Button onClick={() => setPreview(false)}>{t.back}</Button></div>
    </section>}
    {status && <p className="mt-4 text-fg-2" role="status">{status}</p>}
  </article>;
}
