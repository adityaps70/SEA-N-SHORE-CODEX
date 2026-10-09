import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerQuiz, LearnerQuizSession } from '../learner-quiz-repository'

const mocks = vi.hoisted(() => ({
  submitLearningQuiz: vi.fn(),
  startLearningQuiz: vi.fn(),
  saveLearningQuizAnswers: vi.fn(),
}))

vi.mock('../learner-quiz-actions', () => ({
  submitLearningQuiz: mocks.submitLearningQuiz,
  startLearningQuiz: mocks.startLearningQuiz,
  saveLearningQuizAnswers: mocks.saveLearningQuizAnswers,
}))

import { QuizLessonActivity, countdownLabel } from './quiz-lesson-activity'

const slug = 'fixture-course'
const lessonId = '44444444-4444-4444-8444-444444444444'
const multiId = '66666666-6666-4666-8666-666666666661'
const fillId = '66666666-6666-4666-8666-666666666662'
const writtenId = '66666666-6666-4666-8666-666666666663'
const optionA = '88888888-8888-4888-8888-888888888881'
const optionB = '88888888-8888-4888-8888-888888888882'

const baseQuiz: LearnerQuiz = {
  id: '55555555-5555-4555-8555-555555555555',
  lessonId,
  passPercentage: 70,
  instructions: null,
  maxAttempts: 3,
  attemptsUsed: 0,
  questions: [
    { id: multiId, prompt: 'Which are mooring checks?', position: 0, type: 'multiple_choice', marks: 2, options: [{ id: optionA, label: 'Brake test', position: 0 }, { id: optionB, label: 'Line condition', position: 1 }] },
    { id: fillId, prompt: 'The record book is the ____.', position: 1, type: 'fill_blank', marks: 1, options: [] },
    { id: writtenId, prompt: 'Describe your handover.', position: 2, type: 'subjective', marks: 4, options: [] },
  ],
  settings: { timeLimitMinutes: null, shuffleQuestions: false, shuffleOptions: false, drawCount: null, answerPolicy: 'after_each_attempt' },
  usesSessions: false,
  questionCount: 3,
  session: null,
  awaitingGrading: false,
}

const result = {
  ok: true,
  attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  attemptNumber: 1,
  submittedAt: '2026-10-09T10:00:00.000Z',
  score: 1,
  totalQuestions: 3,
  percentage: 43,
  passPercentage: 70,
  passed: false,
  enrollmentCompleted: false,
  completedLessons: null,
  totalLessons: null,
  progressPercent: null,
  answers: [],
  scorePoints: 3,
  maxPoints: 7,
  awaitingGrading: true,
}

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('QuizLessonActivity (round B)', () => {
  it('answers every question type and sends only the field each type uses; a written answer waits for grading', async () => {
    mocks.submitLearningQuiz.mockResolvedValueOnce(result)
    render(<QuizLessonActivity quiz={baseQuiz} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

    expect(screen.getByText('Select every correct answer.')).toBeInTheDocument()
    expect(screen.getByText('2 marks')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Brake test'))
    fireEvent.click(screen.getByLabelText('Line condition'))
    fireEvent.change(screen.getByLabelText('Answer to question 2'), { target: { value: 'Oil Record Book' } })
    expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Answer to question 3'), { target: { value: 'I brief the relieving officer.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

    await waitFor(() => expect(mocks.submitLearningQuiz).toHaveBeenCalledOnce())
    expect(mocks.submitLearningQuiz.mock.calls[0]?.[2]).toEqual([
      { questionId: multiId, optionIds: [optionA, optionB] },
      { questionId: fillId, text: 'Oil Record Book' },
      { questionId: writtenId, text: 'I brief the relieving officer.' },
    ])
    expect(await screen.findByRole('heading', { name: 'Submitted' })).toBeInTheDocument()
    // The notice, and the attempt in the history.
    expect(screen.getAllByText('Awaiting grading')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
  })

  it('opens on "Awaiting grading" (not the questions) while the last attempt waits for the trainer', () => {
    render(<QuizLessonActivity quiz={{ ...baseQuiz, awaitingGrading: true }} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)
    expect(screen.getByText('Awaiting grading')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit quiz' })).not.toBeInTheDocument()
  })

  it('starts a timed attempt on the server, shows the server countdown and saves answers as the learner goes', async () => {
    const session: LearnerQuizSession = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      startedAt: '2026-10-09T10:00:00.000Z',
      deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      serverNow: new Date().toISOString(),
      questions: [baseQuiz.questions[0]!],
      answers: {},
    }
    mocks.startLearningQuiz.mockResolvedValueOnce({ ok: true, session })
    mocks.saveLearningQuizAnswers.mockResolvedValue({ ok: true, savedAt: new Date().toISOString() })
    const timed: LearnerQuiz = { ...baseQuiz, questions: [], usesSessions: true, questionCount: 1, settings: { ...baseQuiz.settings!, timeLimitMinutes: 10, drawCount: 1 } }
    render(<QuizLessonActivity quiz={timed} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

    expect(screen.getByText('10 min time limit')).toBeInTheDocument()
    expect(screen.queryByLabelText('Brake test')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }))
    expect(await screen.findByRole('timer', { name: 'Time left' })).toHaveTextContent(/(10:00|9:5\d) left/)
    fireEvent.click(screen.getByLabelText('Brake test'))
    await waitFor(() => expect(mocks.saveLearningQuizAnswers).toHaveBeenCalledWith(slug, lessonId, session.id, [{ questionId: multiId, optionIds: [optionA] }]), { timeout: 4000 })
    expect(await screen.findByText(/Answers saved/)).toBeInTheDocument()
  })

  it('formats the countdown', () => {
    expect(countdownLabel(65_000)).toBe('1:05')
    expect(countdownLabel(3_725_000)).toBe('1:02:05')
    expect(countdownLabel(-5)).toBe('0:00')
  })
})
