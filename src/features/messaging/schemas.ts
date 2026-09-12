import { z } from 'zod'

const uuid = z.string().uuid()

export const directConversationInputSchema = z.object({
  targetProfileId: uuid,
})

export const sendMessageInputSchema = z.object({
  conversationId: uuid,
  clientMessageId: uuid,
  body: z.string().trim().min(1).max(5000),
})

export const markConversationReadInputSchema = z.object({
  conversationId: uuid,
  messageId: uuid,
})

export const messagePageRequestSchema = z.object({
  conversationId: uuid,
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.object({
    createdAt: z.string().datetime(),
    id: uuid,
  }).optional(),
})
