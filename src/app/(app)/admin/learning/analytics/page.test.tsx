import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminLearningAnalytics } from '@/features/learning/admin-analytics-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getPlatformAnalytics: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/admin-analytics-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/admin-analytics-repository')>()
  return {
    ...original,
    adminLearningAnalyticsRepository: {
      getPlatformAnalytics: mocks.getPlatformAnalytics,
    },
  }
})

import AdminLearningAnalyticsPage from './page'

const analytics: AdminLearningAnalytics = {
  summary: {
    courseCount: 2,
    publishedCourseCount: 1,
    activeMentorCount: 4,
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
}

afterEach(() => {
  cleanup()
})

describe('/admin/learning/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.getPlatformAnalytics.mockResolvedValue(analytics)
  })

  it('shows aggregate platform learning outcomes and course performance', async () => {
    render(await AdminLearningAnalyticsPage())

    expect(mocks.getPlatformAnalytics).toHaveBeenCalledWith('admin-1')
    expect(screen.getByRole('heading', { name: 'Learning analytics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mentor approvals' })).toHaveAttribute('href', '/admin/learning')
    expect(screen.getByRole('link', { name: 'Course review' })).toHaveAttribute('href', '/admin/learning/courses')
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/admin/learning/analytics')
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page')

    expect(screen.getByText('Active mentors').parentElement).toHaveTextContent('4')
    expect(screen.getByText('Enrollments').parentElement).toHaveTextContent('10')
    expect(screen.getByText('Completion rate').parentElement).toHaveTextContent('40%')
    expect(screen.getByText('Average progress').parentElement).toHaveTextContent('61%')
    expect(screen.getByText('Certificates issued').parentElement).toHaveTextContent('3')
    expect(screen.getByText('Assignments awaiting review').parentElement).toHaveTextContent('2')
    expect(screen.getByText('Needs revision').parentElement).toHaveTextContent('1')

    expect(screen.getByText('SIRE 2.0 Readiness')).toBeInTheDocument()
    expect(screen.getByText('Bridge Leadership')).toBeInTheDocument()
    expect(screen.getByText('6 enrollments')).toBeInTheDocument()
    expect(screen.getByText('33%')).toBeInTheDocument()
  })

  it('shows a useful zero-portfolio state without inventing learner detail', async () => {
    mocks.getPlatformAnalytics.mockResolvedValueOnce({
      summary: {
        courseCount: 0,
        publishedCourseCount: 0,
        activeMentorCount: 0,
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
    } satisfies AdminLearningAnalytics)

    render(await AdminLearningAnalyticsPage())

    expect(screen.getByText('No learning activity to report yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review mentor applications' })).toHaveAttribute('href', '/admin/learning')
    expect(screen.queryByText(/learner email/i)).not.toBeInTheDocument()
  })
})
