// Formatação compartilhada pela seleção de Cortes (#53) e pela revisão dos candidatos (#55).
export const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
export function clock(us: number) { const s = Math.floor(us / 1_000_000); const h = Math.floor(s / 3600); const m = String(Math.floor(s / 60) % 60).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`; }
export function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }
