/// <reference types="vite/client" />

import type { ClipesE2EState } from '@/lib/desktop';

declare global {
  interface ImportMetaEnv {
    readonly VITE_CORE_MOCK?: string;
    readonly VITE_UPDATER_MOCK?: string;
    readonly VITE_E2E?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    __CLIPES_E2E__?: ClipesE2EState;
  }
}

export {};
