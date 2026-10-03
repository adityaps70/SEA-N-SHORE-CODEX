import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0011_organization_hiring_approval.sql'

test('organization hiring approval migration is additive and defines review workflows', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  const sql = readFileSync(migrationPath, 'utf8')
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase()

  assert.match(normalized, /create table if not exists public\.organization_applications/)
  assert.match(normalized, /create table if not exists public\.company_access_requests/)
  assert.match(normalized, /pending.*changes_requested.*approved.*rejected.*suspended/)
  assert.match(normalized, /join_company.*recruiter_access/)
  assert.match(normalized, /pending.*approved.*rejected.*cancelled/)
  assert.match(normalized, /requested_role public\.company_member_role/)
  assert.match(normalized, /create unique index if not exists company_access_requests_pending_unique/)
  assert.match(normalized, /where status = 'pending'/)
  assert.match(normalized, /create index if not exists organization_applications_admin_queue_idx/)
  assert.match(normalized, /create index if not exists company_access_requests_admin_queue_idx/)

  assert.doesNotMatch(normalized, /\bdrop\s+(table|type|column)\b/)
  assert.doesNotMatch(normalized, /\btruncate\b/)
  assert.doesNotMatch(normalized, /\bdelete\s+from\b/)
})

test('migration preserves existing approved hiring companies before verified-company enforcement', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  const normalized = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()

  assert.match(normalized, /update public\.companies c set is_verified = true/)
  assert.match(normalized, /from public\.company_members cm/)
  assert.match(normalized, /cm\.approved_at is not null/)
  assert.match(normalized, /cm\.role::text in \('owner', 'administrator', 'recruiter'\)/)
  assert.match(normalized, /where c\.id = cm\.company_id/)
  assert.match(normalized, /and c\.is_verified = false/)
})
