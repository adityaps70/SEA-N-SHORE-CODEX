import { describe, expect, it } from 'vitest'
import { createCreatorVerificationRepository } from './repository'

const profileId = '11111111-1111-4111-8111-111111111111'
const verificationId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'

const application = {
  professionalRole: 'Crewing Manager',
  organizationName: 'Independent recruiter',
  experienceYears: 8,
  specializations: ['Tanker officers', 'Bulk carrier crew'],
  experienceSummary: 'I have recruited maritime professionals across deck and engine departments for several vessel segments.',
  evidenceUrl: 'https://www.linkedin.com/in/example',
  additionalNote: 'Available for a verification call if required.',
}

describe('creator verification repository', () => {
  it('loads a user verification application state with review context', async () => {
    const repository = createCreatorVerificationRepository({
      query: async () => [{
        id: verificationId,
        verification_type: 'recruiter',
        status: 'rejected',
        source: 'application',
        application_payload: application,
        submitted_at: '2026-09-25T08:00:00.000Z',
        reviewed_at: '2026-09-25T09:00:00.000Z',
        review_note: 'Add a stronger proof URL.',
      }],
    })

    await expect(repository.getState(profileId, 'recruiter')).resolves.toEqual({
      id: verificationId,
      type: 'recruiter',
      status: 'rejected',
      source: 'application',
      application,
      submittedAt: '2026-09-25T08:00:00.000Z',
      reviewedAt: '2026-09-25T09:00:00.000Z',
      reviewNote: 'Add a stronger proof URL.',
    })
  })

  it('creates a first recruiter application as pending without granting an entitlement', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.feature_verifications') && text.includes('for update')) return []
      if (text.includes('insert into public.feature_verifications')) return [{ id: verificationId }]
      return []
    }
    const repository = createCreatorVerificationRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.submitApplication(profileId, 'recruiter', application)).resolves.toEqual({
      verificationId,
    })

    const insert = seen.find((entry) => entry.text.includes('insert into public.feature_verifications'))
    expect(insert?.values).toEqual([
      profileId,
      'recruiter',
      JSON.stringify(application),
    ])
    expect(seen.some((entry) => entry.text.includes('entitlement_grants'))).toBe(false)
    expect(seen.some((entry) => entry.text.includes('verification.application_submitted'))).toBe(true)
  })

  it('resubmits a rejected application but refuses pending, approved or suspended verification', async () => {
    for (const [status, expected] of [
      ['pending', 'verification_application_pending'],
      ['approved', 'verification_already_approved'],
      ['suspended', 'verification_suspended'],
    ] as const) {
      const query = async (text: string) => {
        if (text.includes('from public.feature_verifications') && text.includes('for update')) {
          return [{ id: verificationId, verification_type: 'event_host', status, source: 'application' }]
        }
        return []
      }
      const repository = createCreatorVerificationRepository({
        query,
        transaction: async (work) => work(query),
      })

      await expect(repository.submitApplication(profileId, 'event_host', application)).rejects.toThrow(expected)
    }

    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const rejectedQuery = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.feature_verifications') && text.includes('for update')) {
        return [{ id: verificationId, verification_type: 'event_host', status: 'rejected', source: 'application' }]
      }
      return []
    }
    const repository = createCreatorVerificationRepository({
      query: rejectedQuery,
      transaction: async (work) => work(rejectedQuery),
    })

    await expect(repository.submitApplication(profileId, 'event_host', application)).resolves.toEqual({
      verificationId,
    })
    const update = seen.find((entry) => entry.text.includes('update public.feature_verifications'))
    expect(update?.text).toContain("status = 'pending'")
    expect(update?.text).toContain('application_payload')
    expect(update?.text).toContain('reviewed_by = null')
  })

  it('lists pending recruiter/event-host applications for an administrator', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('public.user_roles')) return [{ allowed: true }]
      return [{
        id: verificationId,
        verification_type: 'event_host',
        status: 'pending',
        source: 'application',
        application_payload: { ...application, professionalRole: 'Maritime Event Organizer' },
        submitted_at: '2026-09-25T08:00:00.000Z',
        reviewed_at: null,
        review_note: null,
        profile_id: profileId,
        full_name: 'Asha Singh',
        slug: 'asha-singh',
        headline: 'Maritime Event Organizer',
      }]
    }
    const repository = createCreatorVerificationRepository({ query })

    await expect(repository.listAdminApplications(adminId, 'pending')).resolves.toEqual([
      expect.objectContaining({
        id: verificationId,
        type: 'event_host',
        applicant: {
          id: profileId,
          fullName: 'Asha Singh',
          slug: 'asha-singh',
          headline: 'Maritime Event Organizer',
        },
      }),
    ])
    expect(seen[1]?.text).toContain('public.feature_verifications')
    expect(seen[1]?.values).toEqual(['pending'])
  })

  it('approves or rejects pending applications with audit history and never changes paid entitlements', async () => {
    for (const decision of ['approved', 'rejected'] as const) {
      const seen: Array<{ text: string; values?: readonly unknown[] }> = []
      const query = async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles') && text.includes('for update')) return [{ allowed: true }]
        if (text.includes('from public.feature_verifications') && text.includes('for update')) {
          return [{
            id: verificationId,
            profile_id: profileId,
            verification_type: 'recruiter',
            status: 'pending',
            source: 'application',
          }]
        }
        return []
      }
      const repository = createCreatorVerificationRepository({
        query,
        transaction: async (work) => work(query),
      })

      await expect(repository.reviewApplication(
        adminId,
        verificationId,
        decision,
        decision === 'rejected' ? 'Evidence could not be verified.' : null,
      )).resolves.toBe(true)

      const update = seen.find((entry) => entry.text.includes('update public.feature_verifications'))
      expect(update?.values).toContain(decision)
      expect(seen.some((entry) => entry.text.includes('insert into public.audit_events') && entry.values?.includes(`verification.${decision}`))).toBe(true)
      expect(seen.some((entry) => entry.text.includes('entitlement_grants'))).toBe(false)
    }
  })
})
