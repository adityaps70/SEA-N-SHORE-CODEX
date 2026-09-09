import { cleanup, render, screen, within } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ActivitiesPage from '@/app/(app)/activities/page'
import { AppHeader } from '@/components/navigation/app-header'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}))

vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))

vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))

vi.mock('@/features/feed/queries', () => ({
  getMyActivityPosts: vi.fn().mockResolvedValue([]),
  getMyCommentActivity: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/jobs/queries', () => ({
  getMyJobApplications: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/jobs/components/job-application-list', () => ({
  JobApplicationList: () => <div data-testid="job-applications">Job applications</div>,
}))

afterEach(() => cleanup())

describe('My Activities and jobs integration contract', () => {
  it('stacks each signed-in primary navigation icon above its label', () => {
    render(<AppHeader recentNotifications={[]} unreadCount={0} />)

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    const links = within(primary).getAllByRole('link')
    expect(links).toHaveLength(7)

    for (const link of links) {
      expect(link).toHaveClass('flex-col')
      expect(link.querySelector('svg')).not.toBeNull()
      expect(link.lastElementChild?.textContent?.trim()).toBe(link.getAttribute('aria-label'))
    }
  })

  it('places Jobs Applied beside My Posts and My Comments as the third activity tab', async () => {
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'jobs' }) }))

    const tabs = screen.getByRole('navigation', { name: 'Activity sections' })
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
      'My Posts',
      'My Comments',
      'Jobs Applied',
    ])
    expect(within(tabs).getByRole('link', { name: 'Jobs Applied' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('job-applications')).toBeInTheDocument()
  })

  it('does not show the jobs application list while a post activity tab is selected', async () => {
    render(await ActivitiesPage({ searchParams: Promise.resolve({ tab: 'posts' }) }))

    expect(screen.queryByTestId('job-applications')).not.toBeInTheDocument()
  })

  it('keeps the additive jobs and activities migration intact', () => {
    const path = 'infra/aws/database/migrations/0007_jobs_activities.sql'
    expect(existsSync(path)).toBe(true)
    if (!existsSync(path)) return

    const sql = readFileSync(path, 'utf8')
    expect(sql).toContain('create table if not exists public.jobs')
    expect(sql).toContain('create table if not exists public.job_applications')
  })
})
