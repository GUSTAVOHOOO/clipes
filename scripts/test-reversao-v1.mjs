// Verifica o caminho de reversão V2 -> V1 (#374, Onda 7): o V1 (`src/`, `design-system/`)
// continua intacto e compilando para `dist/`, e a reversão do `tauri.conf.json` é de 4 campos.
// Não altera arquivos versionados. Uso: node scripts/test-reversao-v1.mjs [--with-cargo]
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const comCargo = process.argv.includes('--with-cargo')

const REVERSAO = {
  beforeDevCommand: 'bun run dev',
  devUrl: 'http://localhost:1420',
  beforeBuildCommand: 'bun run build',
  frontendDist: '../dist',
}

// Exports de `src/` que o front-v2 (ou a reversão) usa; cada um precisa continuar existindo.
const EXPORTS_OBRIGATORIOS = {
  'src/lib/core.ts': ['coreDispatch', 'assinarProgressoMock', 'emitirProgressoMock', 'ExportRequest', 'EventoProgressoMock'],
  'src/lib/media.ts': ['initMediaTransport', 'mediaUrl'],
  'src/lib/desktop.ts': [
    'openDialog',
    'saveDialog',
    'openExternalUrl',
    'copyText',
    'confirmAction',
    'getUpdaterBehavior',
    'shouldMockUpdater',
    'ClipesE2EState',
  ],
  'src/features/updates/updateError.ts': [
    'isSignatureOrIntegrityError',
    'isConnectivityError',
    'shouldIgnoreAutoCheckError',
    'formatUpdateError',
    'errorReason',
  ],
  'src/features/editor/cropMath.ts': [],
  'src/features/editor/timelineMath.ts': [],
  'src/features/editor/duckingMath.ts': [],
  'src/features/captions/render.ts': ['drawCaption'],
  'src/features/captions/types.ts': ['CaptionData'],
}

const falhas = []
const ok = (msg) => console.log(`ok   ${msg}`)
const falha = (msg) => {
  falhas.push(msg)
  console.error(`FAIL ${msg}`)
}

function ler(rel) {
  return readFileSync(path.join(raiz, rel), 'utf8')
}

function exporta(fonte, nome) {
  const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class|type|interface)\\s+${nome}\\b`)
  return re.test(fonte)
}

// 1. Exports obrigatórios existem.
for (const [arquivo, nomes] of Object.entries(EXPORTS_OBRIGATORIOS)) {
  if (!existsSync(path.join(raiz, arquivo))) {
    falha(`${arquivo} não existe`)
    continue
  }
  const fonte = ler(arquivo)
  const ausentes = nomes.filter((n) => !exporta(fonte, n))
  if (ausentes.length) falha(`${arquivo} não exporta: ${ausentes.join(', ')}`)
  else ok(`${arquivo} (${nomes.length} exports)`)
}

// 2. Todo import relativo para `src/` feito por front-v2 e design-system-v2 resolve.
function arquivos(dir) {
  const saida = []
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === 'dist') continue
    const completo = path.join(dir, nome)
    if (statSync(completo).isDirectory()) saida.push(...arquivos(completo))
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(completo)
  }
  return saida
}

const srcV1 = path.join(raiz, 'src')
let importsV1 = 0
for (const pacote of ['front-v2/src', 'design-system-v2/src']) {
  for (const arquivo of arquivos(path.join(raiz, pacote))) {
    const fonte = readFileSync(arquivo, 'utf8')
    for (const m of fonte.matchAll(/from\s+'(\.[^']+)'/g)) {
      const alvo = path.resolve(path.dirname(arquivo), m[1])
      if (!alvo.startsWith(srcV1 + path.sep)) continue
      importsV1++
      const candidatos = [alvo, `${alvo}.ts`, `${alvo}.tsx`, path.join(alvo, 'index.ts')]
      if (!candidatos.some((c) => existsSync(c) && statSync(c).isFile())) {
        falha(`${path.relative(raiz, arquivo)} importa ${m[1]}, que não existe em src/`)
      }
    }
  }
}
if (!falhas.length) ok(`${importsV1} imports relativos de front-v2/design-system-v2 para src/ resolvem`)

// 3. A reversão do tauri.conf.json: troca só `build` e aponta para um bundle que o V1 gera.
const confPath = path.join(raiz, 'src-tauri', 'tauri.conf.json')
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
const revertida = { ...conf, build: { ...conf.build, ...REVERSAO } }
const dist = path.resolve(path.dirname(confPath), revertida.build.frontendDist)
if (dist !== path.join(raiz, 'dist')) falha(`frontendDist revertido aponta para ${dist}, esperado <raiz>/dist`)
else ok('frontendDist revertido resolve para <raiz>/dist')

// 4. media_server.rs mantém :1420 (V1) e :1430 (V2) permitidos em debug.
const media = ler('src-tauri/src/media_server.rs')
for (const origem of ['http://localhost:1420', 'http://127.0.0.1:1420', 'http://localhost:1430', 'http://127.0.0.1:1430']) {
  if (!media.includes(`"${origem}"`)) falha(`media_server.rs não permite ${origem}`)
}
if (!falhas.some((f) => f.includes('media_server.rs'))) ok('media_server.rs permite :1420 e :1430')

// 5. O V1 continua compilando para dist/index.html.
function rodar(cmd, args, extra = {}) {
  const r = spawnSync(cmd, args, { cwd: raiz, stdio: 'inherit', ...extra })
  return r.status === 0
}

for (const script of ['typecheck', 'build']) {
  if (rodar('bun', ['run', script])) ok(`bun run ${script} (V1)`)
  else falha(`bun run ${script} (V1) falhou`)
}
if (existsSync(dist + path.sep + 'index.html')) ok('dist/index.html presente')
else falha('dist/index.html ausente após o build do V1')

// 6. Opcional: o Rust compila embutindo o V1 (TAURI_CONFIG faz merge em memória, sem tocar no arquivo).
if (comCargo) {
  const env = {
    ...process.env,
    PATH: `${path.join(os.homedir(), '.cargo', 'bin')}${path.delimiter}${process.env.PATH}`,
    TAURI_CONFIG: JSON.stringify({ build: REVERSAO }),
  }
  if (rodar('cargo', ['check', '-p', 'clipes', '-j', '2'], { env })) ok('cargo check -p clipes com a configuração do V1')
  else falha('cargo check -p clipes com a configuração do V1 falhou')
}

if (falhas.length) {
  console.error(`\n${falhas.length} falha(s) no caminho de reversão V1.`)
  process.exit(1)
}
console.log('\nCaminho de reversão V1 verificado.')
