import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'infra/aws/database/migrations/0050_unclaimed_organizations.sql'

function sql() {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true)
  return readFileSync(migrationPath, 'utf8').replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
}

describe('migration 0050: unclaimed organizations', () => {
  it('adds the claim status, when and by whom a page was claimed, and the claim review kind', () => {
    const normalized = sql()
    expect(normalized).toContain("add column if not exists claim_status text not null default 'claimed'")
    expect(normalized).toContain("claim_status in ('claimed', 'unclaimed')")
    expect(normalized).toContain('add column if not exists claimed_at timestamptz')
    expect(normalized).toContain('add column if not exists claimed_by_profile_id uuid references public.profiles(id) on delete set null')
    expect(normalized).toContain("add column if not exists request_kind text not null default 'registration'")
    expect(normalized).toContain("request_kind in ('registration', 'claim')")
  })

  it('blocks duplicate unclaimed names and keeps unclaimed pages unverified', () => {
    const normalized = sql()
    expect(normalized).toContain("create unique index if not exists companies_unclaimed_name_key on public.companies (lower(btrim(name))) where claim_status = 'unclaimed'")
    expect(normalized).toContain("claim_status = 'claimed' or coalesce(is_verified, false) = false")
  })

  it('marks a page claimed when Sea N Shore verifies it', () => {
    const normalized = sql()
    expect(normalized).toContain('create or replace function public.mark_organization_claimed_on_verification()')
    expect(normalized).toContain("new.claim_status := 'claimed'")
    expect(normalized).toContain('before update of is_verified on public.companies')
  })

  it('is additive and safe to run twice', () => {
    const normalized = sql()
    expect(normalized).not.toMatch(/\bdrop\s+(table|type|column|index)\b/)
    expect(normalized).not.toMatch(/\btruncate\b/)
    expect(normalized).not.toMatch(/\bdelete\s+from\b/)
    expect(normalized).not.toMatch(/\bupdate public\./)
    expect(normalized.match(/add column (?!if not exists)/g) ?? []).toHaveLength(0)
    expect(normalized.match(/create (unique )?index (?!if not exists)/g) ?? []).toHaveLength(0)
    for (const constraint of normalized.match(/add constraint (\w+)/g) ?? []) {
      expect(normalized).toContain(`drop constraint if exists ${constraint.replace('add constraint ', '')}`)
    }
  })
})
