import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  canUsePlatformAdminAuthority: vi.fn(),
  list: vi.fn(),
  enrolLearnerByEmail: vi.fn(),
  cancelCourseInvitation: vi.fn(),
  postCourseAnnouncement: vi.fn(),
  refresh: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority: mocks.canUsePlatformAdminAuthority }))
vi.mock('@/features/learning/course-roster-repository', () => ({ courseRosterRepository: { list: mocks.list } }))
vi.mock('@/features/learning/course-roster-actions', () => ({
  enrolLearnerByEmail: mocks.enrolLearnerByEmail,
  cancelCourseInvitation: mocks.cancelCourseInvitation,
}))
vi.mock('@/features/learning/course-announcement-actions', () => ({ postCourseAnnouncement: mocks.postCourseAnnouncement }))

import type { RosterInvitation, RosterLearner } from '@/features/learning/course-roster'
import type { RosterCourse } from '@/features/learning/course-roster-repository'
import CourseLearnersPage from './page'

const courseId = '22222222-2222-4222-8222-222222222222'
const invitationId = '77777777-7777-4777-8777-777777777777'

const course: RosterCourse = { id: courseId, title: 'Fixture Course', slug: 'fixture-course', openToNewLearners: true, canManage: true, batchMode: 'self_paced' as const }

const learning: RosterLearner = {
  enrollmentId: '80000000-0000-4000-8000-000000000001',
  learnerId: '90000000-0000-4000-8000-000000000001',
  name: 'Fixture Learner',
  slug: 'fixture-learner',
  rank: 'Fixture Rank',
  enrolledAt: '2026-03-05T06:00:00.000Z',
  source: 'purchase',
  status: 'active',
  accessExpiresAt: null,
  completedLessons: 3,
  totalLessons: 4,
  progressPercent: 75,
  lastActiveAt: '2026-03-10T06:00:00.000Z',
  quizScores: [{ lessonTitle: 'Fixture Quiz', bestPercentage: 90, passed: true }],
  certificate: 'issued',
  batchId: null,
  batchTitle: null,
}

const removed: RosterLearner = {
  ...learning,
  enrollmentId: '80000000-0000-4000-8000-000000000002',
  learnerId: '90000000-0000-4000-8000-000000000002',
  name: 'Second Fixture Learner',
  slug: null,
  rank: null,
  source: 'trainer',
  status: 'revoked',
  completedLessons: 0,
  progressPercent: 0,
  quizScores: [],
  certificate: 'none',
  batchId: null,
  batchTitle: null,
}

const invitation: RosterInvitation = {
  id: invitationId,
  email: 'fixture@example.test',
  createdAt: '2026-03-01T06:00:00.000Z',
  expiresAt: '2026-03-31T06:00:00.000Z',
  emailStatus: 'failed',
}

function renderPage(id = courseId) {
  return CourseLearnersPage({ params: Promise.resolve({ courseId: id }) })
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'fixture@example.test' })
  mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
  mocks.list.mockResolvedValue({ course, learners: [learning, removed], invitations: [invitation] })
  mocks.cancelCourseInvitation.mockResolvedValue({ ok: true })
})

describe('/learn/studio/courses/[courseId]/learners', () => {
  it('is not found for a course id that is not a UUID, before reading anything', async () => {
    await expect(renderPage('not-a-course')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('is not found when the course is not one the user manages', async () => {
    mocks.list.mockRejectedValue(new Error('course_not_found'))
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('lets other repository failures reach the error page', async () => {
    mocks.list.mockRejectedValue(new Error('connection refused'))
    await expect(renderPage()).rejects.toThrow('connection refused')
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('reads the roster as a platform administrator when the user is one', async () => {
    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)
    render(await renderPage())
    expect(mocks.canUsePlatformAdminAuthority).toHaveBeenCalledWith('user-1')
    expect(mocks.list).toHaveBeenCalledWith({ actorId: 'user-1', courseId, allCourses: true, batchId: null })
  })

  it('shows the course summary and the CSV download link', async () => {
    render(await renderPage())

    expect(mocks.list).toHaveBeenCalledWith({ actorId: 'user-1', courseId, allCourses: false, batchId: null })
    expect(screen.getByRole('heading', { level: 1, name: 'Fixture Course' })).toBeInTheDocument()
    expect(screen.getByText('1 learning · 1 certified · 1 invited')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', `/api/learn/courses/${courseId}/roster`)
    expect(screen.getByRole('link', { name: 'Back to the course' })).toHaveAttribute('href', `/learn/studio/courses/${courseId}/edit`)
  })

  it('renders the roster as a desktop table and a phone list', async () => {
    render(await renderPage())

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    const first = rows[1]!
    expect(within(first).getByRole('link', { name: 'Fixture Learner' })).toHaveAttribute('href', '/people/fixture-learner')
    expect(within(first).getByText('Fixture Rank')).toBeInTheDocument()
    expect(within(first).getByText('Learning')).toBeInTheDocument()
    expect(within(first).getByText('5 Mar 2026')).toBeInTheDocument()
    expect(within(first).getByText('Bought')).toBeInTheDocument()
    expect(within(first).getByText('75%')).toBeInTheDocument()
    expect(within(first).getByText('3 of 4 lessons')).toBeInTheDocument()
    expect(within(first).getByText('10 Mar 2026')).toBeInTheDocument()
    expect(within(first).getByText('Fixture Quiz: 90% (passed)')).toBeInTheDocument()
    expect(within(first).getByText('Issued')).toBeInTheDocument()

    const second = rows[2]!
    expect(within(second).queryByRole('link')).not.toBeInTheDocument()
    expect(within(second).getByText('Second Fixture Learner')).toBeInTheDocument()
    expect(within(second).getByText('Rank not shared')).toBeInTheDocument()
    expect(within(second).getByText('Access removed')).toBeInTheDocument()
    expect(within(second).getByText('Enrolled by trainer')).toBeInTheDocument()
    expect(within(second).getByText('—')).toBeInTheDocument()
    expect(within(second).getByText('Not yet')).toBeInTheDocument()

    const roster = screen.getByRole('region', { name: 'Roster' })
    const phoneItems = within(within(roster).getByRole('list')).getAllByRole('listitem')
    expect(phoneItems).toHaveLength(2)
    expect(within(phoneItems[0]!).getByRole('link', { name: 'Fixture Learner' })).toBeInTheDocument()
    expect(within(phoneItems[0]!).getByText('Fixture Rank · Learning')).toBeInTheDocument()
    expect(within(phoneItems[0]!).getByText('5 Mar 2026 · Bought')).toBeInTheDocument()
    expect(within(phoneItems[1]!).getByText('Rank not shared · Access removed')).toBeInTheDocument()
  })

  it('lists invitations waiting, with delivery problems and a cancel button', async () => {
    render(await renderPage())

    const invitations = screen.getByRole('region', { name: 'Invitations waiting' })
    expect(within(invitations).getByText('fixture@example.test')).toBeInTheDocument()
    expect(within(invitations).getByText('Invited 1 Mar 2026 · open until 31 Mar 2026 · the email could not be delivered')).toBeInTheDocument()

    fireEvent.click(within(invitations).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(mocks.cancelCourseInvitation).toHaveBeenCalledWith(courseId, invitationId))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('offers "Message all learners" while someone is still on the course', async () => {
    render(await renderPage())
    const section = screen.getByRole('region', { name: 'Message all learners' })
    expect(within(section).getByRole('form', { name: 'New announcement' })).toBeInTheDocument()
  })

  it('shows empty states and no "Message all learners" when nobody is learning', async () => {
    mocks.list.mockResolvedValue({ course, learners: [], invitations: [] })
    render(await renderPage())

    expect(screen.getByText('No learners yet.')).toBeInTheDocument()
    expect(screen.getByText('No invitations waiting.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Message all learners' })).not.toBeInTheDocument()
    expect(screen.getByText('0 learning · 0 certified')).toBeInTheDocument()
  })

  it('hides "Message all learners" when every learner has lost access', async () => {
    mocks.list.mockResolvedValue({ course, learners: [removed], invitations: [] })
    render(await renderPage())
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Message all learners' })).not.toBeInTheDocument()
  })

  it('explains why learners cannot be added while the course is closed to new learners', async () => {
    mocks.list.mockResolvedValue({ course: { ...course, openToNewLearners: false }, learners: [learning], invitations: [] })
    render(await renderPage())

    expect(screen.getByText('Learners can be added once the course is published and open to new learners.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add learner/ })).not.toBeInTheDocument()
  })

  it('shows the add-learner field while the course is open', async () => {
    render(await renderPage())
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add learner/ })).toBeDisabled()
  })
})
