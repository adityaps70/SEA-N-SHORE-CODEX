// Round 14: the outbox worker crash-looped after a deploy because one of its imports pulled in
// @/lib/env, which validates the web-only environment (NEXT_PUBLIC_SITE_URL) when it loads, and the
// worker tasks do not have it. Every module the two workers import must load with only the
// environment a worker task has.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const entrypoints = ['scripts/workers/publish-outbox.ts', 'scripts/workers/consume-notifications.ts']
const workerEnvironment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: 'production',
  AWS_REGION: 'ap-south-1',
  SOCIAL_EVENT_BUS_NAME: 'test-bus',
  AWS_COGNITO_USER_POOL_ID: 'ap-south-1_Test1234',
}

for (const entrypoint of entrypoints) {
  test(`${entrypoint} imports load without the web environment`, () => {
    const source = readFileSync(entrypoint, 'utf8')
    const modules = [...source.matchAll(/^import [^\n]* from '(\.\.\/\.\.\/src\/[^']+)'/gm)].map((match) => match[1].replace('../../', './') + '.ts')
    assert.ok(modules.length > 0)
    const script = modules.map((path) => `await import(${JSON.stringify(path)})`).join('\n')
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      env: workerEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
  })
}
