import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../mfa-reset-actions', () => ({ resetMemberTwoStepAction: vi.fn(async (state: unknown) => state) }))

const { MfaResetPanel } = await import('./mfa-reset-panel')

afterEach(() => cleanup())

/** Admin two-step (owner, 21 Nov): Admin › Users › Reset two-step verification. */
describe('MfaResetPanel', () => {
  it('asks for a reason and the member’s @username', () => {
    const { container } = render(<MfaResetPanel profileId="11111111-1111-4111-8111-111111111111" username="placeholder-partner" />)
    expect(screen.getByRole('textbox', { name: /Reason/ })).toBeRequired()
    expect(screen.getByRole('textbox', { name: /Type @placeholder-partner to confirm/ })).toBeRequired()
    expect(container.querySelector('input[name="profileId"]')).toHaveAttribute('value', '11111111-1111-4111-8111-111111111111')
    expect(screen.getByRole('button', { name: 'Reset two-step verification' })).toBeInTheDocument()
  })

  it('cannot be confirmed for a member with no public username', () => {
    render(<MfaResetPanel profileId="11111111-1111-4111-8111-111111111111" username={null} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
