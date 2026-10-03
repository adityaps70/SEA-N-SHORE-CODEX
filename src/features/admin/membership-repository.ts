import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { accessRepository } from '@/features/access/repository'
import {
  CAPABILITIES,
  PLAN_CODES,
  VERIFICATION_TYPES,
  effectiveCapabilities,
  type AccessContext,
  type Capability,
  type PlanCode,
  type VerificationType,
} from '@/features/access/policy'
import {
  ADMIN_ORGANIZATION_GRANTABLE_CAPABILITIES,
  ADMIN_PERSONAL_GRANTABLE_CAPABILITIES,
  type AdminEntitlementGrantInput,
  type AdminEntitlementSubjectType,
} from './membership-policy'

type AdminMembershipQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type AdminMembershipTransaction = <T>(work: (query: AdminMembershipQuery) => Promise<T>) => Promise<T>
type LoadAccessContext = (profileId: string) => Promise<AccessContext>

type UserProfileRow = QueryResultRow & {
  profile_id: string
  persona: string | null
  profile_intents: string[] | null
  account_status: string
}

type SubscriptionRow = QueryResultRow & {
  id: string
  plan_code: string
  status: string
  billing_provider: string | null
  current_period_started_at: string | Date | null
  current_period_ends_at: string | Date | null
  cancel_at_period_end: boolean | null
  created_at: string | Date
  updated_at: string | Date
}

type VerificationRow = QueryResultRow & {
  verification_type: string
  status: string
  source: string
  submitted_at: string | Date | null
  reviewed_at: string | Date | null
  review_note: string | null
}

type VerificationAuditRow = QueryResultRow & {
  id: string
  action: string
  target_id: string
  metadata: Record<string, unknown> | string | null
  created_at: string | Date
  actor_id: string | null
  actor_name: string | null
}

type EntitlementRow = QueryResultRow & {
  id: string
  capability: string
  source: string
  reason: string | null
  expires_at: string | Date | null
  revoked_at: string | Date | null
  created_at: string | Date
  granted_by: string | null
  granted_by_name: string | null
}

type CompanyRow = QueryResultRow & {
  company_id: string
  company_name: string
  company_verified: boolean | null
}

type CompanyManagerRow = QueryResultRow & {
  profile_id: string
  full_name: string
  slug: string | null
  role: string
  approved_at: string | Date
}

type IdRow = QueryResultRow & {
  id: string
}

type RevokedGrantRow = QueryResultRow & {
  id: string
  capability: string
  profile_id: string | null
  company_id: string | null
}

function runtimeTransaction<T>(work: (query: AdminMembershipQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function iso(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : value
}

function asPlan(value: string | null | undefined): PlanCode {
  return PLAN_CODES.includes(value as PlanCode) ? value as PlanCode : 'free'
}

function asCapability(value: string): Capability {
  if (CAPABILITIES.includes(value as Capability)) return value as Capability
  throw new Error('admin_entitlement_capability_invalid')
}

function asVerificationType(value: string): VerificationType {
  if (VERIFICATION_TYPES.includes(value as VerificationType)) return value as VerificationType
  throw new Error('admin_verification_type_invalid')
}

function subscription(row: SubscriptionRow | undefined) {
  if (!row) return null
  return {
    id: row.id,
    plan: asPlan(row.plan_code),
    status: row.status,
    billingProvider: row.billing_provider ?? null,
    currentPeriodStartedAt: iso(row.current_period_started_at),
    currentPeriodEndsAt: iso(row.current_period_ends_at),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

function entitlement(row: EntitlementRow) {
  const expiresAt = iso(row.expires_at)
  const revokedAt = iso(row.revoked_at)
  const notExpired = !expiresAt || new Date(expiresAt).getTime() > Date.now()
  return {
    id: row.id,
    capability: asCapability(row.capability),
    source: row.source,
    reason: row.reason ?? null,
    expiresAt,
    revokedAt,
    createdAt: iso(row.created_at)!,
    grantedBy: row.granted_by
      ? { id: row.granted_by, fullName: row.granted_by_name ?? 'Unknown administrator' }
      : null,
    active: revokedAt === null && notExpired,
  }
}

async function requireAdministrator(query: AdminMembershipQuery, adminId: string, lock = false) {
  const rows = await query(
    `select true as allowed
     from public.user_roles
     where user_id = $1
       and role::text = 'administrator'
     ${lock ? 'for update' : ''}
     limit 1`,
    [adminId],
  )
  if (!rows[0]) throw new Error('admin_forbidden')
}

function latestSubscriptionSql(subjectColumn: 'profile_id' | 'company_id') {
  return `select
     subscription.id,
     subscription.plan_code,
     subscription.status,
     subscription.billing_provider,
     subscription.current_period_started_at,
     subscription.current_period_ends_at,
     subscription.cancel_at_period_end,
     subscription.created_at,
     subscription.updated_at
   from public.account_subscriptions subscription
   where subscription.${subjectColumn} = $1
   order by
     case subscription.status
       when 'active' then 0
       when 'trialing' then 1
       when 'past_due' then 2
       when 'pending' then 3
       else 4
     end,
     subscription.updated_at desc,
     subscription.id desc
   limit 1`
}

function entitlementHistorySql(subjectColumn: 'profile_id' | 'company_id') {
  return `select
     grant_record.id,
     grant_record.capability,
     grant_record.source,
     grant_record.reason,
     grant_record.expires_at,
     grant_record.revoked_at,
     grant_record.created_at,
     grant_record.granted_by,
     administrator.full_name as granted_by_name
   from public.entitlement_grants grant_record
   left join public.profiles administrator on administrator.id = grant_record.granted_by
   where grant_record.${subjectColumn} = $1
   order by grant_record.created_at desc, grant_record.id desc
   limit 100`
}

export function createAdminMembershipRepository(input: {
  query?: AdminMembershipQuery
  transaction?: AdminMembershipTransaction
  loadAccessContext?: LoadAccessContext
} = {}) {
  const queryRows: AdminMembershipQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction
  const loadAccessContext = input.loadAccessContext ?? ((profileId) => accessRepository.getAccessContext(profileId))

  async function getUserAccessOverview(adminId: string, profileId: string) {
    await requireAdministrator(queryRows, adminId)

    const [profiles, subscriptions, verificationRows, entitlementRows, verificationAuditRows, access] = await Promise.all([
      queryRows(
        `select
           profile.id as profile_id,
           profile.persona,
           profile.profile_intents,
           profile.account_status::text as account_status
         from public.profiles profile
         where profile.id = $1
         limit 1`,
        [profileId],
      ) as Promise<UserProfileRow[]>,
      queryRows(latestSubscriptionSql('profile_id'), [profileId]) as Promise<SubscriptionRow[]>,
      queryRows(
        `select
           verification.verification_type,
           verification.status,
           verification.source,
           coalesce(verification.submitted_at, verification.created_at) as submitted_at,
           verification.reviewed_at,
           verification.review_note
         from public.feature_verifications verification
         where verification.profile_id = $1
         order by verification.verification_type asc`,
        [profileId],
      ) as Promise<VerificationRow[]>,
      queryRows(entitlementHistorySql('profile_id'), [profileId]) as Promise<EntitlementRow[]>,
      queryRows(
        `select
           audit.id,
           audit.action,
           audit.target_id,
           audit.metadata,
           audit.created_at,
           audit.actor_id,
           actor.full_name as actor_name
         from public.audit_events audit
         join public.feature_verifications verification
           on verification.id::text = audit.target_id
         left join public.profiles actor on actor.id = audit.actor_id
         where verification.profile_id = $1
           and audit.target_type = 'feature_verification'
           and audit.action like 'verification.%'
         order by audit.created_at desc, audit.id desc
         limit 100`,
        [profileId],
      ) as Promise<VerificationAuditRow[]>,
      loadAccessContext(profileId),
    ])

    const profile = profiles[0]
    if (!profile) return null

    return {
      profileId: profile.profile_id,
      persona: profile.persona ?? null,
      intents: Array.isArray(profile.profile_intents) ? profile.profile_intents : [],
      accountStatus: profile.account_status,
      plan: access.personalPlan,
      subscription: subscription(subscriptions[0]),
      effectiveCapabilities: effectiveCapabilities(access),
      verifications: verificationRows.map((row) => ({
        type: asVerificationType(row.verification_type),
        status: row.status,
        source: row.source,
        submittedAt: iso(row.submitted_at),
        reviewedAt: iso(row.reviewed_at),
        reviewNote: row.review_note ?? null,
      })),
      entitlementHistory: entitlementRows.map(entitlement),
      verificationHistory: verificationAuditRows.map((row) => {
        let metadata: Record<string, unknown> = {}
        if (row.metadata && typeof row.metadata === 'object') {
          metadata = row.metadata
        } else if (typeof row.metadata === 'string') {
          try {
            const parsed = JSON.parse(row.metadata)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>
          } catch {
            metadata = {}
          }
        }
        const verificationTypeValue = typeof metadata.verificationType === 'string'
          && VERIFICATION_TYPES.includes(metadata.verificationType as VerificationType)
          ? metadata.verificationType as VerificationType
          : null
        return {
          id: row.id,
          action: row.action,
          verificationId: row.target_id,
          verificationType: verificationTypeValue,
          metadata,
          createdAt: iso(row.created_at)!,
          actor: row.actor_id
            ? { id: row.actor_id, fullName: row.actor_name ?? 'Unknown administrator' }
            : null,
        }
      }),
    }
  }

  async function getOrganizationAccessOverview(adminId: string, companyId: string) {
    await requireAdministrator(queryRows, adminId)

    const [companies, subscriptions, managerRows, entitlementRows] = await Promise.all([
      queryRows(
        `select
           company.id as company_id,
           company.name as company_name,
           coalesce(company.is_verified, false) as company_verified
         from public.companies company
         where company.id = $1
         limit 1`,
        [companyId],
      ) as Promise<CompanyRow[]>,
      queryRows(latestSubscriptionSql('company_id'), [companyId]) as Promise<SubscriptionRow[]>,
      queryRows(
        `select
           profile.id as profile_id,
           profile.full_name,
           profile.slug,
           member.role::text as role,
           member.approved_at
         from public.company_members member
         join public.profiles profile on profile.id = member.user_id
         where member.company_id = $1
           and member.approved_at is not null
           and member.role::text in (
             'owner',
             'administrator',
             'recruiter',
             'lms_manager',
             'event_manager',
             'content_manager',
             'analyst'
           )
         order by
           case member.role::text
             when 'owner' then 0
             when 'administrator' then 1
             else 2
           end,
           profile.full_name asc,
           profile.id asc`,
        [companyId],
      ) as Promise<CompanyManagerRow[]>,
      queryRows(entitlementHistorySql('company_id'), [companyId]) as Promise<EntitlementRow[]>,
    ])

    const company = companies[0]
    if (!company) return null
    const currentSubscription = subscription(subscriptions[0])
    const plan = currentSubscription
      && ['active', 'trialing', 'past_due'].includes(currentSubscription.status)
      ? currentSubscription.plan
      : 'free'

    return {
      companyId: company.company_id,
      name: company.company_name,
      verified: Boolean(company.company_verified),
      plan,
      subscription: currentSubscription,
      managers: managerRows.map((row) => ({
        profileId: row.profile_id,
        fullName: row.full_name,
        slug: row.slug ?? null,
        role: row.role,
        approvedAt: iso(row.approved_at)!,
      })),
      entitlementHistory: entitlementRows.map(entitlement),
    }
  }

  async function grantEntitlement(adminId: string, input: AdminEntitlementGrantInput) {
    const allowed = input.subjectType === 'profile'
      ? ADMIN_PERSONAL_GRANTABLE_CAPABILITIES
      : ADMIN_ORGANIZATION_GRANTABLE_CAPABILITIES
    if (!allowed.includes(input.capability as never)) {
      throw new Error('admin_entitlement_capability_forbidden')
    }

    const reason = input.reason.trim()
    if (!reason) throw new Error('admin_entitlement_reason_required')

    return transaction(async (txQuery) => {
      await requireAdministrator(txQuery, adminId, true)

      const subjectColumn = input.subjectType === 'profile' ? 'profile_id' : 'company_id'
      const rows = await txQuery(
        `insert into public.entitlement_grants (
           ${subjectColumn},
           capability,
           source,
           reason,
           granted_by,
           created_at
         )
         values ($1, $2, 'admin', $3, $4, now())
         on conflict do nothing
         returning id`,
        [input.subjectId, input.capability, reason, adminId],
      ) as IdRow[]
      const grant = rows[0]
      if (!grant) throw new Error('admin_entitlement_already_active')

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          adminId,
          'entitlement.granted',
          input.subjectType,
          input.subjectId,
          JSON.stringify({
            grantId: grant.id,
            capability: input.capability,
            source: 'admin',
            reason,
          }),
        ],
      )

      return { grantId: grant.id }
    })
  }

  async function revokeEntitlement(adminId: string, grantId: string, reasonInput: string) {
    const reason = reasonInput.trim()
    if (!reason) throw new Error('admin_entitlement_reason_required')

    return transaction(async (txQuery) => {
      await requireAdministrator(txQuery, adminId, true)

      const rows = await txQuery(
        `update public.entitlement_grants
         set revoked_at = now()
         where id = $1
           and revoked_at is null
           and source in ('admin', 'legacy_migration')
         returning id, capability, profile_id, company_id`,
        [grantId],
      ) as RevokedGrantRow[]
      const grant = rows[0]
      if (!grant) throw new Error('admin_entitlement_grant_not_found')

      const subjectType: AdminEntitlementSubjectType = grant.profile_id ? 'profile' : 'company'
      const subjectId = grant.profile_id ?? grant.company_id
      if (!subjectId) throw new Error('admin_entitlement_subject_invalid')

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          adminId,
          'entitlement.revoked',
          subjectType,
          subjectId,
          JSON.stringify({
            grantId: grant.id,
            capability: grant.capability,
            reason,
          }),
        ],
      )

      return true
    })
  }

  return {
    getUserAccessOverview,
    getOrganizationAccessOverview,
    grantEntitlement,
    revokeEntitlement,
  }
}

export type AdminMembershipRepository = ReturnType<typeof createAdminMembershipRepository>

export const adminMembershipRepository = createAdminMembershipRepository()
