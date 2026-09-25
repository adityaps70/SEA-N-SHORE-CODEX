import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  listForMentor: vi.fn(),
  listUserOrganizations: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState },
}))
vi.mock('@/features/learning/assignment-grading-repository', () => ({
  assignmentGradingRepository: { listForMentor: mocks.listForMentor },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))
vi.mock('@/features/learning/components/assignment-grading-control', () => ({
  AssignmentGradingControl: () => <div data-testid="inline-grading-control" />,
}))

import MentorAssignmentsPage from './page'

afterEach(() => cleanup())

describe('/learn/studio/assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'mentor-user-1' })
    mocks.listUserOrganizations.mockResolvedValue([])
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'mentor',
      applicationId: '11111111-1111-4111-8111-111111111111',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T14:00:00.000Z',
      adminReviewNote: null,
      mentorId: 'mentor-1',
      mentorStatus: 'active',
    })
    mocks.listForMentor.mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        attemptNumber: 2,
        status: 'submitted',
        submittedAt: '2026-09-16T08:30:00.000Z',
        responseText: 'Updated inspection evidence.',
        attachmentPath: null,
        scorePoints: null,
        percentage: null,
        passed: null,
        feedback: null,
        gradedAt: null,
        maxPoints: 100,
        passingPercentage: 70,
        courseTitle: 'SIRE 2.0 Readiness',
        courseSlug: 'sire-2-readiness',
        lessonTitle: 'Inspection assignment',
        learnerName: 'Test Learner',
      },
    ])
  })

  it('shows learner, course, assignment, attempt, submitted time, status and a dedicated review action', async () => {
    render(await MentorAssignmentsPage())

    expect(screen.getByRole('heading', { name: 'Assignment grading' })).toBeInTheDocument()
    expect(screen.getByText('Test Learner')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0 Readiness')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inspection assignment' })).toBeInTheDocument()
    expect(screen.getByText(/Attempt 2/)).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /review test learner submission/i })).toHaveAttribute(
      'href',
      '/learn/studio/assignments/55555555-5555-4555-8555-555555555555',
    )
    expect(screen.queryByTestId('inline-grading-control')).not.toBeInTheDocument()
    expect(mocks.listForMentor).toHaveBeenCalledWith('mentor-user-1')
  })

  it('shows assignment grading to an organization LMS manager without personal mentor access', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.listUserOrganizations.mockResolvedValue([{
      id: 'company-1',
      slug: 'sea-academy',
      name: 'Sea Academy',
      verified: true,
      role: 'lms_manager',
    }])

    render(await MentorAssignmentsPage())

    expect(screen.getByRole('heading', { name: 'Assignment grading' })).toBeInTheDocument()
    expect(mocks.listForMentor).toHaveBeenCalledWith('mentor-user-1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

})
