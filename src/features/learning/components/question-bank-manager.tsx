'use client'

import { useState, useTransition } from 'react'
import { Download, FileUp, Filter, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { ROLE_DEPARTMENTS, departmentByKey, roleByKey, rolesFor } from '@/features/roles/taxonomy'
import { deleteBankQuestion, importBankQuestionsCsv, saveBankQuestion, type BankImportResult } from '../question-bank-actions'
import type { BankQuestion } from '../question-bank-repository'
import { DIFFICULTIES, DIFFICULTY_LABELS, QUESTION_TYPES, QUESTION_TYPE_SHORT_LABELS, marksLabel } from '../quiz-model'
import { QuestionEditorFields, draftFromQuestion, emptyQuestionDraft, questionPayload, type QuestionDraft } from './question-editor-fields'

type Filters = { type: string; difficulty: string; topic: string; department: string; rank: string; q: string }

const fieldClass = 'mt-1 min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-teal-500'
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-60'

function QuestionForm({
  initial,
  title,
  trainerMentorId,
  onDone,
}: {
  initial: QuestionDraft
  title: string
  trainerMentorId: string | null
  onDone: (message: string | null) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await saveBankQuestion(questionPayload(draft), initial.id ?? null, trainerMentorId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onDone(initial.id ? 'Question saved.' : 'Question added to the bank.')
    })
  }

  return (
    <section className="rounded-2xl border border-teal-200 bg-white p-4 sm:p-5" aria-label={title}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-navy-950">{title}</h2>
        <button type="button" onClick={() => onDone(null)} className="rounded-lg p-2 text-muted hover:bg-mist-50" aria-label="Cancel"><X className="size-4" aria-hidden="true" /></button>
      </div>
      <QuestionEditorFields draft={draft} onChange={setDraft} label="Bank question" radioGroup={`bank-${initial.id ?? 'new'}-correct`} pending={pending} />
      {error ? <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => onDone(null)} className={`${buttonClass} border border-mist-200 bg-white text-navy-950 hover:bg-mist-50`}>Cancel</button>
        <button type="button" disabled={pending} onClick={save} className={`${buttonClass} bg-navy-950 text-white hover:bg-navy-900`}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />} Save question
        </button>
      </div>
    </section>
  )
}

function ImportPanel({ trainerMentorId, onImported }: { trainerMentorId: string | null; onImported: (message: string) => void }) {
  const [result, setResult] = useState<BankImportResult | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(formData: FormData) {
    if (trainerMentorId) formData.set('trainer', trainerMentorId)
    startTransition(async () => {
      const next = await importBankQuestionsCsv(formData)
      setResult(next)
      if (next.ok) onImported(`Imported ${next.imported} ${next.imported === 1 ? 'question' : 'questions'}.`)
    })
  }

  return (
    <section className="rounded-2xl border border-mist-200 bg-white p-4 sm:p-5" aria-label="Import questions from a CSV file">
      <h2 className="text-base font-bold text-navy-950">Import from CSV</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        Use the template: one question per row, options separated by “|”, correct as option numbers (1;3) or true/false. Every row is checked first; nothing is imported unless every row is valid.
      </p>
      <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm font-semibold text-navy-950">
          CSV file
          <input name="file" type="file" accept=".csv,text/csv" required className="mt-1 block w-full text-sm text-navy-950 file:mr-3 file:rounded-lg file:border-0 file:bg-mist-100 file:px-3 file:py-2 file:text-sm file:font-bold" />
        </label>
        <button type="submit" disabled={pending} className={`${buttonClass} bg-navy-950 text-white hover:bg-navy-900`}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileUp className="size-4" aria-hidden="true" />} Check and import
        </button>
      </form>
      {result && !result.ok ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm font-bold text-rose-900">{result.error}</p>
          {result.rowErrors?.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Rows to fix</caption>
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-rose-800">
                    <th scope="col" className="py-1 pr-3">Row</th>
                    <th scope="col" className="py-1">What to fix</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rowErrors.map((error) => (
                    <tr key={error.row} className="border-t border-rose-100 align-top">
                      <td className="py-1.5 pr-3 font-bold text-rose-900">{error.row}</td>
                      <td className="py-1.5 text-rose-900">{error.messages.join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function tagLabels(question: BankQuestion) {
  return [
    question.topic,
    question.difficulty ? DIFFICULTY_LABELS[question.difficulty] : null,
    question.departmentKey ? departmentByKey(question.departmentKey)?.label : null,
    question.roleKey ? roleByKey(question.roleKey)?.label : null,
  ].filter((tag): tag is string => Boolean(tag))
}

export function QuestionBankManager({
  questions,
  topics,
  filters,
  filtered,
  total,
  trainerMentorId,
}: {
  questions: BankQuestion[]
  topics: string[]
  filters: Filters
  filtered: boolean
  total: number
  trainerMentorId: string | null
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [department, setDepartment] = useState(filters.department)
  const [pending, startTransition] = useTransition()
  const trainerQuery = trainerMentorId ? `?trainer=${trainerMentorId}` : ''

  function remove(questionId: string) {
    setError(null)
    startTransition(async () => {
      const result = await deleteBankQuestion(questionId, trainerMentorId)
      setConfirmDelete(null)
      if (!result.ok) setError(result.error)
      else setMessage('Question deleted. Quizzes that used it keep their own copy.')
    })
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setEditing('new'); setMessage(null) }} className={`${buttonClass} bg-navy-950 text-white hover:bg-navy-900`}><Plus className="size-4" aria-hidden="true" /> New question</button>
        <button type="button" onClick={() => setImporting((value) => !value)} aria-expanded={importing} className={`${buttonClass} border border-mist-200 bg-white text-navy-950 hover:bg-mist-50`}><FileUp className="size-4" aria-hidden="true" /> Import CSV</button>
        {/* A CSV download from an API route, not a page. The /api/[...slug] catch-all (round H) makes the rule read /api/* as pages. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/learn/question-bank/template" className={`${buttonClass} border border-mist-200 bg-white text-navy-950 hover:bg-mist-50`}><Download className="size-4" aria-hidden="true" /> CSV template</a>
        <a href={`/api/learn/question-bank/export${trainerQuery}`} className={`${buttonClass} border border-mist-200 bg-white text-navy-950 hover:bg-mist-50`}><Download className="size-4" aria-hidden="true" /> Export CSV</a>
      </div>

      {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" role="status">{message}</p> : null}
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900" role="alert">{error}</p> : null}

      {importing ? <ImportPanel trainerMentorId={trainerMentorId} onImported={(text) => { setImporting(false); setMessage(text) }} /> : null}
      {editing === 'new' ? (
        <QuestionForm initial={emptyQuestionDraft()} title="New bank question" trainerMentorId={trainerMentorId} onDone={(text) => { setEditing(null); if (text) setMessage(text) }} />
      ) : null}

      <form method="get" className="rounded-2xl border border-mist-200 bg-white p-4" aria-label="Filter questions">
        {trainerMentorId ? <input type="hidden" name="trainer" value={trainerMentorId} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-bold text-navy-950 lg:col-span-2">
            Words in the question
            <input name="q" defaultValue={filters.q} className={fieldClass} />
          </label>
          <label className="text-xs font-bold text-navy-950">
            Type
            <select name="type" defaultValue={filters.type} className={fieldClass}>
              <option value="">Any type</option>
              {QUESTION_TYPES.map((type) => <option key={type} value={type}>{QUESTION_TYPE_SHORT_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-navy-950">
            Topic
            <select name="topic" defaultValue={filters.topic} className={fieldClass}>
              <option value="">Any topic</option>
              {topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-navy-950">
            Difficulty
            <select name="difficulty" defaultValue={filters.difficulty} className={fieldClass}>
              <option value="">Any</option>
              {DIFFICULTIES.map((difficulty) => <option key={difficulty} value={difficulty}>{DIFFICULTY_LABELS[difficulty]}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-navy-950">
            Department
            <select name="department" value={department} onChange={(event) => setDepartment(event.target.value)} className={fieldClass}>
              <option value="">Any</option>
              {ROLE_DEPARTMENTS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-navy-950">
            Rank / role
            <select name="rank" defaultValue={filters.rank} disabled={!department} className={fieldClass}>
              <option value="">Any</option>
              {rolesFor(department).filter((role) => !role.other).map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" className={`${buttonClass} bg-navy-950 text-white hover:bg-navy-900`}><Filter className="size-4" aria-hidden="true" /> Filter</button>
          {filtered ? <a href={`/learn/studio/question-bank${trainerQuery}`} className="text-sm font-bold text-teal-800 underline">Clear filters</a> : null}
          <span className="text-xs text-muted">{filtered ? `${questions.length} of ${total} questions match` : `${total} ${total === 1 ? 'question' : 'questions'}`}</span>
        </div>
      </form>

      {questions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-mist-200 bg-white p-6 text-sm text-muted">
          {filtered ? 'No questions match these filters.' : 'Your bank is empty. Add a question, or import the CSV template filled in with your questions.'}
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Bank questions">
          {questions.map((question) => (
            <li key={question.id}>
              {editing === question.id ? (
                <QuestionForm initial={draftFromQuestion(question)} title="Edit bank question" trainerMentorId={trainerMentorId} onDone={(text) => { setEditing(null); if (text) setMessage(text) }} />
              ) : (
                <article className="rounded-2xl border border-mist-200 bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-navy-950">{question.prompt}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
                        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-800">{QUESTION_TYPE_SHORT_LABELS[question.type]}</span>
                        <span className="rounded-full bg-mist-100 px-2.5 py-1 text-navy-900">{marksLabel(question.marks)} {question.marks === 1 ? 'mark' : 'marks'}{question.negativeMarks ? ` · −${marksLabel(question.negativeMarks)} if wrong` : ''}</span>
                        {tagLabels(question).map((tag) => <span key={tag} className="rounded-full bg-teal-50 px-2.5 py-1 text-teal-900">{tag}</span>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label={`Edit question: ${question.prompt.slice(0, 60)}`} onClick={() => { setEditing(question.id); setMessage(null) }} className="rounded-lg p-2 text-teal-800 hover:bg-teal-50"><Pencil className="size-4" aria-hidden="true" /></button>
                      {confirmDelete === question.id ? (
                        <>
                          <button type="button" disabled={pending} onClick={() => remove(question.id)} className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-800">Delete</button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg px-2 py-1.5 text-xs font-bold text-muted hover:bg-mist-50">Keep</button>
                        </>
                      ) : (
                        <button type="button" aria-label={`Delete question: ${question.prompt.slice(0, 60)}`} onClick={() => setConfirmDelete(question.id)} className="rounded-lg p-2 text-rose-700 hover:bg-rose-50"><Trash2 className="size-4" aria-hidden="true" /></button>
                      )}
                    </div>
                  </div>
                  {question.options.length ? (
                    <ul className="mt-3 space-y-1 text-sm">
                      {question.options.map((option) => (
                        <li key={option.id} className={option.isCorrect ? 'font-semibold text-emerald-800' : 'text-muted'}>
                          {option.isCorrect ? '✓ ' : '· '}{option.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {question.acceptedAnswers.length ? <p className="mt-3 text-sm text-emerald-800">Accepted: {question.acceptedAnswers.join('; ')}{question.caseSensitive ? ' (case must match)' : ''}</p> : null}
                </article>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
