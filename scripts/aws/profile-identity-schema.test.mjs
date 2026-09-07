import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0005_profile_identity.sql'

test('exact identity migration supports lightweight activation without breaking legacy profiles', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /alter table public\.profiles/i)
  assert.match(sql, /add column if not exists identity_root text/i)
  assert.match(sql, /add column if not exists primary_identity text/i)
  assert.match(sql, /add column if not exists primary_identity_family text/i)
  assert.match(sql, /add column if not exists secondary_identities text\[\][\s\S]*default\s+'\{\}'/i)

  assert.match(sql, /drop constraint if exists profiles_full_name_check/i)
  assert.match(sql, /constraint profiles_full_name_check[\s\S]*char_length\(full_name\) between 2 and 160/i)

  assert.match(sql, /drop constraint if exists profiles_completed_identity_check/i)
  assert.match(sql, /constraint profiles_completed_identity_check/i)
  assert.match(sql, /identity_root is not null/i)
  assert.match(sql, /primary_identity is not null/i)
  assert.match(sql, /primary_identity_family is not null/i)
  assert.match(sql, /summary is not null[\s\S]*char_length\(summary\) between 20 and 2000/i)

  assert.match(sql, /identity_root in \('professional', 'organisation'\)/i)
  assert.match(sql, /cardinality\(secondary_identities\) <= 10/i)
  assert.match(sql, /num_nonnulls\(identity_root, primary_identity, primary_identity_family\) in \(0, 3\)/i)

  assert.doesNotMatch(sql, /drop\s+(table|column)|truncate\s|delete\s|update\s|insert\s/i)
})

test('profile identity migration runner is exact-head, staging-only, plan-first and fail-closed', () => {
  const runner = readFileSync('scripts/aws/profile-identity-migration.sh', 'utf8')
  const workflow = readFileSync('.github/workflows/aws-profile-identity-migration.yml', 'utf8')
  const action = readFileSync('scripts/aws/profile-identity-migration-action.txt', 'utf8').trim()

  assert.equal(action, 'plan')
  assert.match(runner, /PROFILE_IDENTITY_MIGRATION_EXPECTED_SHA/)
  assert.match(runner, /git rev-parse HEAD/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /310356785722/)
  assert.match(runner, /sea-n-shore-staging-aurora/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /PROFILE_IDENTITY_MIGRATION_APPLY_VERIFIED=true/)
  assert.doesNotMatch(runner, /drop\s+(table|column)|truncate\s|delete\s+from|update\s+public\.|insert\s+into/i)

  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /PROFILE_IDENTITY_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /AWS-RunShellScript/)
  assert.match(workflow, /sea-n-shore-bootstrap/)
  assert.match(workflow, /print\(json\.dumps\(\{"executionTimeout": \["1200"\], "commands": \[/)
  assert.doesNotMatch(workflow, /json\.dumps\(\{\{/)
})
