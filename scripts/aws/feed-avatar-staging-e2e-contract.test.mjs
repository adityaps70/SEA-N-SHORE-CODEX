import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./feed-avatar-staging-e2e.mjs', import.meta.url), 'utf8')

test('feed avatar staging proof preserves the primary failure and uses cleanup-safe navigation', () => {
  assert.match(source, /let primaryError/)
  assert.match(source, /catch \(error\) \{\s*primaryError = error/s)
  assert.match(source, /page\.goto\(siteUrl \+ '\/profile', \{ waitUntil: 'domcontentloaded'/)
  assert.match(source, /if \(primaryError\) throw primaryError/)
  assert.match(source, /if \(cleanupErrors\.length\) throw new Error/)
})

test('feed avatar upload uses the real hydrated profile-photo chooser and waits for its server action', () => {
  assert.match(source, /waitForEvent\('filechooser'\)/)
  assert.match(source, /await addButton\.click\(\)/)
  assert.match(source, /await fileChooser\.setFiles/)
  assert.match(source, /waitForResponse/)
  assert.match(source, /request\(\)\.method\(\) === 'POST'/)
  assert.doesNotMatch(source, /input\.setInputFiles/)
  assert.doesNotMatch(source, /waitForTimeout\(3_000\)/)
})

test('feed avatar staging proof uses current eight-persona onboarding identities', () => {
  assert.match(source, /E2E_SEAFARER_EMAIL/)
  assert.match(source, /E2E_SHORE_EMAIL/)
  assert.match(source, /E2E_ENTHUSIAST_EMAIL/)
  assert.match(source, /-\(seafarer\|shore\|enthusiast\)@example\\\.com/)
  assert.doesNotMatch(source, /E2E_PROFESSIONAL_EMAIL/)
  assert.doesNotMatch(source, /E2E_CUSTOM_EMAIL/)
  assert.doesNotMatch(source, /E2E_ORGANISATION_EMAIL/)
  assert.doesNotMatch(source, /professional\|custom\|organisation/)
})
