import { defineConfig, devices } from '@playwright/test'

// Round H (H1): Next.js only prefetches in production, so the prefetch and request-budget checks run
// against `next start` (after `npm run build`) when E2E_PRODUCTION=1.
const production = process.env.E2E_PRODUCTION === '1'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'on-first-retry' },
  webServer: {
    command: production ? 'npm run start -- --hostname 127.0.0.1 --port 3000' : 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
})
