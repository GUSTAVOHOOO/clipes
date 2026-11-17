import { useEffect, useRef, type RefObject } from 'react';
import { sourceToSplicedUs } from '@/features/editor/timelineMath';
import { drawCaption, loadCaptionFonts } from './render';
import type { CaptionData } from './types';

export function CaptionOverlay({ data, video, windowStartUs }: { data: CaptionData; video: RefObject<HTMLVideoElement | null>; windowStartUs: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true, frame = 0, last = -1;
    const el = root.current, parent = holder.current;
    if (!el || !parent) return;
    const scale = () => { el.style.transform = `scale(${parent.clientWidth / 1080})`; };
    const observer = new ResizeObserver(scale); observer.observe(parent); scale();
    void loadCaptionFonts().then(() => {
      const tick = () => {
        if (!alive) return;
        const sourceUs = windowStartUs + (video.current?.currentTime ?? 0) * 1e6;
        const time = Math.floor(sourceToSplicedUs(sourceUs, data.segments, data.start_us) / 10_000) * 10_000;
        if (time !== last) { drawCaption(el, data, time); last = time; }
        frame = requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => { if (alive) el.dataset.fontError = 'true'; });
    return () => { alive = false; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [data, video, windowStartUs]);
  return <div ref={holder} className="pointer-events-none absolute inset-0" aria-hidden><div ref={root} style={{ position: 'absolute', width: 1080, height: 1920, transformOrigin: 'top left' }} /></div>;
}
