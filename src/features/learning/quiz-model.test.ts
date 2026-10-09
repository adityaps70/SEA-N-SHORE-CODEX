import { describe, expect, it } from 'vitest'
import { attemptTotals, mayRevealAnswers, normaliseFillAnswer, scoreAnswer, shuffled, type ScoringQuestion } from './quiz-model'
import { parseCsv, readQuestionCsv, questionCsvTemplate } from './quiz-csv'
import { questionInputSchema } from './quiz-question-schema'

const single: ScoringQuestion = {
  id: 'q1', type: 'single_choice', marks: 2, negativeMarks: 0.5, acceptedAnswers: [], caseSensitive: false,
  options: [{ id: 'a', isCorrect: true }, { id: 'b', isCorrect: false }],
}

describe('quiz scoring', () => {
  it('scores right, wrong (negative marks) and unanswered single-correct answers', () => {
    expect(scoreAnswer(single, { questionId: 'q1', optionId: 'a' })).toMatchObject({ isCorrect: true, pointsAwarded: 2, maxPoints: 2 })
    expect(scoreAnswer(single, { questionId: 'q1', optionId: 'b' })).toMatchObject({ isCorrect: false, pointsAwarded: -0.5 })
    expect(scoreAnswer(single, undefined)).toMatchObject({ answered: false, pointsAwarded: 0 })
  })

  it('refuses an option from another question instead of scoring it', () => {
    expect(() => scoreAnswer(single, { questionId: 'q1', optionId: 'zz' })).toThrow('quiz_answers_invalid')
  })

  it('matches fill-in-the-blank answers ignoring spaces, and case unless asked', () => {
    const fill: ScoringQuestion = { ...single, type: 'fill_blank', options: [], acceptedAnswers: ['Oil Record Book'], negativeMarks: 0 }
    expect(scoreAnswer(fill, { questionId: 'q1', text: '  oil   record book ' }).isCorrect).toBe(true)
    expect(scoreAnswer({ ...fill, caseSensitive: true }, { questionId: 'q1', text: 'oil record book' }).isCorrect).toBe(false)
    expect(normaliseFillAnswer(' A  b ', false)).toBe('a b')
  })

  it('leaves written answers for the trainer and floors totals at 0', () => {
    const written: ScoringQuestion = { ...single, type: 'subjective', options: [], negativeMarks: 0 }
    const pending = scoreAnswer(written, { questionId: 'q1', text: 'An answer' })
    expect(pending).toMatchObject({ gradingStatus: 'pending', pointsAwarded: null })
    expect(attemptTotals([pending, scoreAnswer(single, { questionId: 'q1', optionId: 'b' })])).toMatchObject({ scorePoints: 0, maxPoints: 4, awaitingGrading: true })
  })

  it('reveals answers by policy', () => {
    expect(mayRevealAnswers('never', { anyPassed: true, attemptsUsed: 9, maxAttempts: 1 })).toBe(false)
    expect(mayRevealAnswers('after_pass', { anyPassed: false, attemptsUsed: 1, maxAttempts: null })).toBe(false)
    expect(mayRevealAnswers('after_last_attempt', { anyPassed: false, attemptsUsed: 2, maxAttempts: 2 })).toBe(true)
    expect(mayRevealAnswers('after_last_attempt', { anyPassed: true, attemptsUsed: 5, maxAttempts: null })).toBe(false)
  })

  it('shuffles without losing or repeating items', () => {
    const items = Array.from({ length: 20 }, (_, index) => index)
    const result = shuffled(items, (n) => (n * 7 + 3) % n)
    expect([...result].sort((a, b) => a - b)).toEqual(items)
  })
})

describe('question validation', () => {
  it('reads a question saved before round B as single-correct, 1 mark', () => {
    expect(questionInputSchema.parse({ prompt: 'Q?', options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }] }))
      .toMatchObject({ type: 'single_choice', marks: 1, negativeMarks: 0 })
  })

  it('checks each type’s rules and the rank taxonomy', () => {
    const issues = (input: object) => questionInputSchema.safeParse(input).error?.issues.map((issue) => issue.message) ?? []
    expect(issues({ type: 'multiple_choice', prompt: 'Q?', options: [{ label: 'A', isCorrect: false }, { label: 'B', isCorrect: false }] })).toEqual(['Mark at least one correct answer.'])
    expect(issues({ type: 'fill_blank', prompt: 'Q?' })).toEqual(['Add at least one accepted answer.'])
    expect(issues({ type: 'true_false', prompt: 'Q?', options: [{ label: 'Yes', isCorrect: true }, { label: 'No', isCorrect: false }] })).toEqual(['A true or false question has the options True and False.'])
    expect(issues({ prompt: 'Q?', options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }], departmentKey: 'nowhere' })).toEqual(['Choose a department from the list.'])
    expect(issues({ prompt: 'Q?', options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }], negativeMarks: 2, marks: 1 })).toEqual(['Negative marks must be between 0 and the question’s marks.'])
  })
})

describe('question CSV', () => {
  it('parses quoted cells with commas, quotes and line breaks', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']])
  })

  it('reads the template it offers for download', () => {
    const read = readQuestionCsv(questionCsvTemplate())
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.questions.map((question) => question.type)).toEqual(['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'subjective'])
  })

  it('accepts department and rank labels as well as keys', () => {
    const read = readQuestionCsv('type,prompt,options,correct,department,rank\nsingle,Q?,A | B,1,Deck officers,Chief Officer\n')
    expect(read.ok && read.questions[0]).toMatchObject({ departmentKey: 'deck_officers', roleKey: expect.any(String) })
  })
})
