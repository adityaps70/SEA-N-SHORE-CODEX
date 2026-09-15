import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerQuiz } from '../learner-quiz-repository'

const mocks = vi.hoisted(() => ({
  submitLearningQuiz: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../learner-quiz-actions', () => ({
  submitLearningQuiz: mocks.submitLearningQuiz,
}))

import { QuizLessonActivity } from './quiz-lesson-activity'

const slug = 'sire-2-readiness'
const lessonId = '44444444-4444-4444-8444-444444444444'
const questionOneId = '66666666-6666-4666-8666-666666666666'
const questionTwoId = '77777777-7777-4777-8777-777777777777'
const questionOneCorrectId = '88888888-8888-4888-8888-888888888881'
const questionOneWrongId = '88888888-8888-4888-8888-888888888882'
const questionTwoCorrectId = '99999999-9999-4999-8999-999999999991'
const questionTwoWrongId = '99999999-9999-4999-8999-999999999992'
const nextLessonHref = '/learn/courses/sire-2-readiness/learn?lesson=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const quiz: LearnerQuiz = {
  id: '55555555-5555-4555-8555-555555555555',
  lessonId,
  passPercentage: 70,
  instructions: 'Choose the best answer for each question.',
  maxAttempts: null,
  attemptsUsed: 0,
  questions: [
    {
      id: questionOneId,
      prompt: 'What is the first priority before a SIRE 2.0 inspection?',
      position: 0,
      options: [
        { id: questionOneCorrectId, label: 'Verify evidence and actual practice', position: 0 },
        { id: questionOneWrongId, label: 'Prepare paperwork only', position: 1 },
      ],
    },
    {
      id: questionTwoId,
      prompt: 'Who owns operational readiness onboard?',
      position: 1,
      options: [
        { id: questionTwoCorrectId, label: 'The whole shipboard team', position: 0 },
        { id: questionTwoWrongId, label: 'Only the Master', position: 1 },
      ],
    },
  ],
}

describe('QuizLessonActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => cleanup())

  it('keeps submission disabled until every question has one answer and sends only ids', async () => {
    mocks.submitLearningQuiz.mockResolvedValueOnce({
      ok: true,
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      submittedAt: '2026-09-15T10:00:00.000Z',
      score: 2,
      totalQuestions: 2,
      percentage: 100,
      passPercentage: 70,
      passed: true,
      enrollmentCompleted: false,
      completedLessons: 2,
      totalLessons: 3,
      progressPercent: 67,
      answers: [
        { questionId: questionOneId, selectedOptionId: questionOneCorrectId, correctOptionId: questionOneCorrectId, isCorrect: true },
        { questionId: questionTwoId, selectedOptionId: questionTwoCorrectId, correctOptionId: questionTwoCorrectId, isCorrect: true },
      ],
    })

    render(
      <QuizLessonActivity
        quiz={quiz}
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted={false}
        nextLessonHref={nextLessonHref}
      />,
    )

    expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Verify evidence and actual practice'))
    expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('The whole shipboard team'))
    expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    await waitFor(() => expect(mocks.submitLearningQuiz).toHaveBeenCalledWith(slug, lessonId, [
      { questionId: questionOneId, optionId: questionOneCorrectId },
      { questionId: questionTwoId, optionId: questionTwoCorrectId },
    ]))
    expect(await screen.findByText('Assessment passed')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue to next lesson' })).toHaveAttribute('href', nextLessonHref)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('shows failed scoring feedback, reveals correct answers only after submission, and supports a clean retry', async () => {
    mocks.submitLearningQuiz.mockResolvedValueOnce({
      ok: true,
      attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      submittedAt: '2026-09-15T10:00:00.000Z',
      score: 1,
      totalQuestions: 2,
      percentage: 50,
      passPercentage: 70,
      passed: false,
      enrollmentCompleted: false,
      completedLessons: null,
      totalLessons: null,
      progressPercent: null,
      answers: [
        { questionId: questionOneId, selectedOptionId: questionOneWrongId, correctOptionId: questionOneCorrectId, isCorrect: false },
        { questionId: questionTwoId, selectedOptionId: questionTwoCorrectId, correctOptionId: questionTwoCorrectId, isCorrect: true },
      ],
    })

    render(
      <QuizLessonActivity
        quiz={quiz}
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted={false}
        nextLessonHref={nextLessonHref}
      />,
    )

    expect(screen.queryByText(/Correct answer:/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Prepare paperwork only'))
    fireEvent.click(screen.getByLabelText('The whole shipboard team'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    expect(await screen.findByText('Not passed yet')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Pass mark 70%')).toBeInTheDocument()
    expect(screen.getByText('Correct answer: Verify evidence and actual practice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue to next lesson' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.queryByText('Not passed yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeDisabled()
    expect(screen.getByLabelText('Prepare paperwork only')).not.toBeChecked()
    expect(screen.getByLabelText('The whole shipboard team')).not.toBeChecked()
  })

  it('shows safe action errors without inventing a score or marking the quiz complete', async () => {
    mocks.submitLearningQuiz.mockResolvedValueOnce({
      ok: false,
      error: 'This quiz is not available in your learning enrollment.',
    })

    render(
      <QuizLessonActivity
        quiz={quiz}
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted={false}
        nextLessonHref={nextLessonHref}
      />,
    )

    fireEvent.click(screen.getByLabelText('Verify evidence and actual practice'))
    fireEvent.click(screen.getByLabelText('The whole shipboard team'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    expect(await screen.findByText('This quiz is not available in your learning enrollment.')).toBeInTheDocument()
    expect(screen.queryByText('Assessment passed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeEnabled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('renders a persisted completed quiz as passed without offering a duplicate attempt', () => {
    render(
      <QuizLessonActivity
        quiz={quiz}
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted
        nextLessonHref={nextLessonHref}
      />,
    )

    expect(screen.getByText('Assessment passed')).toBeInTheDocument()
    expect(screen.getByText('This quiz lesson is already complete.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue to next lesson' })).toHaveAttribute('href', nextLessonHref)
    expect(screen.queryByRole('button', { name: 'Submit quiz' })).not.toBeInTheDocument()
    expect(mocks.submitLearningQuiz).not.toHaveBeenCalled()
  })
})