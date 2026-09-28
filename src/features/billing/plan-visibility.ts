import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
export { PLAN_HIDDEN_MESSAGE, planRenewHref } from './plan-visibility-copy'
import type { BillingSubject } from './plans'

/**
 * Plan-lapse visibility: when a Creator Pro or Organization Pro plan ends, the owner's
 * jobs, events and courses disappear for everyone else (they are kept, never deleted)
 * and come back as soon as the owner subscribes again.
 *
 * Who owns an item:
 *   - posted as an organization (company_id set)  -> that organization (Organization Pro)
 *   - posted personally                           -> the member who posted it (Creator Pro)
 *
 * An item is visible to others when its owner
 *   - has a current plan (trialing / active / past_due, period not over), or
 *   - holds a direct grant for the publishing capability (admin, legacy, promotion), or
 *   - never had a paid plan at all (items from before paid plans stay live),
 * and, in the last case, the item was not hidden by the plan sync.
 *
 * The rule is evaluated at read time (so an ended period hides items immediately, even
 * before a webhook or the hourly sweep runs). hidden_for_plan_at is also stamped by
 * syncPlanContentVisibility from the subscription handlers so owners can see since when
 * an item is hidden and the column is cleared again on renewal.
 *
 * Buyers keep access: learner enrollments, event tickets and job applications are read
 * through their own queries, which do not apply this rule.
 */

export type PlanContentKind = 'job' | 'event' | 'course'

const CONTENT: Record<PlanContentKind, { table: string; personColumn: string; capability: string }> = {
  job: { table: 'public.jobs', personColumn: 'created_by_user_id', capability: 'job.publish' },
  event: { table: 'public.events', personColumn: 'host_user_id', capability: 'event.publish' },
  course: { table: 'public.learning_courses', personColumn: 'created_by_user_id', capability: 'course.publish' },
}

function ownerSql(subjectColumn: 'profile_id' | 'company_id', ownerExpression: string, capability: string, alias: string) {
  const current = `exists (
        select 1 from public.account_subscriptions plan_current_${alias}
        where plan_current_${alias}.${subjectColumn} = ${ownerExpression}
          and plan_current_${alias}.status in ('trialing', 'active', 'past_due')
          and (plan_current_${alias}.current_period_ends_at is null or plan_current_${alias}.current_period_ends_at > now())
      )`
  const granted = `exists (
        select 1 from public.entitlement_grants plan_grant_${alias}
        where plan_grant_${alias}.${subjectColumn} = ${ownerExpression}
          and plan_grant_${alias}.capability = '${capability}'
          and plan_grant_${alias}.revoked_at is null
          and (plan_grant_${alias}.expires_at is null or plan_grant_${alias}.expires_at > now())
      )`
  const everPaid = `exists (
        select 1 from public.account_subscriptions plan_past_${alias}
        where plan_past_${alias}.${subjectColumn} = ${ownerExpression}
          and plan_past_${alias}.status <> 'pending'
      )`
  return { current, granted, everPaid }
}

/**
 * SQL boolean: may people other than the owner see this item? `alias` is the table
 * alias used in the query (e.g. "j", "e", "course"). Contains no bind parameters.
 */
export function planVisibleSql(kind: PlanContentKind, alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('plan_visibility_alias_invalid')
  const { personColumn, capability } = CONTENT[kind]
  const company = ownerSql('company_id', `${alias}.company_id`, capability, `${alias}_c`)
  const person = ownerSql('profile_id', `${alias}.${personColumn}`, capability, `${alias}_p`)
  return `(
    case
      when ${alias}.company_id is not null then (
        ${company.current}
        or ${company.granted}
        or (${alias}.hidden_for_plan_at is null and not ${company.everPaid})
      )
      when ${alias}.${personColumn} is null then ${alias}.hidden_for_plan_at is null
      else (
        ${person.current}
        or ${person.granted}
        or (${alias}.hidden_for_plan_at is null and not ${person.everPaid})
      )
    end
  )`
}

type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

function subjectFilter(subject: BillingSubject | null, kind: PlanContentKind, alias: string) {
  if (!subject) return { where: 'true', values: [] as unknown[] }
  return subject.kind === 'company'
    ? { where: `${alias}.company_id = $1::uuid`, values: [subject.companyId] }
    : { where: `${alias}.company_id is null and ${alias}.${CONTENT[kind].personColumn} = $1::uuid`, values: [subject.profileId] }
}

/**
 * Brings hidden_for_plan_at in line with the plan rule: stamps it on items the rule hides
 * (the owner's plan ended), clears it on hidden items whose owner is entitled again.
 * Items of owners who never paid are never touched. Idempotent. With a subject, only
 * that member's personal items or that organization's items; without, everything
 * (the hourly billing sweep). Returns how many items were hidden and restored.
 */
export async function syncPlanContentVisibility(
  subject: BillingSubject | null,
  run: Query = (text, values) => databaseQuery<Row>(text, values),
) {
  let hidden = 0
  let restored = 0
  for (const kind of Object.keys(CONTENT) as PlanContentKind[]) {
    const { table } = CONTENT[kind]
    const filter = subjectFilter(subject, kind, 'item')
    const visible = planVisibleSql(kind, 'item')
    const hiddenRows = await run(
      `update ${table} item
       set hidden_for_plan_at = now()
       where ${filter.where}
         and item.hidden_for_plan_at is null
         and not ${visible}
       returning item.id`,
      filter.values,
    )
    // For an item already hidden, the rule is true only when its owner is entitled again.
    const restoredRows = await run(
      `update ${table} item
       set hidden_for_plan_at = null
       where ${filter.where}
         and item.hidden_for_plan_at is not null
         and ${visible}
       returning item.id`,
      filter.values,
    )
    hidden += hiddenRows.length
    restored += restoredRows.length
  }
  return { hidden, restored }
}
