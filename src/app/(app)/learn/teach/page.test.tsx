import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentorApplicationInput } from '@/features/learning/mentor-application'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAwsOwnProfile: vi.fn(),
  getMentorApplicationState: vi.fn(),
  getMentorApplication: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/profiles/aws-queries', () => ({ getAwsOwnProfile: mocks.getAwsOwnProfile }))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: {
    getMentorApplicationState: mocks.getMentorApplicationState,
    getMentorApplication: mocks.getMentorApplication,
  },
}))
vi.mock('@/features/learning/components/mentor-application-form', () => ({
  MentorApplicationForm: ({ initialValue, applicationId, reviewNote }: {
    initialValue: MentorApplicationInput
    applicationId?: string
    reviewNote?: string | null
  }) => (
    <div data-testid="mentor-form">
      <span>{initialValue.name}</span>
      <span>{initialValue.currentLastRank}</span>
      <span>{initialValue.vesselTypes.join(', ')}</span>
      <span>{initialValue.profilePhotoPath}</span>
      <span>{applicationId ?? 'new-application'}</span>
      <span>{reviewNote ?? 'no-review-note'}</span>
    </div>
  ),
}))

import TeachPage from './page'

const applicationId = '11111111-1111-4111-8111-111111111111'

const storedApplication: MentorApplicationInput = {
  name: 'Capt. Maya Singh',
  currentLastRank: 'Master Mariner',
  yearsExperience: 18,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  specialization: 'SIRE 2.0, tanker operations and bridge leadership',
  certifications: ['Master Unlimited'],
  linkedInUrl: null,
  shortBio: 'Master Mariner with eighteen years of sea and shore experience focused on tanker safety, leadership and practical competency development.',
  profilePhotoPath: 'profiles/user-1/avatar.jpg',
  proposedCourseTopics: ['SIRE 2.0 readiness'],
}

const profile = {
  id: 'user-1',
  slug: 'maya-singh',
  profileType: 'seafarer' as const,
  fullName: 'Capt. Maya Singh',
  avatarPath: 'profiles/user-1/avatar.jpg',
  location: 'Mumbai, India',
  headline: 'Master Mariner | Tanker Operations',
  summary: 'Master Mariner with eighteen years of sea and shore experience focused on tanker safety and bridge leadership.',
  rank: 'Master Mariner',
  currentCompany: null,
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: ['SIRE 2.0', 'Bridge leadership'],
  contactVisibility: 'members' as const,
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

describe('/learn/teach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'maya@example.com' })
    mocks.getAwsOwnProfile.mockResolvedValue(profile)
    mocks.getMentorApplication.mockResolvedValue(storedApplication)
    mocks.redirect.mockImplementation((href: string) => {
      throw new Error(`redirect:${href}`)
    })
  })

  it('prefills a first trainer verification application from the signed-in maritime profile', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })

    render(await TeachPage())

    expect(screen.getByRole('heading', { name: 'Teach on Sea N Shore' })).toBeInTheDocument()
    expect(screen.getByTestId('mentor-form')).toHaveTextContent('Capt. Maya Singh')
    expect(screen.getByTestId('mentor-form')).toHaveTextContent('Master Mariner')
    expect(screen.getByTestId('mentor-form')).toHaveTextContent('Oil Tanker, Chemical Tanker')
    expect(screen.getByTestId('mentor-form')).toHaveTextContent('profiles/user-1/avatar.jpg')
    expect(screen.getByTestId('mentor-form')).toHaveTextContent('new-application')
  })

  it('shows an under-review state without an editable form while pending', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'application', applicationId, status: 'pending', submittedAt: '2026-09-14T12:00:00.000Z', updatedAt: '2026-09-14T12:00:00.000Z', adminReviewNote: null, mentorId: null, mentorStatus: null,
    })

    render(await TeachPage())

    expect(screen.getByText('Application under review')).toBeInTheDocument()
    expect(screen.queryByTestId('mentor-form')).not.toBeInTheDocument()
    expect(mocks.getMentorApplication).not.toHaveBeenCalled()
  })

  it.each([
    ['changes_requested', 'Please add more detail about LNG/LPG teaching experience.'],
    ['rejected', 'Please strengthen the evidence of instructional experience before resubmitting.'],
  ] as const)('lets the applicant update a %s application with the administrator note', async (status, note) => {
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'application', applicationId, status, submittedAt: '2026-09-14T12:00:00.000Z', updatedAt: '2026-09-14T13:00:00.000Z', adminReviewNote: note, mentorId: null, mentorStatus: null,
    })

    render(await TeachPage())

    expect(mocks.getMentorApplication).toHaveBeenCalledWith('user-1', applicationId)
    expect(screen.getByTestId('mentor-form')).toHaveTextContent(applicationId)
    expect(screen.getByTestId('mentor-form')).toHaveTextContent(note)
  })

  it('redirects an approved active trainer straight to Mentor Studio', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'mentor', applicationId, status: 'approved', submittedAt: '2026-09-14T12:00:00.000Z', updatedAt: '2026-09-14T14:00:00.000Z', adminReviewNote: 'Approved after credential review.', mentorId: 'mentor-1', mentorStatus: 'active',
    })

    await expect(TeachPage()).rejects.toThrow('redirect:/learn/studio')

    expect(mocks.redirect).toHaveBeenCalledWith('/learn/studio')
  })

  it('keeps Learning Studio locked when trainer verification is suspended', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'mentor', applicationId, status: 'approved', submittedAt: '2026-09-14T12:00:00.000Z', updatedAt: '2026-09-14T14:00:00.000Z', adminReviewNote: 'Account review in progress.', mentorId: 'mentor-1', mentorStatus: 'suspended',
    })

    render(await TeachPage())

    expect(screen.getByText('Trainer verification is temporarily suspended')).toBeInTheDocument()
    expect(screen.queryByTestId('mentor-form')).not.toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
