import { describe, expect, it, vi } from 'vitest'
import {
  CONNECTION_REQUEST_COOLDOWN,
  CONNECTION_REQUEST_COOLDOWN_CODE,
  SOCIAL_ACTION_EVENT_RETENTION,
  CONNECTION_REQUEST_EVENT_RETENTION,
  SOCIAL_ACTION_PRUNE_BATCH,
  SOCIAL_ACTION_QUOTAS,
  consumeSocialActionQuota,
  createSocialActionQuotasForClient,
  type SocialQuotaQuery,
} from './quotas'
import { messageForErrorCode } from '@/lib/errors/user-messages'

const MEMBER = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'

type Call = { text: string; values: readonly unknown[] }

/** A fake transaction query: answers the lock, usage and insert statements in order. */
function fakeQuery(options: { ready?: boolean; recentTotal?: number; coolingDown?: boolean; failOn?: 'lock' | 'usage' | 'insert'; error?: unknown } = {}) {
  const calls: Call[] = []
  const query = vi.fn<SocialQuotaQuery>(async (text, values = []) => {
    calls.push({ text, values })
    const step = text.includes('pg_advisory_xact_lock') ? 'lock' : text.includes('recent_total') ? 'usage' : 'insert'
    if (options.failOn === step) throw options.error
    if (step === 'lock') return [{ locked: '', ready: options.ready ?? true }]
    if (step === 'usage') return [{ recent_total: options.recentTotal ?? 0, cooling_down: options.coolingDown ?? false }]
    return []
  })
  return { query, calls }
}

function pgError(code: string) {
  return Object.assign(new Error(code === '42P01' ? 'relation "public.social_action_events" does not exist' : 'boom'), { code })
}

describe('social action quota limits', () => {
  it('uses the agreed limits, windows and error codes', () => {
    expect(SOCIAL_ACTION_QUOTAS).toEqual({
      connection_request: { limit: 50, window: '24 hours', code: 'network_connection_request_limit' },
      post: { limit: 20, window: '1 hour', code: 'feed_post_rate_limited' },
      comment: { limit: 120, window: '1 hour', code: 'feed_comment_rate_limited' },
      reaction: { limit: 300, window: '1 hour', code: 'feed_reaction_rate_limited' },
    })
    expect(CONNECTION_REQUEST_COOLDOWN).toBe('7 days')
    expect(CONNECTION_REQUEST_COOLDOWN_CODE).toBe('network_connection_request_cooldown')
    expect(SOCIAL_ACTION_EVENT_RETENTION).toBe('8 days')
    expect(CONNECTION_REQUEST_EVENT_RETENTION).toBe('181 days')
  })

  it('has a friendly shared message for every quota code', () => {
    expect(messageForErrorCode('network_connection_request_limit')).toBe("You've sent a lot of connection requests today. Please try again tomorrow.")
    expect(messageForErrorCode('network_connection_request_cooldown')).toBe('You can send this member a new request 7 days after your last one.')
    expect(messageForErrorCode('feed_post_rate_limited')).toBe("You're posting very quickly. Please wait a little and try again.")
    expect(messageForErrorCode('feed_comment_rate_limited')).toBe("You're commenting very quickly. Please wait a little and try again.")
    expect(messageForErrorCode('feed_reaction_rate_limited')).toBe("You're reacting very quickly. Please wait a little and try again.")
  })
})

describe('consumeSocialActionQuota', () => {
  it('locks per member and action, counts the rolling window, then records the action and prunes old rows', async () => {
    const { query, calls } = fakeQuery({ recentTotal: 19 })

    await expect(consumeSocialActionQuota(query, { profileId: MEMBER, action: 'post' })).resolves.toEqual({ counted: true })

    expect(calls).toHaveLength(3)
    expect(calls[0].text).toContain(`pg_advisory_xact_lock(hashtext('social_quota:' || $1::text || ':' || $2::text))`)
    expect(calls[0].text).toContain(`to_regclass('public.social_action_events')`)
    expect(calls[0].values).toEqual([MEMBER, 'post'])
    expect(calls[1].text).toMatch(/e\.created_at > now\(\) - \$3::interval/)
    expect(calls[1].text).toMatch(/limit \$4/)
    expect(calls[1].values).toEqual([MEMBER, 'post', '1 hour', 20, null, '7 days'])
    expect(calls[2].text).toMatch(/delete from public\.social_action_events/)
    expect(calls[2].text).toMatch(/e\.created_at < now\(\) - \$4::interval/)
    expect(calls[2].text).toMatch(/limit \$5/)
    expect(calls[2].text).toMatch(/insert into public\.social_action_events \(profile_id, action, target_profile_id\)/)
    expect(calls[2].values).toEqual([MEMBER, 'post', null, '8 days', SOCIAL_ACTION_PRUNE_BATCH])
  })

  it.each([
    ['post', 20, 'feed_post_rate_limited'],
    ['comment', 120, 'feed_comment_rate_limited'],
    ['reaction', 300, 'feed_reaction_rate_limited'],
    ['connection_request', 50, 'network_connection_request_limit'],
  ] as const)('refuses a %s once %i are already in the window, without recording it', async (action, limit, code) => {
    const { query, calls } = fakeQuery({ recentTotal: limit })

    await expect(consumeSocialActionQuota(query, { profileId: MEMBER, action, targetProfileId: TARGET })).rejects.toThrow(code)

    expect(calls).toHaveLength(2)
    expect(calls.some((call) => call.text.includes('insert into'))).toBe(false)
  })

  it('allows the last action under each limit', async () => {
    for (const [action, quota] of Object.entries(SOCIAL_ACTION_QUOTAS)) {
      const { query } = fakeQuery({ recentTotal: quota.limit - 1 })
      await expect(consumeSocialActionQuota(query, { profileId: MEMBER, action: action as keyof typeof SOCIAL_ACTION_QUOTAS, targetProfileId: TARGET }))
        .resolves.toEqual({ counted: true })
    }
  })

  it('uses a 24 hour window for connection requests and remembers the target member', async () => {
    const { query, calls } = fakeQuery({ recentTotal: 3 })

    await consumeSocialActionQuota(query, { profileId: MEMBER, action: 'connection_request', targetProfileId: TARGET })

    expect(calls[1].values).toEqual([MEMBER, 'connection_request', '24 hours', 50, TARGET, '7 days'])
    expect(calls[1].text).toMatch(/e\.target_profile_id = \$5::uuid/)
    expect(calls[1].text).toMatch(/e\.created_at > now\(\) - \$6::interval/)
    // Connection-request rows stay 181 days: People you may know hides declined requests for 180 days.
    expect(calls[2].values).toEqual([MEMBER, 'connection_request', TARGET, '181 days', SOCIAL_ACTION_PRUNE_BATCH])
  })

  it('refuses a repeat request to the same member within 7 days with the cooldown code', async () => {
    const { query, calls } = fakeQuery({ recentTotal: 1, coolingDown: true })

    await expect(consumeSocialActionQuota(query, { profileId: MEMBER, action: 'connection_request', targetProfileId: TARGET }))
      .rejects.toThrow(CONNECTION_REQUEST_COOLDOWN_CODE)
    expect(calls.some((call) => call.text.includes('insert into'))).toBe(false)
  })

  it('reports the cooldown before the daily limit when both apply', async () => {
    const { query } = fakeQuery({ recentTotal: 50, coolingDown: true })

    await expect(consumeSocialActionQuota(query, { profileId: MEMBER, action: 'connection_request', targetProfileId: TARGET }))
      .rejects.toThrow('network_connection_request_cooldown')
  })

  it('never records a target for actions other than connection requests', async () => {
    const { query, calls } = fakeQuery()

    await consumeSocialActionQuota(query, { profileId: MEMBER, action: 'reaction', targetProfileId: TARGET })

    expect(calls[1].values[4]).toBeNull()
    expect(calls[2].values[2]).toBeNull()
  })

  it('fails open with a safe warning only when the events table does not exist yet (42P01)', async () => {
    const { query, calls } = fakeQuery({ ready: false })
    const warn = vi.fn()

    await expect(consumeSocialActionQuota(query, { profileId: MEMBER, action: 'post' }, { warn })).resolves.toEqual({ counted: false })

    expect(calls).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('[social_action_quota_skipped]', { action: 'post', reason: 'events_table_missing' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(MEMBER)
  })

  it.each(['lock', 'usage', 'insert'] as const)('never fails open when the %s statement errors', async (failOn) => {
    for (const code of ['42P01', '40001', '57014', '23503']) {
      const error = pgError(code)
      const { query } = fakeQuery({ failOn, error })
      const warn = vi.fn()
      await expect(consumeSocialActionQuota(query, { profileId: MEMBER, action: 'comment' }, { warn })).rejects.toBe(error)
      expect(warn).not.toHaveBeenCalled()
    }
  })

  it('binds to a transaction client', async () => {
    const client = {
      query: vi.fn(async (text: string) => ({
        rows: text.includes('pg_advisory_xact_lock')
          ? [{ locked: '', ready: true }]
          : text.includes('recent_total') ? [{ recent_total: '0', cooling_down: false }] : [],
      })),
    }
    const quotas = createSocialActionQuotasForClient(client as never)

    await expect(quotas.consume({ profileId: MEMBER, action: 'post' })).resolves.toEqual({ counted: true })
    expect(client.query).toHaveBeenCalledTimes(3)
  })
})
