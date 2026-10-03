import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getHashtagSummary: vi.fn(),
  isFollowingHashtag: vi.fn(),
  getFeedPage: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/hashtags/repository', () => ({
  hashtagRepository: { getHashtagSummary: mocks.getHashtagSummary, isFollowingHashtag: mocks.isFollowingHashtag },
}))
vi.mock('@/features/hashtags/actions', () => ({ followHashtag: vi.fn(), unfollowHashtag: vi.fn() }))
vi.mock('@/features/feed/queries', () => ({ getFeedPage: mocks.getFeedPage }))
vi.mock('@/features/feed/components/feed-list', () => ({
  FeedList: ({ initialPage, scope }: { initialPage: { posts: { id: string }[] }; scope?: { hashtag?: string } }) => (
    <div data-testid="feed-list" data-hashtag={scope?.hashtag} data-count={initialPage.posts.length} />
  ),
}))

import { hashtagFromParam } from '@/features/hashtags/page-param'
import HashtagPage, { generateMetadata } from './page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
  mocks.getHashtagSummary.mockResolvedValue({ tag: 'sire', postCount: 12, followerCount: 3 })
  mocks.isFollowingHashtag.mockResolvedValue(false)
  mocks.getFeedPage.mockResolvedValue({ posts: [{ id: 'p1' }, { id: 'p2' }], nextCursor: null })
})

afterEach(cleanup)

describe('hashtagFromParam', () => {
  it('normalises the URL segment and rejects tags the database cannot hold', () => {
    expect(hashtagFromParam('SIRE')).toBe('sire')
    expect(hashtagFromParam('%23Life_At_Sea')).toBe('life_at_sea')
    expect(hashtagFromParam('not%20a%20tag')).toBeNull()
    expect(hashtagFromParam('%E0%A4')).toBeNull()
    expect(hashtagFromParam('')).toBeNull()
  })
})

describe('HashtagPage', () => {
  it('shows the tag, its counts, a Follow button and the hashtag feed for signed-in members', async () => {
    render(await HashtagPage({ params: Promise.resolve({ tag: 'SIRE' }) }))

    expect(mocks.requireAwsUser).toHaveBeenCalled()
    expect(mocks.getFeedPage).toHaveBeenCalledWith({ hashtag: 'sire' })
    expect(mocks.isFollowingHashtag).toHaveBeenCalledWith('viewer-1', 'sire')
    expect(screen.getByRole('heading', { level: 1, name: '#sire' })).toBeInTheDocument()
    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('12 posts')
    expect(screen.getByRole('button', { name: 'Follow #sire' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('hashtag-follower-count')).toHaveTextContent('3 followers')
    const feed = screen.getByTestId('feed-list')
    expect(feed).toHaveAttribute('data-hashtag', 'sire')
    expect(feed).toHaveAttribute('data-count', '2')
    // Phones get the page bar with a back link to the feed.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/home')
    expect(screen.getByRole('link', { name: 'Back' }).parentElement).toHaveClass('md:hidden')
  })

  it('never reports zero when the signed-in member can see a matching post', async () => {
    mocks.getHashtagSummary.mockResolvedValue({ tag: 'sire', postCount: 0, followerCount: 0 })
    mocks.getFeedPage.mockResolvedValue({ posts: [{ id: 'group-post-1' }], nextCursor: null })

    render(await HashtagPage({ params: Promise.resolve({ tag: 'sire' }) }))

    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('1 post')
    expect(screen.getByTestId('feed-list')).toHaveAttribute('data-count', '1')
  })

  it('shows Following when the member already follows the tag', async () => {
    mocks.isFollowingHashtag.mockResolvedValue(true)
    render(await HashtagPage({ params: Promise.resolve({ tag: 'sire' }) }))
    expect(screen.getByRole('button', { name: 'Following #sire' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders an empty state for a tag nobody has used yet', async () => {
    mocks.getHashtagSummary.mockResolvedValue(null)
    mocks.getFeedPage.mockResolvedValue({ posts: [], nextCursor: null })
    render(await HashtagPage({ params: Promise.resolve({ tag: 'brandnew' }) }))

    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('0 posts')
    expect(screen.getByText('No posts with #brandnew yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('feed-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('hashtag-follower-count')).toHaveTextContent('0 followers')
  })

  it('returns 404 for an invalid tag before touching the session or the database', async () => {
    await expect(HashtagPage({ params: Promise.resolve({ tag: 'not a tag' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalled()
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.getFeedPage).not.toHaveBeenCalled()
  })

  it('titles the document with the tag', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ tag: 'Sire' }) })).resolves.toEqual({ title: '#sire' })
    await expect(generateMetadata({ params: Promise.resolve({ tag: 'bad tag' }) })).resolves.toEqual({ title: 'Hashtag' })
  })
})
