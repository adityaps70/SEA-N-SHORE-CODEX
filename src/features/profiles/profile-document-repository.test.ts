import { describe, expect, it, vi } from 'vitest'
import { createProfileDocumentRepository } from './profile-document-repository'

const ownerId = '11111111-1111-4111-8111-111111111111'
const viewerId = '22222222-2222-4222-8222-222222222222'

describe('profile document repository', () => {
  it('grants employer access only through a non-withdrawn application to a job the viewer manages', async () => {
    const query = vi.fn(async () => [{ is_admin: false, is_employer: true }])
    const repository = createProfileDocumentRepository({ query })

    await expect(repository.getViewerAccess(viewerId, ownerId)).resolves.toEqual({ isAdmin: false, isEmployer: true })

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('from public.job_applications a')
    expect(sql).toContain('a.applicant_id = $2')
    expect(sql).toContain("a.status::text <> 'withdrawn'")
    expect(sql).toContain('j.company_id is null and j.created_by_user_id = $1')
    expect(sql).toContain('cm.approved_at is not null')
    expect(sql).toContain('c.is_verified = true')
    expect(sql).toContain("ur.role::text = 'administrator'")
    expect(values).toEqual([viewerId, ownerId, ['owner', 'administrator', 'recruiter']])
  })

  it('treats a missing row as no access', async () => {
    const repository = createProfileDocumentRepository({ query: vi.fn(async () => []) })
    await expect(repository.getViewerAccess(viewerId, ownerId)).resolves.toEqual({ isAdmin: false, isEmployer: false })
  })

  it('upserts one DG profile per member and reports the file it replaced', async () => {
    const query = vi.fn(async () => [{
      kind: 'dg_profile',
      storage_path: 'profile-documents/new.pdf',
      file_name: 'dg.pdf',
      size_bytes: '2048',
      uploaded_at: new Date('2026-09-20T10:00:00.000Z'),
      previous_storage_path: 'profile-documents/old.pdf',
    }])
    const repository = createProfileDocumentRepository({ query })

    const saved = await repository.upsertDocument(ownerId, {
      kind: 'dg_profile',
      storagePath: 'profile-documents/new.pdf',
      fileName: 'dg.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    })

    expect(saved).toEqual({
      document: { kind: 'dg_profile', storagePath: 'profile-documents/new.pdf', fileName: 'dg.pdf', sizeBytes: 2048, uploadedAt: '2026-09-20T10:00:00.000Z' },
      previousStoragePath: 'profile-documents/old.pdf',
    })
    const [sql] = query.mock.calls[0] as unknown as [string]
    expect(sql).toContain('on conflict (profile_id, kind) do update')
  })

  it('reads eligibility from an active profile only', async () => {
    const query = vi.fn(async () => [{ persona: 'seafarer', profile_type: 'seafarer', onboarding_completed_at: null }])
    const repository = createProfileDocumentRepository({ query })
    await expect(repository.getOwner(ownerId)).resolves.toEqual({ persona: 'seafarer', profileType: 'seafarer', onboardingCompleted: false })
    const [sql] = query.mock.calls[0] as unknown as [string]
    expect(sql).toContain("account_status = 'active'")
  })
})
