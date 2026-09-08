import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0006_profile_passport.sql'

test('Maritime Passport migration is additive, owner-linked and verification-safe', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create table if not exists public\.profile_experiences/i)
  assert.match(sql, /profile_id uuid not null references public\.profiles\(id\) on delete cascade/i)
  assert.match(sql, /track in \('sea_service', 'shore_role', 'training', 'other_maritime'\)/i)
  assert.match(sql, /cargo_experience text\[\] not null default '\{\}'::text\[\]/i)
  assert.match(sql, /engine_experience text\[\] not null default '\{\}'::text\[\]/i)
  assert.match(sql, /trading_areas text\[\] not null default '\{\}'::text\[\]/i)
  assert.match(sql, /create index if not exists profile_experiences_profile_order_idx/i)

  assert.match(sql, /create table if not exists public\.profile_credentials/i)
  assert.match(sql, /verification_state text not null default 'self_reported'/i)
  assert.match(sql, /verification_state in \('self_reported', 'pending', 'verified', 'rejected'\)/i)
  assert.match(sql, /create index if not exists profile_credentials_profile_order_idx/i)

  assert.doesNotMatch(sql, /\b(drop|truncate|delete|update|insert|alter)\b/i)
})

test('Maritime Passport migration runner is exact-head, staging-only, explicit-action and transactional', () => {
  const runner = readFileSync('scripts/aws/profile-passport-migration.sh', 'utf8')
  const workflow = readFileSync('.github/workflows/aws-profile-passport-migration.yml', 'utf8')
  const action = readFileSync('scripts/aws/profile-passport-migration-action.txt', 'utf8').trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected migration action: ${action}`)
  assert.match(runner, /PROFILE_PASSPORT_MIGRATION_EXPECTED_SHA/)
  assert.match(runner, /git rev-parse HEAD/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /310356785722/)
  assert.match(runner, /sea-n-shore-staging-aurora/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /PROFILE_PASSPORT_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /statement-breakpoint/)
  assert.match(runner, /PROFILE_PASSPORT_MIGRATION_APPLY_VERIFIED=true/)
  assert.doesNotMatch(runner, /drop\s+(table|column)|truncate\s|delete\s+from|update\s+public\.|insert\s+into/i)

  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /PROFILE_PASSPORT_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /AWS-RunShellScript/)
  assert.match(workflow, /sea-n-shore-bootstrap/)
})
