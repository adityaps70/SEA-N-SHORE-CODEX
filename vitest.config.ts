import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Two projects, same tests: component tests (.tsx) run in jsdom; everything else runs in plain Node, which
    // skips building a jsdom window for each of the ~440 files that never touch the DOM. A .ts test that does
    // need the DOM opts in with a `// @vitest-environment jsdom` comment at the top of the file.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./vitest.setup.env.ts'],
          include: [
            'src/**/*.test.ts',
            'scripts/aws/check-terraform-plan.test.mjs',
            'scripts/aws/realtime-social-e2e-guard.test.mjs',
            'scripts/aws/jobs-activities-schema.test.mjs',
            'scripts/migration/beaufortmarine-import.test.mjs',
          ],
        },
      },
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['src/**/*.test.tsx'] },
      },
    ],
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
