import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migrationPath = new URL('../../infra/aws/database/migrations/0010_jobs_intelligence.sql', import.meta.url)

function migrationSql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase()
}

test('jobs intelligence migration extends jobs additively with structured maritime fields', () => {
  const sql = migrationSql()
  for (const fragment of [
    'alter table public.jobs',
    'company_id',
    'created_by_user_id',
    'job_domain',
    'department',
    'rank',
    'vessel_types',
    'experience_min_years',
    'joining_from',
    'salary_min',
    'salary_currency',
    'sailing_regions',
    'urgent',
    'easy_apply',
    'published_at',
  ]) assert.match(sql, new RegExp(fragment.replaceAll('_', '[_]?')))
  assert.match(sql, /requirements\s+text/)
})

test('jobs intelligence migration creates candidate engagement, timeline and trust tables', () => {
  const sql = migrationSql()
  for (const table of [
    'job_certificate_requirements',
    'job_visa_requirements',
    'job_saves',
    'job_alerts',
    'job_application_events',
    'job_recruiter_notes',
    'job_reports',
    'profile_visas',
  ]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`))
})

test('jobs intelligence migration keeps recruiter ownership and company verification queryable', () => {
  const sql = migrationSql()
  assert.match(sql, /alter table public\.companies/)
  assert.match(sql, /is_verified/)
  assert.match(sql, /verified_at/)
  assert.match(sql, /verified_by/)
  assert.match(sql, /company_members/)
  assert.match(sql, /recruiter/)
})

test('jobs intelligence migration adds indexes for published search, saves, alerts and applicant pipelines', () => {
  const sql = migrationSql()
  for (const indexHint of [
    'jobs_discovery_idx',
    'jobs_search_idx',
    'job_saves_user_idx',
    'job_alerts_user_idx',
    'job_application_events_application_idx',
    'job_applications_job_status_idx',
  ]) assert.match(sql, new RegExp(indexHint))
})
