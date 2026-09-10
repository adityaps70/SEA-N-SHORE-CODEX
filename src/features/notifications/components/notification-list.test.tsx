import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkNotification } from '../types'
import { NotificationList } from './notification-list'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  markNotificationRead: vi.fn(async () => ({ ok: true as const })),
  markAllNotificationsRead: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
}))

const notification: NetworkNotification = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  type: 'post_comment',
  createdAt: '2026-09-10T09:27:00.000Z',
  readAt: null,
  actor: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    slug: 'rahul-gupta',
    fullName: 'Rahul Gupta',
  },
  message: 'Rahul Gupta commented on your post.',
  destination: '/feed?post=cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  commentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
}

describe('NotificationList timestamps', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T09:29:00.000Z'))
    mocks.push.mockClear()
    mocks.refresh.mockClear()
    mocks.markNotificationRead.mockClear()
    mocks.markAllNotificationsRead.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows relative age with precise timestamp metadata and preserves unread navigation behavior', async () => {
    render(<NotificationList notifications={[notification]} />)

    const time = screen.getByText('2m')
    expect(time).toHaveAttribute('datetime', notification.createdAt)
    expect(time).toHaveAttribute('title', notification.createdAt)
    expect(screen.queryByText(/10 Sep 2026/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/UTC$/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Rahul Gupta commented on your post/i }))

    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith(notification.id))
    expect(mocks.push).toHaveBeenCalledWith(notification.destination)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
