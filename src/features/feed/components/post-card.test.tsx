import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('../actions', () => ({
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  deletePost: vi.fn(async () => ({ ok: true })),
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
  it('renders one compact icon-only post actions row with inline reaction and comment counts', () => {
    render(<PostCard post={post} />)
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Member A' })).toHaveAttribute('href', '/people/member-a')

    const actions = screen.getByRole('group', { name: 'Post actions' })
    const primaryReactionControl = within(actions).getByRole('button', { name: /^Like$/i })
    expect(primaryReactionControl.querySelector('svg.lucide-thumbs-up')).toBeInTheDocument()

    const reactionCount = within(actions).getByRole('button', { name: 'View 4 reactions' })
    expect(reactionCount).toHaveTextContent('4')
    expect(reactionCount).not.toHaveTextContent(/reaction/i)

    const commentButton = within(actions).getByRole('button', { name: /^Comment$/i })
    expect(commentButton).toHaveTextContent('2')
    expect(commentButton).not.toHaveTextContent('Comment')

    const shareButton = within(actions).getByRole('button', { name: /^Share$/i })
    expect(shareButton).not.toHaveTextContent('Share')

    const saveButton = within(actions).getByRole('button', { name: /^Save$/i })
    expect(saveButton).not.toHaveTextContent('Save')

    expect(screen.queryByText('4 reactions')).not.toBeInTheDocument()
    expect(screen.queryByText('2 comments')).not.toBeInTheDocument()

    fireEvent.click(reactionCount)
    expect(screen.getByRole('dialog', { name: /reactions/i })).toBeInTheDocument()

    expect(screen.getByText((_, element) => element?.tagName === 'TIME')).toHaveAttribute('datetime', post.createdAt)
    expect(screen.queryByText(/Verified/i)).not.toBeInTheDocument()
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
})
