// Galeria do design system v2 do Clipes (porta 5191).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // a galeria embute todas as peças num só pacote; o app importa por módulo
  build: { chunkSizeWarningLimit: 800 },
  server: { port: Number(process.env.PORT ?? 5191), strictPort: true },
})
