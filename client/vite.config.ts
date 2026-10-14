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
        theme_color: '#1B2433',
        background_color: '#E6E9EE',
        display: 'standalone',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  // Same-origin /api in dev, so no CORS or hardcoded API URL in the client.
  server: { proxy: { '/api': 'http://localhost:5150' } },
})
