'use client'

import { useEffect, useState } from 'react'
import {
  MESSAGING_UNREAD_COUNT_EVENT,
  subscribeMessagingUnreadCount,
} from '../unread-client'

export { MESSAGING_UNREAD_COUNT_EVENT }

export function MessagingUnreadBadge({
  initialCount,
  className,
}: {
  initialCount: number
  className: string
}) {
  const [count, setCount] = useState(initialCount)

  useEffect(() => {
    setCount(initialCount)
  }, [initialCount])

  useEffect(() => subscribeMessagingUnreadCount(setCount), [])

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
