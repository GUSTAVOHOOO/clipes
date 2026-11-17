import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export type TtsEngine = {
  id: string;
  label: string;
  componentId: string;
  codeLicense: string;
  sourceUrl: string;
  prohibitedUse: { textEn: string; summaryPt: string; version: string };
};

export type TtsModel = {
  id: string;
  engineId: string;
  language: string;
  label: string;
  description: string;
  defaultForLanguage: boolean;
  lightweight: boolean;
  active: boolean;
  installed: boolean;
  termsAccepted: boolean;
  repo: string;
  revision: string;
  license: string;
  sourceUrl: string;
  size: number;
};

export type TtsVoice = {
  id: string;
  engineId: string;
  language: string;
  gender: string;
  label: string;
  defaultForLanguage: boolean;
  license: string;
  attribution: string;
  sourceUrl: string;
  models: string[];
  installedModels: string[];
};

export type TtsCatalog = {
  componentInstalled: boolean;
  activeModels: Record<string, string>;
  engines: TtsEngine[];
  models: TtsModel[];
  voices: TtsVoice[];
};

type Progress = { job: string; stage: string; percentage: number };

const texts = {
  'pt-BR': {
    title: 'Modelos e vozes de Narração (TTS)',
    intro: 'Modelos locais baixados sem login nem token do Hugging Face, com revisão e SHA-256 fixados.',
    installed: 'Instalado',
    missing: 'Não instalado',
    active: 'Em uso como padrão',
    setActive: 'Usar como padrão',
    download: 'Baixar modelo TTS',
    reinstall: 'Baixar de novo',
    cancel: 'Cancelar',
    progress: 'Progresso do download do modelo TTS',
    done: 'Modelo TTS instalado.',
    source: 'Fonte e licença do modelo',
    voicesTitle: 'Vozes incluídas (uso comercial permitido)',
    confirmTitle: 'Baixar modelo TTS?',
    confirmDescription: '{label}: o download tem {size} e inclui os embeddings de voz prontos.',
    details: 'Detalhes e licenças',
    codeLicense: 'Licença do motor',
    weightsLicense: 'Licença dos pesos',
    size: 'Tamanho',
    revision: 'Revisão',
    integrity: 'Todos os arquivos e embeddings são conferidos pelo SHA-256.',
    prohibitedTitle: 'Uso proibido pelo autor do modelo',
    acceptTerms: 'Li e aceito o termo de uso proibido do modelo',
    cancelDialog: 'Cancelar',
    confirm: 'Baixar modelo',
  },
  en: {
    title: 'Narration TTS models and voices',
    intro: 'Local models downloaded without Hugging Face login or token, with pinned revision and SHA-256.',
    installed: 'Installed',
    missing: 'Not installed',
    active: 'Active default',
    setActive: 'Use as default',
    download: 'Download TTS model',
    reinstall: 'Download again',
    cancel: 'Cancel',
    progress: 'TTS model download progress',
    done: 'TTS model installed.',
    source: 'Model source and license',
    voicesTitle: 'Included voices (commercial use permitted)',
    confirmTitle: 'Download TTS model?',
    confirmDescription: '{label}: the download is {size} and includes ready-to-use voice embeddings.',
    details: 'Details and licenses',
    codeLicense: 'Engine license',
    weightsLicense: 'Weights license',
    size: 'Size',
    revision: 'Revision',
    integrity: 'All files and embeddings are verified by SHA-256.',
    prohibitedTitle: 'Prohibited use by the model author',
    acceptTerms: 'I have read and accept the model prohibited-use terms',
    cancelDialog: 'Cancel',
    confirm: 'Download model',
  },
} as const;

const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);
}

/** Catálogo extensível de modelos e vozes TTS (#79): renderiza motores/modelos vindos do núcleo sem código fixo. */
export function TtsCatalogCard({ refreshKey }: { refreshKey?: number }) {
  const t = useText(texts);
  const [catalog, setCatalog] = useState<TtsCatalog | null>(null);
  const [confirming, setConfirming] = useState<TtsModel | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState('');
  const focus = useRef<HTMLButtonElement | null>(null);

  async function refresh() {
    setCatalog(await coreDispatch<TtsCatalog>('tts.catalog', {}));
  }

  useEffect(() => {
    refresh().catch(e => setNote(message(e)));
  }, [refreshKey]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => {
      if (e.payload.job.startsWith('tts:') && e.payload.stage === 'download') {
        setProgress(e.payload.percentage);
      }
    }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  async function download(model: TtsModel) {
    setConfirming(null);
    setBusy(model.id);
    setProgress(0);
    setNote('');
    try {
      await coreDispatch('tts.models.download', { id: model.id, confirmed: true, termsAccepted: true });
      setNote(t.done);
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy(null);
      try { await refresh(); } catch (e) { setNote(message(e)); }
    }
  }

  async function chooseActive(model: TtsModel) {
    setNote('');
    try {
      setCatalog(await coreDispatch<TtsCatalog>('tts.models.choose', { language: model.language, modelId: model.id }));
    } catch (e) {
      setNote(message(e));
    }
  }

  if (!catalog) return note ? <p className="mt-4 text-danger" role="alert">{note}</p> : null;

  const confirmingEngine = confirming ? catalog.engines.find(e => e.id === confirming.engineId) : undefined;

  return (
    <section className="mt-6" aria-labelledby="tts-catalog-title" data-tts-catalog>
      <h2 id="tts-catalog-title" className="font-semibold">{t.title}</h2>
      <p className="mt-2 text-fg-2">{t.intro}</p>
      {note && <p className="mt-2" role="status">{note}</p>}
      <div className="mt-3 space-y-4">
        {catalog.models.map(model => {
          const engine = catalog.engines.find(e => e.id === model.engineId);
          const voices = catalog.voices.filter(v => v.models.includes(model.id));
          return (
            <article key={model.id} className="rounded-md border border-line p-4" aria-label={model.label} data-tts-model={model.id}>
              <h3 className="font-semibold">
                {model.label}{' '}
                <span className="font-normal text-fg-2">
                  {model.installed ? t.installed : t.missing}
                  {model.active ? ` · ${t.active}` : ''}
                </span>
              </h3>
              <p className="mt-1 text-sm text-fg-2">{model.description}</p>
              <p className="mt-2 text-sm">
                {formatSize(model.size)} · {engine?.label ?? model.engineId} ({engine?.codeLicense ?? 'MIT'}) · {model.license} ·{' '}
                <a className="underline" href={model.sourceUrl} target="_blank" rel="noreferrer">{t.source}</a>
              </p>
              {voices.length > 0 && (
                <div className="mt-2 text-xs text-fg-2">
                  <span className="font-medium text-fg">{t.voicesTitle}: </span>
                  {voices.map((v, idx) => (
                    <span key={v.id}>
                      {idx > 0 ? '; ' : ''}
                      {v.label} ({v.license} — <a className="underline" href={v.sourceUrl} target="_blank" rel="noreferrer">{v.id}</a>)
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  disabled={!!busy}
                  onClick={e => {
                    focus.current = e.currentTarget;
                    setAccepted(false);
                    setConfirming(model);
                  }}
                >
                  {model.installed ? t.reinstall : t.download}
                </Button>
                {!model.active && (
                  <Button disabled={!!busy} onClick={() => void chooseActive(model)}>
                    {t.setActive}
                  </Button>
                )}
                {busy === model.id && (
                  <>
                    <progress max={100} value={progress} aria-label={t.progress} />
                    <Button onClick={() => { void coreDispatch('tts.models.cancel', { id: model.id }); }}>{t.cancel}</Button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={open => { if (!open) setConfirming(null); }}
        title={t.confirmTitle}
        description={confirming ? t.confirmDescription.replace('{size}', formatSize(confirming.size)).replace('{label}', confirming.label) : ''}
        cancelLabel={t.cancelDialog}
        confirmLabel={t.confirm}
        confirmDisabled={!accepted}
        finalFocus={focus}
        onConfirm={() => { if (confirming && accepted) void download(confirming); }}
      >
        {confirming && (
          <div className="overflow-y-auto px-5 pb-3 text-sm">
            <p className="font-semibold">{t.details}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-fg-2">
              <li>{t.codeLicense}: {confirmingEngine?.codeLicense ?? 'MIT'}</li>
              <li>{t.weightsLicense}: {confirming.license}</li>
              <li>{t.size}: {formatSize(confirming.size)}</li>
              <li>{t.revision}: <code>{confirming.revision.slice(0, 12)}</code></li>
              <li>{t.integrity}</li>
              <li><a className="underline" href={confirming.sourceUrl} target="_blank" rel="noreferrer">{t.source}</a></li>
            </ul>
            {confirmingEngine?.prohibitedUse && (
              <div className="mt-3 rounded-md border border-line bg-field p-3 text-xs" data-tts-prohibited-use>
                <p className="font-semibold text-fg">{t.prohibitedTitle}</p>
                <p className="mt-1 text-fg-2">{confirmingEngine.prohibitedUse.summaryPt}</p>
                <blockquote className="mt-2 border-l-2 border-line-strong pl-2 text-fg-2">
                  {confirmingEngine.prohibitedUse.textEn}
                </blockquote>
                <label className="mt-3 flex items-center gap-2 text-fg">
                  <input
                    type="checkbox"
                    className="foco"
                    checked={accepted}
                    onChange={e => setAccepted(e.target.checked)}
                  />
                  <span>{t.acceptTerms}</span>
                </label>
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
