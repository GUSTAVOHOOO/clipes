import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:1430',
    viewport: { width: 1366, height: 768 },
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://127.0.0.1:1430',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_CORE_MOCK: '1',
    },
  },
})
