import { isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open, save, type OpenDialogOptions, type SaveDialogOptions } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

export type E2EDialogCall = {
  kind: 'open' | 'save';
  options?: OpenDialogOptions | SaveDialogOptions;
};

export type E2EUpdaterMode = 'off' | 'available' | 'real';

export type ClipesE2EState = {
  dialogQueue: Array<string | null>;
  dialogCalls: E2EDialogCall[];
  confirmQueue: boolean[];
  confirmCalls: string[];
  openedUrls: string[];
  copiedText: string | null;
  updaterMode: E2EUpdaterMode;
};

function readInitialUpdaterMode(): E2EUpdaterMode {
  try {
    const stored = sessionStorage.getItem('clipes.e2e.updaterMode');
    if (stored === 'available' || stored === 'real' || stored === 'off') return stored;
  } catch {
    // sessionStorage indisponível
  }
  return 'off';
}

function getE2EState(): ClipesE2EState {
  if (!window.__CLIPES_E2E__) {
    window.__CLIPES_E2E__ = {
      dialogQueue: [],
      dialogCalls: [],
      confirmQueue: [],
      confirmCalls: [],
      openedUrls: [],
      copiedText: null,
      updaterMode: readInitialUpdaterMode(),
    };
  }
  return window.__CLIPES_E2E__;
}

if (import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined') {
  getE2EState();
}

export async function openDialog(options?: OpenDialogOptions & { multiple?: false }): Promise<string | null> {
  if (import.meta.env.VITE_E2E === '1') {
    const state = getE2EState();
    state.dialogCalls.push({ kind: 'open', options });
    return state.dialogQueue.length > 0 ? (state.dialogQueue.shift() ?? null) : null;
  }
  const selected = await open({ ...options, multiple: false });
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

export async function saveDialog(options?: SaveDialogOptions): Promise<string | null> {
  if (import.meta.env.VITE_E2E === '1') {
    const state = getE2EState();
    state.dialogCalls.push({ kind: 'save', options });
    return state.dialogQueue.length > 0 ? (state.dialogQueue.shift() ?? null) : null;
  }
  return await save(options);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (import.meta.env.VITE_E2E === '1') {
    getE2EState().openedUrls.push(url);
    return;
  }
  if (isTauri()) await openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function copyText(text: string): Promise<void> {
  if (import.meta.env.VITE_E2E === '1') {
    getE2EState().copiedText = text;
    return;
  }
  if (isTauri()) await writeText(text);
  else await navigator.clipboard.writeText(text);
}

export function confirmAction(message: string): boolean {
  if (import.meta.env.VITE_E2E === '1') {
    const state = getE2EState();
    state.confirmCalls.push(message);
    return state.confirmQueue.length > 0 ? Boolean(state.confirmQueue.shift()) : false;
  }
  return window.confirm(message);
}

export function getUpdaterBehavior(): 'real' | 'mock-available' | 'off' {
  if (import.meta.env.VITE_UPDATER_MOCK === 'available') return 'mock-available';
  if (import.meta.env.VITE_E2E === '1') {
    const mode = getE2EState().updaterMode;
    if (mode === 'available') return 'mock-available';
    if (mode === 'real') return 'real';
    return 'off';
  }
  return isTauri() ? 'real' : 'off';
}

export function shouldMockUpdater(): boolean {
  return getUpdaterBehavior() === 'mock-available';
}
