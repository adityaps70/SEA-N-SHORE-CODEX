import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Round 14 (3.9): no router.refresh() after a Server Action that already revalidates. In this
 * Next.js version any revalidatePath/revalidateTag inside a Server Action makes the action's
 * response carry the re-rendered current route, and the client applies it (refreshing dynamic
 * data); a router.refresh() afterwards only rendered the page a second time.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  followProfile: vi.fn(async () => ({ ok: true as const })),
  unfollowProfile: vi.fn(async () => ({ ok: true as const })),
  acceptConnectionRequest: vi.fn(async () => ({ ok: true as const })),
  declineConnectionRequest: vi.fn(async () => ({ ok: true as const })),
  attendEventAction: vi.fn(async () => ({ ok: true as const })),
  withdrawEventAttendanceAction: vi.fn(async () => ({ ok: true as const })),
  restoreDeletedPost: vi.fn(async () => ({ ok: true as const })),
  withdrawCourseFromReview: vi.fn(async () => ({ ok: true as const })),
  completeLearningLesson: vi.fn(async () => ({ ok: true as const, lessonId: 'lesson', completedLessons: 1, totalLessons: 2, progressPercent: 50, enrollmentCompleted: false })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push, replace: mocks.replace, prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/network',
}))
vi.mock('@/features/network/actions', () => ({
  followProfile: mocks.followProfile,
  unfollowProfile: mocks.unfollowProfile,
  acceptConnectionRequest: mocks.acceptConnectionRequest,
  declineConnectionRequest: mocks.declineConnectionRequest,
}))
vi.mock('@/features/events/calendar-actions', () => ({
  attendEventAction: mocks.attendEventAction,
  withdrawEventAttendanceAction: mocks.withdrawEventAttendanceAction,
}))
vi.mock('@/features/feed/actions', () => ({ restoreDeletedPost: mocks.restoreDeletedPost }))
vi.mock('@/features/learning/course-actions', () => ({ withdrawCourseFromReview: mocks.withdrawCourseFromReview }))
vi.mock('@/features/learning/learner-progress-actions', () => ({ completeLearningLesson: mocks.completeLearningLesson }))

import { AttendanceControl } from '@/features/events/components/attendance-control'
import { RecentlyDeletedPostCard } from '@/features/feed/components/recently-deleted-post-card'
import { CourseWithdrawControl } from '@/features/learning/components/course-withdraw-control'
import { ViewCompletionBeacon } from '@/features/learning/components/view-completion-beacon'
import { FollowToggleButton } from '@/features/network/components/follow-toggle-button'
import { NetworkInvitationRow } from '@/features/network/components/network-invitation-row'
import type { NetworkProfile } from '@/features/network/types'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

/** Each component that dropped its router.refresh(), with the Server Action module(s) it calls. */
const REMOVED: Array<[component: string, actions: string[]]> = [
  ['src/features/admin/components/admin-entitlement-control-panel.tsx', ['src/features/admin/membership-actions.ts']],
  ['src/features/admin/components/company-access-review-actions.tsx', ['src/features/admin/actions.ts']],
  ['src/features/auth/components/account-phone-panel.tsx', ['src/features/auth/phone-link-actions.ts']],
  ['src/features/billing/components/admin-billing-controls.tsx', ['src/features/billing/admin-actions.ts']],
  ['src/features/billing/components/cancel-auto-renew.tsx', ['src/features/billing/actions.ts']],
  ['src/features/billing/components/trial-start-button.tsx', ['src/features/billing/actions.ts']],
  ['src/features/community/components/community-media-controls.tsx', ['src/features/community/media-actions.ts']],
  ['src/features/community/components/edit-group-form.tsx', ['src/features/community/actions.ts']],
  ['src/features/community/components/group-membership-button.tsx', ['src/features/community/actions.ts']],
  ['src/features/community/components/join-requests-panel.tsx', ['src/features/community/actions.ts']],
  ['src/features/community/components/member-actions-menu.tsx', ['src/features/community/actions.ts']],
  ['src/features/events/components/attendance-control.tsx', ['src/features/events/calendar-actions.ts']],
  ['src/features/events/components/event-actions-menu.tsx', ['src/features/events/calendar-actions.ts']],
  ['src/features/events/components/event-form.tsx', ['src/features/events/calendar-actions.ts']],
  ['src/features/feed/components/post-composer.tsx', ['src/features/feed/actions.ts']],
  ['src/features/feed/components/recently-deleted-post-card.tsx', ['src/features/feed/actions.ts']],
  ['src/features/jobs/components/application-row-menu.tsx', ['src/features/jobs/actions.ts']],
  ['src/features/jobs/components/hiring-job-form.tsx', ['src/features/jobs/hiring-actions.ts']],
  ['src/features/jobs/components/hiring-job-lifecycle-actions.tsx', ['src/features/jobs/hiring-actions.ts']],
  ['src/features/jobs/components/hiring-status-action.tsx', ['src/features/jobs/hiring-actions.ts']],
  ['src/features/jobs/components/recruiter-note-form.tsx', ['src/features/jobs/hiring-actions.ts']],
  ['src/features/learning/components/assignment-activity.tsx', ['src/features/learning/learner-assignment-actions.ts']],
  ['src/features/learning/components/assignment-grading-control.tsx', ['src/features/learning/assignment-grading-actions.ts']],
  ['src/features/learning/components/course-action-bar.tsx', ['src/features/learning/enrollment-actions.ts']],
  ['src/features/learning/components/course-refund-button.tsx', ['src/features/learning/course-payment-actions.ts']],
  ['src/features/learning/components/course-submit-control.tsx', ['src/features/learning/course-actions.ts']],
  ['src/features/learning/components/course-withdraw-control.tsx', ['src/features/learning/course-actions.ts']],
  ['src/features/learning/components/lesson-completion-control.tsx', ['src/features/learning/learner-progress-actions.ts']],
  ['src/features/learning/components/mentor-curriculum-editor.tsx', ['src/features/learning/mentor-curriculum-actions.ts', 'src/features/learning/mentor-material-actions.ts', 'src/features/learning/scorm-authoring-actions.ts']],
  ['src/features/learning/components/quiz-lesson-activity.tsx', ['src/features/learning/learner-quiz-actions.ts']],
  ['src/features/learning/components/view-completion-beacon.tsx', ['src/features/learning/learner-progress-actions.ts']],
  ['src/features/messaging/components/message-thread.tsx', ['src/features/messaging/actions.ts']],
  ['src/features/network/components/connection-primary-action.tsx', ['src/features/network/actions.ts']],
  ['src/features/network/components/follow-toggle-button.tsx', ['src/features/network/actions.ts']],
  ['src/features/network/components/network-invitation-row.tsx', ['src/features/network/actions.ts']],
  ['src/features/network/components/person-card-actions.tsx', ['src/features/network/actions.ts']],
  ['src/features/network/components/relationship-controls.tsx', ['src/features/network/actions.ts']],
  ['src/features/notifications/components/notification-list.tsx', ['src/features/notifications/actions.ts']],
  ['src/features/organizations/components/organization-access-panel.tsx', ['src/features/organizations/access-request-actions.ts']],
  ['src/features/organizations/components/organization-application-form.tsx', ['src/features/organizations/actions.ts', 'src/features/organizations/unclaimed-organization-actions.ts']],
  ['src/features/organizations/components/organization-requests-panel.tsx', ['src/features/organizations/access-request-actions.ts']],
  ['src/features/organizations/components/request-access-form.tsx', ['src/features/organizations/actions.ts']],
  ['src/features/payouts/components/admin/fee-override-manager.tsx', ['src/features/payouts/admin-actions.ts']],
  ['src/features/payouts/components/admin/fee-settings-form.tsx', ['src/features/payouts/admin-actions.ts']],
  ['src/features/payouts/components/admin/payout-status-actions.tsx', ['src/features/payouts/admin-actions.ts']],
  ['src/features/payouts/components/payout-account-panel.tsx', ['src/features/payouts/actions.ts']],
  ['src/features/profiles/components/dg-profile-upload.tsx', ['src/features/profiles/profile-document-actions.ts']],
  ['src/features/profiles/components/maritime-profile-card.tsx', ['src/features/profiles/profile-inline-actions.ts']],
  ['src/features/profiles/components/profile-about.tsx', ['src/features/profiles/profile-inline-actions.ts']],
  ['src/features/profiles/components/profile-goals-editor.tsx', ['src/features/profiles/profile-inline-actions.ts']],
  ['src/features/profiles/components/profile-header.tsx', ['src/features/profiles/profile-inline-actions.ts']],
  ['src/features/profiles/components/profile-organizations.tsx', ['src/features/profiles/profile-inline-actions.ts']],
  ['src/features/roles/components/rank-selection-banner.tsx', ['src/features/profiles/profile-inline-actions.ts']],
]

describe('router.refresh() after revalidating Server Actions (static contract)', () => {
  it.each(REMOVED)('%s no longer refreshes the route after its action', (component, actions) => {
    expect(read(component)).not.toMatch(/router\.refresh\(\)/)
    for (const action of actions) {
      const source = read(action)
      expect(source.startsWith("'use server'")).toBe(true)
      expect(source).toMatch(/revalidatePath\(/)
    }
  })

  it('keeps router.refresh() where nothing revalidates the shown page', () => {
    // Route handlers (fetch) cannot refresh the client router.
    expect(read('src/features/admin/components/moderation-action-panel.tsx')).toMatch(/fetch\('\/api\/admin\/moderation'[\s\S]*router\.refresh\(\)/)
    expect(read('src/features/admin/components/deleted-post-recovery-panel.tsx')).toMatch(/fetch\(`\/api\/admin\/deleted-posts[\s\S]*router\.refresh\(\)/)
    // Realtime events, payment gateway outcomes and status checks.
    expect(read('src/features/realtime/provider.tsx')).toMatch(/router\.refresh\(\)/)
    expect(read('src/features/payments/components/event-checkout-button.tsx')).toMatch(/onSettled=\{\(\) => startTransition\(\(\) => router\.refresh\(\)\)\}/)
    // The profile photo actions deliberately leave /profile unrevalidated so the action state survives.
    expect(read('src/features/profiles/profile-media-actions.ts')).not.toMatch(/revalidatePath\('\/profile'\)/)
    expect(read('src/features/profiles/components/profile-media-controls.tsx')).toMatch(/router\.refresh\(\)/)
  })
})

describe('components rely on the action revalidation (behaviour)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('FollowToggleButton follows without a route refresh', async () => {
    render(<FollowToggleButton profileId="11111111-1111-4111-8111-111111111111" following={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }))
    await waitFor(() => expect(mocks.followProfile).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111'))
    expect(await screen.findByRole('button', { name: 'Following' })).toBeEnabled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('FollowToggleButton still rolls back on failure', async () => {
    mocks.unfollowProfile.mockResolvedValueOnce({ ok: false, error: 'We could not update this relationship. Please try again.' } as never)
    render(<FollowToggleButton profileId="11111111-1111-4111-8111-111111111111" following />)
    fireEvent.click(screen.getByRole('button', { name: 'Following' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not update this relationship.')
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('NetworkInvitationRow accepts without a route refresh', async () => {
    const profile = {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'captain',
      fullName: 'Captain Example',
      avatarUrl: null,
      headline: 'Master Mariner',
      rank: null,
      currentCompany: null,
      relationship: { following: false, connection: { kind: 'incoming_pending', connectionId: '33333333-3333-4333-8333-333333333333' } },
    } as unknown as NetworkProfile
    render(<NetworkInvitationRow profile={profile} />)
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() => expect(mocks.acceptConnectionRequest).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333'))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('AttendanceControl registers without a route refresh', async () => {
    render(<AttendanceControl eventId="44444444-4444-4444-8444-444444444444" attending={false} />)
    fireEvent.click(screen.getAllByRole('button')[0]!)
    await waitFor(() => expect(mocks.attendEventAction).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444'))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('RecentlyDeletedPostCard restores without a route refresh', async () => {
    render(<RecentlyDeletedPostCard post={{ id: '55555555-5555-4555-8555-555555555555', category: 'technical_discussion', body: 'Deleted lesson', deletedAt: '2026-09-23T10:00:00.000Z', purgeAfter: '2026-10-23T10:00:00.000Z' }} />)
    fireEvent.click(screen.getByRole('button', { name: /restore/i }))
    expect(await screen.findByText('Post restored.')).toBeInTheDocument()
    expect(mocks.restoreDeletedPost).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('CourseWithdrawControl withdraws without a route refresh', async () => {
    render(<CourseWithdrawControl courseId="66666666-6666-4666-8666-666666666666" />)
    fireEvent.click(screen.getByRole('button', { name: /withdraw from review to edit/i }))
    fireEvent.click(screen.getByRole('button', { name: /^withdraw/i }))
    await waitFor(() => expect(mocks.withdrawCourseFromReview).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666'))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('ViewCompletionBeacon completes the lesson once without a route refresh', async () => {
    render(<ViewCompletionBeacon slug="bridge-basics" lessonId="77777777-7777-4777-8777-777777777777" alreadyCompleted={false} />)
    await waitFor(() => expect(mocks.completeLearningLesson).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
