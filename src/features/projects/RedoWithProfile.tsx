import { useEffect, useRef, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { fill } from './selectionFormat';

export type ProfileOption = { id: string; label: string; model: string | null; cli: boolean };
type Profile = { id: string; label: string; kind: string; model: string | null; endpoint: string | null; cli?: boolean; confirmed?: boolean };
type Estimate = { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null };
type Preview = { profile: { id: string; label: string; model: string | null }; paid: boolean; leavesMachine: boolean; estimate: Estimate };
/** Por que "refazer com outro perfil" não está disponível para a(s) Janela(s) de origem. */
export type Blocked = 'uncertain' | 'busy' | null;

const texts = {
  'pt-BR': {
    region: 'Refazer com outro perfil', pick: 'Perfil de Provedor', none: 'Escolha um perfil', go: 'Refazer com este perfil',
    note: 'Refaz as Janelas de origem deste candidato só desta vez. O perfil padrão não muda e as decisões já tomadas ficam.',
    noProfiles: 'Não há outro Perfil de Provedor cadastrado.',
    uncertain: 'Indisponível: a chamada de uma Janela de origem tem resultado incerto. Resolva a incerteza na fila antes de refazer.',
    busy: 'Indisponível: uma Janela de origem ainda está na fila ou em andamento.',
    title: 'Refazer com {profile}?', body: 'Refaz {windows} com {profile}{model}. Custo estimado: {cost}.',
    windowsOne: 'a Janela {list}', windowsMany: 'as Janelas {list}',
    leaves: 'O texto da Transcrição sai da máquina e vai ao Provedor remoto deste perfil.', stays: 'O texto fica nesta máquina: o perfil é local.',
    free: 'sem custo (modelo local)', unknown: 'custo desconhecido', quota: 'consome a cota do plano', range: 'entre US$ {min} e US$ {max}',
    confirm: 'Confirmar e refazer', cancel: 'Cancelar', started: 'Refazendo com {profile}. Os candidatos novos entram como uma nova revisão.',
    errors: {
      local_only_violation: 'Este perfil é remoto e o modo "somente local" está ligado (na Tarefa ou no Projeto). Nada foi enviado.',
      window_uncertain: 'A chamada de uma Janela de origem tem resultado incerto: resolva a incerteza antes de refazer.',
      window_not_redoable: 'Só uma Janela concluída, que falhou ou foi cancelada pode ser refeita.',
      invalid_settings: 'Perfil de Provedor não encontrado.', confirmation_required: 'É preciso confirmar o perfil e o custo.',
      default: 'Não foi possível refazer com este perfil.',
    } as Record<string, string>,
  },
  en: {
    region: 'Redo with another profile', pick: 'Provider Profile', none: 'Choose a profile', go: 'Redo with this profile',
    note: 'Redoes this candidate\'s source windows just this once. The default profile does not change and the decisions already made stay.',
    noProfiles: 'There is no other Provider Profile saved.',
    uncertain: 'Unavailable: the call of a source window has an uncertain result. Resolve the uncertainty in the queue before redoing.',
    busy: 'Unavailable: a source window is still queued or running.',
    title: 'Redo with {profile}?', body: 'Redoes {windows} with {profile}{model}. Estimated cost: {cost}.',
    windowsOne: 'window {list}', windowsMany: 'windows {list}',
    leaves: 'The Transcript text leaves this machine and goes to this profile\'s remote Provider.', stays: 'The text stays on this machine: the profile is local.',
    free: 'free (local model)', unknown: 'cost unknown', quota: 'uses your plan quota', range: 'between US$ {min} and US$ {max}',
    confirm: 'Confirm and redo', cancel: 'Cancel', started: 'Redoing with {profile}. The new candidates arrive as a new revision.',
    errors: {
      local_only_violation: 'This profile is remote and "local only" is on (for the Task or the Project). Nothing was sent.',
      window_uncertain: 'The call of a source window has an uncertain result: resolve the uncertainty before redoing.',
      window_not_redoable: 'Only a window that finished, failed or was cancelled can be redone.',
      invalid_settings: 'Provider Profile not found.', confirmation_required: 'The profile and the cost must be confirmed.',
      default: 'Could not redo with this profile.',
    } as Record<string, string>,
  },
};
const usd = (micro: number) => (micro / 1_000_000).toFixed(4);

/** Perfis de Provedor que o usuário pode escolher (sem CLI ainda não confirmado). */
export function useProfiles(): ProfileOption[] {
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  useEffect(() => {
    let active = true;
    coreDispatch<{ profiles: Profile[] }>('provider.profiles.list', {}).then(answer => {
      if (!active) return;
      setProfiles(answer.profiles.filter(p => (p.cli ? p.confirmed : !!p.endpoint)).map(p => ({ id: p.id, label: p.label, model: p.model, cli: !!p.cli })));
    }).catch(() => { if (active) setProfiles([]); });
    return () => { active = false; };
  }, []);
  return profiles;
}

/**
 * "Refazer com o forte" (#126; ADR-0010, regra 4): o usuário escolhe OUTRO Perfil de Provedor e o
 * app refaz a(s) Janela(s) de onde o candidato veio. Antes de rodar, o diálogo mostra o perfil, o
 * custo estimado e se o texto sai da máquina, e exige confirmação. Nunca troca o padrão.
 */
export function RedoWithProfile({ run, windows, currentProfile, profiles, blocked, onStarted }: { run: number; windows: number[]; currentProfile: string; profiles: ProfileOption[]; blocked: Blocked; onStarted: () => void }) {
  const t = useText(texts);
  const [choice, setChoice] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState('');
  const focus = useRef<HTMLButtonElement>(null);
  const options = profiles.filter(p => p.id !== currentProfile);
  const code = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
  const fail = (e: unknown) => setError(t.errors[code(e)] ?? t.errors.default);

  async function ask() {
    setError(''); setStarted(''); setBusy(true);
    try { setPreview(await coreDispatch<Preview>('selection.estimate', { run, windows, profileId: choice })); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function confirm() {
    const chosen = preview;
    setPreview(null);
    if (!chosen) return;
    setBusy(true);
    try {
      await coreDispatch('selection.redo', { run, windows, profileId: chosen.profile.id, confirmed: true });
      setStarted(fill(t.started, { profile: chosen.profile.label }));
      onStarted();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  function costText(e: Estimate) {
    if (e.kind === 'zero') return t.free;
    if (e.kind === 'plan_quota') return t.quota;
    if (e.kind === 'usd' && e.minMicroUsd !== null && e.maxMicroUsd !== null) return fill(t.range, { min: usd(e.minMicroUsd), max: usd(e.maxMicroUsd) });
    return t.unknown;
  }
  const list = windows.map(n => n + 1).join(', ');
  return <section aria-label={t.region} data-redo-profile className="flex flex-col gap-2 border-t border-line pt-3">
    <strong>{t.region}</strong>
    {options.length === 0 ? <p className="text-fg-2">{t.noProfiles}</p> : <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2">{t.pick}
        <select className="h-8 rounded-md border border-line-strong bg-field px-2" value={choice} disabled={blocked !== null || busy} onChange={e => { setChoice(e.target.value); setError(''); }}>
          <option value="">{t.none}</option>
          {options.map(p => <option key={p.id} value={p.id}>{p.label}{p.model ? ` · ${p.model}` : ''}</option>)}
        </select>
      </label>
      <Button ref={focus} tamanho="sm" disabled={!choice || blocked !== null || busy} onClick={() => void ask()}>{t.go}</Button>
    </div>}
    {blocked && <p role="note" data-redo-blocked={blocked} className="text-fg-2">{blocked === 'uncertain' ? t.uncertain : t.busy}</p>}
    <p className="text-xs text-fg-2">{t.note}</p>
    {started && <p role="status" className="text-fg-2">{started}</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <ConfirmDialog open={preview !== null} onOpenChange={open => { if (!open) setPreview(null); }} title={fill(t.title, { profile: preview?.profile.label ?? '' })}
      description={preview ? fill(t.body, { windows: fill(windows.length === 1 ? t.windowsOne : t.windowsMany, { list }), profile: preview.profile.label, model: preview.profile.model ? ` (${preview.profile.model})` : '', cost: costText(preview.estimate) }) : ''}
      cancelLabel={t.cancel} confirmLabel={t.confirm} finalFocus={focus} onConfirm={() => void confirm()}>
      {preview && <p role="note" data-leaves-machine={preview.leavesMachine ? 'true' : 'false'} className={`mx-5 mb-3 rounded-md border border-line p-3 text-sm ${preview.leavesMachine ? 'bg-warning-subtle' : 'bg-field'}`}>{preview.leavesMachine ? t.leaves : t.stays}</p>}
    </ConfirmDialog>
  </section>;
}
