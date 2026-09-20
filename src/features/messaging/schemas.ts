import { z } from 'zod'

const uuid = z.string().uuid()
const messagingCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: uuid,
})

const messageAttachmentSchema = z.object({
  storagePath: z.string().min(1).max(700),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  size: z.number().int().positive().max(100 * 1024 * 1024),
})

function isSingleEmoji(value: string) {
  if (!value || value.length > 32) return false
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
  if (segments.length !== 1) return false
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(value)
}

export const directConversationInputSchema = z.object({
  targetProfileId: uuid,
})

export const sendMessageInputSchema = z.object({
  conversationId: uuid,
  clientMessageId: uuid,
  body: z.string().trim().max(5000),
  replyToMessageId: uuid.optional(),
  attachment: messageAttachmentSchema.optional(),
}).superRefine((value, context) => {
  if (!value.body && !value.attachment) {
    context.addIssue({
      code: 'custom',
      path: ['body'],
      message: 'Message text or an attachment is required.',
    })
  }
})

export const setMessageReactionInputSchema = z.object({
  messageId: uuid,
  emoji: z.string().trim().refine(isSingleEmoji, 'Choose one emoji.').nullable(),
})

export const deleteMessageInputSchema = z.object({
  messageId: uuid,
})

export const markConversationReadInputSchema = z.object({
  conversationId: uuid,
  messageId: uuid,
})

export const messagePageRequestSchema = z.object({
  conversationId: uuid,
  limit: z.number().int().min(1).max(100).default(50),
  cursor: messagingCursorSchema.optional(),
})

export const messageAfterRequestSchema = z.object({
  conversationId: uuid,
  limit: z.number().int().min(1).max(100).default(50),
  after: messagingCursorSchema.optional(),
})
