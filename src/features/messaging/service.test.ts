import { describe, expect, it, vi } from 'vitest'
import type { OutboxRepository } from '@/features/events/outbox-repository'
import type { NetworkRepository } from '@/features/network/repository'
import type { MessagingRepository } from './repository'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const THIRD_ID = '33333333-3333-4333-8333-333333333333'
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444'
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555'
const CLIENT_MESSAGE_ID = '66666666-6666-4666-8666-666666666666'
const CONNECTION_ID = '77777777-7777-4777-8777-777777777777'

function acceptedConnection() {
  return {
    id: CONNECTION_ID,
    user_low_id: VIEWER_ID,
    user_high_id: TARGET_ID,
    requested_by: VIEWER_ID,
    status: 'accepted' as const,
    created_at: '2026-09-13T00:00:00.000Z',
    updated_at: '2026-09-13T00:00:00.000Z',
  }
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    sender_profile_id: VIEWER_ID,
    client_message_id: CLIENT_MESSAGE_ID,
    body: 'Good day, Captain.',
    created_at: '2026-09-13T00:01:00.000Z',
    edited_at: null,
    deleted_at: null,
    ...overrides,
  }
}

function makeMessagingRepository(overrides: Record<string, unknown> = {}) {
  return {
    findDirectConversationByPair: vi.fn(async () => null),
    insertDirectConversation: vi.fn(async () => CONVERSATION_ID),
    isParticipant: vi.fn(async () => true),
    findMessageByClientId: vi.fn(async () => null),
    insertMessage: vi.fn(async () => message()),
    updateConversationLastMessage: vi.fn(async () => undefined),
    findMessageInConversation: vi.fn(async () => message()),
    advanceReadState: vi.fn(async () => true),
    ...overrides,
  }
}

function makeNetworkRepository(overrides: Record<string, unknown> = {}) {
  return {
    findConnectionByPair: vi.fn(async () => acceptedConnection()),
    isPairBlocked: vi.fn(async () => false),
    ...overrides,
  }
}

function makeOutbox() {
  return { enqueue: vi.fn(async (_event: unknown) => undefined) }
}

async function service(input: {
  messaging?: ReturnType<typeof makeMessagingRepository>
  network?: ReturnType<typeof makeNetworkRepository>
  outbox?: ReturnType<typeof makeOutbox>
} = {}) {
  const messaging = input.messaging ?? makeMessagingRepository()
  const network = input.network ?? makeNetworkRepository()
  const outbox = input.outbox ?? makeOutbox()
  const transactionSpy = vi.fn()
  const { createMessagingService } = await import('./service')
  const withTransaction = async <T>(
    fn: (context: {
      messaging: MessagingRepository
      network: NetworkRepository
      outbox: OutboxRepository
    }) => Promise<T>,
  ) => {
    transactionSpy()
    return fn({
      messaging: messaging as unknown as MessagingRepository,
      network: network as unknown as NetworkRepository,
      outbox: outbox as unknown as OutboxRepository,
    })
  }
  return {
    service: createMessagingService({ withTransaction }),
    messaging,
    network,
    outbox,
    transactionSpy,
  }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ message: code })
}

describe('messaging authorization and durability service', () => {
  it('rejects starting a conversation with yourself before persistence', async () => {
    const context = await service()

    await expectCode(
      context.service.startDirectConversation(VIEWER_ID, VIEWER_ID),
      'messaging_self_conversation',
    )

    expect(context.transactionSpy).not.toHaveBeenCalled()
    expect(context.messaging.insertDirectConversation).not.toHaveBeenCalled()
  })

  it('requires an accepted connection and an unblocked pair before starting direct messaging', async () => {
    const noConnection = await service({
      network: makeNetworkRepository({ findConnectionByPair: vi.fn(async () => null) }),
    })
    await expectCode(
      noConnection.service.startDirectConversation(VIEWER_ID, TARGET_ID),
      'messaging_not_allowed',
    )
    expect(noConnection.messaging.insertDirectConversation).not.toHaveBeenCalled()

    const pending = await service({
      network: makeNetworkRepository({
        findConnectionByPair: vi.fn(async () => ({ ...acceptedConnection(), status: 'pending' as const })),
      }),
    })
    await expectCode(
      pending.service.startDirectConversation(VIEWER_ID, TARGET_ID),
      'messaging_not_allowed',
    )
    expect(pending.messaging.insertDirectConversation).not.toHaveBeenCalled()

    const blocked = await service({
      network: makeNetworkRepository({ isPairBlocked: vi.fn(async () => true) }),
    })
    await expectCode(
      blocked.service.startDirectConversation(VIEWER_ID, TARGET_ID),
      'messaging_not_allowed',
    )
    expect(blocked.messaging.insertDirectConversation).not.toHaveBeenCalled()
  })

  it('returns the existing direct conversation instead of creating a duplicate pair', async () => {
    const context = await service({
      messaging: makeMessagingRepository({
        findDirectConversationByPair: vi.fn(async () => ({ id: CONVERSATION_ID })),
      }),
    })

    await expect(
      context.service.startDirectConversation(VIEWER_ID, TARGET_ID),
    ).resolves.toBe(CONVERSATION_ID)

    expect(context.messaging.insertDirectConversation).not.toHaveBeenCalled()
  })

  it('creates a direct conversation only after the connection and block checks pass', async () => {
    const context = await service()

    await expect(
      context.service.startDirectConversation(VIEWER_ID, TARGET_ID),
    ).resolves.toBe(CONVERSATION_ID)

    expect(context.network.findConnectionByPair).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
    expect(context.network.isPairBlocked).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
    expect(context.messaging.insertDirectConversation).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
  })

  it('rejects sending from a nonparticipant', async () => {
    const context = await service({
      messaging: makeMessagingRepository({ isParticipant: vi.fn(async () => false) }),
    })

    await expectCode(
      context.service.sendMessage(VIEWER_ID, {
        conversationId: CONVERSATION_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: 'Hello',
      }),
      'messaging_not_participant',
    )

    expect(context.messaging.insertMessage).not.toHaveBeenCalled()
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('makes a retried client message idempotent without a second insert or event', async () => {
    const existing = message()
    const context = await service({
      messaging: makeMessagingRepository({ findMessageByClientId: vi.fn(async () => existing) }),
    })

    await expect(
      context.service.sendMessage(VIEWER_ID, {
        conversationId: CONVERSATION_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: existing.body,
      }),
    ).resolves.toEqual(existing)

    expect(context.messaging.insertMessage).not.toHaveBeenCalled()
    expect(context.messaging.updateConversationLastMessage).not.toHaveBeenCalled()
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('persists a message and last-message metadata before emitting one routing-safe message.created event', async () => {
    const context = await service()

    await expect(
      context.service.sendMessage(VIEWER_ID, {
        conversationId: CONVERSATION_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: '  Good day, Captain.  ',
      }),
    ).resolves.toEqual(message())

    expect(context.messaging.insertMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      senderProfileId: VIEWER_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: 'Good day, Captain.',
    })
    expect(context.messaging.updateConversationLastMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      MESSAGE_ID,
      '2026-09-13T00:01:00.000Z',
    )
    expect(context.outbox.enqueue).toHaveBeenCalledTimes(1)
    expect(context.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'message',
      aggregateId: MESSAGE_ID,
      eventType: 'message.created',
      schemaVersion: 1,
      payload: expect.objectContaining({
        eventType: 'message.created',
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        senderId: VIEWER_ID,
      }),
    }))

    const event = context.outbox.enqueue.mock.calls[0]?.[0] as unknown as { payload?: Record<string, unknown> }
    expect(event.payload).not.toHaveProperty('body')
  })

  it('rejects read updates from nonparticipants and messages outside the conversation', async () => {
    const nonparticipant = await service({
      messaging: makeMessagingRepository({ isParticipant: vi.fn(async () => false) }),
    })
    await expectCode(
      nonparticipant.service.markConversationRead(VIEWER_ID, CONVERSATION_ID, MESSAGE_ID),
      'messaging_not_participant',
    )

    const wrongConversation = await service({
      messaging: makeMessagingRepository({ findMessageInConversation: vi.fn(async () => null) }),
    })
    await expectCode(
      wrongConversation.service.markConversationRead(VIEWER_ID, CONVERSATION_ID, MESSAGE_ID),
      'messaging_message_not_found',
    )
    expect(wrongConversation.messaging.advanceReadState).not.toHaveBeenCalled()
  })

  it('delegates a monotonic read-state advance after authorization', async () => {
    const context = await service()

    await expect(
      context.service.markConversationRead(VIEWER_ID, CONVERSATION_ID, MESSAGE_ID),
    ).resolves.toBe(true)

    expect(context.messaging.advanceReadState).toHaveBeenCalledWith(
      VIEWER_ID,
      CONVERSATION_ID,
      MESSAGE_ID,
      '2026-09-13T00:01:00.000Z',
    )
  })

  it('does not let an unrelated profile become a participant through send or read operations', async () => {
    const context = await service({
      messaging: makeMessagingRepository({
        isParticipant: vi.fn(async (profileId: string) => profileId !== THIRD_ID),
      }),
    })

    await expectCode(
      context.service.sendMessage(THIRD_ID, {
        conversationId: CONVERSATION_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: 'Unauthorized',
      }),
      'messaging_not_participant',
    )
    await expectCode(
      context.service.markConversationRead(THIRD_ID, CONVERSATION_ID, MESSAGE_ID),
      'messaging_not_participant',
    )
  })
})
