import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { QUESTION_DETAIL_COLUMNS, questionDetailsFromRow, type MentorQuizQuestionDetails, type QuestionDetailsRow } from './quiz-definition'
import type { QuestionInput } from './quiz-question-schema'
import type { Difficulty, QuestionType } from './quiz-model'

/**
 * Learning round B (B1): each trainer's question bank. A bank is private to its trainer and to platform
 * administrators (the caller checks admin authority and passes `asAdminForMentorId`); learners never read it.
 * Quizzes hold their own copy of each question (`source_question_id` points back here), so editing or deleting a
 * bank question never changes a quiz.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export type BankAccess = {
  actorId: string
  /** Set only after the caller verified platform admin authority: open this trainer's bank. */
  asAdminForMentorId?: string | null
}

export type BankQuestionOption = { id: string; label: string; position: number; isCorrect: boolean }
export type BankQuestion = MentorQuizQuestionDetails & {
  id: string
  prompt: string
  options: BankQuestionOption[]
  createdAt: string
  updatedAt: string
}

export type BankFilters = {
  type?: QuestionType | null
  topic?: string | null
  difficulty?: Difficulty | null
  departmentKey?: string | null
  roleKey?: string | null
  search?: string | null
}

export type QuestionBank = {
  id: string
  mentorId: string
  trainerName: string
  questions: BankQuestion[]
  topics: string[]
  total: number
}

export class QuestionBankError extends Error {
  constructor(code: 'question_bank_forbidden' | 'question_not_found' | 'question_bank_import_too_large') {
    super(code)
    this.name = 'QuestionBankError'
  }
}

export const BANK_IMPORT_MAX_ROWS = 500
const BANK_LIST_LIMIT = 500

type BankRow = QueryResultRow & { id: string; mentor_id: string; trainer_name: string | null }
type QuestionRow = QuestionDetailsRow & { prompt: string; created_at: string | Date; updated_at: string | Date }
type OptionRow = QueryResultRow & { id: string; question_id: string; label: string; position: string | number; is_correct: boolean }

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** The bank the actor may open: their own (created on first use) or, for an admin, the named trainer's. */
async function resolveBank(query: Query, access: BankAccess): Promise<BankRow> {
  const mentorRows = access.asAdminForMentorId
    ? await query(
      `select mentor.id, profile.full_name as trainer_name
       from public.learning_mentors mentor
       left join public.profiles profile on profile.id = mentor.user_id
       where mentor.id = $1
       limit 1`,
      [access.asAdminForMentorId],
    )
    : await query(
      `select mentor.id, profile.full_name as trainer_name
       from public.learning_mentors mentor
       left join public.profiles profile on profile.id = mentor.user_id
       where mentor.user_id = $1 and mentor.status = 'active'
       limit 1`,
      [access.actorId],
    )
  const mentor = mentorRows[0] as (QueryResultRow & { id: string; trainer_name: string | null }) | undefined
  if (!mentor) throw new QuestionBankError('question_bank_forbidden')
  const bankRows = await query(
    `insert into public.learning_question_banks (mentor_id)
     values ($1)
     on conflict (mentor_id) where mentor_id is not null do update set updated_at = public.learning_question_banks.updated_at
     returning id, mentor_id`,
    [mentor.id],
  ) as BankRow[]
  const bank = bankRows[0]
  if (!bank) throw new QuestionBankError('question_bank_forbidden')
  return { ...bank, trainer_name: mentor.trainer_name }
}

function filterSql(filters: BankFilters, values: unknown[]) {
  const clauses: string[] = []
  const add = (sql: string, value: unknown) => {
    values.push(value)
    clauses.push(sql.replace('?', `$${values.length}`))
  }
  if (filters.type) add('question.question_type = ?', filters.type)
  if (filters.topic) add('lower(question.topic) = lower(?)', filters.topic)
  if (filters.difficulty) add('question.difficulty = ?', filters.difficulty)
  if (filters.departmentKey) add('question.department_key = ?', filters.departmentKey)
  if (filters.roleKey) add('question.role_key = ?', filters.roleKey)
  if (filters.search?.trim()) add(`question.prompt ilike '%' || ? || '%'`, filters.search.trim().replace(/[\\%_]/g, (match) => `\\${match}`))
  return clauses.length ? ` and ${clauses.join(' and ')}` : ''
}

async function loadQuestions(query: Query, bankId: string, filters: BankFilters, limit: number | null) {
  const values: unknown[] = [bankId]
  const where = filterSql(filters, values)
  const rows = await query(
    `select question.id, question.prompt, question.created_at, question.updated_at, ${QUESTION_DETAIL_COLUMNS}
     from public.learning_quiz_questions question
     where question.bank_id = $1
       and question.quiz_id is null
       and question.removed_at is null${where}
     order by question.created_at desc, question.id desc${limit ? `\n     limit ${limit}` : ''}`,
    values,
  ) as QuestionRow[]
  const options = rows.length
    ? await query(
      `select option.id, option.question_id, option.label, option.position, option.is_correct
       from public.learning_quiz_options option
       where option.question_id = any($1::uuid[])
         and option.removed_at is null
       order by option.question_id asc, option.position asc, option.id asc`,
      [rows.map((row) => row.id)],
    ) as OptionRow[]
    : []
  return rows.map((row): BankQuestion => ({
    ...questionDetailsFromRow(row),
    sourceQuestionId: null,
    id: row.id,
    prompt: row.prompt,
    options: options
      .filter((option) => option.question_id === row.id)
      .map((option) => ({ id: option.id, label: option.label, position: Number(option.position), isCorrect: option.is_correct })),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }))
}

function questionValues(input: QuestionInput) {
  return [
    input.prompt,
    input.type,
    input.marks,
    input.negativeMarks,
    input.explanation,
    input.acceptedAnswers,
    input.caseSensitive,
    input.topic,
    input.difficulty,
    input.departmentKey,
    input.roleKey,
  ]
}

async function insertQuestion(query: Query, bankId: string, input: QuestionInput) {
  const rows = await query(
    `insert into public.learning_quiz_questions (
       bank_id, prompt, position, question_type, marks, negative_marks, explanation, accepted_answers,
       answers_case_sensitive, topic, difficulty, department_key, role_key, created_at, updated_at
     ) values ($1, $2, 0, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, now(), now())
     returning id`,
    [bankId, ...questionValues(input)],
  )
  const id = rows[0]?.id as string | undefined
  if (!id) throw new Error('question_bank_save_failed')
  for (const [position, option] of input.options.entries()) {
    await query(
      `insert into public.learning_quiz_options (question_id, label, position, is_correct, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [id, option.label, position, option.isCorrect],
    )
  }
  return id
}

export function createQuestionBankRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getBank(access: BankAccess, filters: BankFilters = {}): Promise<QuestionBank> {
    return transaction(async (query) => {
      const bank = await resolveBank(query, access)
      const questions = await loadQuestions(query, bank.id, filters, BANK_LIST_LIMIT)
      const topics = await query(
        `select distinct question.topic
         from public.learning_quiz_questions question
         where question.bank_id = $1 and question.quiz_id is null and question.removed_at is null and question.topic is not null
         order by question.topic asc`,
        [bank.id],
      )
      const total = await query(
        `select count(*)::int as count from public.learning_quiz_questions question
         where question.bank_id = $1 and question.quiz_id is null and question.removed_at is null`,
        [bank.id],
      )
      return {
        id: bank.id,
        mentorId: bank.mentor_id,
        trainerName: bank.trainer_name ?? 'Trainer',
        questions,
        topics: topics.map((row) => String(row.topic)),
        total: Number(total[0]?.count ?? 0),
      }
    })
  }

  /** Every question, for CSV export or for adding to a quiz. */
  async function listQuestions(access: BankAccess, filters: BankFilters = {}) {
    return transaction(async (query) => {
      const bank = await resolveBank(query, access)
      return loadQuestions(query, bank.id, filters, null)
    })
  }

  async function createQuestion(access: BankAccess, question: QuestionInput) {
    return transaction(async (query) => {
      const bank = await resolveBank(query, access)
      return insertQuestion(query, bank.id, question)
    })
  }

  async function updateQuestion(access: BankAccess, questionId: string, question: QuestionInput) {
    return transaction(async (query) => {
      const bank = await resolveBank(query, access)
      const updated = await query(
        `update public.learning_quiz_questions
         set prompt = $3, question_type = $4, marks = $5, negative_marks = $6, explanation = $7,
             accepted_answers = $8::text[], answers_case_sensitive = $9, topic = $10, difficulty = $11,
             department_key = $12, role_key = $13, updated_at = now()
         where id = $1 and bank_id = $2 and quiz_id is null and removed_at is null
         returning id`,
        [questionId, bank.id, ...questionValues(question)],
      )
      if (!updated[0]) throw new QuestionBankError('question_not_found')
      // Bank options are never answered by learners (quizzes answer their own copies), so they are rewritten.
      await query(`delete from public.learning_quiz_options where question_id = $1`, [questionId])
      for (const [position, option] of question.options.entries()) {
        await query(
          `insert into public.learning_quiz_options (question_id, label, position, is_correct, created_at, updated_at)
           values ($1, $2, $3, $4, now(), now())`,
          [questionId, option.label, position, option.isCorrect],
        )
      }
      return questionId
    })
  }

  /** Deletes a bank question. Quiz copies keep their own question; only their link back is cleared. */
  async function deleteQuestion(access: BankAccess, questionId: string) {
    return transaction(async (query) => {
      const bank = await resolveBank(query, access)
      const deleted = await query(
        `delete from public.learning_quiz_questions
         where id = $1 and bank_id = $2 and quiz_id is null
         returning id`,
        [questionId, bank.id],
      )
      if (!deleted[0]) throw new QuestionBankError('question_not_found')
      return true
    })
  }

  /** Saves every row or none (one transaction). Rows are validated by the caller first. */
  async function importQuestions(access: BankAccess, questions: readonly QuestionInput[]) {
    if (questions.length > BANK_IMPORT_MAX_ROWS) throw new QuestionBankError('question_bank_import_too_large')
    return transaction(async (query) => {
      const bank = await resolveBank(query, access)
      const ids: string[] = []
      for (const question of questions) ids.push(await insertQuestion(query, bank.id, question))
      return { imported: ids.length, ids }
    })
  }

  /** Banks platform administrators can open (trainers with at least one bank question). */
  async function listBanksForAdmin() {
    const rows = await queryRows(
      `select mentor.id as mentor_id, profile.full_name as trainer_name, count(question.id)::int as questions
       from public.learning_question_banks bank
       inner join public.learning_mentors mentor on mentor.id = bank.mentor_id
       left join public.profiles profile on profile.id = mentor.user_id
       left join public.learning_quiz_questions question
         on question.bank_id = bank.id and question.quiz_id is null and question.removed_at is null
       group by mentor.id, profile.full_name
       order by profile.full_name asc nulls last, mentor.id asc`,
    )
    return rows.map((row) => ({ mentorId: String(row.mentor_id), trainerName: String(row.trainer_name ?? 'Trainer'), questions: Number(row.questions) }))
  }

  return { getBank, listQuestions, createQuestion, updateQuestion, deleteQuestion, importQuestions, listBanksForAdmin }
}

export const questionBankRepository = createQuestionBankRepository()
