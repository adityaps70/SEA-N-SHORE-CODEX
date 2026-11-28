import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Realtime run 45559980235 (seanshore.net) waited 30 s for the removed "Professional Build your
// individual maritime identity" card. The member E2Es now share one helper for today's onboarding.
const helper = readFileSync(new URL('./e2e-onboarding.mjs', import.meta.url), 'utf8')
const form = readFileSync('src/features/profiles/components/onboarding-form.tsx', 'utf8')
const personas = readFileSync('src/features/profiles/persona.ts', 'utf8')
const users = [
  ['scripts/aws/realtime-staging-e2e.mjs', '.github/workflows/aws-realtime-e2e.yml'],
  ['scripts/aws/events-staging-e2e.mjs', '.github/workflows/aws-events-e2e.yml'],
  ['scripts/aws/learning-assignment-review-staging-e2e.mjs', '.github/workflows/aws-learning-assignment-review-e2e.yml'],
]

test('the helper answers onboarding as a Seafarer, Master, deck department', () => {
  assert.match(helper, /getByRole\('button', \{ name: 'Seafarer', exact: true \}\)/)
  assert.match(helper, /toHaveAttribute\('aria-pressed', 'true'\)/)
  assert.match(helper, /getByRole\('button', \{ name: 'Find jobs', exact: true \}\)/)
  assert.match(helper, /getByLabel\('Current \/ last organisation', \{ exact: true \}\)/)
  assert.match(helper, /getByLabel\('Department', \{ exact: true \}\)\.selectOption\('deck_officers'\)/)
  assert.match(helper, /getByLabel\('Current or most recent rank', \{ exact: true \}\)\.selectOption\('master'\)/)
})

test('the labels the helper uses still exist in the app', () => {
  assert.match(form, /label="Current \/ last organisation"/)
  assert.match(personas, /find_jobs: 'Find jobs'/)
  assert.match(personas, /'Seafarer'/)
})

test('each member E2E uses the helper, keeps its own username, and never the removed cards', () => {
  for (const [script, workflow] of users) {
    const source = readFileSync(script, 'utf8')
    assert.match(source, /import \{ chooseSeafarerMaster \} from '\.\/e2e-onboarding\.mjs'/, script)
    assert.match(source, /await chooseSeafarerMaster\(page, \{ organisation/, script)
    assert.match(source, /locator\('input\[name="slug"\]'\)\.fill\(username\)/, script)
    assert.match(source, /'Username is available\.'/, script)
    for (const removed of [/Build your individual maritime identity/, /Search professional identities/, /Master — Sea-going · Deck/, /data-primary-identity/, /Profile address/, /getByLabel\('Current organisation'\)/]) {
      assert.doesNotMatch(source, removed, script + ' ' + removed)
    }
    assert.match(readFileSync(workflow, 'utf8'), /- scripts\/aws\/e2e-onboarding\.mjs/, workflow)
  }
})

test('infra CI runs this test', () => {
  assert.match(readFileSync('.github/workflows/aws-infra-ci.yml', 'utf8'), /node --test scripts\/aws\/e2e-onboarding\.test\.mjs/)
})
