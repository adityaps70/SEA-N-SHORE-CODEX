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
