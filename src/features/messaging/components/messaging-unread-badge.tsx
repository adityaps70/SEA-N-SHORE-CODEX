'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  createMessagingUnreadCountView,
  MESSAGING_UNREAD_COUNT_EVENT,
  subscribeMessagingUnreadCount,
} from '../unread-client'

export { MESSAGING_UNREAD_COUNT_EVENT }

function normalizeInitialCount(count: number) {
  if (!Number.isFinite(count)) return 0
  return Math.max(0, Math.floor(count))
}

export function MessagingUnreadBadge({
  initialCount,
  className,
}: {
  initialCount: number
  className: string
}) {
  const normalizedInitialCount = normalizeInitialCount(initialCount)
  const readCount = useMemo(
    () => createMessagingUnreadCountView(normalizedInitialCount),
    [normalizedInitialCount],
  )
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeMessagingUnreadCount(() => onStoreChange()),
    [],
  )
  const count = useSyncExternalStore(
    subscribe,
    readCount,
    () => normalizedInitialCount,
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
