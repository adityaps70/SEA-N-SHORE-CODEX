import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('newsletter signing secret is isolated, random and injected into the web Terraform task', async () => {
  const terraformUrl = new URL('../../infra/aws/app/newsletter-email.tf', import.meta.url)
  assert.equal(existsSync(terraformUrl), true, 'missing newsletter email Terraform')
  const terraform = await readFile(terraformUrl, 'utf8')
  assert.match(terraform, /resource "random_password" "newsletter_token"/)
  assert.match(terraform, /length\s+=\s+64/)
  assert.match(terraform, /special\s+=\s+false/)
  assert.match(terraform, /resource "aws_secretsmanager_secret" "newsletter_token"/)
  assert.match(terraform, /name\s+=\s+"\$\{local\.name_prefix\}\/newsletter-token-signing"/)
  assert.match(terraform, /resource "aws_secretsmanager_secret_version" "newsletter_token"/)
  assert.match(terraform, /secret_string\s+=\s+random_password\.newsletter_token\.result/)
  assert.match(terraform, /resource "aws_iam_role_policy" "ecs_execution_newsletter_token_secret"/)
  assert.match(terraform, /role\s+=\s+aws_iam_role\.ecs_execution\.id/)
  assert.match(terraform, /Action\s+=\s+\["secretsmanager:GetSecretValue"\]/)
  assert.doesNotMatch(terraform, /secretsmanager:\*|PutSecretValue|DeleteSecret/)

  const main = await readFile(new URL('../../infra/aws/app/main.tf', import.meta.url), 'utf8')
  assert.match(main, /name\s+=\s+"NEWSLETTER_TOKEN_SECRET"/)
  assert.match(main, /valueFrom\s+=\s+aws_secretsmanager_secret\.newsletter_token\.arn/)
  assert.match(main, /aws_iam_role_policy\.ecs_execution_newsletter_token_secret/)
})

test('guarded release prepares both web and outbox task families without updating running services', async () => {
  const script = await readFile(new URL('./newsletter-signing-secret.sh', import.meta.url), 'utf8')
  assert.match(script, /WEB_TASK_FAMILY="sea-n-shore-staging-web"/)
  assert.match(script, /OUTBOX_TASK_FAMILY="sea-n-shore-staging-outbox-worker"/)
  assert.match(script, /NEWSLETTER_TOKEN_SECRET/)
  assert.match(script, /aws ecs describe-task-definition/)
  assert.match(script, /aws ecs register-task-definition/)
  assert.match(script, /NEWSLETTER_TASK_SECRET_PREPARED=/)
  assert.doesNotMatch(script, /aws ecs update-service/)
})

test('newsletter signing secret has a guarded one-shot Terraform release path', async () => {
  const scriptUrl = new URL('./newsletter-signing-secret.sh', import.meta.url)
  const actionUrl = new URL('./newsletter-signing-secret-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-newsletter-signing-secret.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true, 'missing newsletter signing secret runner')
  assert.equal(existsSync(actionUrl), true, 'missing newsletter signing secret action guard')
  assert.equal(existsSync(workflowUrl), true, 'missing newsletter signing secret workflow')
  assert.ok(['plan', 'apply-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"/)
  assert.match(script, /random_password\.newsletter_token/)
  assert.match(script, /aws_secretsmanager_secret\.newsletter_token/)
  assert.match(script, /aws_secretsmanager_secret_version\.newsletter_token/)
  assert.match(script, /aws_iam_role_policy\.ecs_execution_newsletter_token_secret/)
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /NEWSLETTER_SIGNING_SECRET_PLAN_ONLY_NO_APPLY/)
  assert.match(script, /NEWSLETTER_SIGNING_SECRET_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /get-secret-value/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Newsletter Signing Secret/)
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_TO_ASSUME \}\}/)
  assert.match(workflow, /NEWSLETTER_SIGNING_SECRET_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/newsletter-signing-secret\.sh/)
})
