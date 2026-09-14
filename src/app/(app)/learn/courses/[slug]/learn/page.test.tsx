import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerCourse } from '@/features/learning/learner-course-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getLearnerCourse: vi.fn(),
  createMediaReadUrl: vi.fn(),
  lessonCompletionControl: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/learner-course-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/learner-course-repository')>()
  return {
    ...original,
    learnerCourseRepository: {
      getLearnerCourse: mocks.getLearnerCourse,
    },
  }
})
vi.mock('@/features/learning/components/lesson-completion-control', () => ({
  LessonCompletionControl: (props: { slug: string; lessonId: string; initiallyCompleted: boolean }) => {
    mocks.lessonCompletionControl(props)
    return <div data-testid="lesson-completion-control">Lesson completion control</div>
  },
}))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))

import LearnerCoursePage from './page'

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
  mentorName: 'Capt. Maya Singh',
  totalLessons: 3,
  completedLessons: 1,
  progressPercent: 33,
  sections: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Inspection foundations',
      position: 0,
      lessons: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          title: 'How SIRE 2.0 changes readiness',
          lessonType: 'article',
          position: 0,
          summary: 'Understand the inspection model before going deeper.',
          articleBody: 'SIRE 2.0 uses a risk-based inspection framework.',
          assetPath: null,
          externalUrl: null,
          durationSeconds: null,
          isDownloadable: false,
          completed: true,
          completedAt: '2026-09-15T08:30:00.000Z',
          lastPositionSeconds: 0,
        },
        {
          id: '77777777-7777-4777-8777-777777777777',
          title: 'Bridge readiness walkthrough',
          lessonType: 'video',
          position: 1,
          summary: 'Walk through the bridge evidence expected before inspection.',
          articleBody: null,
          assetPath: 'learning/courses/sire-2/bridge-readiness.mp4',
          externalUrl: null,
          durationSeconds: 780,
          isDownloadable: false,
          completed: false,
          completedAt: null,
          lastPositionSeconds: 125,
        },
      ],
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Operational readiness',
      position: 1,
      lessons: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          title: 'Readiness knowledge check',
          lessonType: 'quiz',
          position: 0,
          summary: 'Check your understanding of the readiness principles.',
          articleBody: null,
          assetPath: null,
          externalUrl: null,
          durationSeconds: null,
          isDownloadable: false,
          completed: false,
          completedAt: null,
          lastPositionSeconds: 0,
        },
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
    mocks.createMediaReadUrl.mockResolvedValue('https://signed.example.com/bridge-readiness.mp4')
  })

  it('loads only the authenticated learners persisted course and defaults to the first incomplete lesson', async () => {
    const { container } = render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({}),
    }))

    expect(mocks.requireAwsUser).toHaveBeenCalledOnce()
    expect(mocks.getLearnerCourse).toHaveBeenCalledWith('learner-1', course.slug)
    expect(screen.getByRole('heading', { name: course.title })).toBeInTheDocument()
    expect(screen.getByText('1 of 3 lessons completed')).toBeInTheDocument()
    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: `${course.title} progress` })).toHaveAttribute('aria-valuenow', '33')

    const player = screen.getByRole('region', { name: 'Current lesson' })
    expect(within(player).getByRole('heading', { name: 'Bridge readiness walkthrough' })).toBeInTheDocument()
    expect(within(player).getByText('Walk through the bridge evidence expected before inspection.')).toBeInTheDocument()
    expect(mocks.createMediaReadUrl).toHaveBeenCalledWith('learning/courses/sire-2/bridge-readiness.mp4')
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://signed.example.com/bridge-readiness.mp4')
    expect(container.innerHTML).not.toContain('learning/courses/sire-2/bridge-readiness.mp4')
    expect(mocks.lessonCompletionControl).toHaveBeenCalledWith({
      slug: course.slug,
      lessonId: '77777777-7777-4777-8777-777777777777',
      initiallyCompleted: false,
    })
    expect(within(player).getByTestId('lesson-completion-control')).toBeInTheDocument()
  })

  it('renders persisted curriculum navigation and an explicitly selected completed article lesson without signing media', async () => {
    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: '66666666-6666-4666-8666-666666666666' }),
    }))

    const curriculum = screen.getByRole('navigation', { name: 'Course curriculum' })
    expect(within(curriculum).getByText('Inspection foundations')).toBeInTheDocument()
    expect(within(curriculum).getByText('Operational readiness')).toBeInTheDocument()
    expect(within(curriculum).getByRole('link', { name: /How SIRE 2\.0 changes readiness/ })).toHaveAttribute(
      'href',
      `/learn/courses/${course.slug}/learn?lesson=66666666-6666-4666-8666-666666666666`,
    )
    expect(within(curriculum).getByRole('link', { name: /Bridge readiness walkthrough/ })).toHaveAttribute(
      'href',
      `/learn/courses/${course.slug}/learn?lesson=77777777-7777-4777-8777-777777777777`,
    )

    const player = screen.getByRole('region', { name: 'Current lesson' })
    expect(within(player).getByRole('heading', { name: 'How SIRE 2.0 changes readiness' })).toBeInTheDocument()
    expect(within(player).getByText('SIRE 2.0 uses a risk-based inspection framework.')).toBeInTheDocument()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.lessonCompletionControl).toHaveBeenCalledWith({
      slug: course.slug,
      lessonId: '66666666-6666-4666-8666-666666666666',
      initiallyCompleted: true,
    })
  })

  it('shows an honest not-connected state for persisted activity types whose native engine is not built without allowing manual completion', async () => {
    render(await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: '88888888-8888-4888-8888-888888888888' }),
    }))

    const player = screen.getByRole('region', { name: 'Current lesson' })
    expect(within(player).getByRole('heading', { name: 'Readiness knowledge check' })).toBeInTheDocument()
    expect(within(player).getByText(/native quiz player is not connected yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/question 1/i)).not.toBeInTheDocument()
    expect(mocks.lessonCompletionControl).not.toHaveBeenCalled()
    expect(within(player).queryByTestId('lesson-completion-control')).not.toBeInTheDocument()
  })

  it('fails closed when the learner cannot access the published course', async () => {
    mocks.getLearnerCourse.mockResolvedValueOnce(null)

    await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({}),
    })

    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.lessonCompletionControl).not.toHaveBeenCalled()
  })

  it('fails closed when a requested lesson id is not part of the persisted enrolled curriculum', async () => {
    await LearnerCoursePage({
      params: Promise.resolve({ slug: course.slug }),
      searchParams: Promise.resolve({ lesson: '99999999-9999-4999-8999-999999999999' }),
    })

    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.createMediaReadUrl).not.toHaveBeenCalled()
    expect(mocks.lessonCompletionControl).not.toHaveBeenCalled()
  })
})
