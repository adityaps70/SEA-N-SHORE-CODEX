// Round 14 (3.10): compiles the ECS workers ahead of time, so the containers start plain Node on
// dist/workers/*.mjs instead of transpiling TypeScript through tsx at every start. App code
// (src/, with the @/ alias) is bundled; npm packages stay external and load from node_modules.
import { build } from 'esbuild'

await build({
  // Round E: the one-off learning content task (plan / apply-once) is run from the image by its guarded runner.
  // Round P3 (B7): so is the one-off media backfill.
  entryPoints: ['scripts/workers/publish-outbox.ts', 'scripts/workers/consume-notifications.ts', 'scripts/workers/learning-round-e-content.ts', 'scripts/workers/media-cdn-backfill.ts', 'scripts/workers/load-test-accounts.ts'],
  outdir: 'dist/workers',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: 'tsconfig.json',
  sourcemap: 'inline',
  logLevel: 'warning',
})
