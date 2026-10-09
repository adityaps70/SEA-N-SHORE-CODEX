'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { questionBankRepository, QuestionBankError, type BankAccess, type BankFilters, type BankQuestion } from './question-bank-repository'
import { questionInputSchema, firstQuizIssue, type QuestionInput } from './quiz-question-schema'
import { readQuestionCsv, QUESTION_CSV_MAX_BYTES, type CsvRowError } from './quiz-csv'
import { DIFFICULTIES, QUESTION_TYPES } from './quiz-model'

const uuid = z.string().uuid()
const filtersSchema = z.object({
  type: z.enum(QUESTION_TYPES).nullable().optional(),
  topic: z.string().max(80).nullable().optional(),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  departmentKey: z.string().max(64).nullable().optional(),
  roleKey: z.string().max(64).nullable().optional(),
  search: z.string().max(200).nullable().optional(),
})

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** The bank the signed-in member may open: their own, or (platform admins only) the named trainer's. */
async function bankAccess(trainerMentorId?: string | null): Promise<BankAccess> {
  const user = await requireAwsUser()
  if (trainerMentorId) {
    if (!uuid.safeParse(trainerMentorId).success || !(await canUsePlatformAdminAuthority(user.id))) {
      throw new QuestionBankError('question_bank_forbidden')
    }
    return { actorId: user.id, asAdminForMentorId: trainerMentorId }
  }
  return { actorId: user.id }
}

function bankError(error: unknown) {
  if (error instanceof QuestionBankError) {
    if (error.message === 'question_bank_forbidden') return 'Only verified trainers (and Sea N Shore administrators) can use a question bank.'
    if (error.message === 'question_not_found') return 'That question is no longer in this bank. Reload the page.'
    if (error.message === 'question_bank_import_too_large') return 'A file can hold up to 500 questions.'
  }
  return 'We could not save the question bank. Please try again.'
}

function refresh() {
  revalidatePath('/learn/studio/question-bank')
}

export async function saveBankQuestion(input: QuestionInput, questionId?: string | null, trainerMentorId?: string | null): Promise<Result<{ questionId: string }>> {
  const parsed = questionInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstQuizIssue(parsed.error) }
  if (questionId && !uuid.safeParse(questionId).success) return { ok: false, error: 'That question is no longer in this bank. Reload the page.' }
  try {
    const access = await bankAccess(trainerMentorId)
    const id = questionId
      ? await questionBankRepository.updateQuestion(access, questionId, parsed.data)
      : await questionBankRepository.createQuestion(access, parsed.data)
    refresh()
    return { ok: true, questionId: id }
  } catch (error) {
    return { ok: false, error: bankError(error) }
  }
}

export async function deleteBankQuestion(questionId: string, trainerMentorId?: string | null): Promise<Result> {
  if (!uuid.safeParse(questionId).success) return { ok: false, error: 'That question is no longer in this bank. Reload the page.' }
  try {
    await questionBankRepository.deleteQuestion(await bankAccess(trainerMentorId), questionId)
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: bankError(error) }
  }
}

export type BankImportResult =
  | { ok: true; imported: number }
  | { ok: false; error: string; rowErrors?: CsvRowError[] }

/** Imports a CSV file: every row is checked, and nothing is saved unless every row is valid. */
export async function importBankQuestionsCsv(formData: FormData): Promise<BankImportResult> {
  const file = formData.get('file')
  const trainer = formData.get('trainer')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV file to import.' }
  if (file.size > QUESTION_CSV_MAX_BYTES) return { ok: false, error: 'The file is larger than 1 MB.' }
  const text = await file.text()
  const read = readQuestionCsv(text)
  if (!read.ok) {
    return read.fileError
      ? { ok: false, error: read.fileError }
      : { ok: false, error: `${read.errors.length} ${read.errors.length === 1 ? 'row needs' : 'rows need'} fixing. Nothing was imported.`, rowErrors: read.errors.slice(0, 100) }
  }
  try {
    const result = await questionBankRepository.importQuestions(await bankAccess(typeof trainer === 'string' && trainer ? trainer : null), read.questions)
    refresh()
    return { ok: true, imported: result.imported }
  } catch (error) {
    return { ok: false, error: bankError(error) }
  }
}

/** For the quiz editor's "Add from bank": the trainer's own bank questions, with their answers (trainer only). */
export async function listBankQuestionsForQuiz(filters: BankFilters = {}): Promise<Result<{ questions: BankQuestion[] }>> {
  const parsed = filtersSchema.safeParse(filters)
  if (!parsed.success) return { ok: false, error: 'Check the filters and try again.' }
  try {
    const questions = await questionBankRepository.listQuestions(await bankAccess(null), parsed.data)
    return { ok: true, questions }
  } catch (error) {
    return { ok: false, error: bankError(error) }
  }
}
