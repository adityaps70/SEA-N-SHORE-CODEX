'use client'

import { useMemo, useState, useTransition } from 'react'
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
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import {
  createCurriculumSection,
  deleteCurriculumLesson,
  deleteCurriculumSection,
  moveCurriculumLesson,
  moveCurriculumSection,
  saveCurriculumQuiz,
  updateCurriculumSection,
} from '../mentor-curriculum-actions'
import {
  createCurriculumMaterial,
  updateCourseNavigationMode,
  updateCurriculumMaterial,
} from '../mentor-material-actions'
import type {
  MaterialCompletionRule,
  MaterialEmbedKind,
  MaterialReleaseMode,
  MaterialType,
  MentorMaterial,
  MentorMaterialCurriculum,
  MentorMaterialDraft,
} from '../mentor-material-repository'
import type {
  MentorQuizDefinition,
  MentorQuizDefinitionInput,
} from '../mentor-curriculum-repository'
import { processCurriculumScormPackage } from '../scorm-authoring-actions'
import { learningMediaAccept, type LearningMediaKind } from '../media-policy'
import { LearningMediaUploadField } from './learning-media-upload-field'

type Props = {
  courseId: string
  curriculum: MentorMaterialCurriculum
}

type MaterialFormState = {
  title: string
  materialType: MaterialType
  summary: string
  articleBody: string
  assetPath: string
  externalUrl: string
  durationSeconds: string
  isPreview: boolean
  isDownloadable: boolean
  isPublished: boolean
  releaseMode: MaterialReleaseMode
  releaseAt: string
  dripDelayDays: string
  prerequisiteLessonId: string
  completionRule: MaterialCompletionRule
  completionThreshold: string
  maxAttempts: string
  embedKind: MaterialEmbedKind
  assignmentInstructions: string
  assignmentExtensions: string
  assignmentMaxUploadMb: string
}

type QuizDraftState = {
  passPercentage: string
  instructions: string
  questions: Array<{
    prompt: string
    options: Array<{ label: string; isCorrect: boolean }>
  }>
}

type ActionResult =
  | { ok: true }
  | { ok: true; sectionId: string }
  | { ok: false; error: string }

type Message = { tone: 'success' | 'error'; copy: string } | null

const materialTypeOptions: Array<{ value: MaterialType; label: string }> = [
  { value: 'article', label: 'Article / text' },
  { value: 'video', label: 'Video' },
  { value: 'image', label: 'Image' },
  { value: 'audio', label: 'Audio' },
  { value: 'pdf', label: 'PDF' },
  { value: 'presentation_document', label: 'Presentation / document' },
  { value: 'external_embed', label: 'YouTube / Vimeo / embed' },
  { value: 'quiz', label: 'Quiz / assessment' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'downloadable_resource', label: 'Downloadable resource' },
  { value: 'scorm', label: 'SCORM package' },
  { value: 'live_session', label: 'Live session' },
]

function inputClassName() {
  return 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none transition placeholder:text-muted/60 focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
}

function completionDefaults(type: MaterialType): Pick<MaterialFormState, 'completionRule' | 'completionThreshold'> {
  if (type === 'video' || type === 'audio') return { completionRule: 'media_percentage', completionThreshold: '90' }
  if (type === 'quiz') return { completionRule: 'quiz_pass', completionThreshold: '' }
  if (type === 'assignment') return { completionRule: 'assignment_submit', completionThreshold: '' }
  if (type === 'scorm') return { completionRule: 'scorm_completion', completionThreshold: '' }
  if (type === 'live_session') return { completionRule: 'manual', completionThreshold: '' }
  return { completionRule: 'view', completionThreshold: '' }
}

function emptyMaterialState(): MaterialFormState {
  return {
    title: '',
    materialType: 'article',
    summary: '',
    articleBody: '',
    assetPath: '',
    externalUrl: '',
    durationSeconds: '',
    isPreview: false,
    isDownloadable: false,
    isPublished: true,
    releaseMode: 'immediate',
    releaseAt: '',
    dripDelayDays: '',
    prerequisiteLessonId: '',
    completionRule: 'view',
    completionThreshold: '',
    maxAttempts: '',
    embedKind: 'youtube',
    assignmentInstructions: '',
    assignmentExtensions: '.pdf,.doc,.docx,.jpg,.png',
    assignmentMaxUploadMb: '10',
  }
}

function localDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function materialStateFromPersisted(material: MentorMaterial): MaterialFormState {
  return {
    title: material.title,
    materialType: material.materialType,
    summary: material.summary ?? '',
    articleBody: material.articleBody ?? '',
    assetPath: material.assetPath ?? '',
    externalUrl: material.externalUrl ?? '',
    durationSeconds: material.durationSeconds === null ? '' : String(material.durationSeconds),
    isPreview: material.isPreview,
    isDownloadable: material.isDownloadable,
    isPublished: material.isPublished,
    releaseMode: material.releaseMode,
    releaseAt: localDateTime(material.releaseAt),
    dripDelayDays: material.dripDelayDays === null ? '' : String(material.dripDelayDays),
    prerequisiteLessonId: material.prerequisiteLessonId ?? '',
    completionRule: material.completionRule,
    completionThreshold: material.completionThreshold === null ? '' : String(material.completionThreshold),
    maxAttempts: material.maxAttempts === null ? '' : String(material.maxAttempts),
    embedKind: material.embedKind ?? 'youtube',
    assignmentInstructions: material.assignment?.instructions ?? '',
    assignmentExtensions: material.assignment?.acceptedExtensions.join(',') ?? '.pdf,.doc,.docx,.jpg,.png',
    assignmentMaxUploadMb: material.assignment ? String(Math.max(1, Math.round(material.assignment.maxUploadBytes / (1024 * 1024)))) : '10',
  }
}

function numericOrNull(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function scheduledIso(value: string) {
  if (!value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

function materialPayload(form: MaterialFormState): MentorMaterialDraft {
  const assignmentExtensions = form.assignmentExtensions
    .split(',')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .map((extension) => extension.startsWith('.') ? extension : `.${extension}`)
  const maxUploadMb = Math.max(1, numericOrNull(form.assignmentMaxUploadMb) ?? 10)

  return {
    title: form.title,
    materialType: form.materialType,
    summary: form.summary.trim() || null,
    articleBody: form.materialType === 'article' ? form.articleBody.trim() || null : null,
    assetPath: form.assetPath.trim() || null,
    externalUrl: form.externalUrl.trim() || null,
    durationSeconds: numericOrNull(form.durationSeconds),
    isPreview: form.isPreview,
    isDownloadable: form.isDownloadable,
    isPublished: form.isPublished,
    releaseMode: form.releaseMode,
    releaseAt: form.releaseMode === 'scheduled' ? scheduledIso(form.releaseAt) : null,
    dripDelayDays: form.releaseMode === 'drip' ? numericOrNull(form.dripDelayDays) : null,
    prerequisiteLessonId: form.prerequisiteLessonId || null,
    completionRule: form.completionRule,
    completionThreshold: form.completionRule === 'media_percentage' ? numericOrNull(form.completionThreshold) : null,
    maxAttempts: numericOrNull(form.maxAttempts),
    embedKind: form.materialType === 'external_embed' ? form.embedKind : null,
    assignment: form.materialType === 'assignment'
      ? {
          instructions: form.assignmentInstructions.trim(),
          acceptedExtensions: assignmentExtensions,
          maxUploadBytes: Math.round(maxUploadMb * 1024 * 1024),
        }
      : null,
  }
}

function quizStateFromPersisted(quiz: MentorQuizDefinition | null): QuizDraftState {
  if (!quiz) return { passPercentage: '80', instructions: '', questions: [] }
  return {
    passPercentage: String(quiz.passPercentage),
    instructions: quiz.instructions ?? '',
    questions: quiz.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({ label: option.label, isCorrect: option.isCorrect })),
    })),
  }
}

function quizPayload(draft: QuizDraftState): MentorQuizDefinitionInput {
  return {
    passPercentage: Number(draft.passPercentage),
    instructions: draft.instructions.trim() || null,
    questions: draft.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({ label: option.label, isCorrect: option.isCorrect })),
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

function uploadConfiguration(type: MaterialType): null | {
  kind: LearningMediaKind
  label: string
  previewType: 'image' | 'video' | 'file'
} {
  switch (type) {
    case 'video': return { kind: 'lesson_video', label: 'Lesson video', previewType: 'video' }
    case 'image': return { kind: 'lesson_image', label: 'Lesson image', previewType: 'image' }
    case 'audio': return { kind: 'lesson_audio', label: 'Lesson audio', previewType: 'file' }
    case 'pdf': return { kind: 'lesson_document', label: 'PDF material', previewType: 'file' }
    case 'presentation_document': return { kind: 'lesson_document', label: 'Document / presentation', previewType: 'file' }
    case 'downloadable_resource': return { kind: 'lesson_resource', label: 'Downloadable resource', previewType: 'file' }
    case 'scorm': return { kind: 'scorm_package', label: 'SCORM ZIP', previewType: 'file' }
    default: return null
  }
}

function MaterialFields({
  courseId,
  prefix,
  form,
  setForm,
  availableMaterials,
  currentMaterialId,
}: {
  courseId: string
  prefix: 'New' | 'Edit'
  form: MaterialFormState
  setForm: (updater: (current: MaterialFormState) => MaterialFormState) => void
  availableMaterials: MentorMaterial[]
  currentMaterialId?: string | null
}) {
  function update<K extends keyof MaterialFormState>(key: K, value: MaterialFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateMaterialType(nextType: MaterialType) {
    setForm((current) => ({
      ...current,
      materialType: nextType,
      ...completionDefaults(nextType),
      assetPath: current.materialType === nextType ? current.assetPath : '',
      externalUrl: current.materialType === nextType ? current.externalUrl : '',
    }))
  }

  const upload = uploadConfiguration(form.materialType)
  const attemptLimited = form.materialType === 'quiz' || form.materialType === 'assignment' || form.materialType === 'scorm'
  const completionRules: Array<{ value: MaterialCompletionRule; label: string }> = form.materialType === 'video' || form.materialType === 'audio'
    ? [
        { value: 'media_percentage', label: 'Automatic after media percentage' },
        { value: 'view', label: 'Automatic when opened' },
        { value: 'manual', label: 'Learner marks complete' },
      ]
    : form.materialType === 'quiz'
      ? [{ value: 'quiz_pass', label: 'Pass quiz' }]
      : form.materialType === 'assignment'
        ? [{ value: 'assignment_submit', label: 'Submit assignment' }]
        : form.materialType === 'scorm'
          ? [{ value: 'scorm_completion', label: 'SCORM completion status' }]
          : [
              { value: 'view', label: 'Automatic when opened' },
              { value: 'manual', label: 'Learner marks complete' },
            ]

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-navy-950">
          Material title
          <input aria-label={`${prefix} material title`} className={inputClassName()} value={form.title} onChange={(event) => update('title', event.target.value)} />
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Material type
          <select aria-label={`${prefix} material type`} className={inputClassName()} value={form.materialType} onChange={(event) => updateMaterialType(event.target.value as MaterialType)}>
            {materialTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <label className="text-sm font-semibold text-navy-950">
        Summary <span className="font-normal text-muted">(optional)</span>
        <textarea aria-label={`${prefix} material summary`} className={`${inputClassName()} min-h-24 resize-y`} value={form.summary} onChange={(event) => update('summary', event.target.value)} />
      </label>

      {form.materialType === 'article' ? (
        <label className="text-sm font-semibold text-navy-950">
          Article content
          <textarea aria-label={`${prefix} material article content`} className={`${inputClassName()} min-h-44 resize-y`} value={form.articleBody} onChange={(event) => update('articleBody', event.target.value)} />
        </label>
      ) : null}

      {upload ? (
        <LearningMediaUploadField
          courseId={courseId}
          kind={upload.kind}
          label={upload.label}
          inputAriaLabel={`${prefix} ${upload.label} file`}
          value={form.assetPath.trim() || null}
          onChange={(storagePath) => update('assetPath', storagePath ?? '')}
          accept={learningMediaAccept(upload.kind)}
          previewType={upload.previewType}
        />
      ) : null}

      {form.materialType === 'video' ? (
        <label className="text-sm font-semibold text-navy-950">
          External video URL <span className="font-normal text-muted">(optional alternative to upload)</span>
          <input aria-label={`${prefix} material external URL`} className={inputClassName()} value={form.externalUrl} onChange={(event) => update('externalUrl', event.target.value)} placeholder="https://" />
        </label>
      ) : null}

      {form.materialType === 'external_embed' ? (
        <div className="grid gap-4 md:grid-cols-[180px_1fr]">
          <label className="text-sm font-semibold text-navy-950">
            Embed provider
            <select aria-label={`${prefix} material embed provider`} className={inputClassName()} value={form.embedKind} onChange={(event) => update('embedKind', event.target.value as MaterialEmbedKind)}>
              <option value="youtube">YouTube</option>
              <option value="vimeo">Vimeo</option>
              <option value="generic">Generic HTTPS embed</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-950">
            Video / embed URL
            <input aria-label={`${prefix} material external URL`} className={inputClassName()} value={form.externalUrl} onChange={(event) => update('externalUrl', event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </label>
        </div>
      ) : null}

      {form.materialType === 'live_session' ? (
        <label className="text-sm font-semibold text-navy-950">
          Live session URL
          <input aria-label={`${prefix} material external URL`} className={inputClassName()} value={form.externalUrl} onChange={(event) => update('externalUrl', event.target.value)} placeholder="https://" />
        </label>
      ) : null}

      {form.materialType === 'assignment' ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="text-sm font-bold text-navy-950">Assignment settings</p>
          <label className="mt-3 block text-sm font-semibold text-navy-950">
            Learner instructions
            <textarea aria-label={`${prefix} assignment instructions`} className={`${inputClassName()} min-h-32 resize-y`} value={form.assignmentInstructions} onChange={(event) => update('assignmentInstructions', event.target.value)} />
          </label>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-navy-950">
              Accepted extensions
              <input aria-label={`${prefix} assignment extensions`} className={inputClassName()} value={form.assignmentExtensions} onChange={(event) => update('assignmentExtensions', event.target.value)} placeholder=".pdf,.docx,.jpg" />
            </label>
            <label className="text-sm font-semibold text-navy-950">
              Maximum upload size (MB)
              <input aria-label={`${prefix} assignment maximum upload MB`} type="number" min="1" max="100" className={inputClassName()} value={form.assignmentMaxUploadMb} onChange={(event) => update('assignmentMaxUploadMb', event.target.value)} />
            </label>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-mist-200 bg-mist-50/50 p-4">
        <div className="flex items-center gap-2">
          <Settings2 className="size-4 text-teal-700" aria-hidden="true" />
          <p className="text-sm font-bold text-navy-950">Availability & completion</p>
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-navy-950">
            Release
            <select aria-label={`${prefix} material release`} className={inputClassName()} value={form.releaseMode} onChange={(event) => update('releaseMode', event.target.value as MaterialReleaseMode)}>
              <option value="immediate">Immediate</option>
              <option value="scheduled">Scheduled release</option>
              <option value="drip">Drip after enrollment</option>
            </select>
          </label>
          {form.releaseMode === 'scheduled' ? (
            <label className="text-sm font-semibold text-navy-950">
              Scheduled release date
              <input aria-label={`${prefix} scheduled release date`} type="datetime-local" className={inputClassName()} value={form.releaseAt} onChange={(event) => update('releaseAt', event.target.value)} />
            </label>
          ) : form.releaseMode === 'drip' ? (
            <label className="text-sm font-semibold text-navy-950">
              Days after enrollment
              <input aria-label={`${prefix} drip delay days`} type="number" min="0" max="3650" className={inputClassName()} value={form.dripDelayDays} onChange={(event) => update('dripDelayDays', event.target.value)} />
            </label>
          ) : <div />}

          <label className="text-sm font-semibold text-navy-950">
            Prerequisite
            <select aria-label={`${prefix} material prerequisite`} className={inputClassName()} value={form.prerequisiteLessonId} onChange={(event) => update('prerequisiteLessonId', event.target.value)}>
              <option value="">No explicit prerequisite</option>
              {availableMaterials.filter((material) => material.id !== currentMaterialId).map((material) => (
                <option key={material.id} value={material.id}>{material.title}</option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-navy-950">
            Completion rule
            <select aria-label={`${prefix} material completion rule`} className={inputClassName()} value={form.completionRule} onChange={(event) => update('completionRule', event.target.value as MaterialCompletionRule)}>
              {completionRules.map((rule) => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
            </select>
          </label>

          {form.completionRule === 'media_percentage' ? (
            <label className="text-sm font-semibold text-navy-950">
              Completion percentage
              <input aria-label={`${prefix} material completion percentage`} type="number" min="1" max="100" className={inputClassName()} value={form.completionThreshold} onChange={(event) => update('completionThreshold', event.target.value)} />
            </label>
          ) : <div />}

          {attemptLimited ? (
            <label className="text-sm font-semibold text-navy-950">
              Maximum attempts <span className="font-normal text-muted">(blank = unlimited)</span>
              <input aria-label={`${prefix} material maximum attempts`} type="number" min="1" max="1000" className={inputClassName()} value={form.maxAttempts} onChange={(event) => update('maxAttempts', event.target.value)} />
            </label>
          ) : null}

          <label className="text-sm font-semibold text-navy-950">
            Duration (seconds) <span className="font-normal text-muted">(optional)</span>
            <input aria-label={`${prefix} material duration seconds`} type="number" min="0" step="1" className={inputClassName()} value={form.durationSeconds} onChange={(event) => update('durationSeconds', event.target.value)} />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-navy-950">
            <input type="checkbox" checked={form.isPublished} onChange={(event) => update('isPublished', event.target.checked)} /> Published to enrolled learners
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-navy-950">
            <input type="checkbox" checked={form.isPreview} onChange={(event) => update('isPreview', event.target.checked)} /> Free preview
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-navy-950">
            <input type="checkbox" checked={form.isDownloadable} onChange={(event) => update('isDownloadable', event.target.checked)} /> Downloadable
          </label>
        </div>
      </section>

      {form.materialType === 'quiz' ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Save the quiz material first, then open its assessment editor to add questions, answer options and the pass mark.
        </p>
      ) : null}
      {form.materialType === 'scorm' ? (
        <p className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
          The SCORM ZIP is validated, safely unpacked and prepared for the built-in learner player immediately after the material is saved.
        </p>
      ) : null}
    </div>
  )
}

function QuizEditor({
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
  function updateQuestion(questionIndex: number, prompt: string) {
    setDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, prompt } : question) })
  }

  function updateOption(questionIndex: number, optionIndex: number, label: string) {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex
        ? { ...question, options: question.options.map((option, innerIndex) => innerIndex === optionIndex ? { ...option, label } : option) }
        : question),
    })
  }

  function markCorrect(questionIndex: number, optionIndex: number) {
    setDraft({
      ...draft,
      questions: draft.questions.map((question, index) => index === questionIndex
        ? { ...question, options: question.options.map((option, innerIndex) => ({ ...option, isCorrect: innerIndex === optionIndex })) }
        : question),
    })
  }

  function addQuestion() {
    setDraft({
      ...draft,
      questions: [...draft.questions, {
        prompt: '',
        options: [{ label: '', isCorrect: false }, { label: '', isCorrect: false }],
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
    setDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, options: [...question.options, { label: '', isCorrect: false }] } : question) })
  }

  function removeOption(questionIndex: number, optionIndex: number) {
    setDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, options: question.options.filter((_, innerIndex) => innerIndex !== optionIndex) } : question) })
  }

  function moveOption(questionIndex: number, optionIndex: number, direction: 'up' | 'down') {
    setDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, options: moveArrayItem(question.options, optionIndex, direction) } : question) })
  }

  return (
    <section className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 sm:p-5" aria-label={`Quiz editor ${material.title}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-sky-700"><FileQuestion className="size-4" aria-hidden="true" /> Assessment editor</p>
          <h4 className="mt-1 font-bold text-navy-950">{material.title}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">Correct answers stay in mentor/admin authoring data and are never returned in the learner quiz read model.</p>
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

      <div className="mt-5 space-y-4">
        {draft.questions.map((question, questionIndex) => (
          <section key={questionIndex} className="rounded-2xl border border-mist-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-navy-950">Question {questionIndex + 1}</p>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={`Move question ${questionIndex + 1} up`} disabled={pending || questionIndex === 0} onClick={() => moveQuestion(questionIndex, 'up')} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowUp className="size-4" /></button>
                <button type="button" aria-label={`Move question ${questionIndex + 1} down`} disabled={pending || questionIndex === draft.questions.length - 1} onClick={() => moveQuestion(questionIndex, 'down')} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowDown className="size-4" /></button>
                <button type="button" aria-label={`Remove question ${questionIndex + 1}`} disabled={pending} onClick={() => removeQuestion(questionIndex)} className="rounded-lg p-2 text-rose-700 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="size-4" /></button>
              </div>
            </div>
            <label className="mt-3 block text-sm font-semibold text-navy-950">
              Prompt
              <textarea aria-label={`Question ${questionIndex + 1} prompt`} className={`${inputClassName()} min-h-20 resize-y`} value={question.prompt} onChange={(event) => updateQuestion(questionIndex, event.target.value)} />
            </label>
            <div className="mt-4 space-y-2">
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="grid gap-2 rounded-xl border border-mist-100 bg-mist-50/50 p-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <label className="flex items-center gap-2 text-xs font-bold text-navy-950">
                    <input aria-label={`Question ${questionIndex + 1} option ${optionIndex + 1} correct`} type="radio" name={`quiz-${material.id}-question-${questionIndex}-correct`} checked={option.isCorrect} onChange={() => markCorrect(questionIndex, optionIndex)} /> Correct
                  </label>
                  <input aria-label={`Question ${questionIndex + 1} option ${optionIndex + 1}`} className="min-h-10 rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-teal-500" value={option.label} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} />
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" aria-label={`Move question ${questionIndex + 1} option ${optionIndex + 1} up`} disabled={optionIndex === 0} onClick={() => moveOption(questionIndex, optionIndex, 'up')} className="rounded-lg p-1.5 text-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label={`Move question ${questionIndex + 1} option ${optionIndex + 1} down`} disabled={optionIndex === question.options.length - 1} onClick={() => moveOption(questionIndex, optionIndex, 'down')} className="rounded-lg p-1.5 text-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label={`Remove question ${questionIndex + 1} option ${optionIndex + 1}`} onClick={() => removeOption(questionIndex, optionIndex)} className="rounded-lg p-1.5 text-rose-700"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" aria-label={`Add option to question ${questionIndex + 1}`} onClick={() => addOption(questionIndex)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-navy-950 hover:bg-mist-50"><Plus className="size-3.5" /> Add answer option</button>
          </section>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={addQuestion} className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50"><Plus className="size-4" /> Add question</button>
        <button type="button" disabled={pending} onClick={() => onSave(courseId, material.id, quizPayload(draft))} className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save quiz
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
  const [addingMaterialSectionId, setAddingMaterialSectionId] = useState<string | null>(null)
  const [newMaterial, setNewMaterial] = useState<MaterialFormState>(emptyMaterialState)
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null)
  const [editingMaterial, setEditingMaterial] = useState<MaterialFormState>(emptyMaterialState)
  const [confirmDeleteMaterialId, setConfirmDeleteMaterialId] = useState<string | null>(null)
  const [quizEditingMaterialId, setQuizEditingMaterialId] = useState<string | null>(null)
  const [quizDraft, setQuizDraft] = useState<QuizDraftState>({ passPercentage: '80', instructions: '', questions: [] })

  const allMaterials = useMemo(() => curriculum.sections.flatMap((section) => section.materials), [curriculum.sections])

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

  function beginMaterialEdit(material: MentorMaterial) {
    setEditingMaterialId(material.id)
    setEditingMaterial(materialStateFromPersisted(material))
    setQuizEditingMaterialId(null)
  }

  function beginQuizEdit(material: MentorMaterial) {
    setQuizEditingMaterialId(material.id)
    setQuizDraft(quizStateFromPersisted(material.quiz))
    setEditingMaterialId(null)
  }

  function createMaterial(sectionId: string, form: MaterialFormState) {
    setMessage(null)
    startTransition(async () => {
      const draft = materialPayload(form)
      const result = await createCurriculumMaterial(courseId, sectionId, draft)
      if (!result.ok) {
        setMessage({ tone: 'error', copy: result.error })
        return
      }
      if (draft.materialType === 'scorm' && draft.assetPath) {
        const processed = await processCurriculumScormPackage(courseId, result.materialId, draft.assetPath)
        if (!processed.ok) {
          setMessage({ tone: 'error', copy: `Material saved, but SCORM processing failed: ${processed.error}` })
          router.refresh()
          return
        }
      }
      setAddingMaterialSectionId(null)
      setNewMaterial(emptyMaterialState())
      setMessage({ tone: 'success', copy: 'Material created.' })
      router.refresh()
    })
  }

  function updateMaterial(material: MentorMaterial, form: MaterialFormState) {
    setMessage(null)
    startTransition(async () => {
      const draft = materialPayload(form)
      const result = await updateCurriculumMaterial(courseId, material.id, draft)
      if (!result.ok) {
        setMessage({ tone: 'error', copy: result.error })
        return
      }
      const scormNeedsProcessing = draft.materialType === 'scorm'
        && Boolean(draft.assetPath)
        && (material.scorm?.sourceZipPath !== draft.assetPath || material.scorm?.status !== 'ready')
      if (scormNeedsProcessing && draft.assetPath) {
        const processed = await processCurriculumScormPackage(courseId, material.id, draft.assetPath)
        if (!processed.ok) {
          setMessage({ tone: 'error', copy: `Material saved, but SCORM processing failed: ${processed.error}` })
          router.refresh()
          return
        }
      }
      setEditingMaterialId(null)
      setMessage({ tone: 'success', copy: 'Material changes saved.' })
      router.refresh()
    })
  }

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6" aria-label="Curriculum authoring">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Learning experience</p>
          <h2 className="mt-1 text-2xl font-bold text-navy-950">Curriculum</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Build Edmingle-style sections and first-class materials. Uploaded photos, videos, audio, PDFs and SCORM packages stay inside the Sea N Shore learner experience.</p>
        </div>
        <div className="min-w-64 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-950">
          <p className="font-bold">Course navigation</p>
          <select
            aria-label="Course navigation mode"
            className="mt-2 min-h-10 w-full rounded-lg border border-teal-200 bg-white px-3 text-sm font-semibold text-navy-950"
            value={curriculum.navigationMode}
            disabled={pending}
            onChange={(event) => runAction(() => updateCourseNavigationMode(courseId, event.target.value as 'free' | 'sequential'), 'Navigation mode saved.')}
          >
            <option value="free">Free navigation</option>
            <option value="sequential">Sequential navigation</option>
          </select>
        </div>
      </div>

      {message ? (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${message.tone === 'error' ? 'border border-rose-200 bg-rose-50 text-rose-900' : 'border border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          {message.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <span>{message.copy}</span>
        </div>
      ) : null}

      <form
        className="mt-5 flex flex-col gap-3 rounded-2xl border border-dashed border-mist-200 bg-mist-50/50 p-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          runAction(() => createCurriculumSection(courseId, newSectionTitle), 'Section added.', () => setNewSectionTitle(''))
        }}
      >
        <label className="flex-1 text-sm font-semibold text-navy-950">
          New section title
          <input aria-label="New section title" className={inputClassName()} value={newSectionTitle} onChange={(event) => setNewSectionTitle(event.target.value)} placeholder="e.g. Module 1 · Inspection foundations" />
        </label>
        <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add section
        </button>
      </form>

      <div className="mt-5 space-y-5">
        {curriculum.sections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-mist-200 bg-mist-50/60 p-6 text-center">
            <p className="font-bold text-navy-950">No curriculum sections yet</p>
            <p className="mt-1 text-sm text-muted">Add the first section above, then add the materials learners will study.</p>
          </div>
        ) : null}

        {curriculum.sections.map((section, sectionIndex) => (
          <section key={section.id} className="overflow-hidden rounded-2xl border border-mist-200 bg-mist-50/30">
            <header className="flex flex-col gap-3 border-b border-mist-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Section {sectionIndex + 1}</p>
                {editingSectionId === section.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input aria-label={`Section title for ${section.title}`} className="min-h-10 min-w-64 flex-1 rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm font-semibold text-navy-950 outline-none focus:border-teal-500" value={editingSectionTitle} onChange={(event) => setEditingSectionTitle(event.target.value)} />
                    <button type="button" disabled={pending} onClick={() => runAction(() => updateCurriculumSection(courseId, section.id, editingSectionTitle), 'Section title saved.', () => setEditingSectionId(null))} className="rounded-lg bg-navy-950 px-3 py-2 text-xs font-bold text-white">Save title</button>
                    <button type="button" onClick={() => setEditingSectionId(null)} className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-muted">Cancel</button>
                  </div>
                ) : <h3 className="mt-1 truncate text-lg font-bold text-navy-950">{section.title}</h3>}
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
                ) : <button type="button" aria-label={`Delete ${section.title}`} disabled={pending} onClick={() => setConfirmDeleteSectionId(section.id)} className="rounded-lg p-2 text-rose-700 hover:bg-rose-50"><Trash2 className="size-4" /></button>}
              </div>
            </header>

            <div className="space-y-3 p-4">
              {section.materials.length === 0 ? <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">This section needs at least one material before the course can be submitted.</p> : null}

              {section.materials.map((material, materialIndex) => (
                <article key={material.id} className="rounded-2xl border border-mist-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-mist-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{material.materialType.replaceAll('_', ' ')}</span>
                        <span className="text-xs font-semibold text-muted">Material {materialIndex + 1}</span>
                        {!material.isPublished ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">Unpublished</span> : null}
                        {material.releaseMode !== 'immediate' ? <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold capitalize text-sky-700">{material.releaseMode}</span> : null}
                        {material.scorm ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${material.scorm.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : material.scorm.status === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-violet-50 text-violet-700'}`}>SCORM {material.scorm.status}</span> : null}
                      </div>
                      <h4 className="mt-2 font-bold text-navy-950">{material.title}</h4>
                      {material.summary ? <p className="mt-1 text-sm leading-6 text-muted">{material.summary}</p> : null}
                      {material.scorm?.processingError ? <p className="mt-2 text-xs font-semibold text-rose-700">{material.scorm.processingError}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button" aria-label={`Move ${material.title} up`} disabled={pending || materialIndex === 0} onClick={() => runAction(() => moveCurriculumLesson(courseId, material.id, 'up'))} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowUp className="size-4" /></button>
                      <button type="button" aria-label={`Move ${material.title} down`} disabled={pending || materialIndex === section.materials.length - 1} onClick={() => runAction(() => moveCurriculumLesson(courseId, material.id, 'down'))} className="rounded-lg p-2 text-muted hover:bg-mist-50 disabled:opacity-35"><ArrowDown className="size-4" /></button>
                      <button type="button" aria-label={`Edit ${material.title}`} disabled={pending} onClick={() => beginMaterialEdit(material)} className="rounded-lg p-2 text-muted hover:bg-mist-50"><Pencil className="size-4" /></button>
                      {material.materialType === 'quiz' ? <button type="button" aria-label={`Edit quiz ${material.title}`} disabled={pending} onClick={() => beginQuizEdit(material)} className="rounded-lg p-2 text-sky-700 hover:bg-sky-50"><FileQuestion className="size-4" /></button> : null}
                      {confirmDeleteMaterialId === material.id ? (
                        <>
                          <button type="button" aria-label={`Confirm delete ${material.title}`} disabled={pending} onClick={() => runAction(() => deleteCurriculumLesson(courseId, material.id), 'Material deleted.', () => setConfirmDeleteMaterialId(null))} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white">Confirm delete</button>
                          <button type="button" aria-label={`Cancel delete ${material.title}`} onClick={() => setConfirmDeleteMaterialId(null)} className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-muted">Cancel</button>
                        </>
                      ) : <button type="button" aria-label={`Delete ${material.title}`} disabled={pending} onClick={() => setConfirmDeleteMaterialId(material.id)} className="rounded-lg p-2 text-rose-700 hover:bg-rose-50"><Trash2 className="size-4" /></button>}
                    </div>
                  </div>

                  {editingMaterialId === material.id ? (
                    <div className="mt-4 border-t border-mist-100 pt-4">
                      <MaterialFields courseId={courseId} prefix="Edit" form={editingMaterial} setForm={setEditingMaterial} availableMaterials={allMaterials} currentMaterialId={material.id} />
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setEditingMaterialId(null)} className="rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-muted">Cancel</button>
                        <button type="button" disabled={pending} onClick={() => updateMaterial(material, editingMaterial)} className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"><Save className="size-4" /> Save material changes</button>
                      </div>
                    </div>
                  ) : null}

                  {quizEditingMaterialId === material.id ? (
                    <QuizEditor courseId={courseId} material={material} draft={quizDraft} setDraft={setQuizDraft} pending={pending} onCancel={() => setQuizEditingMaterialId(null)} onSave={(currentCourseId, materialId, input) => runAction(() => saveCurriculumQuiz(currentCourseId, materialId, input), 'Quiz saved.', () => setQuizEditingMaterialId(null))} />
                  ) : null}
                </article>
              ))}

              {addingMaterialSectionId === section.id ? (
                <form
                  className="rounded-2xl border border-teal-200 bg-teal-50/50 p-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    createMaterial(section.id, newMaterial)
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-bold text-navy-950">Add material</h4>
                    <button type="button" aria-label={`Close add material for ${section.title}`} onClick={() => setAddingMaterialSectionId(null)} className="rounded-lg p-2 text-muted"><X className="size-4" /></button>
                  </div>
                  <div className="mt-4"><MaterialFields courseId={courseId} prefix="New" form={newMaterial} setForm={setNewMaterial} availableMaterials={allMaterials} /></div>
                  <div className="mt-4 flex justify-end">
                    <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"><Plus className="size-4" /> Create material</button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  aria-label={`Add material to ${section.title}`}
                  onClick={() => {
                    setAddingMaterialSectionId(section.id)
                    setNewMaterial(emptyMaterialState())
                    setEditingMaterialId(null)
                    setQuizEditingMaterialId(null)
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50"
                >
                  <Plus className="size-4" /> Add material
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-mist-200 bg-mist-50 px-4 py-3 text-xs leading-5 text-muted">
        <ChevronDown className="mt-0.5 size-4 shrink-0" />
        <p>Use the arrow controls to set the persisted learning order. Availability, prerequisites, release rules and completion behavior are saved with each material.</p>
      </div>
    </section>
  )
}
