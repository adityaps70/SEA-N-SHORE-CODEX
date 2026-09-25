import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  listOwnedCourses: vi.fn(),
  listForMentor: vi.fn(),
  listUserOrganizations: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState },
}))
vi.mock('@/features/learning/course-repository', () => ({
  courseRepository: { listOwnedCourses: mocks.listOwnedCourses },
}))
vi.mock('@/features/learning/assignment-grading-repository', () => ({
  assignmentGradingRepository: { listForMentor: mocks.listForMentor },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))

import MentorStudioPage from './page'

afterEach(() => cleanup())

describe('/learn/studio', () => {
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
    mocks.listOwnedCourses.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        slug: 'sire-2-readiness-for-tanker-officers',
        title: 'SIRE 2.0 Readiness for Tanker Officers',
        subtitle: 'Practical preparation for inspections and onboard competency',
        category: 'SIRE 2.0',
        level: 'advanced',
        courseFormat: 'recorded',
        accessType: 'free',
        status: 'draft',
        adminReviewNote: null,
        updatedAt: '2026-09-14T15:00:00.000Z',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        slug: 'bridge-leadership-under-pressure',
        title: 'Bridge Leadership Under Pressure',
        subtitle: null,
        category: 'Leadership',
        level: 'intermediate',
        courseFormat: 'recorded',
        accessType: 'free',
        status: 'submitted',
        adminReviewNote: null,
        updatedAt: '2026-09-14T14:00:00.000Z',
      },
    ])
    mocks.listForMentor.mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        attemptNumber: 1,
        status: 'submitted',
        submittedAt: '2026-09-15T09:30:00.000Z',
        responseText: 'Completed vessel inspection evidence.',
        attachmentPath: null,
        scorePoints: null,
        percentage: null,
        passed: null,
        feedback: null,
        gradedAt: null,
        maxPoints: 100,
        passingPercentage: 70,
        courseTitle: 'SIRE 2.0 Readiness for Tanker Officers',
        courseSlug: 'sire-2-readiness-for-tanker-officers',
        lessonTitle: 'Practical vessel inspection assignment',
        learnerName: 'Test Learner',
      },
    ])
  })

  it('shows an approved mentor their Studio, course portfolio and learner-review entry point', async () => {
    render(await MentorStudioPage())

    expect(screen.getByRole('heading', { name: 'Learning Studio' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create course/i })).toHaveAttribute('href', '/learn/studio/courses/new')
    expect(screen.getByRole('link', { name: /review assignments/i })).toHaveAttribute('href', '/learn/studio/assignments')
    expect(screen.getByRole('link', { name: /analytics/i })).toHaveAttribute('href', '/learn/studio/analytics')
    expect(screen.getByRole('link', { name: /review 1 learner submission/i })).toHaveAttribute('href', '/learn/studio/assignments')
    expect(screen.getByText('Learner reviews')).toBeInTheDocument()
    expect(screen.getByText('Assignments awaiting review')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0 Readiness for Tanker Officers')).toBeInTheDocument()
    expect(screen.getByText('Bridge Leadership Under Pressure')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getAllByText('In review')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /edit sire 2.0 readiness for tanker officers/i })).toHaveAttribute(
      'href',
      '/learn/studio/courses/33333333-3333-4333-8333-333333333333/edit',
    )
    expect(mocks.listOwnedCourses).toHaveBeenCalledWith('user-1')
    expect(mocks.listForMentor).toHaveBeenCalledWith('user-1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('keeps assignment grading discoverable even when there are no pending submissions', async () => {
    mocks.listForMentor.mockResolvedValue([])

    render(await MentorStudioPage())

    expect(screen.getByRole('link', { name: /review assignments/i })).toHaveAttribute('href', '/learn/studio/assignments')
    expect(screen.getByText('Learner reviews')).toBeInTheDocument()
    expect(screen.queryByText('Assignments awaiting review')).not.toBeInTheDocument()
  })

  it('shows a useful empty state for an approved mentor with no courses yet', async () => {
    mocks.listOwnedCourses.mockResolvedValue([])
    mocks.listForMentor.mockResolvedValue([])

    render(await MentorStudioPage())

    expect(screen.getByText('Create your first maritime course')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a course/i })).toHaveAttribute('href', '/learn/studio/courses/new')
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

    await MentorStudioPage()

    expect(mocks.redirect).toHaveBeenCalledWith('/learn/teach')
    expect(mocks.listOwnedCourses).not.toHaveBeenCalled()
    expect(mocks.listForMentor).not.toHaveBeenCalled()
  })

  it('opens Studio for an approved organization LMS manager without personal mentor access', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.listUserOrganizations.mockResolvedValue([{
      id: 'company-1',
      slug: 'sea-academy',
      name: 'Sea Academy',
      verified: true,
      role: 'lms_manager',
    }])
    mocks.listOwnedCourses.mockResolvedValue([])
    mocks.listForMentor.mockResolvedValue([])

    render(await MentorStudioPage())

    expect(screen.getByRole('heading', { name: 'Learning Studio' })).toBeInTheDocument()
    expect(screen.getByText('Organization LMS workspace')).toBeInTheDocument()
    expect(mocks.listOwnedCourses).toHaveBeenCalledWith('user-1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

})