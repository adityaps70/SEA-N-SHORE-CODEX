import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = new URL('../../infra/aws/database/migrations/0012_events_engine.sql', import.meta.url)
const sql = readFileSync(migrationPath, 'utf8').toLowerCase()

test('events migration creates durable event and attendance tables', () => {
  assert.match(sql, /create table if not exists public\.events/)
  assert.match(sql, /host_user_id uuid not null references public\.profiles\(id\)/)
  assert.match(sql, /format text not null/)
  assert.match(sql, /status text not null/)
  assert.match(sql, /start_at timestamptz not null/)
  assert.match(sql, /end_at timestamptz not null/)
  assert.match(sql, /timezone text not null/)
  assert.match(sql, /topics text\[\]/)
  assert.match(sql, /create table if not exists public\.event_attendees/)
  assert.match(sql, /primary key \(event_id, user_id\)/)
})

test('events migration enforces maritime event integrity and discovery indexes', () => {
  for (const fragment of [
    'online', 'in_person', 'hybrid', 'draft', 'published', 'cancelled',
    'end_at > start_at', 'capacity', 'meeting_url', 'location_name',
    'events_discovery_idx', 'events_host_idx', 'event_attendees_user_idx',
  ]) assert.ok(sql.includes(fragment), `Missing events migration contract: ${fragment}`)
})
