import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
// product name: src/config/brand.json is the single source (UI, index.html, manifest)
const brand = JSON.parse(readFileSync(new URL('./src/config/brand.json', import.meta.url), 'utf8')) as { appName: string; shortName: string }

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

/**
 * The production Content-Security-Policy lives in vercel.json. `vite preview` serves the same policy,
 * pointed at the build's Supabase origin, so it can be tested locally before a deploy.
 */
const PROD_SUPABASE = 'https://tnamatnobmtxvdtovkzp.supabase.co'
function previewHeaders(supabaseUrl: string | undefined): Record<string, string> {
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] }
  const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value
  if (!csp || !supabaseUrl) return {}
  const origin = new URL(supabaseUrl).origin
  const ws = origin.replace(/^http/, 'ws')
  return { 'Content-Security-Policy': csp.replaceAll(PROD_SUPABASE, origin).replaceAll(PROD_SUPABASE.replace('https://', 'wss://'), ws) }
}

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
  },
  plugins: [
    { name: 'brand-html', transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', brand.appName) },
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': the new service worker waits; src/app/UpdatePrompt.tsx warns the user and reloads in a controlled way
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: brand.appName,
        short_name: brand.shortName,
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
        // reminder notifications (push + notificationclick); public/push-sw.js
        importScripts: ['push-sw.js'],
        navigateFallbackDenylist: [/^\/auth\/callback/],
        runtimeCaching: [
          {
            // Photo vault and photo rows: never from a cache. A stale "no vault yet" answer could lead
            // to a second vault being created; rows carry IVs and wrapped data. Must precede the rule below.
            urlPattern: ({ url }) => /^\/rest\/v1\/(photo_vault|progress_photos)\b/.test(url.pathname),
            handler: 'NetworkOnly',
          },
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
            // Exercise media (illustration frames, muscle SVGs) from the exercise-media bucket: cache first.
            // v2: the old cache held ExerciseDB GIFs; public/push-sw.js deletes it on activate.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') &&
              url.pathname.includes('/storage/v1/object/') &&
              url.pathname.includes('/exercise-media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-media-v2',
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
          {
            // Progress photos: never cached by the service worker (ciphertext is decrypted in memory only,
            // CLAUDE.md rule 5). Explicit NetworkOnly so no future cache rule can pick them up.
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/') && url.pathname.includes('/progress-photos/'),
            handler: 'NetworkOnly',
          },
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
  preview: { headers: previewHeaders(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL) },
}))
