import { describe, expect, it } from 'vitest'
import {
  createMessagingUnreadCountView,
  getMessagingUnreadCountSnapshot,
  publishMessagingUnreadCount,
} from './unread-client'

describe('messaging unread client snapshot', () => {
  it('retains an unread update published after render even before a subscriber can observe the event', () => {
    const readCount = createMessagingUnreadCountView(1)
    const before = getMessagingUnreadCountSnapshot()

    publishMessagingUnreadCount(0)

    const after = getMessagingUnreadCountSnapshot()
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(after.count).toBe(0)
    expect(readCount()).toBe(0)
  })

  it('lets a new server-rendered initial count supersede older client state while accepting newer events', () => {
    publishMessagingUnreadCount(2)

    const readCount = createMessagingUnreadCountView(4)
    expect(readCount()).toBe(4)

    publishMessagingUnreadCount(3)
    expect(readCount()).toBe(3)
  })
})
