/**
 * Who may decide an organization access request.
 *
 * Owner decision (Sep 2026): the organization's owner and administrators approve
 * or reject requests to join their organization. Sea N Shore platform
 * administrators oversee every request but only act as a fallback:
 *   - the organization has no active owner or administrator,
 *   - the request has been waiting for 7 days or more, or
 *   - the requester escalated it to Sea N Shore (after a rejection or after 7 days).
 * Everything else is read-only for platform administrators.
 *
 * This module is pure so the same rules drive the database transaction, the
 * admin queue labels and the tests.
 */

export const ACCESS_REQUEST_ESCALATION_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export type OrganizationAuthorityRole = 'owner' | 'administrator'

export type PlatformFallbackReason = 'escalated' | 'no_active_admin' | 'overdue'

export type AccessDecisionFacts = {
  status: string
  requesterId: string
  requestedAt: string | Date
  escalatedAt: string | Date | null
  actorId: string
  /** Actor's approved membership role in this organization, if their account is active. */
  actorOrganizationRole: string | null
  actorIsPlatformAdmin: boolean
  /** Active owners/administrators of the organization other than the requester. */
  activeAuthorityCount: number
  /** Suspended organizations cannot decide their own requests. */
  organizationSuspended: boolean
  now?: Date
}

export type AccessDecisionAuthority =
  | { allowed: true; via: 'organization'; actorRole: OrganizationAuthorityRole }
  | { allowed: true; via: 'platform'; reason: PlatformFallbackReason }
  | {
      allowed: false
      reason:
        | 'not_pending'
        | 'own_request'
        | 'escalated_to_platform'
        | 'platform_read_only'
        | 'forbidden'
    }

function time(value: string | Date) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

export function isOrganizationAuthorityRole(role: string | null | undefined): role is OrganizationAuthorityRole {
  return role === 'owner' || role === 'administrator'
}

export function requestAgeDays(requestedAt: string | Date, now: Date = new Date()) {
  const started = time(requestedAt)
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Math.floor((now.getTime() - started) / DAY_MS))
}

export function isRequestOverdue(requestedAt: string | Date, now: Date = new Date()) {
  const started = time(requestedAt)
  if (!Number.isFinite(started)) return false
  return now.getTime() - started >= ACCESS_REQUEST_ESCALATION_DAYS * DAY_MS
}

/** Why Sea N Shore may act on a pending request, or null when the organization should decide. */
export function platformFallbackReason(input: {
  status: string
  requestedAt: string | Date
  escalatedAt: string | Date | null
  activeAuthorityCount: number
  organizationSuspended: boolean
  now?: Date
}): PlatformFallbackReason | null {
  if (input.status !== 'pending') return null
  if (input.escalatedAt) return 'escalated'
  if (input.activeAuthorityCount <= 0 || input.organizationSuspended) return 'no_active_admin'
  if (isRequestOverdue(input.requestedAt, input.now)) return 'overdue'
  return null
}

export function resolveAccessDecisionAuthority(facts: AccessDecisionFacts): AccessDecisionAuthority {
  if (facts.status !== 'pending') return { allowed: false, reason: 'not_pending' }
  if (facts.actorId === facts.requesterId) return { allowed: false, reason: 'own_request' }

  const organizationAuthority = !facts.organizationSuspended && isOrganizationAuthorityRole(facts.actorOrganizationRole)
  if (organizationAuthority && !facts.escalatedAt) {
    return { allowed: true, via: 'organization', actorRole: facts.actorOrganizationRole as OrganizationAuthorityRole }
  }

  if (facts.actorIsPlatformAdmin) {
    const reason = platformFallbackReason(facts)
    return reason ? { allowed: true, via: 'platform', reason } : { allowed: false, reason: 'platform_read_only' }
  }

  if (organizationAuthority) return { allowed: false, reason: 'escalated_to_platform' }
  return { allowed: false, reason: 'forbidden' }
}

export type EscalationFacts = {
  status: string
  requesterId: string
  actorId: string
  requestedAt: string | Date
  escalatedAt: string | Date | null
  decidedVia: string | null
  now?: Date
}

export type EscalationEligibility =
  | { allowed: true; kind: 'after_rejection' | 'overdue' }
  | { allowed: false; reason: 'not_requester' | 'already_escalated' | 'too_early' | 'not_escalatable' }

/** A requester can ask Sea N Shore to step in once: after an organization rejection, or after 7 days waiting. */
export function escalationEligibility(facts: EscalationFacts): EscalationEligibility {
  if (facts.actorId !== facts.requesterId) return { allowed: false, reason: 'not_requester' }
  if (facts.escalatedAt) return { allowed: false, reason: 'already_escalated' }
  if (facts.status === 'rejected') {
    return facts.decidedVia === 'platform'
      ? { allowed: false, reason: 'not_escalatable' }
      : { allowed: true, kind: 'after_rejection' }
  }
  if (facts.status === 'pending') {
    return isRequestOverdue(facts.requestedAt, facts.now)
      ? { allowed: true, kind: 'overdue' }
      : { allowed: false, reason: 'too_early' }
  }
  return { allowed: false, reason: 'not_escalatable' }
}
