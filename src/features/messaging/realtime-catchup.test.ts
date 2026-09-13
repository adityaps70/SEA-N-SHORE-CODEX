import { describe, expect, it, vi } from 'vitest'
import { createMessagingQueries } from './queries'
import { createMessagingRepository } from './repository'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const AFTER_MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const NEWER_MESSAGE_ID = '55555555-5555-4555-8555-555555555555'
const NEWEST_MESSAGE_ID = '66666666-6666-4666-8666-666666666666'

const AFTER = {
  createdAt: '2026-09-13T09:00:00.000Z',
  id: AFTER_MESSAGE_ID,
}

type QueryCall = [text: string, values?: readonly unknown[]]

describe('realtime messaging canonical catch-up', () => {
  it('loads only messages after the stable created_at/id cursor in ascending order', async () => {
    const query = vi.fn(async () => [])
    const repository = createMessagingRepository({ query }) as unknown as {
      listMessageRowsAfter: (request: {
        viewerProfileId: string
        conversationId: string
        after: typeof AFTER
        limit: number
      }) => Promise<unknown[]>
    }

    await repository.listMessageRowsAfter({
      viewerProfileId: VIEWER_ID,
      conversationId: CONVERSATION_ID,
      after: AFTER,
      limit: 51,
    })

    const [sql, values] = query.mock.calls[0] as unknown as QueryCall
    const text = sql.toLowerCase()
    expect(text).toContain('from public.messages')
    expect(text).toContain('conversation_participants')
    expect(text).toContain('m.created_at >')
    expect(text).toContain('m.created_at =')
    expect(text).toContain('m.id >')
    expect(text).toContain('order by m.created_at asc, m.id asc')
    expect(values).toEqual([
      CONVERSATION_ID,
      VIEWER_ID,
      AFTER.createdAt,
      AFTER.id,
      51,
    ])
  })

  it('authenticates membership and returns canonical newer DTOs with a continuation cursor', async () => {
    const repository = {
      listInboxRows: vi.fn(async () => []),
      isParticipant: vi.fn(async () => true),
      listMessageRows: vi.fn(async () => []),
      countUnreadConversations: vi.fn(async () => 0),
      listMessageRowsAfter: vi.fn(async () => [
        {
          id: NEWER_MESSAGE_ID,
          conversation_id: CONVERSATION_ID,
          sender_profile_id: OTHER_ID,
          client_message_id: '77777777-7777-4777-8777-777777777777',
          body: 'First missed message',
          created_at: new Date('2026-09-13T09:01:00.000Z'),
          edited_at: null,
          deleted_at: null,
        },
        {
          id: NEWEST_MESSAGE_ID,
          conversation_id: CONVERSATION_ID,
          sender_profile_id: OTHER_ID,
          client_message_id: '88888888-8888-4888-8888-888888888888',
          body: 'Second missed message',
          created_at: '2026-09-13T09:02:00.000Z',
          edited_at: null,
          deleted_at: null,
        },
      ]),
    }
    const queries = createMessagingQueries({
      requireUser: vi.fn(async () => ({ id: VIEWER_ID })),
      repository: repository as never,
      createReadUrl: vi.fn(async () => ''),
    }) as unknown as {
      getConversationMessagesAfter: (request: {
        conversationId: string
        after: typeof AFTER
        limit: number
      }) => Promise<{
        messages: Array<{ id: string; createdAt: string }>
        nextCursor: { createdAt: string; id: string } | null
      }>
    }

    await expect(queries.getConversationMessagesAfter({
      conversationId: CONVERSATION_ID,
      after: AFTER,
      limit: 2,
    })).resolves.toMatchObject({
      messages: [
        { id: NEWER_MESSAGE_ID, createdAt: '2026-09-13T09:01:00.000Z' },
        { id: NEWEST_MESSAGE_ID, createdAt: '2026-09-13T09:02:00.000Z' },
      ],
      nextCursor: {
        createdAt: '2026-09-13T09:02:00.000Z',
        id: NEWEST_MESSAGE_ID,
      },
    })

    expect(repository.isParticipant).toHaveBeenCalledWith(VIEWER_ID, CONVERSATION_ID)
    expect(repository.listMessageRowsAfter).toHaveBeenCalledWith({
      viewerProfileId: VIEWER_ID,
      conversationId: CONVERSATION_ID,
      after: AFTER,
      limit: 2,
    })
  })

  it('rejects a nonparticipant before loading newer rows', async () => {
    const repository = {
      listInboxRows: vi.fn(async () => []),
      isParticipant: vi.fn(async () => false),
      listMessageRows: vi.fn(async () => []),
      countUnreadConversations: vi.fn(async () => 0),
      listMessageRowsAfter: vi.fn(async () => []),
    }
    const queries = createMessagingQueries({
      requireUser: vi.fn(async () => ({ id: VIEWER_ID })),
      repository: repository as never,
      createReadUrl: vi.fn(async () => ''),
    }) as unknown as {
      getConversationMessagesAfter: (request: {
        conversationId: string
        after: typeof AFTER
        limit: number
      }) => Promise<unknown>
    }

    await expect(queries.getConversationMessagesAfter({
      conversationId: CONVERSATION_ID,
      after: AFTER,
      limit: 50,
    })).rejects.toThrow('messaging_not_participant')

    expect(repository.listMessageRowsAfter).not.toHaveBeenCalled()
  })
})
