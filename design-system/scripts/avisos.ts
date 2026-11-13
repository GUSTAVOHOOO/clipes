// Reúne as licenças dos pacotes instalados de runtime e preserva os textos originais.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('../', import.meta.url))
const pacote = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))
const vistos = new Set<string>()
const avisos: string[] = []
const ausentes: string[] = []
function visitar(nome: string, origem: string) {
  const req = createRequire(join(origem, 'package.json'))
  let pasta: string
  try {
    pasta = dirname(req.resolve(`${nome}/package.json`))
  } catch {
    try {
      pasta = dirname(req.resolve(nome))
      while (!existsSync(join(pasta, 'package.json'))) {
        const acima = dirname(pasta)
        if (acima === pasta) throw new Error(`Pacote não localizado: ${nome}`)
        pasta = acima
      }
    } catch {
      throw new Error(`Não foi possível reunir a licença de ${nome}`)
    }
  }
  const manifest = JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8'))
  const id = `${manifest.name}@${manifest.version}`
  if (vistos.has(id)) return
  vistos.add(id)
  const licencas = readdirSync(pasta).filter((f) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f))
  const fallback = join(raiz, 'scripts/licencas', `${manifest.name.replaceAll('/', '__')}.txt`)
  if (!licencas.length && !existsSync(fallback)) ausentes.push(id)
  const textos = licencas.map((f) => `### ${f}\n\n\`\`\`text\n${readFileSync(join(pasta, f), 'utf8').trim()}\n\`\`\``)
  if (!licencas.length && existsSync(fallback)) textos.push(readFileSync(fallback, 'utf8').trim())
  avisos.push(
    `## ${id}\n\nLicença declarada: ${typeof manifest.license === 'string' ? manifest.license : JSON.stringify(manifest.license)}.\n\n${textos.join('\n\n')}`,
  )
  for (const dependencia of Object.keys(manifest.dependencies ?? {}).sort()) visitar(dependencia, pasta)
}
for (const nome of Object.keys(pacote.dependencies).sort()) visitar(nome, raiz)
if (ausentes.length) throw new Error(`Textos de licença ausentes: ${ausentes.join(', ')}`)
const texto = `# Atribuições de terceiros — Clipes\n\nGerado por \`node design-system/scripts/avisos.ts\` a partir dos pacotes instalados e fixados em \`design-system/bun.lock\`. Os avisos abaixo cobrem as dependências de runtime desta interface e suas dependências transitivas.\n\n## Quadros de demonstração\n\nTears of Steel, © Blender Foundation, 2012. Filme original: [mango.blender.org](https://mango.blender.org/). Licença [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). Os arquivos em \`design-system/src/data/img/\` são quadros reduzidos e recortados do filme, usados apenas na demonstração do editor; o áudio e as falas derivam do mesmo filme.\n\n## Componentes sob demanda\n\nO catálogo apresenta FFmpeg, Whisper e Kokoro como exemplos de interface. Nenhum executável ou peso desses projetos é distribuído neste repositório. As licenças e fontes de cada build/modelo devem acompanhar o download real no app desktop, conforme ADR-0003.\n\n${avisos.join('\n\n')}\n`
mkdirSync(join(raiz, 'public'), { recursive: true })
writeFileSync(resolve(raiz, '../THIRD_PARTY_NOTICES.md'), texto)
writeFileSync(join(raiz, 'public/THIRD_PARTY_NOTICES.md'), texto)
console.log(`Avisos de ${vistos.size} pacotes de runtime reunidos.`)
