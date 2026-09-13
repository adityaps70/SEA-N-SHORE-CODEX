import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const audit = await readFile(new URL('./audit-social-shared-iam.sh', import.meta.url), 'utf8')

test('shared IAM audit inspects the ECS task Aurora runtime secret policy without mutating IAM', () => {
  assert.match(audit, /sea-n-shore-staging-ecs-task/)
  assert.match(audit, /sea-n-shore-staging-aurora-secret-runtime/)
  assert.match(audit, /ecs_task_aurora_secret/)
  assert.match(audit, /SOCIAL_SHARED_IAM_TASK_STATE_COUNT=/)
  assert.match(audit, /SOCIAL_SHARED_IAM_TASK_LIVE_EXISTS=/)
  assert.match(audit, /SOCIAL_SHARED_IAM_TASK_LIVE_POLICY_MATCHES_DESIRED=/)
  assert.match(audit, /aws iam get-role-policy/)

  for (const mutatingCommand of [
    'put-role-policy',
    'delete-role-policy',
    'attach-role-policy',
    'detach-role-policy',
    'create-role',
    'delete-role',
    'update-assume-role-policy',
  ]) {
    assert.doesNotMatch(audit, new RegExp(`aws\\s+iam\\s+${mutatingCommand}`))
  }
})

test('shared IAM audit inspects the ECS task media policy in state and live IAM without mutating it', () => {
  assert.match(audit, /sea-n-shore-staging-ecs-task-media/)
  assert.match(audit, /ecs_task_media/)
  assert.match(audit, /SOCIAL_SHARED_IAM_MEDIA_STATE_COUNT=/)
  assert.match(audit, /SOCIAL_SHARED_IAM_MEDIA_LIVE_EXISTS=/)
  assert.match(audit, /SOCIAL_SHARED_IAM_MEDIA_LIVE_POLICY_MATCHES_DESIRED=/)
  assert.match(audit, /sea-n-shore-staging-310356785722-media\/\*/)
  assert.match(audit, /s3:GetObject/)
  assert.match(audit, /s3:PutObject/)
  assert.match(audit, /s3:DeleteObject/)
})
