import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ unsubscribe: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/notification-emails/actions', () => ({ unsubscribeFromNotificationEmail: mocks.unsubscribe }))
vi.mock('@/components/navigation/intent-link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

import { createNotificationEmailToken } from '@/features/notification-emails/tokens'
import NotificationUnsubscribePage from './page'

const secret = 'test-secret-that-is-at-least-32-characters-long'
const member = '11111111-1111-4111-8111-111111111111'

describe('activity email unsubscribe page (round H, H3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEWSLETTER_TOKEN_SECRET = secret
  })
  afterEach(() => cleanup())

  it('asks before turning off the one type the link names, then confirms', async () => {
    mocks.unsubscribe.mockResolvedValue({ ok: true })
    const token = createNotificationEmailToken({ profileId: member, kind: 'messages', secret })
    render(await NotificationUnsubscribePage({ searchParams: Promise.resolve({ token }) }))

    expect(screen.getByRole('heading', { name: 'Turn off unread message emails?' })).toBeInTheDocument()
    expect(mocks.unsubscribe).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off unread message emails' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your unread message emails are off.'))
    expect(mocks.unsubscribe).toHaveBeenCalledWith(token)
  })

  it('explains a forged or missing link and offers Settings', async () => {
    const forged = createNotificationEmailToken({ profileId: member, kind: 'comments', secret: 'another-test-secret-at-least-32-characters-x' })
    for (const token of [forged, undefined]) {
      render(await NotificationUnsubscribePage({ searchParams: Promise.resolve(token ? { token } : {}) }))
      expect(screen.getByRole('heading', { name: 'We could not use this link' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Email settings' })).toHaveAttribute('href', '/settings/notifications')
      expect(screen.queryByRole('button')).toBeNull()
      cleanup()
    }
  })
})
