import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completeLearningLesson: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

vi.mock('../learner-progress-actions', () => ({
  completeLearningLesson: mocks.completeLearningLesson,
}))

import { LessonCompletionControl } from './lesson-completion-control'

const slug = 'sire-2-readiness'
const lessonId = '11111111-1111-4111-8111-111111111111'
const nextLessonHref = '/learn/courses/sire-2-readiness/learn?lesson=22222222-2222-4222-8222-222222222222'

describe('LessonCompletionControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.completeLearningLesson.mockResolvedValue({
      ok: true,
      lessonId,
      completedLessons: 2,
      totalLessons: 3,
      progressPercent: 67,
      enrollmentCompleted: false,
    })
  })

  afterEach(() => cleanup())

  it('marks the exact learner lesson complete once and advances to the persisted next lesson', async () => {
    render(
      <LessonCompletionControl
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted={false}
        nextLessonHref={nextLessonHref}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))

    await waitFor(() => expect(mocks.completeLearningLesson).toHaveBeenCalledWith(slug, lessonId))
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument()
    expect(mocks.push).toHaveBeenCalledWith(nextLessonHref)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('refreshes the native player after the final lesson completes the enrollment', async () => {
    mocks.completeLearningLesson.mockResolvedValueOnce({
      ok: true,
      lessonId,
      completedLessons: 3,
      totalLessons: 3,
      progressPercent: 100,
      enrollmentCompleted: true,
    })

    render(
      <LessonCompletionControl
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted={false}
        nextLessonHref={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.push).not.toHaveBeenCalled()
    expect(await screen.findByText('Completed')).toBeInTheDocument()
  })

  it('renders persisted completed state without offering a duplicate completion action', () => {
    render(
      <LessonCompletionControl
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted
        nextLessonHref={nextLessonHref}
      />,
    )

    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument()
    expect(mocks.completeLearningLesson).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('shows the safe server-action error and restores the completion action', async () => {
    mocks.completeLearningLesson.mockResolvedValueOnce({
      ok: false,
      error: 'This lesson is not available in your learning enrollment.',
    })
    render(
      <LessonCompletionControl
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted={false}
        nextLessonHref={nextLessonHref}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))

    expect(await screen.findByText('This lesson is not available in your learning enrollment.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
