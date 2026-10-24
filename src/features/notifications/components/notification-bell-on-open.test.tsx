import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_POLL_MS } from '@/lib/browser/visible-interval'
import type { NetworkNotification } from '../types'
import { NotificationBell } from './notification-bell'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  markNotificationRead: vi.fn(async () => ({ ok: true as const })),
  markAllNotificationsRead: vi.fn(async () => ({ ok: true as const })),
  loadNotificationChrome: vi.fn(),
  loadUnreadNotificationCount: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../actions', () => ({
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
  loadNotificationChrome: mocks.loadNotificationChrome,
  loadUnreadNotificationCount: mocks.loadUnreadNotificationCount,
}))

function notification(id: string, message: string): NetworkNotification {
  return {
    id,
    type: 'post_comment',
    createdAt: '2026-09-10T09:27:00.000Z',
    readAt: null,
    actor: { id: `actor-${id}`, slug: `actor-${id}`, fullName: message.split(' ')[0] ?? 'Member' },
    message,
    destination: `/posts/${id}`,
    postId: id,
    commentId: null,
  }
}

const rahul = notification('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Rahul commented on your post.')
const neha = notification('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Neha commented on your post.')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadNotificationChrome.mockResolvedValue({ ok: true, chrome: { recent: [rahul], unreadCount: 1 } })
  mocks.loadUnreadNotificationCount.mockResolvedValue({ ok: true, unreadCount: 1 })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('NotificationBell loads its list on open (Round 14, 3.9)', () => {
  it('renders only the badge until the panel is opened', () => {
    render(<NotificationBell unreadCount={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(mocks.loadNotificationChrome).not.toHaveBeenCalled()
    expect(mocks.loadUnreadNotificationCount).not.toHaveBeenCalled()
  })

  it('loads the recent list when the panel opens, with a loading state meanwhile', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mocks.loadNotificationChrome.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<NotificationBell unreadCount={1} />)

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading notifications…')
    expect(screen.queryByText('No notifications yet.')).not.toBeInTheDocument()

    await act(async () => { resolve({ ok: true, chrome: { recent: [rahul], unreadCount: 1 } }) })
    expect(screen.getByText('Rahul commented on your post.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.loadNotificationChrome).toHaveBeenCalledTimes(1)
  })

  it('shows the zero state after loading an empty list', async () => {
    mocks.loadNotificationChrome.mockResolvedValueOnce({ ok: true, chrome: { recent: [], unreadCount: 0 } })
    render(<NotificationBell unreadCount={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument()
  })

  it('reloads the list on the next open so new notifications appear', async () => {
    render(<NotificationBell unreadCount={1} />)
    const trigger = screen.getByRole('button', { name: 'Notifications' })
    fireEvent.click(trigger)
    expect(await screen.findByText('Rahul commented on your post.')).toBeInTheDocument()

    fireEvent.click(trigger)
    mocks.loadNotificationChrome.mockResolvedValueOnce({ ok: true, chrome: { recent: [neha, rahul], unreadCount: 2 } })
    fireEvent.click(trigger)

    // The previous list stays visible while the fresh one loads.
    expect(screen.getByText('Rahul commented on your post.')).toBeInTheDocument()
    expect(await screen.findByText('Neha commented on your post.')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(mocks.loadNotificationChrome).toHaveBeenCalledTimes(2)
  })

  it('shows the error and retries on the next open when the list cannot load', async () => {
    mocks.loadNotificationChrome.mockResolvedValueOnce({ ok: false, error: 'We could not refresh your notifications. They will update again shortly.' })
    render(<NotificationBell unreadCount={1} />)
    const trigger = screen.getByRole('button', { name: 'Notifications' })

    fireEvent.click(trigger)
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not refresh your notifications.')

    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(await screen.findByText('Rahul commented on your post.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('polls only the badge count while closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.loadUnreadNotificationCount.mockResolvedValueOnce({ ok: true, unreadCount: 4 })
    render(<NotificationBell unreadCount={1} />)

    await act(async () => { vi.advanceTimersByTime(NOTIFICATION_POLL_MS) })
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument())
    expect(mocks.loadNotificationChrome).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
