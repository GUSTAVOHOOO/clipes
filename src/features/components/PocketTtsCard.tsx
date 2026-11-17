import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Item = { id: string; version: string; size: number; license: string; source_url: string };
type Status = { installed: boolean; version: string | null; pinned: string | null; outdated: boolean };
type Progress = { job: string; stage: string; percentage: number };

const texts = {
  'pt-BR': {
    title: 'Pocket TTS (motor de Narração)',
    intro: 'Binário Rust oficial da Kyutai usado para gerar a Narração por TTS localmente em CPU, sem Python nem PyTorch. Baixado só com a sua confirmação.',
    installed: 'Instalado',
    missing: 'Não instalado',
    pinned: 'Versão deste app',
    install: 'Baixar Pocket TTS',
    update: 'Atualizar Pocket TTS',
    outdated: 'Há uma versão mais nova do Pocket TTS neste app.',
    source: 'Código-fonte',
    cancel: 'Cancelar',
    cancelDialog: 'Cancelar',
    progress: 'Progresso do download do Pocket TTS',
    confirmInstallTitle: 'Baixar o Pocket TTS?',
    confirmUpdateTitle: 'Atualizar o Pocket TTS?',
    confirmDescription: 'pocket-tts {version} ({size} MB), licença {license}, baixado de github.com/kyutai-labs/pocket-tts e conferido por SHA-256.',
    confirmInstall: 'Baixar',
    confirmUpdate: 'Atualizar',
    done: 'Pocket TTS instalado.',
  },
  en: {
    title: 'Pocket TTS (Narration engine)',
    intro: 'Official Kyutai Rust binary used to synthesize Narration TTS locally on CPU, with no Python or PyTorch. Downloaded only with your confirmation.',
    installed: 'Installed',
    missing: 'Not installed',
    pinned: 'Version in this app',
    install: 'Download Pocket TTS',
    update: 'Update Pocket TTS',
    outdated: 'This app ships a newer Pocket TTS.',
    source: 'Source code',
    cancel: 'Cancel',
    cancelDialog: 'Cancel',
    progress: 'Pocket TTS download progress',
    confirmInstallTitle: 'Download Pocket TTS?',
    confirmUpdateTitle: 'Update Pocket TTS?',
    confirmDescription: 'pocket-tts {version} ({size} MB), {license} license, downloaded from github.com/kyutai-labs/pocket-tts and checked by SHA-256.',
    confirmInstall: 'Download',
    confirmUpdate: 'Update',
    done: 'Pocket TTS installed.',
  },
} as const;

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);
}

/** Componente executável `pocket-tts` (#79): licença MIT, SHA-256 fixado e confirmação explícita. */
export function PocketTtsCard({ item, onChanged }: { item?: Item; onChanged?: () => void }) {
  const t = useText(texts);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const focus = useRef<HTMLButtonElement>(null);

  async function refresh() {
    setStatus(await coreDispatch<Status>('components.pocket_tts.status', {}));
  }

  useEffect(() => {
    refresh().catch(e => setNote(message(e)));
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => {
      if (e.payload.job === 'pocket-tts' && e.payload.stage === 'download') setProgress(e.payload.percentage);
    }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  async function install() {
    setConfirming(false);
    setBusy(true);
    setProgress(0);
    setNote('');
    try {
      await coreDispatch('components.download', { id: 'pocket-tts', confirmed: true });
      setNote(t.done);
      onChanged?.();
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy(false);
      try { await refresh(); } catch (e) { setNote(message(e)); }
    }
  }

  if (!item) return null;
  const updating = !!status?.installed && status.outdated;
  return (
    <article className="mt-4 rounded-md border border-line p-4" aria-labelledby="pocket-tts-title">
      <h2 id="pocket-tts-title" className="font-semibold">
        {t.title}{' '}
        <span className="font-normal text-fg-2">
          {status?.installed ? `${t.installed} ${status.version ?? ''}` : status ? t.missing : ''}
        </span>
      </h2>
      <p className="mt-2 text-fg-2">{t.intro}</p>
      {updating && <p className="mt-2">{t.outdated}</p>}
      <p className="mt-2">
        {t.pinned} {item.version} · {(item.size / 1_000_000).toFixed(1)} MB · {item.license} ·{' '}
        <a className="underline" href={item.source_url} target="_blank" rel="noreferrer">{t.source}</a>
      </p>
      {note && <p className="mt-3" role="status">{note}</p>}
      <div className="mt-3 flex items-center gap-3">
        {(!status?.installed || updating) && (
          <Button ref={focus} disabled={busy} onClick={() => setConfirming(true)}>
            {updating ? t.update : t.install}
          </Button>
        )}
        {busy && (
          <>
            <progress max={100} value={progress} aria-label={t.progress} />
            <Button onClick={() => { void coreDispatch('components.cancel', { id: 'pocket-tts' }); }}>{t.cancel}</Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={updating ? t.confirmUpdateTitle : t.confirmInstallTitle}
        description={t.confirmDescription
          .replace('{version}', item.version)
          .replace('{size}', (item.size / 1_000_000).toFixed(1))
          .replace('{license}', item.license)}
        cancelLabel={t.cancelDialog}
        confirmLabel={updating ? t.confirmUpdate : t.confirmInstall}
        finalFocus={focus}
        onConfirm={() => void install()}
      />
    </article>
  );
}
