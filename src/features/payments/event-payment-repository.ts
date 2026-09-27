import type { QueryResultRow } from 'pg'
import { query, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { EVENT_MANAGER_ACCESS_SQL } from '@/features/events/calendar-repository'
import {
  CHECKOUT_HOLD_MINUTES,
  checkoutBlocker,
  confirmationBlocker,
  eventPrice,
  type EventRegistrationBlocker,
  type PaidEventSnapshot,
} from './event-payment-rules'
import type { EventPaymentOrderStatus, PaymentCurrency, PaymentProviderName } from './types'

export type EventPaymentOrder = {
  id: string
  eventId: string | null
  profileId: string | null
  eventTitle: string
  amountMinor: number
  currency: PaymentCurrency
  provider: PaymentProviderName
  providerOrderId: string | null
  providerPaymentId: string | null
  status: EventPaymentOrderStatus
  registrationConfirmedAt: string | null
  refundDueReason: string | null
  createdAt: string
}

export type OrganizerPaymentRow = EventPaymentOrder & {
  attendeeName: string | null
  attendeeSlug: string | null
  paidAt: string | null
  refundedAt: string | null
}

export type ConfirmPaymentOutcome =
  | { state: 'registered'; order: EventPaymentOrder }
  | { state: 'refund_due'; order: EventPaymentOrder; reason: string }
  | { state: 'refunded'; order: EventPaymentOrder }

export class EventRegistrationError extends Error {
  constructor(readonly code: EventRegistrationBlocker | 'checkout_in_progress' | 'order_not_found') {
    super(code)
    this.name = 'EventRegistrationError'
  }
}

type OrderRow = QueryResultRow & {
  id: string
  event_id: string | null
  profile_id: string | null
  event_title: string
  amount_minor: string | number
  currency: PaymentCurrency
  provider: PaymentProviderName
  provider_order_id: string | null
  provider_payment_id: string | null
  status: EventPaymentOrderStatus
  registration_confirmed_at: string | Date | null
  refund_due_reason: string | null
  created_at: string | Date
}

type EventRow = QueryResultRow & {
  id: string
  host_user_id: string
  title: string
  status: PaidEventSnapshot['status']
  end_at: string | Date
  capacity: number | null
  registration_mode: PaidEventSnapshot['registrationMode']
  registration_closes_at: string | Date | null
  is_paid: boolean | null
  price_minor: string | number | null
  currency: string | null
}

const ORDER_COLUMNS = `
  o.id, o.event_id, o.profile_id, o.event_title, o.amount_minor, o.currency, o.provider,
  o.provider_order_id, o.provider_payment_id, o.status, o.registration_confirmed_at,
  o.refund_due_reason, o.created_at
`

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapOrder(row: OrderRow): EventPaymentOrder {
  return {
    id: row.id,
    eventId: row.event_id,
    profileId: row.profile_id,
    eventTitle: row.event_title,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id,
    status: row.status,
    registrationConfirmedAt: row.registration_confirmed_at ? iso(row.registration_confirmed_at) : null,
    refundDueReason: row.refund_due_reason,
    createdAt: iso(row.created_at),
  }
}

function mapEvent(row: EventRow | undefined): PaidEventSnapshot | null {
  if (!row) return null
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    title: row.title,
    status: row.status,
    endAt: new Date(row.end_at),
    capacity: row.capacity,
    registrationMode: row.registration_mode,
    registrationClosesAt: row.registration_closes_at ? new Date(row.registration_closes_at) : null,
    isPaid: Boolean(row.is_paid),
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

async function lockEvent(client: DatabaseQueryClient, eventId: string) {
  const result = await client.query<EventRow>(`
    select id, host_user_id, title, status, end_at, capacity, registration_mode, registration_closes_at,
      is_paid, price_minor, currency
    from public.events
    where id = $1::uuid
    for update
  `, [eventId])
  return mapEvent(result.rows[0])
}

async function attendeeCount(client: DatabaseQueryClient, eventId: string) {
  const result = await client.query<{ count: string } & QueryResultRow>(
    'select count(*)::bigint as count from public.event_attendees where event_id = $1::uuid',
    [eventId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function isRegistered(client: DatabaseQueryClient, eventId: string, profileId: string) {
  const result = await client.query<QueryResultRow>(
    'select 1 from public.event_attendees where event_id = $1::uuid and user_id = $2::uuid',
    [eventId, profileId],
  )
  return Boolean(result.rows[0])
}

async function heldSeatsByOthers(client: DatabaseQueryClient, eventId: string, profileId: string) {
  const result = await client.query<{ count: string } & QueryResultRow>(`
    select count(*)::bigint as count
    from public.event_payment_orders
    where event_id = $1::uuid
      and profile_id <> $2::uuid
      and status = 'created'
      and created_at > now() - make_interval(mins => $3::integer)
  `, [eventId, profileId, CHECKOUT_HOLD_MINUTES])
  return Number(result.rows[0]?.count ?? 0)
}

/**
 * Checks every registration rule with the event row locked, then reuses the
 * attendee's open checkout or records a new one. The amount always comes from
 * the event row, never from the browser.
 */
async function prepareCheckoutOrder(input: { profileId: string; eventId: string; provider: PaymentProviderName; now?: Date }) {
  const now = input.now ?? new Date()
  try {
    return await withTransaction(async (client) => {
      const event = await lockEvent(client, input.eventId)
      const blocker = checkoutBlocker({
        event,
        profileId: input.profileId,
        alreadyRegistered: event ? await isRegistered(client, event.id, input.profileId) : false,
        attendeeCount: event ? await attendeeCount(client, event.id) : 0,
        heldSeats: event ? await heldSeatsByOthers(client, event.id, input.profileId) : 0,
        now,
      })
      if (blocker) throw new EventRegistrationError(blocker)
      const price = eventPrice(event!)!

      const open = await client.query<OrderRow>(`
        select ${ORDER_COLUMNS}
        from public.event_payment_orders o
        where o.event_id = $1::uuid and o.profile_id = $2::uuid and o.status = 'created'
        for update
      `, [input.eventId, input.profileId])
      const existing = open.rows[0] ? mapOrder(open.rows[0]) : null
      if (existing) {
        const ageMs = now.getTime() - Date.parse(existing.createdAt)
        const samePrice = existing.amountMinor === price.amountMinor && existing.currency === price.currency
        if (samePrice && existing.providerOrderId && ageMs < CHECKOUT_HOLD_MINUTES * 60_000) {
          return { order: existing, reused: true }
        }
        if (!existing.providerOrderId && ageMs < 60_000) throw new EventRegistrationError('checkout_in_progress')
        await client.query(`
          update public.event_payment_orders
          set status = 'cancelled', failure_reason = 'superseded', updated_at = now()
          where id = $1::uuid and status = 'created'
        `, [existing.id])
      }

      const inserted = await client.query<OrderRow>(`
        insert into public.event_payment_orders as o (event_id, profile_id, event_title, amount_minor, currency, provider)
        values ($1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text)
        returning ${ORDER_COLUMNS}
      `, [input.eventId, input.profileId, event!.title, price.amountMinor, price.currency, input.provider])
      const row = inserted.rows[0]
      if (!row) throw new Error('event_payment_order_insert_failed')
      return { order: mapOrder(row), reused: false }
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new EventRegistrationError('checkout_in_progress')
    throw error
  }
}

async function attachProviderOrder(orderId: string, providerOrderId: string) {
  const rows = await query<OrderRow>(`
    update public.event_payment_orders o
    set provider_order_id = $2::text, updated_at = now()
    where o.id = $1::uuid and o.status = 'created' and o.provider_order_id is null
    returning ${ORDER_COLUMNS}
  `, [orderId, providerOrderId])
  if (!rows[0]) throw new EventRegistrationError('order_not_found')
  return mapOrder(rows[0])
}

async function markOrderFailed(orderId: string, reason: string) {
  await query(`
    update public.event_payment_orders
    set status = 'failed', failure_reason = left($2::text, 500), updated_at = now()
    where id = $1::uuid and status = 'created'
  `, [orderId, reason])
}

async function markFailedByProviderOrder(client: DatabaseQueryClient, provider: PaymentProviderName, providerOrderId: string, reason: string) {
  await client.query(`
    update public.event_payment_orders
    set status = 'failed', failure_reason = left($3::text, 500), updated_at = now()
    where provider = $1::text and provider_order_id = $2::text and status = 'created'
  `, [provider, providerOrderId, reason])
}

async function getOrderForProfile(orderId: string, profileId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.id = $1::uuid and o.profile_id = $2::uuid
    limit 1
  `, [orderId, profileId])
  return rows[0] ? mapOrder(rows[0]) : null
}

async function findOrderByProviderOrderId(client: DatabaseQueryClient, provider: PaymentProviderName, providerOrderId: string) {
  const result = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.provider = $1::text and o.provider_order_id = $2::text
    limit 1
  `, [provider, providerOrderId])
  return result.rows[0] ? mapOrder(result.rows[0]) : null
}

/**
 * Records a successful payment and confirms the seat when the event rules still
 * allow it. Idempotent: calling it again for an order that is already paid or
 * refunded returns the stored outcome without changing anything.
 */
async function confirmPaidOrder(
  client: DatabaseQueryClient,
  input: { orderId: string; providerPaymentId: string; amountMinor?: number; currency?: string; now?: Date },
): Promise<ConfirmPaymentOutcome> {
  const now = input.now ?? new Date()
  const locked = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.id = $1::uuid
    for update
  `, [input.orderId])
  const current = locked.rows[0] ? mapOrder(locked.rows[0]) : null
  if (!current) throw new EventRegistrationError('order_not_found')
  if (current.status === 'refunded') return { state: 'refunded', order: current }
  if (current.status === 'paid') {
    return current.registrationConfirmedAt
      ? { state: 'registered', order: current }
      : { state: 'refund_due', order: current, reason: current.refundDueReason ?? 'unknown' }
  }

  const amountMatches = input.amountMinor === undefined
    || (input.amountMinor === current.amountMinor && input.currency === current.currency)

  await client.query(`
    update public.event_payment_orders
    set status = 'paid', provider_payment_id = $2::text, paid_at = coalesce(paid_at, now()), failure_reason = null, updated_at = now()
    where id = $1::uuid
  `, [current.id, input.providerPaymentId])

  let reason: string | null = amountMatches ? null : 'amount_mismatch'
  if (!reason) {
    const event = current.eventId ? await lockEvent(client, current.eventId) : null
    const registered = event && current.profileId ? await isRegistered(client, event.id, current.profileId) : false
    reason = !current.profileId
      ? 'event_not_found'
      : confirmationBlocker({
          event,
          alreadyRegistered: registered,
          attendeeCount: event ? await attendeeCount(client, event.id) : 0,
          now,
        })
  }

  if (reason) {
    const updated = await client.query<OrderRow>(`
      update public.event_payment_orders o
      set refund_due_reason = $2::text, updated_at = now()
      where o.id = $1::uuid
      returning ${ORDER_COLUMNS}
    `, [current.id, reason])
    return { state: 'refund_due', order: mapOrder(updated.rows[0]!), reason }
  }

  await client.query(`
    insert into public.event_attendees (event_id, user_id, payment_order_id)
    values ($1::uuid, $2::uuid, $3::uuid)
    on conflict (event_id, user_id) do nothing
  `, [current.eventId, current.profileId, current.id])
  const confirmed = await client.query<OrderRow>(`
    update public.event_payment_orders o
    set registration_confirmed_at = now(), refund_due_reason = null, updated_at = now()
    where o.id = $1::uuid
    returning ${ORDER_COLUMNS}
  `, [current.id])
  return { state: 'registered', order: mapOrder(confirmed.rows[0]!) }
}

/** Marks a payment refunded and releases the seat it paid for. Idempotent. */
async function markOrderRefunded(client: DatabaseQueryClient, orderId: string) {
  const result = await client.query<OrderRow>(`
    update public.event_payment_orders o
    set status = 'refunded', refunded_at = coalesce(refunded_at, now()), updated_at = now()
    where o.id = $1::uuid and o.status in ('paid', 'refunded')
    returning ${ORDER_COLUMNS}
  `, [orderId])
  await client.query('delete from public.event_attendees where payment_order_id = $1::uuid', [orderId])
  return result.rows[0] ? mapOrder(result.rows[0]) : null
}

async function findOrderByProviderPaymentId(client: DatabaseQueryClient, provider: PaymentProviderName, providerPaymentId: string) {
  const result = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.provider = $1::text and o.provider_payment_id = $2::text
    limit 1
  `, [provider, providerPaymentId])
  return result.rows[0] ? mapOrder(result.rows[0]) : null
}

/** Returns false when this webhook delivery was already processed. */
async function recordWebhookEvent(client: DatabaseQueryClient, provider: PaymentProviderName, providerEventId: string, eventType: string) {
  const result = await client.query<QueryResultRow>(`
    insert into public.payment_webhook_events (provider, provider_event_id, event_type)
    values ($1::text, $2::text, $3::text)
    on conflict (provider, provider_event_id) do nothing
    returning provider_event_id
  `, [provider, providerEventId.slice(0, 200), eventType.slice(0, 120)])
  return Boolean(result.rows[0])
}

type OrganizerRow = OrderRow & {
  attendee_name: string | null
  attendee_slug: string | null
  paid_at: string | Date | null
  refunded_at: string | Date | null
}

/** Payment orders for one event, visible only to the event's host and organisation event managers. */
async function listEventPaymentsForManager(managerId: string, eventId: string): Promise<OrganizerPaymentRow[]> {
  const rows = await query<OrganizerRow>(`
    select ${ORDER_COLUMNS}, p.full_name as attendee_name, p.slug as attendee_slug, o.paid_at, o.refunded_at
    from public.event_payment_orders o
    join public.events e on e.id = o.event_id
    left join public.profiles p on p.id = o.profile_id
    where o.event_id = $2::uuid
      and o.status <> 'cancelled'
      and ${EVENT_MANAGER_ACCESS_SQL}
    order by coalesce(o.paid_at, o.created_at) desc
    limit 500
  `, [managerId, eventId])
  return rows.map((row) => ({
    ...mapOrder(row),
    attendeeName: row.attendee_name,
    attendeeSlug: row.attendee_slug,
    paidAt: row.paid_at ? iso(row.paid_at) : null,
    refundedAt: row.refunded_at ? iso(row.refunded_at) : null,
  }))
}

async function countPaidOrdersForEvent(eventId: string) {
  const rows = await query<{ count: string } & QueryResultRow>(`
    select count(*)::bigint as count
    from public.event_payment_orders
    where event_id = $1::uuid and status = 'paid'
  `, [eventId])
  return Number(rows[0]?.count ?? 0)
}

export const eventPaymentRepository = {
  prepareCheckoutOrder,
  attachProviderOrder,
  markOrderFailed,
  markFailedByProviderOrder,
  getOrderForProfile,
  findOrderByProviderOrderId,
  findOrderByProviderPaymentId,
  confirmPaidOrder,
  markOrderRefunded,
  recordWebhookEvent,
  listEventPaymentsForManager,
  countPaidOrdersForEvent,
}
