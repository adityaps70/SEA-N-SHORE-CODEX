import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOwnProfile: vi.fn(),
  getOwnProfilePortfolio: vi.fn(),
  getPeopleYouMayKnow: vi.fn(),
  getPublishedJobs: vi.fn(),
  getMyJobApplications: vi.fn(),
  getMyActivityPosts: vi.fn(),
  getMyCommentActivity: vi.fn(),
  getMyRecentlyDeletedPosts: vi.fn(),
  requireAwsUser: vi.fn(),
  listMyEvents: vi.fn(),
  listHostedEvents: vi.fn(),
  listLearnerEnrollments: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`) }),
}))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/events/calendar-repository', () => ({
  calendarEventRepository: {
    listMyEvents: mocks.listMyEvents,
    listHostedEvents: mocks.listHostedEvents,
  },
}))
vi.mock('@/features/learning/enrollment-repository', () => ({
  enrollmentRepository: {
    listLearnerEnrollments: mocks.listLearnerEnrollments,
  },
}))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: mocks.getOwnProfile }))
vi.mock('@/features/profiles/profile-portfolio-queries', () => ({ getOwnProfilePortfolio: mocks.getOwnProfilePortfolio }))
vi.mock('@/features/network/queries', () => ({ getPeopleYouMayKnow: mocks.getPeopleYouMayKnow }))
vi.mock('@/features/jobs/queries', () => ({
  getPublishedJobs: mocks.getPublishedJobs,
  getMyJobApplications: mocks.getMyJobApplications,
}))
vi.mock('@/features/feed/queries', () => ({
  getMyActivityPosts: mocks.getMyActivityPosts,
  getMyCommentActivity: mocks.getMyCommentActivity,
  getMyRecentlyDeletedPosts: mocks.getMyRecentlyDeletedPosts,
}))
vi.mock('@/features/feed/components/feed-profile-card', () => ({ FeedProfileCard: () => <div>Profile card</div> }))
vi.mock('@/features/network/components/people-you-may-know', () => ({ PeopleYouMayKnow: () => <div>People</div> }))
vi.mock('@/features/jobs/components/job-application-list', () => ({ JobApplicationList: () => <div>Applications</div> }))
vi.mock('@/features/feed/components/post-card', () => ({ PostCard: () => <div>Post</div> }))
vi.mock('@/features/feed/components/comment-activity-card', () => ({ CommentActivityCard: () => <div>Comment</div> }))
vi.mock('@/features/feed/components/recently-deleted-post-card', () => ({
  RecentlyDeletedPostCard: ({ post }: { post: { id: string; body: string } }) => <div data-testid="deleted-post">{post.id}:{post.body}</div>,
}))
vi.mock('@/components/product/premium-page-hero', () => ({
  PremiumPageHero: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h1>{title}</h1>{children}</section>,
}))
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import ActivitiesPage from './page'

const deletedPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'technical_discussion' as const,
  body: 'Deleted bridge lesson.',
  deletedAt: '2026-09-23T10:00:00.000Z',
  purgeAfter: '2026-10-23T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
  mocks.listMyEvents.mockResolvedValue([])
  mocks.listHostedEvents.mockResolvedValue([])
  mocks.listLearnerEnrollments.mockResolvedValue([])
  mocks.getOwnProfile.mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Member',
    slug: 'member',
  })
  mocks.getOwnProfilePortfolio.mockResolvedValue({ experiences: [], credentials: [] })
  mocks.getPeopleYouMayKnow.mockResolvedValue([])
  mocks.getPublishedJobs.mockResolvedValue([])
  mocks.getMyJobApplications.mockResolvedValue([])
  mocks.getMyActivityPosts.mockResolvedValue([])
  mocks.getMyCommentActivity.mockResolvedValue([])
  mocks.getMyRecentlyDeletedPosts.mockResolvedValue([deletedPost])
})

afterEach(() => cleanup())

describe('/activities recently deleted', () => {
  it('adds a Recently Deleted section under My Activities and loads only that data for the tab', async () => {
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'deleted' }) }))

    expect(screen.getByRole('link', { name: 'Recently Deleted' })).toHaveAttribute('href', '/activities?tab=deleted')
    expect(screen.getByRole('link', { name: 'Recently Deleted' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Recently Deleted' })).toBeInTheDocument()
    expect(screen.getByTestId('deleted-post')).toHaveTextContent(deletedPost.id)
    expect(mocks.getMyRecentlyDeletedPosts).toHaveBeenCalledTimes(1)
    expect(mocks.getMyActivityPosts).not.toHaveBeenCalled()
    expect(mocks.getMyCommentActivity).not.toHaveBeenCalled()
    expect(mocks.getMyJobApplications).not.toHaveBeenCalled()
  })

  it('shows a clear empty state when there are no recoverable self-deleted posts', async () => {
    mocks.getMyRecentlyDeletedPosts.mockResolvedValueOnce([])

    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'deleted' }) }))

    expect(screen.getByText('No recently deleted posts.')).toBeInTheDocument()
    expect(screen.getByText(/30 days/i)).toBeInTheDocument()
  })
})
