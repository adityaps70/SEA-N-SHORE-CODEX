import { describe, expect, it, vi } from 'vitest'
import { createMessagingQueries } from './queries'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const NEWER_MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const OLDER_MESSAGE_ID = '55555555-5555-4555-8555-555555555555'
const CLIENT_MESSAGE_ID = '66666666-6666-4666-8666-666666666666'

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    listInboxRows: vi.fn(async () => [
      {
        conversation_id: CONVERSATION_ID,
        other_profile_id: OTHER_ID,
        other_name: 'Capt. Anita Singh',
        other_headline: 'Master Mariner | Oil Tankers',
        other_avatar_path: 'profiles/anita/avatar.webp',
        last_message_id: NEWER_MESSAGE_ID,
        last_message_body: 'See you onboard.',
        last_message_sender_id: OTHER_ID,
        last_message_at: new Date('2026-09-13T01:10:00.000Z'),
        last_read_message_id: OLDER_MESSAGE_ID,
        last_read_at: '2026-09-13T01:00:00.000Z',
        unread: true,
      },
    ]),
    isParticipant: vi.fn(async () => true),
    countUnreadConversations: vi.fn(async () => 1),
    listMessageRows: vi.fn(async () => [
      {
        id: NEWER_MESSAGE_ID,
        conversation_id: CONVERSATION_ID,
        sender_profile_id: OTHER_ID,
        client_message_id: '77777777-7777-4777-8777-777777777777',
        body: 'Newer message',
        created_at: new Date('2026-09-13T01:10:00.000Z'),
        edited_at: null,
        deleted_at: null,
      },
      {
        id: OLDER_MESSAGE_ID,
        conversation_id: CONVERSATION_ID,
        sender_profile_id: VIEWER_ID,
        client_message_id: CLIENT_MESSAGE_ID,
        body: 'Older message',
        created_at: '2026-09-13T01:00:00.000Z',
        edited_at: null,
        deleted_at: null,
      },
    ]),
    ...overrides,
  }
}

function makeQueries(overrides: Record<string, unknown> = {}) {
  const requireUser = vi.fn(async () => ({ id: VIEWER_ID }))
  const repository = makeRepository()
  const createReadUrl = vi.fn(async (key: string) => `https://media.example.test/${key}`)
  const queries = createMessagingQueries({
    requireUser,
    repository,
    createReadUrl,
    ...overrides,
  })
  return { queries, requireUser, repository, createReadUrl }
}

describe('messaging queries', () => {
  it('derives the inbox viewer from authenticated identity and signs avatar paths', async () => {
    const context = makeQueries()

    await expect(context.queries.getConversationInbox({ limit: 10 })).resolves.toEqual([
      {
        conversationId: CONVERSATION_ID,
        otherProfileId: OTHER_ID,
        otherName: 'Capt. Anita Singh',
        otherHeadline: 'Master Mariner | Oil Tankers',
        otherAvatarUrl: 'https://media.example.test/profiles/anita/avatar.webp',
        lastMessageId: NEWER_MESSAGE_ID,
        lastMessageBody: 'See you onboard.',
        lastMessageSenderId: OTHER_ID,
        lastMessageAt: '2026-09-13T01:10:00.000Z',
        unread: true,
      },
    ])

    expect(context.requireUser).toHaveBeenCalledTimes(1)
    expect(context.repository.listInboxRows).toHaveBeenCalledWith(VIEWER_ID, { limit: 10 })
    expect(context.createReadUrl).toHaveBeenCalledWith('profiles/anita/avatar.webp')
  })

  it('rejects a nonparticipant before loading thread rows', async () => {
    const repository = makeRepository({ isParticipant: vi.fn(async () => false) })
    const context = makeQueries({ repository })

    await expect(context.queries.getConversationThread({
      conversationId: CONVERSATION_ID,
      limit: 25,
    })).rejects.toThrow('messaging_not_participant')

    expect(repository.isParticipant).toHaveBeenCalledWith(VIEWER_ID, CONVERSATION_ID)
    expect(repository.listMessageRows).not.toHaveBeenCalled()
  })

  it('returns chronological thread DTOs and a stable cursor for the next older page', async () => {
    const context = makeQueries()

    await expect(context.queries.getConversationThread({
      conversationId: CONVERSATION_ID,
      limit: 2,
    })).resolves.toEqual({
      messages: [
        {
          id: OLDER_MESSAGE_ID,
          conversationId: CONVERSATION_ID,
          senderProfileId: VIEWER_ID,
          clientMessageId: CLIENT_MESSAGE_ID,
          body: 'Older message',
          createdAt: '2026-09-13T01:00:00.000Z',
          editedAt: null,
          deletedAt: null,
        },
        {
          id: NEWER_MESSAGE_ID,
          conversationId: CONVERSATION_ID,
          senderProfileId: OTHER_ID,
          clientMessageId: '77777777-7777-4777-8777-777777777777',
          body: 'Newer message',
          createdAt: '2026-09-13T01:10:00.000Z',
          editedAt: null,
          deletedAt: null,
        },
      ],
      nextCursor: {
        createdAt: '2026-09-13T01:00:00.000Z',
        id: OLDER_MESSAGE_ID,
      },
    })

    expect(context.repository.listMessageRows).toHaveBeenCalledWith({
      viewerProfileId: VIEWER_ID,
      conversationId: CONVERSATION_ID,
      limit: 2,
    })
  })

  it('validates the thread request before resolving authenticated identity', async () => {
    const context = makeQueries()

    await expect(context.queries.getConversationThread({
      conversationId: 'not-a-uuid',
      limit: 25,
    })).rejects.toThrow('messaging_invalid_thread_request')

    expect(context.requireUser).not.toHaveBeenCalled()
    expect(context.repository.isParticipant).not.toHaveBeenCalled()
  })
})
