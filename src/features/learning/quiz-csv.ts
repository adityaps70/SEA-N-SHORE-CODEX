import { csvCell } from '@/features/newsletter/csv'
import { ROLE_DEPARTMENTS, departmentByKey, normaliseLegacyRank, normaliseRoleText, roleByKey } from '@/features/roles/taxonomy'
import { QUESTION_FIELD_LABELS, questionInputSchema, type QuestionInput } from './quiz-question-schema'
import { TRUE_FALSE_LABELS, marksLabel, type QuestionType } from './quiz-model'
import { plainIssueMessage } from '@/lib/validation/plain-messages'

/**
 * Learning round B (B1): question bank CSV. One question per row; lists inside a cell are separated by "|".
 * Import is all or nothing: every row is checked first and nothing is saved while any row has an error.
 */

export const QUESTION_CSV_COLUMNS = [
  'type',
  'prompt',
  'options',
  'correct',
  'accepted_answers',
  'case_sensitive',
  'marks',
  'negative_marks',
  'explanation',
  'topic',
  'difficulty',
  'department',
  'rank',
] as const

export const QUESTION_CSV_MAX_BYTES = 1024 * 1024
export const QUESTION_CSV_MAX_ROWS = 500

export type CsvRowError = { row: number; messages: string[] }
export type QuestionCsvResult =
  | { ok: true; questions: QuestionInput[] }
  | { ok: false; errors: CsvRowError[]; fileError?: string }

/** RFC 4180: quoted cells may hold commas, quotes ("") and line breaks. A byte-order mark is ignored. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"' && cell === '') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''))
}

const TYPE_ALIASES: Record<string, QuestionType> = {
  '': 'single_choice',
  single: 'single_choice',
  single_choice: 'single_choice',
  single_correct: 'single_choice',
  mcq: 'single_choice',
  multiple: 'multiple_choice',
  multiple_choice: 'multiple_choice',
  multiple_correct: 'multiple_choice',
  multi: 'multiple_choice',
  true_false: 'true_false',
  truefalse: 'true_false',
  tf: 'true_false',
  fill_blank: 'fill_blank',
  fill_in_the_blank: 'fill_blank',
  fill: 'fill_blank',
  subjective: 'subjective',
  written: 'subjective',
  written_answer: 'subjective',
}

function list(value: string) {
  return value.split('|').map((item) => item.trim()).filter(Boolean)
}

function yesNo(value: string): boolean | null {
  const normalised = value.trim().toLowerCase()
  if (['', 'no', 'n', 'false', '0'].includes(normalised)) return false
  if (['yes', 'y', 'true', '1'].includes(normalised)) return true
  return null
}

function number(value: string, fallback: number): number | null {
  if (!value.trim()) return fallback
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function departmentKeyOf(value: string): string | null | undefined {
  if (!value.trim()) return null
  if (departmentByKey(value.trim())) return value.trim()
  const wanted = normaliseRoleText(value)
  return ROLE_DEPARTMENTS.find((department) => normaliseRoleText(department.label) === wanted)?.key
}

function roleKeyOf(value: string): string | null | undefined {
  if (!value.trim()) return null
  if (roleByKey(value.trim())) return value.trim()
  return normaliseLegacyRank(value) ?? undefined
}

/** Undoes the export's spreadsheet-formula guard ('=…), so an exported file imports back unchanged. */
function unescapeCell(value: string) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value
}

/** Reads one data row into a question, or the reasons it cannot be read. */
function readRow(cells: Record<string, string>): { question?: QuestionInput; messages: string[] } {
  const messages: string[] = []
  const typeText = cells.type.trim().toLowerCase().replace(/[\s/-]+/g, '_')
  const type = TYPE_ALIASES[typeText]
  if (!type) messages.push(`Type “${cells.type.trim()}” is not one of single, multiple, true_false, fill_blank, subjective.`)

  let options: QuestionInput['options'] = []
  const correctText = cells.correct.trim()
  if (type === 'true_false') {
    const value = correctText.toLowerCase()
    if (value !== 'true' && value !== 'false') messages.push('For a true_false question, correct must be true or false.')
    options = TRUE_FALSE_LABELS.map((label) => ({ label, isCorrect: label.toLowerCase() === value }))
    if (cells.options.trim()) messages.push('A true_false question needs no options; leave the options cell empty.')
  } else if (type === 'single_choice' || type === 'multiple_choice') {
    const labels = list(cells.options)
    const picks = correctText.split(/[;,\s]+/).filter(Boolean)
    const numbers = picks.map((pick) => Number(pick))
    if (picks.length === 0) messages.push('Correct is empty: give the number of the correct option (for example 2, or 1;3 for multiple).')
    else if (numbers.some((value) => !Number.isInteger(value) || value < 1 || value > labels.length)) {
      messages.push(`Correct must be option numbers between 1 and ${labels.length}.`)
    }
    options = labels.map((label, index) => ({ label, isCorrect: numbers.includes(index + 1) }))
  } else if (cells.options.trim() || correctText) {
    messages.push('Fill-in-the-blank and subjective questions have no options or correct column; use accepted_answers for fill_blank.')
  }

  const caseSensitive = yesNo(cells.case_sensitive)
  if (caseSensitive === null) messages.push('case_sensitive must be yes or no.')
  const marks = number(cells.marks, 1)
  if (marks === null) messages.push('marks must be a number.')
  const negativeMarks = number(cells.negative_marks, 0)
  if (negativeMarks === null) messages.push('negative_marks must be a number.')
  const difficulty = cells.difficulty.trim().toLowerCase()
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) messages.push('difficulty must be easy, medium or hard.')
  const departmentKey = departmentKeyOf(cells.department)
  if (departmentKey === undefined) messages.push(`Department “${cells.department.trim()}” is not in the Sea N Shore list.`)
  const roleKey = roleKeyOf(cells.rank)
  if (roleKey === undefined) messages.push(`Rank “${cells.rank.trim()}” is not in the Sea N Shore list.`)
  if (messages.length) return { messages }

  const parsed = questionInputSchema.safeParse({
    type,
    prompt: cells.prompt,
    options,
    marks,
    negativeMarks,
    explanation: cells.explanation.trim() || null,
    acceptedAnswers: list(cells.accepted_answers),
    caseSensitive,
    topic: cells.topic.trim() || null,
    difficulty: difficulty || null,
    // A rank alone fills in its department.
    departmentKey: departmentKey ?? (roleKey ? roleByKey(roleKey)?.department ?? null : null),
    roleKey,
  })
  if (!parsed.success) return { messages: [...new Set(parsed.error.issues.map((issue) => plainIssueMessage(issue, QUESTION_FIELD_LABELS)))] }
  return { question: parsed.data, messages: [] }
}

/** Checks a whole file. Row numbers count the header as row 1, as a spreadsheet shows them. */
export function readQuestionCsv(text: string): QuestionCsvResult {
  if (new TextEncoder().encode(text).length > QUESTION_CSV_MAX_BYTES) {
    return { ok: false, errors: [], fileError: 'The file is larger than 1 MB.' }
  }
  const rows = parseCsv(text)
  const [header, ...data] = rows
  if (!header) return { ok: false, errors: [], fileError: 'The file is empty.' }
  const names = header.map((name) => name.trim().toLowerCase())
  if (!names.includes('prompt')) return { ok: false, errors: [], fileError: 'The first row must be the column names from the template (prompt is missing).' }
  if (data.length === 0) return { ok: false, errors: [], fileError: 'The file has no questions below the column names.' }
  if (data.length > QUESTION_CSV_MAX_ROWS) return { ok: false, errors: [], fileError: `A file can hold up to ${QUESTION_CSV_MAX_ROWS} questions; this one has ${data.length}.` }

  const questions: QuestionInput[] = []
  const errors: CsvRowError[] = []
  data.forEach((cellsArray, index) => {
    const cells = Object.fromEntries(QUESTION_CSV_COLUMNS.map((column) => {
      const at = names.indexOf(column)
      return [column, at === -1 ? '' : unescapeCell(cellsArray[at] ?? '')]
    })) as Record<(typeof QUESTION_CSV_COLUMNS)[number], string>
    const { question, messages } = readRow(cells)
    if (question) questions.push(question)
    else errors.push({ row: index + 2, messages })
  })
  return errors.length ? { ok: false, errors } : { ok: true, questions }
}

type ExportQuestion = Pick<QuestionInput, 'type' | 'prompt' | 'options' | 'acceptedAnswers' | 'caseSensitive' | 'marks' | 'negativeMarks' | 'explanation' | 'topic' | 'difficulty' | 'departmentKey' | 'roleKey'>

const TYPE_OUT: Record<QuestionType, string> = {
  single_choice: 'single',
  multiple_choice: 'multiple',
  true_false: 'true_false',
  fill_blank: 'fill_blank',
  subjective: 'subjective',
}

function exportRow(question: ExportQuestion) {
  const correct = question.type === 'true_false'
    ? (question.options.find((option) => option.isCorrect)?.label ?? '').toLowerCase()
    : question.type === 'single_choice' || question.type === 'multiple_choice'
      ? question.options.map((option, index) => (option.isCorrect ? String(index + 1) : null)).filter(Boolean).join(';')
      : ''
  return [
    TYPE_OUT[question.type],
    question.prompt,
    question.type === 'single_choice' || question.type === 'multiple_choice' ? question.options.map((option) => option.label).join(' | ') : '',
    correct,
    question.acceptedAnswers.join(' | '),
    question.type === 'fill_blank' ? (question.caseSensitive ? 'yes' : 'no') : '',
    marksLabel(question.marks),
    marksLabel(question.negativeMarks),
    question.explanation ?? '',
    question.topic ?? '',
    question.difficulty ?? '',
    question.departmentKey ?? '',
    question.roleKey ?? '',
  ]
}

export function questionsToCsv(questions: readonly ExportQuestion[]) {
  const lines = [QUESTION_CSV_COLUMNS.join(','), ...questions.map((question) => exportRow(question).map((value) => csvCell(value)).join(','))]
  return `﻿${lines.join('\r\n')}\r\n`
}

const TEMPLATE_ROWS: ExportQuestion[] = [
  {
    type: 'single_choice',
    prompt: 'Which document records the vessel’s cargo and ballast operations on an oil tanker?',
    options: [
      { label: 'Oil Record Book Part II', isCorrect: true },
      { label: 'Official log book', isCorrect: false },
      { label: 'Garbage record book', isCorrect: false },
    ],
    acceptedAnswers: [],
    caseSensitive: false,
    marks: 1,
    negativeMarks: 0,
    explanation: 'Part II covers cargo and ballast operations on oil tankers.',
    topic: 'MARPOL Annex I',
    difficulty: 'easy',
    departmentKey: 'deck_officers',
    roleKey: null,
  },
  {
    type: 'multiple_choice',
    prompt: 'Which of these are SIRE 2.0 question categories?',
    options: [
      { label: 'Core', isCorrect: true },
      { label: 'Rotational 1', isCorrect: true },
      { label: 'Optional', isCorrect: false },
      { label: 'Rotational 2', isCorrect: true },
    ],
    acceptedAnswers: [],
    caseSensitive: false,
    marks: 2,
    negativeMarks: 0.5,
    explanation: null,
    topic: 'SIRE 2.0',
    difficulty: 'medium',
    departmentKey: null,
    roleKey: null,
  },
  {
    type: 'true_false',
    prompt: 'An enclosed space entry permit may be issued without testing the atmosphere.',
    options: [{ label: 'True', isCorrect: false }, { label: 'False', isCorrect: true }],
    acceptedAnswers: [],
    caseSensitive: false,
    marks: 1,
    negativeMarks: 0,
    explanation: 'The atmosphere is always tested before entry.',
    topic: 'Enclosed space entry',
    difficulty: 'easy',
    departmentKey: null,
    roleKey: null,
  },
  {
    type: 'fill_blank',
    prompt: 'The minimum oxygen content for safe entry into an enclosed space is ____ % by volume.',
    options: [],
    acceptedAnswers: ['20.8', '21'],
    caseSensitive: false,
    marks: 1,
    negativeMarks: 0,
    explanation: null,
    topic: 'Enclosed space entry',
    difficulty: 'medium',
    departmentKey: null,
    roleKey: null,
  },
  {
    type: 'subjective',
    prompt: 'Describe how you would prepare the bridge team for a SIRE 2.0 inspection.',
    options: [],
    acceptedAnswers: [],
    caseSensitive: false,
    marks: 5,
    negativeMarks: 0,
    explanation: null,
    topic: 'SIRE 2.0',
    difficulty: 'hard',
    departmentKey: 'deck_officers',
    roleKey: null,
  },
]

/** The downloadable template: the column names and one example of each question type. */
export function questionCsvTemplate() {
  return questionsToCsv(TEMPLATE_ROWS)
}
