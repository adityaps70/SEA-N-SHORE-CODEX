import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { DELIVERED_EVENT_TYPES } from '@/features/email-delivery/events'
import type { LegacyInviteStatus } from './repository'
import { hasFinalReminderSql } from './final-reminder-repository'

/**
 * The legacy second reminder. One per person, ever: one row per first invitation and per email (unique indexes),
 * and a cancelled reminder can be prepared again only if it was never handed to the worker (attempts = 0).
 *
 * Each first invitation is put under the first rule it fails, in this order, so the counts add up to the total:
 */
export const REMINDER_EXCLUSIONS = [
  ['first_not_sent', 'First invitation was never sent'],
  ['already_reminded', 'Reminder already prepared or sent'],
  ['too_recent', 'First invitation sent less than 7 days ago'],
  ['bounced_or_suppressed', 'Bounced, complained or suppressed'],
  ['not_delivered', 'Delivery not confirmed'],
  ['claimed', 'Profile already claimed'],
  ['has_account', 'Has a Sea N Shore account with this email'],
  ['opted_out', 'Opted out'],
] as const

export type ReminderExclusion = (typeof REMINDER_EXCLUSIONS)[number][0]

export type ReminderBreakdown = { total: number; eligible: number; excluded: Record<ReminderExclusion, number> }

export type ReminderMetrics = Record<LegacyInviteStatus, number>

export type LegacyReminderDelivery = {
  id: string
  email: string
  fullName: string
  claimToken: string
  unsubscribeToken: string
  attempts: number
  stillEligible: boolean
}

export type LegacyReminderRecent = {
  id: string
  email: string
  fullName: string
  status: LegacyInviteStatus
  attempts: number
  sentAt: string | null
  lastEvent: string | null
  lastEventAt: string | null
  lastError: string | null
}

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DELIVERED_SQL = DELIVERED_EVENT_TYPES.map((type) => `'${type}'`).join(', ')

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function iso(value: string | Date | null) {
  return value instanceof Date ? value.toISOString() : value
}

function status(value: unknown): LegacyInviteStatus {
  return ['prepared', 'queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'].includes(String(value))
    ? value as LegacyInviteStatus
    : 'failed'
}

/**
 * The rule a first invitation (alias `invite`) fails first, or 'eligible'. Emails compare case-insensitively.
 * `includeReminder` is false when checking a reminder that already exists (at send time). An address with a final
 * reminder counts as already reminded, at prepare time and at send time: after it, no more legacy emails.
 */
export function reminderExclusionSql(includeReminder: boolean) {
  return `
    case
      when invite.status <> 'sent' or invite.sent_at is null then 'first_not_sent'
      when ${hasFinalReminderSql('invite.email')} then 'already_reminded'
      ${includeReminder ? `when exists (
        select 1 from public.legacy_profile_invite_reminders reminder
        where reminder.invite_id = invite.id
          and not (reminder.status = 'cancelled' and reminder.attempts = 0)
      ) or exists (
        select 1 from public.legacy_profile_invite_reminders reminder
        where lower(reminder.email) = lower(invite.email)
          and not (reminder.status = 'cancelled' and reminder.attempts = 0)
      ) then 'already_reminded'` : ''}
      when invite.sent_at > now() - interval '7 days' then 'too_recent'
      when exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = lower(invite.email) and suppression.reason <> 'unsubscribed'
      ) or exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id = invite.resend_message_id
          and event.event_type in ('bounced', 'complained', 'suppressed')
      ) then 'bounced_or_suppressed'
      when invite.delivered_at is null and not exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id = invite.resend_message_id and event.event_type in (${DELIVERED_SQL})
      ) then 'not_delivered'
      when exists (
        select 1 from public.legacy_profile_claims claim
        where claim.profile_id = invite.profile_id and claim.claimed_at is not null
      ) or exists (
        select 1 from public.legacy_profile_claims claim
        where lower(claim.email) = lower(invite.email) and claim.claimed_at is not null
      ) then 'claimed'
      when exists (
        select 1 from public.identity_accounts identity
        where lower(identity.email) = lower(invite.email)
      ) then 'has_account'
      when exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = lower(invite.email) and suppression.reason = 'unsubscribed'
      ) or exists (
        select 1 from public.newsletter_subscribers subscriber
        where subscriber.email = lower(invite.email) and subscriber.status = 'unsubscribed'
      ) then 'opted_out'
      else 'eligible'
    end
  `
}

export function createLegacyReminderRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  return {
    /** Eligible count and the count for each exclusion reason, before anything is prepared. */
    async breakdown(): Promise<ReminderBreakdown> {
      const rows = await queryRows<{ reason: string; count: string | number }>(`
        select reason, count(*) as count
        from (
          select ${reminderExclusionSql(true)} as reason
          from public.legacy_profile_invites invite
        ) classified
        group by reason
      `)
      const excluded = Object.fromEntries(REMINDER_EXCLUSIONS.map(([key]) => [key, 0])) as Record<ReminderExclusion, number>
      let eligible = 0
      let total = 0
      for (const row of rows) {
        const count = num(row.count)
        total += count
        if (row.reason === 'eligible') eligible = count
        else if (row.reason in excluded) excluded[row.reason as ReminderExclusion] = count
      }
      return { total, eligible, excluded }
    },

    async metrics(): Promise<ReminderMetrics> {
      const rows = await queryRows<{ status: string; count: string | number }>(`
        select status, count(*) as count from public.legacy_profile_invite_reminders group by status
      `)
      const metrics: ReminderMetrics = { prepared: 0, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0 }
      for (const row of rows) metrics[status(row.status)] += num(row.count)
      return metrics
    },

    async prepareEligible(limit: number, adminId: string) {
      const bounded = Math.max(1, Math.min(100, Math.floor(limit)))
      const rows = await queryRows<{ id: string }>(`
        with eligible as (
          select invite.id as invite_id, invite.profile_id, lower(invite.email) as email
          from public.legacy_profile_invites invite
          where (${reminderExclusionSql(true)}) = 'eligible'
          order by lower(invite.email)
          limit $2
        )
        insert into public.legacy_profile_invite_reminders (invite_id, profile_id, email, queued_by, status, attempts, next_attempt_at)
        select eligible.invite_id, eligible.profile_id, eligible.email, $1, 'prepared', 0, now()
        from eligible
        on conflict (invite_id) do update
          set status = 'prepared',
              queued_by = excluded.queued_by,
              queued_at = now(),
              next_attempt_at = now(),
              last_error = null,
              skipped_at = null,
              updated_at = now()
          where public.legacy_profile_invite_reminders.status = 'cancelled'
            and public.legacy_profile_invite_reminders.attempts = 0
        returning id
      `, [adminId, bounded])
      return rows.length
    },

    async startPrepared() {
      const rows = await queryRows<{ id: string }>(`
        update public.legacy_profile_invite_reminders
        set status = 'queued', next_attempt_at = now(), updated_at = now()
        where status = 'prepared'
        returning id
      `)
      return rows.length
    },

    async cancelPrepared() {
      const rows = await queryRows<{ id: string }>(`
        update public.legacy_profile_invite_reminders
        set status = 'cancelled', last_error = 'cancelled_by_admin_before_send', skipped_at = now(), updated_at = now()
        where status = 'prepared'
        returning id
      `)
      return rows.length
    },

    async stopUnsent() {
      const rows = await queryRows<{ id: string }>(`
        update public.legacy_profile_invite_reminders
        set status = 'cancelled', last_error = 'stopped_by_admin_before_delivery', skipped_at = now(), updated_at = now()
        where status = 'queued'
        returning id
      `)
      return rows.length
    },

    /** Claims up to `limit` queued reminders and re-checks every rule for each one at send time. */
    async claimBatch(limit = 5): Promise<LegacyReminderDelivery[]> {
      const bounded = Math.max(1, Math.min(10, Math.floor(limit)))
      return withTransaction(async (client: DatabaseQueryClient) => {
        const result = await client.query<{
          id: string
          email: string
          claim_token: string
          unsubscribe_token: string
          attempts: number
          full_name: string
          still_eligible: boolean
        }>(`
          with picked as (
            select reminder.id
            from public.legacy_profile_invite_reminders reminder
            where reminder.status = 'queued'
              and reminder.attempts < 3
              and reminder.next_attempt_at <= now()
            order by reminder.queued_at, reminder.id
            for update skip locked
            limit $1
          ),
          claimed as (
            update public.legacy_profile_invite_reminders reminder
            set status = 'sending', attempts = reminder.attempts + 1, last_attempt_at = now(), updated_at = now()
            from picked
            where reminder.id = picked.id
            returning reminder.*
          )
          select
            claimed.id,
            claimed.email,
            invite.claim_token::text,
            claimed.unsubscribe_token::text,
            claimed.attempts,
            profile.full_name,
            (${reminderExclusionSql(false)}) = 'eligible' as still_eligible
          from claimed
          join public.legacy_profile_invites invite on invite.id = claimed.invite_id
          join public.profiles profile on profile.id = claimed.profile_id
        `, [bounded])

        return result.rows.map((row) => ({
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          claimToken: row.claim_token,
          unsubscribeToken: row.unsubscribe_token,
          attempts: row.attempts,
          stillEligible: Boolean(row.still_eligible),
        }))
      })
    },

    /** Returns a claimed reminder that was not tried to the queue, as if it had not been claimed. */
    async release(id: string) {
      await queryRows(`
        update public.legacy_profile_invite_reminders
        set status = 'queued', attempts = greatest(0, attempts - 1), updated_at = now()
        where id = $1 and status = 'sending'
      `, [id])
    },

    async markSent(id: string, messageId: string) {
      await queryRows(`
        update public.legacy_profile_invite_reminders
        set status = 'sent', resend_message_id = $2, last_error = null, sent_at = now(), updated_at = now()
        where id = $1
      `, [id, messageId])
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(`
        update public.legacy_profile_invite_reminders
        set status = 'skipped', last_error = left($2, 500), skipped_at = now(), updated_at = now()
        where id = $1
      `, [id, reason])
    },

    /** A retryable failure goes back to the queue with a delay (up to 3 attempts); anything else stays failed. */
    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(`
        update public.legacy_profile_invite_reminders
        set status = case when $3 and attempts < 3 then 'queued' else 'failed' end,
            last_error = left($2, 500),
            next_attempt_at = case
              when $3 and attempts < 3 then now() + make_interval(mins => greatest(2, attempts * 5))
              else next_attempt_at
            end,
            updated_at = now()
        where id = $1
      `, [id, error, retryable])
    },

    /** A second reminder's or a final reminder's unsubscribe token (both use the same page and one-click route). */
    async isUnsubscribeToken(token: string) {
      if (!UUID.test(token)) return false
      const rows = await queryRows(`
        select 1 as found from public.legacy_profile_invite_reminders where unsubscribe_token = $1::uuid
        union all
        select 1 as found from public.legacy_profile_invite_final_reminders where unsubscribe_token = $1::uuid
      `, [token])
      return rows.length > 0
    },

    /**
     * Puts the address of the second or final reminder with this token on the do-not-email list. True when the token
     * was real (also if already on it).
     */
    async unsubscribeWithToken(token: string) {
      if (!UUID.test(token)) return false
      const rows = await queryRows<{ email: string }>(`
        with reminder as (
          select email from public.legacy_profile_invite_reminders where unsubscribe_token = $1::uuid
          union
          select email from public.legacy_profile_invite_final_reminders where unsubscribe_token = $1::uuid
        ),
        added as (
          insert into public.email_suppressions (email, reason, source)
          select distinct lower(email), 'unsubscribed', 'legacy_reminder_unsubscribe' from reminder
          on conflict (email) do nothing
          returning email
        )
        select email from reminder
      `, [token])
      return rows.length > 0
    },

    async recent(limit = 50): Promise<LegacyReminderRecent[]> {
      const rows = await queryRows<{
        id: string
        email: string
        full_name: string
        status: string
        attempts: number
        sent_at: string | Date | null
        last_event: string | null
        last_event_at: string | Date | null
        last_error: string | null
      }>(`
        select reminder.id, reminder.email, profile.full_name, reminder.status, reminder.attempts, reminder.sent_at,
               reminder.last_event, reminder.last_event_at, reminder.last_error
        from public.legacy_profile_invite_reminders reminder
        join public.profiles profile on profile.id = reminder.profile_id
        order by reminder.queued_at desc
        limit $1
      `, [Math.max(1, Math.min(100, Math.floor(limit)))])
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        status: status(row.status),
        attempts: row.attempts,
        sentAt: iso(row.sent_at),
        lastEvent: row.last_event ?? null,
        lastEventAt: iso(row.last_event_at),
        lastError: row.last_error ?? null,
      }))
    },
  }
}

export const legacyReminderRepository = createLegacyReminderRepository()
