import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  getForMentor: vi.fn(),
  listUserOrganizations: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState },
}))
vi.mock('@/features/learning/mentor-analytics-repository', () => ({
  mentorAnalyticsRepository: { getForMentor: mocks.getForMentor },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))

import MentorLearningAnalyticsPage from './page'

afterEach(() => cleanup())

describe('/learn/studio/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'mentor@example.com' })
    mocks.listUserOrganizations.mockResolvedValue([])
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'mentor',
      applicationId: '11111111-1111-4111-8111-111111111111',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T14:00:00.000Z',
      adminReviewNote: 'Approved.',
      mentorId: 'mentor-1',
      mentorStatus: 'active',
    })
    mocks.getForMentor.mockResolvedValue({
      summary: {
        courseCount: 2,
        publishedCourseCount: 1,
        enrollmentCount: 10,
        activeEnrollmentCount: 6,
        completedEnrollmentCount: 4,
        completionRate: 40,
        averageProgress: 61,
        certificateCount: 3,
        pendingAssignmentCount: 2,
        passedAssignmentCount: 5,
        revisionAssignmentCount: 1,
      },
      courses: [
        {
          courseId: 'course-1',
          slug: 'sire-2-readiness',
          title: 'SIRE 2.0 Readiness',
          status: 'published',
          enrollmentCount: 6,
          activeEnrollmentCount: 4,
          completedEnrollmentCount: 2,
          completionRate: 33,
          averageProgress: 55,
          certificateCount: 2,
          pendingAssignmentCount: 2,
          passedAssignmentCount: 3,
          revisionAssignmentCount: 1,
        },
        {
          courseId: 'course-2',
          slug: 'bridge-leadership',
          title: 'Bridge Leadership',
          status: 'approved',
          enrollmentCount: 4,
          activeEnrollmentCount: 2,
          completedEnrollmentCount: 2,
          completionRate: 50,
          averageProgress: 70,
          certificateCount: 1,
          pendingAssignmentCount: 0,
          passedAssignmentCount: 2,
          revisionAssignmentCount: 0,
        },
      ],
    })
  })

  it('shows an active mentor aggregate learning outcomes and course performance', async () => {
    render(await MentorLearningAnalyticsPage())

    expect(screen.getByRole('heading', { name: 'Learning analytics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /mentor studio/i })).toHaveAttribute('href', '/learn/studio')
    expect(screen.getByText('Enrollments')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('Completion rate')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('Average progress')).toBeInTheDocument()
    expect(screen.getByText('61%')).toBeInTheDocument()
    expect(screen.getByText('Certificates issued')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Assignments awaiting review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /review assignments/i })).toHaveAttribute('href', '/learn/studio/assignments')
    expect(screen.getByText('SIRE 2.0 Readiness')).toBeInTheDocument()
    expect(screen.getByText('Bridge Leadership')).toBeInTheDocument()
    expect(mocks.getForMentor).toHaveBeenCalledWith('user-1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('shows a course-creation empty state when an active mentor has no courses', async () => {
    mocks.getForMentor.mockResolvedValue({
      summary: {
        courseCount: 0,
        publishedCourseCount: 0,
        enrollmentCount: 0,
        activeEnrollmentCount: 0,
        completedEnrollmentCount: 0,
        completionRate: 0,
        averageProgress: 0,
        certificateCount: 0,
        pendingAssignmentCount: 0,
        passedAssignmentCount: 0,
        revisionAssignmentCount: 0,
      },
      courses: [],
    })

    render(await MentorLearningAnalyticsPage())

    expect(screen.getByText('Publish your first course to start measuring learner outcomes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create course/i })).toHaveAttribute('href', '/learn/studio/courses/new')
  })

  it.each([
    { kind: 'none' },
    {
      kind: 'mentor',
      applicationId: '11111111-1111-4111-8111-111111111111',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T14:00:00.000Z',
      adminReviewNote: 'Review in progress.',
      mentorId: 'mentor-1',
      mentorStatus: 'suspended',
    },
  ])('routes users without active mentor access back to Teach on Sea N Shore', async (state) => {
    mocks.getMentorApplicationState.mockResolvedValue(state)

    await MentorLearningAnalyticsPage()

    expect(mocks.redirect).toHaveBeenCalledWith('/learn/teach')
    expect(mocks.getForMentor).not.toHaveBeenCalled()
  })

  it('shows analytics to an approved organization LMS manager without personal mentor access', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.listUserOrganizations.mockResolvedValue([{
      id: 'company-1',
      slug: 'sea-academy',
      name: 'Sea Academy',
      verified: true,
      role: 'lms_manager',
    }])

    render(await MentorLearningAnalyticsPage())

    expect(screen.getByRole('heading', { name: 'Learning analytics' })).toBeInTheDocument()
    expect(mocks.getForMentor).toHaveBeenCalledWith('user-1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

})