import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_REACTION_SUMMARY } from '../types'
import { ReactionSummaryTrigger } from './reaction-summary'

afterEach(() => cleanup())

describe('ReactionSummaryTrigger', () => {
  it('renders active reaction symbols with only the numeric total and opens reactor details', () => {
    const onOpen = vi.fn()
    render(<ReactionSummaryTrigger
      summary={{ like: 40, support: 8, respect: 0, on_point: 5 }}
      onOpen={onOpen}
    />)

    const trigger = screen.getByRole('button', { name: 'View 53 reactions' })
    expect(trigger).toHaveTextContent('👍')
    expect(trigger).toHaveTextContent('❤️')
    expect(trigger).toHaveTextContent('⚓')
    expect(trigger).toHaveTextContent('53')
    expect(trigger).not.toHaveTextContent(/reaction/i)
    expect(screen.queryByText('🫡')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not add a duplicate summary control when no reactions exist', () => {
    render(<ReactionSummaryTrigger
      summary={EMPTY_REACTION_SUMMARY}
      onOpen={vi.fn()}
    />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/react/i)).not.toBeInTheDocument()
  })
})
