export type MessagingCursor = {
  createdAt: string
  id: string
}

export type MessagingReactionRow = {
  message_id: string
  profile_id: string
  emoji: string
  created_at: string | Date
}

export type MessagingMessageRow = {
  id: string
  conversation_id: string
  sender_profile_id: string
  client_message_id: string
  body: string
  reply_to_message_id?: string | null
  attachment_storage_path?: string | null
  attachment_name?: string | null
  attachment_mime_type?: string | null
  attachment_size?: number | string | null
  created_at: string | Date
  edited_at: string | Date | null
  deleted_at: string | Date | null
  reply_sender_profile_id?: string | null
  reply_body?: string | null
  reply_attachment_name?: string | null
  reply_deleted_at?: string | Date | null
  reactions?: MessagingReactionRow[]
}

export type MessagingConversationRow = {
  id: string
  type: 'direct'
  direct_user_low_id: string
  direct_user_high_id: string
  last_message_id: string | null
  last_message_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

export type MessagingInboxRow = {
  conversation_id: string
  other_profile_id: string
  other_name: string | null
  other_headline: string | null
  other_avatar_path: string | null
  last_message_id: string | null
  last_message_body: string | null
  last_message_sender_id: string | null
  last_message_at: string | Date | null
  last_read_message_id: string | null
  last_read_at: string | Date | null
  other_last_read_message_id: string | null
  other_last_read_at: string | Date | null
  unread: boolean
}

export type MessagePageRequest = {
  conversationId: string
  limit: number
  cursor?: MessagingCursor
}

export type MessageAfterRequest = {
  conversationId: string
  limit: number
  after?: MessagingCursor
}

export type MessageAttachmentInput = {
  storagePath: string
  name: string
  mimeType: string
  size: number
}

export type SendMessageInput = {
  conversationId: string
  clientMessageId: string
  body: string
  replyToMessageId?: string
  attachment?: MessageAttachmentInput
}
