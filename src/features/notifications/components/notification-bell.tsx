'use client'

import Link from 'next/link'
import { Bell, CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { loadNotificationChrome, markAllNotificationsRead, markNotificationRead } from '../actions'
import type { NetworkNotification } from '../types'

function notificationDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

export function NotificationBell({
  recent,
  unreadCount,
}: {
  recent: NetworkNotification[]
  unreadCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(recent)
  const [localUnreadCount, setLocalUnreadCount] = useState(unreadCount)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    let checking = false

    const refreshSnapshot = async () => {
      if (checking) return
      checking = true
      try {
        const result = await loadNotificationChrome()
        if (!active || !result.ok) return
        setNotifications(result.chrome.recent)
        setLocalUnreadCount(result.chrome.unreadCount)
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
    if (notification.readAt) {
      setOpen(false)
      router.push(notification.destination)
      return
    }

    startTransition(async () => {
      const result = await markNotificationRead(notification.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item))
      setLocalUnreadCount((current) => Math.max(0, current - 1))
      setOpen(false)
      router.push(notification.destination)
    })
  }

  function markAll() {
    if (!localUnreadCount || pending) return
    setError('')
    startTransition(async () => {
      const result = await markAllNotificationsRead()
      if (!result.ok) {
        setError(result.error)
        return
      }
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((notification) => notification.readAt ? notification : { ...notification, readAt }))
      setLocalUnreadCount(0)
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative grid min-h-10 min-w-10 place-items-center rounded-lg text-navy-900 hover:bg-mist-50"
      >
        <Bell aria-hidden="true" className="size-5" />
        {localUnreadCount > 0 ? (
          <span className="absolute right-0 top-0 inline-flex min-w-5 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-ocean-700 px-1 text-[10px] font-bold leading-5 text-white">
            {localUnreadCount > 9 ? '9+' : localUnreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-mist-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-navy-950">Notifications</p>
              <p className="text-xs text-muted">{localUnreadCount ? `${localUnreadCount} unread` : 'You are up to date'}</p>
            </div>
            {localUnreadCount ? (
              <button type="button" disabled={pending} onClick={markAll} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ocean-700 hover:bg-mist-50 disabled:opacity-50">
                <CheckCheck aria-hidden="true" className="size-4" />
                Mark all read
              </button>
            ) : null}
          </div>

          {notifications.length ? (
            <div className="max-h-96 overflow-y-auto py-1">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  disabled={pending}
                  onClick={() => openNotification(notification)}
                  className={`block w-full px-4 py-3 text-left hover:bg-mist-50 disabled:opacity-60 ${notification.readAt ? '' : 'bg-ocean-50/50'}`}
                >
                  <span className="block text-sm font-medium leading-5 text-navy-950">{notification.message}</span>
                  <time dateTime={notification.createdAt} className="mt-1 block text-xs text-muted">{notificationDate(notification.createdAt)}</time>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="text-sm font-semibold text-navy-950">No notifications yet.</p>
              <p className="mt-1 text-xs leading-5 text-muted">Connection requests, accepted connections, and new followers will appear here.</p>
            </div>
          )}

          {error ? <p role="alert" className="border-t border-mist-100 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">{error}</p> : null}
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-mist-100 px-4 py-3 text-center text-sm font-semibold text-ocean-700 hover:bg-mist-50">
            View all notifications
          </Link>
        </div>
      ) : null}
    </div>
  )
}
