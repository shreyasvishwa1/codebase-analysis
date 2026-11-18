import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // three.js (about 530 kB, 130 kB compressed) is one file by design and loads only on the
    // intro, after the page shows; everything on the first screen is far below this.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Large libraries in their own files: they change rarely (so stay cached across
        // deploys) and the charts and 3D code load only on the pages that use them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/three/')) return 'three'
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
