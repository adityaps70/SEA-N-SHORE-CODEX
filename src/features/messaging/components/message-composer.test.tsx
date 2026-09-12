import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendMessageAction: vi.fn(),
}))

vi.mock('../actions', () => ({ sendMessageAction: mocks.sendMessageAction }))

import { MessageComposer } from './message-composer'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

function canonical(clientMessageId: string) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    conversationId: CONVERSATION_ID,
    senderProfileId: VIEWER_ID,
    clientMessageId,
    body: 'Good day, Captain.',
    createdAt: '2026-09-13T02:30:00.000Z',
    editedAt: null,
    deletedAt: null,
  }
}

afterEach(() => cleanup())

describe('MessageComposer', () => {
  it('adds an optimistic message immediately and reconciles it with the canonical persisted message', async () => {
    const user = userEvent.setup()
    const onOptimisticMessage = vi.fn()
    const onMessageConfirmed = vi.fn()
    const onMessageFailed = vi.fn()
    mocks.sendMessageAction.mockImplementationOnce(async (input: { clientMessageId: string }) => ({
      ok: true,
      message: canonical(input.clientMessageId),
    }))

    render(
      <MessageComposer
        conversationId={CONVERSATION_ID}
        viewerId={VIEWER_ID}
        onOptimisticMessage={onOptimisticMessage}
        onMessageConfirmed={onMessageConfirmed}
        onMessageFailed={onMessageFailed}
      />,
    )

    const textbox = screen.getByRole('textbox', { name: 'Write a message' })
    await user.type(textbox, '  Good day, Captain.  ')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(onOptimisticMessage).toHaveBeenCalledTimes(1)
    const optimistic = onOptimisticMessage.mock.calls[0]?.[0] as { clientMessageId: string; body: string; deliveryState: string }
    expect(optimistic.body).toBe('Good day, Captain.')
    expect(optimistic.deliveryState).toBe('sending')
    expect(textbox).toHaveValue('')

    expect(mocks.sendMessageAction).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      clientMessageId: optimistic.clientMessageId,
      body: 'Good day, Captain.',
    })

    await waitFor(() => expect(onMessageConfirmed).toHaveBeenCalledWith(
      optimistic.clientMessageId,
      canonical(optimistic.clientMessageId),
    ))
    expect(onMessageFailed).not.toHaveBeenCalled()
  })

  it('keeps failed optimistic sends visible through a retryable failed state callback', async () => {
    const user = userEvent.setup()
    const onOptimisticMessage = vi.fn()
    const onMessageConfirmed = vi.fn()
    const onMessageFailed = vi.fn()
    mocks.sendMessageAction.mockResolvedValueOnce({ ok: false, error: 'Unable to send right now.' })

    render(
      <MessageComposer
        conversationId={CONVERSATION_ID}
        viewerId={VIEWER_ID}
        onOptimisticMessage={onOptimisticMessage}
        onMessageConfirmed={onMessageConfirmed}
        onMessageFailed={onMessageFailed}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Write a message' }), 'Check satcom window')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    const optimistic = onOptimisticMessage.mock.calls[0]?.[0] as { clientMessageId: string }
    await waitFor(() => expect(onMessageFailed).toHaveBeenCalledWith(
      optimistic.clientMessageId,
      'Unable to send right now.',
    ))
    expect(onMessageConfirmed).not.toHaveBeenCalled()
  })
})
