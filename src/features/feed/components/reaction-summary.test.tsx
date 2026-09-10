import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_REACTION_SUMMARY } from '../types'
import { ReactionSummaryTrigger } from './reaction-summary'

afterEach(() => cleanup())

describe('ReactionSummaryTrigger', () => {
  it('keeps the left summary text-only and renders each active reaction type once in the far-right cluster', () => {
    const onOpen = vi.fn()
    render(<ReactionSummaryTrigger
      summary={{ like: 40, support: 8, respect: 0, on_point: 5 }}
      commentCount={12}
      onOpen={onOpen}
    />)

    expect(screen.getByText('53 reactions')).toBeInTheDocument()
    expect(screen.queryByText('👍❤️⚓')).not.toBeInTheDocument()
    expect(screen.getAllByText('👍')).toHaveLength(1)
    expect(screen.getAllByText('❤️')).toHaveLength(1)
    expect(screen.getAllByText('⚓')).toHaveLength(1)
    expect(screen.queryByText('🫡')).not.toBeInTheDocument()
    expect(screen.getByText('12 comments')).toBeInTheDocument()

    const triggers = screen.getAllByRole('button', { name: /view .*reactions/i })
    expect(triggers.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(triggers[0])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('uses a neutral lucide thumbs-up when no reactions exist', () => {
    const { container } = render(<ReactionSummaryTrigger
      summary={EMPTY_REACTION_SUMMARY}
      commentCount={0}
      onOpen={vi.fn()}
    />)

    expect(screen.getByText('Be the first to react')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-thumbs-up')).not.toBeNull()
    expect(screen.queryByText('👍')).not.toBeInTheDocument()
  })
})
