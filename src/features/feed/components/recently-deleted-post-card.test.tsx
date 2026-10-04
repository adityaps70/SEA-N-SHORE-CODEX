import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentlyDeletedPost } from '../types'

const mocks = vi.hoisted(() => ({
  restoreDeletedPost: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('../actions', () => ({
  restoreDeletedPost: mocks.restoreDeletedPost,
}))

import { RecentlyDeletedPostCard } from './recently-deleted-post-card'

const post: RecentlyDeletedPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'technical_discussion',
  body: 'A bridge resource management lesson that was deleted by mistake.',
  deletedAt: '2026-09-23T10:00:00.000Z',
  purgeAfter: '2026-10-23T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.restoreDeletedPost.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
})

describe('RecentlyDeletedPostCard', () => {
  it('shows the deleted post, recovery deadline and restores it for the member', async () => {
    const user = userEvent.setup()
    render(<RecentlyDeletedPostCard post={post} />)

    expect(screen.getByText('Technical Discussion')).toBeInTheDocument()
    expect(screen.getByText(/bridge resource management lesson/i)).toBeInTheDocument()
    expect(screen.getByText(/recoverable until/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restore post' }))

    await waitFor(() => expect(mocks.restoreDeletedPost).toHaveBeenCalledWith(post.id))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Post restored.')
  })

  it('shows a safe recovery failure without removing the card', async () => {
    const user = userEvent.setup()
    mocks.restoreDeletedPost.mockResolvedValueOnce({
      ok: false,
      error: 'This post can no longer be restored.',
    })

    render(<RecentlyDeletedPostCard post={post} />)
    await user.click(screen.getByRole('button', { name: 'Restore post' }))

    expect(await screen.findByRole('status')).toHaveTextContent('This post can no longer be restored.')
  })
})
