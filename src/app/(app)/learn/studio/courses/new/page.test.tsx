import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  getAccessContext: vi.fn(),
  getOwnProfileFromAurora: vi.fn(),
  listUserOrganizations: vi.fn(),
  redirect: vi.fn(),
  capturedInitialValue: null as unknown,
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/profiles/repository', () => ({ getOwnProfileFromAurora: mocks.getOwnProfileFromAurora }))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState },
}))
vi.mock('@/features/learning/components/course-form', () => ({
  CourseForm: ({ initialValue }: { initialValue: unknown }) => {
    mocks.capturedInitialValue = initialValue
    return <div data-testid="course-form">Course form</div>
  },
}))

import NewMentorCoursePage from './page'

afterEach(() => cleanup())

describe('/learn/studio/courses/new', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.capturedInitialValue = null
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'mentor@example.com' })
    mocks.getAccessContext.mockResolvedValue({
      personalPlan: 'creator_pro',
      personalEntitlements: [],
      verifications: ['trainer'],
      organizationMemberships: [],
      accountActive: true,
    })
    mocks.getOwnProfileFromAurora.mockResolvedValue({ id: 'user-1', fullName: 'Capt. Mentor' })
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
  })

  it('renders an active mentor a safe Phase 1 course draft form', async () => {
    render(await NewMentorCoursePage())

    expect(screen.getByRole('heading', { name: 'Create course' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /mentor studio/i })).toHaveAttribute('href', '/learn/studio')
    expect(screen.getByTestId('course-form')).toBeInTheDocument()
    expect(mocks.capturedInitialValue).toEqual({
      slug: '',
      title: '',
      subtitle: null,
      description: '',
      category: 'Deck',
      level: 'beginner',
      language: 'English',
      thumbnailPath: null,
      trailerPath: null,
      learningOutcomes: [],
      requirements: [],
      targetAudience: [],
      accessType: 'free',
      priceMinor: 0,
      discountPriceMinor: null,
      currency: 'INR',
      certificateEnabled: false,
      courseFormat: 'recorded',
    })
    expect(mocks.getMentorApplicationState).toHaveBeenCalledWith('user-1')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'none' },
    {
      kind: 'mentor',
      applicationId: '11111111-1111-4111-8111-111111111111',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T14:00:00.000Z',
      adminReviewNote: 'Access review.',
      mentorId: 'mentor-1',
      mentorStatus: 'suspended',
    },
  ])('redirects users without active mentor access before rendering the builder', async (state) => {
    mocks.getMentorApplicationState.mockResolvedValue(state)

    await NewMentorCoursePage()

    expect(mocks.redirect).toHaveBeenCalledWith('/learn/teach')
    expect(mocks.capturedInitialValue).toBeNull()
  })

  it('renders the builder for an approved organization LMS manager without personal mentor access', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.listUserOrganizations.mockResolvedValue([{
      id: 'company-1',
      slug: 'sea-academy',
      name: 'Sea Academy',
      verified: true,
      role: 'lms_manager',
    }])
    mocks.getAccessContext.mockResolvedValue({
      personalPlan: 'free',
      personalEntitlements: [],
      verifications: [],
      organizationMemberships: [{
        companyId: 'company-1',
        plan: 'organization_pro',
        role: 'lms_manager',
        verified: true,
        entitlements: [],
      }],
      accountActive: true,
    })

    render(await NewMentorCoursePage())

    expect(screen.getByRole('heading', { name: 'Create course' })).toBeInTheDocument()
    expect(screen.getByTestId('course-form')).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

})
