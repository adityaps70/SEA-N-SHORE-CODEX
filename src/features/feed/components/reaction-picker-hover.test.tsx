import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactionPicker } from './reaction-picker'

afterEach(() => cleanup())

describe('ReactionPicker hover behavior', () => {
  it('shows reactions on hover without an arrow chooser button', async () => {
    const user = userEvent.setup()
    render(<ReactionPicker value={null} onChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /choose reaction/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'Reactions' })).not.toBeInTheDocument()

    await user.hover(screen.getByRole('button', { name: /^Like$/i }))

    const menu = await screen.findByRole('menu', { name: 'Reactions' })
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Support/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Respect/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /On Point/i })).toBeInTheDocument()
  })

  it('keeps reaction names accessible but hides all reaction text labels visually', async () => {
    const user = userEvent.setup()
    const { container } = render(<ReactionPicker value="on_point" onChange={vi.fn()} compact />)

    const trigger = screen.getByRole('button', { name: 'On Point' })
    expect(trigger).toBeInTheDocument()
    expect(trigger.querySelector('[data-reaction-label]')).toHaveClass('sr-only')

    await user.hover(trigger)

    const menu = await screen.findByRole('menu', { name: 'Reactions' })
    expect(menu).toBeInTheDocument()
    for (const label of container.querySelectorAll('[data-reaction-label]')) {
      expect(label).toHaveClass('sr-only')
    }
  })
})
