import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkNotification } from '../types'
import { NotificationList } from './notification-list'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  markNotificationRead: vi.fn(async () => ({ ok: true as const })),
  markAllNotificationsRead: vi.fn(async () => ({ ok: true as const })),
  loadNotifications: vi.fn(async () => ({ ok: true as const, notifications: [] })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
  loadNotifications: mocks.loadNotifications,
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

const readNotification: NetworkNotification = {
  ...notification,
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  readAt: '2026-09-10T09:28:00.000Z',
  message: 'Rahul Gupta liked your post.',
}

describe('NotificationList timestamps', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T09:29:00.000Z'))
    mocks.push.mockClear()
    mocks.refresh.mockClear()
    mocks.markNotificationRead.mockClear()
    mocks.markAllNotificationsRead.mockClear()
    mocks.loadNotifications.mockClear()
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
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(screen.getByText('All caught up')).toBeInTheDocument()
  })

  it('makes unread rows unmistakable without over-emphasizing read rows', () => {
    render(<NotificationList notifications={[notification, readNotification]} />)

    const unread = screen.getByRole('button', { name: /Rahul Gupta commented on your post/i }).closest('[data-notification-state]')
    const read = screen.getByRole('button', { name: /Rahul Gupta liked your post/i }).closest('[data-notification-state]')

    expect(unread).toHaveAttribute('data-notification-state', 'unread')
    expect(unread).toHaveClass('border-l-4', 'border-ocean-700', 'bg-ocean-50')
    expect(read).toHaveAttribute('data-notification-state', 'read')
    expect(read).not.toHaveClass('border-l-4')
  })

  it('shows the actor photo (initials when missing) linking to their profile', () => {
    const withPhoto = { ...notification, actor: { ...notification.actor!, avatarUrl: 'https://signed.example/rahul.webp' } }
    const withoutPhoto = { ...readNotification, actor: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', slug: 'rinki-mukharjee', fullName: 'Rinki Mukharjee', avatarUrl: null } }
    render(<NotificationList notifications={[withPhoto, withoutPhoto]} />)

    expect(screen.getByRole('link', { name: "View Rahul Gupta's profile" })).toHaveAttribute('href', '/people/rahul-gupta')
    expect(screen.getByRole('img', { name: "Rahul Gupta's profile photo" })).toHaveAttribute('src', 'https://signed.example/rahul.webp')
    const initialsLink = screen.getByRole('link', { name: "View Rinki Mukharjee's profile" })
    expect(initialsLink).toHaveAttribute('href', '/people/rinki-mukharjee')
    expect(initialsLink).toHaveTextContent('RM')
  })

  it('shows a square post preview: the first photo, a video frame, or the first words of the text', () => {
    const postId = notification.postId!
    const photo = { ...notification, postPreview: { postId, mediaUrl: '/api/feed-media/p/1.jpg', mediaType: 'image' as const, text: 'Engine room drill' } }
    const video = { ...readNotification, postPreview: { postId, mediaUrl: '/api/feed-media/p/2.mp4', mediaType: 'video' as const, text: '' } }
    const text = {
      ...readNotification,
      id: '99999999-9999-4999-8999-999999999999',
      message: 'Rahul Gupta mentioned you in a post.',
      postPreview: { postId, mediaUrl: null, mediaType: null, text: 'Great discussion on SIRE 2.0 today…' },
    }
    const noPost = { ...readNotification, id: '88888888-8888-4888-8888-888888888888', type: 'new_follower' as const, message: 'Rahul Gupta started following you.', postId: null, postPreview: null }
    render(<NotificationList notifications={[photo, video, text, noPost]} />)

    const photoPreview = screen.getByTestId(`notification-preview-${photo.id}`)
    expect(photoPreview).toHaveAttribute('href', `/posts/${postId}`)
    expect(photoPreview.querySelector('img')).toHaveAttribute('src', '/api/feed-media/p/1.jpg')
    expect(screen.getByTestId(`notification-preview-${video.id}`).querySelector('video')).toHaveAttribute('src', '/api/feed-media/p/2.mp4')
    const textPreview = screen.getByTestId(`notification-preview-${text.id}`)
    expect(textPreview).toHaveTextContent('Great discussion on SIRE 2.0 today…')
    expect(textPreview).toHaveAccessibleName('Open post: Great discussion on SIRE 2.0 today…')
    expect(screen.queryByTestId(`notification-preview-${noPost.id}`)).not.toBeInTheDocument()
  })

  it('marks an unread notification read when its post preview is opened', () => {
    const photo = { ...notification, postPreview: { postId: notification.postId!, mediaUrl: '/api/feed-media/p/1.jpg', mediaType: 'image' as const, text: '' } }
    render(<NotificationList notifications={[photo]} />)

    fireEvent.click(screen.getByTestId(`notification-preview-${photo.id}`))

    expect(mocks.markNotificationRead).toHaveBeenCalledWith(photo.id)
    expect(screen.getByText('All caught up')).toBeInTheDocument()
  })
})
