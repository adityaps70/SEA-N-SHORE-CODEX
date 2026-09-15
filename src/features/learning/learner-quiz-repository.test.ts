import { describe, expect, it, vi } from 'vitest'
import { createLearnerQuizRepository } from './learner-quiz-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const lessonId = '44444444-4444-4444-8444-444444444444'
const quizId = '55555555-5555-4555-8555-555555555555'
const questionOneId = '66666666-6666-4666-8666-666666666666'
const questionTwoId = '77777777-7777-4777-8777-777777777777'
const optionOneCorrectId = '88888888-8888-4888-8888-888888888881'
const optionOneWrongId = '88888888-8888-4888-8888-888888888882'
const optionTwoCorrectId = '99999999-9999-4999-8999-999999999991'
const optionTwoWrongId = '99999999-9999-4999-8999-999999999992'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const slug = 'sire-2-readiness-for-tanker-officers'

function accessRow() {
  return [{
    enrollment_id: enrollmentId,
    course_id: courseId,
    lesson_id: lessonId,
    quiz_id: quizId,
    pass_percentage: 70,
    instructions: 'Choose the best answer for each question.',
  }]
}

function questionRows() {
  return [
    { id: questionOneId, prompt: 'What is the first priority before a SIRE 2.0 inspection?', position: 0 },
    { id: questionTwoId, prompt: 'Who owns operational readiness onboard?', position: 1 },
  ]
}

function safeOptionRows() {
  return [
    { id: optionOneCorrectId, question_id: questionOneId, label: 'Verify evidence and actual practice', position: 0 },
    { id: optionOneWrongId, question_id: questionOneId, label: 'Prepare paperwork only', position: 1 },
    { id: optionTwoCorrectId, question_id: questionTwoId, label: 'The whole shipboard team', position: 0 },
    { id: optionTwoWrongId, question_id: questionTwoId, label: 'Only the Master', position: 1 },
  ]
}

function scoringOptionRows() {
  return safeOptionRows().map((option) => ({
    ...option,
    is_correct: option.id === optionOneCorrectId || option.id === optionTwoCorrectId,
  }))
}

describe('learner quiz repository', () => {
  it('returns an accessible ordered quiz without exposing the answer key', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearnerQuizRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.learning_quizzes quiz')) return accessRow()
        if (text.includes('from public.learning_quiz_questions question')) return questionRows()
        if (text.includes('from public.learning_quiz_options option')) return safeOptionRows()
        return []
      },
    })

    await expect(repository.getQuizForLearner(learnerId, slug, lessonId)).resolves.toEqual({
      id: quizId,
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
            { id: optionOneCorrectId, label: 'Verify evidence and actual practice', position: 0 },
            { id: optionOneWrongId, label: 'Prepare paperwork only', position: 1 },
          ],
        },
        {
          id: questionTwoId,
          prompt: 'Who owns operational readiness onboard?',
          position: 1,
          options: [
            { id: optionTwoCorrectId, label: 'The whole shipboard team', position: 0 },
            { id: optionTwoWrongId, label: 'Only the Master', position: 1 },
          ],
        },
      ],
    })

    expect(seen[0]?.values).toEqual([learnerId, slug, lessonId])
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.text).toContain("application.status = 'approved'")
    expect(seen[0]?.text).toContain("enrollment.status in ('active', 'completed')")
    expect(seen[0]?.text).toContain("lesson.lesson_type = 'quiz'")
    expect(seen[2]?.text).not.toContain('is_correct')
    expect(JSON.stringify(await repository.getQuizForLearner(learnerId, slug, lessonId))).not.toContain('isCorrect')
  })

  it('fails closed for a quiz that is not accessible to the learner', async () => {
    const repository = createLearnerQuizRepository({ query: async () => [] })
    await expect(repository.getQuizForLearner(learnerId, slug, lessonId)).resolves.toBeNull()
  })

  it('persists an immutable failed attempt without completing lesson progress', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const completeLesson = vi.fn()
    const repository = createLearnerQuizRepository({
      completeLesson,
      transaction: async (work) => work(async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.learning_quizzes quiz')) return accessRow()
        if (text.includes('from public.learning_quiz_questions question')) return questionRows()
        if (text.includes('from public.learning_quiz_options option')) return scoringOptionRows()
        if (text.includes('insert into public.learning_quiz_attempts')) {
          return [{ id: attemptId, submitted_at: new Date('2026-09-15T10:00:00.000Z') }]
        }
        return []
      }),
    })

    const result = await repository.submitQuizAttempt(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneWrongId },
      { questionId: questionTwoId, optionId: optionTwoCorrectId },
    ])

    expect(result).toMatchObject({
      attemptId,
      score: 1,
      totalQuestions: 2,
      percentage: 50,
      passPercentage: 70,
      passed: false,
      enrollmentCompleted: false,
    })
    expect(result.answers).toEqual([
      { questionId: questionOneId, selectedOptionId: optionOneWrongId, correctOptionId: optionOneCorrectId, isCorrect: false },
      { questionId: questionTwoId, selectedOptionId: optionTwoCorrectId, correctOptionId: optionTwoCorrectId, isCorrect: true },
    ])
    expect(completeLesson).not.toHaveBeenCalled()
    expect(seen.filter(({ text }) => text.includes('insert into public.learning_quiz_attempt_answers'))).toHaveLength(2)
    expect(seen.some(({ text }) => text.includes('update public.learning_quiz_attempts'))).toBe(false)
  })

  it('scores a passing attempt on the server and completes progress in the same transaction', async () => {
    const completeLesson = vi.fn().mockResolvedValue({
      enrollmentId,
      lessonId,
      completedAt: '2026-09-15T10:01:00.000Z',
      totalLessons: 4,
      completedLessons: 4,
      progressPercent: 100,
      enrollmentCompleted: true,
    })
    let transactionQuery: unknown

    const repository = createLearnerQuizRepository({
      completeLesson,
      transaction: async (work) => {
        const query = async (text: string) => {
          if (text.includes('from public.learning_quizzes quiz')) return accessRow()
          if (text.includes('from public.learning_quiz_questions question')) return questionRows()
          if (text.includes('from public.learning_quiz_options option')) return scoringOptionRows()
          if (text.includes('insert into public.learning_quiz_attempts')) {
            return [{ id: attemptId, submitted_at: new Date('2026-09-15T10:00:00.000Z') }]
          }
          return []
        }
        transactionQuery = query
        return work(query)
      },
    })

    const result = await repository.submitQuizAttempt(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneCorrectId },
      { questionId: questionTwoId, optionId: optionTwoCorrectId },
    ])

    expect(result).toMatchObject({ score: 2, totalQuestions: 2, percentage: 100, passed: true, enrollmentCompleted: true })
    expect(completeLesson).toHaveBeenCalledWith(transactionQuery, learnerId, slug, lessonId)
  })

  it('rejects incomplete, duplicate, or cross-question answers before persisting an attempt', async () => {
    const writes: string[] = []
    const repository = createLearnerQuizRepository({
      transaction: async (work) => work(async (text) => {
        if (text.startsWith('insert')) writes.push(text)
        if (text.includes('from public.learning_quizzes quiz')) return accessRow()
        if (text.includes('from public.learning_quiz_questions question')) return questionRows()
        if (text.includes('from public.learning_quiz_options option')) return scoringOptionRows()
        return []
      }),
    })

    await expect(repository.submitQuizAttempt(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneCorrectId },
    ])).rejects.toThrow('quiz_answers_invalid')

    await expect(repository.submitQuizAttempt(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneCorrectId },
      { questionId: questionOneId, optionId: optionOneWrongId },
    ])).rejects.toThrow('quiz_answers_invalid')

    await expect(repository.submitQuizAttempt(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionTwoCorrectId },
      { questionId: questionTwoId, optionId: optionTwoWrongId },
    ])).rejects.toThrow('quiz_answers_invalid')

    expect(writes).toEqual([])
  })

  it('allows a learner to retry after a failed attempt by inserting a new immutable attempt', async () => {
    let attemptNumber = 0
    const attemptIds: string[] = []
    const repository = createLearnerQuizRepository({
      transaction: async (work) => work(async (text) => {
        if (text.includes('from public.learning_quizzes quiz')) return accessRow()
        if (text.includes('from public.learning_quiz_questions question')) return questionRows()
        if (text.includes('from public.learning_quiz_options option')) return scoringOptionRows()
        if (text.includes('insert into public.learning_quiz_attempts')) {
          attemptNumber += 1
          const id = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${attemptNumber}`
          attemptIds.push(id)
          return [{ id, submitted_at: new Date('2026-09-15T10:00:00.000Z') }]
        }
        return []
      }),
    })

    await repository.submitQuizAttempt(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneWrongId },
      { questionId: questionTwoId, optionId: optionTwoWrongId },
    ])
    await repository.submitQuizAttempt(learnerId, slug, lessonId, [
      { questionId: questionOneId, optionId: optionOneWrongId },
      { questionId: questionTwoId, optionId: optionTwoWrongId },
    ])

    expect(attemptIds).toHaveLength(2)
    expect(attemptIds[0]).not.toBe(attemptIds[1])
  })
})