'use client'

import { CheckCheck, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { relativeTimeFrom } from '@/lib/relative-time'
import { loadNotifications, markAllNotificationsRead, markNotificationRead } from '../actions'
import type { NetworkNotification } from '../types'
import { NotificationActorAvatar, NotificationPostThumb } from './notification-visuals'

export function NotificationList({ notifications }: { notifications: NetworkNotification[] }) {
  const router = useRouter()
  const [items, setItems] = useState(notifications)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const unreadCount = items.filter((notification) => !notification.readAt).length

  useEffect(() => {
    let active = true
    let checking = false

    const refreshSnapshot = async () => {
      if (checking) return
      checking = true
      try {
        const result = await loadNotifications()
        if (!active || !result.ok) return
        setItems(result.notifications)
      } finally {
        checking = false
      }
    }

    const interval = window.setInterval(() => { void refreshSnapshot() }, 30_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

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
        const readAt = new Date().toISOString()
        setItems((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item))
      }
      router.push(notification.destination)
    })
  }

  /** The post preview is a plain link; mark the notification read on the way without blocking it. */
  function markReadInBackground(notification: NetworkNotification) {
    if (notification.readAt) return
    const readAt = new Date().toISOString()
    setItems((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item))
    void markNotificationRead(notification.id).catch(() => undefined)
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
      const readAt = new Date().toISOString()
      setItems((current) => current.map((notification) => notification.readAt ? notification : { ...notification, readAt }))
    })
  }

  if (!items.length) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-14 text-center">
        <p className="font-semibold text-navy-950">No notifications yet.</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Reactions, comments, connection requests and new followers will show up here.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3 border-b border-mist-100 px-5 py-4">
        <p className="text-sm font-medium text-muted">{unreadCount ? `${unreadCount} unread` : 'All caught up'}</p>
        {unreadCount ? (
          <button type="button" disabled={pending} onClick={markAll} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold text-ocean-700 transition-colors enabled:hover:border-ocean-300 enabled:hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-50">
            <CheckCheck aria-hidden="true" className="size-4" />
            Mark all read
          </button>
        ) : null}
      </div>

      <div className="divide-y divide-mist-100">
        {items.map((notification) => {
          const unread = !notification.readAt
          return (
            <div
              key={notification.id}
              data-notification-state={unread ? 'unread' : 'read'}
              className={`group flex w-full items-center gap-3 px-5 py-3.5 transition ${unread ? 'border-l-4 border-ocean-700 bg-ocean-50 pl-4 hover:bg-ocean-100' : 'hover:bg-mist-50'}`}
            >
              <NotificationActorAvatar notification={notification} />
              <button
                type="button"
                disabled={pending}
                onClick={() => openNotification(notification)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm leading-6 text-navy-950 ${unread ? 'font-bold' : 'font-medium'}`}>{notification.message}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    {unread ? <span className="size-2 shrink-0 rounded-full bg-ocean-700" aria-hidden="true" /> : null}
                    <time dateTime={notification.createdAt} title={notification.createdAt} className="block text-xs text-muted">{relativeTimeFrom(notification.createdAt)}</time>
                  </span>
                </span>
                {notification.postPreview ? null : (
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
                )}
              </button>
              <NotificationPostThumb notification={notification} onOpen={() => markReadInBackground(notification)} />
            </div>
          )
        })}
      </div>
      {error ? <p role="alert" className="border-t border-mist-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">{error}</p> : null}
    </div>
  )
}
