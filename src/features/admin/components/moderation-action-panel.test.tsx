import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  moderateContent: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  moderateContent: mocks.moderateContent,
}))

import { ModerationActionPanel } from './moderation-action-panel'

const targetId = '22222222-2222-4222-8222-222222222222'

describe('ModerationActionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.moderateContent.mockResolvedValue({ ok: true })
  })

  it('validates moderator notes before destructive actions', () => {
    render(<ModerationActionPanel targetType="post" targetId={targetId} targetState="visible" />)

    fireEvent.click(screen.getByRole('button', { name: /remove content/i }))

    expect(screen.getByRole('status')).toHaveTextContent('Add a moderation note before taking this action.')
    expect(mocks.moderateContent).not.toHaveBeenCalled()
  })

  it('shows immediate progress and refreshes after a successful action', async () => {
    let resolveAction: ((value: { ok: true }) => void) | undefined
    mocks.moderateContent.mockReturnValueOnce(new Promise((resolve) => {
      resolveAction = resolve
    }))

    render(<ModerationActionPanel targetType="post" targetId={targetId} targetState="visible" />)
    fireEvent.change(screen.getByLabelText(/moderator note/i), { target: { value: 'Reviewed against community rules.' } })
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }))

    expect(screen.getByRole('status')).toHaveTextContent('Saving moderation action…')
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()

    resolveAction?.({ ok: true })

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('Moderation action saved.')
  })

  it('surfaces a visible retry message when the server action rejects', async () => {
    mocks.moderateContent.mockRejectedValueOnce(new Error('stale server action'))

    render(<ModerationActionPanel targetType="job" targetId={targetId} targetState="published" />)
    fireEvent.change(screen.getByLabelText(/moderator note/i), { target: { value: 'Reviewed.' } })
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The moderation request could not be completed. Refresh this page and try again.',
    )
  })
})
