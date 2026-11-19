import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TABELA_ERROS } from '../src/core/erros.ts'
import { extrairCodigosRustDeMapa } from '../src/core/scannerCodigosRust.ts'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const repoRaiz = path.resolve(aqui, '../..')

function listarArquivos(dir: string, extensoes: string[]): string[] {
  const saida: string[] = []
  if (!fs.existsSync(dir)) return saida
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      saida.push(...listarArquivos(completo, extensoes))
    } else if (extensoes.some((ext) => entry.name.endsWith(ext))) {
      saida.push(completo)
    }
  }
  return saida
}

const fontesRust: Record<string, string> = {}
for (const dir of [path.join(repoRaiz, 'core/src'), path.join(repoRaiz, 'src-tauri/src')]) {
  for (const arq of listarArquivos(dir, ['.rs'])) {
    const rel = path.relative(repoRaiz, arq).replace(/\\/g, '/')
    fontesRust[rel] = fs.readFileSync(arq, 'utf8')
  }
}

const mapaRust = extrairCodigosRustDeMapa(fontesRust)

// Varre tradutores específicos das telas em front-v2/src para comparação
const codigosPorTela = new Map<string, Set<string>>()
const arqFront = listarArquivos(path.join(repoRaiz, 'front-v2/src'), ['.ts', '.tsx']).filter(
  (p) => !p.endsWith('.test.ts') && !p.endsWith('.test.tsx') && !p.endsWith('.spec.ts'),
)

for (const arq of arqFront) {
  const rel = path.relative(repoRaiz, arq).replace(/\\/g, '/')
  if (rel.endsWith('core/erros.ts')) continue
  const txt = fs.readFileSync(arq, 'utf8')
  const achados = new Set<string>()
  for (const m of txt.matchAll(/case\s+'([a-z0-9_]+)':/g)) achados.add(m[1])
  for (const m of txt.matchAll(/^\s+([a-z0-9_]+):\s*['"]/gm)) achados.add(m[1])
  for (const m of txt.matchAll(/\.code\s*===\s*'([a-z0-9_]+)'/g)) achados.add(m[1])
  for (const c of achados) {
    if (!mapaRust.has(c)) continue
    if (!codigosPorTela.has(c)) codigosPorTela.set(c, new Set())
    codigosPorTela.get(c)!.add(rel)
  }
}

const todos = [...mapaRust.keys()]
const semTabela = todos.filter((c) => !Object.hasOwn(TABELA_ERROS, c))
const apenasEmTela = semTabela.filter((c) => codigosPorTela.has(c))
const semNenhum = semTabela.filter((c) => !codigosPorTela.has(c))

console.log(`Códigos reais em Rust (produção): ${todos.length}`)
console.log(`Entradas em TABELA_ERROS: ${Object.keys(TABELA_ERROS).length}`)
console.log(`Ausentes de TABELA_ERROS: ${semTabela.length}`)
console.log(`  - Apenas em tradutor de tela: ${apenasEmTela.length} (${apenasEmTela.join(', ')})`)
console.log(`  - Sem tradução em lugar algum: ${semNenhum.length}`)
for (const c of semNenhum) {
  console.log(`    * ${c} (${mapaRust.get(c)!.join(', ')})`)
}
