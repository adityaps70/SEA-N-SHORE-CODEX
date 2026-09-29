import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BILLING_INTERVALS, PAID_PLAN_CODES, PLAN_PRICES, TRIAL_MONTHS, addInterval, formatRupeesShort, intervalSaving, trialEndsAt } from './plans'

const root = process.cwd()
const pricesMigration = 'infra/aws/database/migrations/0053_plan_prices_half_year_trials.sql'
const notificationMigration = 'infra/aws/database/migrations/0054_plan_trial_notification.sql'
const sql = (path: string) => readFileSync(resolve(root, path), 'utf8')

function statements(text: string) {
  return text
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

describe('round 9A plan prices: one source of truth', () => {
  it('lists the owner-approved prices in paise', () => {
    expect(PLAN_PRICES).toEqual({
      creator_pro: { month: 9900, year: 99900 },
      organization_pro: { month: 199900, half_year: 1000000, year: 1499900 },
    })
    expect(formatRupeesShort(PLAN_PRICES.creator_pro.month!)).toBe('₹99')
    expect(formatRupeesShort(PLAN_PRICES.organization_pro.half_year!)).toBe('₹10,000')
    expect(formatRupeesShort(PLAN_PRICES.organization_pro.year!)).toBe('₹14,999')
  })

  it('seeds the database from exactly the same list, and retires every other active price', () => {
    const text = sql(pricesMigration)
    const seeded: string[] = []
    for (const plan of PAID_PLAN_CODES) {
      for (const interval of BILLING_INTERVALS) {
        const amount = PLAN_PRICES[plan][interval]
        if (amount === undefined) continue
        seeded.push(`('${plan}'::text, '${interval}'::text, ${amount}::bigint)`)
        expect(text).toContain(`('${plan}'::text, '${interval}'::text, ${amount}::bigint)`)
        expect(text).toContain(`('${plan}', '${interval}', ${amount}::bigint)`)
      }
    }
    // No extra seed rows beyond the list.
    expect(text.match(/::text, '[a-z_]+'::text, \d+::bigint\)/g)).toHaveLength(seeded.length)
    expect(text).toContain('set active = false')
    expect(text).toContain('and existing.active')
    expect(text).toContain("billing_interval in ('month', 'half_year', 'year')")
  })

  it('is the only 0053 / 0054 migration, split into statements the guard accepts', () => {
    const names = readdirSync(resolve(root, 'infra/aws/database/migrations'))
    expect(names.filter((name) => name.startsWith('0053_'))).toEqual(['0053_plan_prices_half_year_trials.sql'])
    expect(names.filter((name) => name.startsWith('0054_'))).toEqual(['0054_plan_trial_notification.sql'])
    expect(existsSync(resolve(root, 'scripts/aws/round-9a-migration.sh'))).toBe(true)
    expect(readFileSync(resolve(root, 'scripts/aws/round-9a-migration-action.txt'), 'utf8').trim()).toBe('plan')
    for (const path of [pricesMigration, notificationMigration]) {
      for (const statement of statements(sql(path))) {
        expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
        expect(statement).not.toMatch(/\b(drop\s+(table|column|type|schema)|truncate|delete\s+from|concurrently)\b/i)
      }
    }
    expect(sql(notificationMigration)).toContain("add value if not exists 'plan_trial_ending'")
  })

  it('remembers one trial per member and per organization, ever', () => {
    const text = sql(pricesMigration)
    expect(text).toContain('create table if not exists public.plan_trials')
    expect(text).toContain('create unique index if not exists plan_trials_profile_uq')
    expect(text).toContain('create unique index if not exists plan_trials_company_uq')
    expect(text).toContain("(profile_id is not null and company_id is null and plan_code = 'creator_pro')")
    expect(text).toContain("ended_reason in ('expired', 'converted', 'admin_ended')")
  })
})

describe('half-yearly interval and free trial lengths', () => {
  it('adds six calendar months for the half-yearly interval', () => {
    expect(BILLING_INTERVALS).toEqual(['month', 'half_year', 'year'])
    expect(addInterval(new Date('2026-08-31T06:00:00Z'), 'half_year').toISOString()).toBe('2027-02-28T06:00:00.000Z')
    expect(addInterval(new Date('2026-10-15T06:00:00Z'), 'half_year').toISOString()).toBe('2027-04-15T06:00:00.000Z')
  })

  it('shows what the half-yearly and yearly prices save against monthly payments', () => {
    expect(intervalSaving(199900, 1000000, 'half_year')).toEqual({ savingMinor: 199400, monthlyTotalMinor: 1199400, monthsFree: 0, months: 6 })
    expect(intervalSaving(199900, 1499900, 'year')).toEqual({ savingMinor: 898900, monthlyTotalMinor: 2398800, monthsFree: 4, months: 12 })
    expect(intervalSaving(9900, 99900, 'year')).toEqual({ savingMinor: 18900, monthlyTotalMinor: 118800, monthsFree: 1, months: 12 })
    expect(intervalSaving(9900, 9900, 'month')).toBeNull()
  })

  it('gives Creator Pro 3 free months and Organization Pro 2', () => {
    expect(TRIAL_MONTHS).toEqual({ creator_pro: 3, organization_pro: 2 })
    expect(trialEndsAt(new Date('2026-11-30T06:00:00Z'), 'creator_pro').toISOString()).toBe('2027-02-28T06:00:00.000Z')
    expect(trialEndsAt(new Date('2026-10-01T06:00:00Z'), 'organization_pro').toISOString()).toBe('2026-12-01T06:00:00.000Z')
  })
})
