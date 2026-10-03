import { describe, expect, it } from 'vitest'
import {
  directConversationInputSchema,
  editMessageInputSchema,
  markConversationReadInputSchema,
  messagePageRequestSchema,
  sendMessageInputSchema,
  setMessageReactionInputSchema,
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

  it('allows an attachment-only message and a reply target while still rejecting a completely empty send', () => {
    const attachment = {
      storagePath: `messages/${TARGET_ID}/${CONVERSATION_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
      name: 'bridge-photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
    }

    expect(sendMessageInputSchema.parse({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: '   ',
      replyToMessageId: MESSAGE_ID,
      attachment,
    })).toEqual({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: '',
      replyToMessageId: MESSAGE_ID,
      attachment,
    })

    expect(sendMessageInputSchema.safeParse({
      conversationId: CONVERSATION_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: '   ',
    }).success).toBe(false)
  })

  it('normalizes edited message text while rejecting empty or oversized edits', () => {
    expect(editMessageInputSchema.parse({
      messageId: MESSAGE_ID,
      body: '  Updated message  ',
    })).toEqual({
      messageId: MESSAGE_ID,
      body: 'Updated message',
    })

    expect(editMessageInputSchema.safeParse({
      messageId: MESSAGE_ID,
      body: '   ',
    }).success).toBe(false)

    expect(editMessageInputSchema.safeParse({
      messageId: MESSAGE_ID,
      body: 'x'.repeat(5001),
    }).success).toBe(false)
  })

  it('accepts a single emoji reaction and rejects ordinary text as a reaction', () => {
    expect(setMessageReactionInputSchema.parse({
      messageId: MESSAGE_ID,
      emoji: '🫡',
    })).toEqual({
      messageId: MESSAGE_ID,
      emoji: '🫡',
    })
    expect(setMessageReactionInputSchema.parse({
      messageId: MESSAGE_ID,
      emoji: null,
    })).toEqual({
      messageId: MESSAGE_ID,
      emoji: null,
    })
    expect(setMessageReactionInputSchema.safeParse({
      messageId: MESSAGE_ID,
      emoji: 'hello',
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
