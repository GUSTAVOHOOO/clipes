import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';

type CatalogStatus = {
  version: number;
  embeddedVersion: number;
  source: 'embedded' | 'remote';
  warning: string | null;
  warningCode: string | null;
};

type CatalogCheckResult = {
  version: number;
  previousVersion: number;
  embeddedVersion: number;
  source: 'embedded' | 'remote';
  updated: boolean;
  upToDate: boolean;
  warning: string | null;
  warningCode: string | null;
};

const texts = {
  'pt-BR': {
    title: 'Catálogo de modelos',
    intro: 'Atualizações remotas são verificadas por assinatura Ed25519 e versão monotônica. Sem verificação válida, o app usa o catálogo embutido.',
    sourceEmbedded: 'embutido (offline)',
    sourceRemote: 'remoto assinado',
    versionLabel: 'Versão {version}',
    check: 'Verificar catálogo de modelos',
    checking: 'Verificando…',
    updated: 'Catálogo de modelos atualizado para a versão {version}.',
    upToDate: 'O catálogo de modelos já está na versão mais recente ({version}).',
  },
  en: {
    title: 'Model catalog',
    intro: 'Remote updates are verified by Ed25519 signature and monotonic version. Without valid verification, the app uses the embedded catalog.',
    sourceEmbedded: 'embedded (offline)',
    sourceRemote: 'signed remote',
    versionLabel: 'Version {version}',
    check: 'Check model catalog',
    checking: 'Checking…',
    updated: 'Model catalog updated to version {version}.',
    upToDate: 'Model catalog is already up to date (version {version}).',
  },
} as const;

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error);
}

/** Estado e verificação manual do catálogo assinado de modelos (#256). */
export function CatalogCard({ onUpdated }: { onUpdated?: () => void }) {
  const t = useText(texts);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  async function refresh() {
    setStatus(await coreDispatch<CatalogStatus>('components.catalog.status', {}));
  }

  useEffect(() => {
    refresh().catch(e => setErrorMsg(message(e)));
  }, []);

  async function checkCatalog() {
    setBusy(true);
    setNote('');
    setErrorMsg('');
    try {
      const res = await coreDispatch<CatalogCheckResult>('components.catalog.check', {});
      setNote(
        res.updated
          ? t.updated.replace('{version}', String(res.version))
          : t.upToDate.replace('{version}', String(res.version)),
      );
      if (res.updated) onUpdated?.();
    } catch (e) {
      setErrorMsg(message(e));
      onUpdated?.();
    } finally {
      setBusy(false);
      try {
        await refresh();
      } catch (e) {
        setErrorMsg(message(e));
      }
    }
  }

  const activeWarning = errorMsg || status?.warning || '';

  return (
    <article className="mt-6 rounded-md border border-line p-4" aria-labelledby="catalog-title" data-model-catalog>
      <h2 id="catalog-title" className="font-semibold">
        {t.title}{' '}
        {status && (
          <span className="font-normal text-fg-2">
            {t.versionLabel.replace('{version}', String(status.version))} ·{' '}
            {status.source === 'remote' ? t.sourceRemote : t.sourceEmbedded}
          </span>
        )}
      </h2>
      <p className="mt-2 text-fg-2">{t.intro}</p>
      {activeWarning && (
        <p className="mt-2 text-danger" role="alert">
          {activeWarning}
        </p>
      )}
      {note && (
        <p className="mt-2" role="status">
          {note}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={busy} onClick={() => void checkCatalog()}>
          {busy ? t.checking : t.check}
        </Button>
      </div>
    </article>
  );
}
