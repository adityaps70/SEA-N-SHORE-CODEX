import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Round ARCH (Phase 5): while the realtime socket is connected, a new notification pushes the unread count straight
 * into the bell (no request) and the 60-second check is off; while the socket is down, the check runs as before.
 */
const mocks = vi.hoisted(() => ({
  loadUnreadNotificationCount: vi.fn(async () => ({ ok: true as const, unreadCount: 7 })),
  status: 'connected' as string,
  listeners: new Set<(signal: Record<string, unknown>) => void>(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../actions', () => ({
  markNotificationRead: vi.fn(),
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  loadNotificationChrome: vi.fn(() => new Promise(() => undefined)),
  loadUnreadNotificationCount: mocks.loadUnreadNotificationCount,
}))
vi.mock('@/features/realtime/provider', () => ({
  useOptionalMessagingRealtime: () => ({
    status: mocks.status,
    subscribe: (listener: (signal: Record<string, unknown>) => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) },
  }),
}))

const { NotificationBell } = await import('./notification-bell')
const push = (signal: Record<string, unknown>) => act(() => { for (const listener of mocks.listeners) listener(signal) })

beforeEach(() => {
  vi.useFakeTimers()
  mocks.status = 'connected'
  mocks.listeners.clear()
  mocks.loadUnreadNotificationCount.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('NotificationBell over the realtime socket', () => {
  it('shows a pushed unread count with no request, and does not poll while connected', async () => {
    render(<NotificationBell recent={[]} unreadCount={1} />)
    expect(screen.getByText('1')).toBeInTheDocument()

    push({ eventType: 'notification.created', scope: 'notifications', unreadNotificationCount: 3 })
    expect(screen.getByText('3')).toBeInTheDocument()

    push({ eventType: 'feed.post_created', scope: 'feed' })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000 * 3) })
    expect(mocks.loadUnreadNotificationCount).not.toHaveBeenCalled()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('asks for the count when a push carries none, and polls every 60 s while the socket is down', async () => {
    render(<NotificationBell recent={[]} unreadCount={1} />)
    push({ eventType: 'notification.created', scope: 'notifications' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(mocks.loadUnreadNotificationCount).toHaveBeenCalledTimes(1)
    cleanup()

    mocks.status = 'backoff'
    mocks.loadUnreadNotificationCount.mockClear()
    render(<NotificationBell recent={[]} unreadCount={1} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(mocks.loadUnreadNotificationCount).toHaveBeenCalledTimes(1)
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})
