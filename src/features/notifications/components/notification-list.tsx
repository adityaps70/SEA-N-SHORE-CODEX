'use client'

import Link from 'next/link'
import { AtSign, Bell, BriefcaseBusiness, CheckCheck, ChevronRight, Ellipsis, GraduationCap, MessageSquareText, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { BottomSheet, SheetRow } from '@/components/ui/mobile-sheet'
import { relativeTimeFrom } from '@/lib/relative-time'
import { deleteNotification, deleteNotifications, loadNotifications, markAllNotificationsRead, markNotificationRead, markNotificationsRead } from '../actions'
import {
  NOTIFICATION_FILTERS,
  NOTIFICATION_FILTER_LABELS,
  notificationMatchesFilter,
  type NotificationFilter,
} from '../filters'
import type { NetworkNotification } from '../types'
import { NotificationActorAvatar, NotificationPostThumb } from './notification-visuals'

const EMPTY_FILTER_COPY: Record<Exclude<NotificationFilter, 'all'>, { icon: typeof Bell; text: string }> = {
  jobs: { icon: BriefcaseBusiness, text: 'Job updates will show up here.' },
  my_posts: { icon: MessageSquareText, text: 'Reactions, comments and replies on your posts will show up here.' },
  mentions: { icon: AtSign, text: 'Mentions and photo tags will show up here.' },
  learning: { icon: GraduationCap, text: 'Course enrolments, new materials, grades and certificates will show up here.' },
}

export function NotificationList({ notifications }: { notifications: NetworkNotification[] }) {
  const router = useRouter()
  const [items, setItems] = useState(notifications)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [menuFor, setMenuFor] = useState<NetworkNotification | null>(null)
  const unreadCount = items.filter((notification) => !notification.readAt).length
  const visibleCount = items.filter((notification) => notificationMatchesFilter(notification, filter)).length

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
        const result = notification.groupIds ? await markNotificationsRead(notification.groupIds) : await markNotificationRead(notification.id)
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
    void (notification.groupIds ? markNotificationsRead(notification.groupIds) : markNotificationRead(notification.id)).catch(() => undefined)
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

  /** Deleting is optimistic: the row goes at once and comes back if the server refuses. */
  function removeNotification(notification: NetworkNotification) {
    setMenuFor(null)
    setError('')
    const previous = items
    setItems((current) => current.filter((item) => item.id !== notification.id))
    startTransition(async () => {
      const result = notification.groupIds ? await deleteNotifications(notification.groupIds) : await deleteNotification(notification.id)
      if (!result.ok) {
        setItems(previous)
        setError(result.error)
      }
    })
  }

  const phoneHeader = (
    <>
      <div className="-mx-4 flex min-h-14 items-center justify-between gap-3 border-b border-mist-100 bg-white px-4 md:hidden">
        <h1 className="text-[18px] font-bold text-navy-950">Notifications</h1>
        {unreadCount ? (
          <button
            type="button"
            disabled={pending}
            onClick={markAll}
            className="inline-flex min-h-11 cursor-pointer items-center text-[15px] font-semibold text-ocean-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
          >
            Mark all read
          </button>
        ) : null}
      </div>
      {/* Round F: the chips filter on every screen (they were phone-only); a scrollable row on phones. */}
      <div role="group" aria-label="Filter notifications" className="-mx-4 flex gap-2 overflow-x-auto bg-white px-4 py-3 md:mx-0 md:mb-4 md:flex-wrap md:overflow-visible md:rounded-2xl md:border md:border-mist-100 md:px-4 md:shadow-[var(--shadow-card)]">
        {NOTIFICATION_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className="inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded-full border border-mist-300 bg-white px-3.5 text-sm font-semibold text-navy-700 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 aria-pressed:border-navy-950 aria-pressed:bg-navy-950 aria-pressed:text-white"
          >
            {NOTIFICATION_FILTER_LABELS[value]}
          </button>
        ))}
      </div>
    </>
  )

  if (!items.length) {
    return (
      <>
        {phoneHeader}
        <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-14 text-center max-md:-mx-4 max-md:rounded-none max-md:border-x-0">
          <p className="font-semibold text-navy-950">No notifications yet.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Reactions, comments, mentions, photo tags, connection requests and new followers will show up here.</p>
        </div>
      </>
    )
  }

  const emptyFilter = filter !== 'all' && visibleCount === 0 ? EMPTY_FILTER_COPY[filter] : null

  return (
    <>
    {phoneHeader}
    {emptyFilter ? (
      <div role="status" className="-mx-4 border-y border-mist-100 bg-white px-6 py-12 text-center md:mx-0 md:rounded-[1.5rem] md:border">
        <emptyFilter.icon aria-hidden="true" className="mx-auto size-7 text-muted" />
        <p className="mt-3 text-[15px] font-medium text-navy-950">{emptyFilter.text}</p>
        {filter === 'jobs' ? (
          <Link href="/jobs" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ocean-700 px-5 text-[15px] font-semibold text-ocean-700 hover:bg-ocean-50">
            Browse jobs
          </Link>
        ) : (
          <button type="button" onClick={() => setFilter('all')} className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-ocean-700 px-5 text-[15px] font-semibold text-ocean-700 hover:bg-ocean-50">
            Show all notifications
          </button>
        )}
      </div>
    ) : null}
    <div className={`overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none ${emptyFilter ? 'hidden' : ''}`}>
      <div className="flex items-center justify-between gap-3 border-b border-mist-100 px-5 py-4 max-md:hidden">
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
          const inFilter = notificationMatchesFilter(notification, filter)
          return (
            <div
              key={notification.id}
              data-notification-state={unread ? 'unread' : 'read'}
              className={`group flex w-full items-center gap-3 px-5 py-3.5 transition max-md:items-start max-md:px-4 max-md:pr-1 ${unread ? 'border-l-4 border-ocean-700 bg-ocean-50 pl-4 hover:bg-ocean-100 max-md:border-l-0' : 'hover:bg-mist-50'} ${inFilter ? '' : 'hidden'}`}
            >
              <NotificationActorAvatar notification={notification} />
              {notification.postUnavailable ? (
                // Round F: the post was deleted or can't be opened any more; nothing to tap, no error page.
                <div className="flex min-w-0 flex-1 items-center gap-3 py-0.5" data-testid="notification-unavailable">
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm leading-6 text-navy-950 ${unread ? 'font-bold' : 'font-medium'}`}>{notification.message}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      {unread ? <span className="size-2 shrink-0 rounded-full bg-ocean-700" aria-hidden="true" /> : null}
                      <span className="text-xs font-medium text-muted">This post is no longer available</span>
                      <span aria-hidden="true" className="text-xs text-muted">·</span>
                      <time dateTime={notification.createdAt} title={notification.createdAt} className="block text-xs text-muted">{relativeTimeFrom(notification.createdAt)}</time>
                    </span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => openNotification(notification)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg py-0.5 text-left disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm leading-6 text-navy-950 ${unread ? 'font-bold' : 'font-medium'}`}>{notification.message}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      {unread ? <span className="size-2 shrink-0 rounded-full bg-ocean-700" aria-hidden="true" /> : null}
                      {unread && notification.important ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Important</span> : null}
                      <time dateTime={notification.createdAt} title={notification.createdAt} className="block text-xs text-muted">{relativeTimeFrom(notification.createdAt)}</time>
                    </span>
                  </span>
                  {notification.postPreview ? null : (
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700 max-md:hidden" />
                  )}
                </button>
              )}
              {notification.postUnavailable ? null : <NotificationPostThumb notification={notification} onOpen={() => markReadInBackground(notification)} />}
              <button
                type="button"
                aria-label="Notification options"
                aria-haspopup="dialog"
                onClick={() => setMenuFor(notification)}
                className="-my-1 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-navy-700 hover:bg-mist-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ocean-500 md:hidden"
              >
                <Ellipsis aria-hidden="true" className="size-5" />
              </button>
            </div>
          )
        })}
      </div>
      {error ? <p role="alert" className="border-t border-mist-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">{error}</p> : null}
    </div>
    {error && emptyFilter ? <p role="alert" className="-mx-4 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p> : null}
    <BottomSheet open={menuFor !== null} onClose={() => setMenuFor(null)} title="Notification" desktop="hidden">
      {menuFor ? (
        <div role="menu" aria-label="Notification options">
          <SheetRow
            role="menuitem"
            tone="danger"
            icon={<Trash2 aria-hidden="true" />}
            label="Delete notification"
            disabled={pending}
            onClick={() => removeNotification(menuFor)}
          />
        </div>
      ) : null}
    </BottomSheet>
    </>
  )
}
