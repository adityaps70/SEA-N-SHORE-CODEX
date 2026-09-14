import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-realtime-e2e.yml'
const browserPath = 'scripts/aws/realtime-staging-e2e.mjs'
const remotePath = 'scripts/aws/realtime-e2e-remote.sh'

const socialEventTypes = [
  'feed.post_created',
  'feed.post_reaction_changed',
  'feed.post_comments_changed',
  'feed.post_reposted',
  'connection.accepted',
]

test('realtime staging e2e proves all metadata-only social invalidations through real user journeys', () => {
  const browser = readFileSync(browserPath, 'utf8')

  for (const eventType of socialEventTypes) {
    assert.match(browser, new RegExp(eventType.replaceAll('.', '\\.')))
  }
  assert.match(browser, /assertSocialSignalMetadataOnly/)
  assert.match(browser, /aggregateId/)
  assert.match(browser, /payload/)
  assert.match(browser, /Repost to feed/)
  assert.match(browser, /Add a professional comment/)
  assert.match(browser, /Connect/)
  assert.match(browser, /Accept/)
  assert.match(browser, /REALTIME_E2E_SOCIAL_BROWSER_VERIFIED=true/)
})

test('social realtime e2e verifies durable Aurora state, privacy, infra health and cleanup', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')

  assert.match(workflow, /verify-social-durable/)
  assert.match(remote, /public\.posts/i)
  assert.match(remote, /public\.comments/i)
  assert.match(remote, /public\.post_reactions/i)
  for (const eventType of socialEventTypes) {
    assert.match(remote, new RegExp(eventType.replaceAll('.', '\\.')))
  }
  assert.match(remote, /REALTIME_E2E_DURABLE_SOCIAL_VERIFIED=true/)
  assert.match(remote, /REALTIME_INFRA_DIAG_SOCIAL_BODY_LOG_HITS=/)
  assert.match(remote, /REALTIME_E2E_SOCIAL_PRIVACY_VERIFIED=true/)
  assert.match(remote, /DELETE FROM public\.post_reactions/i)
  assert.match(remote, /DELETE FROM public\.comments/i)
  assert.match(remote, /DELETE FROM public\.posts/i)
})
