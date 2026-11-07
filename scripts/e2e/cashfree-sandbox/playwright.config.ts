import { defineConfig, devices } from '@playwright/test'

// Cashfree sandbox checkout E2E: one desktop Chromium, no retries (each checkout is a real sandbox order), against the
// production build of the app copy on the CI runner. Chromium cannot resolve Cashfree's production API or payment
// hosts, so even a wrong mode could not reach them.
export default defineConfig({
  testDir: '.',
  testMatch: /checkout\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 12 * 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '/tmp/cashfree-sandbox-report' }]],
  outputDir: '/tmp/cashfree-sandbox-results',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--host-resolver-rules=MAP api.cashfree.com ~NOTFOUND, MAP payments.cashfree.com ~NOTFOUND, MAP payout-api.cashfree.com ~NOTFOUND'],
      // A preinstalled browser whose build differs from this Playwright version (as in the main e2e config).
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    },
  },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000/api/health/live',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
