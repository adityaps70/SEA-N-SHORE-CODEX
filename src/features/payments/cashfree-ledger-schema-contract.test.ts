import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationPath = 'infra/aws/database/migrations/0046_cashfree_gateway_seller_earnings.sql'
const sql = () => readFileSync(resolve(root, migrationPath), 'utf8')

function statements(text: string) {
  return text
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

describe('Cashfree gateway and seller earnings schema (migration 0046)', () => {
  it('is the only 0046 migration and is additive and safe to run twice', () => {
    expect(existsSync(resolve(root, migrationPath))).toBe(true)
    expect(readdirSync(resolve(root, 'infra/aws/database/migrations')).filter((name) => name.startsWith('0046_'))).toEqual(['0046_cashfree_gateway_seller_earnings.sql'])
    const parts = statements(sql())
    expect(parts.length).toBeGreaterThanOrEqual(15)
    for (const statement of parts) {
      expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
      expect(statement).toMatch(/^(alter table public\.(event_payment_orders|payment_webhook_events)\b|create table if not exists public\.|create (unique )?index if not exists [a-z0-9_]+\s+on public\.|insert into public\.platform_fee_settings)/i)
      expect(statement).not.toMatch(/\b(drop\s+(table|column|type|index)|truncate|delete\s+from|update\s+public\.)\b/i)
      if (/^alter table/i.test(statement)) {
        expect(statement).not.toMatch(/add column (?!if not exists)/i)
        const drops = statement.match(/drop constraint (?!if exists)\w+/gi) ?? []
        expect(drops, 'constraints are dropped only with "if exists"').toEqual([])
      }
    }
    expect(sql()).toContain('on conflict (id) do nothing')
  })

  it('lets the 0035 payment tables record Cashfree orders and webhook deliveries', () => {
    const text = sql()
    expect(text).toContain("drop constraint if exists event_payment_orders_provider_check")
    expect(text).toContain("add constraint event_payment_orders_provider_check check (provider in ('razorpay', 'cashfree'))")
    expect(text).toContain("drop constraint if exists payment_webhook_events_provider_check")
    expect(text).toContain("add constraint payment_webhook_events_provider_check check (provider in ('razorpay', 'cashfree'))")
    expect(text).toContain('add column if not exists provider_session_id text')
    expect(text).toContain("refund_status in ('requested', 'pending', 'processed', 'failed')")
  })

  it('keeps an append-only audit trail and the checkout phone number', () => {
    const text = sql()
    expect(text).toContain('create table if not exists public.payment_audit_events')
    expect(text).toContain("actor_type in ('system', 'member', 'organizer', 'admin', 'provider')")
    expect(text).toContain('create table if not exists public.payment_customer_contacts')
    expect(text).toContain("phone ~ '^\\+[1-9][0-9]{7,14}$'")
  })

  it('creates the seller earnings ledger with one seller, one row per sale and consistent amounts', () => {
    const text = sql()
    expect(text).toContain('create table if not exists public.platform_fee_settings')
    expect(text).toContain('default_percent numeric(5,2) not null default 10.00 check (default_percent between 0 and 100)')
    expect(text).toContain('hold_days integer not null default 7')
    expect(text).toContain('create table if not exists public.seller_fee_overrides')
    expect(text).toContain('create table if not exists public.seller_earnings')
    expect(text).toContain("source_type in ('event_ticket', 'course_purchase', 'adjustment')")
    expect(text).toContain("status in ('pending', 'available', 'in_payout', 'paid', 'reversed')")
    expect(text).toContain('constraint seller_earnings_source_key unique (source_type, source_id)')
    expect(text).toContain('(seller_profile_id is null) <> (seller_company_id is null)')
    expect(text).toContain('net_minor = gross_minor - platform_fee_minor')
    expect(text).toContain('payout_id uuid,')
    expect(text).toMatch(/on public\.seller_earnings \(available_at\)\s+where status = 'pending'/)
  })

  it('matches what the application code reads and writes', () => {
    const earnings = readFileSync(resolve(root, 'src/features/payments/earnings.ts'), 'utf8')
    for (const column of ['seller_profile_id', 'seller_company_id', 'source_type', 'source_id', 'adjusts_earning_id', 'gross_minor', 'platform_fee_percent', 'platform_fee_minor', 'net_minor', 'available_at', 'reversed_reason']) {
      expect(earnings).toContain(column)
      expect(sql()).toContain(column)
    }
    const repository = readFileSync(resolve(root, 'src/features/payments/event-payment-repository.ts'), 'utf8')
    for (const column of ['provider_session_id', 'refund_status', 'refund_attempts', 'provider_refund_id', 'refund_requested_at', 'refund_requested_by']) {
      expect(repository).toContain(column)
      expect(sql()).toContain(column)
    }
  })
})
