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

// Rewritten in Round 15: the script now gives the chooser wait an explicit timeout and
// filters the upload response with an early `!== 'POST'` return (8d7f25da, crop dialog), so the
// old literal patterns no longer matched the same behaviour.
test('feed avatar upload uses the real hydrated profile-photo chooser and waits for its server action', () => {
  assert.match(source, /waitForEvent\('filechooser'(?:\)|, \{ timeout: [\d_]+ \}\))/)
  assert.match(source, /await addButton\.click\(\)/)
  assert.match(source, /await fileChooser\.setFiles/)
  assert.match(source, /waitForResponse/)
  assert.match(source, /request\(\)\.method\(\) === 'POST'|if \(response\.request\(\)\.method\(\) !== 'POST'\) return false/)
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

// Onboarding run 45399844739 (seanshore.net): the repost card was missing after a fixed 800 ms wait
// and a reload into Top for you, which serves a snapshot built before the repost. The proof now waits
// for the repost's own answer and reads the Recent sort of the same Home feed.
test('feed avatar repost proof waits for the repost to answer and reads the Recent feed', () => {
  assert.doesNotMatch(source, /waitForTimeout\(/)
  assert.match(source, /locator\('article'\)\.getByRole\('status'\)\.filter\(\{ hasText: 'Reposted to your feed\.' \}\)/)
  assert.match(source, /locator\('article'\)\.getByRole\('alert'\)/)
  assert.match(source, /throw new Error\('Repost failed: '/)
  assert.match(source, /getByRole\('radiogroup', \{ name: 'Sort the feed' \}\)\.getByRole\('radio', \{ name: 'Recent' \}\)/)
  assert.match(source, /toHaveAttribute\('aria-checked', 'true'/)
  const repostAt = source.indexOf("filter({ hasText: 'reposted' })")
  assert.ok(repostAt > source.indexOf("radio', { name: 'Recent' }"), 'the repost card is looked for after switching to Recent')
})

test('infra CI runs this contract', () => {
  assert.match(readFileSync('.github/workflows/aws-infra-ci.yml', 'utf8'), /node --test scripts\/aws\/feed-avatar-staging-e2e-contract\.test\.mjs/)
})
