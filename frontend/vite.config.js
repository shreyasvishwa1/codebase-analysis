import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Large libraries in their own files: they change rarely (so stay cached across
        // deploys) and the charts load only on the pages that use them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/\/(recharts|d3-[^/]+|victory-vendor|internmap|decimal\.js-light|react-smooth|recharts-scale)\//.test(id)) return 'charts'
          if (/\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run|@tanstack)\//.test(id)) return 'vendor'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      // Exactly /health (as Caddy does), so the /health-score page stays with the app.
      '^/health$': 'http://127.0.0.1:8000',
      '/docs': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
