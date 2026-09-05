import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function text(path) {
  return readFileSync(path, 'utf8')
}

test('GitHub remote execution stays scoped to the bootstrap instance and repository verifier', () => {
  const terraform = text('infra/aws/bootstrap/main.tf')
  const workflow = text('.github/workflows/aws-remote-verify.yml')
  const verifier = text('scripts/aws/remote-verify.sh')

  for (const action of [
    'ec2:DescribeInstances',
    'ssm:SendCommand',
    'ssm:GetCommandInvocation',
    'ssm:ListCommandInvocations',
  ]) {
    assert.match(terraform, new RegExp(action.replace(':', '\\:')))
  }

  assert.match(terraform, /AWS-RunShellScript/)
  assert.match(terraform, /ssm:resourceTag\/Name/)
  assert.match(terraform, /sea-n-shore-bootstrap/)

  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Name=tag:Name,Values=sea-n-shore-bootstrap/)
  assert.match(workflow, /AWS-RunShellScript/)
  assert.match(workflow, /bash scripts\/aws\/remote-verify\.sh/)
  assert.match(workflow, /git reset --hard/)

  assert.doesNotMatch(workflow, /inputs:\s*[\s\S]*?command\s*:/)
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\.command\s*\}\}/)

  assert.match(workflow, /staging-http-health:/)
  assert.match(workflow, /NEXT_PUBLIC_SITE_URL/)
  assert.match(workflow, /\/api\/health\/phase4/)
  assert.match(workflow, /\.database == true/)
  assert.match(workflow, /\.identityMappings == true/)
  assert.doesNotMatch(workflow, /identityMappingsPresent/)

  assert.match(workflow, /staging-runtime-shape:/)
  assert.match(workflow, /aws ecs describe-task-definition/)
  assert.match(workflow, /AURORA_HOST/)
  assert.match(workflow, /AURORA_PORT/)
  assert.match(workflow, /AURORA_DATABASE/)
  assert.match(workflow, /AURORA_SSL/)
  assert.match(workflow, /AURORA_USER/)
  assert.match(workflow, /AURORA_PASSWORD/)

  assert.match(verifier, /set -euo pipefail/)
  assert.match(verifier, /npm run lint/)
  assert.match(verifier, /npm run typecheck/)
  assert.match(verifier, /vitest run/)
})

test('Aurora ECS bootstrap never reads or prints the managed database secret value', () => {
  const bootstrap = text('scripts/aws/bootstrap-ecs-aurora-runtime.sh')

  assert.match(bootstrap, /set -euo pipefail/)
  assert.match(bootstrap, /AURORA_HOST/)
  assert.match(bootstrap, /AURORA_DATABASE/)
  assert.match(bootstrap, /AURORA_SECRET_ARN/)
  assert.match(bootstrap, /iam put-role-policy/)
  assert.match(bootstrap, /secretsmanager:GetSecretValue/)
  assert.match(bootstrap, /AURORA_USER/)
  assert.match(bootstrap, /:username::/)
  assert.match(bootstrap, /AURORA_PASSWORD/)
  assert.match(bootstrap, /:password::/)
  assert.match(bootstrap, /ecs register-task-definition/)
  assert.match(bootstrap, /ecs update-service/)
  assert.match(bootstrap, /ecs wait services-stable/)

  assert.doesNotMatch(bootstrap, /secretsmanager get-secret-value/)
  assert.doesNotMatch(bootstrap, /SecretString/)
  assert.doesNotMatch(bootstrap, /AURORA_PASSWORD=.*aws/)
})

test('staging deploy always restores the Aurora runtime contract without reading database secrets', () => {
  const deploy = text('.github/workflows/aws-staging-deploy.yml')

  assert.match(deploy, /AURORA_HOST:\s*sea-n-shore-staging-aurora\.cluster-cvaiukw021g5\.ap-south-1\.rds\.amazonaws\.com/)
  assert.match(deploy, /AURORA_PORT:\s*["']?5432["']?/)
  assert.match(deploy, /AURORA_DATABASE:\s*sea_n_shore/)
  assert.match(deploy, /AURORA_SECRET_ARN:\s*arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds!cluster-7bd593b0-cb50-4dbb-9e93-6e7bbb6d3fc1-mL7X5H/)
  assert.doesNotMatch(deploy, /vars\.AURORA_(HOST|PORT|DATABASE|SECRET_ARN)/)
  assert.match(deploy, /\{\"name\":\"AURORA_SSL\",\"value\":\"true\"\}/)
  assert.match(deploy, /\{\"name\":\"AURORA_USER\",\"valueFrom\":\$AURORA_USER_SECRET\}/)
  assert.match(deploy, /\{\"name\":\"AURORA_PASSWORD\",\"valueFrom\":\$AURORA_PASSWORD_SECRET\}/)
  assert.match(deploy, /:username::/)
  assert.match(deploy, /:password::/)

  assert.doesNotMatch(deploy, /secretsmanager get-secret-value/)
  assert.doesNotMatch(deploy, /SecretString/)
})
