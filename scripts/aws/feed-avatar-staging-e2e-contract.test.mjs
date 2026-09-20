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
