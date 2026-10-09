'use client'

import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  FileQuestion,
  Library,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { MentorQuizDefinition, MentorQuizDefinitionInput } from '../mentor-curriculum-repository'
import type { MentorMaterial } from '../mentor-material-repository'
import type { BankQuestion } from '../question-bank-repository'
import { listBankQuestionsForQuiz } from '../question-bank-actions'
import {
  ANSWER_POLICIES,
  ANSWER_POLICY_LABELS,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_SHORT_LABELS,
  marksLabel,
  type AnswerPolicy,
  type Difficulty,
  type QuestionType,
} from '../quiz-model'
import {
  QuestionEditorFields,
  draftFromQuestion,
  emptyQuestionDraft,
  questionPayload,
  type QuestionDraft,
} from './question-editor-fields'

export type QuizDraftState = {
  passPercentage: string
  instructions: string
  timeLimitMinutes: string
  shuffleQuestions: boolean
  shuffleOptions: boolean
  drawCount: string
  answerPolicy: AnswerPolicy
  // Saved questions and options keep their id, so saving updates them in place and learners'
  // attempts stay attached; new ones have none until saved.
  questions: QuestionDraft[]
}

export function quizStateFromPersisted(quiz: MentorQuizDefinition | null): QuizDraftState {
  if (!quiz) {
    return { passPercentage: '80', instructions: '', timeLimitMinutes: '', shuffleQuestions: false, shuffleOptions: false, drawCount: '', answerPolicy: 'after_each_attempt', questions: [] }
  }
  return {
    passPercentage: String(quiz.passPercentage),
    instructions: quiz.instructions ?? '',
    timeLimitMinutes: quiz.timeLimitMinutes ? String(quiz.timeLimitMinutes) : '',
    shuffleQuestions: quiz.shuffleQuestions ?? false,
    shuffleOptions: quiz.shuffleOptions ?? false,
    drawCount: quiz.drawCount ? String(quiz.drawCount) : '',
    answerPolicy: quiz.answerPolicy ?? 'after_each_attempt',
    questions: quiz.questions.map((question) => draftFromQuestion(question)),
  }
}

function wholeOrNull(value: string) {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : null
}

export function quizPayload(draft: QuizDraftState): MentorQuizDefinitionInput {
  return {
    passPercentage: Number(draft.passPercentage),
    instructions: draft.instructions.trim() || null,
    timeLimitMinutes: wholeOrNull(draft.timeLimitMinutes),
    shuffleQuestions: draft.shuffleQuestions,
    shuffleOptions: draft.shuffleOptions,
    drawCount: wholeOrNull(draft.drawCount),
    answerPolicy: draft.answerPolicy,
    questions: draft.questions.map((question) => questionPayload(question)),
  }
}

function moveArrayItem<T>(items: T[], index: number, direction: 'up' | 'down') {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  const currentValue = next[index]!
  next[index] = next[target]!
  next[target] = currentValue
  return next
}

function inputClassName() {
  return 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none transition placeholder:text-muted/60 focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
}

/** "Add from bank": the trainer's own bank, filtered; each pick is copied into this quiz. */
function BankPicker({
  existingSources,
  onAdd,
  onClose,
}: {
  existingSources: Set<string>
  onAdd: (questions: BankQuestion[]) => void
  onClose: () => void
}) {
  const [filters, setFilters] = useState<{ type: '' | QuestionType; difficulty: '' | Difficulty; topic: string; search: string }>({ type: '', difficulty: '', topic: '', search: '' })
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    setLoading(true)
    setError(null)
    const result = await listBankQuestionsForQuiz({
      type: filters.type || null,
      difficulty: filters.difficulty || null,
      topic: filters.topic.trim() || null,
      search: filters.search.trim() || null,
    })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQuestions(result.questions)
    setSelected(new Set())
  }

  const available = (questions ?? []).filter((question) => !existingSources.has(question.id))

  return (
    <section className="mt-4 rounded-2xl border border-teal-200 bg-white p-4" aria-label="Add questions from your bank">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold text-navy-950"><Library className="size-4 text-teal-700" aria-hidden="true" /> Add from your question bank</p>
          <p className="mt-1 text-xs leading-5 text-muted">Questions are copied into this quiz. Editing the bank later does not change this quiz; learners see changes only after review.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-mist-50" aria-label="Close the question bank"><X className="size-4" aria-hidden="true" /></button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_160px_130px_1fr_auto] lg:items-end">
        <label className="text-xs font-bold text-navy-950">
          Topic
          <input aria-label="Bank topic" className={inputClassName()} value={filters.topic} onChange={(event) => setFilters({ ...filters, topic: event.target.value })} />
        </label>
        <label className="text-xs font-bold text-navy-950">
          Type
          <select aria-label="Bank question type" className={inputClassName()} value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as '' | QuestionType })}>
            <option value="">Any type</option>
            {QUESTION_TYPES.map((type) => <option key={type} value={type}>{QUESTION_TYPE_SHORT_LABELS[type]}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-navy-950">
          Difficulty
          <select aria-label="Bank difficulty" className={inputClassName()} value={filters.difficulty} onChange={(event) => setFilters({ ...filters, difficulty: event.target.value as '' | Difficulty })}>
            <option value="">Any</option>
            {DIFFICULTIES.map((difficulty) => <option key={difficulty} value={difficulty}>{DIFFICULTY_LABELS[difficulty]}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-navy-950">
          Words in the question
          <input aria-label="Bank search" className={inputClassName()} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
        </label>
        <button type="button" disabled={loading} onClick={() => void search()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />} Show questions
        </button>
      </div>
      {error ? <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      {questions ? (
        questions.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No bank questions match. Add questions in Studio → Question bank.</p>
        ) : (
          <>
            <ul className="mt-4 max-h-80 divide-y divide-mist-100 overflow-y-auto rounded-xl border border-mist-100" aria-label="Bank questions">
              {questions.map((question) => {
                const already = existingSources.has(question.id)
                return (
                  <li key={question.id} className="flex items-start gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${question.prompt.slice(0, 80)}`}
                      disabled={already}
                      checked={selected.has(question.id)}
                      onChange={() => setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(question.id)) next.delete(question.id)
                        else next.add(question.id)
                        return next
                      })}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold text-navy-950">{question.prompt}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {QUESTION_TYPE_SHORT_LABELS[question.type]} · {marksLabel(question.marks)} {question.marks === 1 ? 'mark' : 'marks'}
                        {question.topic ? ` · ${question.topic}` : ''}
                        {question.difficulty ? ` · ${DIFFICULTY_LABELS[question.difficulty]}` : ''}
                        {already ? ' · Already in this quiz' : ''}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={selected.size === 0} onClick={() => onAdd(available.filter((question) => selected.has(question.id)))} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50">
                <Plus className="size-4" aria-hidden="true" /> Add selected ({selected.size})
              </button>
              <button type="button" disabled={available.length === 0} onClick={() => onAdd(available)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50 disabled:opacity-50">
                Add all {available.length} shown
              </button>
            </div>
          </>
        )
      ) : null}
    </section>
  )
}

export function QuizEditor({
  courseId,
  material,
  draft,
  setDraft,
  pending,
  onSave,
  onCancel,
}: {
  courseId: string
  material: MentorMaterial
  draft: QuizDraftState
  setDraft: (next: QuizDraftState) => void
  pending: boolean
  onSave: (courseId: string, materialId: string, input: MentorQuizDefinitionInput) => void
  onCancel: () => void
}) {
  const [bankOpen, setBankOpen] = useState(false)

  function updateQuestion(questionIndex: number, next: QuestionDraft) {
    setDraft({ ...draft, questions: draft.questions.map((question, index) => (index === questionIndex ? next : question)) })
  }

  function addQuestion() {
    setDraft({ ...draft, questions: [...draft.questions, emptyQuestionDraft()] })
  }

  function addFromBank(questions: BankQuestion[]) {
    setDraft({
      ...draft,
      questions: [
        ...draft.questions,
        ...questions.map((question) => ({ ...draftFromQuestion(question, { keepIds: false }), sourceQuestionId: question.id })),
      ],
    })
    setBankOpen(false)
  }

  const totalMarks = draft.questions.reduce((sum, question) => sum + (Number(question.marks) || 0), 0)
  const existingSources = new Set(draft.questions.map((question) => question.sourceQuestionId).filter((id): id is string => Boolean(id)))
  const drawCount = Number(draft.drawCount) || null

  return (
    <section className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 sm:p-5" aria-label={`Quiz editor ${material.title}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-sky-700"><FileQuestion className="size-4" aria-hidden="true" /> Assessment editor</p>
          <h4 className="mt-1 font-bold text-navy-950">{material.title}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">Correct answers stay in trainer/admin authoring data and are never returned in the learner quiz read model.</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg p-2 text-muted hover:bg-white" aria-label={`Close quiz editor ${material.title}`}><X className="size-4" aria-hidden="true" /></button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[180px_1fr]">
        <label className="text-sm font-semibold text-navy-950">
          Pass percentage
          <input aria-label="Quiz pass percentage" type="number" min="1" max="100" step="1" className={inputClassName()} value={draft.passPercentage} onChange={(event) => setDraft({ ...draft, passPercentage: event.target.value })} />
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Instructions <span className="font-normal text-muted">(optional)</span>
          <textarea aria-label="Quiz instructions" className={`${inputClassName()} min-h-20 resize-y`} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
        </label>
      </div>

      <fieldset className="mt-4 rounded-2xl border border-mist-200 bg-white p-4">
        <legend className="px-1 text-sm font-bold text-navy-950">Quiz settings</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-navy-950">
            Time limit <span className="font-normal text-muted">(minutes)</span>
            <input aria-label="Quiz time limit in minutes" type="number" min="1" max="600" step="1" placeholder="No limit" className={inputClassName()} value={draft.timeLimitMinutes} onChange={(event) => setDraft({ ...draft, timeLimitMinutes: event.target.value })} />
          </label>
          <label className="text-sm font-semibold text-navy-950">
            Questions per attempt
            <input aria-label="Questions drawn per attempt" type="number" min="1" max={Math.max(1, draft.questions.length)} step="1" placeholder={`All ${draft.questions.length}`} className={inputClassName()} value={draft.drawCount} onChange={(event) => setDraft({ ...draft, drawCount: event.target.value })} />
          </label>
          <label className="text-sm font-semibold text-navy-950 lg:col-span-2">
            Show correct answers
            <select aria-label="When learners see correct answers" className={inputClassName()} value={draft.answerPolicy} onChange={(event) => setDraft({ ...draft, answerPolicy: event.target.value as AnswerPolicy })}>
              {ANSWER_POLICIES.map((policy) => <option key={policy} value={policy}>{ANSWER_POLICY_LABELS[policy]}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-navy-950">
            <input aria-label="Shuffle questions" type="checkbox" checked={draft.shuffleQuestions} onChange={(event) => setDraft({ ...draft, shuffleQuestions: event.target.checked })} /> Shuffle questions
          </label>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-navy-950">
            <input aria-label="Shuffle answer options" type="checkbox" checked={draft.shuffleOptions} onChange={(event) => setDraft({ ...draft, shuffleOptions: event.target.checked })} /> Shuffle answer options
          </label>
        </div>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted">
          {drawCount && drawCount > draft.questions.length ? <li className="font-semibold text-rose-700">The quiz has {draft.questions.length} {draft.questions.length === 1 ? 'question' : 'questions'}, so it cannot draw {drawCount}. Add questions or lower the number.</li> : null}
          {drawCount && drawCount <= draft.questions.length ? <li>Each attempt draws {drawCount} of these {draft.questions.length} questions at random and keeps them for that attempt.</li> : null}
          {draft.timeLimitMinutes ? <li>The server keeps the time: answers saved by the deadline are submitted automatically, and later answers are refused.</li> : null}
          {draft.answerPolicy === 'after_last_attempt' && material.maxAttempts === null ? <li>This material has unlimited attempts, so learners would never see the answers. Set an attempt limit on the material, or choose another option.</li> : null}
          <li>Total: {marksLabel(totalMarks)} marks{drawCount ? ' across all questions (each attempt is marked out of its drawn questions)' : ''}.</li>
        </ul>
      </fieldset>

      <div className="mt-5 space-y-4">
        {draft.questions.map((question, questionIndex) => (
          <section key={questionIndex} className="rounded-2xl border border-mist-200 bg-white p-4" aria-label={`Question ${questionIndex + 1}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-navy-950">
                Question {questionIndex + 1}
                {question.sourceQuestionId ? <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">From bank</span> : null}
              </p>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={`Move question ${questionIndex + 1} up`} disabled={pending || questionIndex === 0} onClick={() => setDraft({ ...draft, questions: moveArrayItem(draft.questions, questionIndex, 'up') })} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowUp className="size-4" /></button>
                <button type="button" aria-label={`Move question ${questionIndex + 1} down`} disabled={pending || questionIndex === draft.questions.length - 1} onClick={() => setDraft({ ...draft, questions: moveArrayItem(draft.questions, questionIndex, 'down') })} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowDown className="size-4" /></button>
                <button type="button" aria-label={`Remove question ${questionIndex + 1}`} disabled={pending} onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, index) => index !== questionIndex) })} className="rounded-lg p-2 text-rose-700 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="size-4" /></button>
              </div>
            </div>
            <QuestionEditorFields
              draft={question}
              onChange={(next) => updateQuestion(questionIndex, next)}
              label={`Question ${questionIndex + 1}`}
              radioGroup={`quiz-${material.id}-question-${questionIndex}-correct`}
              pending={pending}
            />
          </section>
        ))}
      </div>

      {bankOpen ? <BankPicker existingSources={existingSources} onAdd={addFromBank} onClose={() => setBankOpen(false)} /> : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={addQuestion} className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50"><Plus className="size-4" /> Add question</button>
          <button type="button" onClick={() => setBankOpen(true)} disabled={bankOpen} className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2.5 text-sm font-bold text-teal-800 hover:bg-teal-50 disabled:opacity-50"><Library className="size-4" /> Add from bank</button>
        </div>
        <button type="button" disabled={pending} onClick={() => onSave(courseId, material.id, quizPayload(draft))} className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save quiz
        </button>
      </div>
    </section>
  )
}
