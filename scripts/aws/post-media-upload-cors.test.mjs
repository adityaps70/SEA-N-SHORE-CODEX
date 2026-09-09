import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const storagePath = 'infra/aws/app/storage.tf'
const bootstrapPath = 'infra/aws/bootstrap/main.tf'

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
  const corsSid = policySource.indexOf('Sid      = "ManageStagingMediaCors"')
  assert.notEqual(corsSid, -1, 'deploy role must include a dedicated media CORS statement')

  const corsSource = policySource.slice(corsSid, policySource.indexOf('\n      },', corsSid) + 9)
  assert.match(corsSource, /"s3:PutBucketCORS"/)
  assert.match(corsSource, /"s3:GetBucketCORS"/)
  assert.match(
    corsSource,
    /Resource\s*=\s*"arn:aws:s3:::\$\{local\.name_prefix\}-\$\{data\.aws_caller_identity\.current\.account_id\}-media"/,
  )
  assert.doesNotMatch(corsSource, /"s3:\*"/)
  assert.doesNotMatch(corsSource, /Resource\s*=\s*"\*"/)
})
