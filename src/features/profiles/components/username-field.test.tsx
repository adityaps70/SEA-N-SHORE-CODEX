import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../username-actions', () => ({
  checkUsernameAvailability: vi.fn(async () => ({
    available: true,
    current: false,
  })),
}))

import { UsernameField } from './username-field'

afterEach(() => cleanup())

describe('UsernameField server validation', () => {
  it('keeps a server-side username error visible and marks the field invalid until the value changes', () => {
    render(
      <UsernameField
        initialValue="asha-singh"
        serverError="That username is already in use. Choose a different username and try again."
      />,
    )

    const input = screen.getByRole('textbox', { name: /Username/i })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/choose a different username and try again/i)).toBeInTheDocument()
  })
})
