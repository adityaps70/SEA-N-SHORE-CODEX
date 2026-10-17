import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceCourse } from '@/features/learning/marketplace-repository'

const mocks = vi.hoisted(() => ({
  getPublishedCourseBySlug: vi.fn(),
  getLearnerEnrollment: vi.fn(),
  getPublishedCourseOverview: vi.fn(),
  enrollInFreeCourse: vi.fn(),
  requireAwsUser: vi.fn(),
  notFound: vi.fn(),
  loadCoursePurchaseState: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  getPublicCurriculum: vi.fn(),
  createMediaReadUrl: vi.fn(),
  // Learning round C: approved reviews (default: none).
  getPublicReviews: vi.fn(async () => ({ averageRating: null as number | null, reviewCount: 0, reviews: [] as unknown[] })),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/features/learning/course-purchase-state', () => ({ loadCoursePurchaseState: mocks.loadCoursePurchaseState }))
vi.mock('@/features/learning/course-payment-actions', () => ({ startCourseCheckoutAction: vi.fn(), confirmCoursePaymentAction: vi.fn() }))
vi.mock('@/features/learning/enrollment-actions', () => ({ openCourseAsTeamMember: vi.fn(), enrollInFreeCourse: mocks.enrollInFreeCourse }))
// The page is public: it reads the signed-in member if there is one (getVerifiedUser), else renders for a visitor.
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/public-course-repository', () => ({ publicCourseRepository: { getPublicCurriculum: mocks.getPublicCurriculum } }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))
vi.mock('@/features/learning/course-rating-repository', () => ({ courseRatingRepository: { getPublicReviews: mocks.getPublicReviews } }))
vi.mock('@/features/moderation/actions', () => ({ reportContent: vi.fn() }))
vi.mock('@/features/learning/marketplace-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/marketplace-repository')>()
  return {
    ...original,
    marketplaceRepository: {
      getPublishedCourseBySlug: mocks.getPublishedCourseBySlug,
      getPublishedCourseOverview: mocks.getPublishedCourseOverview,
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
    mocks.getPublishedCourseOverview.mockResolvedValue({ sections: [], lessonCount: 0, durationSeconds: 0, learnerCount: 0, publisher: null })
    mocks.getPublicCurriculum.mockResolvedValue([])
    mocks.createMediaReadUrl.mockResolvedValue('https://bucket.example/trailer.mp4?signed')
  })

  function desktopHero() {
    return document.getElementById('course-access') as HTMLElement
  }

  it('loads the published course by slug and presents its verified maritime learning evidence', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    expect(mocks.getPublishedCourseBySlug).toHaveBeenCalledWith(freeCourse.slug)
    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.getLearnerEnrollment).toHaveBeenCalledWith('learner-1', freeCourse.id)
    expect(screen.getByRole('link', { name: 'Explore courses' })).toHaveAttribute('href', '/learn')
    const hero = desktopHero()
    expect(within(hero).getByRole('heading', { name: freeCourse.title })).toBeInTheDocument()
    expect(within(hero).getByText(freeCourse.subtitle!)).toBeInTheDocument()
    expect(within(hero).getByText(freeCourse.description)).toBeInTheDocument()
    expect(within(hero).getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(within(hero).getByText('Verified trainer')).toBeInTheDocument()
    expect(within(hero).getByText('SIRE 2.0')).toBeInTheDocument()
    expect(within(hero).getByText('Advanced')).toBeInTheDocument()
    expect(within(hero).getByText('English')).toBeInTheDocument()
    expect(within(hero).getByText('Recorded')).toBeInTheDocument()
    expect(within(hero).getByText('Free')).toBeInTheDocument()
    expect(within(hero).getByText('Certificate')).toBeInTheDocument()
  })

  it('shows each outcome, requirement and audience group as entered, one bullet each, commas included', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValue({
      ...freeCourse,
      learningOutcomes: ['Navigate the CVIQ and identify Core, Rotational 1 and Rotational 2 questions', 'Run an effective onboard readiness review'],
      requirements: ['Officer-level, deck or engine experience'],
      targetAudience: ['Deck officers and engineers on oil, chemical and gas tankers'],
    })
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    const outcomes = within(screen.getByRole('region', { name: 'What you will learn' })).getAllByRole('listitem')
    expect(outcomes.map((item) => item.textContent)).toEqual([
      'Navigate the CVIQ and identify Core, Rotational 1 and Rotational 2 questions',
      'Run an effective onboard readiness review',
    ])
    const requirements = within(screen.getByRole('region', { name: 'Requirements' })).getAllByRole('listitem')
    expect(requirements.map((item) => item.textContent)).toEqual(['Officer-level, deck or engine experience'])
    const audience = within(screen.getByRole('region', { name: 'Who this course is for' })).getAllByRole('listitem')
    expect(audience.map((item) => item.textContent)).toEqual(['Deck officers and engineers on oil, chemical and gas tankers'])
  })

  it('gives phones a page bar, a cover header with chips and trainer link, and a sticky Enroll free bar', async () => {
    mocks.getPublicCurriculum.mockResolvedValueOnce([
      { title: 'Inspection foundations', lessons: [{ id: '66666666-6666-4666-8666-666666666666', title: 'Why SIRE 2.0 changed', lessonType: 'video', durationSeconds: 420, preview: true }] },
      { title: 'Inspection day', lessons: [{ id: '88888888-8888-4888-8888-888888888888', title: 'Knowledge check', lessonType: 'quiz', durationSeconds: null, preview: false }] },
    ])
    mocks.getPublishedCourseOverview.mockResolvedValueOnce({
      sections: [{ title: 'Inspection foundations', lessonCount: 5 }, { title: 'Inspection day', lessonCount: 7 }],
      lessonCount: 12,
      durationSeconds: 6 * 3600,
      learnerCount: 312,
      publisher: { kind: 'person', slug: 'maya-singh' },
    })
    mocks.enrollInFreeCourse.mockResolvedValueOnce({ ok: true, enrollmentId: 'e-1', alreadyEnrolled: false })
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    expect(mocks.getPublishedCourseOverview).toHaveBeenCalledWith(freeCourse.id)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/learn')
    expect(screen.getByRole('button', { name: 'More course actions' })).toBeInTheDocument()

    const header = screen.getByTestId('phone-course-header')
    expect(header).toHaveClass('md:hidden')
    expect(within(header).getByRole('heading', { name: freeCourse.title })).toBeInTheDocument()
    expect(within(header).getByText('Free')).toBeInTheDocument()
    expect(within(header).getByText('Certificate')).toBeInTheDocument()
    expect(within(header).getByText('6 h')).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'Capt. Maya Singh' })).toHaveAttribute('href', '/people/maya-singh')
    expect(within(header).getByText(/312 learners/)).toBeInTheDocument()

    // The curriculum outline is the same on phones and desktop (round A: public course pages).
    const curriculum = screen.getByRole('region', { name: 'Curriculum' })
    expect(curriculum).not.toHaveClass('md:hidden')
    expect(within(curriculum).getByText('2 materials · 1 free preview')).toBeInTheDocument()
    // Round E (E1): the outline is an accordion; Module 1 opens, the rest are collapsed.
    expect(within(curriculum).getByRole('button', { name: /Module 1\s*Inspection foundations/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(curriculum).getByRole('button', { name: /Module 2\s*Inspection day/ })).toHaveAttribute('aria-expanded', 'false')

    const bar = screen.getByTestId('course-action-bar')
    expect(bar).toHaveClass('md:hidden', 'sticky')
    fireEvent.click(within(bar).getByRole('button', { name: 'Enroll free' }))
    await waitFor(() => expect(within(bar).getByRole('link', { name: /Continue learning/ })).toHaveAttribute('href', `/learn/courses/${freeCourse.slug}/learn`))
    expect(mocks.enrollInFreeCourse).toHaveBeenCalledWith(freeCourse.id)
    // Round 14 (3.9): enrollInFreeCourse revalidates, so the action response re-renders the page.
    expect(mocks.refresh).not.toHaveBeenCalled()

    // Phone-only extras stay off desktop: the promo card and the trainer-credentials blurb are hidden on phones only.
    expect(screen.getByRole('heading', { name: 'Built for professional maritime development' }).closest('section')).toHaveClass('max-md:hidden')
    expect(screen.getByText(/Trainer credentials and this course were reviewed/).closest('div.rounded-\\[1\\.3rem\\]')).toHaveClass('max-md:hidden')
  })

  it('sizes "Who this course is for" to its content instead of stretching it to its row (round H, H6)', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))
    const audience = screen.getByRole('region', { name: 'Who this course is for' })
    expect(audience).toHaveClass('self-start')
    expect(audience.className).not.toMatch(/(^|\s)(lg:|md:)?(min-h-|h-full|self-stretch|flex-1)/)
    const grid = screen.getByTestId('course-detail-sections')
    expect(grid).toContainElement(audience)
    expect(grid).toHaveClass('lg:items-start')
    expect(grid.className).not.toMatch(/items-stretch/)
  })

  it('shows the publishing organization\'s logo beside the trainer name when it has one (round H, H6)', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce({ ...freeCourse, mentorName: 'Placeholder Academy', publisherLogoUrl: '/api/company-logo/c1?v=logo.png' })
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))
    const avatar = screen.getByTestId('course-publisher-avatar')
    expect(avatar.querySelector('img')).toHaveAttribute('src', '/api/company-logo/c1?v=logo.png')
  })

  it('still renders the course page when the phone overview cannot load', async () => {
    mocks.getPublishedCourseOverview.mockRejectedValueOnce(new Error('db down'))
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))
    expect(within(desktopHero()).getByRole('heading', { name: freeCourse.title })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Curriculum' })).not.toBeInTheDocument()
  })

  it('offers real free enrollment without fabricating curriculum for a learner who has not enrolled', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    const control = screen.getByTestId('enroll-free-control')
    expect(control).toHaveAttribute('data-course-id', freeCourse.id)
    // The access card keeps its own Enroll free; the phone sticky bar has the other one.
    expect(screen.getAllByRole('button', { name: 'Enroll free' })).toHaveLength(2)
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
    expect(screen.queryByRole('region', { name: 'Curriculum' })).not.toBeInTheDocument()
  })

  it('shows a paid course price and a clear "Purchases open soon" state while payments are not set up', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({ kind: 'buy', priceLabel: '₹20,000', configured: false, pending: null })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    expect(within(desktopHero()).getByRole('heading', { name: paidCourse.title })).toBeInTheDocument()
    expect(within(desktopHero()).getByText('₹20,000')).toBeInTheDocument()
    // Nothing to buy yet, so no phone sticky bar either.
    expect(screen.queryByTestId('course-action-bar')).not.toBeInTheDocument()
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

    expect(within(desktopHero()).getByText('₹16,000')).toBeInTheDocument()
    const original = within(desktopHero()).getByText('₹20,000')
    expect(original.closest('.line-through')).not.toBeNull()
    expect(screen.getByText('Save 20%')).toBeInTheDocument()
    expect(within(desktopHero()).getByRole('button', { name: 'Buy course — ₹16,000' })).toBeEnabled()
    // Phones: the sticky bar opens the checkout section (C4: billing details for the GST invoice are asked there),
    // and the discounted price is on the header chip.
    expect(within(screen.getByTestId('course-action-bar')).getByRole('link', { name: 'Buy — ₹16,000' })).toHaveAttribute('href', '#course-access')
    expect(within(screen.getByTestId('phone-course-header')).getByText('₹16,000')).toBeInTheDocument()
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
    expect(within(desktopHero()).getByRole('button', { name: 'Buy course — ₹20,000' })).toBeInTheDocument()
  })

  it('sends a learner who bought the course straight to Continue learning', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({ kind: 'enrolled', viaTeam: false, completed: false })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    expect(screen.getByText('You own this course.')).toBeInTheDocument()
    expect(within(desktopHero()).getByRole('link', { name: /Continue learning/ })).toHaveAttribute('href', `/learn/courses/${paidCourse.slug}/learn`)
    expect(within(screen.getByTestId('course-action-bar')).getByRole('link', { name: /Continue learning/ })).toHaveAttribute('href', `/learn/courses/${paidCourse.slug}/learn`)
    expect(screen.queryByRole('button', { name: /Buy course/ })).not.toBeInTheDocument()
  })

  it('lets the course team open the course without buying it', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(paidCourse)
    mocks.loadCoursePurchaseState.mockResolvedValueOnce({ kind: 'team', reason: 'You manage this course' })

    render(await PublishedCoursePage({ params: Promise.resolve({ slug: paidCourse.slug }) }))

    expect(screen.getByText('You manage this course')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open course' })).toBeEnabled()
    expect(screen.queryByTestId('course-action-bar')).not.toBeInTheDocument()
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
    expect(within(screen.getByTestId('course-action-bar')).getByRole('link', { name: /Continue learning/ })).toBeInTheDocument()
  })

  it('uses not found before learner lookup when the slug is not currently visible in the published marketplace', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(null)

    await PublishedCoursePage({ params: Promise.resolve({ slug: 'missing-course' }) })

    expect(mocks.getPublishedCourseBySlug).toHaveBeenCalledWith('missing-course')
    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.getLearnerEnrollment).not.toHaveBeenCalled()
  })

  describe('for a visitor who is not signed in', () => {
    beforeEach(() => {
      mocks.requireAwsUser.mockResolvedValue(null)
      mocks.getPublicCurriculum.mockResolvedValue([
        { title: 'Inspection foundations', lessons: [
          { id: '66666666-6666-4666-8666-666666666666', title: 'Why SIRE 2.0 changed', lessonType: 'video', durationSeconds: 420, preview: true },
          { id: '77777777-7777-4777-8777-777777777777', title: 'The question library', lessonType: 'article', durationSeconds: null, preview: false },
        ] },
        { title: 'Inspection day', lessons: [
          { id: '88888888-8888-4888-8888-888888888888', title: 'Knowledge check', lessonType: 'quiz', durationSeconds: null, preview: false },
        ] },
      ])
    })

    it('shows the course, its outline and free previews, and asks the visitor to sign in to enrol', async () => {
      render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

      expect(mocks.getLearnerEnrollment).not.toHaveBeenCalled()
      expect(within(desktopHero()).getByRole('link', { name: /Sign in to enrol/ })).toHaveAttribute('href', expect.stringMatching(/^\/auth\/sign-in\?next=%2Flearn%2Fcourses%2F/))
      expect(screen.queryByRole('button', { name: 'Enroll free' })).not.toBeInTheDocument()
      const curriculum = screen.getByRole('region', { name: 'Curriculum' })
      expect(within(curriculum).getByText('Why SIRE 2.0 changed')).toBeInTheDocument()
      expect(within(curriculum).getByRole('link', { name: /Free preview\s*Why SIRE 2.0 changed/ })).toHaveAttribute('href', `/learn/courses/${freeCourse.slug}/preview/66666666-6666-4666-8666-666666666666`)
      // Each module shows its item count and total time.
      expect(within(curriculum).getByText('2 items · 7 min')).toBeInTheDocument()
      expect(within(curriculum).getAllByLabelText('Locked')).toHaveLength(2)
      expect(within(curriculum).getByText(/Enrol to continue/)).toBeInTheDocument()
    })

    it('shows the trailer and describes the course to search engines (schema.org Course)', async () => {
      const { container } = render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

      expect(mocks.createMediaReadUrl).toHaveBeenCalledWith(freeCourse.trailerPath)
      // Round E: one trailer <video> (the slot matching the screen), without a download button.
      const trailers = screen.getAllByLabelText(`${freeCourse.title} trailer`)
      expect(trailers).toHaveLength(1)
      expect(trailers[0]).toHaveAttribute('src', 'https://bucket.example/trailer.mp4?signed')
      expect(trailers[0]).toHaveAttribute('controlsList', 'nodownload noremoteplayback')
      const jsonLd = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!)
      expect(jsonLd).toMatchObject({
        '@type': 'Course',
        name: freeCourse.title,
        url: expect.stringContaining(`/learn/courses/${freeCourse.slug}`),
        provider: { name: 'Capt. Maya Singh' },
        offers: { category: 'Free', price: '0', priceCurrency: 'INR' },
      })
    })
  })

  it('gives search engines and share previews a title, description, canonical address and image', async () => {
    const { generateMetadata } = await import('./page')
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: freeCourse.slug }) })

    expect(metadata).toMatchObject({
      title: freeCourse.title,
      description: freeCourse.subtitle,
      alternates: { canonical: `/learn/courses/${freeCourse.slug}` },
      openGraph: { title: freeCourse.title, url: `/learn/courses/${freeCourse.slug}`, images: [{ url: `/api/learning-media/${freeCourse.thumbnailPath}` }] },
      twitter: { card: 'summary_large_image' },
    })
  })

  it('keeps a course that is not public (draft, unpublished or archived) out of search: 404 and noindex', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValue(null)
    const { generateMetadata } = await import('./page')

    await expect(generateMetadata({ params: Promise.resolve({ slug: 'a-draft-course' }) })).resolves.toEqual({ title: 'Course not found', robots: { index: false } })
    await PublishedCoursePage({ params: Promise.resolve({ slug: 'a-draft-course' }) })
    expect(mocks.notFound).toHaveBeenCalled()
  })

  it('shows the average and the approved reviews, lets others report a review, and adds aggregateRating (round C)', async () => {
    mocks.getPublicReviews.mockResolvedValueOnce({
      averageRating: 4.5,
      reviewCount: 2,
      reviews: [
        { id: 'r1', rating: 5, body: 'Clear and practical.', reviewedAt: '2026-10-05T10:00:00.000Z', reviewer: { id: 'fixture-a', name: 'Fixture Reviewer Ana', slug: 'fixture-ana' } },
        { id: 'r2', rating: 4, body: '', reviewedAt: '2026-10-04T10:00:00.000Z', reviewer: { id: 'learner-1', name: 'Fixture Reviewer Me', slug: null } },
      ],
    })
    const { container } = render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))

    expect(mocks.getPublicReviews).toHaveBeenCalledWith(freeCourse.id)
    const section = screen.getByRole('region', { name: 'Ratings and reviews' })
    expect(within(section).getByText('4.5')).toBeInTheDocument()
    expect(within(section).getByText(/2 ratings/)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Fixture Reviewer Ana' })).toHaveAttribute('href', '/people/fixture-ana')
    expect(within(section).getByText('Clear and practical.')).toBeInTheDocument()
    // The signed-in member can report someone else's review, never their own.
    expect(within(within(section).getByRole('article', { name: 'Review by Fixture Reviewer Ana' })).getByRole('button', { name: 'Report review' })).toBeInTheDocument()
    expect(within(within(section).getByRole('article', { name: 'Review by Fixture Reviewer Me' })).queryByRole('button', { name: 'Report review' })).not.toBeInTheDocument()

    const jsonLd = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!)
    expect(jsonLd.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: '4.5', ratingCount: 2, reviewCount: 2, bestRating: 5, worstRating: 1 })
  })

  it('leaves the reviews section and aggregateRating out while no review is approved (round C)', async () => {
    const { container } = render(await PublishedCoursePage({ params: Promise.resolve({ slug: freeCourse.slug }) }))
    expect(screen.queryByRole('region', { name: 'Ratings and reviews' })).not.toBeInTheDocument()
    expect(JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!)).not.toHaveProperty('aggregateRating')
  })
})
