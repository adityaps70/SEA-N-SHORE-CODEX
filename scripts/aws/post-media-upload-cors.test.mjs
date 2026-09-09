import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const storagePath = 'infra/aws/app/storage.tf'
const bootstrapPath = 'infra/aws/bootstrap/main.tf'
const iamWorkflowPath = '.github/workflows/aws-github-deploy-iam.yml'
const iamScriptPath = 'scripts/aws/github-deploy-iam.sh'
const iamActionPath = 'scripts/aws/github-deploy-iam-action.txt'

function listValues(source, attribute) {
  const match = source.match(new RegExp(`${attribute}\\s*=\\s*\\[([^\\]]*)\\]`, 'i'))
  assert.ok(match, `${attribute} must be configured`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])
}

test('media bucket exposes only restricted browser-to-S3 PUT CORS', () => {
  const source = readFileSync(storagePath, 'utf8')
  const corsStart = source.indexOf('resource "aws_s3_bucket_cors_configuration" "media"')
  assert.notEqual(corsStart, -1, 'media bucket CORS resource must exist')

  const corsSource = source.slice(corsStart)
  assert.match(corsSource, /bucket\s*=\s*aws_s3_bucket\.app\["media"\]\.id/)

  assert.deepEqual(listValues(corsSource, 'allowed_methods'), ['PUT'])
  assert.deepEqual(
    listValues(corsSource, 'allowed_origins'),
    ['https://${aws_cloudfront_distribution.app.domain_name}'],
  )
  assert.deepEqual(listValues(corsSource, 'allowed_headers'), ['Content-Type'])

  assert.doesNotMatch(corsSource, /allowed_methods\s*=\s*\[[^\]]*"(?:GET|DELETE)"/i)
  assert.doesNotMatch(corsSource, /allowed_origins\s*=\s*\[[^\]]*"\*"/i)
  assert.doesNotMatch(corsSource, /allowed_headers\s*=\s*\[[^\]]*"\*"/i)

  assert.match(source, /resource "aws_s3_bucket_public_access_block" "app"/)
  for (const setting of [
    'block_public_acls',
    'block_public_policy',
    'ignore_public_acls',
    'restrict_public_buckets',
  ]) {
    assert.match(source, new RegExp(`${setting}\\s*=\\s*true`))
  }
})

test('GitHub staging deploy role can apply and verify CORS only on the staging media bucket', () => {
  const source = readFileSync(bootstrapPath, 'utf8')
  const policyStart = source.indexOf('resource "aws_iam_role_policy" "github_deploy"')
  assert.notEqual(policyStart, -1, 'GitHub deploy inline policy must exist')

  const policySource = source.slice(policyStart)
  const corsMatch = policySource.match(/Sid\s*=\s*"ManageStagingMediaCors"[\s\S]*?\n      },/)
  assert.ok(corsMatch, 'deploy role must include a dedicated media CORS statement')

  const corsSource = corsMatch[0]
  assert.match(corsSource, /"s3:PutBucketCORS"/)
  assert.match(corsSource, /"s3:GetBucketCORS"/)
  assert.match(
    corsSource,
    /Resource\s*=\s*"arn:aws:s3:::\$\{local\.name_prefix\}-\$\{data\.aws_caller_identity\.current\.account_id\}-media"/,
  )
  assert.doesNotMatch(corsSource, /"s3:\*"/)
  assert.doesNotMatch(corsSource, /Resource\s*=\s*"\*"/)
})

test('live GitHub deploy IAM reconciliation is exact-head gated, SSM-routed, and plan-safe by default', () => {
  const workflow = readFileSync(iamWorkflowPath, 'utf8')
  const script = readFileSync(iamScriptPath, 'utf8')
  const action = readFileSync(iamActionPath, 'utf8').trim()

  assert.equal(action, 'plan')

  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /head_sha=\$\{GITHUB_SHA\}/)
  assert.match(workflow, /Name=tag:Name,Values=sea-n-shore-bootstrap/)
  assert.match(workflow, /AWS-RunShellScript/)
  assert.match(workflow, /git checkout --quiet --detach \{sha\}/)
  assert.match(workflow, /GITHUB_DEPLOY_IAM_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/github-deploy-iam\.sh/)

  assert.match(script, /set -euo pipefail/)
  assert.match(script, /EXPECTED_ACCOUNT="992382634586"/)
  assert.match(script, /GITHUB_DEPLOY_IAM_EXPECTED_SHA/)
  assert.match(script, /case "\$ACTION" in plan\|apply-once\)/)
  assert.match(script, /aws iam get-role-policy/)
  assert.match(script, /ManageStagingMediaCors/)
  assert.match(script, /s3:PutBucketCORS/)
  assert.match(script, /s3:GetBucketCORS/)
  assert.match(script, /sea-n-shore-staging-\$\{EXPECTED_ACCOUNT\}-media/)
  assert.match(script, /aws iam put-role-policy/)
  assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(script, /GITHUB_DEPLOY_IAM_PLAN_ONLY_NO_WRITE/)
  assert.match(script, /GITHUB_DEPLOY_IAM_ALREADY_RECONCILED/)
  assert.doesNotMatch(script, /"s3:\*"/)
})
