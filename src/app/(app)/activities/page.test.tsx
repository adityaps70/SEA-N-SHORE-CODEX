import { cleanup, render, screen, within } from '@testing-library/react'
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
  getMyHiddenPosts: vi.fn(),
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
  getMyHiddenPosts: mocks.getMyHiddenPosts,
}))
vi.mock('@/features/feed/components/hidden-post-card', () => ({
  HiddenPostCard: ({ post }: { post: { id: string } }) => <div data-testid="hidden-post">{post.id}</div>,
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
  PremiumPageHero: ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => <section className={className}><h1>{title}</h1>{children}</section>,
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
  mocks.getMyHiddenPosts.mockResolvedValue([])
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

  it('uses one consistent tab bar: same treatment for every tab, no icons, single-line labels, scrollable on phones', async () => {
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'events' }) }))

    const nav = screen.getByRole('navigation', { name: 'Activity sections' })
    const tabs = within(nav).getAllByRole('link')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Posts', 'Comments', 'Jobs Applied', 'Events', 'Learning', 'Hidden Posts', 'Recently Deleted'])
    for (const tab of tabs) {
      expect(tab.querySelector('svg')).toBeNull()
      expect(tab).toHaveClass('whitespace-nowrap', 'border-b-2', 'cursor-pointer')
    }
    expect(within(nav).getByRole('list')).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('heading', { name: 'My Events' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page')
    expect(tabs.filter((tab) => tab.getAttribute('aria-current') === 'page')).toHaveLength(1)
    // Phones: the same links as chips, selected = navy-950 filled.
    expect(within(nav).getByRole('link', { name: 'Events' })).toHaveClass('max-md:rounded-full', 'max-md:bg-navy-950', 'max-md:text-white')
    expect(within(nav).getByRole('link', { name: 'Posts' })).toHaveClass('max-md:rounded-full', 'max-md:border-mist-300')
  })

  it('gives phones a page bar back to Settings and hides the intro card there', async () => {
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'posts' }) }))

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('heading', { name: 'My Activities' }).closest('section')).toHaveClass('max-md:hidden')
    expect(screen.getAllByText('Profile card').every((card) => card.closest('.hidden, .max-md\\:hidden'))).toBe(true)
  })

  it('shows matching empty states with a next step for the events tab', async () => {
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'events' }) }))

    expect(screen.getByText('You are not attending an upcoming event yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Discover events' })).toHaveAttribute('href', '/events')
    expect(screen.getByText('You have not hosted an event yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open My Events/ })).toHaveAttribute('href', '/events/my')
    expect(mocks.listMyEvents).toHaveBeenCalledTimes(1)
    expect(mocks.listHostedEvents).toHaveBeenCalledTimes(1)
  })

  it('shows a clear empty state when there are no recoverable self-deleted posts', async () => {
    mocks.getMyRecentlyDeletedPosts.mockResolvedValueOnce([])

    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'deleted' }) }))

    expect(screen.getByText('No recently deleted posts.')).toBeInTheDocument()
    expect(screen.getByText(/30 days/i)).toBeInTheDocument()
  })
})

describe('/activities hidden posts', () => {
  it('adds a Hidden Posts tab that loads only the viewer’s hidden posts', async () => {
    mocks.getMyHiddenPosts.mockResolvedValueOnce([{ id: 'hidden-1' }, { id: 'hidden-2' }])

    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'hidden' }) }))

    const nav = screen.getByRole('navigation', { name: 'Activity sections' })
    expect(within(nav).getByRole('link', { name: 'Hidden Posts' })).toHaveAttribute('href', '/activities?tab=hidden')
    expect(within(nav).getByRole('link', { name: 'Hidden Posts' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Hidden Posts' })).toBeInTheDocument()
    expect(screen.getAllByTestId('hidden-post').map((item) => item.textContent)).toEqual(['hidden-1', 'hidden-2'])
    expect(mocks.getMyHiddenPosts).toHaveBeenCalledTimes(1)
    expect(mocks.getMyRecentlyDeletedPosts).not.toHaveBeenCalled()
    expect(mocks.getMyActivityPosts).not.toHaveBeenCalled()
  })

  it('explains the empty state and does not load hidden posts on other tabs', async () => {
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'hidden' }) }))
    expect(screen.getByText('You have not hidden any posts.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to home feed' })).toHaveAttribute('href', '/home')

    cleanup()
    mocks.getMyHiddenPosts.mockClear()
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'posts' }) }))
    expect(mocks.getMyHiddenPosts).not.toHaveBeenCalled()
  })
})
