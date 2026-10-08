'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { CheckCircle2, Clock3, Download, FileUp, Loader2, Paperclip, RotateCcw, Send, X, XCircle } from 'lucide-react'
import {
  createAssignmentAttachmentUpload,
  getLearningAssignmentState,
  submitLearningAssignment,
} from '../learner-assignment-actions'
import type { LearnerAssignmentAttachment, LearnerAssignmentState } from '../learner-assignment-repository'
import {
  ASSIGNMENT_DEFAULTS,
  assignmentAttachmentRoute,
  attachmentAccept,
  attachmentMimeType,
  attachmentRulesLabel,
  validateAssignmentAttachment,
  type AssignmentAttachmentRules,
} from '../assignment-policy'
import { uploadLearningMediaFile } from './upload-learning-media'

type Props = {
  slug: string
  lessonId: string
  instructions: string
  acceptedExtensions: string[]
  maxUploadBytes: number
  maxFiles?: number
  maxAttempts: number | null
  attemptsUsed: number
  initiallyCompleted: boolean
}

type PendingFile = {
  localId: string
  name: string
  size: number
  mimeType: string
  storagePath: string | null
  progress: number
  status: 'uploading' | 'ready' | 'error'
  error: string | null
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function newSubmissionId() {
  return crypto.randomUUID()
}

function AttachmentLinks({ attachments }: { attachments: LearnerAssignmentAttachment[] }) {
  if (attachments.length === 0) return null
  return (
    <ul className="mt-2 space-y-1">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={assignmentAttachmentRoute(attachment.id)}
            className="inline-flex max-w-full items-center gap-1.5 break-all text-sm font-semibold text-ocean-700 underline-offset-2 hover:underline"
          >
            <Download aria-hidden="true" className="size-4 shrink-0" /> {attachment.fileName}
            <span className="font-normal text-muted">· {fileSize(attachment.sizeBytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function AssignmentActivity({
  slug,
  lessonId,
  instructions,
  acceptedExtensions,
  maxUploadBytes,
  maxFiles,
  maxAttempts,
  attemptsUsed,
  initiallyCompleted,
}: Props) {
  const [response, setResponse] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [submissionId, setSubmissionId] = useState(newSubmissionId)
  const [state, setState] = useState<LearnerAssignmentState | null>(null)
  const [loadingState, setLoadingState] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)

  async function refreshState() {
    const result = await getLearningAssignmentState(slug, lessonId)
    if (result.ok) setState(result.state)
    else setError(result.error)
    setLoadingState(false)
  }

  useEffect(() => {
    let cancelled = false

    void getLearningAssignmentState(slug, lessonId).then((result) => {
      if (cancelled) return
      if (result.ok) setState(result.state)
      else setError(result.error)
      setLoadingState(false)
    })

    return () => {
      cancelled = true
    }
  }, [slug, lessonId])

  const rules: AssignmentAttachmentRules = state?.attachmentRules ?? {
    acceptedExtensions,
    maxUploadBytes,
    maxFiles: maxFiles ?? ASSIGNMENT_DEFAULTS.maxFiles,
  }
  const attemptsRemaining = state?.attemptsRemaining
    ?? (maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed))
  const completed = state?.completed ?? initiallyCompleted
  const reviewPending = state?.reviewPending ?? false
  const latest = state?.latestAttempt ?? null
  const exhausted = !completed && !reviewPending && attemptsRemaining === 0
  const uploading = files.some((file) => file.status === 'uploading')
  const readyFiles = files.filter((file) => file.status === 'ready')
  const failedFiles = files.some((file) => file.status === 'error')
  const canSubmit = !pending && !exhausted && !uploading && !failedFiles && (response.trim().length > 0 || readyFiles.length > 0)

  function updateFile(localId: string, patch: Partial<PendingFile>) {
    setFiles((current) => current.map((file) => file.localId === localId ? { ...file, ...patch } : file))
  }

  async function uploadFile(file: File, entry: PendingFile) {
    const prepared = await createAssignmentAttachmentUpload(slug, lessonId, submissionId, {
      name: file.name,
      mimeType: entry.mimeType,
      size: file.size,
    })
    if (!prepared.ok) {
      updateFile(entry.localId, { status: 'error', error: prepared.error })
      return
    }
    try {
      await uploadLearningMediaFile({
        uploadUrl: prepared.upload.uploadUrl,
        file,
        contentType: prepared.upload.mimeType,
        onProgress: (progress) => updateFile(entry.localId, { progress }),
      })
      updateFile(entry.localId, { status: 'ready', storagePath: prepared.upload.storagePath, mimeType: prepared.upload.mimeType, progress: 100 })
    } catch {
      updateFile(entry.localId, { status: 'error', error: `“${entry.name}” didn’t upload. Check your connection, remove it and try again.` })
    }
  }

  function addFiles(selected: FileList | null) {
    setError(null)
    if (!selected?.length) return
    const room = rules.maxFiles - files.length
    const chosen = [...selected]
    if (chosen.length > room) {
      setError(`You can attach up to ${rules.maxFiles} file${rules.maxFiles === 1 ? '' : 's'} to this assignment.`)
    }
    for (const file of chosen.slice(0, Math.max(0, room))) {
      const mimeType = attachmentMimeType({ name: file.name, mimeType: file.type })
      const checked = validateAssignmentAttachment({ name: file.name, mimeType, size: file.size, rules })
      const entry: PendingFile = {
        localId: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        mimeType,
        storagePath: null,
        progress: 0,
        status: checked.ok ? 'uploading' : 'error',
        error: checked.ok ? null : checked.error,
      }
      setFiles((current) => [...current, entry])
      if (checked.ok) void uploadFile(file, entry)
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await submitLearningAssignment(slug, lessonId, {
        responseText: response,
        submissionId,
        attachments: readyFiles.map((file) => ({
          storagePath: file.storagePath!,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
        })),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setResponse('')
      setFiles([])
      setSubmissionId(newSubmissionId())
      await refreshState()
    })
  }

  const grading = state ? `Graded out of ${state.maxPoints} points · pass mark ${state.passingPercentage}%` : null

  return (
    <section className="rounded-2xl border border-mist-200 bg-white p-5">
      <p className="text-sm font-bold text-navy-950">Assignment</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-navy-800">{instructions}</p>
      <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
        {attemptsRemaining !== null ? <span>{attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining</span> : <span>Unlimited attempts</span>}
        {grading ? <span>· {grading}</span> : null}
        <span>· Files: {attachmentRulesLabel(rules)}</span>
      </div>

      {loadingState && !completed ? (
        <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading submission status…</div>
      ) : completed ? (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4" aria-hidden="true" /> Passed · assignment complete</div>
          {latest?.percentage !== null && latest?.percentage !== undefined ? <p className="mt-2">Grade: {latest.scorePoints}/{state?.maxPoints} points · {latest.percentage}% (pass mark {state?.passingPercentage}%)</p> : null}
          {latest?.feedback ? <p className="mt-2 leading-6"><span className="font-bold">Mentor feedback:</span> {latest.feedback}</p> : null}
          {latest ? <AttachmentLinks attachments={latest.attachments} /> : null}
        </div>
      ) : reviewPending ? (
        <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <div className="flex items-center gap-2 font-bold"><Clock3 className="size-4" aria-hidden="true" /> Awaiting mentor review</div>
          <p className="mt-2">Attempt {latest?.attemptNumber ?? attemptsUsed + 1} has been submitted. Progress unlocks only after a passing grade.</p>
          {latest ? <AttachmentLinks attachments={latest.attachments} /> : null}
        </div>
      ) : (
        <>
          {latest?.status === 'graded' && latest.passed === false ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <div className="flex items-center gap-2 font-bold"><XCircle className="size-4" aria-hidden="true" /> Not passed · revision required</div>
              <p className="mt-2">Grade: {latest.scorePoints}/{state?.maxPoints} points · {latest.percentage}% · pass mark {state?.passingPercentage}%</p>
              {latest.feedback ? <p className="mt-2 leading-6"><span className="font-bold">Mentor feedback:</span> {latest.feedback}</p> : null}
            </div>
          ) : null}
          <label className="mt-5 block text-sm font-semibold text-navy-950">
            {latest?.passed === false ? 'Revised response' : 'Your response'} <span className="font-normal text-muted">(optional when you attach files)</span>
            <textarea
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={pending || exhausted}
              className="mt-2 min-h-40 w-full resize-y rounded-xl border border-mist-200 bg-white px-4 py-3 text-sm leading-6 text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50"
              placeholder="Write your response here…"
            />
          </label>

          <div className="mt-4">
            <input
              ref={fileInput}
              id={`assignment-files-${lessonId}`}
              type="file"
              multiple
              accept={attachmentAccept(rules)}
              className="sr-only"
              disabled={pending || exhausted || files.length >= rules.maxFiles}
              onChange={(event) => addFiles(event.target.files)}
            />
            <label
              htmlFor={`assignment-files-${lessonId}`}
              aria-disabled={pending || exhausted || files.length >= rules.maxFiles}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <Paperclip className="size-4" aria-hidden="true" /> Attach files
            </label>
            <span className="ml-3 text-xs text-muted">{files.length}/{rules.maxFiles} attached</span>
            {files.length > 0 ? (
              <ul className="mt-3 space-y-2" aria-label="Attached files">
                {files.map((file) => (
                  <li key={file.localId} className={`rounded-xl border px-3 py-2 text-sm ${file.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-mist-200 bg-mist-50/60 text-navy-950'}`}>
                    <div className="flex items-center gap-2">
                      {file.status === 'uploading' ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : file.status === 'ready' ? <FileUp className="size-4 shrink-0 text-teal-700" aria-hidden="true" /> : <XCircle className="size-4 shrink-0" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 break-all font-semibold">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted">{file.status === 'uploading' ? `${file.progress}%` : fileSize(file.size)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        disabled={pending}
                        onClick={() => setFiles((current) => current.filter((entry) => entry.localId !== file.localId))}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-white hover:text-navy-950"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    {file.error ? <p className="mt-1 text-xs leading-5">{file.error}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : latest?.passed === false ? <RotateCcw className="size-4" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            {exhausted ? 'Attempt limit reached' : pending ? 'Submitting…' : uploading ? 'Uploading files…' : latest?.passed === false ? 'Submit revision' : 'Submit for review'}
          </button>
        </>
      )}

      {state && state.attempts.length > 1 ? (
        <div className="mt-5 border-t border-mist-100 pt-4">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Attempt history</p>
          <div className="mt-2 space-y-3">
            {state.attempts.map((attempt) => (
              <div key={attempt.id} className="text-xs text-muted">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Attempt {attempt.attemptNumber}</span>
                  <span>{attempt.status === 'submitted' ? 'Awaiting review' : attempt.passed ? `Passed · ${attempt.scorePoints}/${state.maxPoints} · ${attempt.percentage}%` : `Not passed · ${attempt.scorePoints}/${state.maxPoints} · ${attempt.percentage}%`}</span>
                </div>
                <AttachmentLinks attachments={attempt.attachments} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    </section>
  )
}
