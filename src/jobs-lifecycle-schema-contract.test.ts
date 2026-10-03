import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'infra/aws/database/migrations/0034_job_lifecycle_reliability.sql'

describe('jobs lifecycle database contract', () => {
  it('adds soft delete, archive time and applicant cover note columns idempotently', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/alter table public\.jobs[\s\S]*add column if not exists archived_at timestamptz/i)
    expect(sql).toMatch(/add column if not exists deleted_at timestamptz/i)
    expect(sql).toMatch(/add column if not exists deleted_by uuid references public\.profiles\(id\) on delete set null/i)
    expect(sql).toMatch(/alter table public\.job_applications[\s\S]*add column if not exists cover_note text/i)
    expect(sql).toMatch(/drop constraint if exists job_applications_cover_note_check/i)
    expect(sql).toMatch(/char_length\(cover_note\) between 1 and 2000/i)
    expect(sql).toMatch(/create index if not exists jobs_created_by_active_idx[\s\S]*where deleted_at is null/i)
  })

  it('never removes existing jobs or applications', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
  })
})
