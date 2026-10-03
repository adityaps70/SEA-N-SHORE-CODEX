import { describe, expect, it, vi } from 'vitest'
import { planVisibleSql, syncPlanContentVisibility } from './plan-visibility'
import { CREATOR_PRO_CHECKOUT_HREF, PLAN_HIDDEN_MESSAGE, planRenewHref } from './plan-visibility-copy'

const companyId = '55555555-5555-4555-8555-555555555555'
const profileId = '33333333-3333-4333-8333-333333333333'

function squash(sql: string) {
  return sql.replace(/\s+/g, ' ')
}

describe('plan visibility rule', () => {
  it('judges organization items by the organization plan and personal items by the poster’s plan', () => {
    const jobs = squash(planVisibleSql('job', 'j'))
    expect(jobs).toContain('when j.company_id is not null then')
    expect(jobs).toContain('.company_id = j.company_id')
    expect(jobs).toContain('.profile_id = j.created_by_user_id')
    expect(jobs).toContain("capability = 'job.publish'")
    expect(squash(planVisibleSql('event', 'e'))).toContain('.profile_id = e.host_user_id')
    expect(squash(planVisibleSql('course', 'course'))).toContain("capability = 'course.publish'")
  })

  it('shows items while the plan is current (period not over), with a direct grant, or when the owner never paid', () => {
    const sql = squash(planVisibleSql('event', 'e'))
    // current plan, checked at read time: an ended period hides items at once
    expect(sql).toContain("status in ('trialing', 'active', 'past_due')")
    expect(sql).toContain('current_period_ends_at is null or')
    expect(sql).toContain('current_period_ends_at > now()')
    // admin / legacy grants keep items live
    expect(sql).toContain('from public.entitlement_grants')
    expect(sql).toContain('revoked_at is null')
    // owners who never had a paid plan keep their items (only a hidden stamp would hide them)
    expect(sql).toContain("status <> 'pending'")
    expect(sql).toContain('e.hidden_for_plan_at is null and not exists')
  })

  it('refuses an unsafe table alias', () => {
    expect(() => planVisibleSql('job', 'j; drop table jobs')).toThrow('plan_visibility_alias_invalid')
  })
})

describe('syncing hidden_for_plan_at', () => {
  it('hides and restores one organization’s jobs, events and courses', async () => {
    const run = vi.fn(async (sql: string) => (sql.includes('set hidden_for_plan_at = now()') ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }]))
    await expect(syncPlanContentVisibility({ kind: 'company', companyId }, run)).resolves.toEqual({ hidden: 6, restored: 3 })
    expect(run).toHaveBeenCalledTimes(6)
    const statements = run.mock.calls.map(([sql]) => squash(sql))
    expect(statements.filter((sql) => sql.startsWith('update public.jobs item'))).toHaveLength(2)
    expect(statements.filter((sql) => sql.startsWith('update public.events item'))).toHaveLength(2)
    expect(statements.filter((sql) => sql.startsWith('update public.learning_courses item'))).toHaveLength(2)
    for (const [sql, values] of run.mock.calls as unknown as Array<[string, unknown[]]>) {
      expect(squash(sql)).toContain('item.company_id = $1::uuid')
      expect(values).toEqual([companyId])
    }
    const hide = statements.find((sql) => sql.includes('set hidden_for_plan_at = now()'))!
    expect(hide).toContain('item.hidden_for_plan_at is null and not')
    const restore = statements.find((sql) => sql.includes('set hidden_for_plan_at = null'))!
    expect(restore).toContain('item.hidden_for_plan_at is not null and')
  })

  it('only touches a member’s personal items (never items posted as an organization)', async () => {
    const run = vi.fn(async () => [])
    await syncPlanContentVisibility({ kind: 'profile', profileId }, run)
    const calls = run.mock.calls as unknown as Array<[string, unknown[]]>
    const jobs = squash(calls[0]![0])
    expect(jobs).toContain('item.company_id is null and item.created_by_user_id = $1::uuid')
    const events = squash(calls[2]![0])
    expect(events).toContain('item.company_id is null and item.host_user_id = $1::uuid')
    expect(calls.every(([, values]) => values[0] === profileId)).toBe(true)
  })

  it('syncs every owner at once for the billing sweep', async () => {
    const run = vi.fn(async () => [])
    await syncPlanContentVisibility(null, run)
    const calls = run.mock.calls as unknown as Array<[string, unknown[]]>
    expect(calls).toHaveLength(6)
    expect(calls.every(([sql, values]) => squash(sql).includes('where true') && values.length === 0)).toBe(true)
  })
})

describe('owner banner copy', () => {
  it('sends organization items to Organization Pro and personal items to Creator Pro', () => {
    expect(PLAN_HIDDEN_MESSAGE).toBe('Hidden because your plan ended — renew to restore')
    expect(planRenewHref({ companyId })).toBe(`/settings/billing/organizations/${companyId}?plan=organization_pro#organization-pro`)
    expect(planRenewHref({ companyId: null })).toBe(CREATOR_PRO_CHECKOUT_HREF)
  })
})
