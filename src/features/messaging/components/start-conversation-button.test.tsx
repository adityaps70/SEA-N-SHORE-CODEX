import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  startDirectConversationAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('../actions', () => ({
  startDirectConversationAction: mocks.startDirectConversationAction,
}))

import { StartConversationButton } from './start-conversation-button'

const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('StartConversationButton', () => {
  it('opens the authenticated direct conversation after the server action succeeds', async () => {
    const user = userEvent.setup()
    mocks.startDirectConversationAction.mockResolvedValueOnce({
      ok: true,
      conversationId: CONVERSATION_ID,
    })

    render(<StartConversationButton targetProfileId={TARGET_ID} />)
    await user.click(screen.getByRole('button', { name: 'Message' }))

    expect(mocks.startDirectConversationAction).toHaveBeenCalledWith(TARGET_ID, undefined)
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/messages/${CONVERSATION_ID}`))
  })

  it('passes a recruiter\'s reason to the server action (recruiter messaging exception)', async () => {
    const user = userEvent.setup()
    mocks.startDirectConversationAction.mockResolvedValueOnce({ ok: true, conversationId: CONVERSATION_ID })
    render(<StartConversationButton targetProfileId={TARGET_ID} contact={{ reason: 'open_to_recruiters' }} />)
    await user.click(screen.getByRole('button', { name: 'Message' }))
    expect(mocks.startDirectConversationAction).toHaveBeenCalledWith(TARGET_ID, { reason: 'open_to_recruiters' })
  })

  it('names the member for screen readers when given one, as in a list of candidates', async () => {
    const user = userEvent.setup()
    let resolve: (value: { ok: true; conversationId: string }) => void = () => {}
    mocks.startDirectConversationAction.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<StartConversationButton targetProfileId={TARGET_ID} fullName="Placeholder Member" variant="pill" />)
    const button = screen.getByRole('button', { name: 'Message Placeholder Member' })
    expect(button).toHaveTextContent('Message')
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Opening conversation with Placeholder Member' })).toBeDisabled()
    resolve({ ok: true, conversationId: CONVERSATION_ID })
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/messages/${CONVERSATION_ID}`))
  })

  it('shows a safe inline error instead of navigating when messaging is unavailable', async () => {
    const user = userEvent.setup()
    mocks.startDirectConversationAction.mockResolvedValueOnce({
      ok: false,
      error: 'You can message accepted connections only.',
    })

    render(<StartConversationButton targetProfileId={TARGET_ID} />)
    await user.click(screen.getByRole('button', { name: 'Message' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('You can message accepted connections only.')
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
