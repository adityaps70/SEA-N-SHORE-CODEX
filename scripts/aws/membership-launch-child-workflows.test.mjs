import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('.github/workflows/aws-membership-access-migration.yml', 'utf8')
const deploy = readFileSync('.github/workflows/aws-staging-deploy.yml', 'utf8')
const e2e = readFileSync('.github/workflows/aws-onboarding-e2e.yml', 'utf8')
const helper = readFileSync('scripts/aws/membership-launch-sequence.mjs', 'utf8')

test('launch helper dispatches child workflows instead of relying on guard-file push triggers', () => {
  assert.match(helper, /dispatchWorkflow/)
  assert.match(helper, /actions\/workflows/)
  assert.match(helper, /workflow_dispatch/)
  assert.doesNotMatch(helper, /async function armGuard/)
})

test('membership migration accepts orchestrated migrate-once only with exact SHA and confirmation', () => {
  assert.match(migration, /requested_action:/)
  assert.match(migration, /expected_sha:/)
  assert.match(migration, /confirmation:/)
  assert.match(migration, /I_APPROVE_MEMBERSHIP_STAGING_ONE_SHOT/)
  assert.match(migration, /migrate-once/)
  assert.match(migration, /GITHUB_SHA/)
  assert.match(migration, /REMOTE_HEAD/)
})

test('staging deploy requires exact SHA confirmation for an orchestrated deploy', () => {
  assert.match(deploy, /expected_sha:/)
  assert.match(deploy, /confirmation:/)
  assert.match(deploy, /I_APPROVE_MEMBERSHIP_STAGING_ONE_SHOT/)
  assert.match(deploy, /deploy_to_ecs/)
  assert.match(deploy, /GITHUB_SHA/)
  assert.match(deploy, /REMOTE_HEAD/)
})

test('onboarding e2e accepts orchestrated run-once only with exact SHA and confirmation', () => {
  assert.match(e2e, /requested_action:/)
  assert.match(e2e, /expected_sha:/)
  assert.match(e2e, /confirmation:/)
  assert.match(e2e, /I_APPROVE_MEMBERSHIP_STAGING_ONE_SHOT/)
  assert.match(e2e, /run-once/)
  assert.match(e2e, /GITHUB_SHA/)
  assert.match(e2e, /REMOTE_HEAD/)
})
