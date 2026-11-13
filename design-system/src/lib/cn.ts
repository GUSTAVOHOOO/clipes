/** Junta classes, ignorando falsos. Sem dependência: o Tailwind v4 não precisa de merge para nossos casos. */
export function cn(...partes: (string | false | null | undefined | 0)[]) {
  return partes.filter(Boolean).join(' ')
}
