import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('../actions', () => ({
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
  it('renders a semantic post with real controls and counts', () => {
    render(<PostCard post={post} />)
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Member A' })).toHaveAttribute('href', '/people/member-a')
    expect(screen.getByText('4 reactions')).toBeInTheDocument()
    expect(screen.getByText('2 comments')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Like$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Comment$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Share$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument()
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
