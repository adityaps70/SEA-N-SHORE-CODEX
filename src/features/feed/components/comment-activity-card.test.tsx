import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommentActivity } from '../queries'
import { CommentActivityCard } from './comment-activity-card'

vi.mock('./post-card', () => ({
  PostCard: ({ post }: { post: { body: string } }) => <article data-testid="post-card">{post.body}</article>,
}))

const activity: CommentActivity = {
  post: {
    id: '11111111-1111-4111-8111-111111111111',
    category: 'career_advice',
    body: 'Original maritime post',
    postType: 'standard',
    createdAt: '2026-09-09T08:00:00.000Z',
    updatedAt: '2026-09-09T08:00:00.000Z',
    author: {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'captain-author',
      fullName: 'Captain Author',
      avatarPath: null,
      headline: null,
      rank: 'Master',
      currentCompany: null,
    },
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 1,
    viewerLiked: false,
    viewerSaved: false,
    comments: [],
  },
  viewerComments: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      body: 'My contribution to this discussion',
      createdAt: '2026-09-09T09:00:00.000Z',
      author: {
        id: '44444444-4444-4444-8444-444444444444',
        slug: 'viewer',
        fullName: 'Viewer',
        avatarPath: null,
        headline: null,
        rank: null,
        currentCompany: null,
      },
    },
  ],
}

describe('CommentActivityCard', () => {
  it('surfaces the member comment before the commented post', () => {
    render(<CommentActivityCard activity={activity} />)

    const comment = screen.getByText('My contribution to this discussion')
    const post = screen.getByTestId('post-card')
    expect(comment.compareDocumentPosition(post) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Your comment')).toBeInTheDocument()
  })
})
