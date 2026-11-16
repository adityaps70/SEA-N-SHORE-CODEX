import {
  buildRealtimeWebSocketUrl,
  createRealtimeEventDedupe,
  parseRealtimeSignal,
  reconnectDelayMs,
  type MessagingRealtimeSignal,
} from './client'

export type MessagingRealtimeConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'backoff'

type RealtimeTicket = {
  ticket: string
  webSocketUrl: string
}

type RealtimeSocket = {
  readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

type RealtimeSignalListener = (signal: MessagingRealtimeSignal) => void

type TypingInput = {
  conversationId: string
  targetProfileId: string
  isTyping: boolean
}

/** A membership-checked typing token from /api/realtime/typing-token (Round 14, 2.9). */
export type TypingTokenGrant = {
  token: string
  targetProfileId: string
  expiresAt: number
}

type ConnectionOptions = {
  requestTicket: () => Promise<RealtimeTicket>
  createSocket: (url: string) => RealtimeSocket
  onConnected?: () => void
  onStatusChange?: (status: MessagingRealtimeConnectionStatus) => void
  random?: () => number
  renewalMs?: number
  heartbeatMs?: number
  requestTypingToken?: (conversationId: string) => Promise<TypingTokenGrant | null>
}

const DEFAULT_RENEWAL_MS = 55 * 60 * 1000
/**
 * Round ARCH (Phase 5): API Gateway drops a WebSocket that is idle for 10 minutes, so an open socket sends a ping
 * every 5 (answered by the realtime Lambda with no database work).
 */
export const REALTIME_HEARTBEAT_MS = 5 * 60 * 1000
/**
 * Round ARCH (Phase 5): after the server closes a working connection (a deploy, the idle limit), the first reconnect
 * waits up to this much longer at random, so every open tab does not reconnect in the same second.
 */
export const SERVER_CLOSE_RECONNECT_SPREAD_MS = 30_000
/** The realtime Lambda relays at most one typing signal per 2 s per connection; the margin absorbs jitter. */
export const TYPING_MIN_INTERVAL_MS = 2_200
/**
 * Round ARCH (realtime ticket fix): a ticket request the server refuses (401/403: the session ended or cannot be
 * renewed) is not retried on the fast backoff. The tab waits this long, or until it is shown again or comes back
 * online, and stops asking after MAX_TICKET_REFUSALS refusals in a row until it is shown or goes online again.
 * Meanwhile the socket is down, so the timed polls run (through pages that renew the session or ask to sign in).
 */
export const TICKET_REFUSED_RETRY_MS = 5 * 60 * 1000
export const MAX_TICKET_REFUSALS = 3
/** After this many failures in a row (network errors, server errors, sockets that never open), retry every 5 minutes. */
export const SLOW_RETRY_AFTER_FAILURES = 10
export const SLOW_RETRY_MS = 5 * 60 * 1000

/** Thrown by a requestTicket that got a refusal (401 or 403) from the ticket route. */
export class RealtimeTicketRefusedError extends Error {
  readonly status: number
  constructor(status: number) {
    super('realtime_ticket_refused')
    this.name = 'RealtimeTicketRefusedError'
    this.status = status
  }
}

function isTicketRefusal(error: unknown) {
  return error instanceof RealtimeTicketRefusedError
    || (typeof error === 'object' && error !== null && 'status' in error && ((error as { status?: unknown }).status === 401 || (error as { status?: unknown }).status === 403))
}

const TYPING_TOKEN_REFRESH_MARGIN_MS = 60_000
const TYPING_TOKEN_FAILURE_RETRY_MS = 60_000

export function createMessagingRealtimeConnection(options: ConnectionOptions) {
  const listeners = new Set<RealtimeSignalListener>()
  const acceptEvent = createRealtimeEventDedupe()
  const random = options.random ?? Math.random
  const renewalMs = options.renewalMs ?? DEFAULT_RENEWAL_MS
  const heartbeatMs = options.heartbeatMs ?? REALTIME_HEARTBEAT_MS

  let active = false
  let connecting = false
  let socket: RealtimeSocket | null = null
  let reconnectAttempt = 0
  let status: MessagingRealtimeConnectionStatus = 'disconnected'
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let renewalTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /** Set when the next reconnect follows a close the server made on a working connection. */
  let spreadNextReconnect = false
  /** Ticket refusals and other failures in a row, since the last socket that opened. */
  let ticketRefusals = 0
  let failures = 0
  let typingTimer: ReturnType<typeof setTimeout> | null = null
  let lastTypingSentAt = 0
  const pendingTyping = new Map<string, TypingInput>()
  const typingGrants = new Map<string, { grant: Promise<TypingTokenGrant | null>; refreshAt: number }>()

  function setStatus(next: MessagingRealtimeConnectionStatus) {
    if (status === next) return
    status = next
    options.onStatusChange?.(next)
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function clearRenewalTimer() {
    if (!renewalTimer) return
    clearTimeout(renewalTimer)
    renewalTimer = null
  }

  function clearHeartbeat() {
    if (!heartbeatTimer) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  function scheduleReconnect(fixedDelayMs?: number) {
    if (!active || reconnectTimer) return
    setStatus('backoff')
    const spread = spreadNextReconnect ? Math.floor(Math.min(1, Math.max(0, random())) * SERVER_CLOSE_RECONNECT_SPREAD_MS) : 0
    spreadNextReconnect = false
    const delay = fixedDelayMs ?? (failures >= SLOW_RETRY_AFTER_FAILURES ? SLOW_RETRY_MS : reconnectDelayMs(reconnectAttempt, random) + spread)
    // A refusal's fixed wait does not advance the usual backoff.
    if (fixedDelayMs === undefined) reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  async function connect() {
    if (!active || connecting || socket) return

    connecting = true
    setStatus('connecting')
    try {
      const ticket = await options.requestTicket()
      if (!active) return

      const nextSocket = options.createSocket(
        buildRealtimeWebSocketUrl(ticket.webSocketUrl, ticket.ticket),
      )
      if (!active) {
        nextSocket.close(1000, 'stopped')
        return
      }

      socket = nextSocket
      let opened = false
      let closedByClient = false
      const closeFromClient = (code?: number, reason?: string) => {
        closedByClient = true
        nextSocket.close(code, reason)
      }
      nextSocket.onopen = () => {
        if (!active || socket !== nextSocket) return
        opened = true
        reconnectAttempt = 0
        ticketRefusals = 0
        failures = 0
        setStatus('connected')
        clearRenewalTimer()
        renewalTimer = setTimeout(() => {
          if (active && socket === nextSocket) {
            closeFromClient(4000, 'renew')
          }
        }, renewalMs)
        clearHeartbeat()
        heartbeatTimer = setInterval(() => {
          if (active && socket === nextSocket && nextSocket.readyState === 1) nextSocket.send('{"action":"ping"}')
        }, heartbeatMs)
        options.onConnected?.()
      }
      nextSocket.onmessage = (event) => {
        if (!active || socket !== nextSocket) return
        const signal = parseRealtimeSignal(event.data)
        if (!signal || !acceptEvent(signal.eventId)) return
        for (const listener of listeners) listener(signal)
      }
      nextSocket.onerror = () => {
        if (!active || socket !== nextSocket) return
        closeFromClient()
      }
      nextSocket.onclose = () => {
        if (socket !== nextSocket) return
        socket = null
        clearRenewalTimer()
        clearHeartbeat()
        // A working connection the server closed: spread this tab's reconnect over up to 30 s.
        if (opened && !closedByClient) spreadNextReconnect = true
        if (!opened) failures += 1
        if (active) scheduleReconnect()
      }
    } catch (error) {
      if (!active) return
      if (isTicketRefusal(error)) {
        ticketRefusals += 1
        // Stop asking: the socket stays down (so the timed polls run) until the tab is shown or goes online again.
        if (ticketRefusals >= MAX_TICKET_REFUSALS) setStatus('disconnected')
        else scheduleReconnect(TICKET_REFUSED_RETRY_MS)
        return
      }
      failures += 1
      scheduleReconnect()
    } finally {
      connecting = false
    }
  }

  async function start() {
    if (active) return
    active = true
    reconnectAttempt = 0
    clearReconnectTimer()
    await connect()
  }

  function stop() {
    if (!active && !socket && !connecting) return
    active = false
    clearReconnectTimer()
    clearRenewalTimer()
    clearHeartbeat()
    clearTypingQueue()
    const current = socket
    socket = null
    if (current) current.close(1000, 'stopped')
    setStatus('disconnected')
  }

  /** The tab was shown again or came back online: try at once, with fresh counts. */
  function reconnectNow() {
    if (!active || socket || connecting) return
    clearReconnectTimer()
    reconnectAttempt = 0
    ticketRefusals = 0
    failures = 0
    void connect()
  }

  function clearTypingQueue() {
    if (typingTimer) clearTimeout(typingTimer)
    typingTimer = null
    pendingTyping.clear()
  }

  function typingGrant(conversationId: string) {
    const now = Date.now()
    const cached = typingGrants.get(conversationId)
    if (cached && cached.refreshAt > now) return cached.grant
    const grant = (options.requestTypingToken?.(conversationId) ?? Promise.resolve(null)).catch(() => null)
    const entry = { grant, refreshAt: now + TYPING_TOKEN_FAILURE_RETRY_MS }
    typingGrants.set(conversationId, entry)
    void grant.then((value) => {
      if (value && typingGrants.get(conversationId) === entry) {
        entry.refreshAt = value.expiresAt * 1000 - TYPING_TOKEN_REFRESH_MARGIN_MS
      }
    })
    return grant
  }

  async function transmitTyping(input: TypingInput) {
    let typingToken: string | null = null
    if (options.requestTypingToken) {
      const grant = await typingGrant(input.conversationId)
      if (!grant || grant.targetProfileId !== input.targetProfileId) return
      typingToken = grant.token
    }
    if (!socket || socket.readyState !== 1) return
    socket.send(JSON.stringify({
      action: 'typing',
      conversationId: input.conversationId,
      targetProfileId: input.targetProfileId,
      isTyping: input.isTyping,
      ...(typingToken ? { typingToken } : {}),
    }))
  }

  /** Sends the oldest pending conversation's latest typing state, at most once per interval. */
  function flushTyping() {
    if (typingTimer || pendingTyping.size === 0) return
    const wait = lastTypingSentAt + TYPING_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) {
      typingTimer = setTimeout(() => {
        typingTimer = null
        flushTyping()
      }, wait)
      return
    }
    const next = pendingTyping.entries().next().value
    if (!next) return
    const [conversationId, input] = next
    pendingTyping.delete(conversationId)
    lastTypingSentAt = Date.now()
    void transmitTyping(input).finally(flushTyping)
  }

  function sendTyping(input: TypingInput) {
    if (!socket || socket.readyState !== 1) return false
    pendingTyping.set(input.conversationId, input)
    flushTyping()
    return true
  }

  function subscribe(listener: RealtimeSignalListener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    start,
    stop,
    reconnectNow,
    sendTyping,
    subscribe,
    getStatus: () => status,
    /** Finding 4: a reconnect is already scheduled on the backoff (a dropped socket), as opposed to idle after a refusal. */
    retryScheduled: () => Boolean(active && reconnectTimer),
  }
}

export type MessagingRealtimeConnection = ReturnType<typeof createMessagingRealtimeConnection>
