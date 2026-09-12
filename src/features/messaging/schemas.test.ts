import { describe, expect, it } from 'vitest'
import {
  directConversationInputSchema,
  markConversationReadInputSchema,
  messagePageRequestSchema,
  sendMessageInputSchema,
} from './schemas'

const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444'
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555'
const CLIENT_MESSAGE_ID = '66666666-6666-4666-8666-666666666666'

describe('messaging schemas', () => {
  it('accepts a valid direct-conversation target profile UUID', () => {
    expect(directConversationInputSchema.parse({ targetProfileId: TARGET_ID })).toEqual({
      targetProfileId: TARGET_ID,
    })
  })

  it('normalizes message body while rejecting empty or oversized text', () => {
    expect(sendMessageInputSchema.parse({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: '  Good day, Captain.  ',
    })).toEqual({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: 'Good day, Captain.',
    })

    expect(sendMessageInputSchema.safeParse({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: '   ',
    }).success).toBe(false)

    expect(sendMessageInputSchema.safeParse({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: 'x'.repeat(5001),
    }).success).toBe(false)
  })

  it('validates explicit read-state identifiers', () => {
    expect(markConversationReadInputSchema.parse({
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
    })).toEqual({
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
    })
  })

  it('bounds thread page size and validates the stable timestamp/id cursor', () => {
    expect(messagePageRequestSchema.parse({
      conversationId: CONVERSATION_ID,
      limit: 30,
      cursor: {
        createdAt: '2026-09-13T00:01:00.000Z',
        id: MESSAGE_ID,
      },
    })).toEqual({
      conversationId: CONVERSATION_ID,
      limit: 30,
      cursor: {
        createdAt: '2026-09-13T00:01:00.000Z',
        id: MESSAGE_ID,
      },
    })

    expect(messagePageRequestSchema.safeParse({
      conversationId: CONVERSATION_ID,
      limit: 101,
    }).success).toBe(false)
  })
})
