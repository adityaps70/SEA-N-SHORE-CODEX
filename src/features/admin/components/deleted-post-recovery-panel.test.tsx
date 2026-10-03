import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { DeletedPostRecoveryPanel } from './deleted-post-recovery-panel'

const postId = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DeletedPostRecoveryPanel', () => {
  it('requires an admin recovery reason before restoring a retained post', async () => {
    const user = userEvent.setup()
    render(<DeletedPostRecoveryPanel postId={postId} recoverable />)

    await user.click(screen.getByRole('button', { name: 'Restore post' }))
    expect(screen.getByRole('status')).toHaveTextContent(/at least 10 characters/i)
    expect(fetch).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Recovery reason'), 'Author confirmed accidental deletion.')
    await user.click(screen.getByRole('button', { name: 'Restore post' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/admin/deleted-posts/${postId}/restore`,
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      reason: 'Author confirmed accidental deletion.',
    })
  })

  it('disables recovery after the retention deadline', () => {
    render(<DeletedPostRecoveryPanel postId={postId} recoverable={false} />)

    expect(screen.getByRole('button', { name: 'Recovery expired' })).toBeDisabled()
    expect(screen.getByText(/no longer recoverable/i)).toBeInTheDocument()
  })
})
