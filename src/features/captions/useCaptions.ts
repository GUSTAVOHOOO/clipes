import { useCallback, useEffect, useState } from 'react';
import { coreDispatch, type ExportRequest } from '@/lib/core';
import { correctionEvent, type CorrectionEvent } from '@/features/projects/TranscriptTimeline';
import type { CaptionData } from './types';

export type CaptionRequest = ExportRequest & { clip_id?: number };
export function useCaptions(request: CaptionRequest | null) {
  const [data, setData] = useState<CaptionData | null>(null);
  const [error, setError] = useState(false);
  const key = request ? JSON.stringify(request) : '';
  const refresh = useCallback(async () => {
    if (!key) return;
    const next = await coreDispatch<CaptionData>('export.captions', JSON.parse(key));
    setData(next); setError(false);
  }, [key]);
  useEffect(() => {
    let alive = true;
    setData(null); setError(false);
    if (!key) return;
    void coreDispatch<CaptionData>('export.captions', JSON.parse(key)).then(next => { if (alive) setData(next); }).catch(() => { if (alive) setError(true); });
    const corrected = (event: Event) => { if ((event as CustomEvent<CorrectionEvent>).detail.source_id === JSON.parse(key).source_id) void refresh().catch(() => setError(true)); };
    window.addEventListener(correctionEvent, corrected);
    return () => { alive = false; window.removeEventListener(correctionEvent, corrected); };
  }, [key, refresh]);
  return { data, error, refresh };
}
