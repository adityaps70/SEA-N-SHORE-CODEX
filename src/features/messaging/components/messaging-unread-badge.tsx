'use client'

import { useMemo, useSyncExternalStore } from 'react'
import {
  MESSAGING_UNREAD_COUNT_EVENT,
  subscribeMessagingUnreadCount,
} from '../unread-client'

export { MESSAGING_UNREAD_COUNT_EVENT }

function unreadCountStore(initialCount: number) {
  let count = Math.max(0, Math.floor(initialCount))

  return {
    getSnapshot: () => count,
    subscribe: (onStoreChange: () => void) => subscribeMessagingUnreadCount((nextCount) => {
      if (nextCount === count) return
      count = nextCount
      onStoreChange()
    }),
  }
}

export function MessagingUnreadBadge({
  initialCount,
  className,
}: {
  initialCount: number
  className: string
}) {
  const store = useMemo(() => unreadCountStore(initialCount), [initialCount])
  const count = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )

  if (count <= 0) return null

  return (
    <span
      aria-label={`${count} unread messages`}
      className={className}
    >
      {count}
    </span>
  )
}
