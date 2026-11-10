import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { SuppressionReason } from '@/lib/email/suppression'
import { DELIVERED_EVENT_TYPES, suppressionReasonFor, type DeliveryEvent } from './events'

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>

export type BackfillProgress = { total: number; checked: number; remaining: number }

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** A first invitation is backfilled once its status has settled: a day after it was handed to Resend. */
const BACKFILL_SETTLED_SQL = `status = 'sent' and resend_message_id is not null and sent_at < now() - interval '1 day'`

/**
 * Records a delivery event in one transaction:
 *   1. the general email log (public.email_delivery_events): a webhook delivery is kept once per svix-id and a
 *      backfilled status once per email, so retries and re-runs change nothing;
 *   2. the "Last event" of the legacy invitation, second reminder or final reminder the email was (and, for the
 *      invitation and the final reminder, when it was delivered). A newer event wins; the backfill only
 *      fills a row that has no event yet, so it never overwrites what the webhook recorded. An invitation with any
 *      recorded event counts as checked, so the backfill does not fetch it;
 *   3. the do-not-email list, for a hard bounce, a complaint or a suppression.
 */
async function record(client: DatabaseQueryClient, event: DeliveryEvent) {
  const inserted = await client.query<{ id: string }>(
    `insert into public.email_delivery_events (
       provider_event_id, source, event_type, resend_email_id, recipient, category,
       bounce_type, bounce_sub_type, detail, occurred_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict do nothing
     returning id`,
    [
      event.providerEventId, event.source, event.type, event.resendEmailId, event.recipients[0] ?? null, event.category,
      event.bounceType, event.bounceSubType, event.detail, event.occurredAt.toISOString(),
    ],
  )
  if (!inserted.rows.length) return { status: 'duplicate' as const, suppressed: 0 }

  const backfill = event.source === 'backfill'
  const values = [event.resendEmailId, event.type, event.occurredAt.toISOString(), backfill]
  await client.query(
    `update public.legacy_profile_invites
     set last_event = case
           when $4::boolean and last_event is not null then last_event
           when last_event_at is null or last_event_at <= $3::timestamptz then $2
           else last_event
         end,
         last_event_at = case
           when $4::boolean and last_event is not null then last_event_at
           when last_event_at is null or last_event_at <= $3::timestamptz then $3::timestamptz
           else last_event_at
         end,
         delivered_at = case when $2 = any($5::text[]) then coalesce(delivered_at, $3::timestamptz) else delivered_at end,
         delivery_checked_at = coalesce(delivery_checked_at, now()),
         updated_at = now()
     where resend_message_id = $1`,
    [...values, [...DELIVERED_EVENT_TYPES]],
  )
  await client.query(
    `update public.legacy_profile_invite_reminders
     set last_event = case
           when $4::boolean and last_event is not null then last_event
           when last_event_at is null or last_event_at <= $3::timestamptz then $2
           else last_event
         end,
         last_event_at = case
           when $4::boolean and last_event is not null then last_event_at
           when last_event_at is null or last_event_at <= $3::timestamptz then $3::timestamptz
           else last_event_at
         end,
         updated_at = now()
     where resend_message_id = $1`,
    values,
  )
  await client.query(
    `update public.legacy_profile_invite_final_reminders
     set last_event = case
           when $4::boolean and last_event is not null then last_event
           when last_event_at is null or last_event_at <= $3::timestamptz then $2
           else last_event
         end,
         last_event_at = case
           when $4::boolean and last_event is not null then last_event_at
           when last_event_at is null or last_event_at <= $3::timestamptz then $3::timestamptz
           else last_event_at
         end,
         delivered_at = case when $2 = any($5::text[]) then coalesce(delivered_at, $3::timestamptz) else delivered_at end,
         updated_at = now()
     where resend_message_id = $1`,
    [...values, [...DELIVERED_EVENT_TYPES]],
  )

  const reason = suppressionReasonFor(event)
  let suppressed = 0
  if (reason) {
    for (const email of event.recipients) {
      const rows = await client.query(
        `insert into public.email_suppressions (email, reason, source, resend_email_id)
         values ($1, $2, $3, $4)
         on conflict (email) do nothing
         returning email`,
        [email, reason, backfill ? 'resend_backfill' : 'resend_webhook', event.resendEmailId],
      )
      suppressed += rows.rows.length
    }
  }
  return { status: 'recorded' as const, suppressed }
}

const ORIGIN_REASON: Record<string, SuppressionReason> = {
  bounce: 'hard_bounce',
  complaint: 'complaint',
}

export function createEmailDeliveryRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  return {
    recordEvent(event: DeliveryEvent) {
      return withTransaction((client) => record(client, event))
    },

    /** First invitations whose final status has not been fetched yet, oldest first. */
    async invitesToBackfill(limit: number) {
      return queryRows<{ id: string; resend_message_id: string; email: string }>(
        `select id, resend_message_id, email
         from public.legacy_profile_invites
         where ${BACKFILL_SETTLED_SQL} and delivery_checked_at is null
         order by sent_at, id
         limit $1`,
        [Math.max(1, Math.min(50, Math.floor(limit)))],
      )
    },

    /** Marks an invitation checked when Resend has no usable status for it, so it is not fetched again. */
    async markBackfillChecked(inviteId: string) {
      await queryRows(
        `update public.legacy_profile_invites set delivery_checked_at = now(), updated_at = now()
         where id = $1 and delivery_checked_at is null`,
        [inviteId],
      )
    },

    async backfillProgress(): Promise<BackfillProgress> {
      const rows = await queryRows<{ total: string | number; checked: string | number }>(
        `select count(*) as total, count(*) filter (where delivery_checked_at is not null) as checked
         from public.legacy_profile_invites
         where ${BACKFILL_SETTLED_SQL}`,
      )
      const total = num(rows[0]?.total)
      const checked = num(rows[0]?.checked)
      return { total, checked, remaining: Math.max(0, total - checked) }
    },

    /** One address from Resend's suppression list. Manual entries count as provider suppressions. */
    async addProviderSuppression(entry: { email: string; origin: string | null; sourceId: string | null }) {
      const rows = await queryRows(
        `insert into public.email_suppressions (email, reason, source, resend_email_id)
         values ($1, $2, 'resend_suppression_list', $3)
         on conflict (email) do nothing
         returning email`,
        [entry.email, ORIGIN_REASON[entry.origin ?? ''] ?? 'provider_suppressed', entry.sourceId?.slice(0, 100) || null],
      )
      return rows.length > 0
    },
  }
}

export const emailDeliveryRepository = createEmailDeliveryRepository()
