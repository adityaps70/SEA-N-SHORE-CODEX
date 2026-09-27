import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('infra/aws/database/migrations/0042_profile_current_organization_link.sql', 'utf8')
const onboardingRepository = readFileSync('src/features/profiles/onboarding-repository.ts', 'utf8')
const inlineEditService = readFileSync('src/features/profiles/profile-inline-edit-service.ts', 'utf8')
const profileRepository = readFileSync('src/features/profiles/repository.ts', 'utf8')

describe('profile current organization link schema (migration 0042)', () => {
  it('is additive and safe to apply twice', () => {
    expect(migration).toContain('add column if not exists current_company_id uuid references public.companies(id) on delete set null')
    expect(migration).toContain('create index if not exists maritime_profiles_current_company_id_idx')
    expect(migration).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from\b|\bupdate public\./i)
  })

  it('writes the link wherever the current organization is saved', () => {
    expect(onboardingRepository.match(/current_company_id = excluded\.current_company_id/g)?.length).toBe(3)
    expect(inlineEditService).toContain('current_company_id = excluded.current_company_id')
  })

  it('reads the link only for organizations Sea N Shore lists', () => {
    expect(profileRepository).toContain("'current_company_id', mp.current_company_id")
    expect(profileRepository).toContain("listableOrganizationSql('linked_org')")
  })
})
