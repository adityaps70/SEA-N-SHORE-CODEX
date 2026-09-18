import { describe, expect, it, vi } from 'vitest'
import { createMessagingQueries } from './queries'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'

describe('messaging unread message count', () => {
  it('counts exact unread incoming messages in Aurora for the authenticated viewer without relying on a capped inbox page', async () => {
    const requireUser = vi.fn(async () => ({ id: VIEWER_ID }))
    const countUnreadMessages = vi.fn(async () => 12)
    const repository = {
      listInboxRows: vi.fn(async () => []),
      isParticipant: vi.fn(async () => true),
      listMessageRows: vi.fn(async () => []),
      listMessageRowsAfter: vi.fn(async () => []),
      countUnreadMessages,
    }
    const queries = createMessagingQueries({
      requireUser,
      repository,
      createReadUrl: vi.fn(async (key: string) => key),
    })

    await expect(queries.getUnreadMessageCount()).resolves.toBe(12)
    expect(countUnreadMessages).toHaveBeenCalledWith(VIEWER_ID)
  })
})
