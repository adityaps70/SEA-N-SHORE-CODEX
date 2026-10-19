import { describe, expect, it, vi } from 'vitest'
import type { OutboxRepository } from '@/features/events/outbox-repository'
import type { NetworkRepository } from '@/features/network/repository'
import type { MessagingRepository } from './repository'
import type { RecruiterContactRepository } from './recruiter-contact-repository'

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
    getMessagePermission: vi.fn(async () => 'connections'),
    insertDirectConversation: vi.fn(async () => CONVERSATION_ID),
    isParticipant: vi.fn(async () => true),
    findOtherParticipantId: vi.fn(async () => TARGET_ID),
    listParticipantIds: vi.fn(async () => [VIEWER_ID, TARGET_ID]),
    findMessageByClientId: vi.fn(async () => null),
    insertMessage: vi.fn(async () => message()),
    updateConversationLastMessage: vi.fn(async () => undefined),
    findMessageInConversation: vi.fn(async () => message()),
    findMessageByIdForUpdate: vi.fn(async () => message()),
    editMessageBody: vi.fn(async (_messageId: string, body: string, editedAt: string) => message({
      body,
      edited_at: editedAt,
    })),
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

function makeRecruiterRepository(overrides: Record<string, unknown> = {}) {
  return {
    isVerifiedRecruiter: vi.fn(async () => false),
    findApplicationForRecruiter: vi.fn(async () => null),
    isOpenToRecruiters: vi.fn(async () => false),
    lockRecruiter: vi.fn(async () => undefined),
    countSince: vi.fn(async () => 0),
    findByConversation: vi.fn(async () => null),
    insert: vi.fn(async () => undefined),
    ...overrides,
  }
}

function makeOutbox() {
  const enqueue = vi.fn<OutboxRepository['enqueue']>()
  enqueue.mockResolvedValue(undefined)
  return { enqueue }
}

async function service(input: {
  messaging?: ReturnType<typeof makeMessagingRepository>
  network?: ReturnType<typeof makeNetworkRepository>
  outbox?: ReturnType<typeof makeOutbox>
  recruiters?: ReturnType<typeof makeRecruiterRepository>
  now?: () => Date
} = {}) {
  const messaging = input.messaging ?? makeMessagingRepository()
  const network = input.network ?? makeNetworkRepository()
  const outbox = input.outbox ?? makeOutbox()
  const recruiters = input.recruiters ?? makeRecruiterRepository()
  const transactionSpy = vi.fn()
  const { createMessagingService } = await import('./service')
  const withTransaction = async <T>(
    fn: (context: {
      messaging: MessagingRepository
      network: NetworkRepository
      outbox: OutboxRepository
      recruiters: RecruiterContactRepository
    }) => Promise<T>,
  ) => {
    transactionSpy()
    return fn({
      messaging: messaging as unknown as MessagingRepository,
      network: network as unknown as NetworkRepository,
      outbox: outbox as unknown as OutboxRepository,
      recruiters: recruiters as unknown as RecruiterContactRepository,
    })
  }
  return {
    service: createMessagingService({ withTransaction, now: input.now }),
    messaging,
    network,
    outbox,
    recruiters,
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

  it('enforces the recipient\u2019s "Who can message me" choice on the server (Round H, H2)', async () => {
    // Everyone: a member who is not connected may start a conversation and send.
    const open = await service({
      messaging: makeMessagingRepository({ getMessagePermission: vi.fn(async () => 'everyone') }),
      network: makeNetworkRepository({ findConnectionByPair: vi.fn(async () => null) }),
    })
    await expect(open.service.startDirectConversation(VIEWER_ID, TARGET_ID)).resolves.toBe(CONVERSATION_ID)
    expect(open.messaging.getMessagePermission).toHaveBeenCalledWith(TARGET_ID)
    await expect(open.service.sendMessage(VIEWER_ID, { conversationId: CONVERSATION_ID, clientMessageId: CLIENT_MESSAGE_ID, body: 'Good day, Captain.' })).resolves.toBeTruthy()

    // Everyone still never overrides a block.
    const blocked = await service({
      messaging: makeMessagingRepository({ getMessagePermission: vi.fn(async () => 'everyone') }),
      network: makeNetworkRepository({ findConnectionByPair: vi.fn(async () => null), isPairBlocked: vi.fn(async () => true) }),
    })
    await expectCode(blocked.service.startDirectConversation(VIEWER_ID, TARGET_ID), 'messaging_not_allowed')

    // Nobody: not even a connection may start a conversation or send in an existing one.
    const closed = await service({ messaging: makeMessagingRepository({ getMessagePermission: vi.fn(async () => 'nobody') }) })
    await expectCode(closed.service.startDirectConversation(VIEWER_ID, TARGET_ID), 'messaging_not_allowed')
    await expectCode(
      closed.service.sendMessage(VIEWER_ID, { conversationId: CONVERSATION_ID, clientMessageId: CLIENT_MESSAGE_ID, body: 'Good day, Captain.' }),
      'messaging_not_allowed',
    )
    expect(closed.messaging.insertDirectConversation).not.toHaveBeenCalled()
    expect(closed.messaging.insertMessage).not.toHaveBeenCalled()
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

  it('rejects sending when the accepted relationship no longer exists', async () => {
    const context = await service({
      network: makeNetworkRepository({ findConnectionByPair: vi.fn(async () => null) }),
    })

    await expectCode(
      context.service.sendMessage(VIEWER_ID, {
        conversationId: CONVERSATION_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: 'Should not send',
      }),
      'messaging_not_allowed',
    )

    expect(context.messaging.insertMessage).not.toHaveBeenCalled()
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('rejects sending when the relationship is no longer accepted', async () => {
    const context = await service({
      network: makeNetworkRepository({
        findConnectionByPair: vi.fn(async () => ({ ...acceptedConnection(), status: 'pending' as const })),
      }),
    })

    await expectCode(
      context.service.sendMessage(VIEWER_ID, {
        conversationId: CONVERSATION_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: 'Should not send',
      }),
      'messaging_not_allowed',
    )

    expect(context.messaging.insertMessage).not.toHaveBeenCalled()
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('rejects sending when either participant has blocked the other', async () => {
    const context = await service({
      network: makeNetworkRepository({ isPairBlocked: vi.fn(async () => true) }),
    })

    await expectCode(
      context.service.sendMessage(VIEWER_ID, {
        conversationId: CONVERSATION_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        body: 'Should not send',
      }),
      'messaging_not_allowed',
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

  it('edits an owned message within five minutes and emits message.updated', async () => {
    const editedAt = '2026-09-13T00:05:59.000Z'
    const context = await service({
      now: () => new Date(editedAt),
    })

    await expect(context.service.editMessage(VIEWER_ID, {
      messageId: MESSAGE_ID,
      body: '  Updated bridge note.  ',
    })).resolves.toEqual(message({
      body: 'Updated bridge note.',
      edited_at: editedAt,
    }))

    expect(context.messaging.editMessageBody).toHaveBeenCalledWith(
      MESSAGE_ID,
      'Updated bridge note.',
      editedAt,
    )
    expect(context.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'message',
      aggregateId: MESSAGE_ID,
      eventType: 'message.updated',
      payload: expect.objectContaining({
        eventType: 'message.updated',
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        actorId: VIEWER_ID,
      }),
    }))
  })

  it('rejects message edits after the five-minute window and from anyone except the sender', async () => {
    const expired = await service({
      now: () => new Date('2026-09-13T00:06:00.001Z'),
    })
    await expectCode(
      expired.service.editMessage(VIEWER_ID, {
        messageId: MESSAGE_ID,
        body: 'Too late',
      }),
      'messaging_edit_window_expired',
    )
    expect(expired.messaging.editMessageBody).not.toHaveBeenCalled()

    const otherUser = await service({
      now: () => new Date('2026-09-13T00:05:00.000Z'),
    })
    await expectCode(
      otherUser.service.editMessage(TARGET_ID, {
        messageId: MESSAGE_ID,
        body: 'Not mine',
      }),
      'messaging_action_not_allowed',
    )
    expect(otherUser.messaging.editMessageBody).not.toHaveBeenCalled()
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

  it('emits one durable read-cursor event only after the cursor actually advances', async () => {
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
    expect(context.messaging.listParticipantIds).toHaveBeenCalledWith(CONVERSATION_ID)
    expect(context.outbox.enqueue).toHaveBeenCalledTimes(1)
    expect(context.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'conversation',
      aggregateId: CONVERSATION_ID,
      eventType: 'conversation.read_cursor_advanced',
      schemaVersion: 1,
      occurredAt: '2026-09-13T00:01:00.000Z',
      payload: {
        eventType: 'conversation.read_cursor_advanced',
        conversationId: CONVERSATION_ID,
        readerProfileId: VIEWER_ID,
        lastReadMessageId: MESSAGE_ID,
        lastReadAt: '2026-09-13T00:01:00.000Z',
        participantProfileIds: [VIEWER_ID, TARGET_ID],
      },
    }))
  })

  it('does not emit a read-cursor event when the durable cursor did not advance', async () => {
    const context = await service({
      messaging: makeMessagingRepository({ advanceReadState: vi.fn(async () => false) }),
    })

    await expect(
      context.service.markConversationRead(VIEWER_ID, CONVERSATION_ID, MESSAGE_ID),
    ).resolves.toBe(false)

    expect(context.messaging.listParticipantIds).not.toHaveBeenCalled()
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
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

  it('deletes a conversation only for a participant, and only their own view of it', async () => {
    const clearConversationForParticipant = vi.fn(async () => true)
    const context = await service({
      messaging: makeMessagingRepository({ clearConversationForParticipant }),
    })

    await expect(context.service.deleteConversationForParticipant(VIEWER_ID, CONVERSATION_ID)).resolves.toBe(true)
    expect(context.messaging.isParticipant).toHaveBeenCalledWith(VIEWER_ID, CONVERSATION_ID)
    expect(clearConversationForParticipant).toHaveBeenCalledWith(VIEWER_ID, CONVERSATION_ID)
    expect(context.transactionSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses to delete a conversation for someone who is not in it', async () => {
    const clearConversationForParticipant = vi.fn(async () => true)
    const context = await service({
      messaging: makeMessagingRepository({
        isParticipant: vi.fn(async () => false),
        clearConversationForParticipant,
      }),
    })

    await expectCode(
      context.service.deleteConversationForParticipant(THIRD_ID, CONVERSATION_ID),
      'messaging_not_participant',
    )
    expect(clearConversationForParticipant).not.toHaveBeenCalled()
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('reports a conversation that disappeared between the check and the update as unavailable', async () => {
    const context = await service({
      messaging: makeMessagingRepository({ clearConversationForParticipant: vi.fn(async () => false) }),
    })

    await expectCode(
      context.service.deleteConversationForParticipant(VIEWER_ID, CONVERSATION_ID),
      'messaging_not_participant',
    )
  })
})

/**
 * Recruiter messaging exception (Oct 2026): VIEWER is the recruiter, TARGET the member, who keeps the default
 * "connections only" and is not connected. One test per rule.
 */
describe('recruiter messaging exception', () => {
  const APPLICATION_ID = '88888888-8888-4888-8888-888888888888'
  const JOB_ID = '99999999-9999-4999-8999-999999999999'
  const NOW = new Date('2026-10-19T09:00:00.000Z')
  const notConnected = () => makeNetworkRepository({ findConnectionByPair: vi.fn(async () => null) })
  const verified = (overrides: Record<string, unknown> = {}) => makeRecruiterRepository({ isVerifiedRecruiter: vi.fn(async () => true), ...overrides })
  const applied = { reason: 'applied' as const, applicationId: APPLICATION_ID }
  const openToRecruiters = { reason: 'open_to_recruiters' as const }
  const theirApplication = vi.fn(async () => ({ application_id: APPLICATION_ID, job_id: JOB_ID, job_title: 'Placeholder Chief Officer' }))

  it('gives no exception to an unverified recruiter: the member\'s setting decides', async () => {
    const context = await service({
      network: notConnected(),
      recruiters: makeRecruiterRepository({ findApplicationForRecruiter: theirApplication, isOpenToRecruiters: vi.fn(async () => true) }),
    })
    await expectCode(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied), 'messaging_not_allowed')
    await expectCode(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, openToRecruiters), 'messaging_not_allowed')
    expect(context.messaging.insertDirectConversation).not.toHaveBeenCalled()
    expect(context.recruiters.insert).not.toHaveBeenCalled()
  })

  it('lets a verified recruiter message a member who applied to one of their jobs, about that application', async () => {
    const context = await service({ network: notConnected(), recruiters: verified({ findApplicationForRecruiter: theirApplication }), now: () => NOW })
    await expect(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied)).resolves.toBe(CONVERSATION_ID)
    expect(context.recruiters.findApplicationForRecruiter).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID, APPLICATION_ID)
    expect(context.recruiters.insert).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID, recruiterId: VIEWER_ID, memberId: TARGET_ID, reason: 'applied', applicationId: APPLICATION_ID, jobId: JOB_ID,
    })
  })

  it('refuses an application that is not to one of the recruiter\'s jobs (or is withdrawn)', async () => {
    const context = await service({ network: notConnected(), recruiters: verified() })
    await expectCode(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied), 'messaging_not_allowed')
    expect(context.recruiters.insert).not.toHaveBeenCalled()
  })

  it('lets a verified recruiter message a member who switched on "open to recruiters", and no one else', async () => {
    const open = await service({ network: notConnected(), recruiters: verified({ isOpenToRecruiters: vi.fn(async () => true) }), now: () => NOW })
    await expect(open.service.startDirectConversation(VIEWER_ID, TARGET_ID, openToRecruiters)).resolves.toBe(CONVERSATION_ID)
    expect(open.recruiters.insert).toHaveBeenCalledWith(expect.objectContaining({ reason: 'open_to_recruiters', applicationId: null, jobId: null }))

    const closed = await service({ network: notConnected(), recruiters: verified() })
    await expectCode(closed.service.startDirectConversation(VIEWER_ID, TARGET_ID, openToRecruiters), 'messaging_not_allowed')
  })

  it('still refuses when either member blocked the other', async () => {
    const context = await service({
      network: makeNetworkRepository({ findConnectionByPair: vi.fn(async () => null), isPairBlocked: vi.fn(async () => true) }),
      recruiters: verified({ findApplicationForRecruiter: theirApplication }),
    })
    await expectCode(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied), 'messaging_not_allowed')
    expect(context.recruiters.isVerifiedRecruiter).not.toHaveBeenCalled()
  })

  it('still refuses when the member chose "Nobody"', async () => {
    const context = await service({
      messaging: makeMessagingRepository({ getMessagePermission: vi.fn(async () => 'nobody') }),
      network: notConnected(),
      recruiters: verified({ findApplicationForRecruiter: theirApplication, isOpenToRecruiters: vi.fn(async () => true) }),
    })
    await expectCode(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied), 'messaging_not_allowed')
    await expectCode(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, openToRecruiters), 'messaging_not_allowed')
    expect(context.recruiters.insert).not.toHaveBeenCalled()
  })

  it('caps new recruiter conversations at 20 in 24 hours, counted under a per-recruiter lock', async () => {
    const atCap = await service({ network: notConnected(), recruiters: verified({ findApplicationForRecruiter: theirApplication, countSince: vi.fn(async () => 20) }), now: () => NOW })
    await expectCode(atCap.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied), 'messaging_recruiter_daily_limit')
    expect(atCap.recruiters.lockRecruiter).toHaveBeenCalledWith(VIEWER_ID)
    expect(atCap.recruiters.countSince).toHaveBeenCalledWith(VIEWER_ID, new Date('2026-10-18T09:00:00.000Z'))
    expect(atCap.messaging.insertDirectConversation).not.toHaveBeenCalled()

    const underCap = await service({ network: notConnected(), recruiters: verified({ findApplicationForRecruiter: theirApplication, countSince: vi.fn(async () => 19) }), now: () => NOW })
    await expect(underCap.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied)).resolves.toBe(CONVERSATION_ID)
  })

  it('over the cap, still opens a normal conversation with a member the recruiter may message anyway', async () => {
    const context = await service({ recruiters: verified({ findApplicationForRecruiter: theirApplication, countSince: vi.fn(async () => 20) }) })
    await expect(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied)).resolves.toBe(CONVERSATION_ID)
    expect(context.recruiters.insert).not.toHaveBeenCalled()
  })

  it('reopens an existing recruiter conversation without counting it again', async () => {
    const context = await service({
      messaging: makeMessagingRepository({ findDirectConversationByPair: vi.fn(async () => ({ id: CONVERSATION_ID })) }),
      network: notConnected(),
      recruiters: verified({ findByConversation: vi.fn(async () => ({ conversation_id: CONVERSATION_ID, recruiter_profile_id: VIEWER_ID, member_profile_id: TARGET_ID, reason: 'applied' })) }),
    })
    await expect(context.service.startDirectConversation(VIEWER_ID, TARGET_ID, applied)).resolves.toBe(CONVERSATION_ID)
    expect(context.recruiters.countSince).not.toHaveBeenCalled()
    expect(context.recruiters.insert).not.toHaveBeenCalled()
  })

  describe('sending in a recruiter conversation', () => {
    const recruiterConversation = { conversation_id: CONVERSATION_ID, recruiter_profile_id: VIEWER_ID, member_profile_id: TARGET_ID, reason: 'applied', job_application_id: APPLICATION_ID, job_id: JOB_ID, job_title: 'Placeholder Chief Officer' }
    const input = { conversationId: CONVERSATION_ID, clientMessageId: CLIENT_MESSAGE_ID, body: 'Good day, Captain.' }

    it('lets the verified recruiter write to the "connections only" member', async () => {
      const context = await service({ network: notConnected(), recruiters: verified({ findByConversation: vi.fn(async () => recruiterConversation) }) })
      await expect(context.service.sendMessage(VIEWER_ID, input)).resolves.toMatchObject({ id: MESSAGE_ID })
    })

    it('lets the member reply even though the recruiter is "connections only" too', async () => {
      const context = await service({
        messaging: makeMessagingRepository({ findOtherParticipantId: vi.fn(async () => VIEWER_ID), insertMessage: vi.fn(async () => message({ sender_profile_id: TARGET_ID })) }),
        network: notConnected(),
        recruiters: makeRecruiterRepository({ findByConversation: vi.fn(async () => recruiterConversation) }),
      })
      await expect(context.service.sendMessage(TARGET_ID, input)).resolves.toMatchObject({ sender_profile_id: TARGET_ID })
    })

    it('stops when the member chooses "Nobody", when either side blocks, or when the recruiter is no longer verified', async () => {
      const nobody = await service({
        messaging: makeMessagingRepository({ getMessagePermission: vi.fn(async () => 'nobody') }),
        network: notConnected(),
        recruiters: verified({ findByConversation: vi.fn(async () => recruiterConversation) }),
      })
      await expectCode(nobody.service.sendMessage(VIEWER_ID, input), 'messaging_not_allowed')

      const blocked = await service({
        network: makeNetworkRepository({ findConnectionByPair: vi.fn(async () => null), isPairBlocked: vi.fn(async () => true) }),
        recruiters: verified({ findByConversation: vi.fn(async () => recruiterConversation) }),
      })
      await expectCode(blocked.service.sendMessage(VIEWER_ID, input), 'messaging_not_allowed')

      const unverified = await service({ network: notConnected(), recruiters: makeRecruiterRepository({ findByConversation: vi.fn(async () => recruiterConversation) }) })
      await expectCode(unverified.service.sendMessage(VIEWER_ID, input), 'messaging_not_allowed')
    })

    it('gives no exception in a conversation that was not started as a recruiter conversation', async () => {
      const context = await service({ network: notConnected(), recruiters: verified() })
      await expectCode(context.service.sendMessage(VIEWER_ID, input), 'messaging_not_allowed')
    })
  })
})
