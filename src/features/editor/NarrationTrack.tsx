import { useRef, type PointerEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import { useText } from '@/lib/i18n';
import { clock, fill } from '@/features/projects/selectionFormat';
import {
  PX_PER_SEC,
  neighborStart,
  splicedToSourceUs,
  usToPx,
  type KeptSegment,
  type MontageBlock,
  type MontageState,
  type TimelineSentence,
} from './timelineMath';

const texts = {
  'pt-BR': {
    trackLabel: 'Faixa da Narração',
    blockLabel: 'Bloco {n}: {title} · início {start} · duração {duration}',
    manual: 'manual',
    pushed: 'empurrado',
    overflow: 'congela fim',
    reset: 'Voltar ao automático',
    freezeTail: 'Último quadro congelado ({sec} s)',
  },
  en: {
    trackLabel: 'Narration track',
    blockLabel: 'Block {n}: {title} · start {start} · duration {duration}',
    manual: 'manual',
    pushed: 'pushed',
    overflow: 'freezes tail',
    reset: 'Reset to auto',
    freezeTail: 'Frozen last frame ({sec} s)',
  },
};

const DRAG_THRESHOLD_PX = 3;

export function NarrationTrack({
  montage,
  range,
  segments,
  sentences,
  windowStartUs,
  fps,
  top,
  height,
  onSetStart,
  onCancel,
  onSeek,
  onPause,
}: {
  montage: MontageState;
  range: { startUs: number; endUs: number };
  segments: KeptSegment[];
  sentences: TimelineSentence[];
  windowStartUs: number;
  fps: number;
  top: number;
  height: number;
  onSetStart: (blockId: number, timeUs: number | null, free: boolean, preview: boolean) => void;
  onCancel: () => void;
  onSeek: (sourceUs: number) => void;
  onPause: () => void;
}) {
  const t = useText(texts);
  const drag = useRef<{
    blockId: number;
    x: number;
    sourceStartUs: number;
    pointer: number;
    moved: boolean;
  } | null>(null);

  const requestedTime = (e: PointerEvent) =>
    Math.round(drag.current!.sourceStartUs + ((e.clientX - drag.current!.x) * 1_000_000) / PX_PER_SEC);

  const moveByKey = (block: MontageBlock, direction: 1 | -1, free: boolean) => {
    onPause();
    if (free) {
      const next = Math.round(block.sourceStartUs + direction * (1_000_000 / fps));
      onSetStart(block.blockId, next, true, false);
      return;
    }
    const next = neighborStart(sentences, block.sourceStartUs, direction);
    if (next !== null) {
      onSetStart(block.blockId, next, false, false);
    }
  };

  return (
    <div
      className="absolute inset-x-0 border-t border-line/60 bg-field/40"
      style={{ top, height }}
      data-row="narration"
      aria-label={t.trackLabel}
    >
      {montage.freezeTailUs > 0 && (
        <div
          data-montage-freeze-tail
          title={fill(t.freezeTail, { sec: (montage.freezeTailUs / 1_000_000).toFixed(1) })}
          className="pointer-events-none absolute top-0 h-full border-x border-dashed border-danger bg-warning-subtle/50"
          style={{
            left: usToPx(range.endUs, windowStartUs),
            width: Math.max(
              4,
              usToPx(range.endUs + montage.freezeTailUs, windowStartUs) - usToPx(range.endUs, windowStartUs),
            ),
          }}
        />
      )}
      {montage.blocks.map(block => {
        const leftSourceUs = splicedToSourceUs(block.startUs, segments, range.startUs, range.endUs);
        const rightSourceUs = splicedToSourceUs(block.endUs, segments, range.startUs, range.endUs);
        const leftPx = usToPx(leftSourceUs, windowStartUs);
        const widthPx = Math.max(24, usToPx(rightSourceUs, windowStartUs) - leftPx - 2);
        const label = fill(t.blockLabel, {
          n: block.position,
          title: block.title,
          start: clock(block.startUs),
          duration: `${(block.durationUs / 1_000_000).toFixed(1)}s`,
        });
        const manual = block.mode === 'manual';
        const overflow = block.overflowUs > 0;
        const pushed = block.pushedUs > 0;

        return (
          <div
            key={block.blockId}
            className="absolute top-1 flex items-stretch"
            style={{ left: leftPx + 1, width: widthPx, height: height - 8 }}
          >
            <button
              type="button"
              data-narration-block={block.blockId}
              data-narration-mode={block.mode}
              data-narration-start-us={block.startUs}
              data-narration-pushed-us={block.pushedUs}
              aria-label={label}
              title={`${label} · ←/→ · Alt`}
              className={`foco flex min-w-0 flex-1 cursor-grab items-center gap-1.5 overflow-hidden rounded-md border px-2 text-left text-xs active:cursor-grabbing touch-none select-none ${
                overflow
                  ? 'border-danger bg-warning-subtle text-fg'
                  : manual
                    ? 'border-accent-line bg-accent-subtle text-fg ring-1 ring-accent/50'
                    : 'border-line-strong bg-surface text-fg'
              }`}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => {
                if (e.button !== 0 || drag.current) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.focus();
                onPause();
                drag.current = {
                  blockId: block.blockId,
                  x: e.clientX,
                  sourceStartUs: leftSourceUs,
                  pointer: e.pointerId,
                  moved: false,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={e => {
                if (drag.current?.pointer !== e.pointerId) return;
                e.stopPropagation();
                if (!drag.current.moved && Math.abs(e.clientX - drag.current.x) >= DRAG_THRESHOLD_PX) {
                  drag.current.moved = true;
                }
                if (drag.current.moved) {
                  onSetStart(block.blockId, requestedTime(e), e.altKey, true);
                }
              }}
              onPointerUp={e => {
                if (drag.current?.pointer !== e.pointerId) return;
                e.stopPropagation();
                const currentDrag = drag.current;
                drag.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
                if (currentDrag.moved) {
                  const next = Math.round(
                    currentDrag.sourceStartUs + ((e.clientX - currentDrag.x) * 1_000_000) / PX_PER_SEC,
                  );
                  onSetStart(block.blockId, next, e.altKey, false);
                } else {
                  onSeek(block.sourceStartUs);
                }
              }}
              onPointerCancel={() => {
                if (!drag.current) return;
                drag.current = null;
                onCancel();
              }}
              onLostPointerCapture={() => {
                if (!drag.current) return;
                drag.current = null;
                onCancel();
              }}
              onKeyDown={e => {
                if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || e.ctrlKey || e.metaKey || e.shiftKey) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                moveByKey(block, e.key === 'ArrowLeft' ? -1 : 1, e.altKey);
              }}
            >
              <span className="shrink-0 font-mono text-[10px] text-fg-3">#{block.position}</span>
              <span className="truncate font-medium">{block.title}</span>
              {manual && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-fg-2">{t.manual}</span>}
              {pushed && <span className="shrink-0 text-[10px] text-fg-3">{t.pushed}</span>}
              {overflow && <span className="shrink-0 text-[10px] text-danger">{t.overflow}</span>}
            </button>
            {manual && (
              <button
                type="button"
                data-narration-reset={block.blockId}
                aria-label={`${t.reset} (#${block.position})`}
                title={t.reset}
                onClick={e => {
                  e.stopPropagation();
                  onSetStart(block.blockId, null, false, false);
                }}
                className="foco ml-0.5 flex shrink-0 items-center rounded-md border border-line bg-surface px-1 text-fg-2 hover:bg-hover hover:text-fg"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
