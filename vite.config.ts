import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** Short commit of the build: CI env first (GitHub Actions / Vercel), then local git, else 'dev'. */
function buildCommit(): string {
  const fromEnv = process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': the new service worker waits; src/app/UpdatePrompt.tsx warns the user and reloads in a controlled way
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'My Trainer',
        short_name: 'My Trainer',
        description: 'Personal fitness & habit tracker',
        theme_color: '#111309',
        background_color: '#111309',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/auth\/callback/],
        runtimeCaching: [
          {
            // Supabase REST reads: network first, fall back to cache when offline.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Exercise media (GIF/SVG) from the exercise-media bucket: cache first.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') &&
              url.pathname.includes('/storage/v1/object/') &&
              url.pathname.includes('/exercise-media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-media',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              // Signed URLs carry a rotating ?token=; key the cache by path so a GIF is stored once
              // and the short-lived token is never persisted.
              plugins: [
                {
                  cacheKeyWillBeUsed: async ({ request }) => {
                    const url = new URL(request.url)
                    url.search = ''
                    return url.href
                  },
                },
              ],
            },
          },
          // NOTE: the progress-photos bucket is intentionally NOT cached by the service worker.
          // Encrypted blobs are decrypted in memory only (see docs/PRD.md M9).
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: they rarely change, so after a deploy phones re-download only app code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return 'vendor-react'
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase'
          if (/node_modules\/(@tanstack|i18next|react-i18next|i18next-browser-languagedetector)\//.test(id)) return 'vendor-app'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    // Agent worktrees live inside the repo folder; never watch or reload because of them.
    watch: { ignored: ['**/.claude/worktrees/**'] },
  },
})
