import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { DELIVERED_EVENT_TYPES } from '@/features/email-delivery/events'
import type { LegacyInviteStatus } from './repository'

/**
 * The final legacy reminder: the last email about an old seaandshore.in account, and the last legacy email of all
 * (the first invitation and the second reminder also exclude any address that has one; no mode comes after it).
 * One per person, ever: one row per first invitation, per second reminder and per email (unique indexes), and a
 * cancelled one can be prepared again only if it was never handed to the worker (attempts = 0).
 *
 * Each first invitation is put under the first rule it fails, in this order, so the counts add up to the total:
 */
export const FINAL_REMINDER_EXCLUSIONS = [
  ['first_not_sent', 'First invitation was never sent'],
  ['reminder_not_sent', 'Second reminder was never sent'],
  ['already_final', 'Final reminder already prepared or sent'],
  ['too_recent', 'Second reminder sent less than 14 days ago'],
  ['bounced_or_suppressed', 'Bounced, complained or suppressed on an earlier email'],
  ['not_delivered', 'Delivery of the first invitation or second reminder not confirmed'],
  ['claimed', 'Profile already claimed'],
  ['has_account', 'Has a Sea N Shore account with this email'],
  ['opted_out', 'Opted out'],
  ['duplicate_email', 'More than one legacy profile has this email'],
] as const

export type FinalReminderExclusion = (typeof FINAL_REMINDER_EXCLUSIONS)[number][0]

export type FinalReminderBreakdown = { total: number; eligible: number; excluded: Record<FinalReminderExclusion, number> }

export type FinalReminderMetrics = Record<LegacyInviteStatus, number>

/** The first batch: the first 100 final reminders. More can be prepared only once it has settled. */
export const FINAL_REMINDER_FIRST_BATCH = 100
export const FINAL_REMINDER_FIRST_BATCH_WAIT_HOURS = 24
/** Auto-pause thresholds, of the final reminders sent: more than 0.1% complaints or more than 3% bounces. */
export const FINAL_REMINDER_MAX_COMPLAINT_RATE = 0.001
export const FINAL_REMINDER_MAX_BOUNCE_RATE = 0.03

export type FinalReminderDelivery = {
  id: string
  email: string
  fullName: string
  clickToken: string
  unsubscribeToken: string
  attempts: number
  stillEligible: boolean
}

export type FinalReminderControls = {
  paused: boolean
  pausedReason: string | null
  pausedAt: string | null
  resumedAt: string | null
  resumedByName: string | null
}

export type FinalReminderRates = {
  sent: number
  bounced: number
  complained: number
  bounceRate: number
  complaintRate: number
}

export type FinalReminderFirstBatch = {
  size: number
  finished: number
  lastSentAt: string | null
  /** When more than the first batch may be prepared, if it is not open yet and the batch has finished. */
  opensAt: string | null
  open: boolean
  delivered: number
  bounced: number
  complained: number
  clicked: number
}

export type FinalPrepareResult =
  | { status: 'prepared'; prepared: number; requested: number; limitedByFirstBatch: boolean }
  | { status: 'paused' }
  | { status: 'first_batch_gate'; opensAt: string | null }

export type FinalReminderSweepState = { due: boolean; paused: boolean; lastEventId: string | null; newRiskEvents: boolean }

export type FinalStartResult ={ status: 'started'; started: number } | { status: 'paused' }

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DELIVERED_SQL = DELIVERED_EVENT_TYPES.map((type) => `'${type}'`).join(', ')
/** Not a final reminder for any rule: cancelled before it was ever handed to the worker. */
const ACTIVE_FINAL_SQL = `not (final.status = 'cancelled' and final.attempts = 0)`

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function iso(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function status(value: unknown): LegacyInviteStatus {
  return ['prepared', 'queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'].includes(String(value))
    ? value as LegacyInviteStatus
    : 'failed'
}

/**
 * SQL for "this address has a final reminder" (one that is not cancelled-before-sending), for `emailSql`. The first
 * invitation and the second reminder use it at prepare time and at send time: after a final reminder, no more legacy
 * emails to that address.
 */
export function hasFinalReminderSql(emailSql: string) {
  return `exists (
    select 1 from public.legacy_profile_invite_final_reminders final
    where lower(final.email) = lower(${emailSql})
      and ${ACTIVE_FINAL_SQL}
  )`
}

/**
 * The rule a first invitation (alias `invite`, with its second reminder as alias `reminder`, possibly null) fails
 * first, or 'eligible'. Emails compare case-insensitively. `includeFinal` is false when checking a final reminder that
 * already exists (at send time).
 *
 * Round DB: "already has a final reminder" is three EXISTS (by invite, by reminder, by email), each served by its own
 * index, instead of one EXISTS over an OR that no single index serves; the claims lookups by lower(email) use
 * legacy_profile_claims_email_lookup_idx (migration 0100). Same answers, proven against the frozen previous SQL in
 * legacy-final-reminder.integration.test.ts.
 */
export function finalReminderExclusionSql(includeFinal: boolean) {
  const messageIds = `(invite.resend_message_id, reminder.resend_message_id)`
  return `
    case
      when invite.status <> 'sent' or invite.sent_at is null then 'first_not_sent'
      when reminder.id is null or reminder.status <> 'sent' or reminder.sent_at is null then 'reminder_not_sent'
      ${includeFinal ? `when exists (
        select 1 from public.legacy_profile_invite_final_reminders final
        where final.invite_id = invite.id and ${ACTIVE_FINAL_SQL}
      ) or exists (
        select 1 from public.legacy_profile_invite_final_reminders final
        where final.reminder_id = reminder.id and ${ACTIVE_FINAL_SQL}
      ) or exists (
        select 1 from public.legacy_profile_invite_final_reminders final
        where lower(final.email) = lower(invite.email) and ${ACTIVE_FINAL_SQL}
      ) then 'already_final'` : ''}
      when reminder.sent_at > now() - interval '14 days' then 'too_recent'
      when exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = lower(invite.email) and suppression.reason <> 'unsubscribed'
      ) or exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id in ${messageIds}
          and event.event_type in ('bounced', 'complained', 'suppressed')
      ) then 'bounced_or_suppressed'
      when (
        invite.delivered_at is null and not exists (
          select 1 from public.email_delivery_events event
          where event.resend_email_id = invite.resend_message_id and event.event_type in (${DELIVERED_SQL})
        )
      ) or not exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id = reminder.resend_message_id and event.event_type in (${DELIVERED_SQL})
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
      when (
        select count(distinct claim.profile_id) from public.legacy_profile_claims claim
        where lower(claim.email) = lower(invite.email)
      ) > 1 then 'duplicate_email'
      else 'eligible'
    end
  `
}

/** Whether the mode must pause, from the counts of final reminders sent, bounced and complained about. */
export function finalReminderPauseReason(input: { sent: number; bounced: number; complained: number }): string | null {
  const { sent, bounced, complained } = input
  if (sent <= 0) return null
  const percent = (count: number) => `${(Math.round((count / sent) * 10000) / 100).toFixed(2)}%`
  // Whole-number comparisons, so a rate exactly at a threshold never pauses.
  if (complained * 1000 > sent) return `Complaint rate ${percent(complained)} is above 0.1% (${complained} of ${sent} sent)`
  if (bounced * 100 > sent * 3) return `Bounce rate ${percent(bounced)} is above 3% (${bounced} of ${sent} sent)`
  return null
}

const RATES_SQL = `
  select
    count(*) filter (where final.status = 'sent' and final.resend_message_id is not null) as sent,
    count(*) filter (where final.resend_message_id is not null and exists (
      select 1 from public.email_delivery_events event
      where event.resend_email_id = final.resend_message_id and event.event_type = 'bounced'
    )) as bounced,
    count(*) filter (where final.resend_message_id is not null and exists (
      select 1 from public.email_delivery_events event
      where event.resend_email_id = final.resend_message_id and event.event_type = 'complained'
    )) as complained
  from public.legacy_profile_invite_final_reminders final
`

const FIRST_BATCH_SQL = `
  with batch as (
    select final.*
    from public.legacy_profile_invite_final_reminders final
    where ${ACTIVE_FINAL_SQL}
    order by final.created_at, final.id
    limit ${FINAL_REMINDER_FIRST_BATCH}
  )
  select
    count(*) as size,
    count(*) filter (where batch.status in ('sent', 'failed', 'skipped', 'cancelled')) as finished,
    max(batch.sent_at) as last_sent_at,
    max(batch.sent_at) + make_interval(hours => ${FINAL_REMINDER_FIRST_BATCH_WAIT_HOURS}) as opens_at,
    max(batch.sent_at) + make_interval(hours => ${FINAL_REMINDER_FIRST_BATCH_WAIT_HOURS}) <= now() as waited,
    count(*) filter (where batch.delivered_at is not null or exists (
      select 1 from public.email_delivery_events event
      where event.resend_email_id = batch.resend_message_id and event.event_type in (${DELIVERED_SQL})
    )) as delivered,
    count(*) filter (where exists (
      select 1 from public.email_delivery_events event
      where event.resend_email_id = batch.resend_message_id and event.event_type = 'bounced'
    )) as bounced,
    count(*) filter (where exists (
      select 1 from public.email_delivery_events event
      where event.resend_email_id = batch.resend_message_id and event.event_type = 'complained'
    )) as complained,
    count(*) filter (where batch.first_clicked_at is not null) as clicked
  from batch
`

type FirstBatchRow = {
  size: string | number
  finished: string | number
  last_sent_at: string | Date | null
  opens_at: string | Date | null
  waited: boolean | null
  delivered: string | number
  bounced: string | number
  complained: string | number
  clicked: string | number
}

function firstBatch(row: FirstBatchRow | undefined): FinalReminderFirstBatch {
  const size = num(row?.size)
  const finished = num(row?.finished)
  const lastSentAt = iso(row?.last_sent_at)
  const complete = size >= FINAL_REMINDER_FIRST_BATCH && finished >= size
  // A finished batch with nothing sent has nothing to wait for.
  const open = complete && (lastSentAt === null || row?.waited === true)
  return {
    size,
    finished,
    lastSentAt,
    opensAt: complete && !open ? iso(row?.opens_at) : null,
    open,
    delivered: num(row?.delivered),
    bounced: num(row?.bounced),
    complained: num(row?.complained),
    clicked: num(row?.clicked),
  }
}

function clientQuery(client: DatabaseQueryClient): Query {
  return async <T extends QueryResultRow>(text: string, values?: readonly unknown[]) => (await client.query<T>(text, values ? [...values] : undefined)).rows
}

export function createLegacyFinalReminderRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const transaction: Transaction = input.transaction ?? ((work) => withTransaction((client) => work(clientQuery(client))))

  async function readControls(run: Query, lock = false) {
    const rows = await run<{ paused: boolean; resumed_at: string | Date | null }>(
      `select paused, resumed_at from public.legacy_final_reminder_controls where id = 1${lock ? ' for update' : ''}`,
    )
    // A missing controls row counts as paused (fail closed).
    return rows[0] ?? { paused: true, resumed_at: null }
  }

  async function rates(run: Query): Promise<FinalReminderRates> {
    const row = (await run<{ sent: string | number; bounced: string | number; complained: string | number }>(RATES_SQL))[0]
    const sent = num(row?.sent)
    const bounced = num(row?.bounced)
    const complained = num(row?.complained)
    return {
      sent,
      bounced,
      complained,
      bounceRate: sent > 0 ? bounced / sent : 0,
      complaintRate: sent > 0 ? complained / sent : 0,
    }
  }

  return {
    /** Eligible count and the count for each exclusion reason, before anything is prepared. */
    async breakdown(): Promise<FinalReminderBreakdown> {
      const rows = await queryRows<{ reason: string; count: string | number }>(`
        select reason, count(*) as count
        from (
          select ${finalReminderExclusionSql(true)} as reason
          from public.legacy_profile_invites invite
          left join public.legacy_profile_invite_reminders reminder on reminder.invite_id = invite.id
        ) classified
        group by reason
      `)
      const excluded = Object.fromEntries(FINAL_REMINDER_EXCLUSIONS.map(([key]) => [key, 0])) as Record<FinalReminderExclusion, number>
      let eligible = 0
      let total = 0
      for (const row of rows) {
        const count = num(row.count)
        total += count
        if (row.reason === 'eligible') eligible = count
        else if (row.reason in excluded) excluded[row.reason as FinalReminderExclusion] = count
      }
      return { total, eligible, excluded }
    },

    async metrics(): Promise<FinalReminderMetrics> {
      const rows = await queryRows<{ status: string; count: string | number }>(`
        select status, count(*) as count from public.legacy_profile_invite_final_reminders group by status
      `)
      const metrics: FinalReminderMetrics = { prepared: 0, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0 }
      for (const row of rows) metrics[status(row.status)] += num(row.count)
      return metrics
    },

    async controls(): Promise<FinalReminderControls> {
      const rows = await queryRows<{
        paused: boolean
        paused_reason: string | null
        paused_at: string | Date | null
        resumed_at: string | Date | null
        resumed_by_name: string | null
      }>(`
        select controls.paused, controls.paused_reason, controls.paused_at, controls.resumed_at, profile.full_name as resumed_by_name
        from public.legacy_final_reminder_controls controls
        left join public.profiles profile on profile.id = controls.resumed_by
        where controls.id = 1
      `)
      const row = rows[0]
      return {
        paused: row ? Boolean(row.paused) : true,
        pausedReason: row?.paused_reason ?? (row ? null : 'The pause controls are missing.'),
        pausedAt: iso(row?.paused_at),
        resumedAt: iso(row?.resumed_at),
        resumedByName: row?.resumed_by_name ?? null,
      }
    },

    /** Sent, bounced and complained-about final reminders, and the two rates the auto-pause watches. */
    rates(): Promise<FinalReminderRates> {
      return rates(queryRows)
    },

    async firstBatch(): Promise<FinalReminderFirstBatch> {
      return firstBatch((await queryRows<FirstBatchRow>(FIRST_BATCH_SQL))[0])
    },

    /** Profiles claimed within 30 days after that person's first click on the final reminder's button. */
    async claimsFromClicks(): Promise<number> {
      const rows = await queryRows<{ count: string | number }>(`
        select count(*) as count
        from public.legacy_profile_invite_final_reminders final
        where final.first_clicked_at is not null
          and exists (
            select 1 from public.legacy_profile_claims claim
            where (claim.profile_id = final.profile_id or lower(claim.email) = lower(final.email))
              and claim.claimed_at >= final.first_clicked_at
              and claim.claimed_at <= final.first_clicked_at + interval '30 days'
          )
      `)
      return num(rows[0]?.count)
    },

    /**
     * Prepares up to `limit` eligible people (10, 50 or 100). Refused while the mode is paused. Until the first batch
     * of 100 has finished and 24 hours have passed since its last send, only the rest of that first batch can be
     * prepared. Serialised with an advisory lock so two clicks cannot both pass the checks.
     */
    async prepareEligible(limit: number, adminId: string): Promise<FinalPrepareResult> {
      const requested = Math.max(1, Math.min(100, Math.floor(limit)))
      return transaction(async (run) => {
        await run(`select pg_advisory_xact_lock(hashtextextended('legacy-final-reminder-prepare', 0))`)
        if ((await readControls(run)).paused) return { status: 'paused' as const }
        const gate = firstBatch((await run<FirstBatchRow>(FIRST_BATCH_SQL))[0])
        let bounded = requested
        if (!gate.open) {
          const room = FINAL_REMINDER_FIRST_BATCH - gate.size
          if (room <= 0) return { status: 'first_batch_gate' as const, opensAt: gate.opensAt }
          bounded = Math.min(requested, room)
        }
        const rows = await run<{ id: string }>(`
          with eligible as (
            select invite.id as invite_id, reminder.id as reminder_id, invite.profile_id, lower(invite.email) as email
            from public.legacy_profile_invites invite
            join public.legacy_profile_invite_reminders reminder on reminder.invite_id = invite.id
            where (${finalReminderExclusionSql(true)}) = 'eligible'
            order by lower(invite.email)
            limit $2
          )
          insert into public.legacy_profile_invite_final_reminders (
            invite_id, reminder_id, profile_id, email, queued_by, status, attempts, next_attempt_at
          )
          select eligible.invite_id, eligible.reminder_id, eligible.profile_id, eligible.email, $1, 'prepared', 0, now()
          from eligible
          on conflict (invite_id) do update
            set status = 'prepared',
                queued_by = excluded.queued_by,
                queued_at = now(),
                next_attempt_at = now(),
                last_error = null,
                skipped_at = null,
                updated_at = now()
            where public.legacy_profile_invite_final_reminders.status = 'cancelled'
              and public.legacy_profile_invite_final_reminders.attempts = 0
          returning id
        `, [adminId, bounded])
        return { status: 'prepared' as const, prepared: rows.length, requested, limitedByFirstBatch: bounded < requested }
      })
    },

    /** Moves prepared final reminders to the send queue. Refused while the mode is paused. */
    async startPrepared(): Promise<FinalStartResult> {
      return transaction(async (run) => {
        if ((await readControls(run, true)).paused) return { status: 'paused' as const }
        const rows = await run<{ id: string }>(`
          update public.legacy_profile_invite_final_reminders
          set status = 'queued', next_attempt_at = now(), updated_at = now()
          where status = 'prepared'
          returning id
        `)
        return { status: 'started' as const, started: rows.length }
      })
    },

    async cancelPrepared() {
      const rows = await queryRows<{ id: string }>(`
        update public.legacy_profile_invite_final_reminders
        set status = 'cancelled', last_error = 'cancelled_by_admin_before_send', skipped_at = now(), updated_at = now()
        where status = 'prepared'
        returning id
      `)
      return rows.length
    },

    async stopUnsent() {
      const rows = await queryRows<{ id: string }>(`
        update public.legacy_profile_invite_final_reminders
        set status = 'cancelled', last_error = 'stopped_by_admin_before_delivery', skipped_at = now(), updated_at = now()
        where status = 'queued'
        returning id
      `)
      return rows.length
    },

    /**
     * Pauses the mode, persisted with its reason and time, when the complaint rate is above 0.1% or the bounce rate
     * above 3% of the final reminders sent. After a Resume, it pauses again only on a new bounce or complaint, so a
     * Resume is not undone by the same events. Returns whether the mode is paused now.
     */
    async autoPauseIfNeeded(): Promise<{ paused: boolean; pausedNow: boolean }> {
      return transaction(async (run) => {
        const controls = await readControls(run, true)
        if (controls.paused) return { paused: true, pausedNow: false }
        const reason = finalReminderPauseReason(await rates(run))
        if (!reason) return { paused: false, pausedNow: false }
        if (controls.resumed_at) {
          const fresh = await run(`
            select 1
            from public.email_delivery_events event
            join public.legacy_profile_invite_final_reminders final on final.resend_message_id = event.resend_email_id
            where event.event_type in ('bounced', 'complained') and event.recorded_at > $1::timestamptz
            limit 1
          `, [iso(controls.resumed_at)])
          if (!fresh.length) return { paused: false, pausedNow: false }
        }
        await run(`
          update public.legacy_final_reminder_controls
          set paused = true, paused_reason = left($1, 300), paused_at = now(), updated_at = now()
          where id = 1
        `, [reason])
        return { paused: true, pausedNow: true }
      })
    },

    /** Lifts a pause. The caller checks the administrator and the admin step-up; this records who and when. */
    async resume(adminId: string) {
      const rows = await queryRows<{ id: number }>(`
        update public.legacy_final_reminder_controls
        set paused = false, resumed_by = $1::uuid, resumed_at = now(), updated_at = now()
        where id = 1 and paused = true
        returning id
      `, [adminId])
      return rows.length > 0
    },

    /**
     * Claims up to `limit` queued final reminders (at most 5) and re-checks every rule for each one at send time.
     * Claims nothing while the mode is paused.
     */
    /**
     * Owner (17 Nov): what a sweep needs to know before the bounce and complaint rates (a count over every final
     * reminder, about 21 ms; 12% of database time in the 14-16 Nov report, read on every idle sweep after the final
     * reminder had finished). In one cheap read: whether any final reminder is due to send, whether the mode is
     * paused, the newest delivery event id, and whether a bounce or complaint for a final reminder has arrived after
     * `afterEventId` (only the new event rows are read, by primary key). The rates can only rise through a send or
     * such an event, so the worker reads them only then.
     */
    async sweepState(afterEventId: string): Promise<FinalReminderSweepState> {
      const [row] = await queryRows<{ due: boolean; paused: boolean; last_event_id: string | null; new_risk_events: boolean }>(`
        select
          exists (
            select 1
            from public.legacy_profile_invite_final_reminders final
            where final.status = 'queued'
              and final.attempts < 3
              and final.next_attempt_at <= now()
          ) as due,
          coalesce((select controls.paused from public.legacy_final_reminder_controls controls where controls.id = 1), false) as paused,
          (select max(event.id)::text from public.email_delivery_events event where event.id > $1::bigint) as last_event_id,
          exists (
            select 1
            from public.email_delivery_events event
            join public.legacy_profile_invite_final_reminders final on final.resend_message_id = event.resend_email_id
            where event.id > $1::bigint and event.event_type in ('bounced', 'complained')
          ) as new_risk_events
      `, [afterEventId])
      return {
        due: row?.due === true,
        paused: row?.paused === true,
        lastEventId: row?.last_event_id ?? null,
        newRiskEvents: row?.new_risk_events === true,
      }
    },

    async claimBatch(limit = 5): Promise<FinalReminderDelivery[]> {
      const bounded = Math.max(1, Math.min(5, Math.floor(limit)))
      return transaction(async (run) => {
        if ((await readControls(run, true)).paused) return []
        const rows = await run<{
          id: string
          email: string
          click_token: string
          unsubscribe_token: string
          attempts: number
          full_name: string
          still_eligible: boolean
        }>(`
          with picked as (
            select final.id
            from public.legacy_profile_invite_final_reminders final
            where final.status = 'queued'
              and final.attempts < 3
              and final.next_attempt_at <= now()
            order by final.queued_at, final.id
            for update skip locked
            limit $1
          ),
          claimed as (
            update public.legacy_profile_invite_final_reminders final
            set status = 'sending', attempts = final.attempts + 1, last_attempt_at = now(), updated_at = now()
            from picked
            where final.id = picked.id
            returning final.*
          )
          select
            claimed.id,
            claimed.email,
            claimed.click_token::text,
            claimed.unsubscribe_token::text,
            claimed.attempts,
            profile.full_name,
            (${finalReminderExclusionSql(false)}) = 'eligible' as still_eligible
          from claimed
          join public.legacy_profile_invites invite on invite.id = claimed.invite_id
          join public.legacy_profile_invite_reminders reminder on reminder.id = claimed.reminder_id
          join public.profiles profile on profile.id = claimed.profile_id
        `, [bounded])
        return rows.map((row) => ({
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          clickToken: row.click_token,
          unsubscribeToken: row.unsubscribe_token,
          attempts: row.attempts,
          stillEligible: Boolean(row.still_eligible),
        }))
      })
    },

    /** Returns a claimed final reminder that was not tried to the queue, as if it had not been claimed. */
    async release(id: string) {
      await queryRows(`
        update public.legacy_profile_invite_final_reminders
        set status = 'queued', attempts = greatest(0, attempts - 1), updated_at = now()
        where id = $1 and status = 'sending'
      `, [id])
    },

    async markSent(id: string, messageId: string) {
      await queryRows(`
        update public.legacy_profile_invite_final_reminders
        set status = 'sent', resend_message_id = $2, last_error = null, sent_at = now(), updated_at = now()
        where id = $1
      `, [id, messageId])
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(`
        update public.legacy_profile_invite_final_reminders
        set status = 'skipped', last_error = left($2, 500), skipped_at = now(), updated_at = now()
        where id = $1
      `, [id, reason])
    },

    /** A retryable failure goes back to the queue with a delay (up to 3 attempts); anything else stays failed. */
    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(`
        update public.legacy_profile_invite_final_reminders
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

    /**
     * The claim button's click: records the first click time and counts every click, then returns the first
     * invitation's claim token for the redirect. Null for an unknown or malformed token (nothing changes).
     */
    async recordClick(clickToken: string): Promise<string | null> {
      if (!UUID.test(clickToken)) return null
      const rows = await queryRows<{ claim_token: string }>(`
        update public.legacy_profile_invite_final_reminders final
        set first_clicked_at = coalesce(final.first_clicked_at, now()),
            click_count = final.click_count + 1,
            updated_at = now()
        from public.legacy_profile_invites invite
        where final.click_token = $1::uuid and invite.id = final.invite_id
        returning invite.claim_token::text as claim_token
      `, [clickToken])
      return rows[0]?.claim_token ?? null
    },
  }
}

export const legacyFinalReminderRepository = createLegacyFinalReminderRepository()
