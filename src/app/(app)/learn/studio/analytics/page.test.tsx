import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  getForMentor: vi.fn(),
  getCourseInsights: vi.fn(),
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
vi.mock('@/features/learning/mentor-course-insights-repository', () => ({
  mentorCourseInsightsRepository: { getCourseInsights: mocks.getCourseInsights },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))

import MentorLearningAnalyticsPage from './page'

afterEach(() => cleanup())

function insightsFixture(courseId: string, title: string) {
  const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
  return {
    course: { id: courseId, title, slug: 'fixture-course' },
    lessonFunnel: {
      learnerCount: 4,
      lessons: [{ lessonId: 'lesson-1', title: 'Intro', sectionTitle: 'Section A', position: 1, reachedCount: 4, reachedPercent: 100, completedCount: 2, completedPercent: 50 }],
    },
    quizDifficulty: [{
      quizId: 'quiz-1',
      lessonId: 'lesson-2',
      lessonTitle: 'Knowledge check',
      questions: [{ questionId: 'question-1', prompt: 'Which document comes first?', questionType: 'single_choice', position: 1, answerCount: 4, pendingCount: 0, correctPercent: 75, isHardest: false }],
    }],
    monthlyTrend: { months: months.map((month) => ({ month, enrollmentCount: month === '2026-10' ? 4 : 0, revokedCount: 0 })), revenue: [] },
  }
}

describe('/learn/studio/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'mentor@example.com' })
    mocks.listUserOrganizations.mockResolvedValue([])
    mocks.getCourseInsights.mockResolvedValue(null)
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

  it('shows an active trainer aggregate learning outcomes and course performance', async () => {
    render(await MentorLearningAnalyticsPage())

    expect(screen.getByRole('heading', { name: 'Learning analytics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /learning studio/i })).toHaveAttribute('href', '/learn/studio')
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
    expect(screen.getByRole('heading', { name: 'SIRE 2.0 Readiness' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bridge Leadership' })).toBeInTheDocument()
    expect(mocks.getForMentor).toHaveBeenCalledWith('user-1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('shows a course-creation empty state when an active trainer has no courses', async () => {
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
    expect(mocks.getCourseInsights).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /where learners drop off/i })).not.toBeInTheDocument()
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
  ])('routes users without active trainer access back to Teach on Sea N Shore', async (state) => {
    mocks.getMentorApplicationState.mockResolvedValue(state)

    await MentorLearningAnalyticsPage()

    expect(mocks.redirect).toHaveBeenCalledWith('/learn/teach')
    expect(mocks.getForMentor).not.toHaveBeenCalled()
    expect(mocks.getCourseInsights).not.toHaveBeenCalled()
  })

  it('shows insights for the first managed course by default, with a picker of managed courses only', async () => {
    mocks.getCourseInsights.mockResolvedValue(insightsFixture('course-1', 'SIRE 2.0 Readiness'))

    render(await MentorLearningAnalyticsPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.getCourseInsights).toHaveBeenCalledWith('user-1', 'course-1')
    const picker = screen.getByRole('combobox', { name: 'Course' })
    expect(picker).toHaveValue('course-1')
    expect(within(picker).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['course-1', 'course-2'])
    expect(picker.closest('form')).toHaveAttribute('method', 'get')
    expect(screen.getByRole('heading', { name: 'Lesson drop-off' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Quiz question difficulty' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Enrolments and revenue' })).toBeInTheDocument()
    expect(screen.getByText('Which document comes first?')).toBeInTheDocument()
  })

  it('shows the course picked with ?course= when the viewer manages it', async () => {
    mocks.getCourseInsights.mockResolvedValue(insightsFixture('course-2', 'Bridge Leadership'))

    render(await MentorLearningAnalyticsPage({ searchParams: Promise.resolve({ course: 'course-2' }) }))

    expect(mocks.getCourseInsights).toHaveBeenCalledWith('user-1', 'course-2')
    expect(screen.getByRole('combobox', { name: 'Course' })).toHaveValue('course-2')
  })

  it('never asks for a course the viewer does not manage, falling back to their first course', async () => {
    render(await MentorLearningAnalyticsPage({ searchParams: Promise.resolve({ course: 'someone-elses-course' }) }))

    expect(mocks.getCourseInsights).toHaveBeenCalledTimes(1)
    expect(mocks.getCourseInsights).toHaveBeenCalledWith('user-1', 'course-1')
    expect(screen.getByText('Insights for this course are not available.')).toBeInTheDocument()
  })

  it('shows analytics to an approved organization LMS manager without personal trainer access', async () => {
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