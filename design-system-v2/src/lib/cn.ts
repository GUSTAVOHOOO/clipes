/** Junta classes, ignorando falsos. */
export function cn(...partes: (string | false | null | undefined | 0)[]) {
  return partes.filter(Boolean).join(' ')
}
