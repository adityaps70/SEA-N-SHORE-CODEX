// Round 14 (3.6): migration 0063 adds only performance indexes and pg_trgm, behind the usual
// plan / migrate-once guard.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('migration 0063 is additive: six CREATE ... IF NOT EXISTS statements and nothing else', async () => {
  const sql = await read('../../infra/aws/database/migrations/0063_performance_indexes.sql')
  const statements = sql.split(/^\s*-- statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean)
  assert.equal(statements.length, 6)
  assert.match(statements[0], /create index if not exists posts_author_created_live_idx\s+on public\.posts \(author_id, created_at desc, id desc\)\s+where deleted_at is null;/)
  assert.match(statements[1], /create index if not exists profiles_updated_at_idx\s+on public\.profiles \(updated_at desc, id\);/)
  assert.match(statements[2], /create extension if not exists pg_trgm;/)
  assert.match(statements[3], /community_groups using gin \(name gin_trgm_ops\)/)
  assert.match(statements[4], /companies using gin \(name gin_trgm_ops\)/)
  assert.match(statements[5], /events using gin \(title gin_trgm_ops\)/)
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(drop|truncate|delete|alter|insert)\b/i)
})

test('the runner is guarded, transactional and verifies every index', async () => {
  const script = await read('./performance-indexes-migration.sh')
  const action = guardAction(await read('./performance-indexes-migration-action.txt'))
  const workflow = await read('../../.github/workflows/aws-performance-indexes-migration.yml')
  const ci = await read('../../.github/workflows/aws-infra-ci.yml')
  assert.ok(['plan', 'migrate-once'].includes(action))
  assert.match(script, /0063_performance_indexes\.sql/)
  assert.match(script, /expected 6 statements/)
  assert.match(script, /only CREATE INDEX IF NOT EXISTS and CREATE EXTENSION IF NOT EXISTS pg_trgm are allowed/)
  assert.match(script, /pg_advisory_xact_lock/)
  assert.match(script, /SET LOCAL lock_timeout = '5s'/)
  assert.match(script, /PERFORMANCE_INDEXES_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /PERFORMANCE_INDEXES_APPLY_VERIFIED=true/)
  assert.match(script, /PERFORMANCE_INDEXES_ALREADY_APPLIED=true/)
  assert.match(workflow, /export PERFORMANCE_INDEXES_EXPECTED_SHA=\{sha\}/)
  assert.match(ci, /node --test scripts\/aws\/performance-indexes-migration\.test\.mjs/)
})
