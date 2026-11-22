import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ moderateContent: vi.fn(async () => ({ ok: true })), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../actions', () => ({ moderateContent: mocks.moderateContent }))

const { ModerationActionPanel } = await import('./moderation-action-panel')

afterEach(() => cleanup())

/** Round GP Part E: the moderation panel for country admins. */
describe('ModerationActionPanel for country admins', () => {
  it('sends decisions through the server action, never the platform-only API route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<ModerationActionPanel targetType="post" targetId="11111111-1111-4111-8111-111111111111" targetState="active" mode="country" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Placeholder note.' } })
    fireEvent.click(screen.getByRole('button', { name: /Remove content/ }))
    await waitFor(() => expect(mocks.moderateContent).toHaveBeenCalledWith({ targetType: 'post', targetId: '11111111-1111-4111-8111-111111111111', action: 'remove', note: 'Placeholder note.' }))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('shows a reported member profile without controls', () => {
    render(<ModerationActionPanel targetType="profile" targetId="11111111-1111-4111-8111-111111111111" targetState="active" mode="country" />)
    expect(screen.getByText('Only Sea N Shore administrators act on reported member profiles.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers only cancel and restore to a country admin with Events only', () => {
    const { rerender } = render(<ModerationActionPanel targetType="event" targetId="11111111-1111-4111-8111-111111111111" targetState="published" mode="country" actions={['remove', 'restore']} />)
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Cancel event'])
    rerender(<ModerationActionPanel targetType="event" targetId="11111111-1111-4111-8111-111111111111" targetState="cancelled" mode="country" actions={['remove', 'restore']} />)
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Restore event'])
  })

  it('shows view-only country admins the case without controls', () => {
    render(<ModerationActionPanel targetType="post" targetId="11111111-1111-4111-8111-111111111111" targetState="active" mode="view" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
