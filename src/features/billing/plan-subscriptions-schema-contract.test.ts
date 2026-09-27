import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationPath = 'infra/aws/database/migrations/0048_plan_subscriptions_cashfree.sql'
const sql = () => readFileSync(resolve(root, migrationPath), 'utf8')

function statements(text: string) {
  return text
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

describe('plan subscriptions schema (migration 0048)', () => {
  it('is the only 0048 migration and is additive and safe to run twice', () => {
    expect(existsSync(resolve(root, migrationPath))).toBe(true)
    expect(readdirSync(resolve(root, 'infra/aws/database/migrations')).filter((name) => name.startsWith('0048_'))).toEqual(['0048_plan_subscriptions_cashfree.sql'])
    const parts = statements(sql())
    expect(parts.length).toBeGreaterThanOrEqual(12)
    for (const statement of parts) {
      expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
      expect(statement).toMatch(/^(create table if not exists public\.|create (unique )?index if not exists [a-z0-9_]+\s+on public\.|insert into public\.plan_prices)/i)
      expect(statement).not.toMatch(/\b(drop\s+(table|column|type|index)|truncate|delete\s+from|update\s+public\.|alter\s+table)\b/i)
    }
  })

  it('seeds the four owner-approved prices in paise, only when missing', () => {
    const text = sql()
    expect(text).toContain("('creator_pro'::text, 'month'::text, 10000::bigint)")
    expect(text).toContain("('creator_pro'::text, 'year'::text, 100000::bigint)")
    expect(text).toContain("('organization_pro'::text, 'month'::text, 200000::bigint)")
    expect(text).toContain("('organization_pro'::text, 'year'::text, 2000000::bigint)")
    expect(text).toContain('where not exists (')
    expect(text).toContain("currency = 'INR'")
  })

  it('keeps one active price per plan and interval, and prices immutable by design', () => {
    const text = sql()
    expect(text).toContain('create unique index if not exists plan_prices_active_uq')
    expect(text).toContain('on public.plan_prices (plan_code, billing_interval)\n  where active;')
    expect(text).toContain("billing_interval in ('month', 'year')")
    expect(text).toContain('provider_environment')
  })

  it('tracks each Cashfree mandate for exactly one member or organization', () => {
    const text = sql()
    expect(text).toContain('create table if not exists public.subscription_checkouts')
    expect(text).toContain("(profile_id is not null and company_id is null and plan_code = 'creator_pro')")
    expect(text).toContain("(profile_id is null and company_id is not null and plan_code = 'organization_pro')")
    expect(text).toContain('subscription_checkouts_provider_subscription_uq')
    expect(text).toContain("status in ('created', 'pending_approval', 'active', 'on_hold', 'paused', 'failed', 'cancelled', 'ended', 'replaced')")
    expect(text).toContain('paid_through_at timestamptz')
  })

  it('records every mandate payment once, by Cashfree’s ids', () => {
    const text = sql()
    expect(text).toContain('create table if not exists public.subscription_payments')
    expect(text).toContain('subscription_payments_cf_payment_uq')
    expect(text).toContain('on public.subscription_payments (provider, cf_payment_id)')
    expect(text).toContain('subscription_payments_provider_payment_uq')
    expect(text).toContain("payment_type in ('AUTH', 'CHARGE')")
    expect(text).toContain("status in ('pending', 'success', 'failed', 'cancelled')")
    expect(text).toContain('amount_minor bigint not null')
    expect(text).toContain('period_start timestamptz')
  })

  it('reuses account_subscriptions from 0032 for access without changing it', () => {
    const text = sql()
    expect(text).not.toMatch(/alter table public\.account_subscriptions/i)
    const foundation = readFileSync(resolve(root, 'infra/aws/database/migrations/0032_membership_access_foundation.sql'), 'utf8')
    expect(foundation).toContain("status in ('pending', 'trialing', 'active', 'past_due', 'cancelled', 'expired')")
    expect(foundation).toContain('account_subscriptions_profile_active_uq')
    expect(foundation).toContain('account_subscriptions_company_active_uq')
    expect(foundation).toContain('account_subscriptions_provider_subscription_uq')
  })

  it('writes every access change through the ledger with an audit row', () => {
    const ledger = readFileSync(resolve(root, 'src/features/billing/subscription-ledger.ts'), 'utf8')
    expect(ledger).toContain('store.lockSubject')
    expect(ledger).toContain('store.audit(')
    const store = readFileSync(resolve(root, 'src/features/billing/subscription-store.ts'), 'utf8')
    expect(store).toContain('pg_advisory_xact_lock')
    expect(store).toContain('recordPaymentAudit(tx')
  })
})
