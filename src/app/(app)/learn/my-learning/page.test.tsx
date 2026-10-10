import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerCertificateSummary } from '@/features/learning/certificate-repository'
import type { LearnerCourseEnrollment } from '@/features/learning/enrollment-repository'
import type { LearnerLesson } from '@/features/learning/learner-course-repository'
import type { ResumeCourse } from '@/features/learning/learner-home-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listLearnerEnrollments: vi.fn(),
  listLearnerPurchases: vi.fn(),
  listForLearner: vi.fn(),
  getResumeCourse: vi.fn(),
}))

vi.mock('@/features/learning/certificate-repository', () => ({ certificateRepository: { listForLearner: mocks.listForLearner } }))
vi.mock('@/features/learning/learner-home-repository', () => ({ learnerHomeRepository: { getResumeCourse: mocks.getResumeCourse } }))

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

function lesson(overrides: Partial<LearnerLesson> & Pick<LearnerLesson, 'id' | 'title'>): LearnerLesson {
  return {
    lessonType: 'article',
    position: 0,
    summary: null,
    articleBody: null,
    articleFormat: 'plain',
    assetPath: null,
    externalUrl: null,
    durationSeconds: null,
    isPreview: false,
    isDownloadable: false,
    isPublished: true,
    releaseMode: 'immediate',
    releaseAt: null,
    dripDelayDays: null,
    prerequisiteLessonId: null,
    completionRule: 'manual',
    completionThreshold: null,
    maxAttempts: null,
    embedKind: null,
    isAvailable: true,
    lockReason: null,
    completed: false,
    completedAt: null,
    lastPositionSeconds: 0,
    viewedAt: null,
    mediaPercent: 0,
    attemptsUsed: 0,
    assignment: null,
    scorm: null,
    ...overrides,
  }
}

const nextLessonId = '77777777-7777-4777-8777-777777777777'

function resume(point: ResumeCourse['point']): ResumeCourse {
  return { enrollmentId: enrollment.enrollmentId, slug: enrollment.slug, title: enrollment.title, point }
}

const certificate: LearnerCertificateSummary = {
  certificateId: '44444444-4444-4444-8444-444444444444',
  enrollmentId: enrollment.enrollmentId,
  courseTitle: enrollment.title,
  issuedAt: '2026-09-15T12:00:00.000Z',
  expiresAt: null,
  verificationCode: '55555555-5555-4555-8555-555555555555',
  expired: false,
}

function searchParams(tab: string) {
  return { searchParams: Promise.resolve({ tab }) }
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('/learn/my-learning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.listLearnerEnrollments.mockResolvedValue([enrollment])
    mocks.listLearnerPurchases.mockResolvedValue([])
    mocks.listForLearner.mockResolvedValue([])
    mocks.getResumeCourse.mockResolvedValue(null)
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
    // Purchases now sit in their own tab (learning round C, C6).
    fireEvent.click(screen.getByRole('tab', { name: 'Purchases' }))

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

  describe('Continue card (learning round C, C6)', () => {
    it('opens the exact next lesson of the most recently active course', async () => {
      mocks.getResumeCourse.mockResolvedValueOnce(resume({
        kind: 'next',
        lesson: lesson({ id: nextLessonId, title: 'Walkthrough video', lessonType: 'video' }),
        position: 3,
        total: 6,
      }))

      render(await MyLearningPage())

      expect(mocks.getResumeCourse).toHaveBeenCalledWith('learner-1')
      const card = screen.getByRole('region', { name: `Continue: ${enrollment.title} · lesson 3 of 6` })
      expect(within(card).getByText('Walkthrough video · Video')).toBeInTheDocument()
      expect(within(card).getByRole('link', { name: 'Resume lesson' })).toHaveAttribute(
        'href',
        `/learn/courses/${enrollment.slug}/learn?lesson=${nextLessonId}`,
      )
    })

    it('offers a review when every lesson is done', async () => {
      mocks.getResumeCourse.mockResolvedValueOnce(resume({ kind: 'all_done', total: 6 }))
      render(await MyLearningPage())
      const card = screen.getByRole('region', { name: `All lessons done — ${enrollment.title}` })
      expect(within(card).getByText('You have completed all 6 lessons.')).toBeInTheDocument()
      expect(within(card).getByRole('link', { name: 'Review course' })).toHaveAttribute('href', `/learn/courses/${enrollment.slug}/learn`)
    })

    it('says when the next lesson opens when nothing is open yet', async () => {
      mocks.getResumeCourse.mockResolvedValueOnce(resume({ kind: 'waiting', opensAt: new Date('2026-10-20T06:00:00.000Z'), total: 6 }))
      render(await MyLearningPage())
      const card = screen.getByRole('region', { name: `Up next: ${enrollment.title}` })
      expect(within(card).getByText('Next lesson opens on 20 Oct 2026.')).toBeInTheDocument()
      expect(within(card).getByRole('link', { name: 'Open course' })).toHaveAttribute('href', `/learn/courses/${enrollment.slug}/learn`)
    })

    it('shows a plain line when the next lesson has no opening date', async () => {
      mocks.getResumeCourse.mockResolvedValueOnce(resume({ kind: 'waiting', opensAt: null, total: 6 }))
      render(await MyLearningPage())
      expect(screen.getByText('Your next lesson isn’t open yet.')).toBeInTheDocument()
    })

    it('shows no card without an in-progress course, for a course with no lessons, or when it cannot be worked out', async () => {
      render(await MyLearningPage())
      expect(screen.queryByText('Pick up where you left off')).not.toBeInTheDocument()
      cleanup()

      mocks.getResumeCourse.mockResolvedValueOnce(resume({ kind: 'empty' }))
      render(await MyLearningPage())
      expect(screen.queryByText('Pick up where you left off')).not.toBeInTheDocument()
      cleanup()

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.getResumeCourse.mockRejectedValueOnce(new Error('database unavailable'))
      render(await MyLearningPage())
      expect(screen.queryByText('Pick up where you left off')).not.toBeInTheDocument()
      expect(screen.getByRole('article', { name: enrollment.title })).toBeInTheDocument()
      expect(consoleError).toHaveBeenCalledWith('learner_resume_load_failed', { message: 'database unavailable' })
      consoleError.mockRestore()
    })
  })

  describe('tabs (learning round C, C6)', () => {
    it('shows Courses first, with accessible tabs and panels', async () => {
      render(await MyLearningPage())

      const tablist = screen.getByRole('tablist', { name: 'My learning' })
      const tabs = within(tablist).getAllByRole('tab')
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Courses', 'Certificates', 'Purchases'])
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
      expect(tabs[0]).toHaveAttribute('tabindex', '0')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[1]).toHaveAttribute('tabindex', '-1')

      const panel = screen.getByRole('tabpanel', { name: 'Courses' })
      expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
      expect(within(panel).getByRole('article', { name: enrollment.title })).toBeInTheDocument()
      expect(screen.queryByRole('tabpanel', { name: 'Purchases' })).not.toBeInTheDocument()
    })

    it('opens the tab named in ?tab=', async () => {
      render(await MyLearningPage(searchParams('certificates')))
      expect(screen.getByRole('tab', { name: 'Certificates' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel', { name: 'Certificates' })).toBeInTheDocument()
      cleanup()

      render(await MyLearningPage(searchParams('purchases')))
      expect(screen.getByRole('tab', { name: 'Purchases' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('region', { name: 'Purchases' })).toBeInTheDocument()
      cleanup()

      render(await MyLearningPage(searchParams('anything-else')))
      expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true')
    })

    it('keeps the #purchases link landing on Purchases', async () => {
      window.history.replaceState(null, '', '/learn/my-learning#purchases')
      const originalScrollIntoView = Element.prototype.scrollIntoView
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView

      try {
        render(await MyLearningPage())

        expect(screen.getByRole('tab', { name: 'Purchases' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('region', { name: 'Purchases' })).toBeInTheDocument()
        expect(scrollIntoView).toHaveBeenCalled()
        expect(scrollIntoView.mock.contexts[0]).toHaveAttribute('id', 'purchases')
      } finally {
        Element.prototype.scrollIntoView = originalScrollIntoView
      }
    })

    it('moves between tabs with the arrow, Home and End keys and records the tab in the address', async () => {
      render(await MyLearningPage())

      const courses = screen.getByRole('tab', { name: 'Courses' })
      fireEvent.keyDown(courses, { key: 'ArrowRight' })
      const certificates = screen.getByRole('tab', { name: 'Certificates' })
      expect(certificates).toHaveAttribute('aria-selected', 'true')
      expect(certificates).toHaveFocus()
      expect(window.location.search).toBe('?tab=certificates')

      fireEvent.keyDown(certificates, { key: 'End' })
      expect(screen.getByRole('tab', { name: 'Purchases' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Purchases' }), { key: 'ArrowRight' })
      expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true')
      expect(window.location.search).toBe('')
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Courses' }), { key: 'ArrowLeft' })
      expect(screen.getByRole('tab', { name: 'Purchases' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Purchases' }), { key: 'Home' })
      expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('Certificates tab (learning round C, C6)', () => {
    it('lists the signed-in learner’s certificates with issue date, validity, download and verify links', async () => {
      mocks.listForLearner.mockResolvedValueOnce([
        certificate,
        {
          ...certificate,
          certificateId: '99999999-9999-4999-8999-999999999991',
          enrollmentId: '99999999-9999-4999-8999-999999999992',
          courseTitle: 'Mooring Safety',
          expiresAt: '2027-09-15T12:00:00.000Z',
          verificationCode: '99999999-9999-4999-8999-999999999993',
        },
        {
          ...certificate,
          certificateId: '99999999-9999-4999-8999-999999999994',
          enrollmentId: '99999999-9999-4999-8999-999999999995',
          courseTitle: 'Ballast Water Management',
          expiresAt: '2026-01-15T12:00:00.000Z',
          expired: true,
          verificationCode: '99999999-9999-4999-8999-999999999996',
        },
      ])

      render(await MyLearningPage(searchParams('certificates')))

      expect(mocks.listForLearner).toHaveBeenCalledWith('learner-1')
      const list = screen.getByRole('list', { name: 'Your certificates' })
      const items = within(list).getAllByRole('listitem')
      expect(items).toHaveLength(3)

      expect(within(items[0]!).getByRole('heading', { name: enrollment.title })).toBeInTheDocument()
      expect(within(items[0]!).getByText('Issued 15 Sept 2026')).toBeInTheDocument()
      expect(within(items[0]!).getByText('No expiry')).toBeInTheDocument()
      expect(within(items[0]!).getByRole('link', { name: `Download certificate for ${enrollment.title}` })).toHaveAttribute(
        'href',
        `/api/learn/certificates/enrollment/${enrollment.enrollmentId}`,
      )
      expect(within(items[0]!).getByRole('link', { name: `Verify certificate for ${enrollment.title}` })).toHaveAttribute(
        'href',
        `/certificates/${certificate.verificationCode}`,
      )
      expect(within(items[1]!).getByText('Valid until 15 Sept 2027')).toBeInTheDocument()
      expect(within(items[1]!).getByRole('link', { name: 'Download certificate for Mooring Safety' })).toHaveAttribute(
        'href',
        '/api/learn/certificates/enrollment/99999999-9999-4999-8999-999999999992',
      )
      expect(within(items[2]!).getByText('Expired')).toBeInTheDocument()
    })

    it('has an honest empty state and survives a failed load', async () => {
      render(await MyLearningPage(searchParams('certificates')))
      expect(screen.getByText(/No certificates yet/)).toBeInTheDocument()
      cleanup()

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.listForLearner.mockRejectedValueOnce(new Error('relation does not exist'))
      render(await MyLearningPage(searchParams('certificates')))
      expect(screen.getByText(/We couldn't load your certificates just now/)).toBeInTheDocument()
      consoleError.mockRestore()
    })
  })

  it('shows when time-limited access has ended, with a renew link to the course page', async () => {
    mocks.listLearnerEnrollments.mockResolvedValueOnce([
      { ...enrollment, accessExpiresAt: '2026-01-31T12:00:00.000Z' },
      {
        ...enrollment,
        enrollmentId: '99999999-9999-4999-8999-999999999990',
        slug: 'mooring-safety',
        title: 'Mooring Safety',
        accessExpiresAt: '2099-01-31T12:00:00.000Z',
      },
    ])

    render(await MyLearningPage())

    const ended = screen.getByRole('article', { name: enrollment.title })
    expect(within(ended).getByText(/Access ended on 31 Jan 2026/)).toBeInTheDocument()
    expect(within(ended).getByRole('link', { name: `Renew ${enrollment.title}` })).toHaveAttribute('href', `/learn/courses/${enrollment.slug}`)
    expect(within(ended).queryByRole('link', { name: 'Continue learning' })).not.toBeInTheDocument()

    const active = screen.getByRole('article', { name: 'Mooring Safety' })
    expect(within(active).queryByText(/Access ended/)).not.toBeInTheDocument()
    expect(within(active).getByRole('link', { name: 'Continue learning' })).toHaveAttribute('href', '/learn/courses/mooring-safety/learn')
  })
})
