import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

const texts = {
  'pt-BR': {
    title: 'Privacidade do Projeto',
    label: 'Somente local',
    help: 'Nada deste Projeto sai da máquina: só modelos locais. Vale para todas as Tarefas de IA, inclusive “refazer com o forte”, e viaja com o Projeto.',
    detail: 'Local quer dizer só este computador. Servidor na rede local e CLIs contam como fora.',
    failed: 'Não foi possível salvar. Tente de novo.',
  },
  en: {
    title: 'Project privacy',
    label: 'Local only',
    help: 'Nothing from this Project leaves the machine: local models only. It covers every AI Task, including “redo with the strong one”, and travels with the Project.',
    detail: 'Local means this computer only. A server on the local network and CLIs count as outside.',
    failed: 'Could not save. Try again.',
  },
};

/** Interruptor do veto "somente local" do Projeto aberto (ADR-0010, regra 5). */
export function ProjectPrivacy({ projectId }: { projectId: string }) {
  const t = useText(texts);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setReady(false);
    coreDispatch<{ enabled: boolean }>('projects.local_only.get', {}).then(r => { setEnabled(r.enabled); setReady(true); }).catch(() => setError(t.failed));
  }, [projectId]);
  async function change(next: boolean) {
    setError('');
    try { const r = await coreDispatch<{ enabled: boolean }>('projects.local_only.set', { enabled: next }); setEnabled(r.enabled); }
    catch { setError(t.failed); }
  }
  return <section className="mt-8" aria-labelledby="project-privacy-title">
    <h2 id="project-privacy-title" className="text-base font-semibold">{t.title}</h2>
    <label className="mt-3 flex items-start gap-3 text-sm">
      <input type="checkbox" role="switch" className="foco mt-1" checked={enabled} disabled={!ready} onChange={e => void change(e.target.checked)} />
      <span><strong>{t.label}</strong><span className="mt-1 block text-fg-2">{t.help}</span><span className="mt-1 block text-fg-2">{t.detail}</span></span>
    </label>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </section>;
}
