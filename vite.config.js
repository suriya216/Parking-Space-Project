import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the `paths` in tsconfig.json. `@shared` is how the app
    // reaches shared/testids.ts, the same module the Playwright locator
    // layer imports — that shared import is what stops the test ids in
    // the markup and the ones in the tests from drifting apart.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    // Lets the app call /api/* on its own origin, so there's no CORS
    // setup and no API base URL to configure in the client.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
