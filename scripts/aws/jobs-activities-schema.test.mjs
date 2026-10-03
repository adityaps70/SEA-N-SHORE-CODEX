import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'infra/aws/database/migrations/0007_jobs_activities.sql'

function migrationSql() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8').toLowerCase() : ''
}

describe('jobs and activities migration', () => {
  it('is additive and contains the approved schema', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = migrationSql()
    expect(sql).not.toMatch(/\b(drop|truncate)\b|\bdelete\s+from\b/)
    expect(sql).toContain("create type public.job_listing_status as enum ('draft', 'published', 'closed')")
    expect(sql).toContain("'applied'")
    expect(sql).toContain("'under_review'")
    expect(sql).toContain("'shortlisted'")
    expect(sql).toContain("'interview'")
    expect(sql).toContain("'selected'")
    expect(sql).toContain("'rejected'")
    expect(sql).toContain("'withdrawn'")
    expect(sql).toContain('create table if not exists public.jobs')
    expect(sql).toContain('create table if not exists public.job_applications')
    expect(sql).toContain('unique (job_id, applicant_id)')
    expect(sql).toContain('jobs_published_created_idx')
    expect(sql).toContain('job_applications_applicant_applied_idx')
    expect(sql).toContain('post_comments_author_created_idx')
  })
})
