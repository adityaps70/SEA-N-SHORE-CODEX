import type { QueryResultRow } from 'pg'
import { query, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { EVENT_MANAGER_ACCESS_SQL } from '@/features/events/calendar-repository'
import { planVisibleSql } from '@/features/billing/plan-visibility'
import { recordPaymentAudit, type PaymentAuditActorType } from './audit'
import { recordSaleEarning, reverseSaleEarning } from './earnings'
import {
  CHECKOUT_HOLD_MINUTES,
  checkoutBlocker,
  confirmationBlocker,
  eventPrice,
  type EventRegistrationBlocker,
  type PaidEventSnapshot,
} from './event-payment-rules'
import type { EventPaymentOrderStatus, PaymentCurrency, PaymentProviderName } from './types'
import { orderUuidFromGatewayOrderId } from './order-ids'
import { recordWebhookDelivery } from './webhook-deliveries'

export type EventRefundStatus = 'requested' | 'pending' | 'processed' | 'failed'

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
  /** Cashfree payment_session_id for reopening the same checkout. */
  providerSessionId: string | null
  status: EventPaymentOrderStatus
  registrationConfirmedAt: string | null
  refundDueReason: string | null
  refundStatus: EventRefundStatus | null
  refundAttempts: number
  providerRefundId: string | null
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

/** Who caused a change, for the payment audit trail. */
export type PaymentActor = { type: PaymentAuditActorType; profileId?: string | null }

export class EventRegistrationError extends Error {
  constructor(readonly code: EventRegistrationBlocker | 'checkout_in_progress' | 'order_not_found' | 'refund_not_allowed' | 'refund_in_progress') {
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
  provider_session_id?: string | null
  status: EventPaymentOrderStatus
  registration_confirmed_at: string | Date | null
  refund_due_reason: string | null
  refund_status?: EventRefundStatus | null
  refund_attempts?: number | string | null
  provider_refund_id?: string | null
  created_at: string | Date
}

type EventRow = QueryResultRow & {
  id: string
  host_user_id: string
  company_id?: string | null
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
  o.provider_order_id, o.provider_payment_id, o.provider_session_id, o.status, o.registration_confirmed_at,
  o.refund_due_reason, o.refund_status, o.refund_attempts, o.provider_refund_id, o.created_at
`

const SUBJECT = 'event_payment_order'
const SYSTEM: PaymentActor = { type: 'system' }
/** A refund request older than this is treated as abandoned and may be retried. */
const REFUND_REQUEST_STALE_MINUTES = 5

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
    providerSessionId: row.provider_session_id ?? null,
    status: row.status,
    registrationConfirmedAt: row.registration_confirmed_at ? iso(row.registration_confirmed_at) : null,
    refundDueReason: row.refund_due_reason,
    refundStatus: row.refund_status ?? null,
    refundAttempts: Number(row.refund_attempts ?? 0),
    providerRefundId: row.provider_refund_id ?? null,
    createdAt: iso(row.created_at),
  }
}

function mapEvent(row: EventRow | undefined): PaidEventSnapshot | null {
  if (!row) return null
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    companyId: row.company_id ?? null,
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

async function audit(client: DatabaseQueryClient, order: EventPaymentOrder, action: string, input: {
  actor?: PaymentActor
  fromStatus?: string | null
  toStatus?: string | null
  providerReference?: string | null
  details?: Record<string, unknown>
} = {}) {
  const actor = input.actor ?? SYSTEM
  await recordPaymentAudit(client, {
    actorType: actor.type,
    actorProfileId: actor.profileId ?? null,
    subjectType: SUBJECT,
    subjectId: order.id,
    action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    amountMinor: order.amountMinor,
    currency: order.currency,
    provider: order.provider,
    providerReference: input.providerReference ?? null,
    details: { eventId: order.eventId, ...input.details },
  })
}

async function lockEvent(client: DatabaseQueryClient, eventId: string) {
  const result = await client.query<EventRow>(`
    select id, host_user_id, company_id, title, status, end_at, capacity, registration_mode, registration_closes_at,
      is_paid, price_minor, currency
    from public.events
    where id = $1::uuid
    for update
  `, [eventId])
  return mapEvent(result.rows[0])
}

/**
 * False when the event was removed with its owner's account or the host's plan ended:
 * no new tickets are sold (existing tickets stay valid).
 */
async function planAllowsSales(client: DatabaseQueryClient, eventId: string) {
  const result = await client.query<{ visible: boolean } & QueryResultRow>(
    `select (e.removed_at is null and ${planVisibleSql('event', 'e')}) as visible from public.events e where e.id = $1::uuid`,
    [eventId],
  )
  return result.rows[0]?.visible !== false
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

async function lockOrder(client: DatabaseQueryClient, orderId: string) {
  const locked = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.id = $1::uuid
    for update
  `, [orderId])
  return locked.rows[0] ? mapOrder(locked.rows[0]) : null
}

/**
 * Checks every registration rule with the event row locked, then reuses the
 * attendee's open checkout or records a new one. The amount always comes from
 * the event row, never from the browser. `currencies` = what the gateway can charge.
 */
async function prepareCheckoutOrder(input: {
  profileId: string
  eventId: string
  provider: PaymentProviderName
  currencies?: readonly PaymentCurrency[]
  now?: Date
}) {
  const now = input.now ?? new Date()
  try {
    return await withTransaction(async (client) => {
      const event = await lockEvent(client, input.eventId)
      if (event && !await planAllowsSales(client, event.id)) throw new EventRegistrationError('event_not_found')
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
      if (input.currencies && !input.currencies.includes(price.currency)) {
        throw new EventRegistrationError('event_currency_unsupported')
      }

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
        const sameProvider = existing.provider === input.provider
        if (samePrice && sameProvider && existing.providerOrderId && ageMs < CHECKOUT_HOLD_MINUTES * 60_000) {
          return { order: existing, reused: true }
        }
        if (!existing.providerOrderId && ageMs < 60_000) throw new EventRegistrationError('checkout_in_progress')
        await client.query(`
          update public.event_payment_orders
          set status = 'cancelled', failure_reason = 'superseded', updated_at = now()
          where id = $1::uuid and status = 'created'
        `, [existing.id])
        await audit(client, existing, 'checkout_superseded', { actor: { type: 'member', profileId: input.profileId }, fromStatus: 'created', toStatus: 'cancelled' })
      }

      const inserted = await client.query<OrderRow>(`
        insert into public.event_payment_orders as o (event_id, profile_id, event_title, amount_minor, currency, provider)
        values ($1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text)
        returning ${ORDER_COLUMNS}
      `, [input.eventId, input.profileId, event!.title, price.amountMinor, price.currency, input.provider])
      const row = inserted.rows[0]
      if (!row) throw new Error('event_payment_order_insert_failed')
      const order = mapOrder(row)
      await audit(client, order, 'checkout_started', { actor: { type: 'member', profileId: input.profileId }, toStatus: 'created' })
      return { order, reused: false }
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new EventRegistrationError('checkout_in_progress')
    throw error
  }
}

async function attachProviderOrder(orderId: string, providerOrderId: string, providerSessionId: string | null = null) {
  return withTransaction(async (client) => {
    const result = await client.query<OrderRow>(`
      update public.event_payment_orders o
      set provider_order_id = $2::text, provider_session_id = $3::text, updated_at = now()
      where o.id = $1::uuid and (o.provider_order_id is null or o.provider_order_id = $2::text)
      returning ${ORDER_COLUMNS}
    `, [orderId, providerOrderId, providerSessionId])
    if (!result.rows[0]) throw new EventRegistrationError('order_not_found')
    const order = mapOrder(result.rows[0])
    await audit(client, order, 'gateway_order_created', { providerReference: providerOrderId, toStatus: 'created' })
    return order
  })
}

async function markOrderFailed(orderId: string, reason: string) {
  await withTransaction(async (client) => {
    const result = await client.query<OrderRow>(`
      update public.event_payment_orders o
      set status = 'failed', failure_reason = left($2::text, 500), updated_at = now()
      where o.id = $1::uuid and o.status = 'created'
      returning ${ORDER_COLUMNS}
    `, [orderId, reason])
    if (result.rows[0]) await audit(client, mapOrder(result.rows[0]), 'order_failed', { fromStatus: 'created', toStatus: 'failed', details: { reason } })
  })
}

async function markFailedByProviderOrder(client: DatabaseQueryClient, provider: PaymentProviderName, providerOrderId: string, reason: string) {
  const result = await client.query<OrderRow>(`
    update public.event_payment_orders o
    set status = 'failed', failure_reason = left($3::text, 500), updated_at = now()
    where o.provider = $1::text and o.provider_order_id = $2::text and o.status = 'created'
    returning ${ORDER_COLUMNS}
  `, [provider, providerOrderId, reason])
  if (result.rows[0]) {
    await audit(client, mapOrder(result.rows[0]), 'order_failed', { actor: { type: 'provider' }, fromStatus: 'created', toStatus: 'failed', details: { reason } })
  }
}

/**
 * A payment attempt failed or was abandoned, but the gateway order can still be paid
 * (Cashfree lets the buyer retry in the same checkout). Notes the reason and keeps
 * the order open; the seat hold expires on its own.
 */
async function recordAttemptFailure(client: DatabaseQueryClient, input: {
  provider: PaymentProviderName
  providerOrderId: string
  providerPaymentId: string | null
  reason: string
  dropped: boolean
}) {
  const result = await client.query<OrderRow>(`
    update public.event_payment_orders o
    set failure_reason = left($3::text, 500), updated_at = now()
    where o.provider = $1::text and o.provider_order_id = $2::text and o.status = 'created'
    returning ${ORDER_COLUMNS}
  `, [input.provider, input.providerOrderId, input.reason])
  if (!result.rows[0]) return null
  const order = mapOrder(result.rows[0])
  await audit(client, order, input.dropped ? 'payment_abandoned' : 'payment_attempt_failed', {
    actor: { type: 'provider' },
    providerReference: input.providerPaymentId,
    details: { reason: input.reason },
  })
  return order
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

/** The buyer's own order by its gateway order id (return page). */
async function getOrderForProfileByProviderOrderId(providerOrderId: string, profileId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.provider_order_id = $1::text and o.profile_id = $2::uuid
    order by o.created_at desc
    limit 1
  `, [providerOrderId, profileId])
  return rows[0] ? mapOrder(rows[0]) : null
}

/** One order, only if `managerId` hosts or manages its event. */
async function getOrderForManager(orderId: string, managerId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    join public.events e on e.id = o.event_id
    where o.id = $2::uuid and ${EVENT_MANAGER_ACCESS_SQL}
    limit 1
  `, [managerId, orderId])
  return rows[0] ? mapOrder(rows[0]) : null
}

async function getOrderById(orderId: string) {
  const rows = await query<OrderRow>(`
    select ${ORDER_COLUMNS} from public.event_payment_orders o where o.id = $1::uuid limit 1
  `, [orderId])
  return rows[0] ? mapOrder(rows[0]) : null
}

async function findOrderByProviderOrderId(client: DatabaseQueryClient, provider: PaymentProviderName, providerOrderId: string) {
  const result = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.provider = $1::text and o.provider_order_id = $2::text
    limit 1
  `, [provider, providerOrderId])
  if (result.rows[0]) return mapOrder(result.rows[0])
  // Our own ids ("evt_<uuid>") also find an order whose gateway id was not saved yet
  // (the webhook can beat the save by a moment).
  const orderUuid = providerOrderId.startsWith('evt_') ? orderUuidFromGatewayOrderId(providerOrderId) : null
  if (!orderUuid) return null
  const byId = await client.query<OrderRow>(`
    select ${ORDER_COLUMNS}
    from public.event_payment_orders o
    where o.id = $1::uuid and o.provider = $2::text and (o.provider_order_id is null or o.provider_order_id = $3::text)
    limit 1
  `, [orderUuid, provider, providerOrderId])
  return byId.rows[0] ? mapOrder(byId.rows[0]) : null
}

/**
 * Records a successful payment and confirms the seat when the event rules still
 * allow it. The seller's earning is recorded in the same transaction. Idempotent:
 * calling it again for an order that is already paid or refunded returns the stored
 * outcome without changing anything.
 */
async function confirmPaidOrder(
  client: DatabaseQueryClient,
  input: {
    orderId: string
    providerPaymentId: string
    /** Saved when the order does not have its gateway id yet. */
    providerOrderId?: string
    amountMinor?: number
    currency?: string
    now?: Date
    actor?: PaymentActor
  },
): Promise<ConfirmPaymentOutcome> {
  const now = input.now ?? new Date()
  const actor = input.actor ?? SYSTEM
  const current = await lockOrder(client, input.orderId)
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
    set status = 'paid', provider_payment_id = $2::text, provider_order_id = coalesce(provider_order_id, $3::text),
      paid_at = coalesce(paid_at, now()), failure_reason = null, updated_at = now()
    where id = $1::uuid
  `, [current.id, input.providerPaymentId, input.providerOrderId ?? null])
  await audit(client, current, 'paid', {
    actor,
    fromStatus: current.status,
    toStatus: 'paid',
    providerReference: input.providerPaymentId,
    details: amountMatches ? {} : { receivedAmountMinor: input.amountMinor ?? null, receivedCurrency: input.currency ?? null },
  })

  let reason: string | null = amountMatches ? null : 'amount_mismatch'
  const event = current.eventId ? await lockEvent(client, current.eventId) : null
  if (!reason) {
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
    const order = mapOrder(updated.rows[0]!)
    await audit(client, order, 'refund_due', { actor, toStatus: 'paid', details: { reason } })
    return { state: 'refund_due', order, reason }
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
  const order = mapOrder(confirmed.rows[0]!)
  await audit(client, order, 'seat_confirmed', { actor, toStatus: 'paid' })

  if (event) {
    await recordSaleEarning(client, {
      sourceType: 'event_ticket',
      sourceId: order.id,
      seller: event.companyId ? { companyId: event.companyId } : { profileId: event.hostUserId },
      grossMinor: order.amountMinor,
      currency: order.currency,
      availableAfter: new Date(Math.max(event.endAt.getTime(), now.getTime())),
      actor,
    })
  }
  return { state: 'registered', order }
}

/**
 * Starts a refund: checks the order can be refunded and marks it 'requested' so a
 * double click cannot send two refunds. Returns the attempt number for the refund id.
 */
async function requestRefund(client: DatabaseQueryClient, input: { orderId: string; actor: PaymentActor; reason: string }) {
  const current = await lockOrder(client, input.orderId)
  if (!current) throw new EventRegistrationError('order_not_found')
  const retryAfterFailure = current.status === 'refunded' && current.refundStatus === 'failed'
  if ((current.status !== 'paid' && !retryAfterFailure) || !current.providerPaymentId || !current.providerOrderId) {
    throw new EventRegistrationError('refund_not_allowed')
  }
  if (current.refundStatus === 'requested') {
    const stale = await client.query<QueryResultRow & { stale: boolean }>(`
      select refund_requested_at < now() - make_interval(mins => $2::integer) as stale
      from public.event_payment_orders where id = $1::uuid
    `, [current.id, REFUND_REQUEST_STALE_MINUTES])
    if (!stale.rows[0]?.stale) throw new EventRegistrationError('refund_in_progress')
  }
  if (current.refundAttempts >= 20) throw new EventRegistrationError('refund_not_allowed')

  const updated = await client.query<OrderRow>(`
    update public.event_payment_orders o
    set refund_status = 'requested', refund_attempts = refund_attempts + 1, refund_requested_at = now(),
      refund_requested_by = $2::uuid, updated_at = now()
    where o.id = $1::uuid
    returning ${ORDER_COLUMNS}
  `, [current.id, input.actor.profileId ?? null])
  const order = mapOrder(updated.rows[0]!)
  await audit(client, order, 'refund_requested', { actor: input.actor, fromStatus: current.status, toStatus: current.status, details: { reason: input.reason, attempt: order.refundAttempts } })
  return { order, attempt: order.refundAttempts }
}

/**
 * Marks a payment refunded, releases the seat it paid for and reverses the seller's
 * earning, all in one transaction. Idempotent.
 */
async function markOrderRefunded(
  client: DatabaseQueryClient,
  orderId: string,
  refund: { providerRefundId?: string | null; refundStatus?: 'pending' | 'processed'; actor?: PaymentActor; reason?: string } = {},
) {
  const actor = refund.actor ?? SYSTEM
  const before = await lockOrder(client, orderId)
  if (!before || (before.status !== 'paid' && before.status !== 'refunded')) return null
  const result = await client.query<OrderRow>(`
    update public.event_payment_orders o
    set status = 'refunded', refunded_at = coalesce(refunded_at, now()),
      refund_status = coalesce($2::text, case when o.refund_status = 'requested' then 'processed' else o.refund_status end, 'processed'),
      provider_refund_id = coalesce($3::text, o.provider_refund_id),
      updated_at = now()
    where o.id = $1::uuid
    returning ${ORDER_COLUMNS}
  `, [orderId, refund.refundStatus ?? null, refund.providerRefundId ?? null])
  await client.query('delete from public.event_attendees where payment_order_id = $1::uuid', [orderId])
  const order = result.rows[0] ? mapOrder(result.rows[0]) : null
  if (order && before.status !== 'refunded') {
    await audit(client, order, 'refunded', {
      actor,
      fromStatus: before.status,
      toStatus: 'refunded',
      providerReference: order.providerRefundId,
      details: { refundStatus: order.refundStatus, reason: refund.reason ?? before.refundDueReason ?? null },
    })
    await reverseSaleEarning(client, { sourceType: 'event_ticket', sourceId: orderId, reason: refund.reason ?? 'ticket_refunded', actor })
  } else if (order && before.refundStatus !== order.refundStatus) {
    await audit(client, order, 'refund_status_changed', { actor, fromStatus: before.refundStatus, toStatus: order.refundStatus, providerReference: order.providerRefundId })
  }
  return order
}

/** The gateway did not refund. The order keeps its status; the refund can be retried. */
async function recordRefundFailure(client: DatabaseQueryClient, input: { orderId: string; reason: string; actor?: PaymentActor; providerRefundId?: string | null }) {
  const result = await client.query<OrderRow>(`
    update public.event_payment_orders o
    set refund_status = 'failed', provider_refund_id = coalesce($2::text, o.provider_refund_id), updated_at = now()
    where o.id = $1::uuid and o.status in ('paid', 'refunded')
    returning ${ORDER_COLUMNS}
  `, [input.orderId, input.providerRefundId ?? null])
  const order = result.rows[0] ? mapOrder(result.rows[0]) : null
  if (order) await audit(client, order, 'refund_failed', { actor: input.actor, toStatus: order.status, providerReference: order.providerRefundId, details: { reason: input.reason } })
  return order
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
  return recordWebhookDelivery(client, provider, providerEventId, eventType)
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
  recordAttemptFailure,
  getOrderForProfile,
  getOrderForProfileByProviderOrderId,
  getOrderForManager,
  getOrderById,
  findOrderByProviderOrderId,
  findOrderByProviderPaymentId,
  confirmPaidOrder,
  requestRefund,
  markOrderRefunded,
  recordRefundFailure,
  recordWebhookEvent,
  listEventPaymentsForManager,
  countPaidOrdersForEvent,
}
