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

  assert.doesNotMatch(sql, /\b(drop|truncate|update|insert|alter)\b|\bdelete\s+from\b/i)
})

