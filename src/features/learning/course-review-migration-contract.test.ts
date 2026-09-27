import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('infra/aws/database/migrations/0041_learning_course_review_revisions.sql', 'utf8')

describe('0041 course review revisions migration', () => {
  it('adds the details revision counter used to refuse stale saves', () => {
    expect(sql).toMatch(/alter table public\.learning_courses\s+add column if not exists details_revision integer not null default 1/i)
  })

  it('creates the submission history table with snapshot, outcome and reviewer note', () => {
    expect(sql).toMatch(/create table if not exists public\.learning_course_submissions/i)
    for (const column of ['course_id', 'submitted_by', 'submitted_at', 'details_revision', 'snapshot jsonb', 'outcome', 'reviewer_id', 'reviewer_note', 'reviewed_at']) {
      expect(sql).toContain(column)
    }
    expect(sql).toMatch(/outcome in \('pending', 'approved', 'changes_requested', 'withdrawn'\)/)
    expect(sql).toMatch(/on delete cascade/)
  })

  it('is safe to run twice and never drops data', () => {
    expect(sql).not.toMatch(/drop table|drop column|truncate|delete from/i)
    for (const statement of sql.match(/create (unique )?index[^;]+;/gi) ?? []) {
      expect(statement).toMatch(/if not exists/i)
    }
    for (const statement of sql.match(/add constraint[^;]+;/gi) ?? []) {
      expect(sql.slice(0, sql.indexOf(statement))).toMatch(/drop constraint if exists/i)
    }
    expect(sql).toMatch(/unique index if not exists learning_course_submissions_one_pending_idx[\s\S]*where outcome = 'pending'/i)
  })
})
