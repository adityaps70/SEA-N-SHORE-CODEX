import { describe, expect, it, vi } from 'vitest'
import type { OptimisticMessagingMessage } from './components/message-composer'
import type { MessagingMessageDto } from './queries'
import {
  fetchConversationCatchUp,
  isMessageSeen,
  latestCanonicalCursor,
  laterReadCursor,
  mergeCanonicalMessages,
} from './thread-realtime'

const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

function canonical(input: Partial<MessagingMessageDto> & Pick<MessagingMessageDto, 'id' | 'clientMessageId' | 'createdAt'>): MessagingMessageDto {
  return {
    id: input.id,
    conversationId: input.conversationId ?? CONVERSATION_ID,
    senderProfileId: input.senderProfileId ?? OTHER_ID,
    clientMessageId: input.clientMessageId,
    body: input.body ?? 'Message',
    createdAt: input.createdAt,
    editedAt: input.editedAt ?? null,
    deletedAt: input.deletedAt ?? null,
  }
}

describe('active messaging realtime helpers', () => {
  it('merges canonical messages over matching optimistic messages, dedupes and keeps chronological order', () => {
    const optimistic: OptimisticMessagingMessage = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      conversationId: CONVERSATION_ID,
      senderProfileId: VIEWER_ID,
      clientMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      body: 'Optimistic',
      createdAt: '2026-09-13T10:01:00.000Z',
      editedAt: null,
      deletedAt: null,
      deliveryState: 'sending',
    }
    const existing = canonical({
      id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientMessageId: '11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: '2026-09-13T10:00:00.000Z',
    })
    const confirmed = canonical({
      id: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientMessageId: optimistic.clientMessageId,
      senderProfileId: VIEWER_ID,
      createdAt: '2026-09-13T10:01:01.000Z',
      body: 'Canonical',
    })
    const newest = canonical({
      id: '33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientMessageId: '33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: '2026-09-13T10:02:00.000Z',
    })

    expect(mergeCanonicalMessages(
      [optimistic, existing],
      [newest, confirmed, existing],
    )).toEqual([existing, confirmed, newest])
  })

  it('returns the newest canonical cursor while ignoring optimistic items', () => {
    const canonicalMessage = canonical({
      id: '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientMessageId: '44444444-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: '2026-09-13T10:02:00.000Z',
    })
    const optimistic: OptimisticMessagingMessage = {
      ...canonical({
        id: '55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        clientMessageId: '55555555-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        senderProfileId: VIEWER_ID,
        createdAt: '2026-09-13T10:03:00.000Z',
      }),
      deliveryState: 'sending',
    }

    expect(latestCanonicalCursor([canonicalMessage, optimistic])).toEqual({
      createdAt: canonicalMessage.createdAt,
      id: canonicalMessage.id,
    })
  })

  it('fetches all canonical catch-up pages and prevents a repeated-cursor loop', async () => {
    const first = canonical({
      id: '66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientMessageId: '66666666-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: '2026-09-13T10:01:00.000Z',
    })
    const second = canonical({
      id: '77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientMessageId: '77777777-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: '2026-09-13T10:02:00.000Z',
    })
    const initialCursor = {
      createdAt: '2026-09-13T10:00:00.000Z',
      id: '55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        messages: [first],
        nextCursor: { createdAt: first.createdAt, id: first.id },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        messages: [second],
        nextCursor: null,
      }), { status: 200 }))

    await expect(fetchConversationCatchUp(CONVERSATION_ID, initialCursor, fetchFn)).resolves.toEqual([
      first,
      second,
    ])
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn).toHaveBeenNthCalledWith(1, '/api/realtime/catch-up', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        conversationId: CONVERSATION_ID,
        after: initialCursor,
        limit: 100,
      }),
    }))

    const repeatedCursorFetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [first],
      nextCursor: initialCursor,
    }), { status: 200 }))
    await expect(fetchConversationCatchUp(
      CONVERSATION_ID,
      initialCursor,
      repeatedCursorFetch,
    )).rejects.toThrow('messaging_catchup_cursor_did_not_advance')
  })

  it('keeps the later peer read cursor when duplicate or out-of-order events arrive', () => {
    const earlier = {
      createdAt: '2026-09-13T10:04:00.000Z',
      id: '77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }
    const later = {
      createdAt: '2026-09-13T10:05:00.000Z',
      id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }
    const sameTimeLaterId = {
      createdAt: later.createdAt,
      id: '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }

    expect(laterReadCursor(null, earlier)).toEqual(earlier)
    expect(laterReadCursor(later, earlier)).toEqual(later)
    expect(laterReadCursor(later, sameTimeLaterId)).toEqual(sameTimeLaterId)
  })

  it('marks an outgoing canonical message Seen only when the peer durable cursor passes its tuple', () => {
    const message = canonical({
      id: '88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientMessageId: '88888888-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      senderProfileId: VIEWER_ID,
      createdAt: '2026-09-13T10:05:00.000Z',
    })

    expect(isMessageSeen(message, null)).toBe(false)
    expect(isMessageSeen(message, {
      createdAt: '2026-09-13T10:04:59.999Z',
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    })).toBe(false)
    expect(isMessageSeen(message, {
      createdAt: message.createdAt,
      id: '77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })).toBe(false)
    expect(isMessageSeen(message, {
      createdAt: message.createdAt,
      id: message.id,
    })).toBe(true)
    expect(isMessageSeen(message, {
      createdAt: '2026-09-13T10:05:00.001Z',
      id: '00000000-0000-4000-8000-000000000000',
    })).toBe(true)
  })
})
