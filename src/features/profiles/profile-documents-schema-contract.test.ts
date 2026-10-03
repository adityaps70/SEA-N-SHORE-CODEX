import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('infra/aws/database/migrations/0037_profile_documents_username_generation.sql', 'utf8')
const onboardingRepository = readFileSync('src/features/profiles/onboarding-repository.ts', 'utf8')
const inlineEditService = readFileSync('src/features/profiles/profile-inline-edit-service.ts', 'utf8')
const accountDeletion = readFileSync('src/features/account-deletion/repository.ts', 'utf8')

describe('profile documents and generated usernames schema (migration 0037)', () => {
  it('is safe to apply twice', () => {
    expect(migration).toContain('create table if not exists public.profile_documents')
    expect(migration).toContain('create unique index if not exists profile_documents_profile_kind_key')
    expect(migration).toContain('create unique index if not exists profile_documents_storage_path_key')
    expect(migration).toContain('add column if not exists username_auto_generated')
    expect(migration.match(/drop constraint if exists/g)?.length).toBe(2)
    expect(migration).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from\b/i)
  })

  it('keeps one private DG profile PDF per member with bounded metadata', () => {
    expect(migration).toContain('profile_id uuid not null references public.profiles(id) on delete cascade')
    expect(migration).toContain("check (kind in ('dg_profile'))")
    expect(migration).toContain("mime_type = 'application/pdf'")
    expect(migration).toContain('size_bytes between 1 and 10485760')
    expect(migration).toContain('on public.profile_documents (profile_id, kind)')
  })

  it('does not spend a limited username change when replacing a generated handle', () => {
    for (const source of [onboardingRepository, inlineEditService]) {
      expect(source).toContain('case when slug is distinct from $3 and not username_auto_generated then 1 else 0 end')
      expect(source).toContain('username_auto_generated = username_auto_generated and slug is not distinct from $3')
    }
    expect(onboardingRepository).toContain('username_auto_generated = $13')
  })

  it('removes a deleted account’s private documents from storage and the database', () => {
    expect(accountDeletion).toContain('from public.profile_documents d')
    expect(accountDeletion).toContain('delete from public.profile_documents')
  })
})
