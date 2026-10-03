import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  decide: vi.fn(),
  escalate: vi.fn(),
  withdraw: vi.fn(),
  getById: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./access-request-repository', () => ({
  organizationAccessRequestRepository: {
    decide: mocks.decide,
    escalate: mocks.escalate,
    withdraw: mocks.withdraw,
  },
}))
vi.mock('./workspace-repository', () => ({
  organizationWorkspaceRepository: { getById: mocks.getById },
}))

import {
  decideOrganizationAccessRequest,
  escalateOrganizationAccessRequest,
  withdrawOrganizationAccessRequest,
} from './access-request-actions'

const requestId = '66666666-6666-4666-8666-666666666666'
const companyId = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'owner-1' })
  mocks.decide.mockResolvedValue({ companyId, via: 'organization', grantedRole: 'member' })
  mocks.escalate.mockResolvedValue({ companyId, kind: 'overdue' })
  mocks.withdraw.mockResolvedValue({ companyId })
  mocks.getById.mockResolvedValue({ id: companyId, slug: 'oceanic' })
})

describe('organization access decisions', () => {
  it('validates before authentication and requires a role to approve', async () => {
    await expect(decideOrganizationAccessRequest({ requestId: 'bad', decision: 'approved', grantedRole: 'member' })).resolves.toMatchObject({ ok: false })
    await expect(decideOrganizationAccessRequest({ requestId, decision: 'approved', grantedRole: null })).resolves.toEqual({
      ok: false,
      error: 'Choose the role to grant before approving.',
    })
    await expect(decideOrganizationAccessRequest({ requestId, decision: 'approved', grantedRole: 'owner' as never })).resolves.toMatchObject({ ok: false })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('decides with the signed-in user and refreshes the organization pages', async () => {
    await expect(decideOrganizationAccessRequest({ requestId, decision: 'approved', grantedRole: 'member', note: '  Welcome aboard  ' })).resolves.toEqual({ ok: true })
    expect(mocks.decide).toHaveBeenCalledWith('owner-1', { requestId, decision: 'approved', grantedRole: 'member', note: 'Welcome aboard' })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/oceanic')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/access')
  })

  it('declines without a note and never passes a role', async () => {
    await expect(decideOrganizationAccessRequest({ requestId, decision: 'rejected', grantedRole: 'administrator' })).resolves.toEqual({ ok: true })
    expect(mocks.decide).toHaveBeenCalledWith('owner-1', { requestId, decision: 'rejected', grantedRole: null, note: null })
  })

  it.each([
    ['company_access_request_forbidden', 'Only the owner or an administrator of this organization can decide its access requests.'],
    ['company_access_request_escalated', 'The requester asked Sea N Shore to review this request, so Sea N Shore will decide it.'],
    ['company_access_request_own', 'You cannot decide your own request. Another owner or administrator of the organization needs to review it.'],
    ['company_access_request_review_forbidden', 'This request has already been decided. Reload the page to see the outcome.'],
    ['unexpected', 'We could not save this change. Check your connection and try again.'],
  ])('explains %s in plain language', async (code, message) => {
    mocks.decide.mockRejectedValueOnce(new Error(code))
    await expect(decideOrganizationAccessRequest({ requestId, decision: 'rejected' })).resolves.toEqual({ ok: false, error: message })
  })
})

describe('requester actions', () => {
  it('requires a short explanation before escalating', async () => {
    await expect(escalateOrganizationAccessRequest(requestId, 'help')).resolves.toMatchObject({ ok: false, error: expect.stringContaining('at least 10 characters') })
    expect(mocks.escalate).not.toHaveBeenCalled()
  })

  it('escalates with the signed-in requester', async () => {
    await expect(escalateOrganizationAccessRequest(requestId, 'Nobody has replied for a week.')).resolves.toEqual({ ok: true })
    expect(mocks.escalate).toHaveBeenCalledWith('owner-1', requestId, 'Nobody has replied for a week.')
  })

  it('explains when escalation is too early', async () => {
    mocks.escalate.mockRejectedValueOnce(new Error('company_access_request_escalation_too_early'))
    await expect(escalateOrganizationAccessRequest(requestId, 'Nobody has replied yet.')).resolves.toEqual({
      ok: false,
      error: 'The organization has 7 days to respond. You can ask Sea N Shore to step in after that.',
    })
  })

  it('withdraws a pending request', async () => {
    await expect(withdrawOrganizationAccessRequest('bad')).resolves.toMatchObject({ ok: false })
    await expect(withdrawOrganizationAccessRequest(requestId)).resolves.toEqual({ ok: true })
    expect(mocks.withdraw).toHaveBeenCalledWith('owner-1', requestId)
  })
})
