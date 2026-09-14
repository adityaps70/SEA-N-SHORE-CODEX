'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  FileQuestion,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import {
  createCurriculumLesson,
  createCurriculumSection,
  deleteCurriculumLesson,
  deleteCurriculumSection,
  moveCurriculumLesson,
  moveCurriculumSection,
  saveCurriculumQuiz,
  updateCurriculumLesson,
  updateCurriculumSection,
} from '../mentor-curriculum-actions'
import type {
  MentorCurriculum,
  MentorCurriculumLesson,
  MentorLessonDraft,
  MentorLessonType,
  MentorQuizDefinition,
  MentorQuizDefinitionInput,
} from '../mentor-curriculum-repository'

type Props = {
  courseId: string
  curriculum: MentorCurriculum
}

type LessonFormState = {
  title: string
  lessonType: MentorLessonType
  summary: string
  articleBody: string
  assetPath: string
  externalUrl: string
  durationSeconds: string
  isPreview: boolean
  isDownloadable: boolean
}

type QuizDraftState = {
  passPercentage: string
  instructions: string
  questions: Array<{
    prompt: string
    options: Array<{ label: string; isCorrect: boolean }>
  }>
}

type ActionResult = { ok: true } | { ok: true; sectionId: string } | { ok: true; lessonId: string } | { ok: false; error: string }

type Message = { tone: 'success' | 'error'; copy: string } | null

const lessonTypeOptions: Array<{ value: MentorLessonType; label: string }> = [
  { value: 'article', label: 'Article' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'pdf', label: 'PDF' },
  { value: 'presentation_document', label: 'Presentation / document' },
  { value: 'quiz', label: 'Quiz / assessment' },
  { value: 'downloadable_resource', label: 'Downloadable resource' },
  { value: 'assignment', label: 'Assignment · not publishable yet' },
  { value: 'live_session', label: 'Live session · not publishable yet' },
]

const sourceLessonTypes = new Set<MentorLessonType>([
  'video',
  'audio',
  'pdf',
  'presentation_document',
  'downloadable_resource',
])

function inputClassName() {
  return 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none transition placeholder:text-muted/60 focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
}

function emptyLessonState(): LessonFormState {
  return {
    title: '',
    lessonType: 'article',
    summary: '',
    articleBody: '',
    assetPath: '',
    externalUrl: '',
    durationSeconds: '',
    isPreview: false,
    isDownloadable: false,
  }
}

function lessonStateFromPersisted(lesson: MentorCurriculumLesson): LessonFormState {
  return {
    title: lesson.title,
    lessonType: lesson.lessonType,
    summary: lesson.summary ?? '',
    articleBody: lesson.articleBody ?? '',
    assetPath: lesson.assetPath ?? '',
    externalUrl: lesson.externalUrl ?? '',
    durationSeconds: lesson.durationSeconds === null ? '' : String(lesson.durationSeconds),
    isPreview: lesson.isPreview,
    isDownloadable: lesson.isDownloadable,
  }
}

function lessonPayload(form: LessonFormState): MentorLessonDraft {
  const duration = form.durationSeconds.trim() ? Number(form.durationSeconds) : null
  return {
    title: form.title,
    lessonType: form.lessonType,
    summary: form.summary.trim() || null,
    articleBody: form.articleBody.trim() || null,
    assetPath: form.assetPath.trim() || null,
    externalUrl: form.externalUrl.trim() || null,
    durationSeconds: duration !== null && Number.isFinite(duration) ? duration : null,
    isPreview: form.isPreview,
    isDownloadable: form.isDownloadable,
  }
}

function quizStateFromPersisted(quiz: MentorQuizDefinition | null): QuizDraftState {
  if (!quiz) {
    return {
      passPercentage: '80',
      instructions: '',
      questions: [],
    }
  }

  return {
    passPercentage: String(quiz.passPercentage),
    instructions: quiz.instructions ?? '',
    questions: quiz.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    })),
  }
}

function quizPayload(draft: QuizDraftState): MentorQuizDefinitionInput {
  return {
    passPercentage: Number(draft.passPercentage),
    instructions: draft.instructions.trim() || null,
    questions: draft.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    })),
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

function LessonFields({
  prefix,
  form,
  setForm,
}: {
  prefix: 'New' | 'Edit'
  form: LessonFormState
  setForm: (updater: (current: LessonFormState) => LessonFormState) => void
}) {
  function update<K extends keyof LessonFormState>(key: K, value: LessonFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-navy-950">
          Lesson title
          <input
            aria-label={`${prefix} lesson title`}
            className={inputClassName()}
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
          />
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Lesson type
          <select
            aria-label={`${prefix} lesson type`}
            className={inputClassName()}
            value={form.lessonType}
            onChange={(event) => update('lessonType', event.target.value as MentorLessonType)}
          >
            {lessonTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="text-sm font-semibold text-navy-950">
        Summary <span className="font-normal text-muted">(optional)</span>
        <textarea
          aria-label={`${prefix} lesson summary`}
          className={`${inputClassName()} min-h-24 resize-y`}
          value={form.summary}
          onChange={(event) => update('summary', event.target.value)}
        />
      </label>

      {form.lessonType === 'article' ? (
        <label className="text-sm font-semibold text-navy-950">
          Article content
          <textarea
            aria-label={`${prefix} lesson article content`}
            className={`${inputClassName()} min-h-36 resize-y`}
            value={form.articleBody}
            onChange={(event) => update('articleBody', event.target.value)}
          />
        </label>
      ) : null}

      {sourceLessonTypes.has(form.lessonType) ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-navy-950">
            Uploaded asset path <span className="font-normal text-muted">(optional if URL is used)</span>
            <input
              aria-label={`${prefix} lesson asset path`}
              className={inputClassName()}
              value={form.assetPath}
              onChange={(event) => update('assetPath', event.target.value)}
            />
          </label>
          <label className="text-sm font-semibold text-navy-950">
            External URL <span className="font-normal text-muted">(optional if asset is used)</span>
            <input
              aria-label={`${prefix} lesson external URL`}
              className={inputClassName()}
              value={form.externalUrl}
              onChange={(event) => update('externalUrl', event.target.value)}
              placeholder="https://"
            />
          </label>
        </div>
      ) : null}

      {form.lessonType === 'live_session' ? (
        <label className="text-sm font-semibold text-navy-950">
          Meeting URL
          <input
            aria-label={`${prefix} lesson external URL`}
            className={inputClassName()}
            value={form.externalUrl}
            onChange={(event) => update('externalUrl', event.target.value)}
            placeholder="https://"
          />
        </label>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold text-navy-950">
          Duration (seconds) <span className="font-normal text-muted">(optional)</span>
          <input
            aria-label={`${prefix} lesson duration seconds`}
            type="number"
            min="0"
            step="1"
            className={inputClassName()}
            value={form.durationSeconds}
            onChange={(event) => update('durationSeconds', event.target.value)}
          />
        </label>
        <label className="mt-7 flex items-center gap-2 text-sm font-semibold text-navy-950">
          <input
            type="checkbox"
            checked={form.isPreview}
            onChange={(event) => update('isPreview', event.target.checked)}
          />
          Learner preview
        </label>
        <label className="mt-7 flex items-center gap-2 text-sm font-semibold text-navy-950">
          <input
            type="checkbox"
            checked={form.isDownloadable}
            onChange={(event) => update('isDownloadable', event.target.checked)}
          />
          Downloadable
        </label>
      </div>

      {form.lessonType === 'quiz' ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Create the quiz lesson first, then use its assessment editor to add questions, answer options and the pass mark.
        </p>
      ) : null}
      {form.lessonType === 'assignment' || form.lessonType === 'live_session' ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          This activity can be drafted, but course submission will remain blocked until its native learner completion flow is connected.
        </p>
      ) : null}
    </div>
  )
}

function QuizEditor({
  courseId,
  lesson,
  draft,
  setDraft,
  pending,
  onSave,
  onCancel,
}: {
  courseId: string
  lesson: MentorCurriculumLesson
  draft: QuizDraftState
  setDraft: (next: QuizDraftState) => void
  pending: boolean
  onSave: (courseId: string, lessonId: string, input: MentorQuizDefinitionInput) => void
  onCancel: () => void
}) {
  function updateQuestion(questionIndex: number, prompt: string) {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, prompt } : question),
    })
  }

  function updateOption(questionIndex: number, optionIndex: number, label: string) {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex
        ? {
            ...question,
            options: question.options.map((option, innerIndex) => innerIndex === optionIndex ? { ...option, label } : option),
          }
        : question),
    })
  }

  function markCorrect(questionIndex: number, optionIndex: number) {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex
        ? {
            ...question,
            options: question.options.map((option, innerIndex) => ({ ...option, isCorrect: innerIndex === optionIndex })),
          }
        : question),
    })
  }

  function addQuestion() {
    setDraft({
      ...draft,
      questions: [...draft.questions, {
        prompt: '',
        options: [
          { label: '', isCorrect: false },
          { label: '', isCorrect: false },
        ],
      }],
    })
  }

  function removeQuestion(questionIndex: number) {
    setDraft({ ...draft, questions: draft.questions.filter((_, index) => index !== questionIndex) })
  }

  function moveQuestion(questionIndex: number, direction: 'up' | 'down') {
    setDraft({ ...draft, questions: moveArrayItem(draft.questions, questionIndex, direction) })
  }

  function addOption(questionIndex: number) {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex
        ? { ...question, options: [...question.options, { label: '', isCorrect: false }] }
        : question),
    })
  }

  function removeOption(questionIndex: number, optionIndex: number) {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex
        ? { ...question, options: question.options.filter((_, innerIndex) => innerIndex !== optionIndex) }
        : question),
    })
  }

  function moveOption(questionIndex: number, optionIndex: number, direction: 'up' | 'down') {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex
        ? { ...question, options: moveArrayItem(question.options, optionIndex, direction) }
        : question),
    })
  }

  return (
    <section className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 sm:p-5" aria-label={`Quiz editor ${lesson.title}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-sky-700">
            <FileQuestion className="size-4" aria-hidden="true" /> Assessment editor
          </p>
          <h4 className="mt-1 font-bold text-navy-950">{lesson.title}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">Correct answers stay in mentor/admin authoring data and are never returned in the learner quiz read model.</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg p-2 text-muted hover:bg-white" aria-label={`Close quiz editor ${lesson.title}`}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[180px_1fr]">
        <label className="text-sm font-semibold text-navy-950">
          Pass percentage
          <input
            aria-label="Quiz pass percentage"
            type="number"
            min="1"
            max="100"
            step="1"
            className={inputClassName()}
            value={draft.passPercentage}
            onChange={(event) => setDraft({ ...draft, passPercentage: event.target.value })}
          />
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Instructions <span className="font-normal text-muted">(optional)</span>
          <textarea
            aria-label="Quiz instructions"
            className={`${inputClassName()} min-h-20 resize-y`}
            value={draft.instructions}
            onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
          />
        </label>
      </div>

      <div className="mt-5 space-y-4">
        {draft.questions.map((question, questionIndex) => (
          <section key={questionIndex} className="rounded-2xl border border-mist-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-navy-950">Question {questionIndex + 1}</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move question ${questionIndex + 1} up`}
                  disabled={pending || questionIndex === 0}
                  onClick={() => moveQuestion(questionIndex, 'up')}
                  className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"
                ><ArrowUp className="size-4" aria-hidden="true" /></button>
                <button
                  type="button"
                  aria-label={`Move question ${questionIndex + 1} down`}
                  disabled={pending || questionIndex === draft.questions.length - 1}
                  onClick={() => moveQuestion(questionIndex, 'down')}
                  className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"
                ><ArrowDown className="size-4" aria-hidden="true" /></button>
                <button
                  type="button"
                  aria-label={`Remove question ${questionIndex + 1}`}
                  disabled={pending}
                  onClick={() => removeQuestion(questionIndex)}
                  className="rounded-lg p-2 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                ><Trash2 className="size-4" aria-hidden="true" /></button>
              </div>
            </div>

            <label className="mt-3 block text-sm font-semibold text-navy-950">
              Prompt
              <textarea
                aria-label={`Question ${questionIndex + 1} prompt`}
                className={`${inputClassName()} min-h-20 resize-y`}
                value={question.prompt}
                onChange={(event) => updateQuestion(questionIndex, event.target.value)}
              />
            </label>

            <div className="mt-4 space-y-2">
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="grid gap-2 rounded-xl border border-mist-100 bg-mist-50/50 p-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <label className="flex items-center gap-2 text-xs font-bold text-navy-950">
                    <input
                      aria-label={`Question ${questionIndex + 1} option ${optionIndex + 1} correct`}
                      type="radio"
                      name={`quiz-${lesson.id}-question-${questionIndex}-correct`}
                      checked={option.isCorrect}
                      onChange={() => markCorrect(questionIndex, optionIndex)}
                    />
                    Correct
                  </label>
                  <input
                    aria-label={`Question ${questionIndex + 1} option ${optionIndex + 1}`}
                    className="min-h-10 rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-teal-500"
                    value={option.label}
                    onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)}
                  />
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" aria-label={`Move question ${questionIndex + 1} option ${optionIndex + 1} up`} disabled={optionIndex === 0} onClick={() => moveOption(questionIndex, optionIndex, 'up')} className="rounded-lg p-1.5 text-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label={`Move question ${questionIndex + 1} option ${optionIndex + 1} down`} disabled={optionIndex === question.options.length - 1} onClick={() => moveOption(questionIndex, optionIndex, 'down')} className="rounded-lg p-1.5 text-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label={`Remove question ${questionIndex + 1} option ${optionIndex + 1}`} onClick={() => removeOption(questionIndex, optionIndex)} className="rounded-lg p-1.5 text-rose-700"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              aria-label={`Add option to question ${questionIndex + 1}`}
              onClick={() => addOption(questionIndex)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-navy-950 hover:bg-mist-50"
            >
              <Plus className="size-3.5" aria-hidden="true" /> Add answer option
            </button>
          </section>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={addQuestion} className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50">
          <Plus className="size-4" aria-hidden="true" /> Add question
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave(courseId, lesson.id, quizPayload(draft))}
          className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          Save quiz
        </button>
      </div>
    </section>
  )
}

export function MentorCurriculumEditor({ courseId, curriculum }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<Message>(null)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingSectionTitle, setEditingSectionTitle] = useState('')
  const [confirmDeleteSectionId, setConfirmDeleteSectionId] = useState<string | null>(null)
  const [addingLessonSectionId, setAddingLessonSectionId] = useState<string | null>(null)
  const [newLesson, setNewLesson] = useState<LessonFormState>(emptyLessonState)
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null)
  const [editingLesson, setEditingLesson] = useState<LessonFormState>(emptyLessonState)
  const [confirmDeleteLessonId, setConfirmDeleteLessonId] = useState<string | null>(null)
  const [quizEditingLessonId, setQuizEditingLessonId] = useState<string | null>(null)
  const [quizDraft, setQuizDraft] = useState<QuizDraftState>({ passPercentage: '80', instructions: '', questions: [] })

  function runAction(action: () => Promise<ActionResult>, successCopy?: string, afterSuccess?: () => void) {
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setMessage({ tone: 'error', copy: result.error })
        return
      }
      afterSuccess?.()
      if (successCopy) setMessage({ tone: 'success', copy: successCopy })
      router.refresh()
    })
  }

  function beginLessonEdit(lesson: MentorCurriculumLesson) {
    setEditingLessonId(lesson.id)
    setEditingLesson(lessonStateFromPersisted(lesson))
    setQuizEditingLessonId(null)
  }

  function beginQuizEdit(lesson: MentorCurriculumLesson) {
    setQuizEditingLessonId(lesson.id)
    setQuizDraft(quizStateFromPersisted(lesson.quiz))
    setEditingLessonId(null)
  }

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6" aria-label="Curriculum authoring">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Learning sequence</p>
          <h2 className="mt-1 text-2xl font-bold text-navy-950">Curriculum</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Build modules and lessons in the order learners should complete them. Curriculum becomes read-only once this course is submitted for Sea N Shore review.
          </p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-950">
          <p className="font-bold">Submission readiness</p>
          <p>Every section needs a lesson. Articles need content, media lessons need a source, and quizzes need a valid assessment.</p>
        </div>
      </div>

      {message ? (
        <div
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${message.tone === 'error' ? 'border border-rose-200 bg-rose-50 text-rose-900' : 'border border-emerald-200 bg-emerald-50 text-emerald-900'}`}
        >
          {message.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <span>{message.copy}</span>
        </div>
      ) : null}

      <form
        className="mt-5 flex flex-col gap-3 rounded-2xl border border-dashed border-mist-200 bg-mist-50/50 p-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          runAction(
            () => createCurriculumSection(courseId, newSectionTitle),
            'Section added.',
            () => setNewSectionTitle(''),
          )
        }}
      >
        <label className="flex-1 text-sm font-semibold text-navy-950">
          New section title
          <input
            aria-label="New section title"
            className={inputClassName()}
            value={newSectionTitle}
            onChange={(event) => setNewSectionTitle(event.target.value)}
            placeholder="e.g. Module 1 · Inspection foundations"
          />
        </label>
        <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          Add section
        </button>
      </form>

      <div className="mt-5 space-y-5">
        {curriculum.sections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-mist-200 bg-mist-50/60 p-6 text-center">
            <p className="font-bold text-navy-950">No curriculum sections yet</p>
            <p className="mt-1 text-sm text-muted">Add the first section above. No lesson or assessment content is generated automatically.</p>
          </div>
        ) : null}

        {curriculum.sections.map((section, sectionIndex) => (
          <section key={section.id} className="overflow-hidden rounded-2xl border border-mist-200 bg-mist-50/30">
            <header className="flex flex-col gap-3 border-b border-mist-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Section {sectionIndex + 1}</p>
                {editingSectionId === section.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      aria-label={`Section title for ${section.title}`}
                      className="min-h-10 min-w-64 flex-1 rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm font-semibold text-navy-950 outline-none focus:border-teal-500"
                      value={editingSectionTitle}
                      onChange={(event) => setEditingSectionTitle(event.target.value)}
                    />
                    <button type="button" disabled={pending} onClick={() => runAction(() => updateCurriculumSection(courseId, section.id, editingSectionTitle), 'Section title saved.', () => setEditingSectionId(null))} className="rounded-lg bg-navy-950 px-3 py-2 text-xs font-bold text-white">Save title</button>
                    <button type="button" onClick={() => setEditingSectionId(null)} className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-muted">Cancel</button>
                  </div>
                ) : (
                  <h3 className="mt-1 truncate text-lg font-bold text-navy-950">{section.title}</h3>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <button type="button" aria-label={`Move ${section.title} up`} disabled={pending || sectionIndex === 0} onClick={() => runAction(() => moveCurriculumSection(courseId, section.id, 'up'))} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowUp className="size-4" /></button>
                <button type="button" aria-label={`Move ${section.title} down`} disabled={pending || sectionIndex === curriculum.sections.length - 1} onClick={() => runAction(() => moveCurriculumSection(courseId, section.id, 'down'))} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowDown className="size-4" /></button>
                <button type="button" aria-label={`Rename ${section.title}`} disabled={pending} onClick={() => { setEditingSectionId(section.id); setEditingSectionTitle(section.title) }} className="rounded-lg p-2 text-muted hover:bg-mist-50"><Pencil className="size-4" /></button>
                {confirmDeleteSectionId === section.id ? (
                  <>
                    <button type="button" aria-label={`Confirm delete ${section.title}`} disabled={pending} onClick={() => runAction(() => deleteCurriculumSection(courseId, section.id), 'Section deleted.', () => setConfirmDeleteSectionId(null))} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white">Confirm delete</button>
                    <button type="button" aria-label={`Cancel delete ${section.title}`} onClick={() => setConfirmDeleteSectionId(null)} className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-muted">Cancel</button>
                  </>
                ) : (
                  <button type="button" aria-label={`Delete ${section.title}`} disabled={pending} onClick={() => setConfirmDeleteSectionId(section.id)} className="rounded-lg p-2 text-rose-700 hover:bg-rose-50"><Trash2 className="size-4" /></button>
                )}
              </div>
            </header>

            <div className="space-y-3 p-4">
              {section.lessons.length === 0 ? (
                <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">This section needs at least one lesson before the course can be submitted.</p>
              ) : null}

              {section.lessons.map((lesson, lessonIndex) => (
                <article key={lesson.id} className="rounded-2xl border border-mist-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-mist-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{lesson.lessonType.replaceAll('_', ' ')}</span>
                        <span className="text-xs font-semibold text-muted">Lesson {lessonIndex + 1}</span>
                      </div>
                      <h4 className="mt-2 font-bold text-navy-950">{lesson.title}</h4>
                      {lesson.summary ? <p className="mt-1 text-sm leading-6 text-muted">{lesson.summary}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button" aria-label={`Move ${lesson.title} up`} disabled={pending || lessonIndex === 0} onClick={() => runAction(() => moveCurriculumLesson(courseId, lesson.id, 'up'))} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowUp className="size-4" /></button>
                      <button type="button" aria-label={`Move ${lesson.title} down`} disabled={pending || lessonIndex === section.lessons.length - 1} onClick={() => runAction(() => moveCurriculumLesson(courseId, lesson.id, 'down'))} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowDown className="size-4" /></button>
                      <button type="button" aria-label={`Edit ${lesson.title}`} disabled={pending} onClick={() => beginLessonEdit(lesson)} className="rounded-lg p-2 text-muted hover:bg-mist-50"><Pencil className="size-4" /></button>
                      {lesson.lessonType === 'quiz' ? (
                        <button type="button" aria-label={`Edit quiz ${lesson.title}`} disabled={pending} onClick={() => beginQuizEdit(lesson)} className="rounded-lg p-2 text-sky-700 hover:bg-sky-50"><FileQuestion className="size-4" /></button>
                      ) : null}
                      {confirmDeleteLessonId === lesson.id ? (
                        <>
                          <button type="button" aria-label={`Confirm delete ${lesson.title}`} disabled={pending} onClick={() => runAction(() => deleteCurriculumLesson(courseId, lesson.id), 'Lesson deleted.', () => setConfirmDeleteLessonId(null))} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white">Confirm delete</button>
                          <button type="button" aria-label={`Cancel delete ${lesson.title}`} onClick={() => setConfirmDeleteLessonId(null)} className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-muted">Cancel</button>
                        </>
                      ) : (
                        <button type="button" aria-label={`Delete ${lesson.title}`} disabled={pending} onClick={() => setConfirmDeleteLessonId(lesson.id)} className="rounded-lg p-2 text-rose-700 hover:bg-rose-50"><Trash2 className="size-4" /></button>
                      )}
                    </div>
                  </div>

                  {editingLessonId === lesson.id ? (
                    <div className="mt-4 border-t border-mist-100 pt-4">
                      <LessonFields prefix="Edit" form={editingLesson} setForm={setEditingLesson} />
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setEditingLessonId(null)} className="rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-muted">Cancel</button>
                        <button type="button" disabled={pending} onClick={() => runAction(() => updateCurriculumLesson(courseId, lesson.id, lessonPayload(editingLesson)), 'Lesson changes saved.', () => setEditingLessonId(null))} className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"><Save className="size-4" /> Save lesson changes</button>
                      </div>
                    </div>
                  ) : null}

                  {quizEditingLessonId === lesson.id ? (
                    <QuizEditor
                      courseId={courseId}
                      lesson={lesson}
                      draft={quizDraft}
                      setDraft={setQuizDraft}
                      pending={pending}
                      onCancel={() => setQuizEditingLessonId(null)}
                      onSave={(currentCourseId, lessonId, input) => runAction(() => saveCurriculumQuiz(currentCourseId, lessonId, input), 'Quiz saved.', () => setQuizEditingLessonId(null))}
                    />
                  ) : null}
                </article>
              ))}

              {addingLessonSectionId === section.id ? (
                <form
                  className="rounded-2xl border border-teal-200 bg-teal-50/50 p-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    runAction(
                      () => createCurriculumLesson(courseId, section.id, lessonPayload(newLesson)),
                      'Lesson created.',
                      () => {
                        setAddingLessonSectionId(null)
                        setNewLesson(emptyLessonState())
                      },
                    )
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-bold text-navy-950">Add lesson</h4>
                    <button type="button" aria-label={`Close add lesson for ${section.title}`} onClick={() => setAddingLessonSectionId(null)} className="rounded-lg p-2 text-muted"><X className="size-4" /></button>
                  </div>
                  <div className="mt-4"><LessonFields prefix="New" form={newLesson} setForm={setNewLesson} /></div>
                  <div className="mt-4 flex justify-end">
                    <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"><Plus className="size-4" /> Create lesson</button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  aria-label={`Add lesson to ${section.title}`}
                  onClick={() => {
                    setAddingLessonSectionId(section.id)
                    setNewLesson(emptyLessonState())
                    setEditingLessonId(null)
                    setQuizEditingLessonId(null)
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50"
                >
                  <Plus className="size-4" aria-hidden="true" /> Add lesson
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-mist-200 bg-mist-50 px-4 py-3 text-xs leading-5 text-muted">
        <ChevronDown className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>Use the arrow controls to set the persisted learning order. Reordering is saved immediately and does not rely on visual-only drag state.</p>
      </div>
    </section>
  )
}
