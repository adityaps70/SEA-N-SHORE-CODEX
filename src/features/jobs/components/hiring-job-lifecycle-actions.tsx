'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, RotateCcw, Send, Trash2 } from 'lucide-react'
import { changeHiringJobStatus, deleteHiringJob } from '../hiring-actions'
import {
  availableJobActions,
  formatLifecycleDate,
  isApplyUntilOpen,
  type JobLifecycleAction,
  type JobLifecycleSnapshot,
} from '../job-lifecycle'

export type HiringJobLifecycleActionsProps = {
  jobId: string
  jobTitle: string
  lifecycle: JobLifecycleSnapshot
  /** Today's date (YYYY-MM-DD) from the server, so client and server agree. */
  today: string
  /** Where to go after the job is deleted. */
  afterDeleteHref?: string
  /** 'sheet' renders the actions as full-width rows for the phone "…" sheet. */
  layout?: 'buttons' | 'sheet'
}

const SHEET_ROW_CLASS =
  'flex min-h-14 w-full cursor-pointer items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-mist-50 [&>svg]:size-5 [&>svg]:shrink-0'

const ACTION_BUTTON: Record<JobLifecycleAction, { label: string; className: string; Icon: typeof Send }> = {
  publish: { label: 'Publish', Icon: Send, className: 'bg-navy-950 text-white hover:bg-navy-900' },
  republish: { label: 'Republish', Icon: RotateCcw, className: 'bg-navy-950 text-white hover:bg-navy-900' },
  archive: { label: 'Archive', Icon: Archive, className: 'border border-mist-200 bg-white text-navy-950 hover:bg-mist-50' },
  delete: { label: 'Delete', Icon: Trash2, className: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50' },
}

const SUCCESS_MESSAGE: Record<Exclude<JobLifecycleAction, 'delete'>, string> = {
  publish: 'Job published. It is now visible in job search.',
  republish: 'Job republished. It is visible in job search again.',
  archive: 'Job archived. It is hidden from job search; you can still review applicants.',
}

function applicantsText(count: number) {
  return `${count} ${count === 1 ? 'person has' : 'people have'} applied`
}

export function HiringJobLifecycleActions({
  jobId,
  jobTitle,
  lifecycle,
  today,
  afterDeleteHref = '/hiring/jobs?notice=deleted',
  layout = 'buttons',
}: HiringJobLifecycleActionsProps) {
  const asSheet = layout === 'sheet'
  const router = useRouter()
  const actions = availableJobActions(lifecycle)
  const [pendingAction, setPendingAction] = useState<JobLifecycleAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dateInvalid, setDateInvalid] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const currentDateValid = isApplyUntilOpen(lifecycle.applyUntil, today)
  const [applyUntil, setApplyUntil] = useState(currentDateValid ? lifecycle.applyUntil ?? '' : '')
  const [noClosingDate, setNoClosingDate] = useState(currentDateValid && !lifecycle.applyUntil)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const triggerRefs = useRef(new Map<JobLifecycleAction, HTMLButtonElement | null>())
  const panelId = useId()
  const dateId = useId()

  useEffect(() => {
    if (pendingAction) headingRef.current?.focus()
  }, [pendingAction])

  if (!actions.length && !success && !error) return null

  function close() {
    const action = pendingAction
    setPendingAction(null)
    setError(null)
    setDateInvalid(false)
    if (action) triggerRefs.current.get(action)?.focus()
  }

  function open(action: JobLifecycleAction) {
    setSuccess(null)
    setError(null)
    setDateInvalid(false)
    setPendingAction(action)
  }

  function confirm() {
    const action = pendingAction
    if (!action) return
    setError(null)
    setDateInvalid(false)

    let nextApplyUntil: string | null | undefined
    if (action === 'publish' || action === 'republish') {
      if (noClosingDate) {
        nextApplyUntil = null
      } else if (!applyUntil) {
        setError('Choose an apply-by date, or tick “No closing date”.')
        setDateInvalid(true)
        return
      } else if (applyUntil < today) {
        setError(`Choose today (${formatLifecycleDate(today)}) or a later date.`)
        setDateInvalid(true)
        return
      } else {
        nextApplyUntil = applyUntil
      }
    }

    startTransition(async () => {
      const result = action === 'delete'
        ? await deleteHiringJob(jobId)
        : await changeHiringJobStatus(jobId, action, nextApplyUntil === undefined ? {} : { applyUntil: nextApplyUntil })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPendingAction(null)
      if (action === 'delete') {
        router.push(afterDeleteHref)
        return
      }
      setSuccess(SUCCESS_MESSAGE[action])
      router.refresh()
    })
  }

  const needsDate = pendingAction === 'publish' || pendingAction === 'republish'

  return (
    <div className="w-full">
      {actions.length ? (
        <div className={asSheet ? 'flex flex-col' : 'flex flex-wrap gap-2'} role="group" aria-label={`Manage ${jobTitle}`}>
          {actions.map((action) => {
            const { label, className, Icon } = ACTION_BUTTON[action]
            return (
              <button
                key={action}
                ref={(node) => { triggerRefs.current.set(action, node) }}
                type="button"
                aria-expanded={pendingAction === action}
                aria-controls={pendingAction === action ? panelId : undefined}
                disabled={isPending}
                onClick={() => (pendingAction === action ? close() : open(action))}
                className={asSheet
                  ? `${SHEET_ROW_CLASS} ${action === 'delete' ? 'text-red-700 hover:bg-red-50' : 'text-navy-950 hover:bg-mist-50'}`
                  : `inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 aria-expanded:ring-2 aria-expanded:ring-ocean-200 aria-expanded:ring-offset-1 ${className}`}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </button>
            )
          })}
        </div>
      ) : null}

      {pendingAction ? (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-labelledby={`${panelId}-heading`}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !isPending) {
              event.stopPropagation()
              close()
            }
          }}
          className={`mt-3 rounded-2xl border p-4 ${pendingAction === 'delete' ? 'border-rose-200 bg-rose-50/60' : 'border-mist-200 bg-mist-50'}`}
        >
          <h3 id={`${panelId}-heading`} ref={headingRef} tabIndex={-1} className="font-bold text-navy-950 focus:outline-none">
            {pendingAction === 'delete' ? `Delete “${jobTitle}”?` : null}
            {pendingAction === 'archive' ? `Archive “${jobTitle}”?` : null}
            {pendingAction === 'publish' ? `Publish “${jobTitle}”?` : null}
            {pendingAction === 'republish' ? `Republish “${jobTitle}”?` : null}
          </h3>

          <div className="mt-1.5 space-y-2 text-sm leading-6 text-ink">
            {pendingAction === 'delete' ? (
              lifecycle.applicantCount > 0 ? (
                <p>
                  {applicantsText(lifecycle.applicantCount)}. Their applications stay in their own history, marked as removed by the employer.
                  You will no longer see this job or its applicants, and this can’t be undone.
                </p>
              ) : (
                <p>The job will be removed from your jobs. This can’t be undone.</p>
              )
            ) : null}
            {pendingAction === 'archive' ? (
              <p>
                The job will be hidden from job search and stop taking applications.
                {lifecycle.applicantCount > 0 ? ` You can still review the ${lifecycle.applicantCount} applicant${lifecycle.applicantCount === 1 ? '' : 's'}.` : ''} You can republish it later.
              </p>
            ) : null}
            {needsDate ? (
              <>
                <p>
                  The job will appear in job search and accept applications
                  {pendingAction === 'republish' && lifecycle.applicantCount > 0 ? '. People who already applied keep their applications' : ''}.
                </p>
                {!currentDateValid && lifecycle.applyUntil ? (
                  <p className="font-semibold text-amber-900">
                    The previous apply-by date ({formatLifecycleDate(lifecycle.applyUntil)}) has passed. Choose a new date or remove it.
                  </p>
                ) : null}
                <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end">
                  <label htmlFor={dateId} className="block text-sm font-semibold text-navy-900">
                    Apply by
                    <input
                      id={dateId}
                      type="date"
                      min={today}
                      value={applyUntil}
                      disabled={noClosingDate || isPending}
                      aria-invalid={dateInvalid || undefined}
                      aria-describedby={dateInvalid ? `${panelId}-error` : undefined}
                      onChange={(event) => {
                        setApplyUntil(event.target.value)
                        setDateInvalid(false)
                      }}
                      className="mt-1 block min-h-11 w-full rounded-xl border border-mist-200 aria-[invalid=true]:border-rose-400 bg-white px-3 py-2 text-sm text-navy-950 focus:border-navy-300 focus:ring-2 focus:ring-navy-100 disabled:bg-mist-50 disabled:text-muted sm:w-48"
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-navy-900">
                    <input
                      type="checkbox"
                      checked={noClosingDate}
                      disabled={isPending}
                      onChange={(event) => {
                        setNoClosingDate(event.target.checked)
                        setDateInvalid(false)
                      }}
                      className="size-4"
                    />
                    No closing date
                  </label>
                </div>
              </>
            ) : null}
          </div>

          {error ? <p id={`${panelId}-error`} role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{error}</p> : null}

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isPending}
              onClick={close}
              className="min-h-11 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={confirm}
              className={`min-h-11 rounded-xl px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 ${pendingAction === 'delete' ? 'bg-rose-700 hover:bg-rose-800' : 'bg-navy-950 hover:bg-navy-900'}`}
            >
              {isPending
                ? pendingAction === 'delete' ? 'Deleting…' : pendingAction === 'archive' ? 'Archiving…' : 'Publishing…'
                : pendingAction === 'delete' ? 'Delete job' : pendingAction === 'archive' ? 'Archive job' : pendingAction === 'republish' ? 'Republish job' : 'Publish job'}
            </button>
          </div>
        </div>
      ) : null}

      {!pendingAction && error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {success ? <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{success}</p> : null}
    </div>
  )
}
