'use client'

import { useRouter } from 'next/navigation'
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
import type { MessagingRealtimeSignal } from './client'
import {
  createMessagingRealtimeConnection,
  type MessagingRealtimeConnectionStatus,
} from './connection'

type RealtimeListener = (signal: MessagingRealtimeSignal) => void

type MessagingRealtimeContextValue = {
  status: MessagingRealtimeConnectionStatus
  subscribe: (listener: RealtimeListener) => () => void
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

export function MessagingRealtimeProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = useState<MessagingRealtimeConnectionStatus>('disconnected')
  const listenersRef = useRef(new Set<RealtimeListener>())

  const subscribe = useCallback((listener: RealtimeListener) => {
    listenersRef.current.add(listener)
    return () => listenersRef.current.delete(listener)
  }, [])

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        router.refresh()
      }, 50)
    }

    const connection = createMessagingRealtimeConnection({
      requestTicket: requestRealtimeTicket,
      createSocket: (url) => new WebSocket(url),
      onStatusChange: setStatus,
      onConnected: () => router.refresh(),
    })
    const unsubscribe = connection.subscribe((signal) => {
      for (const listener of listenersRef.current) listener(signal)
      scheduleRefresh()
    })
    const reconnectWhenOnline = () => connection.reconnectNow()

    window.addEventListener('online', reconnectWhenOnline)
    void connection.start()

    return () => {
      window.removeEventListener('online', reconnectWhenOnline)
      unsubscribe()
      connection.stop()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [router])

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe])

  return (
    <MessagingRealtimeContext.Provider value={value}>
      {children}
    </MessagingRealtimeContext.Provider>
  )
}

export function useMessagingRealtime() {
  const context = useContext(MessagingRealtimeContext)
  if (!context) throw new Error('useMessagingRealtime must be used within MessagingRealtimeProvider')
  return context
}
