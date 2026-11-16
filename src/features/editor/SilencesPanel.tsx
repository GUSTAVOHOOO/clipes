import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useText } from '@/lib/i18n';
import { clock, fill } from '@/features/projects/selectionFormat';
import type { SilencesState } from './timelineMath';

export const MIN_THRESHOLD_MS = 300;
export const MAX_THRESHOLD_MS = 2000;
export const DEFAULT_THRESHOLD_MS = 600;

const texts = {
  'pt-BR': {
    threshold: 'Silêncio mínimo (ms)',
    ms: '{value} ms',
    apply: 'Aplicar silêncios',
    revertAll: 'Reverter tudo',
    applyAll: 'Reaplicar tudo',
    summary: '{active} de {total} trechos ativos · -{removed}',
    noneDetected: 'Nenhuma pausa acima do limite entre as palavras deste Corte.',
    hint: 'Encurta pausas entre palavras mantendo margens de fala e 200 ms de respiro.',
    active: 'Ativo',
    reverted: 'Revertido',
    revertOne: 'Reverter',
    restoreOne: 'Reaplicar',
    seekTo: 'Ir para o trecho {index}',
  },
  en: {
    threshold: 'Minimum silence (ms)',
    ms: '{value} ms',
    apply: 'Apply silences',
    revertAll: 'Revert all',
    applyAll: 'Reapply all',
    summary: '{active} of {total} active cuts · -{removed}',
    noneDetected: 'No pauses above the threshold between words in this Clip.',
    hint: 'Shortens pauses between words while keeping speech margins and a 200 ms breath pause.',
    active: 'Active',
    reverted: 'Reverted',
    revertOne: 'Revert',
    restoreOne: 'Reapply',
    seekTo: 'Jump to silence {index}',
  },
};

const msClock = (us: number) => `${clock(us)}.${String(Math.floor((us % 1_000_000) / 1000)).padStart(3, '0')}`;
const formatRemoved = (us: number) => (us >= 1_000_000 ? `${(us / 1_000_000).toFixed(2)} s` : `${Math.round(us / 1000)} ms`);

export function SilencesPanel({
  silences,
  busy,
  onDetect,
  onToggle,
  onRevertAll,
  onApplyAll,
  onSeek,
}: {
  silences: SilencesState;
  busy: boolean;
  onDetect: (thresholdUs: number, preview: boolean) => void;
  onToggle: (id: number) => void;
  onRevertAll: () => void;
  onApplyAll: () => void;
  onSeek: (sourceUs: number) => void;
}) {
  const t = useText(texts);
  const [thresholdMs, setThresholdMs] = useState(Math.round(silences.thresholdUs / 1000) || DEFAULT_THRESHOLD_MS);
  const dragging = useRef(false);

  useEffect(() => {
    setThresholdMs(Math.round(silences.thresholdUs / 1000) || DEFAULT_THRESHOLD_MS);
  }, [silences.thresholdUs]);

  const activeCount = silences.intervals.filter(i => i.status === 'active').length;
  const revertedCount = silences.intervals.length - activeCount;

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm" data-silences-panel>
      <p className="text-xs text-fg-2">{t.hint}</p>
      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-xs font-medium">
          <span>{t.threshold}</span>
          <span className="font-mono text-fg-2" data-silence-threshold-value>{fill(t.ms, { value: thresholdMs })}</span>
        </span>
        <input
          type="range"
          min={MIN_THRESHOLD_MS}
          max={MAX_THRESHOLD_MS}
          step={50}
          value={thresholdMs}
          disabled={busy}
          data-foco-inicial
          className="foco w-full"
          onPointerDown={() => { dragging.current = true; }}
          onPointerUp={() => {
            if (dragging.current) {
              dragging.current = false;
              onDetect(thresholdMs * 1000, false);
            }
          }}
          onPointerCancel={() => { dragging.current = false; }}
          onChange={e => {
            const next = Number(e.target.value);
            setThresholdMs(next);
            onDetect(next * 1000, dragging.current);
          }}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button tamanho="sm" variante="primario" disabled={busy} onClick={() => onDetect(thresholdMs * 1000, false)}>
          {t.apply}
        </Button>
        <Button tamanho="sm" disabled={busy || activeCount === 0} onClick={onRevertAll}>
          {t.revertAll}
        </Button>
        {revertedCount > 0 && (
          <Button tamanho="sm" disabled={busy} onClick={onApplyAll}>
            {t.applyAll}
          </Button>
        )}
      </div>

      {silences.intervals.length > 0 ? (
        <>
          <p className="font-mono text-xs text-fg-2" role="status" data-silences-summary>
            {fill(t.summary, { active: activeCount, total: silences.intervals.length, removed: formatRemoved(silences.removedUs) })}
          </p>
          <ol className="flex flex-col gap-1.5">
            {silences.intervals.map((item, idx) => {
              const active = item.status === 'active';
              return (
                <li
                  key={item.id}
                  data-silence-item={item.id}
                  data-silence-status={item.status}
                  className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
                    active ? 'border-accent-line bg-accent-subtle text-fg' : 'border-line bg-field text-fg-3'
                  }`}
                >
                  <button
                    type="button"
                    aria-label={fill(t.seekTo, { index: idx + 1 })}
                    className="foco flex flex-col items-start text-left"
                    onClick={() => onSeek(Math.max(0, item.startUs - 400_000))}
                  >
                    <span className="font-mono">{msClock(item.startUs)} – {msClock(item.endUs)}</span>
                    <span className="text-[11px] text-fg-2">
                      -{formatRemoved(item.endUs - item.startUs)} · {active ? t.active : t.reverted}
                    </span>
                  </button>
                  <Button tamanho="sm" variante="fantasma" disabled={busy} onClick={() => onToggle(item.id)}>
                    {active ? t.revertOne : t.restoreOne}
                  </Button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        silences.enabled && <p className="text-xs text-fg-2" role="status">{t.noneDetected}</p>
      )}
    </div>
  );
}
