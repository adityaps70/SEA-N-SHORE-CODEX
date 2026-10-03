import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPostById } from '@/features/feed/queries'
import PostPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/features/feed/queries', () => ({ getPostById: vi.fn() }))
vi.mock('@/features/feed/components/post-card', () => ({
  PostCard: ({ post, detail, flushOnPhones }: { post: { id: string }; detail?: boolean; flushOnPhones?: boolean }) => (
    <article>Post {post.id}{detail ? ' detail' : ''}{flushOnPhones ? ' flush' : ''}</article>
  ),
}))

const mockedGetPostById = vi.mocked(getPostById)
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Post page', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetPostById.mockResolvedValue({ id: postId } as never)
  })

  it('shows the phone page bar back to Home and the post edge to edge', async () => {
    render(await PostPage({ params: Promise.resolve({ id: postId }) }))

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/home')
    expect(screen.getByText('Post', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByText(`Post ${postId} detail flush`)).toBeInTheDocument()
  })

  it('is not found for a missing post', async () => {
    mockedGetPostById.mockResolvedValueOnce(null)
    await expect(PostPage({ params: Promise.resolve({ id: postId }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
