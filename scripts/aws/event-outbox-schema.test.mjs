import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(new URL('../../infra/aws/database/migrations/0003_event_outbox.sql', import.meta.url), 'utf8')

test('event outbox migration defines durable publishing and idempotency tables', () => {
  assert.match(sql, /create table if not exists public\.event_outbox/i)
  assert.match(sql, /published_at timestamptz/i)
  assert.match(sql, /attempts integer not null default 0/i)
  assert.match(sql, /create index if not exists event_outbox_unpublished_idx/i)
  assert.match(sql, /where published_at is null/i)
  assert.match(sql, /create table if not exists public\.notification_event_receipts/i)
  assert.match(sql, /event_id uuid primary key/i)
  assert.match(sql, /processing_mode text not null/i)
  assert.match(sql, /processing_mode in \('shadow', 'active'\)/i)
})
