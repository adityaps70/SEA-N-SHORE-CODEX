import { describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createLegacyReminderTestSender } from './reminder-test'

/**
 * The rate limit's concurrency guard. PGlite runs on one connection, so the integration test cannot race two
 * requests; this pins that the per-admin lock is taken inside the same transaction, before the count is read.
 */
describe('send test to me: rate-limit lock', () => {
  it('locks on the admin, then counts and records the request, all in one transaction', async () => {
    const log: Array<{ inTransaction: boolean; sql: string; values?: readonly unknown[] }> = []
    const query = vi.fn(async (sql: string, values?: readonly unknown[]): Promise<QueryResultRow[]> => {
      log.push({ inTransaction: false, sql, values })
      return sql.includes('identity_accounts') ? [{ '?column?': 1 }] : []
    })
    const transaction = async <T,>(work: (run: (sql: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) => Promise<T>) =>
      work(async (sql, values) => {
        log.push({ inTransaction: true, sql, values })
        return sql.includes('count(*)') ? [{ count: 0 }] : []
      })
    const tests = createLegacyReminderTestSender({ query, transaction, resend: { sendEmail: async () => ({ messageId: 'resend-1' }) } })

    await expect(tests.send({ id: '00000000-0000-4000-8000-000000000001', email: 'me@example.test' })).resolves.toEqual({ status: 'sent', to: 'me@example.test' })

    const inside = log.filter((entry) => entry.inTransaction)
    expect(inside.map((entry) => entry.sql.trim().split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'select pg_advisory_xact_lock(hashtextextended($1,',
      'select count(*)::int',
      'insert into',
    ])
    expect(inside[0]!.values).toEqual(['legacy-reminder-test:00000000-0000-4000-8000-000000000001'])
    expect(inside[2]!.values![1]).toBe('legacy_reminder.test_requested')
  })
})
