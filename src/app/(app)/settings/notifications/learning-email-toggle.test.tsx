import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setLearningEmailPreference: vi.fn() }))
vi.mock('@/features/learning/learning-email-actions', () => ({ setLearningEmailPreference: mocks.setLearningEmailPreference }))

import { LearningEmailToggle } from './learning-email-toggle'

describe('Settings → Email notifications: Learning emails', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('turns learning emails off and says the updates still appear in Notifications', async () => {
    mocks.setLearningEmailPreference.mockResolvedValue({ ok: true, enabled: false })
    render(<LearningEmailToggle initiallyEnabled />)

    const toggle = screen.getByRole('switch', { name: /Learning emails/ })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Learning emails are off. You still see these updates in Notifications.'))
    expect(mocks.setLearningEmailPreference).toHaveBeenCalledWith(false)
    expect(toggle).not.toBeChecked()
  })

  it('puts the switch back and explains when saving fails', async () => {
    mocks.setLearningEmailPreference.mockResolvedValue({ ok: false, error: 'Your email setting could not be saved. Please try again.' })
    render(<LearningEmailToggle initiallyEnabled={false} />)

    fireEvent.click(screen.getByRole('switch', { name: /Learning emails/ }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be saved'))
    expect(screen.getByRole('switch', { name: /Learning emails/ })).not.toBeChecked()
  })
})
