import { defineConfig, devices } from '@playwright/test'
import { ORIGIN, STATE_FILE, localStack } from './e2e/support/env'

// End-to-end suite against the LOCAL Supabase stack only (`npx supabase start`). See e2e/global-setup.ts.
const stack = localStack()

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // one shared test user; specs stay independent by using unique names
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: ORIGIN,
    storageState: STATE_FILE,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'Europe/Istanbul',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_SUPABASE_URL: stack.url, VITE_SUPABASE_ANON_KEY: stack.anonKey },
  },
})
