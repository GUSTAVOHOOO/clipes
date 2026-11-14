import { allowed } from './license-policy.mjs'
let input = ''
for await (const chunk of process.stdin) input += chunk
const packages = JSON.parse(input)
if (!Object.keys(packages).length) throw new Error('Nenhuma dependência verificada')
let failed = false
for (const [name, info] of Object.entries(packages)) {
  if (!allowed(info.licenses)) {
    console.error(`${name}: licença não permitida ou desconhecida: ${JSON.stringify(info.licenses)}`)
    failed = true
  }
}
if (failed) process.exitCode = 1
else console.log(`${Object.keys(packages).length} pacotes aprovados`)
