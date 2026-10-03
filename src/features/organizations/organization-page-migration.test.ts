import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'infra/aws/database/migrations/0043_organization_page_profile.sql'

function sql() {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true)
  return readFileSync(migrationPath, 'utf8').replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
}

describe('migration 0043: organization page profile fields', () => {
  it('adds cover image, tagline, company size and specialities to companies', () => {
    const normalized = sql()
    expect(normalized).toContain('add column if not exists cover_path text')
    expect(normalized).toContain('add column if not exists tagline text')
    expect(normalized).toContain('add column if not exists company_size text')
    expect(normalized).toContain("add column if not exists specialties text[] not null default '{}'")
    expect(normalized).toContain("'1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'")
    expect(normalized).toContain('char_length(tagline) between 1 and 160')
    expect(normalized).toContain('create index if not exists organization_follows_company_idx')
  })

  it('is additive and safe to run twice', () => {
    const normalized = sql()
    expect(normalized).not.toMatch(/\bdrop\s+(table|type|column|index)\b/)
    expect(normalized).not.toMatch(/\btruncate\b/)
    expect(normalized).not.toMatch(/\bdelete\s+from\b/)
    expect(normalized).not.toMatch(/\bupdate public\./)
    expect(normalized.match(/add column (?!if not exists)/g) ?? []).toHaveLength(0)
    for (const constraint of normalized.match(/add constraint (\w+)/g) ?? []) {
      expect(normalized).toContain(`drop constraint if exists ${constraint.replace('add constraint ', '')}`)
    }
  })
})
