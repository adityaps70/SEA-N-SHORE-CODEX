import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/home',
}))

vi.mock('../actions', () => ({
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  deletePost: vi.fn(async () => ({ ok: true })),
  repostPost: vi.fn(async () => ({ ok: true, postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostLiked: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

const post: FeedPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'achievement',
  body: 'Completed my advanced tanker training today.',
  postType: 'standard',
  createdAt: '2026-09-02T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
  author: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'member-a',
    fullName: 'Member A',
    avatarPath: null,
    headline: 'Chief Officer | Tankers',
    rank: 'Chief Officer',
    currentCompany: 'Example Shipping',
  },
  media: null,
  poll: null,
  likeCount: 4,
  commentCount: 2,
  viewerLiked: false,
  viewerSaved: false,
  comments: [],
}

afterEach(() => cleanup())

describe('PostCard', () => {
  it('renders one action row: [Like 4] [Comment 2] [Repost] [Send] with the reaction types at the far right', () => {
    render(<PostCard post={post} />)
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Member A' })).toHaveAttribute('href', '/people/member-a')

    const actions = screen.getByRole('group', { name: 'Post actions' })
    const likeButton = within(actions).getByRole('button', { name: /^Like$/i })
    expect(likeButton.querySelector('svg.lucide-thumbs-up')).toBeInTheDocument()
    // The total reaction count sits inside the Like button, after the label.
    expect(likeButton).toHaveTextContent(/^Like4$/)

    const commentButton = within(actions).getByRole('button', { name: /^Comment$/i })
    expect(commentButton).toHaveTextContent(/^Comment2$/)
    const repostButton = within(actions).getByRole('button', { name: /^Repost$/i })
    expect(repostButton).toHaveTextContent('Repost')
    const sendButton = within(actions).getByRole('button', { name: /^Send$/i })
    expect(sendButton).toHaveTextContent('Send')

    // Far right of the same row: the reaction types only (no number); it opens the reactor list.
    const reactionTypes = within(actions).getByRole('button', { name: 'View 4 reactions' })
    expect(reactionTypes).toHaveTextContent(/^👍$/)
    expect(within(actions).getByTestId('post-primary-actions')).not.toContainElement(reactionTypes)

    // No separate summary line above the row any more.
    expect(screen.queryByTestId('post-social-counts')).not.toBeInTheDocument()

    // Save and Report stay in the post header "⋯" menu.
    expect(within(actions).queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument()
    expect(within(actions).queryByRole('button', { name: /report/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post options' })).toBeInTheDocument()

    const order = [likeButton, commentButton, repostButton, sendButton, reactionTypes]
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }

    fireEvent.click(reactionTypes)
    expect(screen.getByRole('dialog', { name: /reactions/i })).toBeInTheDocument()

    expect(screen.getByText((_, element) => element?.tagName === 'TIME')).toHaveAttribute('datetime', post.createdAt)
    expect(screen.queryByText(/Verified/i)).not.toBeInTheDocument()
  })

  it('shows every reaction type present, stacked, and hides the types control when nobody reacted', () => {
    const { rerender } = render(<PostCard post={{ ...post, reactionSummary: { like: 9, support: 2, respect: 0, on_point: 1 } }} />)
    const types = screen.getByRole('button', { name: 'View 12 reactions' })
    expect(types).toHaveTextContent(/^👍❤️⚓$/)
    expect(screen.getByRole('button', { name: /^Like$/i })).toHaveTextContent(/^Like12$/)

    rerender(<PostCard post={{ ...post, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', likeCount: 0, commentCount: 0, reactionSummary: { like: 0, support: 0, respect: 0, on_point: 0 } }} />)
    expect(screen.queryByRole('button', { name: /View \d+ reactions?/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Like$/i })).toHaveTextContent(/^Like$/)
    expect(screen.getByRole('button', { name: /^Comment$/i })).toHaveTextContent(/^Comment$/)
  })

  it('shows the chosen reaction and its label in the accent colour on the Like button', () => {
    render(<PostCard post={{ ...post, viewerReaction: 'support', reactionSummary: { like: 3, support: 1, respect: 0, on_point: 0 } }} />)
    const reacted = within(screen.getByRole('group', { name: 'Post actions' })).getByRole('button', { name: 'Support' })
    expect(reacted).toHaveTextContent(/^❤️Support4$/)
    expect(reacted).toHaveClass('text-ocean-700')
    expect(reacted).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses bordered, clickable action buttons whose labels hide on narrow rows but keep icons and counts', () => {
    render(<PostCard post={post} />)

    const actions = screen.getByRole('group', { name: 'Post actions' })
    expect(actions).toHaveClass('@container')
    expect(actions).toHaveClass('justify-between')
    const primaryActions = within(actions).getByTestId('post-primary-actions')
    const buttons = ['Like', 'Comment', 'Repost', 'Send'].map((name) => within(primaryActions).getByRole('button', { name }))
    for (const button of buttons) {
      expect(button).toHaveClass('border')
      expect(button).toHaveClass('cursor-pointer')
      expect(button.querySelector('svg')).toHaveClass('size-5')
    }
    expect(within(buttons[0]).getByText('Like')).toHaveClass('hidden', '@min-[34rem]:inline')
    expect(within(buttons[1]).getByText('Comment')).toHaveClass('hidden', '@min-[34rem]:inline')
    expect(within(buttons[1]).getByTestId('comment-count')).not.toHaveClass('hidden')
    expect(within(buttons[2]).getByText('Repost')).toHaveClass('hidden', '@min-[34rem]:inline')
    expect(within(buttons[3]).getByText('Send')).toHaveClass('hidden', '@min-[34rem]:inline')
  })

  it('wraps long unbroken links inside the post card instead of bleeding outside the card', () => {
    const longUrl = 'https://www.linkedin.com/posts/example_really-long-unbroken-link-with-tracking-parameters-and-a-token-that-would-normally-overflow-the-feed-card'
    render(<PostCard post={{ ...post, body: longUrl }} />)

    const body = screen.getByText(longUrl).closest('p')
    expect(body).toHaveClass('break-words')
    expect(body).toHaveClass('[overflow-wrap:anywhere]')
  })

  it('wraps long links inside nested repost source cards too', () => {
    const longUrl = 'https://www.linkedin.com/posts/example_original-post-with-an-extremely-long-unbroken-url-and-tracking-token'
    render(<PostCard post={{
      ...post,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      body: '',
      postType: 'repost',
      repostOf: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        category: 'technical_discussion',
        body: longUrl,
        postType: 'standard',
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
        author: post.author,
        media: null,
        poll: null,
        mentions: [],
      },
      likeCount: 0,
      commentCount: 0,
    }} />)

    const body = screen.getByText(longUrl).closest('p')
    expect(body).toHaveClass('break-words')
    expect(body).toHaveClass('[overflow-wrap:anywhere]')
  })

  it('shows portrait image media in full instead of forcing a 16:9 cover crop', () => {
    const { container } = render(<PostCard post={{
      ...post,
      media: {
        storagePath: 'member/post/portrait.jpg',
        mimeType: 'image/jpeg',
        altText: 'Portrait safety poster',
        signedUrl: 'https://media.example/portrait.jpg',
      },
    }} />)

    const image = screen.getByRole('img', { name: 'Portrait safety poster' })
    expect(image).toHaveClass('object-contain')
    expect(image).toHaveClass('h-auto')
    expect(container.innerHTML).not.toContain('aspect-[16/9]')
  })

  it('shows video media as a controls-enabled inline player', () => {
    const { container } = render(<PostCard post={{
      ...post,
      media: {
        storagePath: 'member/post/drill.mp4',
        mimeType: 'video/mp4',
        altText: 'Emergency drill video',
        signedUrl: 'https://media.example/drill.mp4',
      },
    }} />)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('src', 'https://media.example/drill.mp4')
  })

  it('renders a repost actor with the canonical original post nested inside', () => {
    const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    render(<PostCard post={{
      ...post,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      body: '',
      postType: 'repost',
      author: {
        ...post.author,
        id: '22222222-2222-4222-8222-222222222222',
        slug: 'member-b',
        fullName: 'Member B',
      },
      repostOf: {
        id: sourceId,
        category: 'safety_lessons',
        body: 'Original enclosed-space safety lesson.',
        postType: 'standard',
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
        author: post.author,
        media: {
          storagePath: 'member-a/posts/source.jpg',
          mimeType: 'image/jpeg',
          altText: 'Original safety diagram',
          signedUrl: 'https://media.example/source.jpg',
        },
        poll: null,
        mentions: [],
      },
      likeCount: 0,
      commentCount: 0,
    }} />)

    expect(screen.getByRole('link', { name: 'Member B' })).toHaveAttribute('href', '/people/member-b')
    expect(screen.getByText('reposted')).toBeInTheDocument()
    const original = screen.getByRole('region', { name: 'Original post by Member A' })
    expect(within(original).getByRole('link', { name: 'Member A' })).toHaveAttribute('href', '/people/member-a')
    expect(within(original).getByText('Original enclosed-space safety lesson.')).toBeInTheDocument()
    expect(within(original).getByRole('img', { name: 'Original safety diagram' })).toHaveAttribute('src', 'https://media.example/source.jpg')
    expect(within(original).getByRole('link', { name: /View original post/i })).toHaveAttribute('href', `/posts/${sourceId}`)
  })

  it('reconciles local reaction and save state when canonical post props refresh', () => {
    const { rerender } = render(<PostCard post={post} />)

    rerender(<PostCard post={{
      ...post,
      viewerReaction: 'support',
      reactionSummary: { like: 4, support: 2, respect: 0, on_point: 0 },
      viewerSaved: true,
    }} />)

    const actions = screen.getByRole('group', { name: 'Post actions' })
    expect(within(actions).getByRole('button', { name: /^Support$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(within(actions).getByRole('button', { name: /^Support$/i })).toHaveTextContent('6')
    expect(screen.getByRole('button', { name: 'View 6 reactions' })).toHaveTextContent(/^👍❤️$/)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    expect(screen.getByRole('menuitem', { name: 'Remove from saved' })).toBeInTheDocument()
  })
})
