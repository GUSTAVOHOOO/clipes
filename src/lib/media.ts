import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';

let loopbackBaseUrl: string | null = null;

/**
 * Queries the Tauri adapter once at startup for the Linux loopback media base URL.
 * Returns null on Windows/macOS so `clipes-media://` remains in use there.
 */
export async function initMediaTransport(): Promise<void> {
  if (!isTauri()) return;
  try {
    const base = await invoke<string | null>('media_base_url');
    loopbackBaseUrl = typeof base === 'string' && base.length > 0 ? base.replace(/\/+$/, '') : null;
  } catch {
    loopbackBaseUrl = null;
  }
}

/** Builds a media URL for opaque core resources (`proxy/<key>`, `thumbs/<key>`, `source/<id>`, `narration/<id>`). */
export function mediaUrl(resource: string): string {
  const clean = resource.replace(/^\/+/, '');
  if (!isTauri()) return `/__clipes-media__/${clean}`;
  if (loopbackBaseUrl) return `${loopbackBaseUrl}/${clean}`;
  return convertFileSrc(clean, 'clipes-media');
}
