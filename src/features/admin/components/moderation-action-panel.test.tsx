import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import { ModerationActionPanel } from './moderation-action-panel'

const targetId = '22222222-2222-4222-8222-222222222222'

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('ModerationActionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.fetch.mockResolvedValue(response({ ok: true }))
  })

  it('validates moderator notes before destructive actions', () => {
    render(<ModerationActionPanel targetType="post" targetId={targetId} targetState="visible" />)

    fireEvent.click(screen.getByRole('button', { name: /remove content/i }))

    expect(screen.getByRole('status')).toHaveTextContent('Add a moderation note before taking this action.')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('posts to the stable moderation endpoint, shows progress and refreshes after success', async () => {
    let resolveRequest: ((value: ReturnType<typeof response>) => void) | undefined
    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve
    }))

    render(<ModerationActionPanel targetType="post" targetId={targetId} targetState="visible" />)
    fireEvent.change(screen.getByLabelText(/moderator note/i), { target: { value: 'Reviewed against community rules.' } })
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }))

    expect(screen.getByRole('status')).toHaveTextContent('Saving moderation action…')
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/moderation', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    }))

    const request = mocks.fetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      targetType: 'post',
      targetId,
      action: 'resolve',
      note: 'Reviewed against community rules.',
    })

    resolveRequest?.(response({ ok: true }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('Moderation action saved.')
  })

  it('surfaces API error copy instead of silently doing nothing', async () => {
    mocks.fetch.mockResolvedValueOnce(response({
      ok: false,
      error: 'You do not have permission to moderate platform content.',
    }, false))

    render(<ModerationActionPanel targetType="job" targetId={targetId} targetState="published" />)
    fireEvent.change(screen.getByLabelText(/moderator note/i), { target: { value: 'Reviewed.' } })
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'You do not have permission to moderate platform content.',
    )
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('surfaces a visible retry message when the request itself fails', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('network failure'))

    render(<ModerationActionPanel targetType="job" targetId={targetId} targetState="published" />)
    fireEvent.change(screen.getByLabelText(/moderator note/i), { target: { value: 'Reviewed.' } })
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The moderation request could not be completed. Refresh this page and try again.',
    )
  })
})
