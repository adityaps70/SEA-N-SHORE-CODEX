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
    expect(source('src/features/payments/components/gateway-checkout.ts')).toContain('https://sdk.cashfree.com/js/v3/cashfree.js')
    expect(source('src/app/layout.tsx')).not.toContain('checkout.razorpay.com')
    expect(source('src/app/layout.tsx')).not.toContain('sdk.cashfree.com')
    for (const file of [
      'src/features/payments/components/event-checkout-button.tsx',
      'src/features/payments/components/gateway-checkout-button.tsx',
      'src/features/payments/components/gateway-checkout.ts',
    ]) {
      expect(source(file)).not.toMatch(/keySecret|webhookSecret|clientSecret|RAZORPAY_KEY_SECRET|CASHFREE_CLIENT_SECRET/)
    }
    expect(source('src/features/payments/event-payment-actions.ts')).toContain("'use server'")
  })

  it('verifies the raw webhook body before parsing it (Razorpay and Cashfree)', () => {
    const route = source('src/app/api/payments/razorpay/webhook/route.ts')
    expect(route).toContain('await request.text()')
    expect(route).toContain('x-razorpay-signature')
    expect(route).toContain('x-razorpay-event-id')
    const service = source('src/features/payments/event-payment-service.ts')
    expect(service.indexOf('gateway.verifyWebhook(input.rawBody')).toBeGreaterThan(-1)
    expect(service.indexOf('gateway.verifyWebhook(input.rawBody')).toBeLessThan(service.indexOf('JSON.parse(input.rawBody)'))

    const cashfreeRoute = source('src/app/api/payments/cashfree/webhook/route.ts')
    expect(cashfreeRoute).toContain('await request.text()')
    const cashfreeWebhook = source('src/features/payments/cashfree-webhook.ts')
    expect(cashfreeWebhook.indexOf('gateway.verifyWebhook(input.rawBody')).toBeGreaterThan(-1)
    expect(cashfreeWebhook.indexOf('gateway.verifyWebhook(input.rawBody')).toBeLessThan(cashfreeWebhook.indexOf('parseCashfreeWebhook(input.rawBody)'))
  })

  it('never marks an order paid from the browser: confirmation always asks the gateway', () => {
    const service = source('src/features/payments/event-payment-service.ts')
    const confirm = service.slice(service.indexOf('async function confirmOrder('), service.indexOf('async function confirmCheckout('))
    expect(confirm).toContain('gateway.confirmOrder(order.providerOrderId, proof)')
    expect(confirm.indexOf('gateway.confirmOrder(')).toBeLessThan(confirm.indexOf("confirmation.status === 'paid'"))
  })

  it('shows paid registration, organiser payouts notice and not-configured states on event pages', () => {
    const detail = source('src/app/(app)/events/[eventId]/page.tsx')
    expect(detail).toContain('EventCheckoutButton')
    expect(detail).toContain('getPaymentCapabilities')
    expect(detail).toContain('CURRENCY_UNAVAILABLE_BUYER_MESSAGE')
    expect(detail).toContain('Paid registrations')
    const registrations = source('src/app/(app)/events/[eventId]/registrations/page.tsx')
    expect(registrations).toContain('listEventPaymentsForManager')
    // Round 5 payouts: organisers track their share in Earnings and set Payout details on the site.
    expect(registrations).toContain('/settings/earnings')
    expect(registrations).toContain('/settings/payouts')
    expect(registrations).toContain('EventRefundButton')
    expect(registrations).toContain('viewerIsHost')
    expect(source('src/features/events/components/attendance-control.tsx')).toContain('Paid')
  })
})
