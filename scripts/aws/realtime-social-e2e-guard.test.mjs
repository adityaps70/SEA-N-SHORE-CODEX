import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

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
    expect(browser).toMatch(new RegExp(eventType.replaceAll('.', '\\.')))
  }
  expect(browser).toMatch(/assertSocialSignalMetadataOnly/)
  expect(browser).toMatch(/aggregateId/)
  expect(browser).toMatch(/payload/)
  expect(browser).toMatch(/Repost to feed/)
  expect(browser).toMatch(/Add a comment/)
  expect(browser).toMatch(/social_sender_connection/)
  expect(browser).toMatch(/social_recipient_connection/)
  expect(browser).toMatch(/Connect/)
  expect(browser).toMatch(/Accept/)
  expect(browser).toMatch(/REALTIME_E2E_SOCIAL_BROWSER_VERIFIED=true/)
})

test('social realtime e2e verifies durable Aurora state, privacy, infra health and cleanup', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remotePath, 'utf8')

  expect(workflow).toMatch(/verify-social-durable/)
  expect(remote).toMatch(/public\.posts/i)
  expect(remote).toMatch(/public\.post_comments/i)
  expect(remote).toMatch(/public\.post_reactions/i)
  expect(remote).toMatch(/post_reactions[^\n]*user_id/i)
  for (const eventType of socialEventTypes) {
    expect(remote).toMatch(new RegExp(eventType.replaceAll('.', '\\.')))
  }
  expect(remote).toMatch(/REALTIME_E2E_DURABLE_SOCIAL_VERIFIED=true/)
  expect(remote).toMatch(/REALTIME_INFRA_DIAG_SOCIAL_BODY_LOG_HITS=/)
  expect(remote).toMatch(/REALTIME_E2E_SOCIAL_PRIVACY_VERIFIED=true/)
  expect(remote).toMatch(/DELETE FROM public\.post_reactions/i)
  expect(remote).toMatch(/DELETE FROM public\.post_comments/i)
  expect(remote).toMatch(/DELETE FROM public\.posts/i)
})
