'use client'

import { MessageCircleMore, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  getMessagingUnreadCountSnapshot,
  publishMessagingUnreadCount,
} from '@/features/messaging/unread-client'
import type { MessagingInboxItem } from '@/features/messaging/queries'
import type { MessagingRealtimeSignal } from './client'
import {
  createMessagingRealtimeConnection,
  type MessagingRealtimeConnection,
  type MessagingRealtimeConnectionStatus,
  type TypingTokenGrant,
} from './connection'

type RealtimeListener = (signal: MessagingRealtimeSignal) => void

type MessagingRealtimeContextValue = {
  status: MessagingRealtimeConnectionStatus
  subscribe: (listener: RealtimeListener) => () => void
  sendTyping: (input: {
    conversationId: string
    targetProfileId: string
    isTyping: boolean
  }) => boolean
}

type NewMessageAlert = {
  conversationId: string
  senderName: string
  preview: string
}

const MessagingRealtimeContext = createContext<MessagingRealtimeContextValue | null>(null)

/** Feed and network refreshes from realtime signals are coalesced into one per window. */
export const REALTIME_REFRESH_DEBOUNCE_MS = 2_000

async function requestRealtimeTicket() {
  const response = await fetch('/api/realtime/ticket', {
    method: 'POST',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('realtime_ticket_request_failed')

  const payload = await response.json() as unknown
  if (
    typeof payload !== 'object'
    || payload === null
    || !('ticket' in payload)
    || !('webSocketUrl' in payload)
    || typeof payload.ticket !== 'string'
    || typeof payload.webSocketUrl !== 'string'
    || !payload.ticket
    || !payload.webSocketUrl
  ) {
    throw new Error('realtime_invalid_ticket_response')
  }

  return {
    ticket: payload.ticket,
    webSocketUrl: payload.webSocketUrl,
  }
}

/** Round 14 (2.9): the server checks membership before it signs a typing token for a conversation. */
async function requestTypingToken(conversationId: string): Promise<TypingTokenGrant | null> {
  const response = await fetch('/api/realtime/typing-token', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  })
  if (!response.ok) return null
  const payload = await response.json() as Partial<TypingTokenGrant>
  if (typeof payload.token !== 'string' || typeof payload.targetProfileId !== 'string' || typeof payload.expiresAt !== 'number') return null
  return { token: payload.token, targetProfileId: payload.targetProfileId, expiresAt: payload.expiresAt }
}

async function loadGlobalMessagingState() {
  const response = await fetch('/api/realtime/messaging-state', {
    method: 'GET',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('messaging_state_refresh_failed')

  const payload = await response.json() as {
    inbox?: unknown
    unreadCount?: unknown
  }
  if (!Array.isArray(payload.inbox) || typeof payload.unreadCount !== 'number') {
    throw new Error('messaging_invalid_state_response')
  }

  return {
    inbox: payload.inbox as MessagingInboxItem[],
    unreadCount: payload.unreadCount,
  }
}

/**
 * Round H (H1): one socket per signed-in browser tab, not per provider. The (app) and (public)
 * layouts each mount a provider, and moving between them (Home → Learn → a profile) used to close
 * the socket and open a new one, with a new ticket and a new messaging-state fetch each time. Now
 * the providers share the connection below. When the last one unmounts, the socket stays open for
 * REALTIME_RELEASE_GRACE_MS, so the next layout picks it up instead of reconnecting.
 */
export const REALTIME_RELEASE_GRACE_MS = 30_000
let releaseGraceMs = REALTIME_RELEASE_GRACE_MS

type SharedRealtime = {
  viewerProfileId: string
  connection: MessagingRealtimeConnection
  status: MessagingRealtimeConnectionStatus
  signalListeners: Set<RealtimeListener>
  statusListeners: Set<(status: MessagingRealtimeConnectionStatus) => void>
  connectedListeners: Set<() => void>
  /** A (re)connect happened while no provider was listening: the next one reconciles unread. */
  missedConnect: boolean
  holders: number
  releaseTimer: ReturnType<typeof setTimeout> | null
  removeOnlineListener: () => void
}

let shared: SharedRealtime | null = null

function destroySharedRealtime(state: SharedRealtime) {
  if (state.releaseTimer) clearTimeout(state.releaseTimer)
  state.releaseTimer = null
  state.removeOnlineListener()
  state.connection.stop()
  if (shared === state) shared = null
}

function acquireSharedRealtime(viewerProfileId: string) {
  // A different member signed in on this tab: never reuse the previous member's socket.
  if (shared && shared.viewerProfileId !== viewerProfileId) destroySharedRealtime(shared)
  if (!shared) {
    const state: SharedRealtime = {
      viewerProfileId,
      connection: null as unknown as MessagingRealtimeConnection,
      status: 'disconnected',
      signalListeners: new Set(),
      statusListeners: new Set(),
      connectedListeners: new Set(),
      missedConnect: false,
      holders: 0,
      releaseTimer: null,
      removeOnlineListener: () => undefined,
    }
    state.connection = createMessagingRealtimeConnection({
      requestTicket: requestRealtimeTicket,
      requestTypingToken,
      createSocket: (url) => new WebSocket(url),
      onConnected: () => {
        if (!state.connectedListeners.size) {
          state.missedConnect = true
          return
        }
        for (const listener of state.connectedListeners) listener()
      },
      onStatusChange: (status) => {
        state.status = status
        for (const listener of state.statusListeners) listener(status)
      },
    })
    state.connection.subscribe((signal) => {
      for (const listener of state.signalListeners) listener(signal)
    })
    const reconnectWhenOnline = () => state.connection.reconnectNow()
    window.addEventListener('online', reconnectWhenOnline)
    state.removeOnlineListener = () => window.removeEventListener('online', reconnectWhenOnline)
    shared = state
    void state.connection.start()
  }
  if (shared.releaseTimer) {
    clearTimeout(shared.releaseTimer)
    shared.releaseTimer = null
  }
  shared.holders += 1
  return shared
}

function releaseSharedRealtime(state: SharedRealtime) {
  state.holders = Math.max(0, state.holders - 1)
  if (state.holders > 0 || shared !== state) return
  if (releaseGraceMs <= 0) {
    destroySharedRealtime(state)
    return
  }
  state.releaseTimer = setTimeout(() => {
    if (state.holders === 0) destroySharedRealtime(state)
  }, releaseGraceMs)
}

/** Tests: close the shared socket now and set how long an unused socket stays open. */
export function resetSharedRealtimeForTests(graceMs = REALTIME_RELEASE_GRACE_MS) {
  if (shared) destroySharedRealtime(shared)
  releaseGraceMs = graceMs
}

export function MessagingRealtimeProvider({
  children,
  viewerProfileId,
}: {
  children: ReactNode
  viewerProfileId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  // A provider mounted after a layout change starts from the shared socket's current status.
  const [status, setStatus] = useState<MessagingRealtimeConnectionStatus>(
    () => (shared?.viewerProfileId === viewerProfileId ? shared.status : 'disconnected'),
  )
  const [newMessageAlert, setNewMessageAlert] = useState<NewMessageAlert | null>(null)
  const listenersRef = useRef(new Set<RealtimeListener>())
  const connectionRef = useRef<MessagingRealtimeConnection | null>(null)
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagingRefreshRunningRef = useRef(false)
  const pendingConversationRef = useRef<string | null>(null)

  const subscribe = useCallback((listener: RealtimeListener) => {
    listenersRef.current.add(listener)
    return () => listenersRef.current.delete(listener)
  }, [])

  const sendTyping = useCallback((input: {
    conversationId: string
    targetProfileId: string
    isTyping: boolean
  }) => connectionRef.current?.sendTyping(input) ?? false, [])

  // Round 14 (3.2): the connection lives for the whole signed-in session. The current path is read
  // through a ref, so navigating no longer closes and reopens the socket (and re-requests a ticket).
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    let active = true
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    // Feed/network invalidations are batched: at most one server-component refresh per 2 seconds.
    const scheduleRefresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        router.refresh()
      }, REALTIME_REFRESH_DEBOUNCE_MS)
    }

    const showNewMessageAlert = (item: MessagingInboxItem) => {
      if (!active) return
      const conversationPath = `/messages/${item.conversationId}`
      if (pathnameRef.current === conversationPath) return

      setNewMessageAlert({
        conversationId: item.conversationId,
        senderName: item.otherName ?? 'Sea N Shore member',
        preview: item.lastMessageBody ?? 'Sent you a message.',
      })
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
      alertTimerRef.current = setTimeout(() => {
        alertTimerRef.current = null
        setNewMessageAlert(null)
      }, 7_000)
    }

    const reconcileGlobalMessagingState = async (conversationId: string) => {
      if (pathnameRef.current.startsWith('/messages')) return

      if (messagingRefreshRunningRef.current) {
        pendingConversationRef.current = conversationId
        return
      }

      messagingRefreshRunningRef.current = true
      let requestedConversationId: string | null = conversationId
      try {
        while (active && requestedConversationId) {
          pendingConversationRef.current = null
          try {
            const state = await loadGlobalMessagingState()
            if (!active) return
            publishMessagingUnreadCount(state.unreadCount)
            const item = state.inbox.find((entry) => entry.conversationId === requestedConversationId)
            if (item) showNewMessageAlert(item)
          } catch {
            // router.refresh below remains the canonical fallback.
          }
          requestedConversationId = pendingConversationRef.current
        }
      } finally {
        messagingRefreshRunningRef.current = false
      }
    }

    const reconcileUnreadOnConnected = async () => {
      if (pathnameRef.current.startsWith('/messages')) return
      const unreadRevisionAtStart = getMessagingUnreadCountSnapshot().revision
      try {
        const state = await loadGlobalMessagingState()
        if (!active) return
        if (getMessagingUnreadCountSnapshot().revision !== unreadRevisionAtStart) return
        publishMessagingUnreadCount(state.unreadCount)
      } catch {
        // The next realtime event or reconnect will retry canonical unread reconciliation.
      }
    }

    const realtime = acquireSharedRealtime(viewerProfileId)
    connectionRef.current = realtime.connection
    queueMicrotask(() => {
      if (active) setStatus(realtime.status)
    })

    const onSignal: RealtimeListener = (signal) => {
      for (const listener of listenersRef.current) listener(signal)

      if (signal.eventType === 'conversation.typing') return

      if (signal.eventType === 'message.created') {
        if (signal.payload.senderId === viewerProfileId) return
        void reconcileGlobalMessagingState(signal.payload.conversationId)
        return
      }

      if (
        signal.eventType === 'message.updated'
        || signal.eventType === 'conversation.read_cursor_advanced'
      ) {
        return
      }

      // Round ARCH (broadcast fix): a feed hint never re-renders the page. Listeners (the home feed's "N new
      // posts" count) re-ask the server themselves. Only a new connection still refreshes, for the viewer's network.
      if ('scope' in signal && signal.scope === 'feed') return
      // Phase 5: the bell takes the pushed count itself (useNotificationCountPush); never a page refresh.
      if (signal.eventType === 'notification.created') return
      scheduleRefresh()
    }
    const onConnected = () => {
      void reconcileUnreadOnConnected()
    }
    realtime.signalListeners.add(onSignal)
    realtime.statusListeners.add(setStatus)
    realtime.connectedListeners.add(onConnected)
    if (realtime.missedConnect) {
      realtime.missedConnect = false
      onConnected()
    }

    return () => {
      active = false
      realtime.signalListeners.delete(onSignal)
      realtime.statusListeners.delete(setStatus)
      realtime.connectedListeners.delete(onConnected)
      releaseSharedRealtime(realtime)
      if (connectionRef.current === realtime.connection) connectionRef.current = null
      if (refreshTimer) clearTimeout(refreshTimer)
      if (alertTimerRef.current) {
        clearTimeout(alertTimerRef.current)
        alertTimerRef.current = null
      }
    }
  }, [router, viewerProfileId])

  const value = useMemo(() => ({ status, subscribe, sendTyping }), [sendTyping, status, subscribe])

  function openConversation() {
    if (!newMessageAlert) return
    const conversationId = newMessageAlert.conversationId
    setNewMessageAlert(null)
    if (alertTimerRef.current) {
      clearTimeout(alertTimerRef.current)
      alertTimerRef.current = null
    }
    router.push(`/messages/${conversationId}`)
  }

  return (
    <MessagingRealtimeContext.Provider value={value}>
      {children}
      {newMessageAlert ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 top-20 z-[100] w-[min(23rem,calc(100vw-2rem))] rounded-2xl border border-mist-100 bg-white p-3 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
              <MessageCircleMore aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-navy-950">
                New message from {newMessageAlert.senderName}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">
                {newMessageAlert.preview}
              </p>
              <button
                type="button"
                aria-label="Open conversation"
                onClick={openConversation}
                className="mt-2 inline-flex min-h-8 items-center rounded-lg bg-navy-950 px-3 text-xs font-semibold text-white hover:bg-navy-900"
              >
                Open
              </button>
            </div>
            <button
              type="button"
              aria-label="Dismiss new message"
              onClick={() => setNewMessageAlert(null)}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-mist-50 hover:text-navy-950"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </MessagingRealtimeContext.Provider>
  )
}

/** For components that may render outside the provider (signed out): null there, the realtime context inside. */
export function useOptionalMessagingRealtime() {
  return useContext(MessagingRealtimeContext)
}

export function useMessagingRealtime() {
  const context = useContext(MessagingRealtimeContext)
  if (!context) throw new Error('useMessagingRealtime must be used within MessagingRealtimeProvider')
  return context
}
