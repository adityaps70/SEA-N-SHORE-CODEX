import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import {
  CAPABILITIES,
  PLAN_CODES,
  VERIFICATION_TYPES,
  type AccessContext,
  type Capability,
  type OrganizationAccessMembership,
  type OrganizationAccessRole,
  type PlanCode,
  type VerificationType,
} from './policy'

type AccessQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type ProfileRow = QueryResultRow & {
  account_status: string
}

type PlanRow = QueryResultRow & {
  plan_code: string
}

type CapabilityRow = QueryResultRow & {
  capability: string
}

type PlanEntitlementRow = QueryResultRow & {
  plan_code: string
  capability: string
}

type VerificationRow = QueryResultRow & {
  verification_type: string
}

type OrganizationRow = QueryResultRow & {
  company_id: string
  company_verified: boolean | null
  role: string
  plan_code: string | null
  entitlements: string[] | null
}

function planCode(value: string | null | undefined, fallback: PlanCode = 'free'): PlanCode {
  return PLAN_CODES.includes(value as PlanCode) ? value as PlanCode : fallback
}

function capability(value: string): Capability | null {
  return CAPABILITIES.includes(value as Capability) ? value as Capability : null
}

function uniqueCapabilities(values: readonly Capability[]) {
  return [...new Set(values)]
}

function verification(value: string): VerificationType | null {
  return VERIFICATION_TYPES.includes(value as VerificationType) ? value as VerificationType : null
}

function organizationRole(value: string): OrganizationAccessRole {
  if (
    value === 'owner'
    || value === 'administrator'
    || value === 'recruiter'
    || value === 'lms_manager'
    || value === 'event_manager'
    || value === 'content_manager'
    || value === 'analyst'
    || value === 'member'
  ) return value

  return 'member'
}

export function createAccessRepository(input: { query?: AccessQuery } = {}) {
  const queryRows: AccessQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function getAccessContext(profileId: string): Promise<AccessContext> {
    const [profiles, plans, grants, verifications, planEntitlementRows, organizations] = await Promise.all([
      queryRows(
        `select account_status::text as account_status
         from public.profiles
         where id = $1
         limit 1`,
        [profileId],
      ) as Promise<ProfileRow[]>,
      queryRows(
        `select plan_code
         from public.account_subscriptions
         where profile_id = $1
           and status in ('trialing', 'active', 'past_due')
           and (current_period_ends_at is null or current_period_ends_at > now())
         order by
           case status when 'active' then 0 when 'trialing' then 1 else 2 end,
           updated_at desc,
           id desc
         limit 1`,
        [profileId],
      ) as Promise<PlanRow[]>,
      queryRows(
        `select capability
         from public.entitlement_grants
         where profile_id = $1
           and revoked_at is null
           and (expires_at is null or expires_at > now())
         order by capability asc`,
        [profileId],
      ) as Promise<CapabilityRow[]>,
      queryRows(
        `select verification_type
         from public.feature_verifications
         where profile_id = $1
           and status = 'approved'
         order by verification_type asc`,
        [profileId],
      ) as Promise<VerificationRow[]>,
      queryRows(
        `select plan_code, capability
         from public.plan_entitlements
         order by plan_code asc, capability asc`,
      ) as Promise<PlanEntitlementRow[]>,
      queryRows(
        `select
           c.id as company_id,
           coalesce(c.is_verified, false) as company_verified,
           cm.role::text as role,
           subscription.plan_code,
           coalesce(grants.entitlements, '{}'::text[]) as entitlements
         from public.company_members cm
         join public.companies c on c.id = cm.company_id
         left join lateral (
           select s.plan_code
           from public.account_subscriptions s
           where s.company_id = c.id
             and s.status in ('trialing', 'active', 'past_due')
             and (s.current_period_ends_at is null or s.current_period_ends_at > now())
           order by
             case s.status when 'active' then 0 when 'trialing' then 1 else 2 end,
             s.updated_at desc,
             s.id desc
           limit 1
         ) subscription on true
         left join lateral (
           select array_agg(g.capability order by g.capability) as entitlements
           from public.entitlement_grants g
           where g.company_id = c.id
             and g.revoked_at is null
             and (g.expires_at is null or g.expires_at > now())
         ) grants on true
         where cm.user_id = $1
           and cm.approved_at is not null
         order by c.name asc, c.id asc`,
        [profileId],
      ) as Promise<OrganizationRow[]>,
    ])

    const profile = profiles[0]
    const planEntitlementsByCode = new Map<PlanCode, Capability[]>()
    for (const row of planEntitlementRows) {
      const plan = planCode(row.plan_code)
      const resolvedCapability = capability(row.capability)
      if (!resolvedCapability) continue
      const current = planEntitlementsByCode.get(plan) ?? []
      current.push(resolvedCapability)
      planEntitlementsByCode.set(plan, current)
    }

    const personalGrantEntitlements = grants
      .map((row) => capability(row.capability))
      .filter((entry): entry is Capability => entry !== null)
    const approvedVerifications = verifications
      .map((row) => verification(row.verification_type))
      .filter((entry): entry is VerificationType => entry !== null)

    const personalPlan = planCode(plans[0]?.plan_code)
    const personalEntitlements = uniqueCapabilities([
      ...(planEntitlementsByCode.get(personalPlan) ?? []),
      ...personalGrantEntitlements,
    ])

    const organizationMemberships: OrganizationAccessMembership[] = organizations.map((row) => {
      const plan = planCode(row.plan_code)
      const grantEntitlements = (row.entitlements ?? [])
        .map((entry) => capability(entry))
        .filter((entry): entry is Capability => entry !== null)

      return {
        companyId: row.company_id,
        plan,
        role: organizationRole(row.role),
        verified: Boolean(row.company_verified),
        entitlements: uniqueCapabilities([
          ...(planEntitlementsByCode.get(plan) ?? []),
          ...grantEntitlements,
        ]),
      }
    })

    return {
      personalPlan,
      personalEntitlements,
      verifications: approvedVerifications,
      organizationMemberships,
      accountActive: profile?.account_status === 'active',
    }
  }

  return { getAccessContext }
}

export const accessRepository = createAccessRepository()
