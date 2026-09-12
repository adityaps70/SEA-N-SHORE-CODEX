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

    expect(mocks.startDirectConversationAction).toHaveBeenCalledWith(TARGET_ID)
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
