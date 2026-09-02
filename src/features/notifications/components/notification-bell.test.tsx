import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

describe('NotificationBell', () => {
  it('caps the unread badge and renders recent notification copy', () => {
    render(<NotificationBell recent={[notification]} unreadCount={12} />)
    expect(screen.getByText('9+')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('Member A sent you a connection request.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View all notifications/i })).toHaveAttribute('href', '/notifications')
    expect(screen.getByRole('button', { name: /Mark all read/i })).toBeInTheDocument()
  })

  it('renders a useful zero state with no unread badge', () => {
    render(<NotificationBell recent={[]} unreadCount={0} />)
    expect(screen.queryByText('9+')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark all read/i })).not.toBeInTheDocument()
  })
})
