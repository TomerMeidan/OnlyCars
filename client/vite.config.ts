import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: '/',
        start_url: '/',
        scope: '/',
        name: 'OnlyCars',
        short_name: 'OnlyCars',
        theme_color: '#E7EDEA', // the light theme-color meta in index.html; the dark one applies once the page loads
        background_color: '#E7EDEA',
        display: 'standalone',
        // Rendered from favicon.svg by scripts/icons.mjs.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The API is never cached or answered by the service worker: offline calls fail into the error states, never stale data.
        navigateFallbackDenylist: [/^\/api\//],
        // Google Fonts from one online visit, so an installed app opens offline with its own fonts.
        runtimeCaching: [
          { urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com', handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-css' } },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-files', expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  // ERR-1b: Sentry's release; Render passes the commit as a Docker build arg.
  define: { __RELEASE__: JSON.stringify(process.env.RENDER_GIT_COMMIT ?? '') },
  // Same-origin /api in dev (and in vite preview, which reuses this proxy), so no CORS or hardcoded API URL in the client.
  server: { proxy: { '/api': 'http://localhost:5150' } },
  // shortcut: one bundle (~500 kB, ~150 kB gzip) passed Vite's 500 kB default with FILE-1; split pages with lazy() when it nears 600 kB.
  build: { chunkSizeWarningLimit: 600 },
})
