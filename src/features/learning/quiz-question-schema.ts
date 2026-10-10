import { z } from 'zod'
import { departmentByKey, roleByKey } from '@/features/roles/taxonomy'
import {
  ANSWER_POLICIES,
  DIFFICULTIES,
  QUESTION_LIMITS,
  QUESTION_TYPES,
  QUIZ_LIMITS,
  TRUE_FALSE_LABELS,
  roundMarks,
  type AnswerPolicy,
  type Difficulty,
  type QuestionType,
} from './quiz-model'
import { plainIssueMessage } from '@/lib/validation/plain-messages'

/**
 * One validation for a question wherever it is written: the quiz editor, the question bank and CSV import.
 * Questions saved before round B send only a prompt and options; they parse as single-correct, 1 mark.
 */

export type QuestionTagsInput = {
  topic: string | null
  difficulty: Difficulty | null
  departmentKey: string | null
  roleKey: string | null
}

export type QuestionInput = QuestionTagsInput & {
  id?: string | null
  type: QuestionType
  prompt: string
  options: Array<{ id?: string | null; label: string; isCorrect: boolean }>
  marks: number
  negativeMarks: number
  explanation: string | null
  acceptedAnswers: string[]
  caseSensitive: boolean
  /** The bank question this quiz copy came from (quizzes only). */
  sourceQuestionId?: string | null
}

const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => (value ? value : null))

const marksSchema = z.number().finite().refine((value) => roundMarks(value) === value, 'Marks can have at most two decimal places.')

export const questionInputSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  type: z.enum(QUESTION_TYPES).optional().default('single_choice'),
  prompt: z.string().trim().min(1, 'Quiz question prompt is required.').max(QUESTION_LIMITS.prompt),
  options: z.array(z.object({
    id: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1, 'Quiz answer text is required.').max(QUESTION_LIMITS.option),
    isCorrect: z.boolean(),
  })).max(QUESTION_LIMITS.options, 'A question can have at most 20 answer options.').optional().default([]),
  marks: marksSchema.optional().default(1),
  negativeMarks: marksSchema.optional().default(0),
  explanation: nullableTrimmed(QUESTION_LIMITS.explanation),
  acceptedAnswers: z.array(z.string().trim().min(1).max(QUESTION_LIMITS.acceptedAnswer, 'Each accepted answer can be up to 200 characters.'))
    .max(QUESTION_LIMITS.acceptedAnswers, 'A question can have at most 20 accepted answers.').optional().default([]),
  caseSensitive: z.boolean().optional().default(false),
  topic: nullableTrimmed(QUESTION_LIMITS.topic),
  difficulty: z.enum(DIFFICULTIES).nullable().optional().transform((value) => value ?? null),
  departmentKey: z.string().nullable().optional().transform((value) => value || null),
  roleKey: z.string().nullable().optional().transform((value) => value || null),
  sourceQuestionId: z.string().uuid().nullable().optional(),
}).superRefine((question, context) => {
  checkQuestion(question, (path, message) => context.addIssue({ code: 'custom', path, message }))
})

type IssueSink = (path: Array<string | number>, message: string) => void

/** The type rules. Messages for single-correct questions are the ones trainers have always seen. */
export function checkQuestion(question: Omit<QuestionInput, 'id' | 'sourceQuestionId'>, issue: IssueSink) {
  const correct = question.options.filter((option) => option.isCorrect).length
  switch (question.type) {
    case 'single_choice':
      if (question.options.length < 2) issue(['options'], 'Each quiz question needs at least two answer options.')
      else if (correct !== 1) issue(['options'], 'Each quiz question must have exactly one correct answer.')
      break
    case 'multiple_choice':
      if (question.options.length < 2) issue(['options'], 'Each quiz question needs at least two answer options.')
      else if (correct < 1) issue(['options'], 'Mark at least one correct answer.')
      break
    case 'true_false':
      if (question.options.length !== 2 || question.options.some((option, index) => option.label !== TRUE_FALSE_LABELS[index])) {
        issue(['options'], 'A true or false question has the options True and False.')
      } else if (correct !== 1) issue(['options'], 'Choose whether the statement is true or false.')
      break
    case 'fill_blank':
      if (question.options.length > 0) issue(['options'], 'A fill-in-the-blank question has no answer options.')
      if (question.acceptedAnswers.length === 0) issue(['acceptedAnswers'], 'Add at least one accepted answer.')
      break
    case 'subjective':
      if (question.options.length > 0) issue(['options'], 'A written-answer question has no answer options.')
      if (question.acceptedAnswers.length > 0) issue(['acceptedAnswers'], 'A written-answer question is graded by the trainer, so it has no accepted answers.')
      break
  }
  if (question.type !== 'fill_blank' && question.type !== 'subjective' && question.acceptedAnswers.length > 0) {
    issue(['acceptedAnswers'], 'Only fill-in-the-blank questions have accepted answers.')
  }
  if (!(question.marks > 0 && question.marks <= QUESTION_LIMITS.marks)) issue(['marks'], 'Marks must be more than 0 and at most 100.')
  if (question.negativeMarks < 0 || question.negativeMarks > question.marks) issue(['negativeMarks'], 'Negative marks must be between 0 and the question’s marks.')
  if (question.type === 'subjective' && question.negativeMarks > 0) issue(['negativeMarks'], 'Written answers have no negative marks.')
  if (question.departmentKey && !departmentByKey(question.departmentKey)) issue(['departmentKey'], 'Choose a department from the list.')
  if (question.roleKey) {
    const role = roleByKey(question.roleKey)
    if (!role || role.other) issue(['roleKey'], 'Choose a rank or role from the list.')
    else if (question.departmentKey && role.department !== question.departmentKey) issue(['roleKey'], 'The rank or role must belong to the chosen department.')
  }
}

export type QuizSettingsInput = {
  timeLimitMinutes: number | null
  shuffleQuestions: boolean
  shuffleOptions: boolean
  drawCount: number | null
  answerPolicy: AnswerPolicy
}

export const quizSettingsSchema = z.object({
  timeLimitMinutes: z.number().int().min(1, 'The time limit is at least 1 minute.').max(QUIZ_LIMITS.timeLimitMinutes, 'The time limit is at most 600 minutes.').nullable().optional().default(null),
  shuffleQuestions: z.boolean().optional().default(false),
  shuffleOptions: z.boolean().optional().default(false),
  drawCount: z.number().int().min(1, 'Draw at least 1 question.').max(QUIZ_LIMITS.drawCount).nullable().optional().default(null),
  answerPolicy: z.enum(ANSWER_POLICIES).optional().default('after_each_attempt'),
})

export const quizDefinitionSchema = z.object({
  passPercentage: z.number().int().min(1).max(100),
  instructions: z.string().trim().max(4000).nullable().transform((value) => value || null),
  questions: z.array(questionInputSchema).min(1, 'Add at least one quiz question.').max(QUIZ_LIMITS.questions),
}).extend(quizSettingsSchema.shape).superRefine((quiz, context) => {
  if (quiz.drawCount !== null && quiz.drawCount > quiz.questions.length) {
    context.addIssue({ code: 'custom', path: ['drawCount'], message: `The quiz has ${quiz.questions.length} ${quiz.questions.length === 1 ? 'question' : 'questions'}, so it can draw at most that many.` })
  }
})

/** Field names for any rule that does not word its own message (round C: never zod's wording). */
export const QUESTION_FIELD_LABELS = {
  type: 'Question type',
  prompt: 'The question',
  options: 'Answer options',
  marks: 'Marks',
  negativeMarks: 'Negative marks',
  explanation: 'Explanation',
  acceptedAnswers: 'Accepted answers',
  topic: 'Topic',
  difficulty: 'Difficulty',
  departmentKey: 'Department',
  roleKey: 'Rank or role',
}

export const QUIZ_FIELD_LABELS = {
  passPercentage: 'Pass mark',
  instructions: 'Instructions',
  questions: 'Questions',
  timeLimitMinutes: 'Time limit',
  drawCount: 'Questions to draw',
  answerPolicy: 'When answers are shown',
}

/** The issue a trainer sees first, numbered by question. */
export function firstQuizIssue(error: z.ZodError) {
  const issue = error.issues[0]
  if (!issue) return 'Review the quiz and try again.'
  const [root, index] = issue.path
  if (root === 'questions' && typeof index === 'number' && issue.path.length > 2) {
    return `Question ${index + 1}: ${plainIssueMessage({ ...issue, path: issue.path.slice(2) }, QUESTION_FIELD_LABELS)}`
  }
  return plainIssueMessage(issue, QUIZ_FIELD_LABELS)
}
