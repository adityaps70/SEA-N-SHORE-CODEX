import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'infra/aws/database/migrations/0038_organization_types_and_access_decisions.sql'

function sql() {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true)
  return readFileSync(migrationPath, 'utf8').replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
}

describe('migration 0038: organization types and organization-led access decisions', () => {
  it('adds type and type-detail columns to companies without rewriting existing type labels', () => {
    const normalized = sql()
    expect(normalized).toContain('add column if not exists organization_type text')
    expect(normalized).toContain("add column if not exists organization_details jsonb not null default '{}'::jsonb")
    expect(normalized).toContain('drop constraint if exists companies_organization_type_check')
    expect(normalized).toContain("jsonb_typeof(organization_details) = 'object'")
    expect(normalized).not.toMatch(/update public\.companies/)
  })

  it('records granted role, who decided and requester escalations on access requests', () => {
    const normalized = sql()
    expect(normalized).toContain('add column if not exists granted_role public.company_member_role')
    expect(normalized).toContain('add column if not exists decided_via text')
    expect(normalized).toContain('add column if not exists escalated_at timestamptz')
    expect(normalized).toContain('add column if not exists escalation_note text')
    expect(normalized).toContain("decided_via in ('organization', 'platform')")
    // Earlier decisions were all made by Sea N Shore platform administrators.
    expect(normalized).toMatch(/set decided_via = 'platform' where decided_via is null and reviewed_by is not null/)
    expect(normalized).toContain('create index if not exists company_access_requests_escalated_idx')
  })

  it('is additive and safe to run twice', () => {
    const normalized = sql()
    expect(normalized).not.toMatch(/\bdrop\s+(table|type|column)\b/)
    expect(normalized).not.toMatch(/\btruncate\b/)
    expect(normalized).not.toMatch(/\bdelete\s+from\b/)
    const adds = normalized.match(/add column (?!if not exists)/g) ?? []
    expect(adds).toHaveLength(0)
    const constraints = normalized.match(/add constraint (\w+)/g) ?? []
    for (const constraint of constraints) {
      const name = constraint.replace('add constraint ', '')
      expect(normalized).toContain(`drop constraint if exists ${name}`)
    }
  })
})
