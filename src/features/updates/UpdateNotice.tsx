import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { Dialog as D } from '@base-ui/react/dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { Button } from '@/components/ui/Button';
import { useText } from '@/lib/i18n';
import { textos } from './texts';

type Estado =
  | { kind: 'closed' }
  | { kind: 'checking' }
  | { kind: 'available'; update: Update; currentVersion: string }
  | { kind: 'installing' }
  | { kind: 'installed' }
  | { kind: 'error'; message: string };

const mock = import.meta.env.VITE_UPDATER_MOCK === 'available';

async function verificar(): Promise<{ update: Update | null; currentVersion: string }> {
  if (!mock && !isTauri()) return { update: null, currentVersion: '' };
  const currentVersion = mock ? '0.1.0' : await getVersion();
  if (mock) {
    if (sessionStorage.getItem('clipes.mock-update-installed') === '1') return { update: null, currentVersion };
    return {
      currentVersion,
      update: {
        version: '0.2.0',
        body: 'Novidades de teste',
        date: '2026-11-13T00:00:00Z',
        currentVersion,
        downloadAndInstall: async () => {},
      } as Update,
    };
  }
  return { update: await check(), currentVersion };
}

const detalheErro = (error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  return `${reason} Atualizações sem assinatura válida são recusadas.`;
};

export function UpdateNotice() {
  const t = useText(textos);
  const [estado, setEstado] = useState<Estado>({ kind: 'checking' });

  useEffect(() => {
    let ativo = true;
    verificar()
      .then(({ update, currentVersion }) => {
        if (!ativo) return;
        setEstado(update ? { kind: 'available', update, currentVersion } : { kind: 'closed' });
      })
      .catch(error => {
        if (ativo) setEstado({ kind: 'error', message: detalheErro(error) });
      });
    return () => { ativo = false; };
  }, []);

  const atualizar = async () => {
    if (estado.kind !== 'available') return;
    setEstado({ kind: 'installing' });
    try {
      await estado.update.downloadAndInstall();
      if (mock) {
        sessionStorage.setItem('clipes.mock-update-installed', '1');
        setEstado({ kind: 'installed' });
      }
      else await relaunch();
    } catch (error) {
      setEstado({ kind: 'error', message: detalheErro(error) });
    }
  };

  const tentarNovamente = () => {
    setEstado({ kind: 'checking' });
    verificar()
      .then(({ update, currentVersion }) => setEstado(update ? { kind: 'available', update, currentVersion } : { kind: 'closed' }))
      .catch(error => setEstado({ kind: 'error', message: detalheErro(error) }));
  };

  if (estado.kind === 'closed' || estado.kind === 'checking') return null;

  if (estado.kind === 'error') return (
    <div role="status" className="fixed bottom-4 right-4 flex w-[min(420px,calc(100vw-32px))] flex-col gap-3 rounded-lg border border-line-strong bg-raised p-4 text-fg shadow-overlay" style={{ zIndex: 'var(--z-toast)' }}>
      <strong>{t.failed}</strong>
      <p role="alert" className="break-words text-fg-2">{estado.message}</p>
      <div className="flex justify-end gap-2"><Button onClick={() => setEstado({ kind: 'closed' })}>{t.close}</Button><Button variante="primario" onClick={tentarNovamente}>{t.retry}</Button></div>
    </div>
  );

  return (
    <D.Root open onOpenChange={open => { if (!open) setEstado({ kind: 'closed' }); }}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 bg-scrim" style={{ zIndex: 'var(--z-scrim)' }} />
        <D.Popup className="fixed top-[14vh] left-1/2 flex max-h-[76vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-y-auto rounded-xl border border-line-strong bg-surface p-5 text-fg shadow-dialog outline-none" style={{ zIndex: 'var(--z-dialog)' }}>
        {estado.kind === 'available' && <>
          <D.Title className="text-lg font-semibold">{t.available}</D.Title>
          <D.Description className="mt-2 text-fg-2">{t.version(estado.currentVersion, estado.update.version)}</D.Description>
          <h3 className="mt-5 font-medium">{t.notes}</h3>
          <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-fg-2">{estado.update.body?.trim() || t.noNotes}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setEstado({ kind: 'closed' })}>{t.later}</Button>
            <Button variante="primario" onClick={() => void atualizar()}>{t.install}</Button>
          </div>
        </>}
        {estado.kind === 'installing' && <div role="status" className="py-4"><D.Title className="text-lg font-semibold">{t.installing}</D.Title><D.Description className="mt-2 text-fg-2">{t.wait}</D.Description></div>}
        {estado.kind === 'installed' && <div role="status" className="py-4"><D.Title className="text-lg font-semibold">{t.installed}</D.Title><D.Description className="mt-2 text-fg-2">{t.relaunching}</D.Description><div className="mt-6 flex justify-end"><Button variante="primario" onClick={() => setEstado({ kind: 'closed' })}>{t.close}</Button></div></div>}
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}
