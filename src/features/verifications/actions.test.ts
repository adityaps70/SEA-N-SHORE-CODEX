import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  submitApplication: vi.fn(),
  reviewApplication: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', () => ({
  creatorVerificationRepository: {
    submitApplication: mocks.submitApplication,
    reviewApplication: mocks.reviewApplication,
  },
}))

import { reviewCreatorVerificationApplication, submitCreatorVerification } from './actions'

const verificationId = '22222222-2222-4222-8222-222222222222'

function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  data.set('professionalRole', 'Crewing Manager')
  data.set('organizationName', 'Independent recruiter')
  data.set('experienceYears', '8')
  data.set('specializations', 'Tanker officers, Bulk carrier crew')
  data.set('experienceSummary', 'I have recruited maritime professionals across deck and engine departments for several vessel segments.')
  data.set('evidenceUrl', 'https://www.linkedin.com/in/example')
  data.set('additionalNote', 'Available for a verification call if required.')
  for (const [key, value] of Object.entries(overrides)) data.set(key, value)
  return data
}

describe('creator verification actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'user@example.com' })
    mocks.submitApplication.mockResolvedValue({ verificationId })
    mocks.reviewApplication.mockResolvedValue(true)
  })

  it('validates a recruiter application before authentication and preserves entered values', async () => {
    const result = await submitCreatorVerification('recruiter', {}, form({ experienceSummary: 'Too short' }))

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.experienceSummary?.[0]).toMatch(/more detail/i)
    expect(result.values).toMatchObject({
      professionalRole: 'Crewing Manager',
      organizationName: 'Independent recruiter',
      experienceYears: '8',
    })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })

  it('submits a normalized recruiter application for the authenticated user', async () => {
    await expect(submitCreatorVerification('recruiter', {}, form())).resolves.toEqual({
      ok: true,
      verificationId,
    })

    expect(mocks.submitApplication).toHaveBeenCalledWith('user-1', 'recruiter', {
      professionalRole: 'Crewing Manager',
      organizationName: 'Independent recruiter',
      experienceYears: 8,
      specializations: ['Tanker officers', 'Bulk carrier crew'],
      experienceSummary: 'I have recruited maritime professionals across deck and engine departments for several vessel segments.',
      evidenceUrl: 'https://www.linkedin.com/in/example',
      additionalNote: 'Available for a verification call if required.',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/verifications')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring')
  })

  it('maps pending, approved and suspended application conflicts to useful user copy', async () => {
    for (const [code, message] of [
      ['verification_application_pending', 'already under review'],
      ['verification_already_approved', 'already verified'],
      ['verification_suspended', 'suspended'],
    ] as const) {
      mocks.submitApplication.mockRejectedValueOnce(new Error(code))
      const result = await submitCreatorVerification('event_host', {}, form())
      expect(result.ok).toBe(false)
      expect(result.error?.toLowerCase()).toContain(message)
      expect(result.values?.professionalRole).toBe('Crewing Manager')
    }
  })

  it('requires a rejection note before authenticating an administrator review', async () => {
    const result = await reviewCreatorVerificationApplication(verificationId, 'rejected', '   ')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected verification review validation to fail.')
    expect(result.error).toMatch(/review note/i)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewApplication).not.toHaveBeenCalled()
  })

  it('approves a verification through the reviewed record only and does not activate a paid plan', async () => {
    await expect(reviewCreatorVerificationApplication(
      verificationId,
      'approved',
      null,
    )).resolves.toEqual({ ok: true })

    expect(mocks.reviewApplication).toHaveBeenCalledWith(
      'user-1',
      verificationId,
      'approved',
      null,
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/verifications')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/verifications')
  })

  it('returns safe copy when an application has already been reviewed', async () => {
    mocks.reviewApplication.mockRejectedValueOnce(new Error('verification_review_forbidden'))

    await expect(reviewCreatorVerificationApplication(
      verificationId,
      'approved',
      null,
    )).resolves.toEqual({
      ok: false,
      error: 'This verification application has already been reviewed.',
    })
  })
})
