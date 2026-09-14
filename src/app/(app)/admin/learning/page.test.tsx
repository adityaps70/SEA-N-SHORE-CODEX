import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentorApplicationReviewItem } from '@/features/learning/admin-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listMentorApplications: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/admin-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/admin-repository')>()
  return {
    ...original,
    learningAdminRepository: {
      listMentorApplications: mocks.listMentorApplications,
    },
  }
})
vi.mock('@/features/learning/components/mentor-review-controls', () => ({
  MentorReviewControls: ({ applicationId }: { applicationId: string }) => (
    <div data-testid="mentor-review-controls">review:{applicationId}</div>
  ),
}))

import LearningAdminPage from './page'

const application: MentorApplicationReviewItem = {
  applicationId: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
  name: 'Capt. Maya Singh',
  currentLastRank: 'Master Mariner',
  yearsExperience: 18,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  specialization: 'SIRE 2.0, tanker operations and bridge leadership',
  certifications: ['Master Unlimited', 'ISO 9001 Lead Auditor'],
  linkedInUrl: 'https://www.linkedin.com/in/maya-singh-mariner',
  shortBio: 'Master Mariner with eighteen years of sea and shore experience focused on tanker safety, leadership and practical competency development.',
  profilePhotoPath: 'profiles/user-1/avatar.jpg',
  proposedCourseTopics: ['SIRE 2.0 readiness', 'Bridge leadership'],
  status: 'pending',
  submittedAt: '2026-09-14T12:00:00.000Z',
  updatedAt: '2026-09-14T12:00:00.000Z',
  adminReviewNote: null,
}

afterEach(() => {
  cleanup()
})

describe('/admin/learning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.listMentorApplications.mockResolvedValue([application])
  })

  it('opens on the actionable pending mentor queue and shows maritime evidence', async () => {
    render(await LearningAdminPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.listMentorApplications).toHaveBeenCalledWith('admin-1', 'pending')
    expect(screen.getByRole('heading', { name: 'Learning review' })).toBeInTheDocument()
    expect(screen.getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(screen.getByText('Master Mariner')).toBeInTheDocument()
    expect(screen.getByText('18 years')).toBeInTheDocument()
    expect(screen.getByText('Oil Tanker · Chemical Tanker')).toBeInTheDocument()
    expect(screen.getByText(application.specialization)).toBeInTheDocument()
    expect(screen.getByText('Master Unlimited')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0 readiness')).toBeInTheDocument()
    expect(screen.getByTestId('mentor-review-controls')).toHaveTextContent(application.applicationId)
  })

  it('renders historical approved applications without actionable review controls', async () => {
    mocks.listMentorApplications.mockResolvedValueOnce([{ ...application, status: 'approved', adminReviewNote: 'Approved after credential review.' }])

    render(await LearningAdminPage({ searchParams: Promise.resolve({ status: 'approved' }) }))

    expect(mocks.listMentorApplications).toHaveBeenCalledWith('admin-1', 'approved')
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('Approved after credential review.')).toBeInTheDocument()
    expect(screen.queryByTestId('mentor-review-controls')).not.toBeInTheDocument()
  })

  it('falls back to pending for an unsupported status query', async () => {
    render(await LearningAdminPage({ searchParams: Promise.resolve({ status: 'published' }) }))

    expect(mocks.listMentorApplications).toHaveBeenCalledWith('admin-1', 'pending')
  })

  it('shows a useful empty state when the selected mentor queue has no applications', async () => {
    mocks.listMentorApplications.mockResolvedValueOnce([])

    render(await LearningAdminPage({ searchParams: Promise.resolve({ status: 'rejected' }) }))

    expect(screen.getByText('No mentor applications in this queue.')).toBeInTheDocument()
  })
})
