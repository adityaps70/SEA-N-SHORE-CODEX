import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceCourse } from '@/features/learning/marketplace-repository'

const mocks = vi.hoisted(() => ({
  getPublishedCourseBySlug: vi.fn(),
  getLearnerEnrollment: vi.fn(),
  requireAwsUser: vi.fn(),
  notFound: vi.fn(),
  loadCoursePurchaseState: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/features/learning/course-purchase-state', () => ({ loadCoursePurchaseState: mocks.loadCoursePurchaseState }))
vi.mock('@/features/learning/course-payment-actions', () => ({ startCourseCheckoutAction: vi.fn(), confirmCoursePaymentAction: vi.fn() }))
vi.mock('@/features/learning/enrollment-actions', () => ({ openCourseAsTeamMember: vi.fn(), enrollInFreeCourse: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/marketplace-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/marketplace-repository')>()
  return {
    ...original,
    marketplaceRepository: {
      getPublishedCourseBySlug: mocks.getPublishedCourseBySlug,
    },
  }
})
vi.mock('@/features/learning/enrollment-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/enrollment-repository')>()
  return {
    ...original,
    enrollmentRepository: {
      getLearnerEnrollment: mocks.getLearnerEnrollment,
    },
  }
})
vi.mock('@/features/learning/components/enroll-free-control', () => ({
  EnrollFreeControl: ({ courseId, initiallyEnrolled }: { courseId: string; initiallyEnrolled: boolean }) => (
    <div data-testid="enroll-free-control" data-course-id={courseId}>
      {initiallyEnrolled ? <span>You are enrolled in this course.</span> : <button type="button">Enroll free</button>}
    </div>
  ),
}))

import PublishedCoursePage from './page'

const freeCourse: MarketplaceCourse = {
  id: '11111111-1111-4111-8111-111111111111',
  mentorId: '22222222-2222-4222-8222-222222222222',
  mentorName: 'Capt. Maya Singh',
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  description: 'A practical maritime course covering evidence-led SIRE 2.0 preparation, officer readiness and onboard execution.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnailPath: 'learning/courses/sire-2/thumbnail.jpg',
  trailerPath: 'learning/courses/sire-2/trailer.mp4',
  learningOutcomes: [
    'Prepare evidence for SIRE 2.0 interviews',
    'Run an effective onboard readiness review',
  ],
  requirements: ['Officer-level tanker experience', 'Working knowledge of tanker operations'],
  targetAudience: ['Deck officers', 'Marine superintendents'],
  certificateEnabled: true,
  courseFormat: 'recorded',
  accessType: 'free',
  priceMinor: 0,
  currency: 'INR',
  publishedAt: '2026-09-14T12:00:00.000Z',
}

const paidCourse: MarketplaceCourse = {
  ...freeCourse,
  id: '44444444-4444-4444-8444-444444444444',
  slug: 'sire-2-paid-masterclass',
  title: 'SIRE 2.0 Paid Masterclass',
  accessType: 'paid',
  priceMinor: 2_000_000,
}

afterEach(() => cleanup())

describe('/learn/courses/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPublishedCourseBySlug.mockResolvedValue(freeCourse)
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.getLearnerEnrollment.mockResolvedValue(null)
  })

  it('loads the published course by slug and presents its verified maritime learning evidence', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    expect(mocks.getPublishedCourseBySlug).toHaveBeenCalledWith(freeCourse.slug)
    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.getLearnerEnrollment).toHaveBeenCalledWith('learner-1', freeCourse.id)
    expect(screen.getByRole('link', { name: 'Explore courses' })).toHaveAttribute('href', '/learn')
    expect(screen.getByRole('heading', { name: freeCourse.title })).toBeInTheDocument()
    expect(screen.getByText(freeCourse.subtitle!)).toBeInTheDocument()
    expect(screen.getByText(freeCourse.description)).toBeInTheDocument()
    expect(screen.getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(screen.getByText('Verified trainer')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Certificate')).toBeInTheDocument()
  })

  it('offers real free enrollment without fabricating curriculum for a learner who has not enrolled', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    const control = screen.getByTestId('enroll-free-control')
    expect(control).toHaveAttribute('data-course-id', freeCourse.id)
    expect(within(control).getByRole('button', { name: 'Enroll free' })).toBeInTheDocument()

    const outcomes = screen.getByRole('region', { name: 'What you will learn' })
    expect(within(outcomes).getByText('Prepare evidence for SIRE 2.0 interviews')).toBeInTheDocument()
    expect(within(outcomes).getByText('Run an effective onboard readiness review')).toBeInTheDocument()

    const requirements = screen.getByRole('region', { name: 'Requirements' })
    expect(within(requirements).getByText('Officer-level tanker experience')).toBeInTheDocument()
    expect(within(requirements).getByText('Working knowledge of tanker operations')).toBeInTheDocument()

    const audience = screen.getByRole('region', { name: 'Who this course is for' })
    expect(within(audience).getByText('Deck officers')).toBeInTheDocument()
    expect(within(audience).getByText('Marine superintendents')).toBeInTheDocument()

    expect(screen.queryByText(/lesson 1/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Course curriculum')).not.toBeInTheDocument()
  })

  it('shows a paid course price and a clear "Purchases open soon" state while payments are not set up', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({ kind: 'buy', priceLabel: '₹20,000', configured: false, pending: null })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    expect(screen.getByRole('heading', { name: paidCourse.title })).toBeInTheDocument()
    expect(screen.getByText('₹20,000')).toBeInTheDocument()
    expect(mocks.loadCoursePurchaseState).toHaveBeenCalledWith({ userId: 'learner-1', course: paidCourse, enrollment: null })
    expect(screen.getByRole('button', { name: 'Purchases open soon' })).toBeDisabled()
    expect(screen.getByText(/You'll be able to buy this course here as soon as they are/)).toBeInTheDocument()
    expect(screen.queryByTestId('enroll-free-control')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll free' })).not.toBeInTheDocument()
  })

  it('shows the discount with the original price struck through and offers Buy course at the discounted price', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce({ ...paidCourse, discountPriceMinor: 1_600_000 })
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({ kind: 'buy', priceLabel: '₹16,000', configured: true, pending: null })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    expect(screen.getByText('₹16,000')).toBeInTheDocument()
    const original = screen.getByText('₹20,000')
    expect(original.closest('.line-through')).not.toBeNull()
    expect(screen.getByText('Save 20%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy course — ₹16,000' })).toBeEnabled()
  })

  it('offers Check payment status for a checkout the learner started but did not finish', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({
      kind: 'buy',
      priceLabel: '₹20,000',
      configured: true,
      pending: { orderId: '55555555-5555-4555-8555-555555555555', amountLabel: '₹20,000', startedLabel: '27 Sept 2026, 10:05 am' },
    })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    const pending = screen.getByRole('region', { name: 'Payment not confirmed yet' })
    expect(within(pending).getByText(/You opened checkout for ₹20,000 at 27 Sept 2026, 10:05 am/)).toBeInTheDocument()
    expect(within(pending).getByRole('button', { name: 'Check payment status' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Buy course — ₹20,000' })).toBeInTheDocument()
  })

  it('sends a learner who bought the course straight to Continue learning', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({ kind: 'enrolled', viaTeam: false, completed: false })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    expect(screen.getByText('You own this course.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Continue learning/ })).toHaveAttribute('href', `/learn/courses/${paidCourse.slug}/learn`)
    expect(screen.queryByRole('button', { name: /Buy course/ })).not.toBeInTheDocument()
  })

  it('lets the course team open the course without buying it', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({ kind: 'team', reason: 'You manage this course' })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    expect(screen.getByText('You manage this course')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open course' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Buy course/ })).not.toBeInTheDocument()
  })

  it('explains a payment that arrived but could not unlock the course', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({
      kind: 'refund_due', amountLabel: '₹20,000', paidLabel: '27 Sept 2026, 10:05 am', reason: 'You already had this course, so this was a duplicate payment.', refundInProgress: false,
    })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    const notice = screen.getByRole('region', { name: 'Refund on its way' })
    expect(notice).toHaveTextContent('We received ₹20,000 on 27 Sept 2026, 10:05 am but could not unlock the course. You already had this course, so this was a duplicate payment. The Sea N Shore team will refund the full amount to your original payment method.')
  })

  it('does not load purchase state for free courses', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))
    expect(mocks.loadCoursePurchaseState).not.toHaveBeenCalled()
  })

  it('shows the persisted enrolled state instead of another enrollment action', async () => {
    mocks.getLearnerEnrollment.mockResolvedValueOnce({
      enrollmentId: '33333333-3333-4333-8333-333333333333',
      status: 'active',
      enrollmentSource: 'free',
      enrolledAt: '2026-09-14T12:30:00.000Z',
      completedAt: null,
      revokedAt: null,
    })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    expect(screen.getByText('You are enrolled in this course.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll free' })).not.toBeInTheDocument()
  })

  it('uses not found before learner lookup when the slug is not currently visible in the published marketplace', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(null)

    await PublishedCoursePage({ params: Promise.resolve({ slug: 'missing-course' }) })

    expect(mocks.getPublishedCourseBySlug).toHaveBeenCalledWith('missing-course')
    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.getLearnerEnrollment).not.toHaveBeenCalled()
  })
})