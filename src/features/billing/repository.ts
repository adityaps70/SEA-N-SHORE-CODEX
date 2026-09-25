import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

type BillingQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type OrganizationBillingRow = QueryResultRow & {
  company_id: string
  company_name: string
  company_slug: string
  company_verified: boolean | null
  subscription_id: string | null
  plan_code: string | null
  subscription_status: string | null
  billing_provider: string | null
  current_period_started_at: string | Date | null
  current_period_ends_at: string | Date | null
  cancel_at_period_end: boolean | null
  subscription_created_at: string | Date | null
  subscription_updated_at: string | Date | null
}

function iso(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : value
}

function isCurrentSubscription(row: OrganizationBillingRow, now: Date) {
  if (!row.subscription_id) return false
  if (!row.subscription_status || !['trialing', 'active', 'past_due'].includes(row.subscription_status)) return false
  const end = iso(row.current_period_ends_at)
  if (!end) return true
  const endTime = new Date(end).getTime()
  return Number.isFinite(endTime) && endTime > now.getTime()
}

export function createBillingRepository(input: {
  query?: BillingQuery
  now?: () => Date
} = {}) {
  const queryRows: BillingQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const now = input.now ?? (() => new Date())

  async function getOrganizationBillingOverview(companyId: string) {
    const rows = await queryRows(
      `select
         company.id as company_id,
         company.name as company_name,
         company.slug as company_slug,
         coalesce(company.is_verified, false) as company_verified,
         subscription.id as subscription_id,
         subscription.plan_code,
         subscription.status as subscription_status,
         subscription.billing_provider,
         subscription.current_period_started_at,
         subscription.current_period_ends_at,
         subscription.cancel_at_period_end,
         subscription.created_at as subscription_created_at,
         subscription.updated_at as subscription_updated_at
       from public.companies company
       left join lateral (
         select
           s.id,
           s.plan_code,
           s.status,
           s.billing_provider,
           s.current_period_started_at,
           s.current_period_ends_at,
           s.cancel_at_period_end,
           s.created_at,
           s.updated_at
         from public.account_subscriptions s
         where s.company_id = company.id
         order by
           case s.status
             when 'active' then 0
             when 'trialing' then 1
             when 'past_due' then 2
             when 'pending' then 3
             else 4
           end,
           s.updated_at desc,
           s.id desc
         limit 1
       ) subscription on true
       where company.id = $1
       limit 1`,
      [companyId],
    ) as OrganizationBillingRow[]

    const row = rows[0]
    if (!row) return null

    const current = isCurrentSubscription(row, now())
    const subscription = row.subscription_id
      ? {
          id: row.subscription_id,
          plan: row.plan_code === 'organization_pro' ? 'organization_pro' as const : 'free' as const,
          status: row.subscription_status ?? 'unknown',
          billingProvider: row.billing_provider ?? null,
          currentPeriodStartedAt: iso(row.current_period_started_at),
          currentPeriodEndsAt: iso(row.current_period_ends_at),
          cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
          createdAt: iso(row.subscription_created_at)!,
          updatedAt: iso(row.subscription_updated_at)!,
        }
      : null

    return {
      company: {
        id: row.company_id,
        name: row.company_name,
        slug: row.company_slug,
        verified: Boolean(row.company_verified),
      },
      currentPlan: current && row.plan_code === 'organization_pro'
        ? 'organization_pro' as const
        : 'free' as const,
      subscription,
    }
  }

  return { getOrganizationBillingOverview }
}

export type BillingRepository = ReturnType<typeof createBillingRepository>

export const billingRepository = createBillingRepository()
