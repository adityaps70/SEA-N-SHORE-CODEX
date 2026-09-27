import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({
  deleteConversationAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/messages',
}))
vi.mock('../actions', () => actions)

import { ConversationActionsMenu, messagingProfileHref } from './conversation-actions'

const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('ConversationActionsMenu', () => {
  beforeEach(() => {
    actions.deleteConversationAction.mockReset()
  })
  afterEach(() => cleanup())

  it('links conversation partners to their public profile page', () => {
    expect(messagingProfileHref('meera-nair')).toBe('/people/meera-nair')
    expect(messagingProfileHref('  ')).toBeNull()
    expect(messagingProfileHref(null)).toBeNull()
  })

  it('opens a menu with Delete conversation and asks for confirmation in the page', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Capt. Meera Nair" onDeleted={onDeleted} />)

    const trigger = screen.getByRole('button', { name: 'Conversation options for Capt. Meera Nair' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this conversation?' })
    expect(dialog).toHaveTextContent('It will be removed for you only. Capt. Meera Nair can still see it.')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(actions.deleteConversationAction).not.toHaveBeenCalled()
  })

  it('Cancel and Escape close the confirmation without deleting', async () => {
    const user = userEvent.setup()
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Capt. Meera Nair" onDeleted={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(actions.deleteConversationAction).not.toHaveBeenCalled()
  })

  it('closes the menu with Escape', async () => {
    const user = userEvent.setup()
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Capt. Meera Nair" onDeleted={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a pending state while deleting, then reports the result', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const pending = deferred<{ ok: true; conversationId: string; unreadCount: number }>()
    actions.deleteConversationAction.mockReturnValueOnce(pending.promise)
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Capt. Meera Nair" onDeleted={onDeleted} />)

    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(actions.deleteConversationAction).toHaveBeenCalledWith(CONVERSATION_ID)
    const deleting = screen.getByRole('button', { name: 'Deleting…' })
    expect(deleting).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    pending.resolve({ ok: true, conversationId: CONVERSATION_ID, unreadCount: 1 })
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, unreadCount: 1 })
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog open with a clear message when the delete fails', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    actions.deleteConversationAction.mockResolvedValueOnce({
      ok: false,
      error: 'We could not delete this conversation. Check your connection and try again.',
    })
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Capt. Meera Nair" onDeleted={onDeleted} />)

    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not delete this conversation. Check your connection and try again.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('shows a connection message when the request itself fails', async () => {
    const user = userEvent.setup()
    actions.deleteConversationAction.mockRejectedValueOnce(new Error('network'))
    render(<ConversationActionsMenu conversationId={CONVERSATION_ID} otherName="Capt. Meera Nair" onDeleted={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Conversation options/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection and try again.')
  })
})
