import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactionPicker } from './reaction-picker'

afterEach(() => cleanup())

describe('ReactionPicker liked state (Round H)', () => {
  it('shows Liked with a filled thumbs-up, accent text, bold label and ocean fill that phones keep', () => {
    render(<ReactionPicker value="like" onChange={vi.fn()} count={3} />)
    const trigger = screen.getByRole('button', { name: 'Like' })

    expect(trigger).toHaveAttribute('aria-pressed', 'true')
    expect(trigger).toHaveClass('bg-ocean-50', 'text-ocean-700', 'font-bold', 'border-ocean-300')
    expect(trigger).not.toHaveClass('max-md:bg-white')
    // The shared phone hover would otherwise swap the fill for mist after a tap.
    expect(trigger).not.toHaveClass('max-md:hover:bg-mist-50')
    expect(trigger).toHaveClass('max-md:hover:bg-ocean-100')
    const icon = trigger.querySelector('svg.lucide-thumbs-up')
    expect(icon).toHaveClass('fill-current')
    expect(trigger).not.toHaveTextContent('👍')
  })

  it('keeps the unliked state plainly different', () => {
    render(<ReactionPicker value={null} onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Like' })

    expect(trigger).toHaveAttribute('aria-pressed', 'false')
    expect(trigger).toHaveClass('bg-white', 'text-navy-900', 'font-semibold', 'max-md:hover:bg-mist-50')
    expect(trigger).not.toHaveClass('bg-ocean-50', 'font-bold')
    expect(trigger.querySelector('svg.lucide-thumbs-up')).not.toHaveClass('fill-current')
  })

  it('keeps the comment Like filled when reacted', () => {
    render(<ReactionPicker value="like" onChange={vi.fn()} variant="comment" />)
    const trigger = screen.getByRole('button', { name: 'Like' })
    expect(trigger).toHaveClass('bg-ocean-50', 'text-ocean-700')
    expect(trigger).toHaveAttribute('aria-pressed', 'true')
  })
})
