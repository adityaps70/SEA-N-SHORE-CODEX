import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'
import { SharePostButton } from './share-post-button'

type Recipient = { id: string; slug: string; fullName: string; avatarUrl: string | null; detail: string }

const mocks = vi.hoisted(() => ({
  repostPost: vi.fn<(postId: string, input?: unknown) => Promise<{ ok: true; postId: string } | { ok: false; error: string }>>(async () => ({ ok: true, postId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })),
  searchShareRecipients: vi.fn<(query: string) => Promise<
    | { ok: true; totalConnections: number; recipients: Recipient[] }
    | { ok: false; error: string }>>(async () => ({ ok: true, totalConnections: 2, recipients: [] })),
  sendPostToConnection: vi.fn<(input: unknown) => Promise<
    | { ok: true; conversationId: string }
    | { ok: false; error: string }>>(async () => ({ ok: true, conversationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })),
  searchMentionCandidates: vi.fn(async () => []),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/home',
}))

vi.mock('../actions', () => ({
  repostPost: mocks.repostPost,
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setPostHidden: vi.fn(async () => ({ ok: true })),
  deletePost: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../share-actions', () => ({
  searchShareRecipients: mocks.searchShareRecipients,
  sendPostToConnection: mocks.sendPostToConnection,
}))

vi.mock('../mention-actions', () => ({
  searchMentionCandidates: mocks.searchMentionCandidates,
}))

vi.mock('@/features/network/actions', () => ({
  followProfile: vi.fn(async () => ({ ok: true })),
  unfollowProfile: vi.fn(async () => ({ ok: true })),
}))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const captain: Recipient = { id: '33333333-3333-4333-8333-333333333333', slug: 'captain-rao', fullName: 'Captain Rao', avatarUrl: null, detail: 'Master · Blue Fleet' }
const officer: Recipient = { id: '44444444-4444-4444-8444-444444444444', slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: null, detail: 'Second Officer' }

const author = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  fullName: 'Member A',
  avatarPath: null,
  headline: 'Chief Officer',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
}

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: postId,
    category: 'safety_lessons',
    body: 'Bridge resource management lessons from our last port call.',
    postType: 'standard',
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    author,
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    viewerOwns: false,
    comments: [],
    ...overrides,
  }
}

function openShareMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  return screen.getByRole('menu', { name: 'Share post' })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.searchShareRecipients.mockResolvedValue({ ok: true, totalConnections: 2, recipients: [] })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
})

describe('share menu', () => {
  it('offers repost, repost with thoughts, send, external share and copy link', () => {
    render(<PostCard post={post()} />)
    const labels = within(openShareMenu()).getAllByRole('menuitem').map((item) => item.textContent?.trim())
    expect(labels).toEqual(['Repost to feed', 'Repost with your thoughts', 'Send in a message', 'Share outside Sea N Shore', 'Copy link'])
  })

  it('reposts instantly to the feed and confirms with a link to the repost', async () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Repost to feed' }))
    await waitFor(() => expect(mocks.repostPost).toHaveBeenCalledWith(postId))
    expect(await screen.findByRole('status')).toHaveTextContent('Reposted to your feed.')
    expect(screen.getByRole('link', { name: 'View repost' })).toHaveAttribute('href', '/posts/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
  })

  it('shows why a repost failed', async () => {
    mocks.repostPost.mockResolvedValueOnce({ ok: false, error: 'You already reposted this post.' })
    render(<PostCard post={post()} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Repost to feed' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You already reposted this post.')
  })

  it('reposts with commentary, requiring some text first', async () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Repost with your thoughts' }))
    const dialog = screen.getByRole('dialog', { name: 'Repost with your thoughts' })
    expect(within(dialog).getByRole('region', { name: 'Original post by Member A' })).toHaveTextContent('Bridge resource management')
    expect(within(dialog).getByRole('textbox', { name: 'Your thoughts' })).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Repost' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/add your thoughts/i)
    expect(mocks.repostPost).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your thoughts' }), { target: { value: 'Every cadet should read this.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add emoji to your thoughts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert ⚓' }))
    expect(within(dialog).getByRole('textbox', { name: 'Your thoughts' })).toHaveValue('Every cadet should read this. ⚓')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Repost' }))

    await waitFor(() => expect(mocks.repostPost).toHaveBeenCalledWith(postId, { body: 'Every cadet should read this. ⚓', mentionProfileIds: [] }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Repost with your thoughts' })).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Reposted to your feed with your thoughts.')
  })

  it('keeps the commentary dialog open with the server error', async () => {
    mocks.repostPost.mockResolvedValueOnce({ ok: false, error: 'Your post includes language that breaks our community safety rules.' })
    render(<PostCard post={post()} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Repost with your thoughts' }))
    const dialog = screen.getByRole('dialog', { name: 'Repost with your thoughts' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your thoughts' }), { target: { value: 'Rude words' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Repost' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/community safety rules/i)
    expect(within(dialog).getByRole('textbox', { name: 'Your thoughts' })).toHaveValue('Rude words')
  })

  it('reposts the original post when sharing someone else’s repost', async () => {
    render(<PostCard post={post({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      postType: 'repost',
      body: '',
      repostOf: {
        id: sourceId,
        category: 'safety_lessons',
        body: 'Original lesson.',
        postType: 'standard',
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
        author: { ...author, id: '22222222-2222-4222-8222-222222222222', slug: 'member-b', fullName: 'Member B' },
        media: null,
        poll: null,
        mentions: [],
      },
    })} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Repost to feed' }))
    await waitFor(() => expect(mocks.repostPost).toHaveBeenCalledWith(sourceId))
  })

  it('shows repost commentary above the original post', () => {
    render(<PostCard post={post({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      postType: 'repost',
      body: 'Worth a read before your next rotation.',
      repostOf: {
        id: sourceId,
        category: 'safety_lessons',
        body: 'Original lesson.',
        postType: 'standard',
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
        author: { ...author, id: '22222222-2222-4222-8222-222222222222', slug: 'member-b', fullName: 'Member B' },
        media: null,
        poll: null,
        mentions: [],
      },
    })} />)
    const commentary = screen.getByText('Worth a read before your next rotation.')
    const original = screen.getByRole('region', { name: 'Original post by Member B' })
    expect(commentary.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('reposted with thoughts')).toBeInTheDocument()
  })

  it('uses the device share sheet when the browser supports it', async () => {
    const share = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    render(<PostCard post={post()} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Share outside Sea N Shore' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}/posts/${postId}` })))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falls back to share links when the device share sheet is unavailable', () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Share outside Sea N Shore' }))
    const dialog = screen.getByRole('dialog', { name: 'Share outside Sea N Shore' })
    const encoded = encodeURIComponent(`${window.location.origin}/posts/${postId}`)
    expect(within(dialog).getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', expect.stringContaining(encoded))
    expect(within(dialog).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('target', '_blank')
    expect(within(dialog).getByRole('link', { name: /Email/ }).getAttribute('href')).toMatch(/^mailto:/)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Share outside Sea N Shore' })).not.toBeInTheDocument()
  })

  it('copies the link with a visible confirmation when used outside a post card', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<SharePostButton postId={postId} allowRepost={false} allowSend={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/posts/${postId}`))
    expect(await screen.findByRole('status')).toHaveTextContent(/link copied/i)
  })
})

describe('send to a connection', () => {
  it('searches connections, sends the post with a note and links to the conversation', async () => {
    mocks.searchShareRecipients.mockResolvedValue({ ok: true, totalConnections: 2, recipients: [captain, officer] })
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const dialog = screen.getByRole('dialog', { name: 'Send in a message' })
    expect(within(dialog).getByRole('searchbox', { name: 'Search your connections' })).toHaveFocus()
    await waitFor(() => expect(mocks.searchShareRecipients).toHaveBeenCalledWith(''))
    expect(await within(dialog).findByRole('radio', { name: /Captain Rao/ })).toBeInTheDocument()

    const send = within(dialog).getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()

    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'rao' } })
    await waitFor(() => expect(mocks.searchShareRecipients).toHaveBeenLastCalledWith('rao'))

    fireEvent.click(await within(dialog).findByRole('radio', { name: /Captain Rao/ }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: /add a note/i }), { target: { value: 'See point 3 about pilot handover.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to Captain' }))

    await waitFor(() => expect(mocks.sendPostToConnection).toHaveBeenCalledWith({
      postId,
      recipientProfileId: captain.id,
      note: 'See point 3 about pilot handover.',
    }))
    const sent = await screen.findByRole('dialog', { name: 'Post sent' })
    expect(within(sent).getByRole('status')).toHaveTextContent('sent to Captain Rao')
    expect(within(sent).getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/messages/ffffffff-ffff-4fff-8fff-ffffffffffff')
    fireEvent.click(within(sent).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Sent to Captain Rao.')
  })

  it('keeps the dialog open and explains a messaging refusal', async () => {
    mocks.searchShareRecipients.mockResolvedValue({ ok: true, totalConnections: 1, recipients: [captain] })
    mocks.sendPostToConnection.mockResolvedValueOnce({ ok: false, error: 'You can message accepted connections only.' })
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const dialog = screen.getByRole('dialog', { name: 'Send in a message' })
    fireEvent.click(await within(dialog).findByRole('radio', { name: /Captain Rao/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to Captain' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You can message accepted connections only.')
  })

  it('explains how to get connections when the member has none', async () => {
    mocks.searchShareRecipients.mockResolvedValue({ ok: true, totalConnections: 0, recipients: [] })
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const dialog = screen.getByRole('dialog', { name: 'Send in a message' })
    expect(await within(dialog).findByText(/don.t have any connections yet/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Find people to connect with' })).toHaveAttribute('href', '/network')
  })

  it('shows a load failure for the connection list', async () => {
    mocks.searchShareRecipients.mockResolvedValue({ ok: false, error: 'We could not load your connections. Check your internet connection and try again.' })
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your connections.')
  })

  it('lets the member retry after the connection list fails to load', async () => {
    mocks.searchShareRecipients.mockResolvedValueOnce({ ok: false, error: 'We could not load your connections. Check your internet connection and try again.' })
    mocks.searchShareRecipients.mockResolvedValueOnce({
      ok: true,
      totalConnections: 1,
      recipients: [{ id: 'r1', slug: 'nisha', fullName: 'Nisha Menon', avatarUrl: null, detail: 'Marine Superintendent' }],
    })
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send in a message' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Try again' }))
    expect(await within(dialog).findByRole('radio', { name: /Nisha Menon/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is also reachable from the share menu', () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openShareMenu()).getByRole('menuitem', { name: 'Send in a message' }))
    expect(screen.getByRole('dialog', { name: 'Send in a message' })).toBeInTheDocument()
  })
})
