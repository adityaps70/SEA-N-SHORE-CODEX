import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationPath = 'infra/aws/database/migrations/0047_course_payment_orders.sql'
const sql = () => readFileSync(resolve(root, migrationPath), 'utf8')
const repository = () => readFileSync(resolve(root, 'src/features/learning/course-payment-repository.ts'), 'utf8')

function statements(text: string) {
  return text
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

describe('paid course orders schema (migration 0047)', () => {
  it('is the only 0047 migration and is additive and safe to run twice', () => {
    expect(existsSync(resolve(root, migrationPath))).toBe(true)
    expect(readdirSync(resolve(root, 'infra/aws/database/migrations')).filter((name) => name.startsWith('0047_'))).toEqual(['0047_course_payment_orders.sql'])
    const parts = statements(sql())
    expect(parts.length).toBe(8)
    for (const statement of parts) {
      expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
      expect(statement).toMatch(/^(create table if not exists public\.course_payment_orders\b|create (unique )?index if not exists [a-z0-9_]+\s+on public\.|alter table public\.learning_enrollments\s+add column if not exists )/i)
      expect(statement).not.toMatch(/\b(drop\s+(table|column|type|index|constraint)|truncate|delete\s+from|update\s+public\.)\b/i)
    }
  })

  it('mirrors event payment orders: learner, course, price snapshot, provider ids, status and refund columns', () => {
    const table = statements(sql())[0]!
    for (const column of [
      'course_id uuid references public.learning_courses(id) on delete set null',
      'profile_id uuid references public.profiles(id) on delete set null',
      'list_price_minor bigint not null check (list_price_minor > 0)',
      'discount_price_minor bigint',
      'amount_minor bigint not null check (amount_minor > 0)',
      "currency text not null check (currency in ('INR', 'USD'))",
      "provider text not null check (provider in ('razorpay', 'cashfree'))",
      'provider_order_id text',
      'provider_payment_id text',
      'provider_session_id text',
      "status text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded', 'cancelled'))",
      'enrollment_id uuid references public.learning_enrollments(id) on delete set null',
      'enrollment_confirmed_at timestamptz',
      'refund_due_reason text',
      'paid_at timestamptz',
      'refunded_at timestamptz',
      'refund_status text',
      'refund_attempts integer not null default 0',
      'provider_refund_id text',
      'refund_requested_at timestamptz',
      'refund_requested_by uuid references public.profiles(id) on delete set null',
      'created_at timestamptz not null default now()',
      'updated_at timestamptz not null default now()',
    ]) {
      expect(table).toContain(column)
    }
    expect(table).toContain('amount_minor = coalesce(discount_price_minor, list_price_minor)')
    expect(table).toContain("refund_status in ('requested', 'pending', 'processed', 'failed')")
  })

  it('makes checkout callbacks and webhooks idempotent with unique keys', () => {
    const text = sql()
    expect(text).toMatch(/create unique index if not exists course_payment_orders_provider_order_key\s+on public\.course_payment_orders \(provider_order_id\)\s+where provider_order_id is not null;/)
    expect(text).toMatch(/create unique index if not exists course_payment_orders_provider_payment_key\s+on public\.course_payment_orders \(provider, provider_payment_id\)\s+where provider_payment_id is not null;/)
    expect(text).toMatch(/create unique index if not exists course_payment_orders_open_checkout_key\s+on public\.course_payment_orders \(course_id, profile_id\)\s+where status = 'created';/)
  })

  it('links a purchased enrollment to its order so a refund ends exactly that access', () => {
    expect(sql()).toContain('add column if not exists payment_order_id uuid references public.course_payment_orders(id) on delete set null')
    expect(repository()).toContain("set status = 'revoked', revoked_at = now(), updated_at = now()\n      where payment_order_id = $1::uuid")
  })

  it('is what the repository reads and writes', () => {
    const table = statements(sql())[0]!
    const columns = /const ORDER_COLUMNS = `([^`]+)`/.exec(repository())![1]!
      .split(',')
      .map((column) => column.trim().replace(/^o\./, ''))
      .filter(Boolean)
    expect(columns.length).toBeGreaterThan(20)
    for (const column of columns) expect(table, column).toMatch(new RegExp(`\\b${column} `))
  })
})
