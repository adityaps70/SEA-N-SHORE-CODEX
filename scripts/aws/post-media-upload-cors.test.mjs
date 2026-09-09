import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const storagePath = 'infra/aws/app/storage.tf'

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
