import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  getForMentor: vi.fn(),
  listUserOrganizations: vi.fn(),
  createMediaReadUrl: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  capturedGradingProps: null as null | { attemptId: string; maxPoints: number; passingPercentage: number },
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState },
}))
vi.mock('@/features/learning/assignment-grading-repository', () => ({
  assignmentGradingRepository: { getForMentor: mocks.getForMentor },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))
vi.mock('@/features/learning/components/assignment-grading-control', () => ({
  AssignmentGradingControl: (props: { attemptId: string; maxPoints: number; passingPercentage: number }) => {
    mocks.capturedGradingProps = props
    return <div data-testid="assignment-grading-control">Grading control</div>
  },
}))

import MentorAssignmentReviewPage from './page'

afterEach(() => cleanup())

const attemptId = '55555555-5555-4555-8555-555555555555'
const review = {
  id: attemptId,
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
  assignmentInstructions: 'Submit a structured inspection readiness response.',
  previousAttempts: [{
    id: '44444444-4444-4444-8444-444444444444',
    attemptNumber: 1,
    status: 'graded',
    submittedAt: '2026-09-15T08:30:00.000Z',
    responseText: 'Initial inspection evidence.',
    attachmentPath: null,
    scorePoints: 60,
    percentage: 60,
    passed: false,
    feedback: 'Add stronger evidence.',
    gradedAt: '2026-09-15T10:00:00.000Z',
  }],
} as const

describe('/learn/studio/assignments/[attemptId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.capturedGradingProps = null
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
    mocks.getForMentor.mockResolvedValue(review)
    mocks.createMediaReadUrl.mockResolvedValue('https://signed.example/assignment-evidence.pdf')
  })

  it('shows the mentor-owned submission, instructions, history and grading controls', async () => {
    render(await MentorAssignmentReviewPage({ params: Promise.resolve({ attemptId }) }))

    expect(screen.getByRole('link', { name: /assignment grading/i })).toHaveAttribute('href', '/learn/studio/assignments')
    expect(screen.getByText('SIRE 2.0 Readiness')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inspection assignment' })).toBeInTheDocument()
    expect(screen.getByText('Test Learner')).toBeInTheDocument()
    expect(screen.getByText('Submit a structured inspection readiness response.')).toBeInTheDocument()
    expect(screen.getByText('Updated inspection evidence.')).toBeInTheDocument()
    expect(screen.getByText(/Attempt 2/)).toBeInTheDocument()
    expect(screen.getByText('Previous attempts')).toBeInTheDocument()
    expect(screen.getByText('Initial inspection evidence.')).toBeInTheDocument()
    expect(screen.getByText('Add stronger evidence.')).toBeInTheDocument()
    expect(screen.getByTestId('assignment-grading-control')).toBeInTheDocument()
    expect(mocks.getForMentor).toHaveBeenCalledWith('mentor-user-1', attemptId)
    expect(mocks.capturedGradingProps).toEqual(expect.objectContaining({ attemptId, maxPoints: 100, passingPercentage: 70 }))
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
  })

  it('signs and exposes a private attachment only when the submission contains one', async () => {
    mocks.getForMentor.mockResolvedValue({ ...review, attachmentPath: 'learning/assignments/evidence.pdf' })

    render(await MentorAssignmentReviewPage({ params: Promise.resolve({ attemptId }) }))

    expect(mocks.createMediaReadUrl).toHaveBeenCalledWith('learning/assignments/evidence.pdf')
    expect(screen.getByRole('link', { name: /open learner attachment/i })).toHaveAttribute(
      'href',
      'https://signed.example/assignment-evidence.pdf',
    )
  })

  it('fails closed when the attempt is not owned by the authenticated active mentor', async () => {
    mocks.getForMentor.mockResolvedValue(null)

    await MentorAssignmentReviewPage({ params: Promise.resolve({ attemptId }) })

    expect(mocks.notFound).toHaveBeenCalled()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.capturedGradingProps).toBeNull()
  })

  it('allows an organization LMS manager to review an assignment without personal mentor access', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.listUserOrganizations.mockResolvedValue([{
      id: 'company-1',
      slug: 'sea-academy',
      name: 'Sea Academy',
      verified: true,
      role: 'lms_manager',
    }])

    render(await MentorAssignmentReviewPage({ params: Promise.resolve({ attemptId }) }))

    expect(screen.getByTestId('assignment-grading-control')).toBeInTheDocument()
    expect(mocks.getForMentor).toHaveBeenCalledWith('mentor-user-1', attemptId)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
