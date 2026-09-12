import { describe, expect, it, vi } from 'vitest'
import { createMessagingQueries } from './queries'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'

describe('messaging unread count', () => {
  it('counts unread conversations in Aurora for the authenticated viewer without relying on a capped inbox page', async () => {
    const requireUser = vi.fn(async () => ({ id: VIEWER_ID }))
    const countUnreadConversations = vi.fn(async () => 12)
    const repository = {
      listInboxRows: vi.fn(async () => []),
      isParticipant: vi.fn(async () => true),
      listMessageRows: vi.fn(async () => []),
      countUnreadConversations,
    }
    const queries = createMessagingQueries({
      requireUser,
      repository,
      createReadUrl: vi.fn(async (key: string) => key),
    })

    await expect(queries.getUnreadConversationCount()).resolves.toBe(12)
    expect(countUnreadConversations).toHaveBeenCalledWith(VIEWER_ID)
  })
})
