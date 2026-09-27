import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_MS, ReactionPicker } from './reaction-picker'

afterEach(() => cleanup())

describe('ReactionPicker hover behavior', () => {
  it('renders a neutral lucide thumbs-up and no yellow Like emoji when unreacted', () => {
    const { container } = render(<ReactionPicker value={null} onChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: /^Like$/i })
    expect(trigger.querySelector('svg.lucide-thumbs-up')).toBeInTheDocument()
    expect(trigger).not.toHaveTextContent('👍')
    expect(container.querySelectorAll('svg.lucide-thumbs-up')).toHaveLength(1)
  })

  it('renders only the selected reaction emoji when reacted', () => {
    render(<ReactionPicker value="support" onChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Support' })
    expect(trigger).toHaveTextContent('❤️')
    expect(trigger.querySelector('svg.lucide-thumbs-up')).not.toBeInTheDocument()
    expect(trigger).not.toHaveTextContent('👍')
  })

  it('selects Like from the neutral control and removes the selected reaction when clicked', async () => {
    const user = userEvent.setup()
    const onNeutralChange = vi.fn()
    const { rerender } = render(<ReactionPicker value={null} onChange={onNeutralChange} />)

    await user.click(screen.getByRole('button', { name: /^Like$/i }))
    expect(onNeutralChange).toHaveBeenCalledWith('like')

    const onSelectedChange = vi.fn()
    rerender(<ReactionPicker value="respect" onChange={onSelectedChange} />)
    await user.click(screen.getByRole('button', { name: 'Respect' }))
    expect(onSelectedChange).toHaveBeenCalledWith(null)
  })

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

  it('shows the reaction label and the total count inside the Like button; menu labels stay screen-reader only', async () => {
    const user = userEvent.setup()
    const { container } = render(<ReactionPicker value="on_point" onChange={vi.fn()} count={12} />)

    const trigger = screen.getByRole('button', { name: 'On Point' })
    expect(trigger).toHaveTextContent('⚓On Point12')
    expect(trigger.querySelector('[data-reaction-label]')).not.toHaveClass('sr-only')
    // Reacted: accent colour.
    expect(trigger).toHaveClass('text-ocean-700')
    expect(within(trigger).getByTestId('reaction-count')).toHaveTextContent('12')

    await user.hover(trigger)
    await screen.findByRole('menu', { name: 'Reactions' })
    const menuLabels = [...container.querySelectorAll('[role="menu"] [data-reaction-label]')]
    expect(menuLabels).toHaveLength(4)
    for (const label of menuLabels) expect(label).toHaveClass('sr-only')
  })

  it('shows an outline thumbs-up with "Like" and no count when nobody reacted yet', () => {
    render(<ReactionPicker value={null} onChange={vi.fn()} count={0} />)
    const trigger = screen.getByRole('button', { name: 'Like' })
    expect(trigger).toHaveTextContent(/^Like$/)
    expect(trigger).not.toHaveClass('text-ocean-700')
    expect(within(trigger).queryByTestId('reaction-count')).not.toBeInTheDocument()
  })

  it('hides the post label on narrow rows but keeps it for comments', () => {
    const { rerender } = render(<ReactionPicker value={null} onChange={vi.fn()} count={3} variant="post" />)
    expect(screen.getByRole('button', { name: 'Like' }).querySelector('[data-reaction-label]')).toHaveClass('hidden', '@min-[34rem]:inline')
    rerender(<ReactionPicker value={null} onChange={vi.fn()} count={3} variant="comment" />)
    expect(screen.getByRole('button', { name: 'Like' }).querySelector('[data-reaction-label]')).not.toHaveClass('hidden')
  })

  it('opens the reactions on a long press without also toggling Like', async () => {
    const onChange = vi.fn()
    render(<ReactionPicker value={null} onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Like' })

    fireEvent.touchStart(trigger)
    // A touch also fires an emulated hover; that alone must not open the menu.
    fireEvent.mouseEnter(trigger)
    expect(screen.queryByRole('menu', { name: 'Reactions' })).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 80))
    expect(await screen.findByRole('menu', { name: 'Reactions' })).toBeInTheDocument()
    fireEvent.touchEnd(trigger)
    fireEvent.click(trigger)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Support' }))
    expect(onChange).toHaveBeenCalledWith('support')
  })

  it('toggles Like on a short tap', () => {
    const onChange = vi.fn()
    render(<ReactionPicker value={null} onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Like' })
    fireEvent.touchStart(trigger)
    fireEvent.touchEnd(trigger)
    fireEvent.click(trigger)
    expect(onChange).toHaveBeenCalledWith('like')
  })

  it('closes the reactions with Escape and returns focus to Like', async () => {
    const user = userEvent.setup()
    render(<ReactionPicker value={null} onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Like' })
    await user.hover(trigger)
    const menu = await screen.findByRole('menu', { name: 'Reactions' })
    fireEvent.keyDown(within(menu).getByRole('menuitemradio', { name: 'Support' }), { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Reactions' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('uses an immediate custom tooltip above each reaction instead of the native title tooltip', async () => {
    const user = userEvent.setup()
    render(<ReactionPicker value={null} onChange={vi.fn()} />)

    await user.hover(screen.getByRole('button', { name: /^Like$/i }))

    const onPoint = await screen.findByRole('menuitemradio', { name: 'On Point' })
    expect(onPoint).not.toHaveAttribute('title')

    await user.hover(onPoint)

    const tooltip = await screen.findByRole('tooltip', { name: 'On Point' })
    expect(tooltip).toHaveAttribute('data-placement', 'top')
    expect(tooltip).toHaveClass('rounded-lg')
    expect(tooltip).toHaveClass('bottom-full')
  })
})
