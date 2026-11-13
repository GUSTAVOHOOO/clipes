// Teste de teclado de verdade: roda cada script em scripts/teclado/*.ts (Chrome real via playwright-core).
//   node scripts/teclado.ts            todos
//   node scripts/teclado.ts editor     só os que contêm "editor" no nome
// Cada script sai com código ≠ 0 se algum passo falhar. Requer o dev server (bun run dev) na porta 5180.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pasta = fileURLToPath(new URL('./teclado/', import.meta.url))
const filtro = process.argv[2]
const scripts = readdirSync(pasta)
  .filter((f) => f.endsWith('.ts') && (!filtro || f.includes(filtro)))
  .sort()

if (!scripts.length) {
  console.log('Nenhum script em scripts/teclado/.')
  process.exit(1)
}

const falhas: string[] = []
for (const s of scripts) {
  console.log(`\n▶ ${s}`)
  const r = spawnSync(process.execPath, [pasta + s], { stdio: 'inherit', env: process.env })
  if (r.status !== 0) falhas.push(s)
}
console.log(falhas.length ? `\nFalharam: ${falhas.join(', ')}` : `\n${scripts.length} script(s) de teclado passaram.`)
process.exitCode = falhas.length ? 1 : 0
