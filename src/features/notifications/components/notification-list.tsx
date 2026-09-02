'use client'

import { CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { markAllNotificationsRead, markNotificationRead } from '../actions'
import type { NetworkNotification } from '../types'

function notificationDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

export function NotificationList({ notifications }: { notifications: NetworkNotification[] }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const unreadCount = notifications.filter((notification) => !notification.readAt).length

  function openNotification(notification: NetworkNotification) {
    if (pending) return
    setError('')
    startTransition(async () => {
      if (!notification.readAt) {
        const result = await markNotificationRead(notification.id)
        if (!result.ok) {
          setError(result.error)
          return
        }
      }
      router.push(notification.destination)
      router.refresh()
    })
  }

  function markAll() {
    if (!unreadCount || pending) return
    setError('')
    startTransition(async () => {
      const result = await markAllNotificationsRead()
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  if (!notifications.length) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-14 text-center">
        <p className="font-semibold text-navy-950">No notifications yet.</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Connection requests, accepted connections, and new followers will appear here as your professional network grows.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3 border-b border-mist-100 px-5 py-4">
        <p className="text-sm font-medium text-muted">{unreadCount ? `${unreadCount} unread` : 'All caught up'}</p>
        {unreadCount ? (
          <button type="button" disabled={pending} onClick={markAll} className="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ocean-700 hover:bg-mist-50 disabled:opacity-50">
            <CheckCheck aria-hidden="true" className="size-4" />
            Mark all read
          </button>
        ) : null}
      </div>

      <div className="divide-y divide-mist-100">
        {notifications.map((notification) => (
          <button
            key={notification.id}
            type="button"
            disabled={pending}
            onClick={() => openNotification(notification)}
            className={`flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-mist-50 disabled:opacity-60 ${notification.readAt ? '' : 'bg-ocean-50/40'}`}
          >
            <span className={`mt-2 size-2 shrink-0 rounded-full ${notification.readAt ? 'bg-mist-100' : 'bg-ocean-700'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-6 text-navy-950">{notification.message}</span>
              <time dateTime={notification.createdAt} className="mt-1 block text-xs text-muted">{notificationDate(notification.createdAt)} UTC</time>
            </span>
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="border-t border-mist-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">{error}</p> : null}
    </div>
  )
}
