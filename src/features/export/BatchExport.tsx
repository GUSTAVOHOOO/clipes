import { useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  ackDirectMonetizationNotice,
  checkGuardrails,
  DirectMonetizationDialog,
  GuardrailsChecklist,
} from '@/features/guardrails/GuardrailsPanel';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

type BatchItem = {
  position: number;
  sourceId: number;
  candidateId: number;
  clipId: number | null;
  jobId: number | null;
  title: string;
  filename: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: { code: string; message?: string } | null;
  encoderFallback?: { from: string; reason: string } | null;
};

type BatchView = {
  id: number;
  scope: 'source' | 'project';
  sourceId: number | null;
  outputDir: string;
  state: 'running' | 'completed' | 'cancelled';
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  progress: number;
  counts: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  items: BatchItem[];
};

type Props =
  | { scope: 'source'; sourceId: number }
  | { scope: 'project'; project: string; projectId: string };

type ConflictPending = { outputDir: string; conflicts: string[] };
type CoreFail = { code?: string; usage?: { conflicts?: string[] } };

const texts = {
  'pt-BR': {
    sectionTitle: 'Export em lote',
    intro: 'Exporte de uma vez todos os Cortes aprovados do Projeto para uma pasta.',
    exportApproved: 'Exportar aprovados',
    pickDir: 'Escolher pasta de saída',
    cancel: 'Cancelar lote',
    totalProgress: 'Progresso total do lote',
    cutProgress: 'Progresso de {name}',
    summary: '{completed} de {total} Cortes exportados',
    failedCount: '{count} com falha',
    cancelledCount: '{count} cancelados',
    status: {
      running: 'Em andamento',
      completed: 'Concluído',
      partial: 'Concluído com falhas',
      failed: 'Falhou',
      cancelled: 'Cancelado',
    },
    itemState: {
      queued: 'Na fila',
      running: 'Exportando',
      completed: 'Exportado',
      failed: 'Falhou',
      cancelled: 'Cancelado',
    },
    fallback: 'Encoder de hardware falhou; exportado com x264.',
    confirmTitle: 'Sobrescrever arquivos existentes?',
    confirmBody: 'Os seguintes arquivos já existem na pasta escolhida e serão substituídos:',
    confirmAction: 'Confirmar e sobrescrever',
    cancelDialog: 'Cancelar',
    errors: {
      export_batch_empty: 'Nenhum Corte aprovado para exportar.',
      export_destination: 'Escolha uma pasta existente para salvar os Cortes.',
      source_missing: 'Fonte não encontrada.',
      source_changed: 'A Fonte está indisponível ou foi alterada.',
      component_missing: 'Instale o Componente FFmpeg em Componentes.',
      export_ass_missing: 'O FFmpeg instalado não tem suporte a legendas. Escolha uma versão com libass em Componentes.',
      export_font_missing: 'A fonte da legenda não foi carregada. Verifique o Componente FFmpeg.',
      export_bounds: 'As bordas do Corte devem coincidir com Frases da Transcrição completa.',
      export_candidate: 'Aprove o candidato e use as bordas atuais da revisão.',
      export_exists: 'Já existe um arquivo no destino.',
      export_failed: 'Não foi possível exportar o Corte.',
      default: 'Não foi possível exportar o lote.',
    } as Record<string, string>,
  },
  en: {
    sectionTitle: 'Batch export',
    intro: 'Export all approved Clips in the Project at once into a single folder.',
    exportApproved: 'Export approved',
    pickDir: 'Choose output folder',
    cancel: 'Cancel batch',
    totalProgress: 'Total batch progress',
    cutProgress: 'Progress of {name}',
    summary: '{completed} of {total} Clips exported',
    failedCount: '{count} failed',
    cancelledCount: '{count} cancelled',
    status: {
      running: 'Running',
      completed: 'Completed',
      partial: 'Completed with errors',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    itemState: {
      queued: 'Queued',
      running: 'Exporting',
      completed: 'Exported',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    fallback: 'Hardware encoder failed; exported with x264.',
    confirmTitle: 'Overwrite existing files?',
    confirmBody: 'The following files already exist in the chosen folder and will be replaced:',
    confirmAction: 'Confirm and overwrite',
    cancelDialog: 'Cancel',
    errors: {
      export_batch_empty: 'No approved Clips to export.',
      export_destination: 'Choose an existing folder to save the Clips.',
      source_missing: 'Source not found.',
      source_changed: 'The Source is unavailable or has changed.',
      component_missing: 'Install the FFmpeg Component in Components.',
      export_ass_missing: 'The installed FFmpeg does not support subtitles. Choose a build with libass in Components.',
      export_font_missing: 'The subtitle font could not be loaded. Check the FFmpeg Component.',
      export_bounds: 'Clip borders must match Sentences in the complete Transcript.',
      export_candidate: 'Approve the candidate and use its current review borders.',
      export_exists: 'A file already exists at this destination.',
      export_failed: 'Could not export the Clip.',
      default: 'Could not run batch export.',
    } as Record<string, string>,
  },
};

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

/** Export em lote (#64): todos os Cortes aprovados de uma Fonte ou do Projeto. */
export function BatchExport(props: Props) {
  const t = useText(texts);
  const [batches, setBatches] = useState<BatchView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<ConflictPending | null>(null);
  const [directNoticeOpen, setDirectNoticeOpen] = useState(false);
  const focus = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const scopeArgs = props.scope === 'source' ? { source_id: props.sourceId } : {};
  const load = useCallback(async () => {
    const list = await coreDispatch<BatchView[]>('export.batch.list', scopeArgs);
    if (alive.current) {
      setBatches(props.scope === 'source' ? list : list.filter(b => b.scope === 'project'));
    }
  }, [props.scope, props.scope === 'source' ? props.sourceId : props.projectId]);

  const anyRunning = batches.some(b => b.state === 'running');
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = () => { if (active) void load().catch(() => {}); };
    sync();
    listen<{ job?: string; project?: string }>('core-progress', event => {
      const matchProject = props.scope === 'project' ? event.payload.project === props.projectId : true;
      if (matchProject && (!event.payload.job || event.payload.job.startsWith('export'))) sync();
    }).then(fn => { if (active) unlisten = fn; else fn(); }).catch(() => {});
    const timer = anyRunning ? window.setInterval(sync, 500) : undefined;
    return () => {
      active = false;
      unlisten?.();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [load, anyRunning, props.scope, props.scope === 'project' ? props.projectId : 0]);

  async function start(outputDir: string, confirmed: boolean) {
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...(props.scope === 'source' ? { source_id: props.sourceId } : { project: props.project }),
        output_dir: outputDir,
        ...(confirmed ? { confirmed: true } : {}),
      };
      await coreDispatch<BatchView>('export.batch.start', payload);
      await load();
    } catch (e) {
      const fail = e as CoreFail;
      if (fail.code === 'confirmation_required') {
        const conflicts = Array.isArray(fail.usage?.conflicts) ? fail.usage.conflicts : [];
        if (alive.current) setPending({ outputDir, conflicts });
      } else if (alive.current) {
        setError(t.errors[fail.code ?? ''] ?? t.errors.default);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function pickAndStart() {
    setBusy(true);
    setError('');
    try {
      const settings = await coreDispatch<{ last_directory: string | null }>('export.settings', {});
      const mock = import.meta.env.VITE_CORE_MOCK === '1' && !isTauri();
      const chosen = mock
        ? (settings.last_directory ?? '/test/exports')
        : await open({ title: t.pickDir, directory: true, multiple: false, defaultPath: settings.last_directory ?? undefined });
      if (!chosen || !alive.current) return;
      await start(chosen, false);
    } catch {
      if (alive.current) setError(t.errors.default);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function requestBatchExport() {
    const guardrails = await checkGuardrails(
      props.scope === 'source'
        ? { scope: 'source', source_id: props.sourceId }
        : { scope: 'project' },
    );
    if (!alive.current) return;
    if (guardrails?.needsDirectNotice) {
      setDirectNoticeOpen(true);
      return;
    }
    await pickAndStart();
  }

  async function cancelBatch(id: number) {
    setBusy(true);
    setError('');
    try {
      await coreDispatch<BatchView>('export.batch.cancel', { id });
      await load();
    } catch {
      if (alive.current) setError(t.errors.default);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const content = (
    <div className="flex flex-col gap-3" data-export-batch={props.scope}>
      <GuardrailsChecklist
        scope={props.scope}
        sourceId={props.scope === 'source' ? props.sourceId : undefined}
        refreshKey={batches.length}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={focus} tamanho={props.scope === 'source' ? 'sm' : 'md'} disabled={busy} carregando={busy} onClick={() => void requestBatchExport()}>
          {t.exportApproved}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {batches.length > 0 && (
        <ul className="flex flex-col gap-3">
          {batches.map(b => (
            <li key={b.id} className="rounded-md border border-line p-3" data-export-batch-id={b.id} data-export-batch-status={b.status}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">
                    {t.status[b.status]} · {b.progress}%
                  </p>
                  <p className="text-xs text-fg-2" data-export-batch-summary>
                    {fill(t.summary, { completed: b.counts.completed, total: b.counts.total })}
                    {b.counts.failed > 0 ? ` · ${fill(t.failedCount, { count: b.counts.failed })}` : ''}
                    {b.counts.cancelled > 0 ? ` · ${fill(t.cancelledCount, { count: b.counts.cancelled })}` : ''}
                  </p>
                  <progress value={b.progress} max={100} aria-label={t.totalProgress} className="w-56 max-w-full" />
                </div>
                {b.state === 'running' && (
                  <Button tamanho="sm" disabled={busy} onClick={() => void cancelBatch(b.id)}>
                    {t.cancel}
                  </Button>
                )}
              </div>
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {b.items.map(item => (
                  <li key={item.position} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-export-batch-item={item.position} data-state={item.state}>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{item.filename}{item.title ? ` · ${item.title}` : ''}</p>
                      <p className="text-xs text-fg-2">
                        {item.state === 'running'
                          ? `${t.itemState.running} · ${item.progress}%`
                          : item.state === 'failed'
                            ? `${t.itemState.failed} · ${t.errors[item.error?.code ?? ''] ?? t.errors.default}`
                            : t.itemState[item.state]}
                      </p>
                      {item.state === 'completed' && item.encoderFallback && (
                        <p className="text-xs text-fg-2" data-export-fallback>{t.fallback}</p>
                      )}
                    </div>
                    {item.state === 'running' && (
                      <progress value={item.progress} max={100} aria-label={fill(t.cutProgress, { name: item.filename })} className="w-28 max-w-full" />
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={isOpen => { if (!isOpen) setPending(null); }}
        title={t.confirmTitle}
        description={t.confirmBody}
        cancelLabel={t.cancelDialog}
        confirmLabel={t.confirmAction}
        finalFocus={focus}
        onConfirm={() => {
          const next = pending;
          setPending(null);
          if (next) void start(next.outputDir, true);
        }}
      >
        {pending && pending.conflicts.length > 0 && (
          <ul className="max-h-40 overflow-y-auto px-5 pb-3 font-mono text-xs text-fg-2">
            {pending.conflicts.map(name => <li key={name}>{name}</li>)}
          </ul>
        )}
      </ConfirmDialog>
      <DirectMonetizationDialog
        open={directNoticeOpen}
        onOpenChange={setDirectNoticeOpen}
        finalFocus={focus}
        onConfirm={() => {
          setDirectNoticeOpen(false);
          void ackDirectMonetizationNotice().then(() => {
            if (alive.current) void pickAndStart();
          });
        }}
      />
    </div>
  );

  if (props.scope === 'source') return content;
  return (
    <section className="mt-8 border-t border-line pt-6" aria-labelledby="export-batch-title">
      <h2 id="export-batch-title" className="text-base font-semibold">{t.sectionTitle}</h2>
      <p className="mt-1 mb-3 text-sm text-fg-2">{t.intro}</p>
      {content}
    </section>
  );
}
