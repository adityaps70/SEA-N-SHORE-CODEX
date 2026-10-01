import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const SECRET_PATTERN = 'arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore/resend*'

test('Resend runtime secret policies are read-only and scoped to web + outbox task roles', async () => {
  const terraform = await readFile(new URL('../../infra/aws/app/resend.tf', import.meta.url), 'utf8')
  assert.ok(terraform.includes(`"${SECRET_PATTERN}"`), 'policies must be scoped to the Resend secret only')
  assert.match(terraform, /resource "aws_iam_role_policy" "ecs_task_resend_secret"/)
  assert.match(terraform, /role = aws_iam_role\.ecs_task\.id/)
  assert.match(terraform, /resource "aws_iam_role_policy" "outbox_worker_resend_secret"/)
  assert.match(terraform, /role = aws_iam_role\.outbox_worker\.id/)
  assert.equal((terraform.match(/Action\s+= \["secretsmanager:GetSecretValue"\]/g) ?? []).length, 2)
  assert.equal((terraform.match(/Sid\s+= "ReadResendApiKey"/g) ?? []).length, 2)
  assert.doesNotMatch(terraform, /secretsmanager:\*|PutSecretValue|DeleteSecret|aws_secretsmanager_secret_version/)
})

test('Resend secret IAM has a guarded two-resource Terraform release path', async () => {
  const scriptUrl = new URL('./ecs-resend-secret-policy.sh', import.meta.url)
  const actionUrl = new URL('./ecs-resend-secret-policy-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-ecs-resend-secret-policy.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true, 'missing Resend secret IAM runner')
  assert.equal(existsSync(actionUrl), true, 'missing Resend secret IAM action guard')
  assert.equal(existsSync(workflowUrl), true, 'missing Resend secret IAM workflow')
  assert.ok(['plan', 'apply-once'].includes((await readFile(actionUrl, 'utf8')).trim()), 'action guard must be plan or apply-once')

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"/)
  assert.match(script, /aws_iam_role_policy\.ecs_task_resend_secret/)
  assert.match(script, /aws_iam_role_policy\.outbox_worker_resend_secret/)
  assert.ok(script.includes(`SECRET_ARN_PATTERN="${SECRET_PATTERN}"`))
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /terraform[^\n]+plan/)
  assert.match(script, /terraform[^\n]+apply/)
  assert.match(script, /RESEND_SECRET_POLICY_PLAN_ONLY_NO_APPLY/)
  assert.match(script, /RESEND_SECRET_POLICY_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /get-secret-value/)
  assert.doesNotMatch(script, /aws\s+iam\s+put-role-policy/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS ECS Resend Secret Policy/)
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_TO_ASSUME \}\}/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /ECS_RESEND_SECRET_POLICY_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/ecs-resend-secret-policy\.sh/)
})
