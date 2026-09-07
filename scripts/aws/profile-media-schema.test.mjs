import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('profile media migration adds only the nullable cover path', () => {
  const sql = readFileSync('infra/aws/database/migrations/0004_profile_media.sql', 'utf8')
  assert.match(sql, /alter table public\.profiles/i)
  assert.match(sql, /add column if not exists cover_path text/i)
  assert.doesNotMatch(sql, /drop\s|delete\s|truncate\s/i)
})
