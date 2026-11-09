'use client'

import Link from 'next/link'
import { Bell, CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { loadNotificationChrome, loadUnreadNotificationCount, markAllNotificationsRead, markNotificationRead, markNotificationsRead } from '../actions'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
import { NOTIFICATION_POLL_MS } from '@/lib/browser/visible-interval'
import { useOptionalMessagingRealtime } from '@/features/realtime/provider'
import { useRealtimeAwarePoll } from '@/features/realtime/use-realtime-aware-poll'
import type { NetworkNotification } from '../types'
import { NotificationActorAvatar, NotificationPostThumb } from './notification-visuals'
import { handleStaleDeployment } from '@/features/app-update/stale-deployment'

function notificationDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

/**
 * Round 14 (3.9): the header only renders the unread badge (a single count query). The recent list
 * is loaded when the panel opens, and again on each later open, so pages no longer pay for eight
 * hydrated notifications (actors, post previews, signed media URLs) on every render.
 */
export function NotificationBell({
  unreadCount,
  recent,
}: {
  unreadCount: number
  /** An already-loaded list (tests, previews). Without it the list loads when the panel opens. */
  recent?: NetworkNotification[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<NetworkNotification[] | null>(recent ?? null)
  const [listStale, setListStale] = useState(recent === undefined)
  const [loadingList, setLoadingList] = useState(false)
  const [localUnreadCount, setLocalUnreadCount] = useState(unreadCount)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const closePopover = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, closePopover)
  const [wasOpen, setWasOpen] = useState(open)
  const openRef = useRef(open)
  const listRequestRef = useRef(0)

  // Closing the panel (button, outside click, Escape, opening a notification) makes the next open
  // load a fresh list.
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setListStale(true)
  }

  useEffect(() => { openRef.current = open }, [open])

  const loadList = useCallback(async () => {
    listRequestRef.current += 1
    const request = listRequestRef.current
    setLoadingList(true)
    try {
      const result = await loadNotificationChrome()
      if (request !== listRequestRef.current) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError('')
      setNotifications(result.chrome.recent)
      setLocalUnreadCount(result.chrome.unreadCount)
      setListStale(false)
    } catch (error) {
      handleStaleDeployment(error)
      if (request === listRequestRef.current) setError('We could not load your notifications. Please try again.')
    } finally {
      if (request === listRequestRef.current) setLoadingList(false)
    }
  }, [])

  // Every minute while the page is visible (Round P3: was every 30 s, hidden tabs included): the open panel reloads
  // its list; a closed bell only refreshes the badge count (the list reloads on open). Round ARCH (Phase 5): only while
  // the realtime socket is down; while it is connected each new notification pushes the unread count (below).
  const checkingRef = useRef(false)
  const refreshSnapshot = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      if (openRef.current) {
        await loadList()
        return
      }
      const result = await loadUnreadNotificationCount()
      if (!result.ok) return
      setLocalUnreadCount(result.unreadCount)
      setListStale(true)
    } catch (error) {
      handleStaleDeployment(error)
      // The badge keeps its last known count; the next check tries again.
    } finally {
      checkingRef.current = false
    }
  }, [loadList])
  const runRefreshSnapshot = useCallback(() => { void refreshSnapshot() }, [refreshSnapshot])
  useRealtimeAwarePoll(runRefreshSnapshot, { intervalMs: NOTIFICATION_POLL_MS, hintEventTypes: [], pauseWhileConnected: true })

  const subscribeRealtime = useOptionalMessagingRealtime()?.subscribe
  useEffect(() => {
    if (!subscribeRealtime) return
    return subscribeRealtime((signal) => {
      if (signal.eventType !== 'notification.created') return
      if (typeof signal.unreadNotificationCount === 'number') setLocalUnreadCount(signal.unreadNotificationCount)
      setListStale(true)
      if (openRef.current) void loadList()
      else if (typeof signal.unreadNotificationCount !== 'number') void refreshSnapshot()
    })
  }, [subscribeRealtime, loadList, refreshSnapshot])

  /** Opening the panel loads the list when it has not been loaded yet or may be out of date. */
  function togglePanel() {
    const next = !open
    setOpen(next)
    if (next && listStale) void loadList()
  }

  function openNotification(notification: NetworkNotification) {
    if (pending) return
    setError('')
    if (notification.readAt) {
      setOpen(false)
      router.push(notification.destination)
      return
    }

    startTransition(async () => {
      const result = notification.groupIds ? await markNotificationsRead(notification.groupIds) : await markNotificationRead(notification.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const readAt = new Date().toISOString()
      setNotifications((current) => current?.map((item) => item.id === notification.id ? { ...item, readAt } : item) ?? null)
      setLocalUnreadCount((current) => Math.max(0, current - 1))
      setOpen(false)
      router.push(notification.destination)
    })
  }

  /** Opening the post preview link marks the notification read without holding up navigation. */
  function openPreview(notification: NetworkNotification) {
    setOpen(false)
    if (notification.readAt) return
    const readAt = new Date().toISOString()
    setNotifications((current) => current?.map((item) => item.id === notification.id ? { ...item, readAt } : item) ?? null)
    setLocalUnreadCount((current) => Math.max(0, current - 1))
    void (notification.groupIds ? markNotificationsRead(notification.groupIds) : markNotificationRead(notification.id)).catch(() => undefined)
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
      setNotifications((current) => current?.map((notification) => notification.readAt ? notification : { ...notification, readAt }) ?? null)
      setLocalUnreadCount(0)
    })
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={togglePanel}
        className="relative grid min-h-10 min-w-10 place-items-center rounded-lg text-navy-900 hover:bg-mist-50"
      >
        <Bell aria-hidden="true" className="size-5" />
        {localUnreadCount > 0 ? (
          <span className="absolute right-0 top-0 inline-flex min-w-5 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-ocean-700 px-1 text-xs font-bold leading-5 text-white">
            {localUnreadCount > 9 ? '9+' : localUnreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div role="region" aria-label="Notifications panel" className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-xl">
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

          {notifications === null ? (
            <div className="px-5 py-8 text-center">
              {loadingList ? <p role="status" className="text-sm text-muted">Loading notifications…</p> : null}
            </div>
          ) : notifications.length ? (
            <div className="max-h-96 overflow-y-auto py-1">
              {notifications.map((notification) => {
                const unread = !notification.readAt
                return (
                  <div
                    key={notification.id}
                    data-notification-state={unread ? 'unread' : 'read'}
                    className={`relative flex w-full items-center gap-2.5 px-4 py-2.5 transition hover:bg-mist-50 ${unread ? 'border-l-4 border-ocean-700 bg-ocean-50 pl-3' : ''}`}
                  >
                    <NotificationActorAvatar notification={notification} size="size-10" />
                    {notification.postUnavailable ? (
                      // Round F: deleted or out of reach; the row says so and opens nothing.
                      <div className="block min-w-0 flex-1 py-0.5">
                        <span className={`block text-sm leading-5 text-navy-950 ${unread ? 'font-bold' : 'font-medium'}`}>{notification.message}</span>
                        <span className="mt-1 flex items-center gap-2">
                          {unread ? <span aria-hidden="true" className="size-1.5 rounded-full bg-ocean-700" /> : null}
                          <span className="text-xs font-medium text-muted">This post is no longer available</span>
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => openNotification(notification)}
                        className="block min-w-0 flex-1 cursor-pointer rounded-lg py-0.5 text-left disabled:opacity-60"
                      >
                        <span className={`block text-sm leading-5 text-navy-950 ${unread ? 'font-bold' : 'font-medium'}`}>{notification.message}</span>
                        <span className="mt-1 flex items-center gap-2">
                          {unread ? <span aria-hidden="true" className="size-1.5 rounded-full bg-ocean-700" /> : null}
                          <time dateTime={notification.createdAt} className="text-xs text-muted">{notificationDate(notification.createdAt)}</time>
                        </span>
                      </button>
                    )}
                    {notification.postUnavailable ? null : <NotificationPostThumb notification={notification} size="size-11" onOpen={() => openPreview(notification)} />}
                  </div>
                )
              })}
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
