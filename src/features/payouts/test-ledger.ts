import type { DatabaseQueryClient } from '@/lib/db/client'

/**
 * Test helper: a tiny in-memory stand-in for the payout tables that answers the exact
 * statements payout-repository.ts sends. It lets the state-machine tests check real
 * outcomes (balances, statuses, audit rows) instead of only SQL strings.
 */

type Row = Record<string, unknown>

export type Ledger = {
  accounts: Row[]
  payouts: Row[]
  earnings: Row[]
  items: Row[]
  audits: Row[]
  members: Array<{ company_id: string; user_id: string; role: string }>
  minPayoutMinor: number
}

export const SELLER_ID = '44444444-4444-4444-8444-444444444444'
export const COMPANY_ID = '55555555-5555-4555-8555-555555555555'
export const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
export const ACCOUNT_ID = '66666666-6666-4666-8666-666666666666'

export function earning(id: string, overrides: Row = {}): Row {
  return {
    id,
    seller_profile_id: SELLER_ID,
    seller_company_id: null,
    source_type: 'event_ticket',
    currency: 'INR',
    net_minor: 44910,
    status: 'available',
    payout_id: null,
    created_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

export function account(overrides: Row = {}): Row {
  return {
    id: ACCOUNT_ID,
    seller_profile_id: SELLER_ID,
    seller_company_id: null,
    method: 'bank',
    account_holder_name: 'Arjun Rao',
    bank_ifsc: 'HDFC0000001',
    bank_account_last4: '1772',
    upi_vpa: null,
    provider_beneficiary_id: 'snsb_existing',
    provider_status: 'VERIFIED',
    provider_verified: true,
    status: 'active',
    created_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

function sellerMatches(row: Row, profileId: unknown, companyId: unknown) {
  return (profileId !== null && row.seller_profile_id === profileId) || (companyId !== null && row.seller_company_id === companyId)
}

function payoutRow(values: unknown[]): Row {
  const [id, profileId, companyId, accountId, amount, transferId, mode, approvedBy] = values
  const now = new Date().toISOString()
  return {
    id, seller_profile_id: profileId, seller_company_id: companyId, payout_account_id: accountId, amount_minor: amount, currency: 'INR',
    status: 'draft', transfer_id: transferId, transfer_mode: mode, cf_transfer_id: null, provider_status: null, provider_status_code: null,
    utr: null, failure_reason: null, dispatch_attempts: 1, last_dispatch_at: now, approved_by: approvedBy, approved_at: now, sent_at: null,
    completed_at: null, last_checked_at: null, created_at: now, updated_at: now,
  }
}

export function createLedger(initial: Partial<Ledger> = {}) {
  const ledger: Ledger = {
    accounts: [], payouts: [], earnings: [], items: [], audits: [], members: [], minPayoutMinor: 10000, ...initial,
  }

  const calls: Array<[string, unknown[]]> = []
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push([sql, values])
    const text = sql.replace(/\s+/g, ' ').trim()

    if (text.startsWith('with released as')) return { rows: [{ count: 0 }] }
    if (text.startsWith('insert into public.payment_audit_events')) {
      ledger.audits.push({ actor_type: values[0], actor_profile_id: values[1], subject_type: values[2], subject_id: values[3], action: values[4], from_status: values[5], to_status: values[6], amount_minor: values[7], details: values[11] })
      return { rows: [] }
    }
    if (text.includes('from public.company_members cm where cm.company_id = $1::uuid')) {
      const allowed = ledger.members.some((member) => member.company_id === values[0] && member.user_id === values[1] && ['owner', 'administrator'].includes(member.role))
      return { rows: allowed ? [{ allowed: true }] : [] }
    }
    if (text.startsWith('select min_payout_minor from public.payout_settings')) return { rows: [{ min_payout_minor: ledger.minPayoutMinor }] }

    // payout accounts
    if (text.includes('from public.payout_accounts where status = \'active\' and ((')) {
      return { rows: ledger.accounts.filter((row) => row.status === 'active' && sellerMatches(row, values[0], values[1])).slice(0, 1) }
    }
    if (text.startsWith('select provider_beneficiary_id from public.payout_accounts')) {
      return { rows: ledger.accounts.filter((row) => row.status === 'active' && row.upi_vpa === values[0]).slice(0, 1) }
    }
    if (text.startsWith('select count(*)::int as count from public.payout_accounts')) {
      return { rows: [{ count: ledger.accounts.filter((row) => row.status === 'active' && row.provider_beneficiary_id === values[0] && row.id !== values[1]).length }] }
    }
    if (text.startsWith('update public.payout_accounts set status = \'removed\'')) {
      const row = ledger.accounts.find((candidate) => candidate.id === values[0] && candidate.status === 'active')
      if (row) Object.assign(row, { status: 'removed', removed_by: values[1] })
      return { rows: [] }
    }
    if (text.startsWith('insert into public.payout_accounts')) {
      const row = {
        id: values[0], seller_profile_id: values[1], seller_company_id: values[2], method: values[3], account_holder_name: values[4],
        bank_ifsc: values[5], bank_account_last4: values[6], upi_vpa: values[7], provider_beneficiary_id: values[8], provider_status: values[9],
        provider_verified: values[10], status: 'active', created_by: values[11], created_at: new Date().toISOString(),
      }
      ledger.accounts.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('select id, seller_profile_id') && text.includes('from public.payout_accounts where id = $1::uuid')) {
      return { rows: ledger.accounts.filter((row) => row.id === values[0]) }
    }

    // payouts
    if (text.startsWith('select id from public.payouts where status in (\'draft\', \'processing\')')) {
      return { rows: ledger.payouts.filter((row) => ['draft', 'processing'].includes(String(row.status)) && sellerMatches(row, values[0], values[1])).map((row) => ({ id: row.id })) }
    }
    if (text.includes('from public.payouts where status in (\'draft\', \'processing\') and ((')) {
      return { rows: ledger.payouts.filter((row) => ['draft', 'processing'].includes(String(row.status)) && sellerMatches(row, values[0], values[1])).slice(0, 1) }
    }
    if (text.includes('from public.payouts where id = $1::uuid')) return { rows: ledger.payouts.filter((row) => row.id === values[0]) }
    if (text.startsWith('insert into public.payouts')) {
      if (ledger.payouts.some((row) => row.transfer_id === values[5])) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      const row = payoutRow(values)
      ledger.payouts.push(row)
      return { rows: [row] }
    }
    if (text.startsWith('update public.payouts set dispatch_attempts = dispatch_attempts + 1')) {
      const row = ledger.payouts.find((candidate) => candidate.id === values[0])
      if (!row || row.status !== 'draft') return { rows: [] }
      if (row.last_dispatch_at && Date.parse(String(row.last_dispatch_at)) > Date.parse(String(values[2]))) return { rows: [] }
      Object.assign(row, { dispatch_attempts: Number(row.dispatch_attempts) + 1, last_dispatch_at: values[1] })
      return { rows: [row] }
    }
    if (text.startsWith('update public.payouts set status = $2::text')) {
      const row = ledger.payouts.find((candidate) => candidate.id === values[0])!
      const target = String(values[1])
      Object.assign(row, {
        status: target,
        provider_status: values[2] ?? row.provider_status,
        provider_status_code: values[3] ?? row.provider_status_code,
        cf_transfer_id: values[4] ?? row.cf_transfer_id,
        utr: values[5] ?? row.utr,
        failure_reason: ['failed', 'reversed'].includes(target) ? values[6] : target === 'success' ? null : row.failure_reason,
      })
      return { rows: [row] }
    }
    if (text.startsWith('update public.payouts set utr = $2::text')) {
      const row = ledger.payouts.find((candidate) => candidate.id === values[0])!
      row.utr = values[1]
      return { rows: [row] }
    }
    if (text.startsWith('update public.payouts set failure_reason = $2::text')) {
      const row = ledger.payouts.find((candidate) => candidate.id === values[0] && candidate.status === 'draft')
      if (row) row.failure_reason = values[1]
      return { rows: row ? [row] : [] }
    }
    if (text.startsWith('update public.payouts set status = \'cancelled\'')) {
      const row = ledger.payouts.find((candidate) => candidate.id === values[0] && candidate.status === 'draft')!
      Object.assign(row, { status: 'cancelled', failure_reason: values[1] })
      return { rows: [row] }
    }
    if (text.startsWith('update public.payouts set last_checked_at')) return { rows: [] }

    // earnings
    if (text.startsWith('select id, net_minor from public.seller_earnings')) {
      return { rows: ledger.earnings.filter((row) => sellerMatches(row, values[0], values[1]) && row.status === 'available' && row.currency === 'INR' && !row.payout_id) }
    }
    if (text.startsWith('with items as')) {
      const [payoutId, ids] = values as [string, string[]]
      let changed = 0
      for (const id of ids) {
        ledger.items.push({ payout_id: payoutId, earning_id: id, active: true })
        const row = ledger.earnings.find((candidate) => candidate.id === id)
        if (row && row.status === 'available' && !row.payout_id) {
          Object.assign(row, { status: 'in_payout', payout_id: payoutId })
          changed += 1
          ledger.audits.push({ subject_type: 'seller_earning', subject_id: id, action: 'earning_in_payout' })
        }
      }
      return { rows: [{ items: ids.length, changed }] }
    }
    if (text.startsWith('with changed as ( update public.seller_earnings e set status = \'paid\'')) {
      const rows = ledger.earnings.filter((row) => row.payout_id === values[0] && row.status === 'in_payout')
      for (const row of rows) {
        row.status = 'paid'
        ledger.audits.push({ subject_type: 'seller_earning', subject_id: row.id, action: 'earning_paid' })
      }
      return { rows: [{ count: rows.length }] }
    }
    if (text.startsWith('with target as')) {
      const [payoutId, statuses] = values as [string, string[]]
      const rows = ledger.earnings.filter((row) => row.payout_id === payoutId && statuses.includes(String(row.status)))
      for (const row of rows) {
        Object.assign(row, { status: 'available', payout_id: null })
        ledger.audits.push({ subject_type: 'seller_earning', subject_id: row.id, action: 'earning_released_from_payout' })
      }
      let released = 0
      for (const item of ledger.items) if (item.payout_id === payoutId && item.active) { item.active = false; released += 1 }
      return { rows: [{ count: rows.length, items: released }] }
    }

    throw new Error(`test ledger: unexpected SQL: ${text.slice(0, 160)}`)
  }

  const client = { query } as unknown as DatabaseQueryClient
  const transaction = async <T,>(work: (tx: DatabaseQueryClient) => Promise<T>) => work(client)
  return { ledger, client, transaction, calls }
}
