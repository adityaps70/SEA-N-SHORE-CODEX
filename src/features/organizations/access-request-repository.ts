import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  ACCESS_REQUEST_ESCALATION_DAYS,
  escalationEligibility,
  isOrganizationAuthorityRole,
  platformFallbackReason,
  resolveAccessDecisionAuthority,
  type OrganizationAuthorityRole,
  type PlatformFallbackReason,
} from './access-request-policy'
import {
  COMPANY_ACCESS_REQUEST_ROLES,
  COMPANY_ACCESS_REQUEST_STATUSES,
  type CompanyAccessDecidedVia,
  type CompanyAccessRequestRole,
  type CompanyAccessRequestStatus,
} from './types'

export type AccessRequestQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type AccessRequestTransaction = <T>(work: (query: AccessRequestQuery) => Promise<T>) => Promise<T>

export type AccessRequestDecision = 'approved' | 'rejected'

/** Active owners/administrators of an organization, not counting the requester. */
export function activeAuthorityCountSql(companyRef: string, requesterRef: string) {
  return `(
    select count(*)::int
    from public.company_members authority
    join public.profiles authority_profile on authority_profile.id = authority.user_id
    where authority.company_id = ${companyRef}
      and authority.user_id <> ${requesterRef}
      and authority.approved_at is not null
      and authority.role::text in ('owner', 'administrator')
      and authority_profile.account_status::text = 'active'
  )`
}

export function organizationSuspendedSql(companyRef: string) {
  return `exists (
    select 1
    from public.organization_applications suspended_application
    where suspended_application.company_id = ${companyRef}
      and suspended_application.status = 'suspended'
  )`
}

/** SQL twin of platformFallbackReason(): pending requests Sea N Shore may act on. */
export function needsPlatformSql(alias = 'car') {
  return `(
    ${alias}.status = 'pending'
    and (
      ${alias}.escalated_at is not null
      or ${alias}.requested_at <= now() - interval '${ACCESS_REQUEST_ESCALATION_DAYS} days'
      or ${organizationSuspendedSql(`${alias}.company_id`)}
      or ${activeAuthorityCountSql(`${alias}.company_id`, `${alias}.user_id`)} = 0
    )
  )`
}

type LockedFactsRow = QueryResultRow & {
  id: string
  company_id: string
  user_id: string
  requested_role: string
  status: string
  requested_at: string | Date
  escalated_at: string | Date | null
  decided_via: string | null
  reviewer_note: string | null
  reviewed_by: string | null
  actor_organization_role: string | null
  actor_is_platform_admin: boolean | null
  active_authority_count: number | string | null
  organization_suspended: boolean | null
}

type ManagedRequestRow = QueryResultRow & {
  request_id: string
  status: string
  requested_role: string
  granted_role: string | null
  message: string | null
  requested_at: string | Date
  reviewed_at: string | Date | null
  reviewer_note: string | null
  decided_via: string | null
  escalated_at: string | Date | null
  escalation_note: string | null
  requester_id: string
  requester_name: string
  requester_slug: string | null
  requester_headline: string | null
  reviewer_name: string | null
}

type AuthorityRow = QueryResultRow & {
  organization_role: string | null
  is_platform_admin: boolean | null
  organization_suspended: boolean | null
}

type CountRow = QueryResultRow & { company_id: string; pending_count: number | string }
type ReturningIdRow = QueryResultRow & { id: string }

export type ManagedAccessRequest = {
  id: string
  status: CompanyAccessRequestStatus
  requestedRole: CompanyAccessRequestRole
  grantedRole: CompanyAccessRequestRole | null
  message: string | null
  requestedAt: string
  reviewedAt: string | null
  reviewerNote: string | null
  reviewerName: string | null
  decidedVia: CompanyAccessDecidedVia | null
  escalatedAt: string | null
  escalationNote: string | null
  requester: { id: string; fullName: string; slug: string | null; headline: string | null }
}

export type OrganizationAccessViewer =
  | { kind: 'organization'; role: OrganizationAuthorityRole }
  | { kind: 'platform' }

export function isoTimestamp(value: string | Date): string
export function isoTimestamp(value: string | Date | null | undefined): string | null
export function isoTimestamp(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : value
}

export function accessRequestRole(value: string | null | undefined): CompanyAccessRequestRole | null {
  return COMPANY_ACCESS_REQUEST_ROLES.includes(value as CompanyAccessRequestRole) ? value as CompanyAccessRequestRole : null
}

export function accessRequestStatus(value: string): CompanyAccessRequestStatus {
  if (COMPANY_ACCESS_REQUEST_STATUSES.includes(value as CompanyAccessRequestStatus)) return value as CompanyAccessRequestStatus
  throw new Error('company_access_request_status_invalid')
}

export function decidedVia(value: string | null | undefined): CompanyAccessDecidedVia | null {
  return value === 'organization' || value === 'platform' ? value : null
}

function count(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

async function lockRequestFacts(txQuery: AccessRequestQuery, requestId: string, actorId: string) {
  const rows = await txQuery(
    `select
       car.id,
       car.company_id,
       car.user_id,
       car.requested_role::text as requested_role,
       car.status,
       car.requested_at,
       car.escalated_at,
       car.decided_via,
       car.reviewer_note,
       car.reviewed_by,
       (
         select member.role::text
         from public.company_members member
         join public.profiles member_profile on member_profile.id = member.user_id
         where member.company_id = car.company_id
           and member.user_id = $2
           and member.approved_at is not null
           and member_profile.account_status::text = 'active'
         limit 1
       ) as actor_organization_role,
       exists (
         select 1 from public.user_roles platform_role
         where platform_role.user_id = $2 and platform_role.role::text = 'administrator'
       ) as actor_is_platform_admin,
       ${activeAuthorityCountSql('car.company_id', 'car.user_id')} as active_authority_count,
       ${organizationSuspendedSql('car.company_id')} as organization_suspended
     from public.company_access_requests car
     where car.id = $1
     for update of car`,
    [requestId, actorId],
  ) as LockedFactsRow[]
  return rows[0] ?? null
}

/**
 * Approve or reject a request inside an existing transaction. Authority is
 * re-checked here from locked database state, so neither the organization
 * page nor the admin console can bypass it.
 */
export async function decideAccessRequestWithQuery(
  txQuery: AccessRequestQuery,
  actorId: string,
  input: {
    requestId: string
    decision: AccessRequestDecision
    grantedRole?: CompanyAccessRequestRole | null
    note: string | null
  },
) {
  const request = await lockRequestFacts(txQuery, input.requestId, actorId)
  if (!request) throw new Error('company_access_request_not_found')

  const authority = resolveAccessDecisionAuthority({
    status: request.status,
    requesterId: request.user_id,
    requestedAt: request.requested_at,
    escalatedAt: request.escalated_at,
    actorId,
    actorOrganizationRole: request.actor_organization_role,
    actorIsPlatformAdmin: Boolean(request.actor_is_platform_admin),
    activeAuthorityCount: count(request.active_authority_count),
    organizationSuspended: Boolean(request.organization_suspended),
  })

  if (!authority.allowed) {
    const codes = {
      not_pending: 'company_access_request_review_forbidden',
      own_request: 'company_access_request_own',
      escalated_to_platform: 'company_access_request_escalated',
      platform_read_only: 'company_access_request_platform_read_only',
      forbidden: 'company_access_request_forbidden',
    } as const
    throw new Error(codes[authority.reason])
  }

  const requestedRole = accessRequestRole(request.requested_role)
  if (!requestedRole) throw new Error('company_access_request_role_invalid')
  const grantedRole = input.decision === 'approved' ? input.grantedRole ?? requestedRole : null
  if (input.decision === 'approved' && !accessRequestRole(grantedRole)) throw new Error('company_access_request_role_invalid')

  if (input.decision === 'approved') {
    // Never downgrade an owner through an access request.
    await txQuery(
      `insert into public.company_members (company_id, user_id, role, approved_at, created_at)
       values ($1, $2, $3::public.company_member_role, now(), now())
       on conflict (company_id, user_id)
       do update set
         role = excluded.role,
         approved_at = coalesce(public.company_members.approved_at, now())
       where public.company_members.role::text <> 'owner'`,
      [request.company_id, request.user_id, grantedRole],
    )
  }

  const via: CompanyAccessDecidedVia = authority.via
  await txQuery(
    `update public.company_access_requests
     set status = $2,
         reviewed_by = $3,
         reviewed_at = now(),
         reviewer_note = $4,
         granted_role = $5::public.company_member_role,
         decided_via = $6
     where id = $1`,
    [input.requestId, input.decision, actorId, input.note, grantedRole, via],
  )

  await txQuery(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
     values ($1, $2, 'company_access_request', $3, $4::jsonb)`,
    [
      actorId,
      `organization_access.${input.decision}`,
      input.requestId,
      JSON.stringify({
        companyId: request.company_id,
        userId: request.user_id,
        requestedRole,
        grantedRole,
        reviewerNote: input.note,
        decidedVia: via,
        deciderRole: authority.via === 'organization' ? authority.actorRole : 'platform_administrator',
        fallbackReason: authority.via === 'platform' ? authority.reason : null,
        escalated: Boolean(request.escalated_at),
      }),
    ],
  )

  return { companyId: request.company_id, via, grantedRole }
}

function runtimeTransaction<T>(work: (query: AccessRequestQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function mapManagedRequest(row: ManagedRequestRow): ManagedAccessRequest {
  return {
    id: row.request_id,
    status: accessRequestStatus(row.status),
    requestedRole: accessRequestRole(row.requested_role) ?? 'member',
    grantedRole: accessRequestRole(row.granted_role),
    message: row.message ?? null,
    requestedAt: isoTimestamp(row.requested_at),
    reviewedAt: isoTimestamp(row.reviewed_at),
    reviewerNote: row.reviewer_note ?? null,
    reviewerName: row.reviewer_name ?? null,
    decidedVia: decidedVia(row.decided_via),
    escalatedAt: isoTimestamp(row.escalated_at),
    escalationNote: row.escalation_note ?? null,
    requester: {
      id: row.requester_id,
      fullName: row.requester_name,
      slug: row.requester_slug ?? null,
      headline: row.requester_headline ?? null,
    },
  }
}

export function createOrganizationAccessRequestRepository(input: {
  query?: AccessRequestQuery
  transaction?: AccessRequestTransaction
} = {}) {
  const query: AccessRequestQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  /** Who is looking at an organization's requests: its owner/admin, a platform admin, or nobody. */
  async function getViewer(actorId: string, companyId: string): Promise<OrganizationAccessViewer | null> {
    const rows = await query(
      `select
         (
           select member.role::text
           from public.company_members member
           join public.profiles member_profile on member_profile.id = member.user_id
           where member.company_id = $1
             and member.user_id = $2
             and member.approved_at is not null
             and member_profile.account_status::text = 'active'
           limit 1
         ) as organization_role,
         exists (
           select 1 from public.user_roles platform_role
           where platform_role.user_id = $2 and platform_role.role::text = 'administrator'
         ) as is_platform_admin,
         ${organizationSuspendedSql('$1')} as organization_suspended`,
      [companyId, actorId],
    ) as AuthorityRow[]
    const row = rows[0]
    if (!row) return null
    if (!row.organization_suspended && isOrganizationAuthorityRole(row.organization_role)) {
      return { kind: 'organization', role: row.organization_role }
    }
    if (row.is_platform_admin) return { kind: 'platform' }
    return null
  }

  async function listForOrganization(actorId: string, companyId: string) {
    const viewer = await getViewer(actorId, companyId)
    if (!viewer) throw new Error('organization_access_forbidden')

    const rows = await query(
      `select
         car.id as request_id,
         car.status,
         car.requested_role::text as requested_role,
         car.granted_role::text as granted_role,
         car.message,
         car.requested_at,
         car.reviewed_at,
         car.reviewer_note,
         car.decided_via,
         car.escalated_at,
         car.escalation_note,
         requester.id as requester_id,
         requester.full_name as requester_name,
         requester.slug as requester_slug,
         requester.headline as requester_headline,
         reviewer.full_name as reviewer_name
       from public.company_access_requests car
       join public.profiles requester on requester.id = car.user_id
       left join public.profiles reviewer on reviewer.id = car.reviewed_by
       where car.company_id = $1
         and (car.status = 'pending' or car.reviewed_at > now() - interval '90 days')
       order by
         case when car.status = 'pending' then 0 else 1 end,
         case when car.status = 'pending' then car.requested_at end asc,
         car.reviewed_at desc nulls last,
         car.id asc
       limit 200`,
      [companyId],
    ) as ManagedRequestRow[]

    return { viewer, requests: rows.map(mapManagedRequest) }
  }

  /** Pending requests waiting on the user, per organization they own or administer. */
  async function countPendingForManager(actorId: string): Promise<Record<string, number>> {
    const rows = await query(
      `select car.company_id, count(*)::int as pending_count
       from public.company_access_requests car
       join public.company_members manager
         on manager.company_id = car.company_id
        and manager.user_id = $1
        and manager.approved_at is not null
        and manager.role::text in ('owner', 'administrator')
       where car.status = 'pending'
         and car.escalated_at is null
         and car.user_id <> $1
         and not ${organizationSuspendedSql('car.company_id')}
       group by car.company_id`,
      [actorId],
    ) as CountRow[]
    return Object.fromEntries(rows.map((row) => [row.company_id, count(row.pending_count)]))
  }

  async function decide(
    actorId: string,
    input: { requestId: string; decision: AccessRequestDecision; grantedRole?: CompanyAccessRequestRole | null; note: string | null },
  ) {
    return transaction((txQuery) => decideAccessRequestWithQuery(txQuery, actorId, input))
  }

  async function escalate(userId: string, requestId: string, note: string) {
    return transaction(async (txQuery) => {
      const rows = await txQuery(
        `select id, company_id, user_id, requested_role::text as requested_role, status,
                requested_at, escalated_at, decided_via, reviewer_note, reviewed_by
         from public.company_access_requests
         where id = $1
         for update`,
        [requestId],
      ) as LockedFactsRow[]
      const request = rows[0]
      if (!request || request.user_id !== userId) throw new Error('company_access_request_not_found')

      const eligibility = escalationEligibility({
        status: request.status,
        requesterId: request.user_id,
        actorId: userId,
        requestedAt: request.requested_at,
        escalatedAt: request.escalated_at,
        decidedVia: request.decided_via,
      })
      if (!eligibility.allowed) {
        const codes = {
          not_requester: 'company_access_request_not_found',
          already_escalated: 'company_access_request_already_escalated',
          too_early: 'company_access_request_escalation_too_early',
          not_escalatable: 'company_access_request_not_escalatable',
        } as const
        throw new Error(codes[eligibility.reason])
      }

      if (eligibility.kind === 'after_rejection') {
        const duplicates = await txQuery(
          `select id from public.company_access_requests
           where company_id = $1 and user_id = $2 and requested_role::text = $3
             and status = 'pending' and id <> $4
           limit 1`,
          [request.company_id, request.user_id, request.requested_role, requestId],
        ) as ReturningIdRow[]
        if (duplicates[0]) throw new Error('organization_access_request_exists')
      }

      // A disputed rejection is reopened for Sea N Shore. The organization's
      // rejection note stays visible until Sea N Shore decides.
      await txQuery(
        `update public.company_access_requests
         set status = 'pending',
             escalated_at = now(),
             escalation_note = $2
         where id = $1`,
        [requestId, note],
      )

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'organization_access.escalated', 'company_access_request', $2, $3::jsonb)`,
        [
          userId,
          requestId,
          JSON.stringify({
            companyId: request.company_id,
            kind: eligibility.kind,
            previousStatus: request.status,
            previousReviewedBy: request.reviewed_by ?? null,
            previousReviewerNote: request.reviewer_note ?? null,
            escalationNote: note,
          }),
        ],
      )
      return { companyId: request.company_id, kind: eligibility.kind }
    })
  }

  async function withdraw(userId: string, requestId: string) {
    return transaction(async (txQuery) => {
      const rows = await txQuery(
        `update public.company_access_requests
         set status = 'cancelled', reviewed_at = now()
         where id = $1 and user_id = $2 and status = 'pending'
         returning id, company_id`,
        [requestId, userId],
      ) as Array<ReturningIdRow & { company_id: string }>
      const row = rows[0]
      if (!row) throw new Error('company_access_request_not_withdrawable')

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'organization_access.withdrawn', 'company_access_request', $2, $3::jsonb)`,
        [userId, requestId, JSON.stringify({ companyId: row.company_id })],
      )
      return { companyId: row.company_id }
    })
  }

  return {
    getViewer,
    listForOrganization,
    countPendingForManager,
    decide,
    escalate,
    withdraw,
  }
}

export type OrganizationAccessRequestRepository = ReturnType<typeof createOrganizationAccessRequestRepository>

export const organizationAccessRequestRepository = createOrganizationAccessRequestRepository()

export { platformFallbackReason, type PlatformFallbackReason }
