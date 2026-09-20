import type { OptimisticMessagingMessage } from './components/message-composer'
import type { MessagingMessageDto } from './queries'

export type MessagingThreadItem = MessagingMessageDto | OptimisticMessagingMessage
export type MessagingReadCursor = { createdAt: string; id: string }

type CatchUpResponse = {
  messages: MessagingMessageDto[]
  nextCursor: MessagingReadCursor | null
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isOptimistic(message: MessagingThreadItem): message is OptimisticMessagingMessage {
  return 'deliveryState' in message
}

function compareCursor(a: MessagingReadCursor, b: MessagingReadCursor) {
  const aTime = Date.parse(a.createdAt)
  const bTime = Date.parse(b.createdAt)
  if (aTime !== bTime) return aTime < bTime ? -1 : 1
  return a.id.localeCompare(b.id)
}

function cursorOf(message: Pick<MessagingMessageDto, 'createdAt' | 'id'>): MessagingReadCursor {
  return { createdAt: message.createdAt, id: message.id }
}

function isCanonicalMessage(value: unknown): value is MessagingMessageDto {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return typeof message.id === 'string'
    && typeof message.conversationId === 'string'
    && typeof message.senderProfileId === 'string'
    && typeof message.clientMessageId === 'string'
    && typeof message.body === 'string'
    && typeof message.createdAt === 'string'
    && !Number.isNaN(Date.parse(message.createdAt))
    && (message.editedAt === null || typeof message.editedAt === 'string')
    && (message.deletedAt === null || typeof message.deletedAt === 'string')
}

function isCursor(value: unknown): value is MessagingReadCursor {
  if (typeof value !== 'object' || value === null) return false
  const cursor = value as Record<string, unknown>
  return typeof cursor.createdAt === 'string'
    && !Number.isNaN(Date.parse(cursor.createdAt))
    && typeof cursor.id === 'string'
    && cursor.id.length > 0
}

function parseCatchUpResponse(value: unknown): CatchUpResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('messaging_invalid_catchup_response')
  }
  const response = value as Record<string, unknown>
  if (!Array.isArray(response.messages) || !response.messages.every(isCanonicalMessage)) {
    throw new Error('messaging_invalid_catchup_response')
  }
  if (response.nextCursor !== null && !isCursor(response.nextCursor)) {
    throw new Error('messaging_invalid_catchup_response')
  }
  return {
    messages: response.messages,
    nextCursor: response.nextCursor as MessagingReadCursor | null,
  }
}

export function mergeCanonicalMessages(
  current: MessagingThreadItem[],
  incoming: MessagingMessageDto[],
): MessagingThreadItem[] {
  let merged = [...current]

  for (const canonical of incoming) {
    merged = merged.filter((message) => (
      message.id !== canonical.id && message.clientMessageId !== canonical.clientMessageId
    ))
    merged.push(canonical)
  }

  return merged.sort((a, b) => compareCursor(cursorOf(a), cursorOf(b)))
}

export function syncThreadMessagesWithCanonicalSnapshot(
  current: MessagingThreadItem[],
  canonicalSnapshot: MessagingMessageDto[],
): MessagingThreadItem[] {
  const canonicalClientIds = new Set(canonicalSnapshot.map((message) => message.clientMessageId))
  const optimistic = current.filter((message) => (
    isOptimistic(message) && !canonicalClientIds.has(message.clientMessageId)
  ))
  return [...canonicalSnapshot, ...optimistic].sort((a, b) => compareCursor(cursorOf(a), cursorOf(b)))
}

export function latestCanonicalCursor(messages: MessagingThreadItem[]): MessagingReadCursor | null {
  let latest: MessagingReadCursor | null = null
  for (const message of messages) {
    if (isOptimistic(message)) continue
    const cursor = cursorOf(message)
    if (!latest || compareCursor(latest, cursor) < 0) latest = cursor
  }
  return latest
}

export function laterReadCursor(
  current: MessagingReadCursor | null,
  candidate: MessagingReadCursor | null,
) {
  if (!candidate) return current
  if (!current || compareCursor(current, candidate) < 0) return candidate
  return current
}

export function isMessageSeen(
  message: MessagingMessageDto,
  peerCursor: MessagingReadCursor | null,
) {
  if (!peerCursor) return false
  return compareCursor(cursorOf(message), peerCursor) <= 0
}

export async function fetchConversationCatchUp(
  conversationId: string,
  after: MessagingReadCursor | null,
  fetchFn: FetchLike = fetch,
) {
  const messages: MessagingMessageDto[] = []
  let cursor = after

  for (;;) {
    const response = await fetchFn('/api/realtime/catch-up', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        ...(cursor ? { after: cursor } : {}),
        limit: 100,
      }),
    })
    if (!response.ok) throw new Error('messaging_catchup_failed')

    const page = parseCatchUpResponse(await response.json())
    messages.push(...page.messages)
    if (!page.nextCursor) return messages
    if (cursor && compareCursor(page.nextCursor, cursor) <= 0) {
      throw new Error('messaging_catchup_cursor_did_not_advance')
    }
    cursor = page.nextCursor
  }
}
