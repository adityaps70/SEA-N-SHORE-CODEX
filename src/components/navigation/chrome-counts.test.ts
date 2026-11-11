import { describe, expect, it, vi } from 'vitest'
import { UNREAD_MESSAGE_COUNT_SQL } from '@/features/messaging/repository'
import { INCOMING_REQUEST_COUNT_SQL } from '@/features/network/repository'
import { UNREAD_NOTIFICATION_COUNT_SQL } from '@/features/notifications/repository'
import { CHROME_COUNTS_SQL, createChromeCounts } from './chrome-counts'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'

function separate() {
  return {
    countUnreadNotifications: vi.fn(async () => 4),
    countUnreadMessages: vi.fn(async () => 2),
    countIncomingRequests: vi.fn(async () => 1),
  }
}

describe('signed-in chrome counts (Round DB: one query for the three badges)', () => {
  it('runs each repository count, unchanged, as a subquery of one statement for the member', () => {
    expect(CHROME_COUNTS_SQL).toContain(`(${UNREAD_NOTIFICATION_COUNT_SQL})::int as notifications`)
    expect(CHROME_COUNTS_SQL).toContain(`(${UNREAD_MESSAGE_COUNT_SQL})::int as messages`)
    expect(CHROME_COUNTS_SQL).toContain(`(${INCOMING_REQUEST_COUNT_SQL})::int as requests`)
    // Every count is for the one member passed as $1, and no other parameter is used.
    expect(CHROME_COUNTS_SQL.match(/\$\d+/g)?.every((placeholder) => placeholder === '$1')).toBe(true)
  })

  it('reads all three badges with one query', async () => {
    const query = vi.fn(async () => [{ notifications: '4', messages: 2, requests: 1 }])
    const counts = separate()
    const load = createChromeCounts({ query, separate: counts })

    await expect(load(PROFILE_ID)).resolves.toEqual({
      notificationUnreadCount: 4,
      messagingUnreadCount: 2,
      pendingConnectionRequestCount: 1,
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(CHROME_COUNTS_SQL, [PROFILE_ID])
    expect(counts.countUnreadNotifications).not.toHaveBeenCalled()
    expect(counts.countUnreadMessages).not.toHaveBeenCalled()
    expect(counts.countIncomingRequests).not.toHaveBeenCalled()
  })

  it('falls back to the three original reads if the one query fails, keeping their failure rules', async () => {
    const query = vi.fn(async () => { throw new Error('timeout') })
    const counts = separate()
    counts.countIncomingRequests.mockRejectedValueOnce(new Error('timeout'))
    const load = createChromeCounts({ query, separate: counts })

    await expect(load(PROFILE_ID)).resolves.toEqual({
      notificationUnreadCount: 4,
      messagingUnreadCount: 2,
      pendingConnectionRequestCount: 0,
    })
    expect(counts.countUnreadNotifications).toHaveBeenCalledWith(PROFILE_ID)
    expect(counts.countUnreadMessages).toHaveBeenCalledWith(PROFILE_ID)

    counts.countUnreadMessages.mockRejectedValueOnce(new Error('timeout'))
    await expect(load(PROFILE_ID)).rejects.toThrow('timeout')
  })
})
