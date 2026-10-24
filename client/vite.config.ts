import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'OnlyCars',
        short_name: 'OnlyCars',
        theme_color: '#0F1A1F',
        background_color: '#E6E9E3',
        display: 'standalone',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  // Same-origin /api in dev, so no CORS or hardcoded API URL in the client.
  server: { proxy: { '/api': 'http://localhost:5150' } },
  // shortcut: one bundle (~500 kB, ~150 kB gzip) passed Vite's 500 kB default with FILE-1; split pages with lazy() when it nears 600 kB.
  build: { chunkSizeWarningLimit: 600 },
})
