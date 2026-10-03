import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerCourseEnrollment } from '@/features/learning/enrollment-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listLearnerEnrollments: vi.fn(),
  listLearnerPurchases: vi.fn(),
}))

vi.mock('@/features/learning/course-payment-repository', () => ({ coursePaymentRepository: { listLearnerPurchases: mocks.listLearnerPurchases } }))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/enrollment-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/enrollment-repository')>()
  return {
    ...original,
    enrollmentRepository: {
      listLearnerEnrollments: mocks.listLearnerEnrollments,
    },
  }
})

import MyLearningPage from './page'

const enrollment: LearnerCourseEnrollment = {
  enrollmentId: '33333333-3333-4333-8333-333333333333',
  enrollmentStatus: 'active',
  enrolledAt: '2026-09-14T12:00:00.000Z',
  completedAt: null,
  courseId: '11111111-1111-4111-8111-111111111111',
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnailPath: 'learning/courses/sire-2/thumbnail.jpg',
  courseFormat: 'recorded',
  certificateEnabled: true,
  mentorName: 'Capt. Maya Singh',
  certificateId: null,
  certificateVerificationCode: null,
  totalLessons: 5,
  completedLessons: 2,
  progressPercent: 40,
}

afterEach(() => cleanup())

describe('/learn/my-learning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.listLearnerEnrollments.mockResolvedValue([enrollment])
    mocks.listLearnerPurchases.mockResolvedValue([])
  })

  it('loads only the signed-in learner enrollments and shows real course progress', async () => {
    render(await MyLearningPage())

    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.listLearnerEnrollments).toHaveBeenCalledWith('learner-1')
    expect(screen.getByRole('heading', { name: 'My Learning' })).toBeInTheDocument()

    const card = screen.getByRole('article', { name: enrollment.title })
    expect(within(card).getByText(enrollment.title)).toBeInTheDocument()
    expect(within(card).getByText(enrollment.subtitle!)).toBeInTheDocument()
    expect(within(card).getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(within(card).getByText('SIRE 2.0')).toBeInTheDocument()
    expect(within(card).getByText('Advanced')).toBeInTheDocument()
    expect(within(card).getByText('Recorded')).toBeInTheDocument()
    expect(within(card).getByText('Certificate')).toBeInTheDocument()
    expect(within(card).getByText('2 of 5 lessons completed')).toBeInTheDocument()
    expect(within(card).getByText('40%')).toBeInTheDocument()
    expect(within(card).getByRole('progressbar', { name: `${enrollment.title} progress` })).toHaveAttribute('aria-valuenow', '40')
  })

  it('continues directly into the certified native learner player', async () => {
    render(await MyLearningPage())

    const card = screen.getByRole('article', { name: enrollment.title })
    expect(within(card).getByRole('link', { name: 'Continue learning' })).toHaveAttribute(
      'href',
      `/learn/courses/${enrollment.slug}/learn`,
    )
    expect(within(card).queryByText(/native lesson player is being connected/i)).not.toBeInTheDocument()
  })

  it('shows a completed certificate-enabled course with download and public verification actions', async () => {
    const verificationCode = '55555555-5555-4555-8555-555555555555'
    mocks.listLearnerEnrollments.mockResolvedValueOnce([
      {
        ...enrollment,
        enrollmentStatus: 'completed',
        completedAt: '2026-09-15T12:00:00.000Z',
        completedLessons: 5,
        progressPercent: 100,
        certificateId: '44444444-4444-4444-8444-444444444444',
        certificateVerificationCode: verificationCode,
      },
    ])

    render(await MyLearningPage())

    const card = screen.getByRole('article', { name: enrollment.title })
    expect(within(card).getByText('Completed')).toBeInTheDocument()
    expect(within(card).getByText('5 of 5 lessons completed')).toBeInTheDocument()
    expect(within(card).getByText('100%')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Review course' })).toHaveAttribute(
      'href',
      `/learn/courses/${enrollment.slug}/learn`,
    )
    expect(within(card).getByRole('link', { name: 'Download certificate' })).toHaveAttribute(
      'href',
      `/api/learn/certificates/enrollment/${enrollment.enrollmentId}`,
    )
    expect(within(card).getByRole('link', { name: 'Verify certificate' })).toHaveAttribute(
      'href',
      `/certificates/${verificationCode}`,
    )
    expect(within(card).queryByRole('link', { name: 'Continue learning' })).not.toBeInTheDocument()
  })

  it('lets a legacy completed eligible learner generate their certificate through the download route', async () => {
    mocks.listLearnerEnrollments.mockResolvedValueOnce([{
      ...enrollment,
      enrollmentStatus: 'completed',
      completedAt: '2026-09-15T12:00:00.000Z',
      completedLessons: 5,
      progressPercent: 100,
      certificateId: null,
      certificateVerificationCode: null,
    }])

    render(await MyLearningPage())
    const card = screen.getByRole('article', { name: enrollment.title })
    expect(within(card).getByRole('link', { name: 'Generate certificate' })).toHaveAttribute(
      'href',
      `/api/learn/certificates/enrollment/${enrollment.enrollmentId}`,
    )
    expect(within(card).queryByRole('link', { name: 'Verify certificate' })).not.toBeInTheDocument()
  })

  it('renders an honest empty state with a marketplace route when the learner has no enrollments', async () => {
    mocks.listLearnerEnrollments.mockResolvedValueOnce([])

    render(await MyLearningPage())

    expect(screen.getByRole('heading', { name: 'No courses yet' })).toBeInTheDocument()
    expect(screen.getByText(/courses you enroll in will appear here/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore courses' })).toHaveAttribute('href', '/learn')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('lists the learner’s course purchases like receipts', async () => {
    mocks.listLearnerPurchases.mockResolvedValueOnce([{
      id: '66666666-6666-4666-8666-666666666666',
      courseId: enrollment.courseId,
      profileId: 'learner-1',
      courseTitle: 'SIRE 2.0 Paid Masterclass',
      listPriceMinor: 499900,
      discountPriceMinor: null,
      amountMinor: 499900,
      currency: 'INR',
      provider: 'cashfree',
      providerOrderId: 'crs_66666666666646668666666666666666',
      providerPaymentId: 'cf_1',
      providerSessionId: null,
      status: 'paid',
      enrollmentId: enrollment.enrollmentId,
      enrollmentConfirmedAt: '2026-09-14T12:00:00.000Z',
      refundDueReason: null,
      failureReason: null,
      paidAt: '2026-09-14T12:00:00.000Z',
      refundedAt: null,
      refundStatus: null,
      refundAttempts: 0,
      providerRefundId: null,
      createdAt: '2026-09-14T11:58:00.000Z',
      courseSlug: 'sire-2-paid-masterclass',
    }])

    render(await MyLearningPage())

    expect(mocks.listLearnerPurchases).toHaveBeenCalledWith('learner-1')
    const purchases = screen.getByRole('region', { name: 'Purchases' })
    expect(within(purchases).getByText('₹4,999')).toBeInTheDocument()
    expect(within(purchases).getByText('crs_66666666666646668666666666666666')).toBeInTheDocument()
    expect(within(purchases).getByText('14 Sept 2026')).toBeInTheDocument()
    expect(within(purchases).getByText('Paid')).toBeInTheDocument()
  })

  it('keeps My Learning working when purchases cannot be loaded', async () => {
    mocks.listLearnerPurchases.mockRejectedValueOnce(new Error('relation does not exist'))
    render(await MyLearningPage())
    expect(screen.getByRole('article', { name: enrollment.title })).toBeInTheDocument()
    expect(screen.getByText(/We couldn't load your purchases just now/)).toBeInTheDocument()
  })
})
