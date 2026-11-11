import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** V dev režimu napodobí Netlify edge funkci netlify/edge-functions/golemio.ts */
function golemioDevProxy(key: string | undefined): Plugin {
  return {
    name: 'golemio-dev-status',
    configureServer(server) {
      server.middlewares.use('/api/golemio/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ configured: !!key }))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // GOLEMIO_API_KEY z .env – bez prefixu VITE_, takže se nedostane do bundlu
  const env = loadEnv(mode, process.cwd(), '')
  const key = env.GOLEMIO_API_KEY

  return {
    server: {
      proxy: {
        '^/api/transitous/(plan|trip)': {
          target: 'https://api.transitous.org',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/transitous/, '/api/v1'),
          headers: { 'User-Agent': 'Kudytam/1.0-dev (+https://github.com/martaskundrat/kudytam)' },
        },
        '/api/golemio/v2': {
          target: 'https://api.golemio.cz',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/golemio/, ''),
          headers: key ? { 'X-Access-Token': key } : {},
        },
      },
    },
    plugins: [
      golemioDevProxy(key),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Kudytam – chytrý jízdní řád',
          short_name: 'Kudytam',
          description: 'Odjezdy z nejbližších zastávek, chytré doporučení spoje a cena jízdenky.',
          theme_color: '#121212',
          background_color: '#121212',
          display: 'standalone',
          orientation: 'portrait',
          lang: 'cs',
          start_url: '/',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          // stops.json se ukládá do cache za běhu, ne při instalaci
          globIgnores: ['**/stops.json'],
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /\/api\/golemio\/v2\//,
              handler: 'NetworkFirst',
              options: { cacheName: 'golemio', networkTimeoutSeconds: 6, expiration: { maxEntries: 100, maxAgeSeconds: 3600 } },
            },
            {
              urlPattern: /\/stops\.json$/,
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'stations', expiration: { maxEntries: 1 } },
            },
          ],
        },
      }),
    ],
  }
})
