import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// Round ARCH (signed-in load test): the S3 hand-off of the sealed sessions. Owner-approved: the ₹88/month KMS key,
// the shared web task role with s3:PutObject on sessions/* only, and the GitHub deploy role's Get/Delete plus a
// ListBucket limited to sessions/ (github-deploy-iam.sh).
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./load-test-handoff-infra.sh')
const workflow = read('../../.github/workflows/aws-load-test-handoff-infra.yml')
const tf = read('../../infra/aws/app/load-test-handoff.tf')
const classifier = new URL('./check-load-test-handoff-plan.py', import.meta.url).pathname

const ACCOUNT = '310356785722'
const BUCKET = 'sea-n-shore-staging-310356785722-load-test-handoff'
const BUCKET_ARN = `arn:aws:s3:::${BUCKET}`
const TASK_ROLE = `arn:aws:iam::${ACCOUNT}:role/sea-n-shore-staging-ecs-task`
const GITHUB_ROLE = `arn:aws:iam::${ACCOUNT}:role/sea-n-shore-staging-github-deploy`
const CONTEXTS = [BUCKET_ARN, `${BUCKET_ARN}/sessions/*`]
const VIA = { StringEquals: { 'kms:ViaService': 's3.ap-south-1.amazonaws.com' }, StringLike: { 'kms:EncryptionContext:aws:s3:arn': CONTEXTS } }
const ADMIN = ['kms:CreateAlias', 'kms:Describe*', 'kms:Enable*', 'kms:List*', 'kms:Put*', 'kms:Update*', 'kms:Revoke*', 'kms:Disable*', 'kms:Get*', 'kms:Delete*', 'kms:TagResource', 'kms:UntagResource', 'kms:ScheduleKeyDeletion', 'kms:CancelKeyDeletion']

function keyPolicy(overrides = {}) {
  return {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'AccountAdministersButCannotUse', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCOUNT}:root` }, Action: ADMIN, Resource: '*' },
      { Sid: 'SessionsTaskEncryptsThroughS3', Effect: 'Allow', Principal: { AWS: TASK_ROLE }, Action: ['kms:GenerateDataKey'], Resource: '*', Condition: VIA },
      { Sid: 'RunnerDecryptsThroughS3', Effect: 'Allow', Principal: { AWS: GITHUB_ROLE }, Action: ['kms:Decrypt'], Resource: '*', Condition: VIA },
      ...(overrides.extra ?? []),
    ],
  }
}
const bucketPolicy = {
  Version: '2012-10-17',
  Statement: [
    { Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [BUCKET_ARN, `${BUCKET_ARN}/*`], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
    { Sid: 'DenyOwnEncryptionHeaders', Effect: 'Deny', Principal: '*', Action: 's3:PutObject', Resource: `${BUCKET_ARN}/*`, Condition: { Null: { 's3:x-amz-server-side-encryption': 'false' } } },
    { Sid: 'DenyCustomerKeys', Effect: 'Deny', Principal: '*', Action: 's3:PutObject', Resource: `${BUCKET_ARN}/*`, Condition: { Null: { 's3:x-amz-server-side-encryption-customer-algorithm': 'false' } } },
  ],
}
const taskPolicy = { Version: '2012-10-17', Statement: [{ Sid: 'WriteSealedLoadTestSessions', Effect: 'Allow', Action: ['s3:PutObject'], Resource: `${BUCKET_ARN}/sessions/*` }] }

function creates(overrides = {}) {
  const after = {
    'aws_kms_key.load_test_handoff': { enable_key_rotation: true, deletion_window_in_days: 7, key_usage: 'ENCRYPT_DECRYPT', customer_master_key_spec: 'SYMMETRIC_DEFAULT', policy: JSON.stringify(keyPolicy()) },
    'aws_kms_alias.load_test_handoff': { name: 'alias/sea-n-shore-staging-load-test-handoff' },
    'aws_s3_bucket.load_test_handoff': { bucket: BUCKET, force_destroy: false },
    'aws_s3_bucket_public_access_block.load_test_handoff': { block_public_acls: true, block_public_policy: true, ignore_public_acls: true, restrict_public_buckets: true },
    'aws_s3_bucket_ownership_controls.load_test_handoff': { rule: [{ object_ownership: 'BucketOwnerEnforced' }] },
    'aws_s3_bucket_server_side_encryption_configuration.load_test_handoff': { rule: [{ bucket_key_enabled: true, apply_server_side_encryption_by_default: [{ sse_algorithm: 'aws:kms' }] }] },
    'aws_s3_bucket_lifecycle_configuration.load_test_handoff': { rule: [{ status: 'Enabled', expiration: [{ days: 1 }], abort_incomplete_multipart_upload: [{ days_after_initiation: 1 }] }] },
    'aws_s3_bucket_policy.load_test_handoff': { policy: JSON.stringify(bucketPolicy) },
    'aws_iam_role_policy.ecs_task_load_test_handoff': { name: 'sea-n-shore-staging-load-test-handoff', policy: JSON.stringify(taskPolicy) },
    ...overrides,
  }
  return Object.entries(after).map(([address, value]) => ({ address, mode: 'managed', change: { actions: ['create'], after: value } }))
}

function classify(changes) {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-plan-'))
  const file = join(dir, 'plan.json')
  writeFileSync(file, JSON.stringify({ resource_changes: changes }))
  return spawnSync('python3', ['-I', classifier, file], { encoding: 'utf8' })
}

function liveKeyPolicy(policy) {
  return spawnSync('python3', ['-I', classifier, '--key-policy', GITHUB_ROLE], { input: JSON.stringify(policy), encoding: 'utf8' }).stdout.trim()
}

test('guarded, exact-head, plan by default, only the hand-off targets, applies only the classified plan', () => {
  assert.ok(['plan', 'apply-once'].includes(guardAction(read('./load-test-handoff-infra-action.txt'))))
  assert.match(script, /case "\$ACTION" in plan\|apply-once\) ;;/)
  assert.match(script, /LOAD_TEST_HANDOFF_INFRA_EXPECTED_SHA/)
  const targets = /RESOURCES=\(\n([\s\S]*?)\n\)/.exec(script)[1].split('\n').map((line) => line.trim().replace(/"/g, ''))
  assert.deepEqual(targets, [
    'aws_kms_key.load_test_handoff', 'aws_kms_alias.load_test_handoff', 'aws_s3_bucket.load_test_handoff',
    'aws_s3_bucket_public_access_block.load_test_handoff', 'aws_s3_bucket_ownership_controls.load_test_handoff',
    'aws_s3_bucket_server_side_encryption_configuration.load_test_handoff', 'aws_s3_bucket_lifecycle_configuration.load_test_handoff',
    'aws_s3_bucket_policy.load_test_handoff', 'aws_iam_role_policy.ecs_task_load_test_handoff',
  ])
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/\$1\.log" -chdir="\$APP_DIR" plan /)
  assert.ok(script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh') < script.indexOf('terraform -chdir'))
  const planExit = script.indexOf('if [[ "$ACTION" == "plan" ]]; then')
  const moved = script.indexOf('bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1')
  const apply = script.indexOf('terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan"')
  assert.ok(planExit > 0 && moved > planExit && apply > moved)
  assert.equal((script.match(/terraform -chdir="\$APP_DIR" apply/g) || []).length, 1)
  // After the apply: no further change, and the live shape exactly as approved, with the bucket empty.
  assert.match(script, /classify "\$WORK_DIR\/after\.json" \| grep -qx 'LOAD_TEST_HANDOFF_PLAN=NO_CHANGES'/)
  assert.match(script, /key=enabled:True rotation=True key_policy=true encryption=true versioning=never public_blocked=true lifecycle_1_day=true bucket_policy=true task_put_only=true objects=0/)
  // It reads names, settings and the object count only: never an object.
  assert.doesNotMatch(script, /s3api get-object --bucket "\$BUCKET"|s3 cp|s3api put-object/)
})

test('the workflow runs the runner on the bootstrap host only after an owner-merged arm', () => {
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/load-test-handoff-infra-action\.txt/)
  assert.match(workflow, /export LOAD_TEST_HANDOFF_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/load-test-handoff-infra\.sh/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.doesNotMatch(workflow, /realtime|fan-out|fanout/i)
})

test('the Terraform holds exactly the approved shape', () => {
  // Not versioned: no versioning resource for this bucket, so a delete removes the object.
  assert.doesNotMatch(tf, /aws_s3_bucket_versioning/)
  assert.match(tf, /sse_algorithm\s+= "aws:kms"\n\s+kms_master_key_id = aws_kms_key\.load_test_handoff\.arn/)
  assert.match(tf, /bucket_key_enabled = true/)
  assert.match(tf, /expiration \{\n\s+days = 1\n\s+\}/)
  assert.match(tf, /enable_key_rotation\s+= true/)
  // The task role gains PutObject on sessions/* only; the key policy never lets the account itself use the key.
  assert.match(tf, /Action\s+= \["s3:PutObject"\]\n\s+Resource = "\$\{local\.load_test_handoff_s3_arn\}\/sessions\/\*"/)
  const admin = /Sid\s+= "AccountAdministersButCannotUse"[\s\S]*?Resource = "\*"/.exec(tf)[0]
  assert.doesNotMatch(admin, /Encrypt|Decrypt|GenerateDataKey|CreateGrant|ReEncrypt|"kms:\*"|Create\*/)
})

test('the classifier accepts exactly the approved creates, and no change', () => {
  const ok = classify(creates())
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /^LOAD_TEST_HANDOFF_PLAN=CREATE$/m)
  assert.equal((ok.stdout.match(/^LOAD_TEST_HANDOFF_CREATE=/gm) || []).length, 9)
  const none = classify([{ address: 'aws_s3_bucket.load_test_handoff', mode: 'managed', change: { actions: ['no-op'] } }])
  assert.equal(none.status, 0)
  assert.match(none.stdout, /^LOAD_TEST_HANDOFF_PLAN=NO_CHANGES$/m)
})

test('the classifier refuses anything else', () => {
  const refused = (changes, why) => {
    const result = classify(changes)
    assert.notEqual(result.status, 0, `${why} was accepted`)
  }
  refused([...creates(), { address: 'aws_iam_role.ecs_task', mode: 'managed', change: { actions: ['update'], after: {} } }], 'a change to the task role')
  refused(creates().map((c) => (c.address === 'aws_s3_bucket.load_test_handoff' ? { ...c, change: { actions: ['delete', 'create'], after: c.change.after } } : c)), 'a replace')
  refused(creates({ 'aws_iam_role_policy.ecs_task_load_test_handoff': { name: 'sea-n-shore-staging-load-test-handoff', policy: JSON.stringify({ Statement: [{ ...taskPolicy.Statement[0], Action: ['s3:PutObject', 's3:GetObject'] }] }) } }), 'a task read')
  refused(creates({ 'aws_iam_role_policy.ecs_task_load_test_handoff': { name: 'sea-n-shore-staging-load-test-handoff', policy: JSON.stringify({ Statement: [{ ...taskPolicy.Statement[0], Resource: `${BUCKET_ARN}/*` }] }) } }), 'a bucket-wide write')
  refused(creates({ 'aws_kms_key.load_test_handoff': { enable_key_rotation: true, deletion_window_in_days: 7, policy: JSON.stringify(keyPolicy({ extra: [{ Sid: 'More', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCOUNT}:root` }, Action: ['kms:Decrypt'], Resource: '*' }] })) } }), 'an account-wide decrypt')
  refused(creates({ 'aws_kms_key.load_test_handoff': { enable_key_rotation: false, deletion_window_in_days: 7, policy: JSON.stringify(keyPolicy()) } }), 'no rotation')
  refused(creates({ 'aws_s3_bucket_lifecycle_configuration.load_test_handoff': { rule: [{ status: 'Enabled', expiration: [{ days: 7 }], abort_incomplete_multipart_upload: [{ days_after_initiation: 1 }] }] } }), 'a 7-day expiry')
  refused(creates({ 'aws_s3_bucket_server_side_encryption_configuration.load_test_handoff': { rule: [{ bucket_key_enabled: true, apply_server_side_encryption_by_default: [{ sse_algorithm: 'AES256' }] }] } }), 'S3-managed encryption')
  refused(creates({ 'aws_s3_bucket_public_access_block.load_test_handoff': { block_public_acls: true, block_public_policy: false, ignore_public_acls: true, restrict_public_buckets: true } }), 'a public policy')
  refused(creates({ 'aws_s3_bucket_policy.load_test_handoff': { policy: JSON.stringify({ Statement: bucketPolicy.Statement.slice(0, 2) }) } }), 'a missing deny')
})

test('the live key policy check matches only the approved policy', () => {
  assert.equal(liveKeyPolicy(keyPolicy()), 'true')
  // KMS may return single values as strings: still the same policy.
  const flattened = keyPolicy()
  flattened.Statement[1] = { ...flattened.Statement[1], Action: 'kms:GenerateDataKey' }
  assert.equal(liveKeyPolicy(flattened), 'true')
  assert.equal(liveKeyPolicy(keyPolicy({ extra: [{ Sid: 'Grant', Effect: 'Allow', Principal: { AWS: TASK_ROLE }, Action: ['kms:CreateGrant'], Resource: '*' }] })), 'false')
  const wrongRunner = keyPolicy()
  wrongRunner.Statement[2] = { ...wrongRunner.Statement[2], Principal: { AWS: TASK_ROLE } }
  assert.equal(liveKeyPolicy(wrongRunner), 'false')
})
