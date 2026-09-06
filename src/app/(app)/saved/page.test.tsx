import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSavedPosts } from '@/features/feed/queries'
import SavedPostsPage from './page'

vi.mock('@/features/feed/queries', () => ({
  getSavedPosts: vi.fn(),
}))
vi.mock('@/features/feed/components/post-card', () => ({
  PostCard: ({ post }: { post: { id: string } }) => <div>Saved post {post.id}</div>,
}))

const mockedGetSavedPosts = vi.mocked(getSavedPosts)
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Saved posts page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetSavedPosts.mockResolvedValue([{ id: postId }] as never)
  })

  it('renders the signed-in member saved posts', async () => {
    render(await SavedPostsPage())

    expect(screen.getByRole('heading', { name: 'Saved posts' })).toBeInTheDocument()
    expect(screen.getByText(`Saved post ${postId}`)).toBeInTheDocument()
    expect(mockedGetSavedPosts).toHaveBeenCalledTimes(1)
  })

  it('provides a useful empty state back to Home', async () => {
    mockedGetSavedPosts.mockResolvedValueOnce([])

    render(await SavedPostsPage())

    expect(screen.getByText('No saved posts yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the feed' })).toHaveAttribute('href', '/home')
  })
})
