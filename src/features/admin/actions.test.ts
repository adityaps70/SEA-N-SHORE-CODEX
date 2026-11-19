import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  reviewOrganizationApplication: vi.fn(),
  reviewCompanyAccessRequest: vi.fn(),
  revalidatePath: vi.fn(),
  getOrganizationApplicationReview: vi.fn(),
  clearOrganizationPublicPage: vi.fn(),
}))

// Round 15: platform-admin server actions require a session that answered an authenticator app.
const adminMfa = vi.hoisted(() => ({
  isPlatformAdministrator: vi.fn(async (userId: string) => { void userId; return true }),
  getCurrentMfaStatus: vi.fn(async (): Promise<unknown> => ({ kind: 'eligible', enabled: true, email: 'admin@example.com', hostedSession: false })),
}))
vi.mock('@/features/auth/mfa-status', () => ({ getCurrentMfaStatus: adminMfa.getCurrentMfaStatus }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
// Round GP (Part C): the MFA gate also asks whether the member is a country admin; here they are not.
vi.mock('@/features/country-admins/repository', () => ({ countryAdminRepository: { getCountries: async () => null } }))
vi.mock('./repository', () => ({
  adminRepository: {
    isPlatformAdministrator: adminMfa.isPlatformAdministrator,
    reviewOrganizationApplication: mocks.reviewOrganizationApplication,
    reviewCompanyAccessRequest: mocks.reviewCompanyAccessRequest,
    getOrganizationApplicationReview: mocks.getOrganizationApplicationReview,
  },
}))
vi.mock('@/features/organizations/public-page-refresh', () => ({ clearOrganizationPublicPage: mocks.clearOrganizationPublicPage }))

import { reviewCompanyAccessRequest, reviewOrganizationApplication } from './actions'
import { ADMIN_MFA_REQUIRED_MESSAGE } from './mfa-gate'

const applicationId = '22222222-2222-4222-8222-222222222222'

describe('platform admin organization review actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'sub-1', email: 'admin@example.com' })
    mocks.reviewOrganizationApplication.mockResolvedValue(true)
    mocks.reviewCompanyAccessRequest.mockResolvedValue(true)
    mocks.getOrganizationApplicationReview.mockResolvedValue({ company: { slug: 'harbour-minds' } })
    mocks.clearOrganizationPublicPage.mockResolvedValue(undefined)
  })

  it.each(['suspended', 'rejected', 'approved'] as const)(
    'clears the organization\'s public page from CloudFront at once after a %s decision (Round ARCH, Phase 2)',
    async (decision) => {
      await expect(reviewOrganizationApplication(applicationId, decision, 'Reviewed by the platform team.')).resolves.toEqual({ ok: true })
      expect(mocks.clearOrganizationPublicPage).toHaveBeenCalledTimes(1)
      const [target, options] = mocks.clearOrganizationPublicPage.mock.calls[0]!
      expect(options).toEqual({ immediate: true })
      await expect(target.resolveSlug()).resolves.toBe('harbour-minds')
      expect(mocks.getOrganizationApplicationReview).toHaveBeenCalledWith('admin-1', applicationId)
    },
  )

  it('clears nothing when the review was not saved', async () => {
    mocks.reviewOrganizationApplication.mockRejectedValueOnce(new Error('organization_review_transition_forbidden'))
    await reviewOrganizationApplication(applicationId, 'suspended', 'Reviewed by the platform team.')
    expect(mocks.clearOrganizationPublicPage).not.toHaveBeenCalled()
  })

  it('refuses a platform administrator whose session has not answered an authenticator app', async () => {
    adminMfa.getCurrentMfaStatus.mockResolvedValueOnce({ kind: 'eligible', enabled: false, email: 'admin@example.com', hostedSession: false }).mockResolvedValueOnce(null)
    await expect(reviewOrganizationApplication(applicationId, 'approved', 'Verified records.')).resolves.toEqual({ ok: false, error: ADMIN_MFA_REQUIRED_MESSAGE })
    await expect(reviewCompanyAccessRequest('66666666-6666-4666-8666-666666666666', 'approved', null, 'member')).resolves.toEqual({ ok: false, error: ADMIN_MFA_REQUIRED_MESSAGE })
    expect(adminMfa.isPlatformAdministrator).toHaveBeenCalledWith('admin-1')
    expect(mocks.reviewOrganizationApplication).not.toHaveBeenCalled()
    expect(mocks.reviewCompanyAccessRequest).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('fails closed when the administrator role or MFA status cannot be read', async () => {
    adminMfa.isPlatformAdministrator.mockRejectedValueOnce(new Error('database down'))
    adminMfa.getCurrentMfaStatus.mockResolvedValueOnce(null)
    await expect(reviewOrganizationApplication(applicationId, 'approved', 'Verified records.')).resolves.toEqual({ ok: false, error: ADMIN_MFA_REQUIRED_MESSAGE })
    adminMfa.getCurrentMfaStatus.mockRejectedValueOnce(new Error('TransportError'))
    await expect(reviewOrganizationApplication(applicationId, 'approved', 'Verified records.')).resolves.toEqual({ ok: false, error: ADMIN_MFA_REQUIRED_MESSAGE })
    expect(mocks.reviewOrganizationApplication).not.toHaveBeenCalled()
  })

  it('leaves members who are not administrators to the repository check and its message', async () => {
    adminMfa.isPlatformAdministrator.mockResolvedValueOnce(false)
    mocks.reviewOrganizationApplication.mockRejectedValueOnce(new Error('admin_forbidden'))
    await expect(reviewOrganizationApplication(applicationId, 'approved', 'Verified records.')).resolves.toEqual({
      ok: false,
      error: 'You do not have permission to review organization applications.',
    })
    // No MFA lookup for a member who is not an administrator.
    expect(adminMfa.getCurrentMfaStatus).not.toHaveBeenCalled()
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
      null,
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/access')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations')
  })

  it('passes the role chosen by Sea N Shore and explains read-only requests', async () => {
    await expect(reviewCompanyAccessRequest(requestId, 'approved', null, 'member')).resolves.toEqual({ ok: true })
    expect(mocks.reviewCompanyAccessRequest).toHaveBeenLastCalledWith('admin-1', requestId, 'approved', null, 'member')

    mocks.reviewCompanyAccessRequest.mockRejectedValueOnce(new Error('company_access_request_platform_read_only'))
    await expect(reviewCompanyAccessRequest(requestId, 'approved', null, 'member')).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('active owner or administrator, so they decide this request'),
    })
  })

  it('returns safe copy when the access request was already reviewed', async () => {
    mocks.reviewCompanyAccessRequest.mockRejectedValueOnce(new Error('company_access_request_review_forbidden'))
    await expect(reviewCompanyAccessRequest(requestId, 'approved', null)).resolves.toEqual({
      ok: false,
      error: 'This organization access request has already been reviewed.',
    })
  })
})
