export type MessagingCursor = {
  createdAt: string
  id: string
}

export type MessagingMessageRow = {
  id: string
  conversation_id: string
  sender_profile_id: string
  client_message_id: string
  body: string
  created_at: string | Date
  edited_at: string | Date | null
  deleted_at: string | Date | null
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
  unread: boolean
}

export type MessagePageRequest = {
  conversationId: string
  limit: number
  cursor?: MessagingCursor
}

export type SendMessageInput = {
  conversationId: string
  clientMessageId: string
  body: string
}
