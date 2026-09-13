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
  close: (code?: number, reason?: string) => void
}

type RealtimeSignalListener = (signal: MessagingRealtimeSignal) => void

type ConnectionOptions = {
  requestTicket: () => Promise<RealtimeTicket>
  createSocket: (url: string) => RealtimeSocket
  onConnected?: () => void
  onStatusChange?: (status: MessagingRealtimeConnectionStatus) => void
  random?: () => number
  renewalMs?: number
}

const DEFAULT_RENEWAL_MS = 55 * 60 * 1000

export function createMessagingRealtimeConnection(options: ConnectionOptions) {
  const listeners = new Set<RealtimeSignalListener>()
  const acceptEvent = createRealtimeEventDedupe()
  const random = options.random ?? Math.random
  const renewalMs = options.renewalMs ?? DEFAULT_RENEWAL_MS

  let active = false
  let connecting = false
  let socket: RealtimeSocket | null = null
  let reconnectAttempt = 0
  let status: MessagingRealtimeConnectionStatus = 'disconnected'
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let renewalTimer: ReturnType<typeof setTimeout> | null = null

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

  function scheduleReconnect() {
    if (!active || reconnectTimer) return
    setStatus('backoff')
    const delay = reconnectDelayMs(reconnectAttempt, random)
    reconnectAttempt += 1
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
      nextSocket.onopen = () => {
        if (!active || socket !== nextSocket) return
        reconnectAttempt = 0
        setStatus('connected')
        clearRenewalTimer()
        renewalTimer = setTimeout(() => {
          if (active && socket === nextSocket) {
            nextSocket.close(4000, 'renew')
          }
        }, renewalMs)
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
        nextSocket.close()
      }
      nextSocket.onclose = () => {
        if (socket !== nextSocket) return
        socket = null
        clearRenewalTimer()
        if (active) scheduleReconnect()
      }
    } catch {
      if (active) scheduleReconnect()
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
    const current = socket
    socket = null
    if (current) current.close(1000, 'stopped')
    setStatus('disconnected')
  }

  function reconnectNow() {
    if (!active || socket || connecting) return
    clearReconnectTimer()
    reconnectAttempt = 0
    void connect()
  }

  function subscribe(listener: RealtimeSignalListener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    start,
    stop,
    reconnectNow,
    subscribe,
    getStatus: () => status,
  }
}

export type MessagingRealtimeConnection = ReturnType<typeof createMessagingRealtimeConnection>
