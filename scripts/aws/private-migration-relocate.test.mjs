// Round 14 (2.13): guarded move of the legacy SQL dump out of the media bucket, and TLS-only bucket policies.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./private-migration-relocate.sh')
const action = (await read('./private-migration-relocate-action.txt')).trim()
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
  assert.ok(script.indexOf('PRIVATE_MIGRATION_RELOCATE_PLAN_ONLY_NO_APPLY') < script.indexOf('aws s3 cp'), 'plan never moves or deletes')
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
  assert.doesNotMatch(storage.slice(storage.indexOf('resource "aws_s3_bucket_policy" "app"')), /Effect    = "Allow"/)
})
