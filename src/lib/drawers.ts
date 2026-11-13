import type { ComponentType } from 'react';
import type { Language } from './i18n';
export type DrawerContribution = { side: 'esq' | 'dir'; title: Record<Language, string>; component: ComponentType };
// Cada feature pode exportar `drawer` em seu próprio drawer.tsx, sem alterar um registro central.
const modules = import.meta.glob<{ drawer: DrawerContribution }>('../features/*/drawer.tsx', { eager: true });
export const drawers = Object.values(modules).map(m => m.drawer);
