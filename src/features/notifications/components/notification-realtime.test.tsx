import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_POLL_MS } from '@/lib/browser/visible-interval'
import type { NetworkNotification } from '../types'
import { NotificationBell } from './notification-bell'
import { NotificationList } from './notification-list'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  markNotificationRead: vi.fn(async () => ({ ok: true as const })),
  markAllNotificationsRead: vi.fn(async () => ({ ok: true as const })),
  loadNotificationChrome: vi.fn(),
  loadUnreadNotificationCount: vi.fn(),
  loadNotifications: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
  loadNotificationChrome: mocks.loadNotificationChrome,
  loadUnreadNotificationCount: mocks.loadUnreadNotificationCount,
  loadNotifications: mocks.loadNotifications,
}))

function notification(id: string, message: string, createdAt: string): NetworkNotification {
  return {
    id,
    type: 'post_comment',
    createdAt,
    readAt: null,
    actor: {
      id: `actor-${id}`,
      slug: `actor-${id}`,
      fullName: message.split(' ')[0] ?? 'Member',
    },
    message,
    destination: `/posts/${id}`,
    postId: id,
    commentId: null,
  }
}

const current = notification(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Rahul commented on your post.',
  '2026-09-10T09:27:00.000Z',
)
const fresh = notification(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Neha commented on your post.',
  '2026-09-10T09:29:00.000Z',
)

describe('notification incremental freshness', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.push.mockClear()
    mocks.refresh.mockClear()
    mocks.markNotificationRead.mockClear()
    mocks.markAllNotificationsRead.mockClear()
    mocks.loadNotificationChrome.mockReset()
    mocks.loadUnreadNotificationCount.mockReset()
    mocks.loadNotifications.mockReset()
    mocks.loadNotificationChrome.mockResolvedValue({
      ok: true,
      chrome: { recent: [fresh, current], unreadCount: 2 },
    })
    mocks.loadUnreadNotificationCount.mockResolvedValue({ ok: true, unreadCount: 2 })
    mocks.loadNotifications.mockResolvedValue({ ok: true, notifications: [fresh, current] })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('refreshes the bell snapshot every minute without a route refresh', async () => {
    render(<NotificationBell recent={[current]} unreadCount={1} />)

    // Round 14 (3.9): a closed bell polls only the unread count; the list loads when it opens.
    await act(async () => { vi.advanceTimersByTime(NOTIFICATION_POLL_MS) })
    await waitFor(() => expect(mocks.loadUnreadNotificationCount).toHaveBeenCalledTimes(1))
    expect(mocks.loadNotificationChrome).not.toHaveBeenCalled()

    expect(screen.getByText('2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText('Neha commented on your post.')).toBeInTheDocument()
    expect(mocks.loadNotificationChrome).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('reloads the open panel list every minute', async () => {
    render(<NotificationBell unreadCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    await waitFor(() => expect(mocks.loadNotificationChrome).toHaveBeenCalledTimes(1))

    await act(async () => { vi.advanceTimersByTime(NOTIFICATION_POLL_MS) })
    await waitFor(() => expect(mocks.loadNotificationChrome).toHaveBeenCalledTimes(2))
    expect(mocks.loadUnreadNotificationCount).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('marks a bell notification read locally before navigating', async () => {
    render(<NotificationBell recent={[current]} unreadCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(screen.getByRole('button', { name: /Rahul commented on your post/i }))

    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith(current.id))
    expect(mocks.push).toHaveBeenCalledWith(current.destination)
    expect(mocks.refresh).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('refreshes the full notification list every minute without remounting the page', async () => {
    render(<NotificationList notifications={[current]} />)

    await act(async () => { vi.advanceTimersByTime(NOTIFICATION_POLL_MS) })
    await waitFor(() => expect(mocks.loadNotifications).toHaveBeenCalledTimes(1))

    expect(screen.getByText('2 unread')).toBeInTheDocument()
    expect(await screen.findByText('Neha commented on your post.')).toBeInTheDocument()
    expect(screen.getByText('Rahul commented on your post.')).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('marks list notifications read locally with no route refresh', async () => {
    render(<NotificationList notifications={[current]} />)
    fireEvent.click(screen.getByRole('button', { name: /Rahul commented on your post/i }))

    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith(current.id))
    expect(mocks.push).toHaveBeenCalledWith(current.destination)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(screen.getByText('All caught up')).toBeInTheDocument()
  })
})
