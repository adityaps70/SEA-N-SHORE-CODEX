import { describe, expect, it } from 'vitest'
import { createOrganizationAccessRequestRepository } from './access-request-repository'

const requestId = '66666666-6666-4666-8666-666666666666'
const companyId = '33333333-3333-4333-8333-333333333333'
const requesterId = '77777777-7777-4777-8777-777777777777'
const ownerId = '88888888-8888-4888-8888-888888888888'
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

type Seen = Array<{ text: string; values?: readonly unknown[] }>

function harness(facts: Record<string, unknown> = {}, extra: (text: string) => unknown[] | null = () => null) {
  const seen: Seen = []
  const query = async (text: string, values?: readonly unknown[]) => {
    seen.push({ text, values })
    const custom = extra(text)
    if (custom) return custom as never[]
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
        actor_is_platform_admin: false,
        active_authority_count: 1,
        organization_suspended: false,
        ...facts,
      }]
    }
    return []
  }
  let transactions = 0
  const repository = createOrganizationAccessRequestRepository({
    query,
    transaction: async (work) => {
      transactions += 1
      return work(query)
    },
  })
  return { repository, seen, transactions: () => transactions }
}

const find = (seen: Seen, fragment: string) => seen.find((entry) => entry.text.includes(fragment))
const audit = (seen: Seen) => {
  const entry = find(seen, 'insert into public.audit_events')
  if (!entry) return null
  const values = entry.values ?? []
  // Decisions pass the action as a parameter; escalation and withdrawal write it inline.
  const action = values.length === 4 ? values[1] : /'(organization_access\.\w+)'/.exec(entry.text)?.[1]
  const targetId = values.length === 4 ? values[2] : values[1]
  return { actorId: values[0], action, targetId, metadata: JSON.parse(String(values[values.length - 1])) }
}

describe('organization owner and admin decisions', () => {
  it('lets the owner approve with a different role, creating the membership and an audit entry', async () => {
    const { repository, seen, transactions } = harness({ actor_organization_role: 'owner' })

    await expect(repository.decide(ownerId, { requestId, decision: 'approved', grantedRole: 'member', note: null }))
      .resolves.toEqual({ companyId, via: 'organization', grantedRole: 'member' })

    expect(transactions()).toBe(1)
    const lock = find(seen, 'as actor_is_platform_admin')
    expect(lock?.text).toContain('for update of car')
    expect(lock?.values).toEqual([requestId, ownerId])
    expect(find(seen, 'insert into public.company_members')?.values).toEqual([companyId, requesterId, 'member'])
    expect(find(seen, 'update public.company_access_requests')?.values).toEqual([requestId, 'approved', ownerId, null, 'member', 'organization'])
    expect(audit(seen)).toEqual({
      actorId: ownerId,
      action: 'organization_access.approved',
      targetId: requestId,
      metadata: {
        companyId,
        userId: requesterId,
        requestedRole: 'recruiter',
        grantedRole: 'member',
        reviewerNote: null,
        decidedVia: 'organization',
        deciderRole: 'owner',
        fallbackReason: null,
        escalated: false,
      },
    })
  })

  it('lets an organization administrator decline with an optional note, without creating a membership', async () => {
    const { repository, seen } = harness({ actor_organization_role: 'administrator' })

    await repository.decide(ownerId, { requestId, decision: 'rejected', note: 'We could not match you to our staff list.' })

    expect(find(seen, 'insert into public.company_members')).toBeUndefined()
    expect(find(seen, 'update public.company_access_requests')?.values).toEqual([
      requestId, 'rejected', ownerId, 'We could not match you to our staff list.', null, 'organization',
    ])
    expect(audit(seen)?.metadata).toMatchObject({ deciderRole: 'administrator', decidedVia: 'organization', grantedRole: null })
  })

  it.each([
    ['recruiter', 'recruiter', 'company_access_request_forbidden'],
    ['member', 'member', 'company_access_request_forbidden'],
    ['stranger', null, 'company_access_request_forbidden'],
  ])('refuses a %s and writes nothing', async (_label, role, code) => {
    const { repository, seen } = harness({ actor_organization_role: role })
    await expect(repository.decide(ownerId, { requestId, decision: 'approved', grantedRole: 'recruiter', note: null })).rejects.toThrow(code)
    expect(find(seen, 'insert into public.company_members')).toBeUndefined()
    expect(find(seen, 'update public.company_access_requests')).toBeUndefined()
    expect(find(seen, 'insert into public.audit_events')).toBeUndefined()
  })

  it('refuses a platform administrator while the organization can still decide', async () => {
    const { repository, seen } = harness({ actor_is_platform_admin: true, active_authority_count: 1, requested_at: daysAgo(2) })
    await expect(repository.decide(ownerId, { requestId, decision: 'approved', grantedRole: 'recruiter', note: null }))
      .rejects.toThrow('company_access_request_platform_read_only')
    expect(find(seen, 'insert into public.audit_events')).toBeUndefined()
  })

  it('lets a platform administrator decide as the fallback when no active owner or admin remains', async () => {
    const { repository, seen } = harness({ actor_is_platform_admin: true, active_authority_count: 0 })
    await expect(repository.decide(ownerId, { requestId, decision: 'approved', grantedRole: 'recruiter', note: 'Verified by phone.' }))
      .resolves.toMatchObject({ via: 'platform' })
    expect(audit(seen)?.metadata).toMatchObject({ decidedVia: 'platform', deciderRole: 'platform_administrator', fallbackReason: 'no_active_admin' })
  })

  it('stops the owner once the requester has escalated to Sea N Shore', async () => {
    const { repository } = harness({ actor_organization_role: 'owner', escalated_at: daysAgo(0) })
    await expect(repository.decide(ownerId, { requestId, decision: 'rejected', note: null })).rejects.toThrow('company_access_request_escalated')
  })

  it('refuses an administrator deciding their own request and already-decided requests', async () => {
    await expect(harness({ actor_organization_role: 'administrator' }).repository.decide(requesterId, { requestId, decision: 'approved', grantedRole: 'administrator', note: null }))
      .rejects.toThrow('company_access_request_own')
    await expect(harness({ actor_organization_role: 'owner', status: 'rejected' }).repository.decide(ownerId, { requestId, decision: 'approved', grantedRole: 'member', note: null }))
      .rejects.toThrow('company_access_request_review_forbidden')
  })

  it('reports a missing request', async () => {
    const { repository } = harness({}, (text) => (text.includes('as actor_is_platform_admin') ? [] : null))
    await expect(repository.decide(ownerId, { requestId, decision: 'approved', grantedRole: 'member', note: null })).rejects.toThrow('company_access_request_not_found')
  })
})

describe('requester escalation and withdrawal', () => {
  function escalationHarness(row: Record<string, unknown>, duplicate = false) {
    return harness({}, (text) => {
      if (text.includes('from public.company_access_requests') && text.includes('for update') && !text.includes('as actor_is_platform_admin')) {
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
          ...row,
        }]
      }
      if (text.includes("status = 'pending' and id <> $4")) return duplicate ? [{ id: 'newer' }] : []
      return null
    })
  }

  it('reopens an organization rejection for Sea N Shore and audits the dispute', async () => {
    const { repository, seen } = escalationHarness({ status: 'rejected', decided_via: 'organization', reviewer_note: 'Not on our staff list.', reviewed_by: ownerId })

    await expect(repository.escalate(requesterId, requestId, 'I joined in August, here is my contract number.'))
      .resolves.toEqual({ companyId, kind: 'after_rejection' })

    const update = find(seen, 'set status = \'pending\'')
    expect(update?.text).toContain('escalated_at = now()')
    expect(update?.values).toEqual([requestId, 'I joined in August, here is my contract number.'])
    expect(audit(seen)).toMatchObject({
      actorId: requesterId,
      action: 'organization_access.escalated',
      metadata: { kind: 'after_rejection', previousStatus: 'rejected', previousReviewedBy: ownerId, previousReviewerNote: 'Not on our staff list.' },
    })
  })

  it('escalates a request left waiting for 7 days', async () => {
    const { repository } = escalationHarness({ requested_at: daysAgo(8) })
    await expect(repository.escalate(requesterId, requestId, 'Nobody has responded for over a week.')).resolves.toMatchObject({ kind: 'overdue' })
  })

  it('refuses early, repeated or foreign escalations', async () => {
    await expect(escalationHarness({ requested_at: daysAgo(3) }).repository.escalate(requesterId, requestId, 'Please look at this soon.'))
      .rejects.toThrow('company_access_request_escalation_too_early')
    await expect(escalationHarness({ requested_at: daysAgo(9), escalated_at: daysAgo(1) }).repository.escalate(requesterId, requestId, 'Second try at escalating.'))
      .rejects.toThrow('company_access_request_already_escalated')
    await expect(escalationHarness({ status: 'rejected', decided_via: 'platform' }).repository.escalate(requesterId, requestId, 'I disagree with Sea N Shore.'))
      .rejects.toThrow('company_access_request_not_escalatable')
    await expect(escalationHarness({ status: 'rejected', decided_via: 'organization' }).repository.escalate(ownerId, requestId, 'Not my request at all.'))
      .rejects.toThrow('company_access_request_not_found')
  })

  it('does not reopen a rejection when a newer request for the same role is waiting', async () => {
    await expect(escalationHarness({ status: 'rejected', decided_via: 'organization' }, true).repository.escalate(requesterId, requestId, 'Please review this decision.'))
      .rejects.toThrow('organization_access_request_exists')
  })

  it('lets the requester withdraw a pending request and audits it', async () => {
    const { repository, seen } = harness({}, (text) => (text.includes("set status = 'cancelled'") ? [{ id: requestId, company_id: companyId }] : null))
    await expect(repository.withdraw(requesterId, requestId)).resolves.toEqual({ companyId })
    expect(find(seen, "set status = 'cancelled'")?.text).toContain("user_id = $2 and status = 'pending'")
    expect(audit(seen)).toMatchObject({ actorId: requesterId, action: 'organization_access.withdrawn' })
  })

  it('refuses to withdraw a request that is not the requester\'s or not pending', async () => {
    const { repository } = harness()
    await expect(repository.withdraw(ownerId, requestId)).rejects.toThrow('company_access_request_not_withdrawable')
  })
})

describe('organization request lists', () => {
  function listHarness(viewer: { organization_role: string | null; is_platform_admin: boolean; organization_suspended?: boolean }) {
    return harness({}, (text) => {
      if (text.includes('as organization_role')) return [{ organization_suspended: false, ...viewer }]
      if (text.includes('left join public.profiles reviewer')) {
        return [{
          request_id: requestId,
          status: 'pending',
          requested_role: 'recruiter',
          granted_role: null,
          message: 'Crewing lead',
          requested_at: new Date('2026-09-20T10:00:00.000Z'),
          reviewed_at: null,
          reviewer_note: null,
          decided_via: null,
          escalated_at: null,
          escalation_note: null,
          requester_id: requesterId,
          requester_name: 'Asha Singh',
          requester_slug: 'asha-singh',
          requester_headline: 'Crewing Manager',
          reviewer_name: null,
        }]
      }
      return null
    })
  }

  it('shows the requests section to owners and administrators', async () => {
    const { repository } = listHarness({ organization_role: 'administrator', is_platform_admin: false })
    const result = await repository.listForOrganization(ownerId, companyId)
    expect(result.viewer).toEqual({ kind: 'organization', role: 'administrator' })
    expect(result.requests[0]).toMatchObject({ id: requestId, requestedAt: '2026-09-20T10:00:00.000Z', requester: { fullName: 'Asha Singh' } })
  })

  it('gives platform administrators a read-only view and refuses everyone else', async () => {
    await expect(listHarness({ organization_role: null, is_platform_admin: true }).repository.listForOrganization(ownerId, companyId))
      .resolves.toMatchObject({ viewer: { kind: 'platform' } })
    await expect(listHarness({ organization_role: 'recruiter', is_platform_admin: false }).repository.listForOrganization(ownerId, companyId))
      .rejects.toThrow('organization_access_forbidden')
    await expect(listHarness({ organization_role: 'owner', is_platform_admin: false, organization_suspended: true }).repository.listForOrganization(ownerId, companyId))
      .rejects.toThrow('organization_access_forbidden')
  })

  it('counts waiting requests per organization the user manages', async () => {
    const { repository, seen } = harness({}, (text) => (text.includes('as pending_count') ? [{ company_id: companyId, pending_count: '3' }] : null))
    await expect(repository.countPendingForManager(ownerId)).resolves.toEqual({ [companyId]: 3 })
    const sql = find(seen, 'as pending_count')?.text ?? ''
    expect(sql).toContain("manager.role::text in ('owner', 'administrator')")
    expect(sql).toContain('car.escalated_at is null')
  })
})
