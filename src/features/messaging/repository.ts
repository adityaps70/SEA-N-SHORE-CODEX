import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type {
  MessageAfterRequest,
  MessagePageRequest,
  MessagingConversationRow,
  MessagingInboxRow,
  MessagingMessageRow,
} from './types'

type MessagingQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResultRow[]>

type IdRow = QueryResultRow & { id: string }
type AllowedRow = QueryResultRow & { allowed?: boolean }
type AdvancedRow = QueryResultRow & { advanced?: boolean }
type CountRow = QueryResultRow & { count?: number | string }
type ParticipantRow = QueryResultRow & { profile_id: string }
type OtherParticipantRow = QueryResultRow & { other_profile_id: string }
type ConversationRow = QueryResultRow & MessagingConversationRow
type MessageRow = QueryResultRow & MessagingMessageRow
type InboxRow = QueryResultRow & MessagingInboxRow

function canonicalPair(userA: string, userB: string) {
  return userA < userB ? [userA, userB] as const : [userB, userA] as const
}

const MESSAGE_COLUMNS = `
  m.id, m.conversation_id, m.sender_profile_id, m.client_message_id,
  m.body, m.reply_to_message_id,
  m.attachment_storage_path, m.attachment_name, m.attachment_mime_type, m.attachment_size,
  m.created_at, m.edited_at, m.deleted_at,
  reply.sender_profile_id as reply_sender_profile_id,
  reply.body as reply_body,
  reply.attachment_name as reply_attachment_name,
  reply.deleted_at as reply_deleted_at,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'message_id', reaction.message_id,
        'profile_id', reaction.profile_id,
        'emoji', reaction.emoji,
        'created_at', reaction.created_at
      )
      order by reaction.created_at asc, reaction.profile_id asc
    )
    from public.message_reactions reaction
    where reaction.message_id = m.id
  ), '[]'::jsonb) as reactions
`

export function createMessagingRepository(input: { query?: MessagingQuery } = {}) {
  const queryRows: MessagingQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function findDirectConversationByPair(userA: string, userB: string) {
    const [low, high] = canonicalPair(userA, userB)
    const rows = await queryRows(
      `select id, type, direct_user_low_id, direct_user_high_id,
              last_message_id, last_message_at, created_at, updated_at
       from public.conversations
       where direct_user_low_id = $1 and direct_user_high_id = $2
       limit 1`,
      [low, high],
    ) as ConversationRow[]
    return rows[0] ?? null
  }

  async function insertDirectConversation(userA: string, userB: string) {
    const [low, high] = canonicalPair(userA, userB)
    const rows = await queryRows(
      `with chosen as (
         insert into public.conversations (
           type, direct_user_low_id, direct_user_high_id
         )
         values ('direct', $1, $2)
         on conflict (direct_user_low_id, direct_user_high_id)
         do update set direct_user_low_id = excluded.direct_user_low_id
         returning id
       ), inserted_participants as (
         insert into public.conversation_participants (conversation_id, profile_id)
         select id, $1 from chosen
         union all
         select id, $2 from chosen
         on conflict do nothing
         returning conversation_id
       )
       select id from chosen
       limit 1`,
      [low, high],
    ) as IdRow[]
    const id = rows[0]?.id
    if (!id) throw new Error('messaging_conversation_create_failed')
    return id
  }

  async function isParticipant(profileId: string, conversationId: string) {
    const rows = await queryRows(
      `select exists (
         select 1
         from public.conversation_participants
         where conversation_id = $1 and profile_id = $2
       ) as allowed`,
      [conversationId, profileId],
    ) as AllowedRow[]
    return Boolean(rows[0]?.allowed)
  }

  async function findOtherParticipantId(conversationId: string, actorId: string) {
    const rows = await queryRows(
      `select other.profile_id as other_profile_id
       from public.conversation_participants mine
       join public.conversation_participants other
         on other.conversation_id = mine.conversation_id
        and other.profile_id <> mine.profile_id
       where mine.conversation_id = $1
         and mine.profile_id = $2
       order by other.profile_id asc
       limit 1`,
      [conversationId, actorId],
    ) as OtherParticipantRow[]
    return rows[0]?.other_profile_id ?? null
  }

  async function listParticipantIds(conversationId: string) {
    const rows = await queryRows(
      `select profile_id
       from public.conversation_participants
       where conversation_id = $1
       order by profile_id asc`,
      [conversationId],
    ) as ParticipantRow[]
    return rows.map((row) => row.profile_id)
  }

  async function findMessageByClientId(senderProfileId: string, clientMessageId: string) {
    const rows = await queryRows(
      `select id, conversation_id, sender_profile_id, client_message_id,
              body, reply_to_message_id,
              attachment_storage_path, attachment_name, attachment_mime_type, attachment_size,
              created_at, edited_at, deleted_at
       from public.messages
       where sender_profile_id = $1
         and client_message_id = $2
       limit 1`,
      [senderProfileId, clientMessageId],
    ) as MessageRow[]
    return rows[0] ?? null
  }

  async function insertMessage(input: {
    conversationId: string
    senderProfileId: string
    clientMessageId: string
    body: string
    replyToMessageId?: string | null
    attachment?: {
      storagePath: string
      name: string
      mimeType: string
      size: number
    } | null
  }) {
    const attachment = input.attachment ?? null
    const rows = await queryRows(
      `insert into public.messages (
         conversation_id, sender_profile_id, client_message_id, body, reply_to_message_id,
         attachment_storage_path, attachment_name, attachment_mime_type, attachment_size
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id, conversation_id, sender_profile_id, client_message_id,
                 body, reply_to_message_id,
                 attachment_storage_path, attachment_name, attachment_mime_type, attachment_size,
                 created_at, edited_at, deleted_at`,
      [
        input.conversationId,
        input.senderProfileId,
        input.clientMessageId,
        input.body,
        input.replyToMessageId ?? null,
        attachment?.storagePath ?? null,
        attachment?.name ?? null,
        attachment?.mimeType ?? null,
        attachment?.size ?? null,
      ],
    ) as MessageRow[]
    const row = rows[0]
    if (!row) throw new Error('messaging_message_create_failed')
    return row
  }

  async function updateConversationLastMessage(
    conversationId: string,
    messageId: string,
    createdAt: string,
  ) {
    await queryRows(
      `update public.conversations
       set last_message_id = $2,
           last_message_at = $3
       where id = $1
         and (
           last_message_at is null
           or last_message_at < $3::timestamptz
           or (
             last_message_at = $3::timestamptz
             and (last_message_id is null or last_message_id < $2::uuid)
           )
         )`,
      [conversationId, messageId, createdAt],
    )
  }

  async function refreshConversationLastMessage(conversationId: string) {
    await queryRows(
      `with latest as (
         select id, created_at
         from public.messages
         where conversation_id = $1
           and deleted_at is null
         order by created_at desc, id desc
         limit 1
       )
       update public.conversations
       set last_message_id = (select id from latest),
           last_message_at = (select created_at from latest)
       where id = $1`,
      [conversationId],
    )
  }

  async function findMessageInConversation(conversationId: string, messageId: string) {
    const rows = await queryRows(
      `select id, conversation_id, sender_profile_id, client_message_id,
              body, reply_to_message_id,
              attachment_storage_path, attachment_name, attachment_mime_type, attachment_size,
              created_at, edited_at, deleted_at
       from public.messages
       where conversation_id = $1 and id = $2
       limit 1`,
      [conversationId, messageId],
    ) as MessageRow[]
    return rows[0] ?? null
  }

  async function findMessageAccessibleToParticipant(profileId: string, messageId: string) {
    const rows = await queryRows(
      `select m.id, m.conversation_id, m.sender_profile_id, m.client_message_id,
              m.body, m.reply_to_message_id,
              m.attachment_storage_path, m.attachment_name, m.attachment_mime_type, m.attachment_size,
              m.created_at, m.edited_at, m.deleted_at
       from public.messages m
       join public.conversation_participants cp
         on cp.conversation_id = m.conversation_id
        and cp.profile_id = $1
       where m.id = $2
       limit 1`,
      [profileId, messageId],
    ) as MessageRow[]
    return rows[0] ?? null
  }

  async function findMessageByIdForUpdate(messageId: string) {
    const rows = await queryRows(
      `select id, conversation_id, sender_profile_id, client_message_id,
              body, reply_to_message_id,
              attachment_storage_path, attachment_name, attachment_mime_type, attachment_size,
              created_at, edited_at, deleted_at
       from public.messages
       where id = $1
       for update`,
      [messageId],
    ) as MessageRow[]
    return rows[0] ?? null
  }

  async function editMessageBody(messageId: string, body: string, editedAt: string) {
    const rows = await queryRows(
      `update public.messages
       set body = $2,
           edited_at = $3::timestamptz
       where id = $1
         and deleted_at is null
       returning id, conversation_id, sender_profile_id, client_message_id,
                 body, reply_to_message_id,
                 attachment_storage_path, attachment_name, attachment_mime_type, attachment_size,
                 created_at, edited_at, deleted_at`,
      [messageId, body, editedAt],
    ) as MessageRow[]
    const row = rows[0]
    if (!row) throw new Error('messaging_message_not_found')
    return row
  }

  async function softDeleteMessage(messageId: string) {
    await queryRows(
      `update public.messages
       set body = '',
           attachment_storage_path = null,
           attachment_name = null,
           attachment_mime_type = null,
           attachment_size = null,
           deleted_at = now()
       where id = $1
         and deleted_at is null`,
      [messageId],
    )
  }

  async function isAttachmentReferenced(storagePath: string) {
    const rows = await queryRows(
      `select exists (
         select 1
         from public.messages
         where attachment_storage_path = $1
           and deleted_at is null
       ) as allowed`,
      [storagePath],
    ) as AllowedRow[]
    return Boolean(rows[0]?.allowed)
  }

  async function setMessageReaction(messageId: string, profileId: string, emoji: string | null) {
    if (emoji === null) {
      await queryRows(
        `delete from public.message_reactions
         where message_id = $1 and profile_id = $2`,
        [messageId, profileId],
      )
      return
    }

    await queryRows(
      `insert into public.message_reactions (message_id, profile_id, emoji)
       values ($1, $2, $3)
       on conflict (message_id, profile_id)
       do update set emoji = excluded.emoji, created_at = now()`,
      [messageId, profileId, emoji],
    )
  }

  async function listMessageRows(request: MessagePageRequest & { viewerProfileId: string }) {
    const values: unknown[] = [request.conversationId, request.viewerProfileId]
    let cursorSql = ''
    if (request.cursor) {
      values.push(request.cursor.createdAt, request.cursor.id)
      cursorSql = `
         and (
           m.created_at < $3::timestamptz
           or (m.created_at = $3::timestamptz and m.id < $4::uuid)
         )`
    }
    values.push(request.limit)
    const limitParam = `$${values.length}`
    return await queryRows(
      `select ${MESSAGE_COLUMNS}
       from public.messages m
       left join public.messages reply on reply.id = m.reply_to_message_id
       where m.conversation_id = $1
         and m.deleted_at is null
         and exists (
           select 1
           from public.conversation_participants cp
           where cp.conversation_id = m.conversation_id
             and cp.profile_id = $2
         )${cursorSql}
       order by m.created_at desc, m.id desc
       limit ${limitParam}`,
      values,
    ) as MessageRow[]
  }

  async function listMessageRowsAfter(
    request: MessageAfterRequest & { viewerProfileId: string },
  ) {
    const values: unknown[] = [request.conversationId, request.viewerProfileId]
    let afterSql = ''
    if (request.after) {
      values.push(request.after.createdAt, request.after.id)
      afterSql = `
         and (
           m.created_at > $3::timestamptz
           or (m.created_at = $3::timestamptz and m.id > $4::uuid)
         )`
    }
    values.push(request.limit)
    const limitParam = `$${values.length}`

    return await queryRows(
      `select ${MESSAGE_COLUMNS}
       from public.messages m
       left join public.messages reply on reply.id = m.reply_to_message_id
       where m.conversation_id = $1
         and m.deleted_at is null
         and exists (
           select 1
           from public.conversation_participants cp
           where cp.conversation_id = m.conversation_id
             and cp.profile_id = $2
         )${afterSql}
       order by m.created_at asc, m.id asc
       limit ${limitParam}`,
      values,
    ) as MessageRow[]
  }

  async function advanceReadState(
    profileId: string,
    conversationId: string,
    messageId: string,
    createdAt: string,
  ) {
    void createdAt
    const rows = await queryRows(
      `with target as (
         select id, created_at
         from public.messages
         where conversation_id = $1
           and id = $3
         limit 1
       ), current_cursor as (
         select current_message.id,
                current_message.created_at
         from public.conversation_participants current_participant
         left join public.messages current_message
           on current_message.id = current_participant.last_read_message_id
          and current_message.conversation_id = current_participant.conversation_id
         where current_participant.conversation_id = $1
           and current_participant.profile_id = $2
         limit 1
       )
       update public.conversation_participants participant
       set last_read_message_id = target.id,
           last_read_at = target.created_at
       from target
       left join current_cursor on true
       where participant.conversation_id = $1
         and participant.profile_id = $2
         and (
           current_cursor.id is null
           or current_cursor.created_at < target.created_at
           or (
             current_cursor.created_at = target.created_at
             and current_cursor.id < target.id
           )
         )
       returning true as advanced`,
      [conversationId, profileId, messageId],
    ) as AdvancedRow[]
    return Boolean(rows[0]?.advanced)
  }

  async function listInboxRows(viewerProfileId: string, input: { limit: number }) {
    return await queryRows(
      `select c.id as conversation_id,
              other.profile_id as other_profile_id,
              p.full_name as other_name,
              p.headline as other_headline,
              p.avatar_path as other_avatar_path,
              c.last_message_id,
              case
                when nullif(lm.body, '') is not null then lm.body
                when lm.attachment_name is not null then '📎 ' || lm.attachment_name
                else null
              end as last_message_body,
              lm.sender_profile_id as last_message_sender_id,
              c.last_message_at,
              mine.last_read_message_id,
              mine.last_read_at,
              other.last_read_message_id as other_last_read_message_id,
              other.last_read_at as other_last_read_at,
              exists (
                select 1
                from public.messages unread_message
                where unread_message.conversation_id = c.id
                  and unread_message.sender_profile_id <> mine.profile_id
                  and unread_message.deleted_at is null
                  and (
                    read_cursor.id is null
                    or unread_message.created_at > read_cursor.created_at
                    or (
                      unread_message.created_at = read_cursor.created_at
                      and unread_message.id > read_cursor.id
                    )
                  )
              ) as unread
       from public.conversation_participants mine
       join public.conversations c on c.id = mine.conversation_id
       join public.conversation_participants other
         on other.conversation_id = c.id
        and other.profile_id <> mine.profile_id
       join public.profiles p on p.id = other.profile_id
       left join public.messages lm on lm.id = c.last_message_id
       left join public.messages read_cursor
         on read_cursor.id = mine.last_read_message_id
        and read_cursor.conversation_id = mine.conversation_id
       where mine.profile_id = $1
       order by c.last_message_at desc nulls last, c.created_at desc, c.id desc
       limit $2`,
      [viewerProfileId, input.limit],
    ) as InboxRow[]
  }

  async function countUnreadMessages(viewerProfileId: string) {
    const rows = await queryRows(
      `select count(distinct unread_message.conversation_id)::int as count
       from public.messages unread_message
       join public.conversation_participants mine
         on mine.conversation_id = unread_message.conversation_id
       left join public.messages read_cursor
         on read_cursor.id = mine.last_read_message_id
        and read_cursor.conversation_id = mine.conversation_id
       where mine.profile_id = $1
         and unread_message.sender_profile_id <> mine.profile_id
         and unread_message.deleted_at is null
         and (
           read_cursor.id is null
           or unread_message.created_at > read_cursor.created_at
           or (
             unread_message.created_at = read_cursor.created_at
             and unread_message.id > read_cursor.id
           )
         )`,
      [viewerProfileId],
    ) as CountRow[]
    return Number(rows[0]?.count ?? 0)
  }

  return {
    findDirectConversationByPair,
    insertDirectConversation,
    isParticipant,
    findOtherParticipantId,
    listParticipantIds,
    findMessageByClientId,
    insertMessage,
    updateConversationLastMessage,
    refreshConversationLastMessage,
    findMessageInConversation,
    findMessageAccessibleToParticipant,
    findMessageByIdForUpdate,
    editMessageBody,
    softDeleteMessage,
    isAttachmentReferenced,
    setMessageReaction,
    listMessageRows,
    listMessageRowsAfter,
    advanceReadState,
    listInboxRows,
    countUnreadMessages,
  }
}

export type MessagingRepository = ReturnType<typeof createMessagingRepository>

export function createMessagingRepositoryForClient(client: DatabaseQueryClient) {
  return createMessagingRepository({
    query: async (text, values) => (await client.query(text, values)).rows,
  })
}

export const messagingRepository = createMessagingRepository()
