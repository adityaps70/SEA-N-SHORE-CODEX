import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0032_membership_access_foundation.sql'

test('membership access foundation is additive and separates persona, plans, verification and grants', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  const sql = readFileSync(migrationPath, 'utf8')
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase()

  assert.match(normalized, /alter table public\.profiles add column if not exists persona text/)
  assert.match(normalized, /add column if not exists profile_intents text\[\]/)
  assert.match(normalized, /seafarer_family/)
  assert.match(normalized, /maritime_enthusiast/)

  assert.match(normalized, /create table if not exists public\.account_subscriptions/)
  assert.match(normalized, /creator_pro/)
  assert.match(normalized, /organization_pro/)
  assert.match(normalized, /create table if not exists public\.plan_entitlements/)
  assert.match(normalized, /job\.publish/)
  assert.match(normalized, /event\.publish/)
  assert.match(normalized, /course\.publish/)

  assert.match(normalized, /create table if not exists public\.feature_verifications/)
  assert.match(normalized, /application_payload jsonb/)
  assert.match(normalized, /submitted_at timestamptz/)
  assert.match(normalized, /feature_verifications_payload_object_check/)
  assert.match(normalized, /recruiter.*trainer.*event_host/)
  assert.match(normalized, /create table if not exists public\.entitlement_grants/)
  assert.match(normalized, /create table if not exists public\.legacy_organization_conversions/)
  assert.match(normalized, /legacy_snapshot jsonb/)
  assert.match(normalized, /identity_root = 'organisation'/)
  assert.match(normalized, /jsonb_build_object/)

  assert.match(normalized, /alter table public\.events add column if not exists company_id uuid references public\.companies\(id\) on delete set null/)
  assert.match(normalized, /events_company_idx/)
  assert.match(normalized, /alter table public\.learning_courses add column if not exists created_by_user_id uuid references public\.profiles\(id\) on delete restrict/)
  assert.match(normalized, /add column if not exists company_id uuid references public\.companies\(id\) on delete set null/)
  assert.match(normalized, /alter column mentor_id drop not null/)
  assert.match(normalized, /learning_courses_publisher_shape_check/)
  assert.match(normalized, /learning_courses_company_idx/)

  assert.match(normalized, /insert into public\.feature_verifications/)
  assert.match(normalized, /learning_mentors/)
  assert.match(normalized, /company_members/)
  assert.match(normalized, /insert into public\.entitlement_grants/)
  assert.match(normalized, /legacy_migration/)

  assert.doesNotMatch(normalized, /\bdrop\s+(table|column|type)\b/)
  assert.doesNotMatch(normalized, /\btruncate\b/)
  assert.doesNotMatch(normalized, /\bdelete\s+from\b/)
})

test('new onboarding compatibility keeps legacy identity fields during migration', () => {
  const normalized = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()

  assert.match(normalized, /drop constraint if exists profiles_completed_identity_check/)
  assert.match(normalized, /persona is not null/)
  assert.match(normalized, /identity_root is not null/)
  assert.match(normalized, /summary is not null/)
  assert.doesNotMatch(normalized, /drop column if exists identity_root/)
  assert.doesNotMatch(normalized, /drop column if exists primary_identity/)
})
