import { describe, expect, it } from 'vitest'
import {
  escalationEligibility,
  isRequestOverdue,
  platformFallbackReason,
  resolveAccessDecisionAuthority,
  type AccessDecisionFacts,
} from './access-request-policy'

const now = new Date('2026-09-27T12:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

function facts(overrides: Partial<AccessDecisionFacts> = {}): AccessDecisionFacts {
  return {
    status: 'pending',
    requesterId: 'requester',
    requestedAt: daysAgo(1),
    escalatedAt: null,
    actorId: 'actor',
    actorOrganizationRole: null,
    actorIsPlatformAdmin: false,
    activeAuthorityCount: 1,
    organizationSuspended: false,
    now,
    ...overrides,
  }
}

describe('who can decide an organization access request', () => {
  it('lets the owner and organization administrators decide', () => {
    expect(resolveAccessDecisionAuthority(facts({ actorOrganizationRole: 'owner' }))).toEqual({ allowed: true, via: 'organization', actorRole: 'owner' })
    expect(resolveAccessDecisionAuthority(facts({ actorOrganizationRole: 'administrator' }))).toEqual({ allowed: true, via: 'organization', actorRole: 'administrator' })
  })

  it('refuses recruiters, other roles and strangers', () => {
    for (const role of ['recruiter', 'member', 'lms_manager', 'event_manager', 'content_manager', 'analyst', null]) {
      expect(resolveAccessDecisionAuthority(facts({ actorOrganizationRole: role }))).toEqual({ allowed: false, reason: 'forbidden' })
    }
  })

  it('refuses decisions on your own request, even as an administrator', () => {
    expect(resolveAccessDecisionAuthority(facts({ actorId: 'requester', actorOrganizationRole: 'administrator' }))).toEqual({ allowed: false, reason: 'own_request' })
  })

  it('refuses decisions on requests that are no longer pending', () => {
    expect(resolveAccessDecisionAuthority(facts({ status: 'approved', actorOrganizationRole: 'owner' }))).toEqual({ allowed: false, reason: 'not_pending' })
  })

  it('keeps platform administrators read-only while the organization can decide', () => {
    expect(resolveAccessDecisionAuthority(facts({ actorIsPlatformAdmin: true, activeAuthorityCount: 2, requestedAt: daysAgo(6) })))
      .toEqual({ allowed: false, reason: 'platform_read_only' })
  })

  it('lets platform administrators act as a fallback', () => {
    expect(resolveAccessDecisionAuthority(facts({ actorIsPlatformAdmin: true, activeAuthorityCount: 0 })))
      .toEqual({ allowed: true, via: 'platform', reason: 'no_active_admin' })
    expect(resolveAccessDecisionAuthority(facts({ actorIsPlatformAdmin: true, organizationSuspended: true })))
      .toEqual({ allowed: true, via: 'platform', reason: 'no_active_admin' })
    expect(resolveAccessDecisionAuthority(facts({ actorIsPlatformAdmin: true, requestedAt: daysAgo(7) })))
      .toEqual({ allowed: true, via: 'platform', reason: 'overdue' })
    expect(resolveAccessDecisionAuthority(facts({ actorIsPlatformAdmin: true, escalatedAt: daysAgo(0) })))
      .toEqual({ allowed: true, via: 'platform', reason: 'escalated' })
  })

  it('hands escalated requests to Sea N Shore, even for the organization owner', () => {
    expect(resolveAccessDecisionAuthority(facts({ actorOrganizationRole: 'owner', escalatedAt: daysAgo(0) })))
      .toEqual({ allowed: false, reason: 'escalated_to_platform' })
  })

  it('uses organization authority first when a platform admin is also the owner', () => {
    expect(resolveAccessDecisionAuthority(facts({ actorOrganizationRole: 'owner', actorIsPlatformAdmin: true })))
      .toEqual({ allowed: true, via: 'organization', actorRole: 'owner' })
  })

  it('does not let a suspended organization decide its own requests', () => {
    expect(resolveAccessDecisionAuthority(facts({ actorOrganizationRole: 'owner', organizationSuspended: true })))
      .toEqual({ allowed: false, reason: 'forbidden' })
  })
})

describe('fallback reasons and the 7-day rule', () => {
  it('treats exactly 7 days as overdue', () => {
    expect(isRequestOverdue(daysAgo(6.99), now)).toBe(false)
    expect(isRequestOverdue(daysAgo(7), now)).toBe(true)
  })

  it('reports no reason for decided requests', () => {
    expect(platformFallbackReason({ status: 'rejected', requestedAt: daysAgo(30), escalatedAt: null, activeAuthorityCount: 0, organizationSuspended: false, now })).toBeNull()
  })
})

describe('requester escalation to Sea N Shore', () => {
  const base = { requesterId: 'requester', actorId: 'requester', escalatedAt: null, decidedVia: null, now }

  it('is available after an organization rejection', () => {
    expect(escalationEligibility({ ...base, status: 'rejected', requestedAt: daysAgo(1), decidedVia: 'organization' }))
      .toEqual({ allowed: true, kind: 'after_rejection' })
  })

  it('is available after 7 days without a decision, not before', () => {
    expect(escalationEligibility({ ...base, status: 'pending', requestedAt: daysAgo(8) })).toEqual({ allowed: true, kind: 'overdue' })
    expect(escalationEligibility({ ...base, status: 'pending', requestedAt: daysAgo(3) })).toEqual({ allowed: false, reason: 'too_early' })
  })

  it('is refused for Sea N Shore decisions, repeat escalations and other people', () => {
    expect(escalationEligibility({ ...base, status: 'rejected', requestedAt: daysAgo(1), decidedVia: 'platform' })).toEqual({ allowed: false, reason: 'not_escalatable' })
    expect(escalationEligibility({ ...base, status: 'pending', requestedAt: daysAgo(9), escalatedAt: daysAgo(1) })).toEqual({ allowed: false, reason: 'already_escalated' })
    expect(escalationEligibility({ ...base, status: 'rejected', requestedAt: daysAgo(1), actorId: 'someone-else' })).toEqual({ allowed: false, reason: 'not_requester' })
    expect(escalationEligibility({ ...base, status: 'approved', requestedAt: daysAgo(1) })).toEqual({ allowed: false, reason: 'not_escalatable' })
  })
})
