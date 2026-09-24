import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  reviewOrganizationApplication: vi.fn(),
  reviewCompanyAccessRequest: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', () => ({
  adminRepository: {
    reviewOrganizationApplication: mocks.reviewOrganizationApplication,
    reviewCompanyAccessRequest: mocks.reviewCompanyAccessRequest,
  },
}))

import { reviewCompanyAccessRequest, reviewOrganizationApplication } from './actions'

const applicationId = '22222222-2222-4222-8222-222222222222'

describe('platform admin organization review actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'sub-1', email: 'admin@example.com' })
    mocks.reviewOrganizationApplication.mockResolvedValue(true)
    mocks.reviewCompanyAccessRequest.mockResolvedValue(true)
  })

  it('rejects invalid ids and decisions before authentication', async () => {
    await expect(reviewOrganizationApplication('bad-id', 'approved', null)).resolves.toMatchObject({ ok: false })
    await expect(reviewOrganizationApplication(applicationId, 'unknown' as never, null)).resolves.toMatchObject({ ok: false })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewOrganizationApplication).not.toHaveBeenCalled()
  })

  it('requires a reviewer note for changes, rejection and suspension', async () => {
    for (const decision of ['changes_requested', 'rejected', 'suspended'] as const) {
      await expect(reviewOrganizationApplication(applicationId, decision, '   ')).resolves.toMatchObject({ ok: false })
    }
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewOrganizationApplication).not.toHaveBeenCalled()
  })

  it('approves with authenticated administrator identity and refreshes admin and applicant surfaces', async () => {
    await expect(reviewOrganizationApplication(applicationId, 'approved', 'Verified records.')).resolves.toEqual({ ok: true })

    expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith('admin-1', applicationId, 'approved', 'Verified records.')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/organizations')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/organizations/${applicationId}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/organization')
  })

  it('returns safe forbidden copy when repository admin authorization fails', async () => {
    mocks.reviewOrganizationApplication.mockRejectedValueOnce(new Error('admin_forbidden'))

    await expect(reviewOrganizationApplication(applicationId, 'approved', null)).resolves.toEqual({
      ok: false,
      error: 'You do not have permission to review organization applications.',
    })
  })

  it('returns safe decision-state copy when the requested transition is not allowed', async () => {
    mocks.reviewOrganizationApplication.mockRejectedValueOnce(new Error('organization_review_transition_forbidden'))

    await expect(reviewOrganizationApplication(applicationId, 'suspended', 'Review required.')).resolves.toEqual({
      ok: false,
      error: 'This organization application cannot move to that review state.',
    })
  })
})


describe('platform admin company access review actions', () => {
  const requestId = '66666666-6666-4666-8666-666666666666'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'sub-1', email: 'admin@example.com' })
    mocks.reviewCompanyAccessRequest.mockResolvedValue(true)
  })

  it('validates request id and requires a rejection note before authentication', async () => {
    await expect(reviewCompanyAccessRequest('bad-id', 'approved', null)).resolves.toMatchObject({ ok: false })
    await expect(reviewCompanyAccessRequest(requestId, 'rejected', '   ')).resolves.toMatchObject({ ok: false })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewCompanyAccessRequest).not.toHaveBeenCalled()
  })

  it('approves an access request with authenticated administrator identity', async () => {
    await expect(reviewCompanyAccessRequest(requestId, 'approved', 'Verified relationship.')).resolves.toEqual({ ok: true })
    expect(mocks.reviewCompanyAccessRequest).toHaveBeenCalledWith(
      'admin-1',
      requestId,
      'approved',
      'Verified relationship.',
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/access')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/organization')
  })

  it('returns safe copy when the access request was already reviewed', async () => {
    mocks.reviewCompanyAccessRequest.mockRejectedValueOnce(new Error('company_access_request_review_forbidden'))
    await expect(reviewCompanyAccessRequest(requestId, 'approved', null)).resolves.toEqual({
      ok: false,
      error: 'This organization access request has already been reviewed.',
    })
  })
})
