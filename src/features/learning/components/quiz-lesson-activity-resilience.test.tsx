import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submitLearningQuiz: vi.fn(),
}))

vi.mock('../learner-quiz-actions', () => ({
  submitLearningQuiz: mocks.submitLearningQuiz,
}))

import { QuizLessonActivity } from './quiz-lesson-activity'

const slug = 'sire-2-readiness-for-tanker-officers'
const lessonId = '44444444-4444-4444-8444-444444444444'
const questionOneId = '66666666-6666-4666-8666-666666666666'
const questionTwoId = '77777777-7777-4777-8777-777777777777'
const optionOneId = '88888888-8888-4888-8888-888888888881'
const optionOneWrongId = '88888888-8888-4888-8888-888888888882'
const optionTwoId = '99999999-9999-4999-8999-999999999991'
const optionTwoWrongId = '99999999-9999-4999-8999-999999999992'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const quiz = {
  id: '55555555-5555-4555-8555-555555555555',
  lessonId,
  passPercentage: 70,
  instructions: 'Choose the best answer.',
  maxAttempts: 3,
  attemptsUsed: 0,
  questions: [
    {
      id: questionOneId,
      prompt: 'What is the first priority?',
      position: 0,
      options: [
        { id: optionOneId, label: 'Verify evidence and practice', position: 0 },
        { id: optionOneWrongId, label: 'Paperwork only', position: 1 },
      ],
    },
    {
      id: questionTwoId,
      prompt: 'Who owns readiness?',
      position: 1,
      options: [
        { id: optionTwoId, label: 'The whole shipboard team', position: 0 },
        { id: optionTwoWrongId, label: 'Only the Master', position: 1 },
      ],
    },
  ],
}

function answerQuiz() {
  fireEvent.click(screen.getByLabelText('Verify evidence and practice'))
  fireEvent.click(screen.getByLabelText('The whole shipboard team'))
}

function attemptResult(attemptNumber: number, passed: boolean) {
  return {
    ok: true as const,
    attemptId: `${attemptNumber}`.repeat(8) + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.slice(8),
    attemptNumber,
    submittedAt: `2026-09-${14 + attemptNumber}T10:00:00.000Z`,
    score: passed ? 2 : 1,
    totalQuestions: 2,
    percentage: passed ? 100 : 50,
    passPercentage: 70,
    passed,
    enrollmentCompleted: false,
    completedLessons: passed ? 3 : null,
    totalLessons: passed ? 4 : null,
    progressPercent: passed ? 75 : null,
    answers: [
      {
        questionId: questionOneId,
        selectedOptionId: passed ? optionOneId : optionOneWrongId,
        correctOptionId: optionOneId,
        isCorrect: passed,
      },
      {
        questionId: questionTwoId,
        selectedOptionId: optionTwoId,
        correctOptionId: optionTwoId,
        isCorrect: true,
      },
    ],
  }
}

describe('QuizLessonActivity resilience', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reuses one submission UUID after a transient action error so a network retry cannot consume another attempt', async () => {
    mocks.submitLearningQuiz
      .mockResolvedValueOnce({ ok: false, error: 'We could not submit this quiz. Please try again.' })
      .mockResolvedValueOnce(attemptResult(1, true))

    render(<QuizLessonActivity slug={slug} lessonId={lessonId} quiz={quiz} initiallyCompleted={false} />)
    answerQuiz()
    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    expect(await screen.findByText('We could not submit this quiz. Please try again.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    await screen.findByText('Assessment passed')
    expect(mocks.submitLearningQuiz).toHaveBeenCalledTimes(2)
    const firstKey = mocks.submitLearningQuiz.mock.calls[0]?.[3]
    const secondKey = mocks.submitLearningQuiz.mock.calls[1]?.[3]
    expect(firstKey).toMatch(uuidPattern)
    expect(secondKey).toBe(firstKey)
  })

  it('starts a fresh submission UUID only after a persisted failed attempt and explicit learner retry', async () => {
    mocks.submitLearningQuiz
      .mockResolvedValueOnce(attemptResult(1, false))
      .mockResolvedValueOnce(attemptResult(2, true))

    render(<QuizLessonActivity slug={slug} lessonId={lessonId} quiz={quiz} initiallyCompleted={false} />)
    answerQuiz()
    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    expect(await screen.findByText('Attempt not passed')).toBeInTheDocument()
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    answerQuiz()
    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    await screen.findByText('Assessment passed')
    expect(screen.getByText('Attempt 2')).toBeInTheDocument()
    const firstKey = mocks.submitLearningQuiz.mock.calls[0]?.[3]
    const secondKey = mocks.submitLearningQuiz.mock.calls[1]?.[3]
    expect(firstKey).toMatch(uuidPattern)
    expect(secondKey).toMatch(uuidPattern)
    expect(secondKey).not.toBe(firstKey)
  })

  it('renders learner-scoped immutable attempt history supplied by the repository', async () => {
    render(
      <QuizLessonActivity
        slug={slug}
        lessonId={lessonId}
        initiallyCompleted={false}
        quiz={{
          ...quiz,
          attemptsUsed: 2,
          attemptHistory: [
            {
              attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              attemptNumber: 2,
              submittedAt: '2026-09-16T09:00:00.000Z',
              score: 2,
              totalQuestions: 2,
              percentage: 100,
              passPercentage: 70,
              passed: true,
            },
            {
              attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              attemptNumber: 1,
              submittedAt: '2026-09-15T09:00:00.000Z',
              score: 1,
              totalQuestions: 2,
              percentage: 50,
              passPercentage: 70,
              passed: false,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Attempt history')).toBeInTheDocument()
    expect(screen.getByText('Attempt 2')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Passed')).toBeInTheDocument()
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('Not passed')).toBeInTheDocument()
    await waitFor(() => expect(mocks.submitLearningQuiz).not.toHaveBeenCalled())
  })
})
