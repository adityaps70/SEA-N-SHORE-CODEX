import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  it('keeps submission disabled until every question has one answer and sends only ids plus a retry-safe key', async () => {
    mocks.submitLearningQuiz.mockResolvedValueOnce({
      ok: true,
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attemptNumber: 1,
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

    const heard: string[] = []
    window.addEventListener('sea-n-shore:lesson-completed', (event) => heard.push((event as CustomEvent<{ lessonId: string }>).detail.lessonId), { once: true })
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

    await waitFor(() => expect(mocks.submitLearningQuiz).toHaveBeenCalledOnce())
    const call = mocks.submitLearningQuiz.mock.calls[0]
    expect(call?.slice(0, 3)).toEqual([
      slug,
      lessonId,
      [
        { questionId: questionOneId, optionId: questionOneCorrectId },
        { questionId: questionTwoId, optionId: questionTwoCorrectId },
      ],
    ])
    expect(call?.[3]).toMatch(uuidPattern)
    expect(await screen.findByText('Assessment passed')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    // Round E: moving on lives in the player's one bottom bar, which this pass unlocks at once.
    expect(heard).toEqual([lessonId])
    expect(screen.queryByRole('link', { name: 'Continue to next lesson' })).not.toBeInTheDocument()
    // Round 14 (3.9): the action revalidates, which already re-renders the route.
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('shows failed scoring feedback, reveals correct answers only after submission, and supports a clean retry', async () => {
    mocks.submitLearningQuiz.mockResolvedValueOnce({
      ok: true,
      attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      attemptNumber: 1,
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
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Submit quiz' })).not.toBeInTheDocument()
    expect(mocks.submitLearningQuiz).not.toHaveBeenCalled()
  })

  describe('attempt limits', () => {
    function failedResult(attemptNumber: number) {
      return {
        ok: true,
        attemptId: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${attemptNumber}`,
        attemptNumber,
        submittedAt: '2026-10-08T09:00:00.000Z',
        score: 0,
        totalQuestions: 2,
        percentage: 0,
        passPercentage: 70,
        passed: false,
        enrollmentCompleted: false,
        completedLessons: null,
        totalLessons: null,
        progressPercent: null,
        answers: [
          { questionId: questionOneId, selectedOptionId: questionOneWrongId, correctOptionId: questionOneCorrectId, isCorrect: false },
          { questionId: questionTwoId, selectedOptionId: questionTwoWrongId, correctOptionId: questionTwoCorrectId, isCorrect: false },
        ],
      }
    }

    async function answerAndSubmit() {
      fireEvent.click(screen.getByLabelText('Prepare paperwork only'))
      fireEvent.click(screen.getByLabelText('Only the Master'))
      fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))
      await screen.findByText('Not passed yet')
    }

    it('shows “Attempts left: N” and hides “Try again” once the last attempt is used', async () => {
      mocks.submitLearningQuiz.mockResolvedValueOnce(failedResult(2))
      render(<QuizLessonActivity quiz={{ ...quiz, maxAttempts: 2, attemptsUsed: 1 }} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

      expect(screen.getByText('Attempts left: 1')).toBeInTheDocument()
      await answerAndSubmit()

      expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
      expect(screen.getByText('You’ve used all 2 attempts for this quiz.')).toBeInTheDocument()
    })

    it('offers “Try again” with the attempts left while some remain', async () => {
      mocks.submitLearningQuiz.mockResolvedValueOnce(failedResult(1))
      render(<QuizLessonActivity quiz={{ ...quiz, maxAttempts: 3, attemptsUsed: 0 }} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

      expect(screen.getByText('Attempts left: 3')).toBeInTheDocument()
      await answerAndSubmit()

      expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
      expect(screen.getByText('Attempts left: 2')).toBeInTheDocument()
    })

    it('opens on the limit message, not the questions, when every attempt was used before', () => {
      render(<QuizLessonActivity quiz={{ ...quiz, maxAttempts: 3, attemptsUsed: 3 }} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

      expect(screen.getByText('You’ve used all 3 attempts for this quiz.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Submit quiz' })).not.toBeInTheDocument()
    })

    it('says “Unlimited attempts” when the trainer set no limit, and always offers another try', async () => {
      mocks.submitLearningQuiz.mockResolvedValueOnce(failedResult(7))
      render(<QuizLessonActivity quiz={{ ...quiz, maxAttempts: null, attemptsUsed: 6 }} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

      expect(screen.getByText('Unlimited attempts')).toBeInTheDocument()
      await answerAndSubmit()

      expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
      expect(screen.getAllByText('Unlimited attempts').length).toBeGreaterThan(0)
    })

    it('switches to the limit message (not a generic error) when the server reports the limit', async () => {
      mocks.submitLearningQuiz.mockResolvedValueOnce({ ok: false, error: 'You have used all your attempts for this quiz, so this answer was not submitted.', limitReached: true })
      render(<QuizLessonActivity quiz={{ ...quiz, maxAttempts: 2, attemptsUsed: 1 }} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

      fireEvent.click(screen.getByLabelText('Prepare paperwork only'))
      fireEvent.click(screen.getByLabelText('Only the Master'))
      fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))

      expect(await screen.findByText('You’ve used all 2 attempts for this quiz.')).toBeInTheDocument()
      expect(screen.queryByText(/Please try again/)).not.toBeInTheDocument()
    })
  })

  describe('learning round E (E6): navigator, flags and the check before submitting', () => {
    it('shows one question at a time with "Question N of M" and a navigator that jumps between them', () => {
      render(<QuizLessonActivity quiz={quiz} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

      const navigator = screen.getByRole('navigation', { name: 'Questions' })
      expect(within(navigator).getByRole('button', { name: 'Question 1, unanswered' })).toHaveAttribute('aria-current', 'step')
      expect(screen.getByRole('group', { name: 'Question 1 of 2' })).toBeVisible()
      expect(screen.queryByRole('group', { name: 'Question 2 of 2' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('Verify evidence and actual practice'))
      expect(within(navigator).getByRole('button', { name: 'Question 1, answered' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Next question/ }))
      expect(screen.getByRole('group', { name: 'Question 2 of 2' })).toBeInTheDocument()
      expect(within(navigator).getByRole('button', { name: 'Question 2, unanswered' })).toHaveAttribute('aria-current', 'step')
      expect(screen.getByText('Answer every question to submit. Still to answer: 2.')).toBeInTheDocument()

      fireEvent.click(within(navigator).getByRole('button', { name: 'Question 1, answered' }))
      expect(screen.getByRole('group', { name: 'Question 1 of 2' })).toBeInTheDocument()
    })

    it('flags a question for review and checks flagged questions before submitting', async () => {
      mocks.submitLearningQuiz.mockResolvedValueOnce({
        ok: true, attemptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', attemptNumber: 1, submittedAt: '2026-09-15T10:00:00.000Z',
        score: 2, totalQuestions: 2, percentage: 100, passPercentage: 70, passed: true, enrollmentCompleted: false,
        completedLessons: null, totalLessons: null, progressPercent: null, answers: [],
      })
      render(<QuizLessonActivity quiz={quiz} slug={slug} lessonId={lessonId} initiallyCompleted={false} />)

      fireEvent.click(screen.getByLabelText('Verify evidence and actual practice'))
      fireEvent.click(screen.getByRole('button', { name: 'Flag for review' }))
      expect(screen.getByRole('button', { name: 'Flagged' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Question 1, answered, flagged' })).toBeInTheDocument()
      fireEvent.click(screen.getByLabelText('The whole shipboard team'))

      fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }))
      const check = screen.getByRole('region', { name: 'Before you submit' })
      expect(check).toHaveTextContent('You flagged Question 1 for review.')
      expect(mocks.submitLearningQuiz).not.toHaveBeenCalled()

      fireEvent.click(within(check).getByRole('button', { name: 'Submit now' }))
      await waitFor(() => expect(mocks.submitLearningQuiz).toHaveBeenCalledOnce())
      expect(await screen.findByRole('region', { name: 'Quiz result' })).toHaveFocus()
    })

    it('shows attempt times in the learner’s own time zone, with the zone named', () => {
      const original = Intl.DateTimeFormat.prototype.resolvedOptions
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...original.call(this), timeZone: 'Asia/Kolkata' }
      })
      try {
        render(
          <QuizLessonActivity
            quiz={{ ...quiz, attemptsUsed: 1, attemptHistory: [{ attemptId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', attemptNumber: 1, submittedAt: '2026-09-14T19:04:00.000Z', score: 1, totalQuestions: 2, percentage: 50, passPercentage: 70, passed: false }] }}
            slug={slug}
            lessonId={lessonId}
            initiallyCompleted={false}
          />,
        )
        expect(screen.getByText(/Tue 15 Sept? 2026, 00:34 IST \(Asia\/Kolkata\)/)).toBeInTheDocument()
        expect(screen.queryByText('Times shown in UTC')).not.toBeInTheDocument()
      } finally {
        vi.restoreAllMocks()
      }
    })
  })
})