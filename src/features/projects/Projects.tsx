import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { coreDispatch } from '@/lib/core';
import { Button } from '@/components/ui/Button';
import { useText } from '@/lib/i18n';
import { Sources } from './Sources';

type Project = { name: string; path: string; available: boolean };
const texts = {
  'pt-BR': { title:'Projetos', intro:'Crie um Projeto para seu canal ou abra uma pasta existente.', name:'Nome do Projeto', create:'Criar Projeto', opening:'Abrir pasta', recent:'Recentes', empty:'Nenhum Projeto recente.', unavailable:'Indisponível', current:'Projeto aberto', error:'Não foi possível abrir o Projeto.' },
  en: { title:'Projects', intro:'Create a Project for your channel or open an existing folder.', name:'Project name', create:'Create Project', opening:'Open folder', recent:'Recent', empty:'No recent Projects.', unavailable:'Unavailable', current:'Open Project', error:'Could not open the Project.' },
};
export function Projects() {
  const t = useText(texts);
  const [items, setItems] = useState<Project[]>([]); const [name, setName] = useState('');
  const [current, setCurrent] = useState<Project | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function refresh() { setItems(await coreDispatch<Project[]>('projects.recent', {})); }
  useEffect(() => { refresh().catch((e) => setError(String(e?.message ?? e))); }, []);
  async function perform(action: () => Promise<Project | null>) {
    setError(''); setBusy(true);
    try { const result = await action(); if (result) { setCurrent(result); await refresh(); } }
    catch (e) { setError(String((e as {message?: string})?.message ?? e)); }
    finally { setBusy(false); }
  }
  async function choose() { return await open({ directory:true, multiple:false }); }
  return <section className="mx-auto max-w-4xl px-8 py-10">
    <h1 className="text-xl font-semibold">{t.title}</h1><p className="mt-2 text-fg-2">{t.intro}</p>
    <div className="mt-6 flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-sm">{t.name}<input className="foco h-8 rounded-md border border-line-strong bg-field px-3 text-fg" value={name} onChange={e => setName(e.target.value)} /></label>
      <Button variante="primario" disabled={!name.trim() || busy} onClick={() => perform(async () => { const parent = await choose(); return parent ? coreDispatch<Project>('projects.create', {parent,name}) : null; })}>{t.create}</Button>
      <Button disabled={busy} onClick={() => perform(async () => { const path = await choose(); return path ? coreDispatch<Project>('projects.open', {path}) : null; })}>{t.opening}</Button></div>
    {error && <p role="alert" className="mt-4 text-danger">{t.error} {error}</p>}
    {current && <p className="mt-6 text-sm">{t.current}: <strong>{current.name}</strong></p>}
    {current && <Sources project={current.path} />}
    <h2 className="mt-8 text-base font-semibold">{t.recent}</h2>
    {items.length === 0 ? <p className="mt-3 text-fg-2">{t.empty}</p> : <ul className="mt-3 divide-y divide-line border-y border-line">{items.map(item => <li key={item.path} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><strong>{item.name}</strong><p className="break-all text-sm text-fg-2">{item.path}</p></div>{item.available ? <Button disabled={busy} onClick={() => perform(() => coreDispatch<Project>('projects.open', {path:item.path}))}>{t.opening}</Button> : <span className="text-sm text-fg-2">{t.unavailable}</span>}</li>)}</ul>}
  </section>;
}
