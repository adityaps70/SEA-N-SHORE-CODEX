import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const SECRET_PATTERN = 'arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore/staging/cashfree*'

test('ECS task Cashfree secret policy is minimal: one read-only statement on the Cashfree secret', async () => {
  const terraform = await readFile(new URL('../../infra/aws/app/payments.tf', import.meta.url), 'utf8')
  assert.match(terraform, /resource "aws_iam_role_policy" "ecs_task_cashfree_secret"/)
  assert.match(terraform, /role = aws_iam_role\.ecs_task\.id/)
  assert.match(terraform, /name = "\$\{local\.name_prefix\}-cashfree-secret-runtime"/)
  assert.ok(terraform.includes(`"${SECRET_PATTERN}"`), 'policy must be scoped to the Cashfree secret only')
  assert.match(terraform, /Action\s+= \["secretsmanager:GetSecretValue"\]/)
  assert.equal((terraform.match(/Sid\s+=/g) ?? []).length, 1)
  assert.doesNotMatch(terraform, /secretsmanager:\*|"\*"|PutSecretValue|DeleteSecret|aws_secretsmanager_secret_version/)
})

test('ECS task Cashfree secret policy has a guarded single-resource Terraform release path', async () => {
  const scriptUrl = new URL('./ecs-task-cashfree-secret-policy.sh', import.meta.url)
  const actionUrl = new URL('./ecs-task-cashfree-secret-policy-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-ecs-task-cashfree-secret-policy.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true, 'missing ECS task Cashfree secret policy runner')
  assert.equal(existsSync(actionUrl), true, 'missing ECS task Cashfree secret policy action guard')
  assert.equal(existsSync(workflowUrl), true, 'missing ECS task Cashfree secret policy workflow')
  assert.ok(['plan', 'apply-once'].includes((await readFile(actionUrl, 'utf8')).trim()), 'action guard must be plan or apply-once')

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"/)
  assert.match(script, /RESOURCE="aws_iam_role_policy\.ecs_task_cashfree_secret"/)
  assert.match(script, /ROLE_NAME="sea-n-shore-staging-ecs-task"/)
  assert.match(script, /POLICY_NAME="sea-n-shore-staging-cashfree-secret-runtime"/)
  assert.ok(script.includes(`SECRET_ARN_PATTERN="${SECRET_PATTERN}"`))
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /-target="\$RESOURCE"/)
  assert.match(script, /secretsmanager:GetSecretValue/)
  assert.match(script, /ReadCashfreePaymentKeys/)
  assert.match(script, /terraform[^\n]+apply/)
  assert.match(script, /ECS_TASK_CASHFREE_SECRET_POLICY_PLAN_VERIFIED=(?:CREATE_ONLY|IMPORT_REQUIRED|UPDATE_ONLY|NO_CHANGES)/)
  assert.match(script, /ECS_TASK_CASHFREE_SECRET_POLICY_APPLY_VERIFIED=true/)
  assert.match(script, /ECS_TASK_CASHFREE_SECRET_POLICY_PLAN_ONLY_NO_APPLY/)
  assert.doesNotMatch(script, /aws\s+iam\s+put-role-policy/)
  assert.doesNotMatch(script, /aws\s+ecs\s+update-service/)
  assert.doesNotMatch(script, /get-secret-value/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS ECS Task Cashfree Secret Policy/)
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /- infra\/aws\/app\/payments\.tf/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_TO_ASSUME \}\}/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /ECS_TASK_CASHFREE_SECRET_POLICY_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/ecs-task-cashfree-secret-policy\.sh/)
})
