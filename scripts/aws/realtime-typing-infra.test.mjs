// Round 14 (2.9): guarded release path for the realtime typing membership check and rate limit.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./realtime-typing-infra.sh')
const action = (await read('./realtime-typing-infra-action.txt')).trim()
const workflow = await read('../../.github/workflows/aws-realtime-typing-infra.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const realtime = await read('../../infra/aws/app/realtime.tf')
const lambda = await read('../../infra/aws/app/lambda/realtime-connection.mjs')
const appToken = await read('../../src/features/realtime/typing-token.ts')

test('the runner plans only the connection Lambda and its policy, in place, and verifies them live', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /REALTIME_TYPING_INFRA_EXPECTED_SHA/)
  assert.match(script, /source scripts\/aws\/bootstrap-terraform-lock\.sh/)
  assert.match(script, /TARGETS=\(\n  aws_lambda_function\.realtime_connection\n  aws_iam_role_policy\.realtime_connection\n\)/)
  const allowList = script.slice(script.indexOf('allowed = {'), script.indexOf('}\n# Code and environment change'))
  assert.doesNotMatch(allowList, /'delete'|'create'/)
  assert.match(script, /unexpected realtime typing change refused/)
  assert.match(script, /change outside its intended attributes refused/)
  assert.match(script, /The connection Lambda must receive the realtime ticket secret ARN/)
  assert.match(script, /Unexpected connection Lambda permissions/)
  assert.match(script, /REALTIME_TYPING_LAMBDA_VERIFIED=true/)
  assert.match(script, /REALTIME_TYPING_POLICY_VERIFIED=true/)
  assert.match(script, /PUBLIC_SITE_LIVE_VERIFIED=true/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.match(workflow, /name: AWS Realtime Typing Infrastructure/)
  assert.match(workflow, /export REALTIME_TYPING_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(ci, /node --test scripts\/aws\/realtime-typing-infra\.test\.mjs/)
})

test('Terraform gives the connection Lambda only what the typing check needs', () => {
  assert.match(realtime, /REALTIME_TICKET_SECRET_ARN = aws_secretsmanager_secret\.realtime_ticket\.arn\n    \}/)
  assert.match(realtime, /"dynamodb:UpdateItem"\n        \]\n        Resource = aws_dynamodb_table\.realtime_connections\.arn/)
  assert.match(realtime, /Sid      = "VerifyTypingTokens"\n        Effect   = "Allow"\n        Action   = \["secretsmanager:GetSecretValue"\]\n        Resource = aws_secretsmanager_secret\.realtime_ticket\.arn/)
})

test('the Lambda and the app sign the same typing token message with the same key label and lifetime', () => {
  assert.match(lambda, /TYPING_TOKEN_KEY_INFO = 'sea-n-shore\/realtime-typing\/v1'/)
  assert.match(appToken, /TYPING_TOKEN_KEY_INFO = 'sea-n-shore\/realtime-typing\/v1'/)
  assert.match(lambda, /TYPING_TOKEN_TTL_SECONDS = 12 \* 60 \* 60/)
  assert.match(appToken, /TYPING_TOKEN_TTL_SECONDS = 12 \* 60 \* 60/)
  assert.match(lambda, /`typing\\n\$\{actorId\}\\n\$\{conversationId\}\\n\$\{targetProfileId\}\\n\$\{expiresAt\}`/)
  assert.match(appToken, /`typing\\n\$\{actorId\}\\n\$\{conversationId\}\\n\$\{targetProfileId\}\\n\$\{expiresAt\}`/)
  assert.match(lambda, /return response\(403, \{ error: 'typing_not_allowed' \}\)/)
  assert.match(lambda, /TYPING_MIN_INTERVAL_MS = 2_000/)
  assert.match(lambda, /last_typing_at <= :cutoff/)
  assert.match(lambda, /return response\(429, \{ error: 'typing_rate_limited' \}\)/)
})
