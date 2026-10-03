import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { createNewsletterRepository } from './repository'

const id = '11111111-1111-4111-8111-111111111111'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id,
    email: 'crew@example.com',
    profile_id: null,
    status: 'pending',
    topics: ['product_updates'],
    source: 'newsletter_page',
    consent_text_version: '2026-09-27',
    consented_at: new Date('2026-09-27T10:00:00Z'),
    confirmed_at: null,
    confirmation_sent_at: null,
    unsubscribed_at: null,
    ses_sync_status: 'not_required',
    ses_sync_attempts: 0,
    ses_sync_error: null,
    ses_synced_at: null,
    created_at: new Date('2026-09-27T10:00:00Z'),
    updated_at: new Date('2026-09-27T10:00:00.123Z'),
    ...overrides,
  }
}

type Call = { text: string; values: readonly unknown[] }

function fakeDatabase(respond: (text: string, values: readonly unknown[]) => unknown[]) {
  const calls: Call[] = []
  const client = {
    query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values })
      return { rows: respond(text, values) }
    }),
  }
  const repository = createNewsletterRepository({
    query: (async (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values })
      return respond(text, values)
    }) as never,
    withTransaction: (async (fn: (c: typeof client) => Promise<unknown>) => fn(client)) as never,
  })
  return { calls, repository }
}

const context = { source: 'newsletter_page' as const, ipHash: 'a'.repeat(32), userAgentSummary: 'Chrome on Android', consentTextVersion: '2026-09-27' }

describe('newsletter repository', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores a new, unverified signup as pending with an append-only consent event and no SES sync', async () => {
    const { calls, repository } = fakeDatabase((text, values) => {
      if (text.includes('for update')) return []
      if (text.startsWith('insert into public.newsletter_subscribers')) return [row({ status: values[2], ses_sync_status: values[6] })]
      return []
    })

    const result = await repository.recordSignup({ email: 'crew@example.com', topics: ['product_updates'], profileId: 'p1', ownershipVerified: false, context })

    expect(result.outcome).toBe('confirmation_required')
    const insert = calls.find((call) => call.text.startsWith('insert into public.newsletter_subscribers'))!
    expect(insert.values.slice(0, 3)).toEqual(['crew@example.com', null, 'pending'])
    expect(insert.values[6]).toBe('not_required')
    const events = calls.filter((call) => call.text.includes('newsletter_consent_events'))
    expect(events).toHaveLength(1)
    expect(events[0].values).toEqual([id, 'subscribe_requested', ['product_updates'], '2026-09-27', 'newsletter_page', null, 'a'.repeat(32), 'Chrome on Android'])
  })

  it('subscribes the verified owner at once, links the profile and queues SES sync', async () => {
    const { calls, repository } = fakeDatabase((text, values) => {
      if (text.includes('for update')) return []
      if (text.startsWith('insert into public.newsletter_subscribers')) return [row({ status: values[2], profile_id: values[1], ses_sync_status: values[6] })]
      return []
    })

    const result = await repository.recordSignup({ email: 'crew@example.com', topics: ['jobs_digest'], profileId: 'p1', ownershipVerified: true, context })

    expect(result.outcome).toBe('subscribed')
    expect(result.subscriber).toMatchObject({ status: 'subscribed', profileId: 'p1', sesSyncStatus: 'pending' })
    expect(calls.filter((call) => call.text.includes('newsletter_consent_events')).map((call) => call.values[1])).toEqual(['subscribe_requested', 'subscribe_confirmed'])
  })

  it('treats a repeat signup for a subscribed address as a duplicate and records it without changes', async () => {
    const { calls, repository } = fakeDatabase((text) => (text.includes('where email = $1 for update') ? [row({ status: 'subscribed' })] : []))

    const result = await repository.recordSignup({ email: 'crew@example.com', topics: ['jobs_digest'], profileId: null, ownershipVerified: false, context })

    expect(result.outcome).toBe('already_subscribed')
    expect(calls.some((call) => call.text.startsWith('update public.newsletter_subscribers'))).toBe(false)
    expect(calls.find((call) => call.text.includes('newsletter_consent_events'))?.values[1]).toBe('duplicate_signup')
  })

  it('unsubscribes, queues SES sync for previously confirmed contacts and audits admin actions', async () => {
    const { calls, repository } = fakeDatabase((text, values) => {
      if (text.includes('where id = $1 for update')) return [row({ status: 'subscribed', confirmed_at: new Date(), ses_sync_status: 'synced' })]
      if (text.startsWith('update public.newsletter_subscribers')) return [row({ status: 'unsubscribed', ses_sync_status: values[1] })]
      return []
    })

    const result = await repository.unsubscribe(id, { source: 'admin', actorProfileId: 'admin-1' })

    expect(result.outcome).toBe('unsubscribed')
    expect(result.subscriber?.sesSyncStatus).toBe('pending')
    expect(calls.find((call) => call.text.includes('newsletter_consent_events'))?.values[1]).toBe('unsubscribed')
    expect(calls.find((call) => call.text.includes('audit_events'))?.values).toEqual(['admin-1', id])
  })

  it('never overwrites a newer change when recording an SES sync result', async () => {
    const { calls, repository } = fakeDatabase(() => [])
    await expect(repository.markSynced(id, '2026-09-27T10:00:00.123Z')).resolves.toBe(false)
    await repository.markSyncFailed(id, '2026-09-27T10:00:00.123Z', 'TooManyRequestsException: slow down')
    for (const call of calls) expect(call.text).toContain("date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)")
    expect(calls[1].text).toContain("ses_sync_status = 'failed'")
    expect(calls[1].text).toContain('ses_next_attempt_at = now() + make_interval')
  })

  it('escapes LIKE wildcards in admin search', async () => {
    const { calls, repository } = fakeDatabase((text) => (text.includes('count(*)') ? [{ count: 0 }] : []))
    await repository.search({ q: '100%_Crew', status: 'subscribed', topic: 'jobs_digest' })
    expect(calls[0].values).toEqual(['%100\\%\\_crew%', 'subscribed', 'jobs_digest'])
  })
})
