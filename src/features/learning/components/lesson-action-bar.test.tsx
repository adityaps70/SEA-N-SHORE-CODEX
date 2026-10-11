import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ push: vi.fn(), completeLearningLesson: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }))
vi.mock('../learner-progress-actions', () => ({ completeLearningLesson: mocks.completeLearningLesson }))

import { announceLessonCompleted } from '../lesson-completion-events'
import { LessonActionBar } from './lesson-action-bar'

const base = {
  slug: 'sire',
  lessonId: 'lesson-2',
  completionThreshold: 90,
  completed: false,
  available: true,
  previousHref: '/learn/courses/sire/learn?lesson=lesson-1',
  nextHref: '/learn/courses/sire/learn?lesson=lesson-3',
  finishHref: '/learn/my-learning',
}

function bar() {
  return screen.getByRole('navigation', { name: 'Lesson navigation' })
}

describe('LessonActionBar (learning round E, E4)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('has Previous and, for a manual lesson, "Complete & next" that completes and moves on', async () => {
    mocks.completeLearningLesson.mockResolvedValue({ ok: true, enrollmentCompleted: false })
    render(<LessonActionBar {...base} completionRule="manual" />)
    expect(within(bar()).getByRole('link', { name: 'Previous lesson' })).toHaveAttribute('href', base.previousHref)
    fireEvent.click(within(bar()).getByRole('button', { name: /Complete & next/ }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(base.nextHref))
    expect(mocks.completeLearningLesson).toHaveBeenCalledWith('sire', 'lesson-2')
  })

  it('keeps "Complete & next" disabled until the completion rule is met, then unlocks on the completion signal', () => {
    render(<LessonActionBar {...base} completionRule="media_percentage" />)
    expect(within(bar()).getByRole('button', { name: /Complete & next/ })).toBeDisabled()
    expect(screen.getAllByText('Play 90% of this material to continue.').length).toBeGreaterThan(0)
    act(() => announceLessonCompleted('other-lesson'))
    expect(within(bar()).getByRole('button', { name: /Complete & next/ })).toBeDisabled()
    act(() => announceLessonCompleted('lesson-2'))
    expect(within(bar()).getByRole('link', { name: /Next lesson/ })).toHaveAttribute('href', base.nextHref)
  })

  it('names what is still needed for quizzes and assignments', () => {
    const { unmount } = render(<LessonActionBar {...base} completionRule="quiz_pass" />)
    expect(screen.getAllByText('Pass the quiz to continue.').length).toBeGreaterThan(0)
    unmount()
    render(<LessonActionBar {...base} completionRule="assignment_submit" />)
    expect(screen.getAllByText('Submit the assignment to continue.').length).toBeGreaterThan(0)
  })

  it('offers "Next lesson" for a completed lesson and "Back to My Learning" at the end of the course', () => {
    const { unmount } = render(<LessonActionBar {...base} completionRule="quiz_pass" completed />)
    expect(within(bar()).getByRole('link', { name: /Next lesson/ })).toHaveAttribute('href', base.nextHref)
    unmount()
    render(<LessonActionBar {...base} completionRule="quiz_pass" completed nextHref={null} />)
    expect(within(bar()).getByRole('link', { name: 'Back to My Learning' })).toHaveAttribute('href', '/learn/my-learning')
  })

  it('shows the error and stays put when completing fails', async () => {
    mocks.completeLearningLesson.mockResolvedValue({ ok: false, error: 'This lesson cannot be completed yet.' })
    render(<LessonActionBar {...base} completionRule="manual" />)
    fireEvent.click(within(bar()).getByRole('button', { name: /Complete & next/ }))
    expect(await screen.findByText('This lesson cannot be completed yet.')).toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
