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

export function MessagingRealtimeProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [status, setStatus] = useState<MessagingRealtimeConnectionStatus>('disconnected')
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

  useEffect(() => {
    let active = true
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        router.refresh()
      }, 50)
    }

    const showNewMessageAlert = (item: MessagingInboxItem) => {
      if (!active) return
      const conversationPath = `/messages/${item.conversationId}`
      if (pathname === conversationPath) return

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
      if (pathname.startsWith('/messages')) return

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

    const connection = createMessagingRealtimeConnection({
      requestTicket: requestRealtimeTicket,
      createSocket: (url) => new WebSocket(url),
      onConnected: () => {
        void reconcileUnreadOnConnected()
      },
      onStatusChange: setStatus,
    })
    connectionRef.current = connection
    const unsubscribe = connection.subscribe((signal) => {
      for (const listener of listenersRef.current) listener(signal)

      if (signal.eventType === 'conversation.typing') return

      if (signal.eventType === 'message.created') {
        void reconcileGlobalMessagingState(signal.payload.conversationId)
        return
      }

      if (
        signal.eventType === 'message.updated'
        || signal.eventType === 'conversation.read_cursor_advanced'
      ) {
        return
      }

      // Feed/network invalidations still need canonical server-component refreshes.
      scheduleRefresh()
    })
    const reconnectWhenOnline = () => connection.reconnectNow()

    window.addEventListener('online', reconnectWhenOnline)
    void connection.start()

    return () => {
      active = false
      window.removeEventListener('online', reconnectWhenOnline)
      unsubscribe()
      connection.stop()
      if (connectionRef.current === connection) connectionRef.current = null
      if (refreshTimer) clearTimeout(refreshTimer)
      if (alertTimerRef.current) {
        clearTimeout(alertTimerRef.current)
        alertTimerRef.current = null
      }
    }
  }, [pathname, router])

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

export function useMessagingRealtime() {
  const context = useContext(MessagingRealtimeContext)
  if (!context) throw new Error('useMessagingRealtime must be used within MessagingRealtimeProvider')
  return context
}
