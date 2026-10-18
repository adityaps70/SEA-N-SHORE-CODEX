import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setNotificationEmailPreference: vi.fn() }))
vi.mock('@/features/notification-emails/actions', () => ({ setNotificationEmailPreference: mocks.setNotificationEmailPreference }))

import { NotificationEmailToggle } from './notification-email-toggle'

describe('Settings → Email notifications: messages and activity (round H, H3)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('lists each type as a labelled, described switch', () => {
    render(
      <>
        <NotificationEmailToggle kind="messages" initiallyEnabled />
        <NotificationEmailToggle kind="connection_requests" initiallyEnabled />
        <NotificationEmailToggle kind="comments" initiallyEnabled={false} />
        <NotificationEmailToggle kind="mentions" initiallyEnabled />
      </>,
    )
    expect(screen.getByRole('switch', { name: /Unread messages/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: /Connection requests/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: /Comments on your posts/ })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /Mentions and tags/ })).toHaveAccessibleDescription(/mentions you in a post or comment, or tags you in a photo/)
    expect(screen.getByRole('switch', { name: /Unread messages/ })).toHaveAccessibleDescription(/Message text is never included/)
  })

  it('saves as soon as it changes and confirms', async () => {
    mocks.setNotificationEmailPreference.mockResolvedValue({ ok: true, enabled: false })
    render(<NotificationEmailToggle kind="mentions" initiallyEnabled />)

    fireEvent.click(screen.getByRole('switch', { name: /Mentions and tags/ }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mention and tag emails are off.'))
    expect(mocks.setNotificationEmailPreference).toHaveBeenCalledWith('mentions', false)
    expect(screen.getByRole('switch', { name: /Mentions and tags/ })).not.toBeChecked()
  })

  it('puts the switch back and explains when saving fails', async () => {
    mocks.setNotificationEmailPreference.mockResolvedValue({ ok: false, error: 'Your email setting could not be saved. Please try again.' })
    render(<NotificationEmailToggle kind="messages" initiallyEnabled={false} />)

    fireEvent.click(screen.getByRole('switch', { name: /Unread messages/ }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be saved'))
    expect(screen.getByRole('switch', { name: /Unread messages/ })).not.toBeChecked()
  })
})
