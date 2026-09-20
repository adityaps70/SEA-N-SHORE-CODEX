import { requireAwsUser } from '@/features/auth/aws-queries'
import { createMediaReadUrl } from '@/lib/aws/storage'
import { isImageMessageAttachmentMime, isVideoMessageAttachmentMime } from './media-policy'
import { messagingRepository, type MessagingRepository } from './repository'
import { messageAfterRequestSchema, messagePageRequestSchema } from './schemas'
import type { MessagingMessageRow } from './types'

type MessagingQueryRepository = Pick<
  MessagingRepository,
  | 'listInboxRows'
  | 'isParticipant'
  | 'listMessageRows'
  | 'listMessageRowsAfter'
  | 'countUnreadMessages'
>

type RequireMessagingUser = () => Promise<{ id: string }>

export type MessagingReactionDto = {
  profileId: string
  emoji: string
}

export type MessagingAttachmentDto = {
  name: string
  mimeType: string
  size: number
  url: string
  kind: 'image' | 'video' | 'file'
}

export type MessagingReplyPreviewDto = {
  messageId: string
  senderProfileId: string | null
  body: string
  attachmentName: string | null
  deleted: boolean
}

export type MessagingMessageDto = {
  id: string
  conversationId: string
  senderProfileId: string
  clientMessageId: string
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  replyTo?: MessagingReplyPreviewDto | null
  attachment?: MessagingAttachmentDto | null
  reactions?: MessagingReactionDto[]
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
  otherLastReadMessageId: string | null
  otherLastReadAt: string | null
  unread: boolean
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function optionalIso(value: string | Date | null | undefined) {
  return value == null ? null : iso(value)
}

function normalizeAttachmentSize(value: number | string | null | undefined) {
  const size = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(size) && size > 0 ? size : null
}

function attachmentKind(mimeType: string): MessagingAttachmentDto['kind'] {
  if (isImageMessageAttachmentMime(mimeType)) return 'image'
  if (isVideoMessageAttachmentMime(mimeType)) return 'video'
  return 'file'
}

export function messagingMessageDto(
  row: MessagingMessageRow,
  attachmentUrl: string | null = null,
): MessagingMessageDto {
  const attachmentSize = normalizeAttachmentSize(row.attachment_size)
  const attachment = row.attachment_storage_path
    && row.attachment_name
    && row.attachment_mime_type
    && attachmentSize
    && attachmentUrl
    ? {
        name: row.attachment_name,
        mimeType: row.attachment_mime_type,
        size: attachmentSize,
        url: attachmentUrl,
        kind: attachmentKind(row.attachment_mime_type),
      }
    : null

  const reactions = Array.isArray(row.reactions)
    ? row.reactions.flatMap((reaction) => (
        reaction
        && typeof reaction.profile_id === 'string'
        && typeof reaction.emoji === 'string'
          ? [{ profileId: reaction.profile_id, emoji: reaction.emoji }]
          : []
      ))
    : []

  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderProfileId: row.sender_profile_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: iso(row.created_at),
    editedAt: optionalIso(row.edited_at),
    deletedAt: optionalIso(row.deleted_at),
    replyTo: row.reply_to_message_id
      ? {
          messageId: row.reply_to_message_id,
          senderProfileId: row.reply_sender_profile_id ?? null,
          body: row.reply_deleted_at ? '' : (row.reply_body ?? ''),
          attachmentName: row.reply_deleted_at ? null : (row.reply_attachment_name ?? null),
          deleted: Boolean(row.reply_deleted_at),
        }
      : null,
    attachment,
    reactions,
  }
}

export async function hydratedMessagingMessageDto(
  row: MessagingMessageRow,
  createReadUrl: (key: string) => Promise<string> = createMediaReadUrl,
) {
  const attachmentUrl = row.attachment_storage_path
    ? await createReadUrl(row.attachment_storage_path)
    : null
  return messagingMessageDto(row, attachmentUrl)
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
        otherLastReadMessageId: row.other_last_read_message_id,
        otherLastReadAt: optionalIso(row.other_last_read_at),
        unread: row.unread,
      })))
    },

    async getUnreadMessageCount() {
      const user = await input.requireUser()
      return input.repository.countUnreadMessages(user.id)
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
        messages: await Promise.all([...rows].reverse().map((row) => hydratedMessagingMessageDto(row, input.createReadUrl))),
        nextCursor,
      }
    },

    async getConversationMessagesAfter(rawInput: unknown) {
      const parsed = messageAfterRequestSchema.safeParse(rawInput)
      if (!parsed.success) throw new Error('messaging_invalid_catchup_request')

      const user = await input.requireUser()
      if (!await input.repository.isParticipant(user.id, parsed.data.conversationId)) {
        throw new Error('messaging_not_participant')
      }

      const rows = await input.repository.listMessageRowsAfter({
        viewerProfileId: user.id,
        ...parsed.data,
      })
      const newest = rows.at(-1)
      const nextCursor = rows.length === parsed.data.limit && newest
        ? { createdAt: iso(newest.created_at), id: newest.id }
        : null

      return {
        messages: await Promise.all(rows.map((row) => hydratedMessagingMessageDto(row, input.createReadUrl))),
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
export const getUnreadMessageCount = productionMessagingQueries.getUnreadMessageCount
export const getConversationThread = productionMessagingQueries.getConversationThread
export const getConversationMessagesAfter = productionMessagingQueries.getConversationMessagesAfter
