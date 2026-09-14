export type MessageCreatedRealtimeSignal = {
  eventId: string
  eventType: 'message.created'
  schemaVersion: number
  occurredAt: string
  aggregateId: string
  payload: {
    eventType: 'message.created'
    conversationId: string
    messageId: string
    senderId: string
    recipientProfileIds: string[]
  }
}

export type ConversationReadRealtimeSignal = {
  eventId: string
  eventType: 'conversation.read_cursor_advanced'
  schemaVersion: number
  occurredAt: string
  aggregateId: string
  payload: {
    eventType: 'conversation.read_cursor_advanced'
    conversationId: string
    readerProfileId: string
    lastReadMessageId: string
    lastReadAt: string
    participantProfileIds: string[]
  }
}

export type SocialInvalidationRealtimeSignal = {
  eventId: string
  eventType:
    | 'feed.post_created'
    | 'feed.post_reaction_changed'
    | 'feed.post_comments_changed'
    | 'feed.post_reposted'
    | 'connection.accepted'
  schemaVersion: number
  occurredAt: string
  scope: 'feed' | 'network'
}

export type MessagingRealtimeSignal =
  | MessageCreatedRealtimeSignal
  | ConversationReadRealtimeSignal
  | SocialInvalidationRealtimeSignal

type JsonRecord = Record<string, unknown>

const SOCIAL_INVALIDATION_SCOPES = {
  'feed.post_created': 'feed',
  'feed.post_reaction_changed': 'feed',
  'feed.post_comments_changed': 'feed',
  'feed.post_reposted': 'feed',
  'connection.accepted': 'network',
} as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasSignalEnvelope(value: JsonRecord) {
  return isNonEmptyString(value.eventId)
    && typeof value.schemaVersion === 'number'
    && Number.isFinite(value.schemaVersion)
    && isNonEmptyString(value.occurredAt)
    && !Number.isNaN(Date.parse(value.occurredAt))
    && isNonEmptyString(value.aggregateId)
    && isRecord(value.payload)
}

function hasMetadataOnlyEnvelope(value: JsonRecord) {
  return isNonEmptyString(value.eventId)
    && typeof value.schemaVersion === 'number'
    && Number.isFinite(value.schemaVersion)
    && isNonEmptyString(value.occurredAt)
    && !Number.isNaN(Date.parse(value.occurredAt))
    && !('aggregateId' in value)
    && !('payload' in value)
}

function parseMessageCreated(value: JsonRecord): MessageCreatedRealtimeSignal | null {
  if (value.eventType !== 'message.created' || !hasSignalEnvelope(value)) return null
  const payload = value.payload as JsonRecord
  if (
    payload.eventType !== 'message.created'
    || !isNonEmptyString(payload.conversationId)
    || !isNonEmptyString(payload.messageId)
    || !isNonEmptyString(payload.senderId)
    || !isStringArray(payload.recipientProfileIds)
  ) return null

  return value as unknown as MessageCreatedRealtimeSignal
}

function parseConversationRead(value: JsonRecord): ConversationReadRealtimeSignal | null {
  if (value.eventType !== 'conversation.read_cursor_advanced' || !hasSignalEnvelope(value)) return null
  const payload = value.payload as JsonRecord
  if (
    payload.eventType !== 'conversation.read_cursor_advanced'
    || !isNonEmptyString(payload.conversationId)
    || !isNonEmptyString(payload.readerProfileId)
    || !isNonEmptyString(payload.lastReadMessageId)
    || !isNonEmptyString(payload.lastReadAt)
    || Number.isNaN(Date.parse(payload.lastReadAt))
    || !isStringArray(payload.participantProfileIds)
  ) return null

  return value as unknown as ConversationReadRealtimeSignal
}

function parseSocialInvalidation(value: JsonRecord): SocialInvalidationRealtimeSignal | null {
  if (!hasMetadataOnlyEnvelope(value) || !isNonEmptyString(value.eventType)) return null

  const scope = SOCIAL_INVALIDATION_SCOPES[
    value.eventType as keyof typeof SOCIAL_INVALIDATION_SCOPES
  ]
  if (!scope || value.scope !== scope) return null

  return value as SocialInvalidationRealtimeSignal
}

export function buildRealtimeWebSocketUrl(webSocketUrl: string, ticket: string) {
  let url: URL
  try {
    url = new URL(webSocketUrl)
  } catch {
    throw new Error('realtime_invalid_websocket_url')
  }

  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw new Error('realtime_invalid_websocket_url')
  }
  if (!ticket) throw new Error('realtime_missing_ticket')

  url.searchParams.set('ticket', ticket)
  return url.toString()
}

export function parseRealtimeSignal(raw: unknown): MessagingRealtimeSignal | null {
  if (typeof raw !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  return parseMessageCreated(parsed)
    ?? parseConversationRead(parsed)
    ?? parseSocialInvalidation(parsed)
}

export function createRealtimeEventDedupe(maxEntries = 512) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('realtime_invalid_dedupe_capacity')
  }

  const seen = new Set<string>()
  return (eventId: string) => {
    if (seen.has(eventId)) return false
    seen.add(eventId)

    while (seen.size > maxEntries) {
      const oldest = seen.values().next().value as string | undefined
      if (!oldest) break
      seen.delete(oldest)
    }
    return true
  }
}

export function reconnectDelayMs(attempt: number, random: () => number = Math.random) {
  const normalizedAttempt = Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0))
  const base = Math.min(30_000, 1_000 * (2 ** Math.min(normalizedAttempt, 20)))
  const jitterWindow = Math.min(1_000, Math.floor(base * 0.25))
  const randomValue = Math.min(1, Math.max(0, random()))
  return Math.min(30_000, base + Math.floor(jitterWindow * randomValue))
}
