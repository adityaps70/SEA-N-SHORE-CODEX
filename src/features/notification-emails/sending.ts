import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { postPageVisibilitySql } from '@/features/feed/repository'
import { activityEmail, messageDigestEmail, NOTIFICATION_EMAIL_FROM, type RenderedNotificationEmail } from './emails'
import { NOTIFICATION_TYPES_BY_KIND, isNotificationEmailKind, type ActivityNotificationType, type NotificationEmailKind } from './kinds'
import { createNotificationEmailToken, notificationEmailTokenSecret } from './tokens'

/**
 * Round H (H3): member activity emails, sent by the outbox worker (scripts/workers/publish-outbox.ts) through the
 * app's one email path (Resend with the do-not-email list). Nothing new triggers them: they follow what already
 * happened in the app.
 *
 * - Connection requests, comments (and replies) and mentions (and photo tags) follow the in-app notification rows
 *   the app already writes. Five minutes after a notification appears, if it is still unread and the member keeps
 *   that email type on, one email is queued for it (dedupe key "notification:<id>", so never twice).
 * - Messages are a digest: at most one an hour per member (member_message_digests.last_sent_at), covering unread
 *   incoming messages since the last digest (covered_until), taken under a row lock (FOR UPDATE SKIP LOCKED) so two
 *   workers never queue the same digest, with a dedupe key per window.
 *
 * Every send re-checks at the last moment: the member's switch, account status (active or restricted; never
 * suspended or deleted), a verified address, and for activity emails that the notification still exists and is
 * unread, the other member is active, not blocked either way, not the member themself, and the post, comment or
 * request still exists and the member may still open it. At most 10 activity emails of one type per member an hour
 * (a busy post does not flood the inbox; the rest stay in Notifications). One email per queue row, at most once: a claimed row
 * holds a 15-minute lease and the Resend idempotency key is the row id. Logs carry counts only.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

export const ACTIVITY_EMAIL_DELAY_MINUTES = 5
export const ACTIVITY_EMAIL_LOOKBACK_HOURS = 6
export const MESSAGE_DIGEST_INTERVAL_MINUTES = 60
export const MESSAGE_DIGEST_DELAY_MINUTES = 5
export const MESSAGE_DIGEST_LOOKBACK_HOURS = 24
const MAX_ATTEMPTS = 5
const STALE_AFTER_HOURS = 12
const RETENTION_DAYS = 90
/** At most this many activity emails of one type per member per hour; the rest stay in Notifications only. */
export const ACTIVITY_EMAILS_PER_HOUR = 10

/** Must match the partial index notifications_email_candidates_idx (0088) word for word. */
const ACTIVITY_TYPES_SQL = `('connection_request', 'post_comment', 'comment_reply', 'post_mention', 'comment_mention', 'photo_tag')`
const ACTIVE_ACCOUNT_SQL = `('active', 'restricted')`

const ACTIVITY_TYPES = Object.values(NOTIFICATION_TYPES_BY_KIND).flat() as ActivityNotificationType[]

function isActivityType(value: unknown): value is ActivityNotificationType {
  return (ACTIVITY_TYPES as readonly unknown[]).includes(value)
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

const KIND_ENABLED_SQL = (preferenceRef: string, kindExpression: string) => `case ${kindExpression}
  when 'messages' then coalesce(${preferenceRef}.email_messages_digest, true)
  when 'connection_requests' then coalesce(${preferenceRef}.email_connection_requests, true)
  when 'comments' then coalesce(${preferenceRef}.email_comments, true)
  when 'mentions' then coalesce(${preferenceRef}.email_mentions, true)
  else false end`

/** Unread incoming messages for $1 in ($2, $3]: not deleted, not muted, not from a blocked or inactive member. */
const UNREAD_MESSAGES_FROM_SQL = `
  from public.conversation_participants mine
  join public.messages message on message.conversation_id = mine.conversation_id
  join public.profiles sender on sender.id = message.sender_profile_id
  left join public.messages read_cursor
    on read_cursor.id = mine.last_read_message_id
   and read_cursor.conversation_id = mine.conversation_id
  where mine.profile_id = $1
    and mine.muted_at is null
    and message.sender_profile_id <> $1
    and message.deleted_at is null
    and message.created_at > $2::timestamptz
    and message.created_at <= $3::timestamptz
    and (mine.cleared_before is null or message.created_at > mine.cleared_before)
    and (
      read_cursor.id is null
      or message.created_at > read_cursor.created_at
      or (message.created_at = read_cursor.created_at and message.id > read_cursor.id)
    )
    and sender.account_status in ${ACTIVE_ACCOUNT_SQL}
    and not exists (
      select 1 from public.user_blocks block
      where (block.blocker_id = $1 and block.blocked_id = message.sender_profile_id)
         or (block.blocker_id = message.sender_profile_id and block.blocked_id = $1)
    )`

export type NotificationEmailDelivery = {
  id: string
  recipientId: string
  kind: NotificationEmailKind
  notificationId: string | null
  payload: { from?: string; to?: string } | null
  email: string | null
  recipientActive: boolean
  kindEnabled: boolean
  /** Emails of this type already sent to this member in the last hour. */
  sentLastHour: number
  stale: boolean
}

export type ActivityDetails = {
  type: string
  postId: string | null
  commentId: string | null
  actorId: string | null
  actorName: string | null
  actorActive: boolean
  read: boolean
  blocked: boolean
  contentAvailable: boolean
}

export type DigestSummary = { unreadCount: number; conversationCount: number; senderCount: number; senderNames: string[] }

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? new Date(value).toISOString() : null
}

export function createNotificationEmailRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  return {
    /** Queues one email per new, unread activity notification whose type the recipient keeps on. */
    async enqueueActivity(now: Date, limit = 200) {
      const rows = await queryRows(
        `insert into public.member_notification_emails (dedupe_key, recipient_id, kind, notification_id)
         select 'notification:' || n.id::text,
                n.recipient_id,
                case
                  when n.notification_type = 'connection_request' then 'connection_requests'
                  when n.notification_type in ('post_comment', 'comment_reply') then 'comments'
                  else 'mentions'
                end,
                n.id
         from public.notifications n
         left join public.member_preferences preference on preference.profile_id = n.recipient_id
         where n.notification_type in ${ACTIVITY_TYPES_SQL}
           and n.created_at > $1::timestamptz - make_interval(hours => $2::int)
           and n.created_at <= $1::timestamptz - make_interval(mins => $3::int)
           and n.read_at is null
           and n.actor_id is not null
           and n.actor_id <> n.recipient_id
           and case
                 when n.notification_type = 'connection_request' then coalesce(preference.email_connection_requests, true)
                 when n.notification_type in ('post_comment', 'comment_reply') then coalesce(preference.email_comments, true)
                 else coalesce(preference.email_mentions, true)
               end
           and not exists (
             select 1 from public.member_notification_emails existing
             where existing.dedupe_key = 'notification:' || n.id::text
           )
         order by n.created_at asc
         limit $4
         on conflict (dedupe_key) do nothing
         returning id`,
        [now.toISOString(), ACTIVITY_EMAIL_LOOKBACK_HOURS, ACTIVITY_EMAIL_DELAY_MINUTES, Math.max(1, Math.min(500, Math.floor(limit)))],
      )
      return rows.length
    },

    /** Members who may be due a digest: an incoming message since their last digest, and none in the last hour. */
    async listDigestCandidates(now: Date, limit = 50): Promise<string[]> {
      const rows = await queryRows(
        `with recipients as (
           select distinct participant.profile_id
           from public.messages message
           join public.conversation_participants participant
             on participant.conversation_id = message.conversation_id
            and participant.profile_id <> message.sender_profile_id
           left join public.member_message_digests digest on digest.profile_id = participant.profile_id
           where message.deleted_at is null
             and message.created_at > greatest(
               $1::timestamptz - make_interval(hours => $2::int),
               coalesce(digest.covered_until, '-infinity'::timestamptz)
             )
             and message.created_at <= $1::timestamptz - make_interval(mins => $3::int)
             and (digest.last_sent_at is null or digest.last_sent_at <= $1::timestamptz - make_interval(mins => $4::int))
         )
         select recipient.profile_id
         from recipients recipient
         join public.profiles profile on profile.id = recipient.profile_id
         left join public.member_preferences preference on preference.profile_id = recipient.profile_id
         where profile.account_status in ${ACTIVE_ACCOUNT_SQL}
           and coalesce(preference.email_messages_digest, true)
         order by recipient.profile_id
         limit $5`,
        [now.toISOString(), MESSAGE_DIGEST_LOOKBACK_HOURS, MESSAGE_DIGEST_DELAY_MINUTES, MESSAGE_DIGEST_INTERVAL_MINUTES, Math.max(1, Math.min(200, Math.floor(limit)))],
      )
      return rows.map((row) => String(row.profile_id))
    },

    /**
     * Queues one member's digest under a row lock. 'queued' when unread messages are waiting; 'nothing' when they
     * were read meanwhile (the window still moves on); 'not_due' within the hour; 'locked' when another worker has
     * the row right now.
     */
    async queueDigest(profileId: string, now: Date): Promise<'queued' | 'nothing' | 'not_due' | 'locked'> {
      return transaction(async (query) => {
        await query(
          `insert into public.member_message_digests (profile_id)
           select profile.id from public.profiles profile where profile.id = $1
           on conflict (profile_id) do nothing`,
          [profileId],
        )
        const locked = await query(
          `select last_sent_at, covered_until from public.member_message_digests where profile_id = $1 for update skip locked`,
          [profileId],
        )
        const state = locked[0]
        if (!state) return 'locked' as const
        const lastSent = iso(state.last_sent_at)
        if (lastSent && new Date(lastSent).getTime() > now.getTime() - MESSAGE_DIGEST_INTERVAL_MINUTES * 60_000) return 'not_due' as const
        const lookback = new Date(now.getTime() - MESSAGE_DIGEST_LOOKBACK_HOURS * 3_600_000)
        const covered = iso(state.covered_until)
        const from = covered && new Date(covered) > lookback ? new Date(covered) : lookback
        const to = new Date(now.getTime() - MESSAGE_DIGEST_DELAY_MINUTES * 60_000)
        if (from >= to) return 'nothing' as const
        const counted = await query(`select count(*)::int as unread_count ${UNREAD_MESSAGES_FROM_SQL}`, [profileId, from.toISOString(), to.toISOString()])
        if (Number(counted[0]?.unread_count ?? 0) === 0) {
          await query(`update public.member_message_digests set covered_until = $2, updated_at = now() where profile_id = $1`, [profileId, to.toISOString()])
          return 'nothing' as const
        }
        await query(
          `insert into public.member_notification_emails (dedupe_key, recipient_id, kind, payload)
           values ($1, $2, 'messages', jsonb_build_object('from', $3::text, 'to', $4::text))
           on conflict (dedupe_key) do nothing`,
          [`messages:${profileId}:${to.toISOString()}`, profileId, from.toISOString(), to.toISOString()],
        )
        await query(
          `update public.member_message_digests set last_sent_at = $2, covered_until = $3, updated_at = now() where profile_id = $1`,
          [profileId, now.toISOString(), to.toISOString()],
        )
        return 'queued' as const
      })
    },

    /** Claims due emails with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<NotificationEmailDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select email.id
             from public.member_notification_emails email
             where email.status = 'pending'
               and email.next_attempt_at <= now()
               and email.attempts < $2
             order by email.next_attempt_at asc, email.id asc
             for update skip locked
             limit $1
           )
           update public.member_notification_emails email
           set attempts = email.attempts + 1,
               next_attempt_at = now() + interval '15 minutes'
           from picked
           where email.id = picked.id
           returning
             email.id, email.recipient_id, email.kind, email.notification_id, email.payload,
             (select lower(account.email)
              from public.identity_accounts account
              where account.profile_id = email.recipient_id
                and account.email_verified = true
                and account.email is not null
              order by account.created_at asc, account.id asc
              limit 1) as email,
             coalesce((select recipient.account_status in ${ACTIVE_ACCOUNT_SQL}
                       from public.profiles recipient where recipient.id = email.recipient_id), false) as recipient_active,
             coalesce((select ${KIND_ENABLED_SQL('preference', 'email.kind')}
                       from public.member_preferences preference
                       where preference.profile_id = email.recipient_id), true) as kind_enabled,
             (select count(*)::int
              from public.member_notification_emails recent
              where recent.recipient_id = email.recipient_id
                and recent.kind = email.kind
                and recent.status = 'sent'
                and recent.created_at > now() - interval '2 hours'
                and recent.sent_at > now() - interval '1 hour') as sent_last_hour,
             email.created_at < now() - make_interval(hours => $3::int) as stale`,
          [bounded, MAX_ATTEMPTS, STALE_AFTER_HOURS],
        )
        return rows.flatMap((row): NotificationEmailDelivery[] => (isNotificationEmailKind(row.kind)
          ? [{
              id: String(row.id),
              recipientId: String(row.recipient_id),
              kind: row.kind,
              notificationId: row.notification_id ? String(row.notification_id) : null,
              payload: (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) ?? null,
              email: (row.email as string | null) ?? null,
              recipientActive: row.recipient_active === true,
              kindEnabled: row.kind_enabled !== false,
              sentLastHour: Number(row.sent_last_hour ?? 0),
              stale: row.stale === true,
            }]
          : []))
      })
    },

    /** The notification an activity email is about, with every check the send needs. Null when it is gone. */
    async activityDetails(recipientId: string, notificationId: string): Promise<ActivityDetails | null> {
      const rows = await queryRows(
        `select n.notification_type::text as notification_type, n.post_id, n.comment_id, n.actor_id,
                n.read_at is not null as is_read,
                actor.full_name as actor_name,
                coalesce(actor.account_status = 'active', false) as actor_active,
                exists (
                  select 1 from public.user_blocks block
                  where (block.blocker_id = $1 and block.blocked_id = n.actor_id)
                     or (block.blocker_id = n.actor_id and block.blocked_id = $1)
                ) as blocked,
                case
                  when n.notification_type = 'connection_request' then exists (
                    select 1 from public.connections pending_request
                    where pending_request.id = n.connection_id
                      and pending_request.status = 'pending'
                      and pending_request.requested_by = n.actor_id
                  )
                  else (
                    (
                      n.comment_id is null
                      or exists (
                        select 1 from public.post_comments target_comment
                        where target_comment.id = n.comment_id
                          and target_comment.deleted_at is null
                          and target_comment.author_id = n.actor_id
                      )
                    )
                    and exists (
                      select 1
                      from public.posts p
                      join public.profiles author on author.id = p.author_id
                      where p.id = n.post_id
                        and p.deleted_at is null
                        and ${postPageVisibilitySql()}
                    )
                  )
                end as content_available
         from public.notifications n
         left join public.profiles actor on actor.id = n.actor_id
         where n.id = $2 and n.recipient_id = $1`,
        [recipientId, notificationId],
      )
      const row = rows[0]
      if (!row) return null
      return {
        type: String(row.notification_type),
        postId: row.post_id ? String(row.post_id) : null,
        commentId: row.comment_id ? String(row.comment_id) : null,
        actorId: row.actor_id ? String(row.actor_id) : null,
        actorName: (row.actor_name as string | null) ?? null,
        actorActive: row.actor_active === true,
        read: row.is_read === true,
        blocked: row.blocked === true,
        contentAvailable: row.content_available === true,
      }
    },

    /** What a digest says at send time: still-unread messages in its window, and up to three senders' names. */
    async digestSummary(recipientId: string, from: string, to: string): Promise<DigestSummary> {
      const totals = await queryRows(
        `select count(*)::int as unread_count,
                count(distinct message.conversation_id)::int as conversation_count,
                count(distinct message.sender_profile_id)::int as sender_count
         ${UNREAD_MESSAGES_FROM_SQL}`,
        [recipientId, from, to],
      )
      const unreadCount = Number(totals[0]?.unread_count ?? 0)
      if (!unreadCount) return { unreadCount: 0, conversationCount: 0, senderCount: 0, senderNames: [] }
      const senders = await queryRows(
        `select sender.full_name as sender_name, max(message.created_at) as latest
         ${UNREAD_MESSAGES_FROM_SQL}
         group by sender.id, sender.full_name
         order by latest desc
         limit 3`,
        [recipientId, from, to],
      )
      return {
        unreadCount,
        conversationCount: Number(totals[0]?.conversation_count ?? 0),
        senderCount: Number(totals[0]?.sender_count ?? 0),
        senderNames: senders.map((row) => String(row.sender_name ?? '')).filter(Boolean),
      }
    },

    async markSent(id: string, messageId: string) {
      await queryRows(
        `update public.member_notification_emails
         set status = 'sent', sent_at = now(), last_error = null,
             payload = payload || jsonb_build_object('messageId', $2::text)
         where id = $1`,
        [id, messageId],
      )
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(`update public.member_notification_emails set status = 'skipped', last_error = left($2, 500) where id = $1`, [id, reason])
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(
        `update public.member_notification_emails
         set status = case when $3 and attempts < $4 then 'pending' else 'failed' end,
             last_error = left($2, 500),
             next_attempt_at = case when $3 and attempts < $4 then now() + make_interval(mins => greatest(5, attempts * 10)) else next_attempt_at end
         where id = $1`,
        [id, error, retryable, MAX_ATTEMPTS],
      )
    },

    /** Finished queue rows older than 90 days, a bounded batch at a time. */
    async purgeOld(limit = 500) {
      const rows = await queryRows(
        `delete from public.member_notification_emails
         where id in (
           select id from public.member_notification_emails
           where status <> 'pending' and created_at < now() - make_interval(days => $1::int)
           limit $2
         )
         returning 1 as purged`,
        [RETENTION_DAYS, limit],
      )
      return rows.length
    },
  }
}

export type NotificationEmailRepository = ReturnType<typeof createNotificationEmailRepository>

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

type Outcome = 'sent' | 'skipped' | 'failed' | 'retry'

export function createNotificationEmailWorker(input: {
  repository?: NotificationEmailRepository
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  /** The link-signing secret; defaults to NEWSLETTER_TOKEN_SECRET. Without it nothing is sent. */
  tokenSecret?: string | null
  siteUrl?: string
  now?: () => Date
} = {}) {
  const repository = input.repository ?? createNotificationEmailRepository()
  const now = input.now ?? (() => new Date())
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  function resolveSecret() {
    return input.tokenSecret !== undefined ? input.tokenSecret : notificationEmailTokenSecret()
  }

  async function render(delivery: NotificationEmailDelivery, token: string): Promise<RenderedNotificationEmail | string> {
    const siteUrl = input.siteUrl ? { siteUrl: input.siteUrl } : {}
    if (delivery.kind === 'messages') {
      const from = delivery.payload?.from
      const to = delivery.payload?.to
      if (!from || !to) return 'invalid_payload'
      const summary = await repository.digestSummary(delivery.recipientId, from, to)
      if (!summary.unreadCount) return 'nothing_unread'
      return messageDigestEmail({ ...summary, token, ...siteUrl })
    }
    if (!delivery.notificationId) return 'notification_gone'
    const details = await repository.activityDetails(delivery.recipientId, delivery.notificationId)
    if (!details) return 'notification_gone'
    if (!isActivityType(details.type)) return 'unsupported_type'
    if (!details.actorId || details.actorId === delivery.recipientId) return 'self_action'
    if (details.read) return 'already_read'
    if (!details.actorActive) return 'actor_unavailable'
    if (details.blocked) return 'blocked'
    if (!details.contentAvailable) return 'content_unavailable'
    return activityEmail({ type: details.type, actorName: details.actorName, postId: details.postId, commentId: details.commentId, token, ...siteUrl })
  }

  async function sendOne(delivery: NotificationEmailDelivery, sender: Sender, secret: string): Promise<Outcome> {
    const skip = async (reason: string) => {
      await repository.markSkipped(delivery.id, reason)
      return 'skipped' as const
    }
    if (!delivery.recipientActive) return skip('recipient_inactive')
    if (!delivery.kindEnabled) return skip('email_type_off')
    if (!delivery.email) return skip('no_verified_email')
    if (delivery.stale) return skip('stale')
    if (delivery.kind !== 'messages' && delivery.sentLastHour >= ACTIVITY_EMAILS_PER_HOUR) return skip('hourly_cap')
    const token = createNotificationEmailToken({ profileId: delivery.recipientId, kind: delivery.kind, secret })
    const email = await render(delivery, token)
    if (typeof email === 'string') return skip(email)
    try {
      const result = await sender.sendEmail({
        from: NOTIFICATION_EMAIL_FROM,
        to: delivery.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        idempotencyKey: `member-notification-email/${delivery.id}`,
        tags: [{ name: 'category', value: `notification_${delivery.kind}` }],
      })
      await repository.markSent(delivery.id, result.messageId)
      return 'sent'
    } catch (error) {
      const retryable = error instanceof ResendApiError && error.retryable
      await repository.markFailed(delivery.id, errorText(error), retryable)
      return retryable ? 'retry' : 'failed'
    }
  }

  return {
    /** Every minute: queue new activity emails, then send a batch of due emails. Counts only. */
    async runSweep(limit = 10) {
      const empty = { queued: 0, claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0 }
      const secret = resolveSecret()
      if (!secret) return { ...empty, disabled: 'secret' as const }
      const sender = await resolveClient()
      if (!sender) return { ...empty, disabled: 'resend' as const }
      const queued = await repository.enqueueActivity(now())
      const deliveries = await repository.claimBatch(limit)
      const counts = { sent: 0, failed: 0, skipped: 0, retrying: 0 }
      // Sent in this sweep, per member and type, on top of what the claim counted (the hourly cap).
      const sentNow = new Map<string, number>()
      for (const delivery of deliveries) {
        const key = `${delivery.recipientId}:${delivery.kind}`
        const result = await sendOne({ ...delivery, sentLastHour: delivery.sentLastHour + (sentNow.get(key) ?? 0) }, sender, secret)
        if (result === 'sent') sentNow.set(key, (sentNow.get(key) ?? 0) + 1)
        if (result === 'sent') counts.sent += 1
        if (result === 'failed') counts.failed += 1
        if (result === 'skipped') counts.skipped += 1
        if (result === 'retry') {
          counts.retrying += 1
          // Rate limit or provider trouble: leave the rest of the batch for the next sweep.
          break
        }
      }
      return { queued, claimed: deliveries.length, ...counts, disabled: null }
    },

    /** Every few minutes: queue the unread messages digest for each member who is due one (at most hourly). */
    async runDigestSweep(limit = 50) {
      const counts = { candidates: 0, queued: 0, nothing: 0, notDue: 0, locked: 0, purged: 0 }
      if (!resolveSecret()) return { ...counts, disabled: 'secret' as const }
      const at = now()
      const candidates = await repository.listDigestCandidates(at, limit)
      counts.candidates = candidates.length
      for (const profileId of candidates) {
        const result = await repository.queueDigest(profileId, at)
        if (result === 'queued') counts.queued += 1
        if (result === 'nothing') counts.nothing += 1
        if (result === 'not_due') counts.notDue += 1
        if (result === 'locked') counts.locked += 1
      }
      counts.purged = await repository.purgeOld()
      return { ...counts, disabled: null }
    },
  }
}
