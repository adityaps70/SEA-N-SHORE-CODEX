import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  startDirectConversation: vi.fn(),
  sendMessage: vi.fn(),
  markConversationRead: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./service', () => ({
  createProductionMessagingService: () => ({
    startDirectConversation: mocks.startDirectConversation,
    sendMessage: mocks.sendMessage,
    markConversationRead: mocks.markConversationRead,
  }),
}))

import {
  markConversationReadAction,
  sendMessageAction,
  startDirectConversationAction,
} from './actions'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const CLIENT_MESSAGE_ID = '55555555-5555-4555-8555-555555555555'

const canonicalMessage = {
  id: MESSAGE_ID,
  conversation_id: CONVERSATION_ID,
  sender_profile_id: VIEWER_ID,
  client_message_id: CLIENT_MESSAGE_ID,
  body: 'Good day, Captain.',
  created_at: new Date('2026-09-13T01:30:00.000Z'),
  edited_at: null,
  deleted_at: null,
}

describe('messaging server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({
      id: VIEWER_ID,
      cognitoSub: 'cognito-sub-1',
      email: 'member@example.com',
    })
    mocks.startDirectConversation.mockResolvedValue(CONVERSATION_ID)
    mocks.sendMessage.mockResolvedValue(canonicalMessage)
    mocks.markConversationRead.mockResolvedValue(true)
  })

  it('rejects an invalid direct-message target before resolving identity', async () => {
    await expect(startDirectConversationAction('not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'Invalid member.',
    })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.startDirectConversation).not.toHaveBeenCalled()
  })

  it('starts a direct conversation using only the authenticated actor id', async () => {
    await expect(startDirectConversationAction(TARGET_ID)).resolves.toEqual({
      ok: true,
      conversationId: CONVERSATION_ID,
    })

    expect(mocks.startDirectConversation).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/messages')
  })

  it('validates and normalizes a send before returning the canonical message for optimistic reconciliation', async () => {
    await expect(sendMessageAction({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: '  Good day, Captain.  ',
    })).resolves.toEqual({
      ok: true,
      message: {
        id: MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        senderProfileId: VIEWER_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: 'Good day, Captain.',
        createdAt: '2026-09-13T01:30:00.000Z',
        editedAt: null,
        deletedAt: null,
      },
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith(VIEWER_ID, {
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: 'Good day, Captain.',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/messages')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/messages/${CONVERSATION_ID}`)
  })

  it('rejects an empty message before resolving identity or calling the service', async () => {
    await expect(sendMessageAction({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: '   ',
    })).resolves.toEqual({
      ok: false,
      error: 'Enter a message before sending.',
    })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('treats a repeat-safe read update as a successful no-op when the marker has already advanced', async () => {
    mocks.markConversationRead.mockResolvedValueOnce(false)

    await expect(markConversationReadAction(CONVERSATION_ID, MESSAGE_ID)).resolves.toEqual({
      ok: true,
      advanced: false,
    })

    expect(mocks.markConversationRead).toHaveBeenCalledWith(
      VIEWER_ID,
      CONVERSATION_ID,
      MESSAGE_ID,
    )
  })

  it.each([
    ['messaging_not_allowed', 'You can message accepted connections only.'],
    ['messaging_self_conversation', 'You cannot message yourself.'],
    ['messaging_not_participant', 'This conversation is not available.'],
    ['messaging_message_not_found', 'This conversation is not available.'],
    ['messaging_idempotency_conflict', 'This message could not be reconciled. Please retry.'],
  ])('maps %s to safe user-facing copy', async (code, expected) => {
    mocks.startDirectConversation.mockRejectedValueOnce(new Error(code))

    await expect(startDirectConversationAction(TARGET_ID)).resolves.toEqual({
      ok: false,
      error: expected,
    })
  })
})
