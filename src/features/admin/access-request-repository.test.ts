import { describe, expect, it } from 'vitest'
import { createAdminRepository } from './repository'

const adminId = '11111111-1111-4111-8111-111111111111'
const requestId = '66666666-6666-4666-8666-666666666666'
const companyId = '33333333-3333-4333-8333-333333333333'
const requesterId = '77777777-7777-4777-8777-777777777777'
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    request_id: requestId,
    request_status: 'pending',
    requested_role: 'recruiter',
    granted_role: null,
    request_type: 'recruiter_access',
    message: 'I manage crewing.',
    requested_at: '2026-09-24T10:00:00.000Z',
    reviewed_at: null,
    reviewer_note: null,
    reviewer_id: null,
    reviewer_name: null,
    decided_via: null,
    escalated_at: null,
    escalation_note: null,
    active_authority_count: 0,
    company_suspended: false,
    company_id: companyId,
    company_name: 'Oceanic Shipping',
    company_slug: 'oceanic',
    company_verified: true,
    requester_id: requesterId,
    requester_name: 'Asha Singh',
    requester_slug: 'asha-singh',
    requester_headline: 'Crewing Manager',
    ...overrides,
  }
}

describe('platform admin access request oversight', () => {
  it('lists requests that need Sea N Shore with the fallback reason and requester context', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('select true as allowed')) return [{ allowed: true }]
        return [listRow()]
      },
    })

    await expect(repository.listCompanyAccessRequests(adminId, 'needs_platform')).resolves.toEqual([{
      id: requestId,
      status: 'pending',
      requestedRole: 'recruiter',
      grantedRole: null,
      requestType: 'recruiter_access',
      message: 'I manage crewing.',
      requestedAt: '2026-09-24T10:00:00.000Z',
      reviewedAt: null,
      reviewerNote: null,
      reviewer: null,
      decidedVia: null,
      escalatedAt: null,
      escalationNote: null,
      fallbackReason: 'no_active_admin',
      activeAuthorityCount: 0,
      company: {
        id: companyId,
        name: 'Oceanic Shipping',
        slug: 'oceanic',
        verified: true,
        suspended: false,
      },
      requester: {
        id: requesterId,
        fullName: 'Asha Singh',
        slug: 'asha-singh',
        headline: 'Crewing Manager',
      },
    }])
    const listQuery = seen[1]?.text ?? ''
    expect(listQuery).toContain('public.company_access_requests')
    expect(listQuery).toContain('car.escalated_at is not null')
    expect(listQuery).toContain("interval '7 days'")
    expect(listQuery).toContain("authority.role::text in ('owner', 'administrator')")
    expect(listQuery).toContain('left join public.profiles reviewer')
  })

  it('shows requests still with the organization as read-only and names who decided the rest', async () => {
    const seen: string[] = []
    const repository = createAdminRepository({
      query: async (text) => {
        seen.push(text)
        if (text.includes('select true as allowed')) return [{ allowed: true }]
        if (text.includes("where car.status = 'approved'")) {
          return [listRow({
            request_status: 'approved',
            granted_role: 'member',
            reviewed_at: '2026-09-25T10:00:00.000Z',
            reviewer_id: 'owner-1',
            reviewer_name: 'Ravi Owner',
            decided_via: 'organization',
            active_authority_count: 2,
          })]
        }
        return [listRow({ requested_at: new Date().toISOString(), active_authority_count: 2 })]
      },
    })

    const waiting = await repository.listCompanyAccessRequests(adminId, 'with_organization')
    expect(waiting[0]?.fallbackReason).toBeNull()
    expect(seen[1]).toContain("car.status = 'pending' and not")

    const approved = await repository.listCompanyAccessRequests(adminId, 'approved')
    expect(approved[0]).toMatchObject({
      status: 'approved',
      grantedRole: 'member',
      decidedVia: 'organization',
      reviewer: { id: 'owner-1', fullName: 'Ravi Owner' },
      fallbackReason: null,
    })
  })

  it('counts every queue view for the filter chips', async () => {
    const repository = createAdminRepository({
      query: async (text) => {
        if (text.includes('select true as allowed')) return [{ allowed: true }]
        return [{ needs_platform: '2', with_organization: '5', approved: 9, rejected: '1', cancelled: null }]
      },
    })
    await expect(repository.countCompanyAccessRequests(adminId)).resolves.toEqual({
      needs_platform: 2,
      with_organization: 5,
      approved: 9,
      rejected: 1,
      cancelled: 0,
    })
  })

  it('refuses to list the queue for non-administrators', async () => {
    const repository = createAdminRepository({ query: async () => [] })
    await expect(repository.listCompanyAccessRequests(adminId, 'needs_platform')).rejects.toThrow('admin_forbidden')
  })
})

function decisionHarness(facts: Record<string, unknown>, options: { platformAdmin?: boolean } = {}) {
  const seen: Array<{ text: string; values?: readonly unknown[] }> = []
  const query = async (text: string, values?: readonly unknown[]) => {
    seen.push({ text, values })
    if (text.includes('as actor_is_platform_admin')) {
      return [{
        id: requestId,
        company_id: companyId,
        user_id: requesterId,
        requested_role: 'recruiter',
        status: 'pending',
        requested_at: daysAgo(1),
        escalated_at: null,
        decided_via: null,
        reviewer_note: null,
        reviewed_by: null,
        actor_organization_role: null,
        actor_is_platform_admin: options.platformAdmin ?? true,
        active_authority_count: 0,
        organization_suspended: false,
        ...facts,
      }]
    }
    if (text.includes('select true as allowed')) return options.platformAdmin === false ? [] : [{ allowed: true }]
    return []
  }
  const repository = createAdminRepository({ query, transaction: async (work) => work(query) })
  return { repository, seen }
}

function auditMetadata(seen: Array<{ text: string; values?: readonly unknown[] }>) {
  const audit = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
  return audit ? { actorId: audit.values?.[0], action: audit.values?.[1], targetId: audit.values?.[2], metadata: JSON.parse(String(audit.values?.[3])) } : null
}

describe('platform admin fallback decisions', () => {
  it('approves when the organization has no active owner or admin and audits the fallback', async () => {
    const { repository, seen } = decisionHarness({ active_authority_count: 0 })

    await expect(repository.reviewCompanyAccessRequest(adminId, requestId, 'approved', 'Verified employment.', 'member')).resolves.toBe(true)

    const membership = seen.find((entry) => entry.text.includes('insert into public.company_members'))
    expect(membership?.values).toEqual([companyId, requesterId, 'member'])
    expect(membership?.text).toContain("where public.company_members.role::text <> 'owner'")
    const update = seen.find((entry) => entry.text.includes('update public.company_access_requests'))
    expect(update?.values).toEqual([requestId, 'approved', adminId, 'Verified employment.', 'member', 'platform'])
    expect(auditMetadata(seen)).toEqual({
      actorId: adminId,
      action: 'organization_access.approved',
      targetId: requestId,
      metadata: expect.objectContaining({
        decidedVia: 'platform',
        deciderRole: 'platform_administrator',
        fallbackReason: 'no_active_admin',
        requestedRole: 'recruiter',
        grantedRole: 'member',
        companyId,
        userId: requesterId,
      }),
    })
  })

  it('stays read-only while an active organization admin can still decide a recent request', async () => {
    const { repository, seen } = decisionHarness({ active_authority_count: 2, requested_at: daysAgo(2) })

    await expect(repository.reviewCompanyAccessRequest(adminId, requestId, 'approved', null)).rejects.toThrow('company_access_request_platform_read_only')
    expect(seen.some((entry) => entry.text.includes('insert into public.company_members'))).toBe(false)
    expect(seen.some((entry) => entry.text.includes('update public.company_access_requests'))).toBe(false)
    expect(seen.some((entry) => entry.text.includes('insert into public.audit_events'))).toBe(false)
  })

  it('acts on a request waiting 7 days or more', async () => {
    const { repository, seen } = decisionHarness({ active_authority_count: 2, requested_at: daysAgo(8) })
    await expect(repository.reviewCompanyAccessRequest(adminId, requestId, 'rejected', 'No response from the organization; unable to verify.')).resolves.toBe(true)
    expect(auditMetadata(seen)?.metadata).toMatchObject({ fallbackReason: 'overdue', decidedVia: 'platform', grantedRole: null })
    expect(seen.some((entry) => entry.text.includes('insert into public.company_members'))).toBe(false)
  })

  it('acts on a request the requester escalated, keeping the requested role by default', async () => {
    const { repository, seen } = decisionHarness({ active_authority_count: 2, escalated_at: daysAgo(0) })
    await expect(repository.reviewCompanyAccessRequest(adminId, requestId, 'approved', 'Employment confirmed.')).resolves.toBe(true)
    expect(auditMetadata(seen)?.metadata).toMatchObject({ fallbackReason: 'escalated', escalated: true, grantedRole: 'recruiter' })
  })

  it('refuses platform decisions from non-administrators before touching the request', async () => {
    const { repository, seen } = decisionHarness({}, { platformAdmin: false })
    await expect(repository.reviewCompanyAccessRequest(adminId, requestId, 'approved', null)).rejects.toThrow('admin_forbidden')
    expect(seen.some((entry) => entry.text.includes('as actor_is_platform_admin'))).toBe(false)
  })

  it('refuses to decide a request that is no longer pending', async () => {
    const { repository } = decisionHarness({ status: 'approved' })
    await expect(repository.reviewCompanyAccessRequest(adminId, requestId, 'rejected', 'Late.')).rejects.toThrow('company_access_request_review_forbidden')
  })
})
