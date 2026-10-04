import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkNotification } from '../types'
import { NotificationBell } from './notification-bell'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../actions', () => ({
  markNotificationRead: vi.fn(async () => ({ ok: true })),
  markAllNotificationsRead: vi.fn(async () => ({ ok: true })),
}))

const notification: NetworkNotification = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  type: 'connection_request',
  createdAt: '2026-09-02T10:00:00.000Z',
  readAt: null,
  actor: { id: '11111111-1111-4111-8111-111111111111', slug: 'member-a', fullName: 'Member A' },
  message: 'Member A sent you a connection request.',
  destination: '/network?tab=requests',
}

const readNotification: NetworkNotification = {
  ...notification,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  readAt: '2026-09-02T10:05:00.000Z',
  message: 'Member B accepted your connection request.',
}

afterEach(() => cleanup())

describe('NotificationBell', () => {
  it('caps the unread badge and renders recent notification copy', () => {
    render(<NotificationBell recent={[notification]} unreadCount={12} />)
    expect(screen.getByText('9+')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('Member A sent you a connection request.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View all notifications/i })).toHaveAttribute('href', '/notifications')
    expect(screen.getByRole('button', { name: /Mark all read/i })).toBeInTheDocument()
  })

  it('makes unread and read notifications visually and semantically distinct', () => {
    render(<NotificationBell recent={[notification, readNotification]} unreadCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    const unread = screen.getByRole('button', { name: /Member A sent you a connection request/i }).closest('[data-notification-state]')
    const read = screen.getByRole('button', { name: /Member B accepted your connection request/i }).closest('[data-notification-state]')

    expect(unread).toHaveAttribute('data-notification-state', 'unread')
    expect(unread).toHaveClass('border-l-4', 'border-ocean-700', 'bg-ocean-50')
    expect(read).toHaveAttribute('data-notification-state', 'read')
    expect(read).not.toHaveClass('border-l-4')
  })

  it('closes the notification popover when the user clicks elsewhere or presses Escape', () => {
    render(<NotificationBell recent={[notification]} unreadCount={1} />)
    const trigger = screen.getByRole('button', { name: 'Notifications' })

    fireEvent.click(trigger)
    expect(screen.getByRole('region', { name: 'Notifications panel' })).toBeVisible()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('region', { name: 'Notifications panel' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByRole('region', { name: 'Notifications panel' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Notifications panel' })).not.toBeInTheDocument()
  })

  it('shows the actor photo linking to their profile and a post preview that opens the post', () => {
    const reaction: NetworkNotification = {
      ...notification,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      type: 'post_reaction',
      actor: { ...notification.actor!, avatarUrl: 'https://signed.example/member-a.webp' },
      message: 'Member A reacted Like 👍 to your post.',
      destination: '/posts/dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      postId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      postPreview: { postId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', mediaUrl: '/api/feed-media/a/b/photo.jpg', mediaType: 'image', text: 'Bridge watch lessons' },
    }
    render(<NotificationBell recent={[reaction, notification]} unreadCount={2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    const avatars = screen.getAllByRole('link', { name: "View Member A's profile" })
    expect(avatars[0]).toHaveAttribute('href', '/people/member-a')
    expect(screen.getByRole('img', { name: "Member A's profile photo" })).toHaveAttribute('src', 'https://signed.example/member-a.webp')
    const preview = screen.getByRole('link', { name: 'Open post: Bridge watch lessons' })
    expect(preview).toHaveAttribute('href', '/posts/dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    expect(preview.querySelector('img')).toHaveAttribute('src', '/api/feed-media/a/b/photo.jpg')
    // A connection request is not about a post, so it has no preview.
    expect(screen.queryByTestId(`notification-preview-${notification.id}`)).not.toBeInTheDocument()

    fireEvent.click(preview)
    expect(screen.queryByRole('region', { name: 'Notifications panel' })).not.toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders a useful zero state with no unread badge', () => {
    render(<NotificationBell recent={[]} unreadCount={0} />)
    expect(screen.queryByText('9+')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark all read/i })).not.toBeInTheDocument()
  })
})
