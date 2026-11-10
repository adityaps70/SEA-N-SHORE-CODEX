import { describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { finalReminderPauseReason } from './final-reminder-repository'
import { createLegacyLiveCounts, LIVE_COUNT_SQL, liveCount } from './live-counts'
import { legacyFinalReminderTestVariant, LEGACY_FINAL_REMINDER_TEST_CATEGORY } from './final-reminder-test'
import { createLegacyReminderTestSender } from './reminder-test'
import { TEST_SEND_CATEGORIES, suppressionReasonFor } from '@/features/email-delivery/events'

describe('final reminder auto-pause thresholds', () => {
  it('pauses only above 0.1% complaints or above 3% bounces, never at them', () => {
    expect(finalReminderPauseReason({ sent: 0, bounced: 0, complained: 0 })).toBeNull()
    expect(finalReminderPauseReason({ sent: 1000, bounced: 0, complained: 1 })).toBeNull()
    expect(finalReminderPauseReason({ sent: 1000, bounced: 0, complained: 2 })).toBe('Complaint rate 0.20% is above 0.1% (2 of 1000 sent)')
    expect(finalReminderPauseReason({ sent: 1000, bounced: 30, complained: 0 })).toBeNull()
    expect(finalReminderPauseReason({ sent: 1000, bounced: 31, complained: 0 })).toBe('Bounce rate 3.10% is above 3% (31 of 1000 sent)')
    expect(finalReminderPauseReason({ sent: 100, bounced: 3, complained: 0 })).toBeNull()
    expect(finalReminderPauseReason({ sent: 100, bounced: 4, complained: 0 })).not.toBeNull()
    expect(finalReminderPauseReason({ sent: 1, bounced: 0, complained: 1 })).not.toBeNull()
  })
})

describe('live counts for the final reminder', () => {
  it('reads each count from the database and leaves out 0 or a failed query', async () => {
    const query = vi.fn(async (sql: string): Promise<QueryResultRow[]> => {
      if (sql === LIVE_COUNT_SQL.openJobs) return [{ count: '57' }]
      if (sql === LIVE_COUNT_SQL.courses) return [{ count: '0' }]
      throw new Error('relation does not exist')
    })
    await expect(createLegacyLiveCounts({ query: query as never }).read()).resolves.toEqual({ openJobs: 57, courses: null, upcomingEvents: null })
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('accepts only positive whole counts', () => {
    expect(liveCount('12')).toBe(12)
    expect(liveCount(0)).toBeNull()
    expect(liveCount(null)).toBeNull()
    expect(liveCount('nope')).toBeNull()
    expect(liveCount(-3)).toBeNull()
  })

  it('counts live jobs, listed courses and events that have not ended', () => {
    expect(LIVE_COUNT_SQL.openJobs).toMatch(/j\.status = 'published'/)
    expect(LIVE_COUNT_SQL.openJobs).toMatch(/j\.deleted_at is null/)
    expect(LIVE_COUNT_SQL.courses).toMatch(/course\.status = 'published'/)
    expect(LIVE_COUNT_SQL.courses).toMatch(/course\.removed_at is null/)
    expect(LIVE_COUNT_SQL.upcomingEvents).toMatch(/e\.status = 'published'/)
    expect(LIVE_COUNT_SQL.upcomingEvents).toMatch(/e\.end_at > now\(\)/)
  })
})

describe('final reminder "Send test to me"', () => {
  it('sends the exact final reminder with [TEST], live counts and test links, under its own audit actions and tag', async () => {
    const inside: Array<{ sql: string; values?: readonly unknown[] }> = []
    const query = vi.fn(async (sql: string): Promise<QueryResultRow[]> => (sql.includes('identity_accounts') ? [{ found: 1 }] : []))
    const transaction = async <T,>(work: (run: (sql: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) => Promise<T>) =>
      work(async (sql, values) => {
        inside.push({ sql, values })
        return sql.includes('count(*)') ? [{ count: 0 }] : []
      })
    const sendEmail = vi.fn<(input: Record<string, unknown>) => Promise<{ messageId: string }>>(async () => ({ messageId: 'resend-test-1' }))
    const counts = { read: vi.fn(async () => ({ openJobs: 9, courses: null, upcomingEvents: null })) }
    const sender = createLegacyReminderTestSender({
      query,
      transaction,
      resend: { sendEmail },
      siteUrl: 'https://seanshore.in',
      variant: legacyFinalReminderTestVariant(counts),
    })

    await expect(sender.send({ id: '00000000-0000-4000-8000-000000000001', email: 'me@example.test' })).resolves.toEqual({ status: 'sent', to: 'me@example.test' })
    const sent = sendEmail.mock.calls[0]![0]
    expect(sent).toMatchObject({
      from: 'Sea N Shore <accounts@mail.seanshore.in>',
      to: 'me@example.test',
      subject: '[TEST] Last reminder: your Sea N Shore profile is still waiting',
      tags: [{ name: 'category', value: 'legacy_profile_final_reminder_test' }],
    })
    expect(String(sent.idempotencyKey)).toMatch(/^legacy-profile-final-reminder-test\//)
    expect(String(sent.text)).toContain('Verified jobs: 9 open right now')
    expect(String(sent.text)).toContain('https://seanshore.in/email/legacy/test-link')
    expect(inside[0]!.values).toEqual(['legacy-final-reminder-test:00000000-0000-4000-8000-000000000001'])
    expect(inside[2]!.values![1]).toBe('legacy_final_reminder.test_requested')
  })

  it('never puts the recipient of a test on the do-not-email list', () => {
    expect(TEST_SEND_CATEGORIES).toContain(LEGACY_FINAL_REMINDER_TEST_CATEGORY)
    expect(suppressionReasonFor({ type: 'complained', bounceType: null, category: LEGACY_FINAL_REMINDER_TEST_CATEGORY })).toBeNull()
    expect(suppressionReasonFor({ type: 'complained', bounceType: null, category: 'legacy_profile_final_reminder' })).toBe('complaint')
  })
})
