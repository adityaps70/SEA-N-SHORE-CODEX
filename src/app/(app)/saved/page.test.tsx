import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSavedPosts } from '@/features/feed/queries'
import SavedPostsPage from './page'

vi.mock('@/features/feed/queries', () => ({
  getSavedPosts: vi.fn(),
}))
vi.mock('./saved-posts-grid', () => ({
  SavedPostsGrid: ({ posts }: { posts: Array<{ id: string }> }) => <div>{posts.map((post) => <p key={post.id}>Saved post {post.id}</p>)}</div>,
}))

const mockedGetSavedPosts = vi.mocked(getSavedPosts)
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Saved posts page', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetSavedPosts.mockResolvedValue([{ id: postId }] as never)
  })

  it('renders the signed-in member saved posts', async () => {
    render(await SavedPostsPage())

    expect(screen.getByRole('heading', { name: 'Saved posts' })).toBeInTheDocument()
    expect(screen.getByText(`Saved post ${postId}`)).toBeInTheDocument()
    expect(screen.getByText('1 post')).toBeInTheDocument()
    expect(mockedGetSavedPosts).toHaveBeenCalledTimes(1)
  })

  it('shows the phone page bar back to Home and keeps the intro for md and wider', async () => {
    render(await SavedPostsPage())

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/home')
    expect(screen.getByText('Saved posts', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Saved posts' }).closest('header')).toHaveClass('max-md:hidden')
  })

  it('provides a useful empty state back to Home', async () => {
    mockedGetSavedPosts.mockResolvedValueOnce([])

    render(await SavedPostsPage())

    expect(screen.getByText('No saved posts yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the feed' })).toHaveAttribute('href', '/home')
  })
})
