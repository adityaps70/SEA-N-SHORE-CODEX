import { describe, expect, it } from 'vitest'
import {
  createMessagingUnreadCountView,
  getMessagingUnreadCountSnapshot,
  publishMessagingUnreadCount,
} from './unread-client'

describe('messaging unread client snapshot', () => {
  it('starts from the server count and retains an unread update published before a subscriber can observe the event', () => {
    const readCount = createMessagingUnreadCountView(1)
    const before = getMessagingUnreadCountSnapshot()

    expect(readCount()).toBe(1)
    publishMessagingUnreadCount(0)

    const after = getMessagingUnreadCountSnapshot()
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(after.count).toBe(0)
    expect(readCount()).toBe(0)
  })

  it('keeps a newer client unread snapshot authoritative across a remount with a stale server count', () => {
    publishMessagingUnreadCount(2)

    const remountedReadCount = createMessagingUnreadCountView(4)
    expect(remountedReadCount()).toBe(2)

    publishMessagingUnreadCount(3)
    expect(remountedReadCount()).toBe(3)
  })
})
