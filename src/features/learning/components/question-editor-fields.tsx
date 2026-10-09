'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { ROLE_DEPARTMENTS, rolesFor } from '@/features/roles/taxonomy'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  TRUE_FALSE_LABELS,
  marksLabel,
  type Difficulty,
  type QuestionType,
} from '../quiz-model'
import type { QuestionInput } from '../quiz-question-schema'

/** A question as the editor holds it: numbers as typed, accepted answers one per line. */
export type QuestionDraft = {
  id?: string
  sourceQuestionId?: string | null
  type: QuestionType
  prompt: string
  options: Array<{ id?: string; label: string; isCorrect: boolean }>
  marks: string
  negativeMarks: string
  explanation: string
  acceptedAnswers: string
  caseSensitive: boolean
  topic: string
  difficulty: '' | Difficulty
  departmentKey: string
  roleKey: string
}

type PersistedQuestion = {
  id?: string
  prompt: string
  options: Array<{ id?: string; label: string; isCorrect: boolean }>
  type?: QuestionType
  marks?: number
  negativeMarks?: number
  explanation?: string | null
  acceptedAnswers?: readonly string[]
  caseSensitive?: boolean
  topic?: string | null
  difficulty?: Difficulty | null
  departmentKey?: string | null
  roleKey?: string | null
  sourceQuestionId?: string | null
}

export function emptyQuestionDraft(type: QuestionType = 'single_choice'): QuestionDraft {
  return withType({
    type: 'single_choice',
    prompt: '',
    options: [{ label: '', isCorrect: false }, { label: '', isCorrect: false }],
    marks: '1',
    negativeMarks: '0',
    explanation: '',
    acceptedAnswers: '',
    caseSensitive: false,
    topic: '',
    difficulty: '',
    departmentKey: '',
    roleKey: '',
  }, type)
}

export function draftFromQuestion(question: PersistedQuestion, options: { keepIds?: boolean } = {}): QuestionDraft {
  const keepIds = options.keepIds ?? true
  return {
    ...(keepIds && question.id ? { id: question.id } : {}),
    ...(question.sourceQuestionId ? { sourceQuestionId: question.sourceQuestionId } : {}),
    type: question.type ?? 'single_choice',
    prompt: question.prompt,
    options: question.options.map((option) => ({ ...(keepIds && option.id ? { id: option.id } : {}), label: option.label, isCorrect: option.isCorrect })),
    marks: marksLabel(question.marks ?? 1),
    negativeMarks: marksLabel(question.negativeMarks ?? 0),
    explanation: question.explanation ?? '',
    acceptedAnswers: (question.acceptedAnswers ?? []).join('\n'),
    caseSensitive: question.caseSensitive ?? false,
    topic: question.topic ?? '',
    difficulty: question.difficulty ?? '',
    departmentKey: question.departmentKey ?? '',
    roleKey: question.roleKey ?? '',
  }
}

function numberOr(value: string, fallback: number) {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : fallback
}

export function questionPayload(draft: QuestionDraft): QuestionInput {
  return {
    id: draft.id ?? null,
    type: draft.type,
    prompt: draft.prompt,
    options: draft.options.map((option) => ({ id: option.id ?? null, label: option.label, isCorrect: option.isCorrect })),
    marks: numberOr(draft.marks, 1),
    negativeMarks: numberOr(draft.negativeMarks, 0),
    explanation: draft.explanation.trim() || null,
    acceptedAnswers: draft.acceptedAnswers.split('\n').map((value) => value.trim()).filter(Boolean),
    caseSensitive: draft.caseSensitive,
    topic: draft.topic.trim() || null,
    difficulty: draft.difficulty || null,
    departmentKey: draft.departmentKey || null,
    roleKey: draft.roleKey || null,
    sourceQuestionId: draft.sourceQuestionId ?? null,
  }
}

/** Switches a question's type, keeping what still fits (options for choice types, one correct for single). */
export function withType(draft: QuestionDraft, type: QuestionType): QuestionDraft {
  if (type === draft.type) return draft
  if (type === 'true_false') {
    return { ...draft, type, options: TRUE_FALSE_LABELS.map((label, index) => ({ label, isCorrect: index === 0 })), acceptedAnswers: '' }
  }
  if (type === 'fill_blank' || type === 'subjective') {
    return { ...draft, type, options: [], acceptedAnswers: type === 'subjective' ? '' : draft.acceptedAnswers, negativeMarks: type === 'subjective' ? '0' : draft.negativeMarks }
  }
  const options = draft.type === 'single_choice' || draft.type === 'multiple_choice'
    ? draft.options
    : [{ label: '', isCorrect: false }, { label: '', isCorrect: false }]
  if (type === 'single_choice') {
    const first = options.findIndex((option) => option.isCorrect)
    return { ...draft, type, acceptedAnswers: '', options: options.map((option, index) => ({ ...option, isCorrect: index === first })) }
  }
  return { ...draft, type, acceptedAnswers: '', options }
}

function moveItem<T>(items: T[], index: number, direction: 'up' | 'down') {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  const current = next[index]!
  next[index] = next[target]!
  next[target] = current
  return next
}

const fieldClass = 'mt-1.5 min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-teal-500'

/**
 * The fields of one question. `label` names it for screen readers and tests ("Question 1"); the quiz editor
 * and the question bank use the same fields.
 */
export function QuestionEditorFields({
  draft,
  onChange,
  label,
  radioGroup,
  pending = false,
  showTags = true,
}: {
  draft: QuestionDraft
  onChange: (next: QuestionDraft) => void
  label: string
  radioGroup: string
  pending?: boolean
  showTags?: boolean
}) {
  const choice = draft.type === 'single_choice' || draft.type === 'multiple_choice'
  const roles = draft.departmentKey ? rolesFor(draft.departmentKey).filter((role) => !role.other) : []

  function setOption(index: number, change: Partial<QuestionDraft['options'][number]>) {
    onChange({ ...draft, options: draft.options.map((option, inner) => (inner === index ? { ...option, ...change } : option)) })
  }

  function markCorrect(index: number) {
    if (draft.type === 'multiple_choice') {
      setOption(index, { isCorrect: !draft.options[index]!.isCorrect })
      return
    }
    onChange({ ...draft, options: draft.options.map((option, inner) => ({ ...option, isCorrect: inner === index })) })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_110px]">
        <label className="text-sm font-semibold text-navy-950">
          Question type
          <select aria-label={`${label} type`} className={fieldClass} value={draft.type} disabled={pending} onChange={(event) => onChange(withType(draft, event.target.value as QuestionType))}>
            {QUESTION_TYPES.map((type) => <option key={type} value={type}>{QUESTION_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Marks
          <input aria-label={`${label} marks`} type="number" min="0.25" max="100" step="0.25" inputMode="decimal" className={fieldClass} value={draft.marks} disabled={pending} onChange={(event) => onChange({ ...draft, marks: event.target.value })} />
        </label>
        {draft.type === 'subjective' ? <div /> : (
          <label className="text-sm font-semibold text-navy-950">
            Negative marks
            <input aria-label={`${label} negative marks`} type="number" min="0" max="100" step="0.25" inputMode="decimal" className={fieldClass} value={draft.negativeMarks} disabled={pending} onChange={(event) => onChange({ ...draft, negativeMarks: event.target.value })} />
          </label>
        )}
      </div>

      <label className="block text-sm font-semibold text-navy-950">
        Prompt
        <textarea aria-label={`${label} prompt`} className={`${fieldClass} min-h-20 resize-y`} value={draft.prompt} disabled={pending} onChange={(event) => onChange({ ...draft, prompt: event.target.value })} />
      </label>

      {draft.type === 'true_false' ? (
        <fieldset>
          <legend className="text-sm font-semibold text-navy-950">The statement is</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.options.map((option, index) => (
              <label key={option.label} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${option.isCorrect ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-mist-200 bg-white text-navy-950'}`}>
                <input aria-label={`${label} option ${index + 1} correct`} type="radio" name={radioGroup} checked={option.isCorrect} disabled={pending} onChange={() => markCorrect(index)} />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {choice ? (
        <div>
          <p className="text-sm font-semibold text-navy-950">
            Answer options <span className="font-normal text-muted">{draft.type === 'multiple_choice' ? '(tick every correct answer)' : '(choose the correct answer)'}</span>
          </p>
          <div className="mt-2 space-y-2">
            {draft.options.map((option, index) => (
              <div key={index} className="grid gap-2 rounded-xl border border-mist-100 bg-mist-50/50 p-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                <label className="flex items-center gap-2 text-xs font-bold text-navy-950">
                  <input
                    aria-label={`${label} option ${index + 1} correct`}
                    type={draft.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                    name={radioGroup}
                    checked={option.isCorrect}
                    disabled={pending}
                    onChange={() => markCorrect(index)}
                  /> Correct
                </label>
                <input aria-label={`${label} option ${index + 1}`} className="min-h-10 rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-teal-500" value={option.label} disabled={pending} onChange={(event) => setOption(index, { label: event.target.value })} />
                <div className="flex items-center justify-end gap-1">
                  <button type="button" aria-label={`Move ${label.toLowerCase()} option ${index + 1} up`} disabled={pending || index === 0} onClick={() => onChange({ ...draft, options: moveItem(draft.options, index, 'up') })} className="grid size-9 place-items-center rounded-lg text-muted transition-colors enabled:hover:bg-mist-100 enabled:hover:text-navy-950 disabled:cursor-not-allowed disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label={`Move ${label.toLowerCase()} option ${index + 1} down`} disabled={pending || index === draft.options.length - 1} onClick={() => onChange({ ...draft, options: moveItem(draft.options, index, 'down') })} className="grid size-9 place-items-center rounded-lg text-muted transition-colors enabled:hover:bg-mist-100 enabled:hover:text-navy-950 disabled:cursor-not-allowed disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  <button type="button" aria-label={`Remove ${label.toLowerCase()} option ${index + 1}`} disabled={pending} onClick={() => onChange({ ...draft, options: draft.options.filter((_, inner) => inner !== index) })} className="grid size-9 place-items-center rounded-lg text-rose-700 transition-colors hover:bg-rose-50"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" aria-label={`Add option to ${label.toLowerCase()}`} disabled={pending || draft.options.length >= 20} onClick={() => onChange({ ...draft, options: [...draft.options, { label: '', isCorrect: false }] })} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-mist-200 bg-white px-3 py-2 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:opacity-50"><Plus className="size-3.5" /> Add answer option</button>
        </div>
      ) : null}

      {draft.type === 'fill_blank' ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block text-sm font-semibold text-navy-950">
            Accepted answers <span className="font-normal text-muted">(one per line)</span>
            <textarea aria-label={`${label} accepted answers`} className={`${fieldClass} min-h-20 resize-y`} value={draft.acceptedAnswers} disabled={pending} onChange={(event) => onChange({ ...draft, acceptedAnswers: event.target.value })} />
          </label>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-navy-950">
            <input aria-label={`${label} case sensitive`} type="checkbox" checked={draft.caseSensitive} disabled={pending} onChange={(event) => onChange({ ...draft, caseSensitive: event.target.checked })} />
            Case must match
          </label>
        </div>
      ) : null}

      {draft.type === 'subjective' ? (
        <p className="rounded-lg bg-mist-50 px-3 py-2 text-xs leading-5 text-muted">Learners type a written answer. You grade it in Studio → Review assignments; their result, completion and certificate wait for your grade.</p>
      ) : null}

      <label className="block text-sm font-semibold text-navy-950">
        Explanation <span className="font-normal text-muted">(optional, shown with the answers)</span>
        <textarea aria-label={`${label} explanation`} className={`${fieldClass} min-h-16 resize-y`} value={draft.explanation} disabled={pending} onChange={(event) => onChange({ ...draft, explanation: event.target.value })} />
      </label>

      {showTags ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-navy-950">
            Topic
            <input aria-label={`${label} topic`} maxLength={80} className={fieldClass} value={draft.topic} disabled={pending} onChange={(event) => onChange({ ...draft, topic: event.target.value })} />
          </label>
          <label className="text-sm font-semibold text-navy-950">
            Difficulty
            <select aria-label={`${label} difficulty`} className={fieldClass} value={draft.difficulty} disabled={pending} onChange={(event) => onChange({ ...draft, difficulty: event.target.value as QuestionDraft['difficulty'] })}>
              <option value="">Not set</option>
              {DIFFICULTIES.map((difficulty) => <option key={difficulty} value={difficulty}>{DIFFICULTY_LABELS[difficulty]}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-950">
            Department
            <select aria-label={`${label} department`} className={fieldClass} value={draft.departmentKey} disabled={pending} onChange={(event) => onChange({ ...draft, departmentKey: event.target.value, roleKey: '' })}>
              <option value="">Any</option>
              {ROLE_DEPARTMENTS.map((department) => <option key={department.key} value={department.key}>{department.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-950">
            Rank / role
            <select aria-label={`${label} rank`} className={fieldClass} value={draft.roleKey} disabled={pending || !draft.departmentKey} onChange={(event) => onChange({ ...draft, roleKey: event.target.value })}>
              <option value="">{draft.departmentKey ? 'Any' : 'Choose a department first'}</option>
              {roles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  )
}
