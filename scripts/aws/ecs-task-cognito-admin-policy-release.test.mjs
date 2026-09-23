import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('ECS task Cognito admin policy has a guarded single-resource Terraform release path', async () => {
  const scriptUrl = new URL('./ecs-task-cognito-admin-policy.sh', import.meta.url)
  const actionUrl = new URL('./ecs-task-cognito-admin-policy-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-ecs-task-cognito-admin-policy.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true, 'missing ECS task Cognito admin policy runner')
  assert.equal(existsSync(actionUrl), true, 'missing ECS task Cognito admin policy action guard')
  assert.equal(existsSync(workflowUrl), true, 'missing ECS task Cognito admin policy workflow')
  assert.equal((await readFile(actionUrl, 'utf8')).trim(), 'plan')

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"/)
  assert.match(script, /RESOURCE="aws_iam_role_policy\.ecs_task_cognito_admin"/)
  assert.match(script, /ROLE_NAME="sea-n-shore-staging-ecs-task"/)
  assert.match(script, /POLICY_NAME="sea-n-shore-staging-cognito-admin-runtime"/)
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /-target="\$RESOURCE"/)
  assert.match(script, /AdminDisableUser/)
  assert.match(script, /AdminEnableUser/)
  assert.match(script, /AdminDeleteUser/)
  assert.match(script, /AdminUserGlobalSignOut/)
  assert.match(script, /ListUsers/)
  assert.match(script, /AdminCreateUser/)
  assert.match(script, /AdminSetUserPassword/)
  assert.match(script, /AdminUpdateUserAttributes/)
  assert.match(script, /terraform[^\n]+apply/)
  assert.match(script, /ECS_TASK_COGNITO_ADMIN_POLICY_PLAN_VERIFIED=(?:CREATE_ONLY|IMPORT_REQUIRED|UPDATE_ONLY|NO_CHANGES)/)
  assert.match(script, /ECS_TASK_COGNITO_ADMIN_POLICY_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /aws\s+iam\s+put-role-policy/)
  assert.doesNotMatch(script, /aws\s+ecs\s+update-service/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS ECS Task Cognito Admin Policy/)
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_TO_ASSUME \}\}/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /ECS_TASK_COGNITO_ADMIN_POLICY_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/ecs-task-cognito-admin-policy\.sh/)
})
