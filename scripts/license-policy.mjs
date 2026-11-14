import parse from 'spdx-expression-parse'

// Mesma política que deny.toml e o teste do manifesto de Componentes.
const licenses = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib',
  'Unicode-3.0', 'MPL-2.0', 'MIT-0', 'CDLA-Permissive-2.0', 'bzip2-1.0.6',
  'BSL-1.0', 'OFL-1.1', '0BSD', 'Unlicense', 'Apache-2.0 WITH LLVM-exception',
])
function evaluate(node) {
  if (node.conjunction === 'and') return evaluate(node.left) && evaluate(node.right)
  if (node.conjunction === 'or') return evaluate(node.left) || evaluate(node.right)
  if (node.plus) return false
  return licenses.has(node.license + (node.exception ? ` WITH ${node.exception}` : ''))
}
export function allowed(expression) {
  if (typeof expression !== 'string') return false
  try { return evaluate(parse(expression)) } catch { return false }
}
