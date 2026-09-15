import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerCourse, LearnerLesson } from '@/features/learning/learner-course-repository'
import type { LearnerQuiz } from '@/features/learning/learner-quiz-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getLearnerCourse: vi.fn(),
  getQuizForLearner: vi.fn(),
  createMediaReadUrl: vi.fn(),
  materialPlayer: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
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
    nextLessonHref?: string | null
  }) => {
    mocks.materialPlayer(props)
    return <div data-testid="material-player">{props.lesson.title}</div>
  },
}))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))

import LearnerCoursePage from './page'

const articleId = '66666666-6666-4666-8666-666666666666'
const videoId = '77777777-7777-4777-8777-777777777777'
const quizLessonId = '88888888-8888-4888-8888-888888888888'

function lesson(overrides: Partial<LearnerLesson> & Pick<LearnerLesson, 'id' | 'title' | 'lessonType' | 'position'>): LearnerLesson {
  return {
    summary: null,
    articleBody: null,
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
    expect(screen.getByRole('heading', { name: course.title })).toBeInTheDocument()
    expect(screen.getByText('1 of 3 materials completed')).toBeInTheDocument()
    expect(screen.getByText('Open navigation is enabled.')).toBeInTheDocument()

    const player = screen.getByRole('region', { name: 'Current lesson' })
    expect(within(player).getByRole('heading', { name: videoLesson.title })).toBeInTheDocument()
    expect(mocks.createMediaReadUrl).toHaveBeenCalledWith(videoLesson.assetPath)
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: videoLesson,
      mediaUrl: 'https://signed.example.com/bridge-readiness.mp4',
      slug: course.slug,
      quiz: null,
      nextLessonHref: `/learn/courses/${course.slug}/learn?lesson=${quizLessonId}`,
    })
    expect(within(player).getByTestId('material-player')).toHaveTextContent(videoLesson.title)
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    expect(within(player).getByRole('link', { name: 'Previous material' })).toHaveAttribute(
      'href',
      `/learn/courses/${course.slug}/learn?lesson=${articleId}`,
    )
  })

  it('renders a selected article without signing media and keeps curriculum navigation intact', async () => {
    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: articleId }),
    }))

    const curriculum = screen.getByRole('navigation', { name: 'Course curriculum' })
    expect(within(curriculum).getByText('Inspection foundations')).toBeInTheDocument()
    expect(within(curriculum).getByText('Operational readiness')).toBeInTheDocument()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: articleLesson,
      mediaUrl: null,
      slug: course.slug,
      quiz: null,
      nextLessonHref: `/learn/courses/${course.slug}/learn?lesson=${videoId}`,
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
      slug: course.slug,
      quiz,
      nextLessonHref: null,
    })
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

    expect(screen.getByText('Sequential learning is enabled.')).toBeInTheDocument()
    expect(screen.getByText(/quiz · locked/i)).toBeInTheDocument()
    expect(mocks.getQuizForLearner).not.toHaveBeenCalled()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.materialPlayer).toHaveBeenCalledWith({
      lesson: lockedQuiz,
      mediaUrl: null,
      slug: course.slug,
      quiz: null,
      nextLessonHref: null,
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