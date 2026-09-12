import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type {
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
type ConversationRow = QueryResultRow & MessagingConversationRow
type MessageRow = QueryResultRow & MessagingMessageRow
type InboxRow = QueryResultRow & MessagingInboxRow

function canonicalPair(userA: string, userB: string) {
  return userA < userB ? [userA, userB] as const : [userB, userA] as const
}

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
              body, created_at, edited_at, deleted_at
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
  }) {
    const rows = await queryRows(
      `insert into public.messages (
         conversation_id, sender_profile_id, client_message_id, body
       )
       values ($1, $2, $3, $4)
       returning id, conversation_id, sender_profile_id, client_message_id,
                 body, created_at, edited_at, deleted_at`,
      [input.conversationId, input.senderProfileId, input.clientMessageId, input.body],
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
         and (last_message_at is null or last_message_at <= $3::timestamptz)`,
      [conversationId, messageId, createdAt],
    )
  }

  async function findMessageInConversation(conversationId: string, messageId: string) {
    const rows = await queryRows(
      `select id, conversation_id, sender_profile_id, client_message_id,
              body, created_at, edited_at, deleted_at
       from public.messages
       where conversation_id = $1 and id = $2
       limit 1`,
      [conversationId, messageId],
    ) as MessageRow[]
    return rows[0] ?? null
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
      `select m.id, m.conversation_id, m.sender_profile_id, m.client_message_id,
              m.body, m.created_at, m.edited_at, m.deleted_at
       from public.messages m
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

  async function advanceReadState(
    profileId: string,
    conversationId: string,
    messageId: string,
    createdAt: string,
  ) {
    const rows = await queryRows(
      `update public.conversation_participants
       set last_read_message_id = $3,
           last_read_at = $4::timestamptz
       where conversation_id = $1
         and profile_id = $2
         and (last_read_at is null or last_read_at < $4::timestamptz)
       returning true as advanced`,
      [conversationId, profileId, messageId, createdAt],
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
              lm.body as last_message_body,
              lm.sender_profile_id as last_message_sender_id,
              c.last_message_at,
              mine.last_read_message_id,
              mine.last_read_at,
              case
                when c.last_message_at is null then false
                when mine.last_read_at is null then true
                else c.last_message_at > mine.last_read_at
              end as unread
       from public.conversation_participants mine
       join public.conversations c on c.id = mine.conversation_id
       join public.conversation_participants other
         on other.conversation_id = c.id
        and other.profile_id <> mine.profile_id
       join public.profiles p on p.id = other.profile_id
       left join public.messages lm on lm.id = c.last_message_id
       where mine.profile_id = $1
       order by c.last_message_at desc nulls last, c.created_at desc, c.id desc
       limit $2`,
      [viewerProfileId, input.limit],
    ) as InboxRow[]
  }

  async function countUnreadConversations(viewerProfileId: string) {
    const rows = await queryRows(
      `select count(*)::int as count
       from public.conversation_participants mine
       join public.conversations c on c.id = mine.conversation_id
       where mine.profile_id = $1
         and c.last_message_at is not null
         and (mine.last_read_at is null or c.last_message_at > mine.last_read_at)`,
      [viewerProfileId],
    ) as CountRow[]
    return Number(rows[0]?.count ?? 0)
  }

  return {
    findDirectConversationByPair,
    insertDirectConversation,
    isParticipant,
    listParticipantIds,
    findMessageByClientId,
    insertMessage,
    updateConversationLastMessage,
    findMessageInConversation,
    listMessageRows,
    advanceReadState,
    listInboxRows,
    countUnreadConversations,
  }
}

export type MessagingRepository = ReturnType<typeof createMessagingRepository>

export function createMessagingRepositoryForClient(client: DatabaseQueryClient) {
  return createMessagingRepository({
    query: async (text, values) => (await client.query(text, values)).rows,
  })
}

export const messagingRepository = createMessagingRepository()
