import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerCourse, LearnerLesson } from '@/features/learning/learner-course-repository'
import type { LearnerQuiz } from '@/features/learning/learner-quiz-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getLearnerCourse: vi.fn(),
  getQuizForLearner: vi.fn(),
  createMediaReadUrl: vi.fn(),
  createLessonMediaUrl: vi.fn(async () => ({ url: 'https://signed.example.com/bridge-readiness.mp4', expiresAt: '2026-10-11T10:20:00.000Z' })),
  materialPlayer: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  isCourseManager: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  // Learning round C: rating, announcements and the course community (defaults: nothing to show).
  getEligibility: vi.fn(async () => null as unknown),
  listForLearner: vi.fn(async () => [] as unknown[]),
  getDiscussion: vi.fn(async () => null as unknown),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/features/learning/learner-progress-actions', () => ({ completeLearningLesson: vi.fn() }))
vi.mock('@/features/learning/course-payment-repository', () => ({ coursePaymentRepository: { isCourseManager: mocks.isCourseManager } }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/learner-course-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/learner-course-repository')>()
  return {
    ...original,
    learnerCourseRepository: { getLearnerCourse: mocks.getLearnerCourse },
  }
})
vi.mock('@/features/learning/learner-quiz-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/learner-quiz-repository')>()
  return {
    ...original,
    learnerQuizRepository: { getQuizForLearner: mocks.getQuizForLearner },
  }
})
vi.mock('@/features/learning/components/material-player', () => ({
  MaterialPlayer: (props: {
    lesson: LearnerLesson
    mediaUrl: string | null
    slug: string
    quiz: LearnerQuiz | null
  }) => {
    mocks.materialPlayer(props)
    return <div data-testid="material-player">{props.lesson.title}</div>
  },
}))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl, createLessonMediaUrl: mocks.createLessonMediaUrl }))
vi.mock('@/features/learning/course-rating-repository', () => ({ courseRatingRepository: { getEligibility: mocks.getEligibility } }))
vi.mock('@/features/learning/course-announcement-repository', () => ({ courseAnnouncementRepository: { listForLearner: mocks.listForLearner } }))
vi.mock('@/features/learning/course-community-repository', () => ({ courseCommunityRepository: { getDiscussion: mocks.getDiscussion } }))
vi.mock('@/features/learning/course-rating-actions', () => ({ saveCourseReview: vi.fn() }))
vi.mock('@/features/learning/course-community-actions', () => ({ openCourseDiscussion: vi.fn() }))

import LearnerCoursePage, { generateMetadata } from './page'

const articleId = '66666666-6666-4666-8666-666666666666'
const videoId = '77777777-7777-4777-8777-777777777777'
const quizLessonId = '88888888-8888-4888-8888-888888888888'

function lesson(overrides: Partial<LearnerLesson> & Pick<LearnerLesson, 'id' | 'title' | 'lessonType' | 'position'>): LearnerLesson {
  return {
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

const articleLesson = lesson({
  id: articleId,
  title: 'How SIRE 2.0 changes readiness',
  lessonType: 'article',
  position: 0,
  summary: 'Understand the inspection model before going deeper.',
  articleBody: 'SIRE 2.0 uses a risk-based inspection framework.',
  completed: true,
  completedAt: '2026-09-15T08:30:00.000Z',
})

const videoLesson = lesson({
  id: videoId,
  title: 'Bridge readiness walkthrough',
  lessonType: 'video',
  position: 1,
  summary: 'Walk through the bridge evidence expected before inspection.',
  assetPath: 'learning/courses/sire-2/bridge-readiness.mp4',
  durationSeconds: 780,
  completionRule: 'media_percentage',
  completionThreshold: 90,
  lastPositionSeconds: 125,
  mediaPercent: 16,
})

const quizLesson = lesson({
  id: quizLessonId,
  title: 'Readiness knowledge check',
  lessonType: 'quiz',
  position: 0,
  summary: 'Check your understanding of the readiness principles.',
  completionRule: 'quiz_pass',
  maxAttempts: 3,
})

const course: LearnerCourse = {
  enrollmentId: '22222222-2222-4222-8222-222222222222',
  enrollmentStatus: 'active',
  courseId: '33333333-3333-4333-8333-333333333333',
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  courseFormat: 'recorded',
  certificateEnabled: true,
  navigationMode: 'free',
  mentorName: 'Capt. Maya Singh',
  totalLessons: 3,
  completedLessons: 1,
  progressPercent: 33,
  sections: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Inspection foundations',
      position: 0,
      lessons: [articleLesson, videoLesson],
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Operational readiness',
      position: 1,
      lessons: [quizLesson],
    },
  ],
}

const quiz: LearnerQuiz = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lessonId: quizLessonId,
  passPercentage: 70,
  instructions: 'Choose the best answer for each question.',
  maxAttempts: 3,
  attemptsUsed: 0,
  questions: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      prompt: 'What is the first priority before a SIRE 2.0 inspection?',
      position: 0,
      options: [
        { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', label: 'Verify evidence and actual practice', position: 0 },
        { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', label: 'Prepare paperwork only', position: 1 },
      ],
    },
  ],
}

afterEach(() => cleanup())

describe('/learn/courses/[slug]/learn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.getLearnerCourse.mockResolvedValue(course)
    mocks.getQuizForLearner.mockResolvedValue(quiz)
    mocks.createMediaReadUrl.mockResolvedValue('https://signed.example.com/bridge-readiness.mp4')
  })

  it('defaults to the first available incomplete material and passes its signed media into the native player', async () => {
    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({}),
    }))

    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.getLearnerCourse).toHaveBeenCalledWith('learner-1', course.slug)
    // Round E: the course block sits at the top of the sidebar; no developer wording about navigation.
    const sidebar = screen.getByRole('complementary', { name: 'Course' })
    expect(within(sidebar).getByRole('heading', { name: course.title })).toBeInTheDocument()
    expect(within(sidebar).getByText('1 of 3 · 33%')).toBeInTheDocument()
    expect(within(sidebar).getByText(`Mentored by ${course.mentorName}`)).toBeInTheDocument()
    expect(screen.queryByText(/navigation is enabled/i)).not.toBeInTheDocument()

    const player = screen.getByRole('region', { name: 'Current lesson' })
    expect(within(player).getByRole('heading', { name: videoLesson.title })).toBeInTheDocument()
    // Round E: a 20-minute inline URL the player refreshes, and a watermark with a member code (no name or email).
    expect(mocks.createLessonMediaUrl).toHaveBeenCalledWith(videoLesson.assetPath)
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: videoLesson,
      mediaUrl: 'https://signed.example.com/bridge-readiness.mp4',
      mediaExpiresAt: '2026-10-11T10:20:00.000Z',
      watermark: expect.stringMatching(/^SNS-LEARNER1 · \d{1,2} [A-Z][a-z]{2,3} \d{4}$/),
      slug: course.slug,
      quiz: null,
      articleHtml: null,
    })
    expect(JSON.stringify(mocks.materialPlayer.mock.calls[0]![0].watermark)).not.toContain('learner@example.com')
    expect(within(player).getByTestId('material-player')).toHaveTextContent(videoLesson.title)
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    // One bar for every lesson type: Previous, and Complete & next, locked until 90% of the video is played.
    const bar = within(player).getByRole('navigation', { name: 'Lesson navigation' })
    expect(within(bar).getByRole('link', { name: 'Previous lesson' })).toHaveAttribute(
      'href',
      `/learn/courses/${course.slug}/learn?lesson=${articleId}`,
    )
    expect(within(bar).getByRole('button', { name: /Complete & next/ })).toBeDisabled()
    expect(within(player).getAllByText('Play 90% of this material to continue.').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Continue to next material/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Next material/ })).not.toBeInTheDocument()
  })

  it('puts the lesson first on phones and opens the curriculum from a "Curriculum n/N" sheet', async () => {
    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: articleId }),
    }))

    // Phone page bar: back to the course page with the course title; the desktop sidebar is hidden below lg.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', `/learn/courses/${course.slug}`)
    expect(screen.getByRole('complementary', { name: 'Course' })).toHaveClass('max-lg:hidden')
    expect(screen.getByText(/Lesson 1 of 3 ·/)).toHaveClass('md:hidden')
    expect(screen.getByText(/% complete · 1 of 3/)).toBeInTheDocument()

    // The "Curriculum n/N" button sits in the lesson's bottom bar on phones and tablets.
    const toggle = screen.getByRole('button', { name: 'Curriculum 1/3' })
    expect(toggle).toHaveClass('lg:hidden')
    expect(toggle.closest('[data-lesson-action-bar]')).not.toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    const sheet = screen.getByRole('dialog', { name: 'Course curriculum' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(sheet).getByRole('link', { name: /Bridge readiness/i })).toHaveAttribute('href', `/learn/courses/${course.slug}/learn?lesson=${videoId}`)
    expect(within(sheet).getByRole('link', { current: 'page' })).toHaveAttribute('href', `/learn/courses/${course.slug}/learn?lesson=${articleId}`)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Bridge readiness/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The article is complete, so the one primary action is "Next lesson".
    const next = within(screen.getByRole('navigation', { name: 'Lesson navigation' })).getByRole('link', { name: /Next lesson/ })
    expect(next).toHaveAttribute('href', `/learn/courses/${course.slug}/learn?lesson=${videoId}`)
  })

  it('renders a selected article without signing media and keeps curriculum navigation intact', async () => {
    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: articleId }),
    }))

    const curriculum = screen.getByRole('navigation', { name: 'Course curriculum' })
    // Round E (E1): modules are accordion headers; only the current lesson's module is open.
    const current = within(curriculum).getByRole('button', { name: /Module 1\s*Inspection foundations/ })
    const other = within(curriculum).getByRole('button', { name: /Module 2\s*Operational readiness/ })
    expect(current).toHaveAttribute('aria-expanded', 'true')
    expect(other).toHaveAttribute('aria-expanded', 'false')
    expect(within(curriculum).getByRole('link', { current: 'page' })).toHaveAttribute('href', `/learn/courses/${course.slug}/learn?lesson=${articleId}`)
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: articleLesson,
      mediaUrl: null,
      mediaExpiresAt: null,
      watermark: null,
      slug: course.slug,
      quiz: null,
      articleHtml: null,
    })
  })

  it('loads learner-safe quiz data only for an available quiz material', async () => {
    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: quizLessonId }),
    }))

    expect(mocks.getQuizForLearner).toHaveBeenCalledWith('learner-1', course.slug, quizLessonId)
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: quizLesson,
      mediaUrl: null,
      mediaExpiresAt: null,
      watermark: null,
      slug: course.slug,
      quiz,
      articleHtml: null,
    })
    // The quiz must be passed before moving on (round A's completion rule).
    expect(screen.getAllByText('Pass the quiz to continue.').length).toBeGreaterThan(0)
  })

  it('does not fetch protected content for a locked material', async () => {
    const lockedQuiz = lesson({
      ...quizLesson,
      isAvailable: false,
      lockReason: 'prerequisite',
      articleBody: null,
      assetPath: null,
      externalUrl: null,
    })
    const lockedCourse: LearnerCourse = {
      ...course,
      navigationMode: 'sequential',
      sections: [
        course.sections[0]!,
        { ...course.sections[1]!, lessons: [lockedQuiz] },
      ],
    }
    mocks.getLearnerCourse.mockResolvedValueOnce(lockedCourse)

    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: quizLessonId }),
    }))

    expect(screen.getByText('Lessons unlock in order.')).toBeInTheDocument()
    expect(screen.getAllByText(/quiz · locked/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument()
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: lockedQuiz,
      mediaUrl: null,
      mediaExpiresAt: null,
      watermark: null,
      slug: course.slug,
      quiz: null,
      articleHtml: null,
    })
  })

  it('renders persisted course completion and the eligible certificate state', async () => {
    const completedCourse: LearnerCourse = {
      ...course,
      enrollmentStatus: 'completed',
      completedLessons: 3,
      progressPercent: 100,
      sections: course.sections.map((section) => ({
        ...section,
        lessons: section.lessons.map((material) => ({
          ...material,
          completed: true,
          completedAt: material.completedAt ?? '2026-09-15T12:00:00.000Z',
        })),
      })),
    }
    mocks.getLearnerCourse.mockResolvedValueOnce(completedCourse)

    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: videoId }),
    }))

    const completion = screen.getByRole('region', { name: 'Course completed' })
    expect(within(completion).getByText(/all 3 published materials are complete/i)).toBeInTheDocument()
    expect(within(completion).getByText(/eligible sea n shore certificate is issued/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: `${course.title} progress` })).toHaveAttribute('aria-valuenow', '100')
  })

  it('names the browser tab after the lesson and the course (round E)', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: articleId }) })
    expect(metadata.title).toBe(`${articleLesson.title} · ${course.title}`)
  })

  it('gives a manual lesson one "Complete & next" button in the bottom bar (round E)', async () => {
    const manual = lesson({ ...videoLesson, completionRule: 'manual', completed: false })
    mocks.getLearnerCourse.mockResolvedValueOnce({ ...course, sections: [{ ...course.sections[0]!, lessons: [articleLesson, manual] }, course.sections[1]!] })
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: videoId }) }))
    const bar = screen.getByRole('navigation', { name: 'Lesson navigation' })
    expect(within(bar).getByRole('button', { name: /Complete & next/ })).toBeEnabled()
    expect(screen.getAllByRole('navigation', { name: 'Lesson navigation' })).toHaveLength(1)
  })

  it('hides the site footer while the player is open (round E)', async () => {
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({}) }))
    expect(document.documentElement.dataset.learnPlayer).toBe('on')
    cleanup()
    expect(document.documentElement.dataset.learnPlayer).toBeUndefined()
  })

  it('fails closed when the learner cannot access the published course', async () => {
    mocks.getLearnerCourse.mockResolvedValueOnce(null)

    await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({}),
    })

    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).not.toHaveBeenCalled()
  })

  it('fails closed when a requested material id is not in the enrolled curriculum', async () => {
    await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: '99999999-9999-4999-8999-999999999999' }),
    })

    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).not.toHaveBeenCalled()
  })
})

describe('/learn/courses/[slug]/learn full-height SCORM lessons (S2)', () => {
  const scormId = '99999999-aaaa-4aaa-8aaa-999999999999'
  const scormLesson = lesson({
    id: scormId,
    title: 'Inclusiveness and Consideration of Others · Interactive guide',
    lessonType: 'scorm',
    position: 2,
    summary: 'Work through the guide and the quick check.',
    durationSeconds: 240,
    completionRule: 'scorm_completion',
    scorm: { status: 'ready', version: '1.2', launchPath: 'index.html', contentToken: 'token' },
  })
  const scormCourse: LearnerCourse = {
    ...course,
    totalLessons: 4,
    sections: [{ ...course.sections[0]!, lessons: [articleLesson, videoLesson, scormLesson] }, course.sections[1]!],
  }
  const eligibility = { canReview: false, reason: 'progress', progressPercent: 10, review: null }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.getLearnerCourse.mockResolvedValue(scormCourse)
    mocks.getQuizForLearner.mockResolvedValue(null)
    mocks.createMediaReadUrl.mockResolvedValue('https://signed.example.com/bridge-readiness.mp4')
  })

  it('keeps an sr-only h1 and hands the compact header (Module › lesson, duration) to the player', async () => {
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: scormId }) }))
    const player = screen.getByRole('region', { name: 'Current lesson' })
    expect(within(player).getByRole('heading', { level: 1, name: scormLesson.title })).toHaveClass('sr-only')
    // No big title block or "Interactive module · 4 min" line above the package.
    expect(within(player).queryByText(/Interactive module · 4 min/)).not.toBeInTheDocument()
    expect(within(player).queryByText(/% complete ·/)).not.toBeInTheDocument()
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: scormLesson,
      mediaUrl: null,
      mediaExpiresAt: null,
      watermark: null,
      slug: course.slug,
      quiz: null,
      articleHtml: null,
      scormHeader: { crumb: 'Module 1', title: scormLesson.title, duration: '4 min' },
    })
    // The toolbar's own breadcrumb and page focus mode give way to the package header's.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /focus mode/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Course player' })).toBeInTheDocument()
  })

  it('puts the lesson bar in the flow under the frame (never over it), still gated until the module is finished', async () => {
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: scormId }) }))
    const player = screen.getByRole('region', { name: 'Current lesson' })
    const nav = within(player).getByRole('navigation', { name: 'Lesson navigation' })
    const bar = nav.closest('[data-lesson-action-bar]') as HTMLElement
    expect(bar).toHaveAttribute('data-docked', 'off')
    expect(bar.className).not.toMatch(/(^|\s)(sticky|fixed|max-md:fixed)(\s|$)/)
    // Header, frame (inside the player) and bar follow one another in the lesson card.
    expect(within(player).getByTestId('material-player').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(nav).getByRole('button', { name: /Complete & next/ })).toBeDisabled()
    expect(within(player).getAllByText('Finish the module to continue.').length).toBeGreaterThan(0)
    expect(within(nav).getByRole('link', { name: 'Previous lesson' })).toHaveAttribute('href', `/learn/courses/${course.slug}/learn?lesson=${videoId}`)
    // No room is kept for a fixed phone bar, and the page's padding is taken back so it does not scroll.
    const root = screen.getByRole('complementary', { name: 'Course' }).closest('[data-sidebar]')!.parentElement!
    expect(root.className).not.toContain('max-md:pb-32')
    expect(root).toHaveClass('md:-my-4')
  })

  it('moves "Rate this course" to the Announcements tab so nothing sits under the package', async () => {
    mocks.getEligibility.mockResolvedValueOnce(eligibility)
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: scormId }) }))
    // The Lesson tab is open, so the Announcements panel (and the rating in it) is hidden until chosen.
    expect(screen.queryByRole('heading', { name: 'Rate this course' })).not.toBeInTheDocument()
    const rating = screen.getByRole('heading', { name: 'Rate this course', hidden: true })
    expect(rating.closest('[role="tabpanel"]')?.id).toMatch(/-panel-announcements$/)
    fireEvent.click(screen.getByRole('tab', { name: /Announcements/ }))
    expect(screen.getByRole('heading', { name: 'Rate this course' })).toBeVisible()
  })

  it('ignores the remembered page focus mode on a SCORM lesson (its own Focus mode fills the window)', async () => {
    window.localStorage.setItem('sea-n-shore.learn.focus-mode', 'on')
    try {
      render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: scormId }) }))
      expect(document.querySelector('[data-sidebar]')).toHaveAttribute('data-focus', 'off')
      expect(document.documentElement.dataset.learnFocus).toBeUndefined()
    } finally {
      window.localStorage.removeItem('sea-n-shore.learn.focus-mode')
    }
  })

  it('keeps the regular layout for a SCORM package that is not ready yet', async () => {
    const preparing = lesson({ ...scormLesson, scorm: { status: 'processing', version: null, launchPath: null } as LearnerLesson['scorm'] })
    mocks.getLearnerCourse.mockResolvedValueOnce({ ...scormCourse, sections: [{ ...course.sections[0]!, lessons: [articleLesson, videoLesson, preparing] }, course.sections[1]!] })
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: scormId }) }))
    const player = screen.getByRole('region', { name: 'Current lesson' })
    expect(within(player).getByRole('heading', { level: 1, name: preparing.title })).not.toHaveClass('sr-only')
    expect(mocks.materialPlayer.mock.calls[0]![0]).not.toHaveProperty('scormHeader')
    expect(within(player).getByRole('navigation', { name: 'Lesson navigation' }).closest('[data-lesson-action-bar]')).toHaveAttribute('data-docked', 'on')
  })

  it('leaves every other lesson type exactly as before (title block, breadcrumb, focus mode, sticky bar, rating under the lesson)', async () => {
    mocks.getEligibility.mockResolvedValueOnce(eligibility)
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ lesson: videoId }) }))
    const player = screen.getByRole('region', { name: 'Current lesson' })
    const title = within(player).getByRole('heading', { level: 1, name: videoLesson.title })
    expect(title).not.toHaveClass('sr-only')
    expect(title).toHaveClass('text-page-title')
    expect(within(player).getByText(/Video · 13 min/)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus mode' })).toBeInTheDocument()
    expect(player.hasAttribute('data-scorm-lesson')).toBe(false)
    const bar = within(player).getByRole('navigation', { name: 'Lesson navigation' }).closest('[data-lesson-action-bar]')
    expect(bar).toHaveAttribute('data-docked', 'on')
    expect(bar).toHaveClass('sticky', 'bottom-0', 'max-md:fixed')
    const root = screen.getByRole('complementary', { name: 'Course' }).closest('[data-sidebar]')!.parentElement!
    expect(root).toHaveClass('py-2', 'max-md:pb-32')
    const rating = screen.getByRole('heading', { name: 'Rate this course' })
    expect(rating.closest('[role="tabpanel"]')).toBe(screen.getByRole('tabpanel', { name: 'Lesson' }))
  })
})

describe('/learn/courses/[slug]/learn course team access', () => {
  it('lets a learner with a free or purchased enrollment in without any team check', async () => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.getLearnerCourse.mockResolvedValue({ ...course, enrollmentSource: 'purchase' })
    mocks.getQuizForLearner.mockResolvedValue(null)
    mocks.createMediaReadUrl.mockResolvedValue(null)
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }) }))
    expect(mocks.isCourseManager).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('sends someone whose course team access has ended back to the course page', async () => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.getLearnerCourse.mockResolvedValue({ ...course, enrollmentSource: 'admin' })
    mocks.isCourseManager.mockResolvedValue(false)
    mocks.canAccessPlatformAdmin.mockResolvedValue(false)
    await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }) })
    expect(mocks.isCourseManager).toHaveBeenCalledWith('learner-1', course.courseId)
    expect(mocks.redirect).toHaveBeenCalledWith(`/learn/courses/${course.slug}`)
  })

  it('keeps team access open while the person still manages the course', async () => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1', cognitoSub: 'sub-1', email: 'learner@example.com' })
    mocks.getLearnerCourse.mockResolvedValue({ ...course, enrollmentSource: 'admin' })
    mocks.getQuizForLearner.mockResolvedValue(null)
    mocks.createMediaReadUrl.mockResolvedValue(null)
    mocks.isCourseManager.mockResolvedValue(true)
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }) }))
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('has Lesson and Announcements tabs; ?tab=announcements opens the course’s announcements, newest first (round C)', async () => {
    mocks.listForLearner.mockResolvedValueOnce([
      { id: 'a2', courseId: course.courseId, title: 'Live Q&A on Saturday', body: 'Join at 10:00 IST.', createdAt: '2026-10-09T10:00:00.000Z' },
      { id: 'a1', courseId: course.courseId, title: 'Welcome aboard', body: 'Start with the intro.', createdAt: '2026-10-01T10:00:00.000Z' },
    ])
    mocks.getDiscussion.mockResolvedValueOnce({ groupId: 'g1', name: 'Fixture Deck Circle', visibility: 'private' })
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({ tab: 'announcements' }) }))

    expect(mocks.listForLearner).toHaveBeenCalledWith('learner-1', course.courseId)
    const tabs = screen.getByRole('tablist', { name: 'Course player' })
    expect(within(tabs).getByRole('tab', { name: /Announcements/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: 'Lesson' })).toHaveAttribute('aria-selected', 'false')
    const panel = screen.getByRole('tabpanel', { name: /Announcements/ })
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Live Q&A on Saturday', 'Welcome aboard'])
    expect(screen.getAllByRole('button', { name: 'Ask the trainer / Discuss' }).length).toBeGreaterThan(0)

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Lesson' }))
    expect(screen.getByRole('region', { name: 'Current lesson' })).toBeVisible()
  })

  it('shows "Rate this course" in the lesson tab when the learner may rate it (round C)', async () => {
    mocks.getEligibility.mockResolvedValueOnce({ canReview: false, reason: 'progress', progressPercent: 10, review: null })
    render(await LearnerCoursePage({ params: Promise.resolve({ slug: course.slug }), searchParams: Promise.resolve({}) }))
    expect(mocks.getEligibility).toHaveBeenCalledWith('learner-1', course.courseId)
    expect(screen.getByRole('heading', { name: 'Rate this course' })).toBeInTheDocument()
    expect(screen.getByText(/once you’ve completed 20% of it\. You’re at 10%\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask the trainer / Discuss' })).not.toBeInTheDocument()
  })
})
