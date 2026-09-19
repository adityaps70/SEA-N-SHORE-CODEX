import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bootstrap = readFileSync('infra/aws/bootstrap/main.tf', 'utf8')
const reconcile = readFileSync('scripts/aws/github-deploy-iam.sh', 'utf8')

test('GitHub deploy role can pass only the exact ECS roles needed for web and event workers', () => {
  for (const role of [
    'sea-n-shore-staging-ecs-execution',
    'sea-n-shore-staging-ecs-task',
    'sea-n-shore-staging-outbox-worker',
    'sea-n-shore-staging-notification-worker',
  ]) {
    assert.match(bootstrap, new RegExp(role))
    assert.match(reconcile, new RegExp(role))
  }

  assert.match(bootstrap, /Sid\s*=\s*"PassEcsRoles"/)
  assert.match(reconcile, /PassEcsRoles/)
  assert.match(reconcile, /verify_pass_role_statement/)
  assert.doesNotMatch(reconcile, /iam:PassRole[\s\S]{0,300}Resource["']?\s*:\s*["']\*["']/)
})
