/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const raiz = fileURLToPath(new URL('.', import.meta.url))
const repoRaiz = path.resolve(raiz, '..')
const dsRoot = path.resolve(repoRaiz, 'design-system-v2')
const dsSrc = path.resolve(dsRoot, 'src')
const v1Src = path.resolve(repoRaiz, 'src')
const frontPkg = path.resolve(raiz, 'package.json')

function normalizar(p: string) {
  const norm = p.replace(/\\/g, '/')
  return process.platform === 'win32' ? norm.toLowerCase() : norm
}

const dsPrefix = `${normalizar(dsRoot)}/`
const v1Prefix = `${normalizar(v1Src)}/`

const dsEstilos = normalizar(path.resolve(dsSrc, 'estilos.css'))

export function aliasPorPacote(): Plugin {
  return {
    name: 'alias-por-pacote',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null
      const imp = normalizar(importer.split('?')[0])
      const emDs = imp.startsWith(dsPrefix)
      const emV1 = imp.startsWith(v1Prefix)
      if (!emDs && !emV1) return null

      if (source.startsWith('@/')) {
        const base = emDs ? dsSrc : v1Src
        const alvo = path.resolve(base, source.slice(2))
        return this.resolve(alvo, importer, { ...options, skipSelf: true })
      }

      if (!source.startsWith('.') && !source.startsWith('/') && !source.startsWith('node:') && !source.startsWith('\0')) {
        return this.resolve(source, frontPkg, { ...options, skipSelf: true })
      }

      return null
    },
    transform(code, id) {
      if (normalizar(id.split('?')[0]) === dsEstilos) {
        return { code: `${code}\n@source ".";\n`, map: null }
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [aliasPorPacote(), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '~', replacement: path.resolve(raiz, 'src') },
      { find: /^@ds\/(.+)$/, replacement: `${dsSrc}/$1` },
      { find: /^@ds$/, replacement: path.resolve(dsSrc, 'index.ts') },
      { find: /^@core$/, replacement: path.resolve(v1Src, 'lib/core.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 1430,
    strictPort: true,
    fs: {
      allow: [repoRaiz],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
