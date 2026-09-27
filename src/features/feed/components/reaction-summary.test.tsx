import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_REACTION_SUMMARY } from '../types'
import { ReactionSummaryTrigger } from './reaction-summary'

afterEach(() => cleanup())

describe('ReactionSummaryTrigger', () => {
  it('shows only the reaction types present, stacked, with no number, and opens reactor details', () => {
    const onOpen = vi.fn()
    render(<ReactionSummaryTrigger
      summary={{ like: 40, support: 8, respect: 0, on_point: 5 }}
      onOpen={onOpen}
    />)

    // The total lives in the Like button; this control names it only for screen readers.
    const trigger = screen.getByRole('button', { name: 'View 53 reactions' })
    expect(trigger).toHaveTextContent(/^👍❤️⚓$/)
    expect(trigger).not.toHaveTextContent('53')
    expect(trigger).not.toHaveTextContent('🫡')
    expect(trigger).toHaveClass('border')
    expect(trigger).toHaveClass('cursor-pointer')

    fireEvent.click(trigger)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('names comment reactions for screen readers', () => {
    render(<ReactionSummaryTrigger variant="comment" summary={{ like: 1, support: 0, respect: 0, on_point: 0 }} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'View 1 comment reaction' })).toHaveTextContent(/^👍$/)
  })

  it('is hidden when there are no reactions', () => {
    render(<ReactionSummaryTrigger
      summary={EMPTY_REACTION_SUMMARY}
      onOpen={vi.fn()}
    />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/react/i)).not.toBeInTheDocument()
  })
})
