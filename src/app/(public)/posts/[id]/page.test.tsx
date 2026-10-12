import { cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVerifiedUser } from '@/features/auth/queries'
import { getPostPage } from '@/features/feed/queries'
import PostPage, { generateMetadata } from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: vi.fn() }))
vi.mock('@/features/feed/queries', () => ({
  getPostPage: vi.fn(),
  isPostId: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
}))
vi.mock('@/features/feed/components/post-card', () => ({
  PostCard: ({ post, detail, flushOnPhones, signedOut, focusPhoto }: {
    post: { id: string; body: string }
    detail?: boolean
    flushOnPhones?: boolean
    signedOut?: boolean
    focusPhoto?: { mediaId: string; profileId: string } | null
  }) => (
    <article>
      Post {post.id}{detail ? ' detail' : ''}{flushOnPhones ? ' flush' : ''}{signedOut ? ' signed-out' : ''}
      {focusPhoto ? ` focus ${focusPhoto.mediaId}` : ''}
      <p>{post.body}</p>
    </article>
  ),
}))

const mockedViewer = vi.mocked(getVerifiedUser)
const mockedPage = vi.mocked(getPostPage)
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const mediaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const viewer = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }

function feedPost(overrides: Record<string, unknown> = {}) {
  return {
    id: postId,
    body: 'A public fixture update about mooring checks.',
    audience: 'anyone',
    author: { fullName: 'Fixture Author' },
    organization: null,
    group: null,
    media: null,
    mediaItems: [],
    ...overrides,
  } as never
}

function props(search: Record<string, string> = {}) {
  return { params: Promise.resolve({ id: postId }), searchParams: Promise.resolve(search) }
}

describe('Post page', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mockedViewer.mockResolvedValue(viewer as never)
    mockedPage.mockResolvedValue({ kind: 'member', post: feedPost() })
  })

  it('shows a member the phone page bar back to Home and the post edge to edge', async () => {
    render(await PostPage(props()))

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/home')
    expect(screen.getByText(`Post ${postId} detail flush`, { exact: false })).toBeInTheDocument()
    expect(mockedPage).toHaveBeenCalledWith(postId, viewer)
  })

  it('scrolls a member to the photo a tag notification points at', async () => {
    render(await PostPage(props({ photo: mediaId })))
    expect(screen.getByText(`focus ${mediaId}`, { exact: false })).toBeInTheDocument()
  })

  it('is not found for a missing or deleted post, and for an id that is not a post id', async () => {
    mockedPage.mockResolvedValueOnce({ kind: 'missing' })
    await expect(PostPage(props())).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(PostPage({ params: Promise.resolve({ id: 'not-a-uuid' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('shows a signed-out visitor an "Anyone" post read-only, with the join banner coming back here', async () => {
    mockedViewer.mockResolvedValue(null)
    mockedPage.mockResolvedValue({ kind: 'public', post: feedPost() })
    render(await PostPage(props()))

    expect(screen.getByRole('heading', { name: 'Join Sea N Shore to like, comment and connect' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', `/auth/sign-up?next=%2Fposts%2F${postId}`)
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/auth/sign-in?next=%2Fposts%2F${postId}`)
    expect(screen.getByText(`Post ${postId} detail signed-out`, { exact: false })).toBeInTheDocument()
    expect(mockedPage).toHaveBeenCalledWith(postId, null)
  })

  it('shows a signed-out visitor only a teaser for a members-only post, with nothing from the post in the HTML', async () => {
    mockedViewer.mockResolvedValue(null)
    mockedPage.mockResolvedValue({ kind: 'members_only' })
    const html = renderToStaticMarkup(await PostPage(props()))

    expect(html).toContain('This post is only visible to members')
    expect(html).toContain(`/auth/sign-in?next=%2Fposts%2F${postId}`)
    expect(html).not.toContain('mooring')
    expect(html).not.toContain('Fixture Author')
  })

  it('gives an "Anyone" post share tags with the author, its first words and the canonical address, never indexed', async () => {
    mockedViewer.mockResolvedValue(null)
    mockedPage.mockResolvedValue({ kind: 'public', post: feedPost({ mediaItems: [{ mimeType: 'image/jpeg', signedUrl: 'x' }] }) })
    const metadata = await generateMetadata(props())

    expect(metadata.title).toEqual({ absolute: 'Fixture Author on Sea N Shore' })
    expect(metadata.description).toBe('A public fixture update about mooring checks.')
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBe(`/posts/${postId}`)
    expect(metadata.openGraph).toMatchObject({
      title: 'Fixture Author on Sea N Shore',
      url: `/posts/${postId}`,
      images: [{ url: `/api/public/posts/${postId}/image` }],
    })
  })

  it('gives every other post generic share tags with nothing from the post', async () => {
    mockedViewer.mockResolvedValue(null)
    mockedPage.mockResolvedValue({ kind: 'members_only' })
    const metadata = await generateMetadata(props())
    expect(JSON.stringify(metadata)).not.toContain('Fixture Author')
    expect(metadata.title).toBe('Post')
    expect(metadata.robots).toEqual({ index: false, follow: false })

    mockedViewer.mockResolvedValue(viewer as never)
    mockedPage.mockResolvedValue({ kind: 'member', post: feedPost({ audience: 'members' }) })
    expect(JSON.stringify(await generateMetadata(props()))).not.toContain('mooring')
  })
})
