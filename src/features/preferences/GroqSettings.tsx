import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

const texts = {
  'pt-BR': { title:'Motor de transcrição', key:'Chave Groq', help:'A chave fica no cofre do sistema.', configured:'Chave configurada.', missing:'Chave não configurada.', save:'Salvar chave', test:'Testar chave', remove:'Remover chave', saved:'Chave salva.', tested:'Chave testada.', removed:'Chave removida.', failed:'Não foi possível concluir a operação.' },
  en: { title:'Transcription engine', key:'Groq key', help:'The key is stored in the system vault.', configured:'Key configured.', missing:'Key not configured.', save:'Save key', test:'Test key', remove:'Remove key', saved:'Key saved.', tested:'Key tested.', removed:'Key removed.', failed:'Could not complete the operation.' },
};
export function GroqSettings() {
  const t = useText(texts);
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function refresh() { const status = await coreDispatch<{configured:boolean}>('transcription.groq.key.status', {}); setConfigured(status.configured); }
  useEffect(() => { void refresh().catch(() => setMessage(t.failed)); }, [t.failed]);
  async function run(command: string, args: object, success: string) {
    setBusy(true); setMessage('');
    try { await coreDispatch(command, args); await refresh(); setMessage(success); }
    catch { setMessage(t.failed); }
    finally { setBusy(false); }
  }
  return <section id="transcription-settings" className="mt-10 max-w-xl border-t border-line pt-8" aria-labelledby="transcription-settings-title">
    <h2 id="transcription-settings-title" className="text-lg font-semibold">{t.title}</h2>
    <h3 className="mt-4 font-semibold">Groq</h3>
    <form className="mt-3 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); const submitted = key; setKey(''); void run('transcription.groq.key.set', {key:submitted}, t.saved); }}>
      <label>{t.key}<input className="foco mt-2 block h-9 w-full max-w-lg rounded-md border border-line-strong bg-field px-3 text-fg" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /></label>
      <p className="text-sm text-fg-2">{t.help}</p><p className="text-sm">{configured ? t.configured : t.missing}</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !key}>{t.save}</Button><Button type="button" disabled={busy || !configured} onClick={() => void run('transcription.groq.key.test', {}, t.tested)}>{t.test}</Button><Button type="button" disabled={busy || !configured} onClick={() => void run('transcription.groq.key.remove', {}, t.removed)}>{t.remove}</Button></div>
    </form>
    {message && <p className="mt-4 text-sm" role="status">{message}</p>}
  </section>;
}
