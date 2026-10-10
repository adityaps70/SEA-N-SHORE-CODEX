import { normalizeEmail, type SuppressionReason } from '@/lib/email/suppression'

/** The Resend email events the webhook subscribes to (scripts/aws/resend-delivery-webhook.sh creates it with these). */
export const RESEND_WEBHOOK_EVENTS = [
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.delivery_delayed',
  'email.failed',
  'email.suppressed',
] as const

/** Every value the event log and the "Last event" columns accept (Resend's `last_event` values). */
export const DELIVERY_EVENT_TYPES = [
  'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed',
  'opened', 'clicked', 'queued', 'scheduled', 'canceled',
] as const

export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number]

/** Events that prove the message reached the inbox. */
export const DELIVERED_EVENT_TYPES: readonly DeliveryEventType[] = ['delivered', 'opened', 'clicked']

export type DeliveryEvent = {
  providerEventId: string | null
  source: 'webhook' | 'backfill'
  type: DeliveryEventType
  resendEmailId: string
  recipients: string[]
  category: string | null
  bounceType: string | null
  bounceSubType: string | null
  detail: string | null
  occurredAt: Date
}

function text(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

export function isDeliveryEventType(value: unknown): value is DeliveryEventType {
  return typeof value === 'string' && (DELIVERY_EVENT_TYPES as readonly string[]).includes(value)
}

/** "Name <a@b.c>" or "a@b.c" → "a@b.c". */
function address(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /<([^<>]+)>\s*$/.exec(value)
  return normalizeEmail(match ? match[1] : value)
}

function category(tags: unknown) {
  if (Array.isArray(tags)) {
    const tag = tags.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).name === 'category')
    return text((tag as Record<string, unknown> | undefined)?.value, 80)
  }
  if (tags && typeof tags === 'object') return text((tags as Record<string, unknown>).category, 80)
  return null
}

function date(value: unknown, fallback: Date) {
  if (typeof value !== 'string') return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

/**
 * A verified webhook body → the event to record, or null for anything the log does not keep (other event types,
 * malformed bodies). Never throws on input.
 */
export function parseResendWebhookEvent(rawBody: string, providerEventId: string, now = new Date()): DeliveryEvent | null {
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return null
  }
  const kind = typeof body?.type === 'string' ? body.type : ''
  if (!(RESEND_WEBHOOK_EVENTS as readonly string[]).includes(kind)) return null
  const type = kind.slice('email.'.length)
  if (!isDeliveryEventType(type)) return null

  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
  const resendEmailId = text(data.email_id, 100)
  if (!resendEmailId) return null
  const recipients = (Array.isArray(data.to) ? data.to : [data.to]).map(address).filter((value): value is string => Boolean(value))
  const bounce = (data.bounce && typeof data.bounce === 'object' ? data.bounce : {}) as Record<string, unknown>
  const failed = (data.failed && typeof data.failed === 'object' ? data.failed : {}) as Record<string, unknown>
  const suppressed = (data.suppressed && typeof data.suppressed === 'object' ? data.suppressed : {}) as Record<string, unknown>

  return {
    providerEventId: providerEventId.slice(0, 200),
    source: 'webhook',
    type,
    resendEmailId,
    recipients: [...new Set(recipients)],
    category: category(data.tags),
    bounceType: text(bounce.type, 80),
    bounceSubType: text(bounce.subType, 80),
    detail: text(bounce.message, 500) ?? text(failed.reason, 500) ?? text(suppressed.message, 500),
    occurredAt: date(body.created_at, now),
  }
}

/** The backfill's record of one email's final status (Resend's `last_event`), or null when Resend gave none. */
export function backfillEvent(input: { resendEmailId: string; lastEvent: string | null; recipients: string[]; now?: Date }): DeliveryEvent | null {
  if (!isDeliveryEventType(input.lastEvent)) return null
  return {
    providerEventId: null,
    source: 'backfill',
    type: input.lastEvent,
    resendEmailId: input.resendEmailId,
    recipients: [...new Set(input.recipients.map(address).filter((value): value is string => Boolean(value)))],
    category: null,
    bounceType: null,
    bounceSubType: null,
    detail: 'final status fetched from the Resend API',
    occurredAt: input.now ?? new Date(),
  }
}

/**
 * Whether the event puts its recipients on the do-not-email list. A bounce counts as hard unless Resend says it was
 * temporary: Resend reports "bounced" only for permanent rejections, and the backfill sees no bounce type at all.
 */
export function suppressionReasonFor(event: Pick<DeliveryEvent, 'type' | 'bounceType'>): SuppressionReason | null {
  if (event.type === 'complained') return 'complaint'
  if (event.type === 'suppressed') return 'provider_suppressed'
  if (event.type === 'bounced') {
    const kind = event.bounceType?.toLowerCase() ?? null
    return kind === 'transient' || kind === 'undetermined' ? null : 'hard_bounce'
  }
  return null
}
