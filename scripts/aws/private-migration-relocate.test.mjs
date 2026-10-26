// Round 14 (2.13): guarded move of the legacy SQL dump out of the media bucket, and TLS-only bucket policies.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./private-migration-relocate.sh')
const action = guardAction(await read('./private-migration-relocate-action.txt'))
const workflow = await read('../../.github/workflows/aws-private-migration-relocate.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const storage = await read('../../infra/aws/app/bucket-policies.tf')

test('the runner only ever deletes versions of the one dump key, and only after the copy is proven', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /source scripts\/aws\/bootstrap-terraform-lock\.sh/)
  assert.match(script, /DUMP_KEY="private-migrations\/beaufortmarine\.sql"/)
  assert.match(script, /select\(\.Key == \$key\)/)
  const deletes = script.match(/aws s3api delete-object[^\n]*/g) ?? []
  assert.deepEqual(deletes, ['aws s3api delete-object --region "$AWS_REGION" --bucket "$MEDIA_BUCKET" --key "$DUMP_KEY" --version-id "$VERSION_ID" >/dev/null'])
  assert.doesNotMatch(script, /aws s3 rm|delete-objects|--recursive/)
  const copyVerified = script.indexOf('echo "DUMP_COPY_VERIFIED_BYTES=$DESTINATION_SIZE"')
  assert.ok(copyVerified > 0 && copyVerified < script.indexOf('aws s3api delete-object'), 'the copy is verified before any delete')
  assert.ok(script.indexOf('PRIVATE_MIGRATION_RELOCATE_PLAN_ONLY_NO_APPLY') < script.indexOf('aws s3api copy-object'), 'plan never moves or deletes')
  // The current version can be a delete marker: copy the newest stored version by ID, at the known size.
  assert.match(script, /select\(\.Kind == "version"\)\] \| sort_by\(\.LastModified\) \| last/)
  assert.match(script, /--copy-source "\$MEDIA_BUCKET\/\$DUMP_KEY\?versionId=\$SOURCE_VERSION_ID"/)
  assert.match(script, /\[\[ "\$SOURCE_SIZE" == "\$EXPECTED_DUMP_BYTES" \]\]/)
  assert.match(script, /refusing to purge/)
  assert.match(script, /r\['change'\]\['actions'\] != \['create'\]/)
  assert.match(script, /may only add Deny statements/)
  assert.match(script, /BUCKETS_TLS_ONLY_VERIFIED=true/)
  assert.match(script, /MEDIA_PRIVATE_PREFIX_DENIED=true/)
  assert.match(script, /DUMP_ONLY_IN_MIGRATION_BUCKET_VERIFIED=true/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.match(workflow, /name: AWS Private Migration Relocate/)
  assert.match(workflow, /export PRIVATE_MIGRATION_RELOCATE_EXPECTED_SHA=\{sha\}/)
  assert.match(ci, /node --test scripts\/aws\/private-migration-relocate\.test\.mjs/)
})

test('every app bucket refuses plain HTTP and the media bucket refuses the private-migrations prefix', () => {
  assert.match(storage, /resource "aws_s3_bucket_policy" "app" \{\n  for_each = aws_s3_bucket\.app/)
  assert.match(storage, /Sid       = "DenyInsecureTransport"[\s\S]*?Condition = \{ Bool = \{ "aws:SecureTransport" = "false" \} \}/)
  assert.match(storage, /each\.key == "media" \? \[[\s\S]*?Sid       = "DenyPrivateMigrationsPrefix"[\s\S]*?Resource  = "\$\{each\.value\.arn\}\/private-migrations\/\*"/)
  // Round P3 (B7): the policy stays deny-only except for exactly one Allow: the app distribution's
  // read of the media bucket's m/ prefix (signed CDN copies). No other Allow may appear.
  const policy = storage.slice(storage.indexOf('resource "aws_s3_bucket_policy" "app"'))
  assert.equal((policy.match(/Effect    = "Allow"/g) ?? []).length, 1)
  const allow = policy.slice(policy.indexOf('Sid       = "CloudFrontReadsMediaCdnPrefix"'))
  assert.match(allow, /^Sid       = "CloudFrontReadsMediaCdnPrefix"\n\s+Effect    = "Allow"\n\s+Principal = \{ Service = "cloudfront\.amazonaws\.com" \}\n\s+Action    = "s3:GetObject"\n\s+Resource  = "\$\{each\.value\.arn\}\/m\/\*"\n\s+Condition = \{ StringEquals = \{ "AWS:SourceArn" = local\.app_distribution_arn \} \}/)
  assert.match(policy, /each\.key == "media" \? \[\n\s+# Round P3 \(B7\)[^\n]*\n[^\n]*\n\s+\{\n\s+Sid       = "CloudFrontReadsMediaCdnPrefix"/)
})
