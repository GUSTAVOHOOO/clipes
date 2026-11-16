import { useRef, type PointerEvent } from 'react';
import { usToPx, PX_PER_SEC } from './timelineMath';

export type Edge = 'start' | 'end';
export type Adjustment = { time_us?: number; sentence_id?: number; sentence_delta?: number; free?: boolean };

/** Um gesto inteiro confirma uma só edição; captura de ponteiro mantém a alça fora do alvo. */
export function BorderHandles({ startUs, endUs, windowStartUs, fps, labels, adjust, cancel, pause }: {
  startUs: number; endUs: number; windowStartUs: number; fps: number;
  labels: { start: string; end: string }; adjust: (edge: Edge, args: Adjustment, preview?: boolean) => void;
  cancel: () => void; pause: () => void;
}) {
  const drag = useRef<{ edge: Edge; x: number; time: number; pointer: number } | null>(null);
  const args = (e: PointerEvent) => ({ time_us: Math.round(drag.current!.time + (e.clientX - drag.current!.x) * 1_000_000 / PX_PER_SEC), free: e.altKey });
  return <>{(['start', 'end'] as const).map(edge => {
    const time = edge === 'start' ? startUs : endUs;
    return <button key={edge} type="button" data-edge={edge} aria-label={labels[edge]}
      title={`${labels[edge]} · ←/→ · Alt`}
      className="foco absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none select-none rounded-sm border border-accent-line bg-accent-subtle text-fg hover:bg-hover"
      style={{ left: usToPx(time, windowStartUs) }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => {
        if (e.button !== 0 || drag.current) return;
        e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); pause();
        drag.current = { edge, x: e.clientX, time, pointer: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => { if (drag.current?.pointer === e.pointerId) { e.stopPropagation(); adjust(edge, args(e), true); } }}
      onPointerUp={e => {
        if (drag.current?.pointer !== e.pointerId) return;
        e.stopPropagation(); const next = args(e); drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId); adjust(edge, next);
      }}
      onPointerCancel={() => { drag.current = null; cancel(); }}
      onLostPointerCapture={() => { if (drag.current) { drag.current = null; cancel(); } }}
      onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault(); e.stopPropagation(); pause();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        adjust(edge, e.altKey ? { time_us: Math.round(time + delta * 1_000_000 / fps), free: true } : { sentence_delta: delta });
      }}>
      <span aria-hidden className="font-mono text-xs">{edge === 'start' ? '⟨' : '⟩'}</span>
    </button>;
  })}</>;
}
