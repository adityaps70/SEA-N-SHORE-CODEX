import { requireAwsUser } from '@/features/auth/aws-queries'
import { createMediaReadUrl } from '@/lib/aws/storage'
import { messagingRepository, type MessagingRepository } from './repository'
import { messagePageRequestSchema } from './schemas'
import type { MessagingMessageRow } from './types'

type MessagingQueryRepository = Pick<
  MessagingRepository,
  'listInboxRows' | 'isParticipant' | 'listMessageRows' | 'countUnreadConversations'
>

type RequireMessagingUser = () => Promise<{ id: string }>

export type MessagingMessageDto = {
  id: string
  conversationId: string
  senderProfileId: string
  clientMessageId: string
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
}

export type MessagingInboxItem = {
  conversationId: string
  otherProfileId: string
  otherName: string | null
  otherHeadline: string | null
  otherAvatarUrl: string | null
  lastMessageId: string | null
  lastMessageBody: string | null
  lastMessageSenderId: string | null
  lastMessageAt: string | null
  unread: boolean
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function optionalIso(value: string | Date | null) {
  return value == null ? null : iso(value)
}

export function messagingMessageDto(row: MessagingMessageRow): MessagingMessageDto {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderProfileId: row.sender_profile_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: iso(row.created_at),
    editedAt: optionalIso(row.edited_at),
    deletedAt: optionalIso(row.deleted_at),
  }
}

function inboxLimit(limit?: number) {
  if (!Number.isFinite(limit)) return 50
  return Math.min(Math.max(Math.floor(limit ?? 50), 1), 100)
}

export function createMessagingQueries(input: {
  requireUser: RequireMessagingUser
  repository: MessagingQueryRepository
  createReadUrl: (key: string) => Promise<string>
}) {
  return {
    async getConversationInbox(options: { limit?: number } = {}): Promise<MessagingInboxItem[]> {
      const user = await input.requireUser()
      const rows = await input.repository.listInboxRows(user.id, {
        limit: inboxLimit(options.limit),
      })

      return Promise.all(rows.map(async (row) => ({
        conversationId: row.conversation_id,
        otherProfileId: row.other_profile_id,
        otherName: row.other_name,
        otherHeadline: row.other_headline,
        otherAvatarUrl: row.other_avatar_path
          ? await input.createReadUrl(row.other_avatar_path)
          : null,
        lastMessageId: row.last_message_id,
        lastMessageBody: row.last_message_body,
        lastMessageSenderId: row.last_message_sender_id,
        lastMessageAt: optionalIso(row.last_message_at),
        unread: row.unread,
      })))
    },

    async getUnreadConversationCount() {
      const user = await input.requireUser()
      return input.repository.countUnreadConversations(user.id)
    },

    async getConversationThread(rawInput: unknown) {
      const parsed = messagePageRequestSchema.safeParse(rawInput)
      if (!parsed.success) throw new Error('messaging_invalid_thread_request')

      const user = await input.requireUser()
      if (!await input.repository.isParticipant(user.id, parsed.data.conversationId)) {
        throw new Error('messaging_not_participant')
      }

      const rows = await input.repository.listMessageRows({
        viewerProfileId: user.id,
        ...parsed.data,
      })
      const oldest = rows.at(-1)
      const nextCursor = rows.length === parsed.data.limit && oldest
        ? { createdAt: iso(oldest.created_at), id: oldest.id }
        : null

      return {
        messages: [...rows].reverse().map(messagingMessageDto),
        nextCursor,
      }
    },
  }
}

const productionMessagingQueries = createMessagingQueries({
  requireUser: requireAwsUser,
  repository: messagingRepository,
  createReadUrl: createMediaReadUrl,
})

export const getConversationInbox = productionMessagingQueries.getConversationInbox
export const getUnreadConversationCount = productionMessagingQueries.getUnreadConversationCount
export const getConversationThread = productionMessagingQueries.getConversationThread
