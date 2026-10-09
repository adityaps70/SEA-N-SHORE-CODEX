import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createActiveMentor } from '@/features/learning/learning-test-fixtures'
import { createQuestionBankRepository } from '@/features/learning/question-bank-repository'
import { questionInputSchema } from '@/features/learning/quiz-question-schema'
import { createAccountExportRepository } from './repository'

/** Learning round B: a trainer's account export includes their question bank, with its answers. */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('account export (real SQL)', () => {
  it('includes the trainer’s bank questions and their options, and nobody else’s', async () => {
    const owner = await createActiveMentor(db.query)
    const other = await createActiveMentor(db.query)
    const bank = createQuestionBankRepository({ query: db.query, transaction: db.transaction })
    const question = questionInputSchema.parse({ prompt: 'Fixture export question?', options: [{ label: 'Yes', isCorrect: true }, { label: 'No', isCorrect: false }] })
    await bank.createQuestion({ actorId: owner.userId }, question)
    await bank.createQuestion({ actorId: other.userId }, { ...question, prompt: 'Someone else’s question?' })

    const exported = await createAccountExportRepository({ query: db.query }).exportAccountData(owner.userId)
    const questions = exported.learningQuestionBankAuthored as Array<{ prompt: string; options: Array<{ label: string; is_correct: boolean }> }>
    expect(questions.map((entry) => entry.prompt)).toEqual(['Fixture export question?'])
    expect(questions[0]!.options.map((option) => [option.label, option.is_correct])).toEqual([['Yes', true], ['No', false]])
  }, 120_000)
})
