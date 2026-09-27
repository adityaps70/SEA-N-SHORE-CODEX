import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationPath = 'infra/aws/database/migrations/0049_seller_payouts.sql'
const sql = () => readFileSync(resolve(root, migrationPath), 'utf8')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

function statements(text: string) {
  return text
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

describe('seller payouts schema (migration 0049)', () => {
  it('is the only 0049 migration, additive and safe to run twice', () => {
    expect(existsSync(resolve(root, migrationPath))).toBe(true)
    expect(readdirSync(resolve(root, 'infra/aws/database/migrations')).filter((name) => name.startsWith('0049_'))).toEqual(['0049_seller_payouts.sql'])
    const parts = statements(sql())
    expect(parts.length).toBeGreaterThanOrEqual(15)
    for (const statement of parts) {
      expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
      expect(statement).toMatch(/^(create table if not exists public\.|create (unique )?index if not exists [a-z0-9_]+\s+on public\.|insert into public\.payout_settings|do \$\$)/i)
      expect(statement).not.toMatch(/\b(drop\s+(table|column|type|index|constraint)|truncate|delete\s+from|update\s+public\.)\b/i)
    }
    expect(sql()).toContain('on conflict (id) do nothing')
    // The foreign key is only added when missing, and is not validated against old rows.
    expect(sql()).toMatch(/if not exists \(\s*select 1 from pg_constraint\s+where conname = 'seller_earnings_payout_id_fkey'/)
    expect(sql()).toContain('foreign key (payout_id) references public.payouts(id) on delete restrict')
    expect(sql()).toContain('not valid')
  })

  it('stores payout details masked: IFSC and last 4 digits only, never the full account number', () => {
    const text = sql()
    expect(text).toContain('create table if not exists public.payout_accounts')
    expect(text).toContain("bank_account_last4 text check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$')")
    expect(text).not.toMatch(/bank_account_number|account_number text/)
    expect(text).toContain("method text not null check (method in ('bank', 'upi'))")
    expect(text).toContain("status text not null default 'active' check (status in ('active', 'removed'))")
    expect(text).toContain('(seller_profile_id is null) <> (seller_company_id is null)')
    expect(text).toMatch(/payout_accounts_active_profile_key\s+on public\.payout_accounts \(seller_profile_id\)\s+where status = 'active'/)
    expect(text).toMatch(/payout_accounts_active_company_key\s+on public\.payout_accounts \(seller_company_id\)\s+where status = 'active'/)
  })

  it('makes payouts idempotent: unique transfer id, one open payout per seller, one active payout per earning', () => {
    const text = sql()
    expect(text).toContain("status in ('draft', 'processing', 'success', 'failed', 'reversed', 'cancelled')")
    expect(text).toContain('amount_minor bigint not null check (amount_minor > 0)')
    expect(text).toMatch(/payouts_transfer_key\s+on public\.payouts \(provider, transfer_id\)/)
    expect(text).toMatch(/payouts_open_profile_key\s+on public\.payouts \(seller_profile_id\)\s+where status in \('draft', 'processing'\)/)
    expect(text).toMatch(/payouts_open_company_key\s+on public\.payouts \(seller_company_id\)\s+where status in \('draft', 'processing'\)/)
    expect(text).toMatch(/payout_items_active_earning_key\s+on public\.payout_items \(earning_id\)\s+where active/)
    expect(text).toContain('min_payout_minor bigint not null default 10000')
  })

  it('matches what the application code reads and writes', () => {
    const repository = source('src/features/payouts/payout-repository.ts')
    for (const column of [
      'account_holder_name', 'bank_ifsc', 'bank_account_last4', 'upi_vpa', 'provider_beneficiary_id', 'provider_verified', 'removed_at', 'removed_by',
      'payout_account_id', 'transfer_id', 'transfer_mode', 'cf_transfer_id', 'provider_status_code', 'utr', 'failure_reason', 'dispatch_attempts',
      'last_dispatch_at', 'approved_by', 'approved_at', 'sent_at', 'completed_at', 'last_checked_at', 'released_at', 'min_payout_minor',
    ]) {
      expect(repository, column).toContain(column)
      expect(sql(), column).toContain(column)
    }
  })
})
