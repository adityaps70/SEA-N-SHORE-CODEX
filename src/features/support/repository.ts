import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { isSupportTicketStatus, type SupportTicketStatus, type SupportTopic } from './topics'

/**
 * Round H (H7): Contact page tickets (migration 0089). A ticket, its first message and the email to the
 * operations inbox are written in one transaction; the email itself is sent later by the outbox worker
 * (support-email-sending.ts). Rate limits are counted from the tickets and messages themselves, under a
 * transaction-scoped advisory lock, so quick parallel requests cannot slip past them.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

/** New tickets per hour: per email address, per hashed IP and per signed-in member. */
export const SUPPORT_TICKET_LIMITS = { perEmail: 3, perIp: 5, perProfile: 5, window: '1 hour' } as const
/** Member replies per hour across their tickets. */
export const SUPPORT_REPLY_LIMIT = { perProfile: 20, window: '1 hour' } as const

export type SupportAuthorRole = 'member' | 'visitor' | 'admin'

export type SupportTicketSummary = {
  id: string
  topic: SupportTopic
  status: SupportTicketStatus
  createdAt: string
  lastMessageAt: string
  /** The first lines of the first message. */
  preview: string
}

export type AdminSupportTicketSummary = SupportTicketSummary & {
  senderName: string
  senderEmail: string
  signedIn: boolean
  messageCount: number
}

export type SupportTicketMessage = {
  id: string
  authorRole: SupportAuthorRole
  /** The author's display name, for administrators only (members see "Sea N Shore support"). */
  authorName: string | null
  body: string
  createdAt: string
}

export type SupportTicketDetail = {
  id: string
  topic: SupportTopic
  status: SupportTicketStatus
  senderName: string
  senderEmail: string
  senderProfileId: string | null
  createdAt: string
  closedAt: string | null
  messages: SupportTicketMessage[]
}

export type CreateTicketResult = { ok: true; ticketId: string } | { ok: false; reason: 'rate_limited' }
export type MemberReplyResult = { ok: true } | { ok: false; reason: 'not_found' | 'closed' | 'rate_limited' }
export type AdminReplyResult = { ok: true } | { ok: false; reason: 'not_found' | 'closed' }
export type AdminStatusResult = { ok: true; status: SupportTicketStatus } | { ok: false; reason: 'not_found' | 'unchanged' }

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? new Date(value).toISOString() : ''
}

function status(value: unknown): SupportTicketStatus {
  return isSupportTicketStatus(value) ? value : 'open'
}

function preview(body: unknown) {
  const text = typeof body === 'string' ? body.replace(/\s+/g, ' ').trim() : ''
  return text.length > 140 ? `${text.slice(0, 139)}…` : text
}

function authorRole(value: unknown): SupportAuthorRole {
  return value === 'admin' || value === 'visitor' ? value : 'member'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTicketId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

const SUMMARY_COLUMNS = `
  t.id, t.topic, t.status, t.created_at, t.last_message_at,
  (select m.body from public.support_ticket_messages m where m.ticket_id = t.id order by m.created_at asc, m.id asc limit 1) as first_body`

function mapSummary(row: QueryResultRow): SupportTicketSummary {
  return {
    id: String(row.id),
    topic: row.topic as SupportTopic,
    status: status(row.status),
    createdAt: iso(row.created_at),
    lastMessageAt: iso(row.last_message_at),
    preview: preview(row.first_body),
  }
}

export function createSupportRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function countSince(query: Query, sql: string, value: unknown) {
    const rows = await query(sql, [value, SUPPORT_TICKET_LIMITS.window])
    return Number(rows[0]?.count ?? 0)
  }

  async function overTicketLimit(query: Query, sender: { email: string; ipHash: string | null; profileId: string | null }) {
    // Serialize attempts for one address (and one IP) so parallel requests are counted one after another.
    await query(`select pg_advisory_xact_lock(hashtext('support-ticket-email:' || $1)::bigint)`, [sender.email])
    if (sender.ipHash) await query(`select pg_advisory_xact_lock(hashtext('support-ticket-ip:' || $1)::bigint)`, [sender.ipHash])
    const byEmail = await countSince(query, `select count(*)::int as count from public.support_tickets where lower(sender_email) = lower($1) and created_at > now() - $2::interval`, sender.email)
    if (byEmail >= SUPPORT_TICKET_LIMITS.perEmail) return true
    if (sender.ipHash) {
      const byIp = await countSince(query, `select count(*)::int as count from public.support_tickets where sender_ip_hash = $1 and created_at > now() - $2::interval`, sender.ipHash)
      if (byIp >= SUPPORT_TICKET_LIMITS.perIp) return true
    }
    if (sender.profileId) {
      const byProfile = await countSince(query, `select count(*)::int as count from public.support_tickets where sender_profile_id = $1 and created_at > now() - $2::interval`, sender.profileId)
      if (byProfile >= SUPPORT_TICKET_LIMITS.perProfile) return true
    }
    return false
  }

  /** Saves a ticket from the Contact page with its first message, and queues the email to operations. */
  async function createTicket(ticket: {
    senderProfileId: string | null
    senderName: string
    senderEmail: string
    ipHash: string | null
    topic: SupportTopic
    body: string
  }): Promise<CreateTicketResult> {
    return transaction(async (query) => {
      if (await overTicketLimit(query, { email: ticket.senderEmail, ipHash: ticket.ipHash, profileId: ticket.senderProfileId })) {
        return { ok: false as const, reason: 'rate_limited' as const }
      }
      const rows = await query(
        `insert into public.support_tickets (sender_profile_id, sender_name, sender_email, sender_ip_hash, topic)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [ticket.senderProfileId, ticket.senderName, ticket.senderEmail, ticket.ipHash, ticket.topic],
      )
      const ticketId = String(rows[0]!.id)
      const messages = await query(
        `insert into public.support_ticket_messages (ticket_id, author_profile_id, author_role, body)
         values ($1, $2, $3, $4)
         returning id`,
        [ticketId, ticket.senderProfileId, ticket.senderProfileId ? 'member' : 'visitor', ticket.body],
      )
      await query(
        `insert into public.support_ticket_emails (ticket_id, message_id, kind) values ($1, $2, 'operations_new_ticket')`,
        [ticketId, messages[0]!.id],
      )
      return { ok: true as const, ticketId }
    })
  }

  async function listTicketsForMember(profileId: string, limit = 50): Promise<SupportTicketSummary[]> {
    const rows = await queryRows(
      `select ${SUMMARY_COLUMNS}
       from public.support_tickets t
       where t.sender_profile_id = $1
       order by t.last_message_at desc, t.id desc
       limit $2`,
      [profileId, Math.min(Math.max(Math.trunc(limit), 1), 100)],
    )
    return rows.map(mapSummary)
  }

  async function loadDetail(query: Query, ticketId: string, where: string, values: unknown[]): Promise<SupportTicketDetail | null> {
    const rows = await query(
      `select t.id, t.topic, t.status, t.sender_name, t.sender_email, t.sender_profile_id, t.created_at, t.closed_at
       from public.support_tickets t
       where t.id = $1 ${where}`,
      [ticketId, ...values],
    )
    const ticket = rows[0]
    if (!ticket) return null
    const messages = await query(
      `select m.id, m.author_role, m.body, m.created_at,
              case when m.author_role = 'admin' then p.full_name else null end as author_name
       from public.support_ticket_messages m
       left join public.profiles p on p.id = m.author_profile_id
       where m.ticket_id = $1
       order by m.created_at asc, m.id asc`,
      [ticketId],
    )
    return {
      id: String(ticket.id),
      topic: ticket.topic as SupportTopic,
      status: status(ticket.status),
      senderName: String(ticket.sender_name ?? ''),
      senderEmail: String(ticket.sender_email ?? ''),
      senderProfileId: (ticket.sender_profile_id as string | null) ?? null,
      createdAt: iso(ticket.created_at),
      closedAt: ticket.closed_at ? iso(ticket.closed_at) : null,
      messages: messages.map((message) => ({
        id: String(message.id),
        authorRole: authorRole(message.author_role),
        authorName: (message.author_name as string | null) ?? null,
        body: String(message.body ?? ''),
        createdAt: iso(message.created_at),
      })),
    }
  }

  /** The member's own ticket, or null (also for someone else's ticket). Admin names are not shown to members. */
  async function getTicketForMember(profileId: string, ticketId: string): Promise<SupportTicketDetail | null> {
    if (!isTicketId(ticketId)) return null
    const detail = await loadDetail(queryRows, ticketId, 'and t.sender_profile_id = $2', [profileId])
    return detail ? { ...detail, messages: detail.messages.map((message) => ({ ...message, authorName: null })) } : null
  }

  /** A member answers their own open or answered ticket; it goes back to open and operations are emailed. */
  async function replyAsMember(profileId: string, ticketId: string, body: string): Promise<MemberReplyResult> {
    if (!isTicketId(ticketId)) return { ok: false, reason: 'not_found' }
    return transaction(async (query) => {
      const rows = await query(
        `select id, status from public.support_tickets where id = $1 and sender_profile_id = $2 for update`,
        [ticketId, profileId],
      )
      if (!rows[0]) return { ok: false as const, reason: 'not_found' as const }
      if (rows[0].status === 'closed') return { ok: false as const, reason: 'closed' as const }
      await query(`select pg_advisory_xact_lock(hashtext('support-reply:' || $1)::bigint)`, [profileId])
      const recent = await query(
        `select count(*)::int as count from public.support_ticket_messages
         where author_profile_id = $1 and author_role = 'member' and created_at > now() - $2::interval`,
        [profileId, SUPPORT_REPLY_LIMIT.window],
      )
      if (Number(recent[0]?.count ?? 0) >= SUPPORT_REPLY_LIMIT.perProfile) return { ok: false as const, reason: 'rate_limited' as const }
      const messages = await query(
        `insert into public.support_ticket_messages (ticket_id, author_profile_id, author_role, body)
         values ($1, $2, 'member', $3) returning id`,
        [ticketId, profileId, body],
      )
      await query(
        `update public.support_tickets set status = 'open', last_message_at = now(), updated_at = now() where id = $1`,
        [ticketId],
      )
      await query(
        `insert into public.support_ticket_emails (ticket_id, message_id, kind) values ($1, $2, 'operations_member_reply')`,
        [ticketId, messages[0]!.id],
      )
      return { ok: true as const }
    })
  }

  async function listTicketsForAdmin(filter: { status: SupportTicketStatus | 'all'; limit?: number; offset?: number }): Promise<{ tickets: AdminSupportTicketSummary[]; counts: Record<SupportTicketStatus, number> }> {
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 100)
    const offset = Math.max(Math.trunc(filter.offset ?? 0), 0)
    const [rows, countRows] = await Promise.all([
      queryRows(
        `select ${SUMMARY_COLUMNS}, t.sender_name, t.sender_email, t.sender_profile_id,
                (select count(*) from public.support_ticket_messages m where m.ticket_id = t.id) as message_count
         from public.support_tickets t
         where ($1::text = 'all' or t.status = $1::text)
         order by (t.status = 'open') desc, t.last_message_at desc, t.id desc
         limit $2 offset $3`,
        [filter.status, limit, offset],
      ),
      queryRows(`select status, count(*)::int as count from public.support_tickets group by status`),
    ])
    const counts: Record<SupportTicketStatus, number> = { open: 0, answered: 0, closed: 0 }
    for (const row of countRows) if (isSupportTicketStatus(row.status)) counts[row.status] = Number(row.count ?? 0)
    return {
      tickets: rows.map((row) => ({
        ...mapSummary(row),
        senderName: String(row.sender_name ?? ''),
        senderEmail: String(row.sender_email ?? ''),
        signedIn: Boolean(row.sender_profile_id),
        messageCount: Number(row.message_count ?? 0),
      })),
      counts,
    }
  }

  async function getTicketForAdmin(ticketId: string): Promise<SupportTicketDetail | null> {
    if (!isTicketId(ticketId)) return null
    return loadDetail(queryRows, ticketId, '', [])
  }

  /** An administrator answers: the ticket becomes "answered", the sender is emailed, and it is audited. */
  async function replyAsAdmin(adminId: string, ticketId: string, body: string): Promise<AdminReplyResult> {
    if (!isTicketId(ticketId)) return { ok: false, reason: 'not_found' }
    return transaction(async (query) => {
      const rows = await query(`select id, status from public.support_tickets where id = $1 for update`, [ticketId])
      if (!rows[0]) return { ok: false as const, reason: 'not_found' as const }
      if (rows[0].status === 'closed') return { ok: false as const, reason: 'closed' as const }
      const messages = await query(
        `insert into public.support_ticket_messages (ticket_id, author_profile_id, author_role, body)
         values ($1, $2, 'admin', $3) returning id`,
        [ticketId, adminId, body],
      )
      await query(
        `update public.support_tickets set status = 'answered', last_message_at = now(), updated_at = now() where id = $1`,
        [ticketId],
      )
      await query(
        `insert into public.support_ticket_emails (ticket_id, message_id, kind) values ($1, $2, 'sender_admin_reply')`,
        [ticketId, messages[0]!.id],
      )
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'support_ticket.replied', 'support_ticket', $2, $3::jsonb)`,
        [adminId, ticketId, JSON.stringify({ previousState: rows[0].status, messageId: messages[0]!.id })],
      )
      return { ok: true as const }
    })
  }

  /** Close (closed_at = now) or reopen (back to open) a ticket. Audited. */
  async function setStatusAsAdmin(adminId: string, ticketId: string, next: 'closed' | 'open'): Promise<AdminStatusResult> {
    if (!isTicketId(ticketId)) return { ok: false, reason: 'not_found' }
    return transaction(async (query) => {
      const rows = await query(`select id, status from public.support_tickets where id = $1 for update`, [ticketId])
      if (!rows[0]) return { ok: false as const, reason: 'not_found' as const }
      const previous = status(rows[0].status)
      if (next === 'closed' ? previous === 'closed' : previous !== 'closed') return { ok: false as const, reason: 'unchanged' as const }
      await query(
        `update public.support_tickets
         set status = $2, closed_at = case when $2 = 'closed' then now() else null end, updated_at = now()
         where id = $1`,
        [ticketId, next],
      )
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'support_ticket', $3, $4::jsonb)`,
        [adminId, next === 'closed' ? 'support_ticket.closed' : 'support_ticket.reopened', ticketId, JSON.stringify({ previousState: previous })],
      )
      return { ok: true as const, status: next }
    })
  }

  return {
    createTicket,
    listTicketsForMember,
    getTicketForMember,
    replyAsMember,
    listTicketsForAdmin,
    getTicketForAdmin,
    replyAsAdmin,
    setStatusAsAdmin,
  }
}

export type SupportRepository = ReturnType<typeof createSupportRepository>

export const supportRepository = createSupportRepository()
