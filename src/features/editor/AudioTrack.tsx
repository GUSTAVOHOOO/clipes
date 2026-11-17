import { useRef, type PointerEvent } from 'react';
import { useText } from '@/lib/i18n';
import { clock, fill } from '@/features/projects/selectionFormat';
import {
  PX_PER_SEC,
  splicedToSourceUs,
  usToPx,
  type AudioMixState,
  type KeptSegment,
  type ResolvedSfx,
} from './timelineMath';

const texts = {
  'pt-BR': {
    trackLabel: 'Faixa de trilha e efeitos',
    soundtrack: 'Trilha: {name} ({pct}%)',
    looped: 'repetida',
    sfxLabel: 'Efeito: {name} · {anchor}',
    speechDuck: 'Ducking da trilha por fala (-12 dB)',
  },
  en: {
    trackLabel: 'Soundtrack & SFX track',
    soundtrack: 'Soundtrack: {name} ({pct}%)',
    looped: 'looped',
    sfxLabel: 'SFX: {name} · {anchor}',
    speechDuck: 'Soundtrack speech ducking (-12 dB)',
  },
};

const DRAG_THRESHOLD_PX = 3;

export function AudioTrack({
  audioMix,
  range,
  segments,
  windowStartUs,
  fps,
  top,
  height,
  onMoveSfx,
  onCancel,
  onSeek,
  onPause,
}: {
  audioMix: AudioMixState;
  range: { startUs: number; endUs: number };
  segments: KeptSegment[];
  windowStartUs: number;
  fps: number;
  top: number;
  height: number;
  onMoveSfx: (id: number, timeUs: number, free: boolean, preview: boolean) => void;
  onCancel: () => void;
  onSeek: (sourceUs: number) => void;
  onPause: () => void;
}) {
  const t = useText(texts);
  const drag = useRef<{
    id: number;
    x: number;
    sourceStartUs: number;
    pointer: number;
    moved: boolean;
  } | null>(null);

  const requestedTime = (e: PointerEvent) =>
    Math.round(drag.current!.sourceStartUs + ((e.clientX - drag.current!.x) * 1_000_000) / PX_PER_SEC);

  const moveByKey = (item: ResolvedSfx, direction: 1 | -1, free: boolean) => {
    onPause();
    const step = free ? Math.round(1_000_000 / fps) : 250_000;
    onMoveSfx(item.id, Math.round(item.sourceStartUs + direction * step), free, false);
  };

  const st = audioMix.soundtrack;

  return (
    <div
      className="absolute inset-x-0 border-t border-line/60 bg-field/40"
      style={{ top, height }}
      data-row="audio"
      aria-label={t.trackLabel}
    >
      {st && st.playDurationUs > 0 && (() => {
        const leftSrc = splicedToSourceUs(st.startUs, segments, range.startUs, range.endUs);
        const rightSrc = splicedToSourceUs(st.endUs, segments, range.startUs, range.endUs);
        const leftPx = usToPx(leftSrc, windowStartUs);
        const widthPx = Math.max(24, usToPx(rightSrc, windowStartUs) - leftPx - 2);
        const label = fill(t.soundtrack, { name: st.name, pct: Math.round(st.volume * 100) });
        return (
          <div
            data-soundtrack-block={st.assetId}
            data-soundtrack-play-duration-us={st.playDurationUs}
            title={label}
            className="pointer-events-none absolute top-1 flex items-center gap-1.5 overflow-hidden rounded border border-line bg-surface/80 px-2 text-[11px] text-fg-2"
            style={{ left: leftPx + 1, width: widthPx, height: height - 8 }}
          >
            <span className="truncate font-medium text-fg">{label}</span>
            {st.loopToFit && <span className="shrink-0 text-[10px] text-fg-3">{t.looped}</span>}
          </div>
        );
      })()}

      {st && audioMix.speechIntervals.map((sp, idx) => {
        const ls = splicedToSourceUs(sp.startUs, segments, range.startUs, range.endUs);
        const rs = splicedToSourceUs(sp.endUs, segments, range.startUs, range.endUs);
        const lx = usToPx(ls, windowStartUs);
        const wx = Math.max(2, usToPx(rs, windowStartUs) - lx);
        return (
          <div
            key={`${sp.startUs}:${idx}`}
            data-speech-duck={idx}
            title={t.speechDuck}
            className="pointer-events-none absolute bottom-1 h-1.5 rounded-sm bg-accent/40"
            style={{ left: lx, width: wx }}
          />
        );
      })}

      {audioMix.sfx.map(item => {
        if (item.outsideClip) return null;
        const leftSrc = item.sourceStartUs;
        const rightSrc = splicedToSourceUs(item.endUs, segments, range.startUs, range.endUs);
        const leftPx = usToPx(leftSrc, windowStartUs);
        const widthPx = Math.max(22, usToPx(rightSrc, windowStartUs) - leftPx - 2);
        const anchorText = item.anchor.kind === 'word'
          ? (item.wordText || `#${item.anchor.position}`)
          : clock(item.startUs);
        const label = fill(t.sfxLabel, { name: item.name, anchor: anchorText });
        return (
          <button
            key={item.id}
            type="button"
            data-sfx-item={item.id}
            data-sfx-anchor={item.anchor.kind}
            data-sfx-start-us={item.startUs}
            aria-label={label}
            title={`${label} · ←/→ · Alt`}
            className="foco absolute top-1 z-10 flex cursor-grab items-center gap-1 overflow-hidden rounded border border-accent-line bg-accent-subtle px-1.5 text-left text-[11px] text-fg active:cursor-grabbing touch-none select-none"
            style={{ left: leftPx + 1, width: widthPx, height: height - 8 }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => {
              if (e.button !== 0 || drag.current) return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.focus();
              onPause();
              drag.current = {
                id: item.id,
                x: e.clientX,
                sourceStartUs: leftSrc,
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
                onMoveSfx(item.id, requestedTime(e), e.altKey, true);
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
                onMoveSfx(item.id, next, e.altKey, false);
              } else {
                onSeek(item.sourceStartUs);
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
              moveByKey(item, e.key === 'ArrowLeft' ? -1 : 1, e.altKey);
            }}
          >
            <span className="truncate font-medium">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}
