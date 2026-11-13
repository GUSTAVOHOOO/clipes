import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { texts } from './texts';
import notices from '../../../THIRD_PARTY_NOTICES.md?raw';
import license from '../../../LICENSE?raw';
export function About() {
  const t = useText(texts);
  const [version, setVersion] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => { coreDispatch<{version:string}>('app.version', {}).then(v => setVersion(v.version)).catch(() => setError(true)); }, []);
  return <article className="mx-auto max-w-4xl px-8 py-10"><h1 className="text-xl font-semibold">{t.title}</h1><p className="mt-3 text-fg-2">{error ? t.error : version ? `${t.version} ${version}` : t.loading}</p><h2 className="mt-8 text-lg font-semibold">Apache-2.0</h2><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-fg-2">{license}</pre><h2 className="mt-8 text-lg font-semibold">{t.licenses}</h2><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-fg-2">{notices}</pre></article>;
}
