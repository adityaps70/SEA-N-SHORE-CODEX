import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')
const migrationPath = 'infra/aws/database/migrations/0035_event_pricing_payments.sql'

function statements(sql: string) {
  return sql
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

describe('event pricing and payments schema (migration 0035)', () => {
  it('ships one additive, re-runnable migration', () => {
    expect(existsSync(resolve(root, migrationPath))).toBe(true)
    const sql = source(migrationPath)
    const parts = statements(sql)
    expect(parts.length).toBeGreaterThanOrEqual(12)
    for (const statement of parts) {
      expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
      expect(statement).toMatch(/^(alter table public\.(events|event_attendees)\b|create table if not exists public\.|create (unique )?index if not exists [a-z0-9_]+\s+on public\.|do \$\$)/i)
      expect(statement).not.toMatch(/\b(drop\s+(table|column|type)|truncate|delete\s+from)\b/i)
    }
  })

  it('adds explicit pricing to events and only enforces access details once published', () => {
    const sql = source(migrationPath)
    expect(sql).toContain('add column if not exists is_paid boolean not null default false')
    expect(sql).toContain('add column if not exists price_minor bigint')
    expect(sql).toContain('add column if not exists currency text')
    expect(sql).toContain("currency in ('INR', 'USD')")
    expect(sql).toContain('events_published_pricing_check')
    expect(sql).toContain('events_published_access_check')
    expect(sql).toContain("status <> 'published'")
  })

  it('makes payment orders and webhook deliveries idempotent with unique keys', () => {
    const sql = source(migrationPath)
    expect(sql).toContain('create table if not exists public.event_payment_orders')
    expect(sql).toContain("status in ('created', 'paid', 'failed', 'refunded', 'cancelled')")
    expect(sql).toContain('on public.event_payment_orders (provider, provider_order_id)')
    expect(sql).toContain('on public.event_payment_orders (provider, provider_payment_id)')
    expect(sql).toContain("where status = 'created'")
    expect(sql).toContain('create table if not exists public.payment_webhook_events')
    expect(sql).toContain('primary key (provider, provider_event_id)')
    expect(sql).toContain('add column if not exists payment_order_id uuid references public.event_payment_orders(id)')
  })
})

describe('in-platform event payment flow contract', () => {
  it('keeps secrets on the server and loads Checkout only when a payment starts', () => {
    const loader = source('src/features/payments/components/load-razorpay-checkout.ts')
    expect(loader).toContain('https://checkout.razorpay.com/v1/checkout.js')
    expect(source('src/app/layout.tsx')).not.toContain('checkout.razorpay.com')
    const button = source('src/features/payments/components/event-checkout-button.tsx')
    expect(button).not.toMatch(/keySecret|webhookSecret|RAZORPAY_KEY_SECRET/)
    expect(source('src/features/payments/event-payment-actions.ts')).toContain("'use server'")
  })

  it('verifies the raw webhook body before parsing it', () => {
    const route = source('src/app/api/payments/razorpay/webhook/route.ts')
    expect(route).toContain('await request.text()')
    expect(route).toContain('x-razorpay-signature')
    expect(route).toContain('x-razorpay-event-id')
    const service = source('src/features/payments/event-payment-service.ts')
    expect(service.indexOf('verifyWebhookSignature')).toBeLessThan(service.indexOf('JSON.parse(input.rawBody)'))
  })

  it('shows paid registration, organiser payouts notice and not-configured states on event pages', () => {
    const detail = source('src/app/(app)/events/[eventId]/page.tsx')
    expect(detail).toContain('EventCheckoutButton')
    expect(detail).toContain('arePaymentsConfigured')
    expect(detail).toContain('Paid registrations')
    const registrations = source('src/app/(app)/events/[eventId]/registrations/page.tsx')
    expect(registrations).toContain('listEventPaymentsForManager')
    expect(registrations).toContain('handled by the Sea N Shore team outside the site for now')
    expect(registrations).toContain('viewerIsHost')
    expect(source('src/features/events/components/attendance-control.tsx')).toContain('Paid')
  })
})
