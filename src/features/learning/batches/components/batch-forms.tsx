'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { CalendarPlus, Loader2, Save, UserMinus, UserPlus } from 'lucide-react'
import { DEFAULT_TIME_ZONE, timeZoneOptions, utcToZonedInputs, zonedLocalToUtc } from '../../sessions/session-time'
import {
  addBatchInstructorAction,
  createBatchAction,
  removeBatchInstructorAction,
  saveBatchSettingsAction,
  setBatchManagerAction,
  updateBatchAction,
} from '../batch-actions'
import { BATCH_STATUSES, batchStatusLabel, type BatchStatus, type CourseBatch, type CourseBatchSettings } from '../batch-rules'

export const batchFieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50'
const labelClass = 'block text-sm font-semibold text-navy-950'
const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 hover:border-teal-400 disabled:opacity-60'

type Message = { tone: 'success' | 'error'; text: string } | null

function Feedback({ id, message }: { id: string; message: Message }) {
  if (!message) return null
  return (
    <p id={id} role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-800'}`}>
      {message.text}
    </p>
  )
}

/** Round D (D1): turn batches on for a course, choose where drip lessons count from, and the attendance rule. */
export function BatchSettingsForm({ courseId, settings }: { courseId: string; settings: CourseBatchSettings }) {
  const router = useRouter()
  const [batchMode, setBatchMode] = useState(settings.batchMode)
  const [dripAnchor, setDripAnchor] = useState(settings.dripAnchor)
  const [attendance, setAttendance] = useState(settings.minAttendancePercent === null ? '' : String(settings.minAttendancePercent))
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const percent = attendance.trim() === '' ? null : Number(attendance)
    if (percent !== null && (!Number.isInteger(percent) || percent < 1 || percent > 100)) {
      setMessage({ tone: 'error', text: 'Minimum attendance must be a whole number between 1 and 100, or empty for no rule.' })
      return
    }
    startTransition(async () => {
      const result = await saveBatchSettingsAction(courseId, { batchMode, dripAnchor, minAttendancePercent: percent })
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      setMessage({ tone: 'success', text: 'Batch settings saved.' })
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="batch-settings-heading" className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 id="batch-settings-heading" className="text-base font-bold text-navy-950">How this course runs</h2>
      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">Course mode</legend>
        <label className="flex items-start gap-3 rounded-xl border border-mist-100 p-3 text-sm">
          <input type="radio" name="batch-mode" value="self_paced" checked={batchMode === 'self_paced'} onChange={() => setBatchMode('self_paced')} className="mt-1" />
          <span><span className="font-bold text-navy-950">Self-paced</span><span className="block text-muted">Learners join any time and work at their own pace (as today).</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-mist-100 p-3 text-sm">
          <input type="radio" name="batch-mode" value="batches" checked={batchMode === 'batches'} onChange={() => setBatchMode('batches')} className="mt-1" />
          <span><span className="font-bold text-navy-950">Dated batches</span><span className="block text-muted">Learners choose a batch with a start date, seats and live sessions.</span></span>
        </label>
      </fieldset>
      {batchMode === 'batches' ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Drip lessons open
            <select value={dripAnchor} onChange={(event) => setDripAnchor(event.target.value === 'batch_start' ? 'batch_start' : 'enrolment')} className={batchFieldClass}>
              <option value="enrolment">Counted from when the learner enrols</option>
              <option value="batch_start">Counted from the batch start date</option>
            </select>
          </label>
          <label className={labelClass}>
            Minimum live-session attendance for the certificate (%)
            <input inputMode="numeric" value={attendance} onChange={(event) => setAttendance(event.target.value)} placeholder="No rule" className={batchFieldClass} />
            <span className="mt-1 block text-xs font-normal text-muted">Leave empty for no rule. Excused sessions are not counted.</span>
          </label>
        </div>
      ) : null}
      <div className="mt-4">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
          Save settings
        </button>
      </div>
      <Feedback id="batch-settings-message" message={message} />
    </form>
  )
}

function endOfDayUtc(date: string, timeZone: string) {
  return zonedLocalToUtc(date, '23:59', timeZone)
}

/** Round D (D1): create a batch, or edit one (with its status). Dates are entered in the batch's own time zone. */
export function BatchForm({ courseId, batch }: { courseId: string; batch?: CourseBatch }) {
  const router = useRouter()
  const zones = useMemo(() => timeZoneOptions(), [])
  const initialZone = batch?.timeZone ?? DEFAULT_TIME_ZONE
  const startInputs = batch ? utcToZonedInputs(batch.startsAt, initialZone) : { date: '', time: '09:00' }
  const [title, setTitle] = useState(batch?.title ?? '')
  const [timeZone, setTimeZone] = useState(initialZone)
  const [startDate, setStartDate] = useState(startInputs.date)
  const [startTime, setStartTime] = useState(startInputs.time)
  const [endDate, setEndDate] = useState(batch?.endsAt ? utcToZonedInputs(batch.endsAt, initialZone).date : '')
  const [seatLimit, setSeatLimit] = useState(batch?.seatLimit === null || batch?.seatLimit === undefined ? '' : String(batch.seatLimit))
  const [enrolmentOpen, setEnrolmentOpen] = useState(batch?.enrolmentOpen ?? true)
  const [status, setStatus] = useState<BatchStatus>(batch?.status ?? 'upcoming')
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const startsAt = zonedLocalToUtc(startDate, startTime, timeZone)
    if (!startsAt) return setMessage({ tone: 'error', text: 'Enter the start date and time.' })
    const endsAt = endDate ? endOfDayUtc(endDate, timeZone) : null
    if (endDate && !endsAt) return setMessage({ tone: 'error', text: 'Enter a valid end date, or leave it empty.' })
    const seats = seatLimit.trim() === '' ? null : Number(seatLimit)
    if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 10000)) {
      return setMessage({ tone: 'error', text: 'The seat limit must be a whole number from 1 to 10,000, or empty for no limit.' })
    }
    const input = { title, startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() ?? null, seatLimit: seats, timeZone, enrolmentOpen, status }
    startTransition(async () => {
      if (batch) {
        const result = await updateBatchAction(courseId, batch.id, input)
        if (!result.ok) return setMessage({ tone: 'error', text: result.error })
        setMessage({ tone: 'success', text: 'Batch saved.' })
        router.refresh()
        return
      }
      const result = await createBatchAction(courseId, input)
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      router.push(`/learn/studio/courses/${courseId}/batches/${result.batchId}`)
    })
  }

  const formId = batch ? `batch-form-${batch.id}` : 'batch-form-new'
  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${formId}-heading`} className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 id={`${formId}-heading`} className="text-base font-bold text-navy-950">{batch ? 'Batch details' : 'Add a batch'}</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Batch name
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="For example: November 2026 evening batch" maxLength={120} className={batchFieldClass} />
        </label>
        <label className={labelClass}>
          Start date
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={batchFieldClass} />
        </label>
        <label className={labelClass}>
          Start time
          <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className={batchFieldClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Time zone (the start, the end and session times are entered in this zone)
          <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className={batchFieldClass}>
            {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          End date (optional)
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={batchFieldClass} />
        </label>
        <label className={labelClass}>
          Seat limit (optional)
          <input inputMode="numeric" value={seatLimit} onChange={(event) => setSeatLimit(event.target.value)} placeholder="No limit" className={batchFieldClass} />
        </label>
        {batch ? (
          <label className={labelClass}>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as BatchStatus)} className={batchFieldClass}>
              {BATCH_STATUSES.map((value) => <option key={value} value={value}>{batchStatusLabel(value)}</option>)}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-3 self-end text-sm font-semibold text-navy-950">
          <input type="checkbox" checked={enrolmentOpen} onChange={(event) => setEnrolmentOpen(event.target.checked)} className="size-4" />
          Open for enrolment
        </label>
      </div>
      <div className="mt-4">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : batch ? <Save aria-hidden="true" className="size-4" /> : <CalendarPlus aria-hidden="true" className="size-4" />}
          {batch ? 'Save batch' : 'Add batch'}
        </button>
      </div>
      <Feedback id={`${formId}-message`} message={message} />
    </form>
  )
}

/** Round D (D1): the batch manager and instructors, added by a member's verified email. */
export function BatchStaffPanel({ courseId, batchId, managerName, instructors, canManage }: {
  courseId: string
  batchId: string
  managerName: string | null
  instructors: readonly { profileId: string; name: string }[]
  canManage: boolean
}) {
  const router = useRouter()
  const [managerEmail, setManagerEmail] = useState('')
  const [instructorEmail, setInstructorEmail] = useState('')
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, reset?: () => void) {
    setMessage(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      reset?.()
      setMessage({ tone: 'success', text: success })
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="batch-staff-heading" className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 id="batch-staff-heading" className="text-base font-bold text-navy-950">Batch team</h2>
      <p className="mt-1 text-sm leading-6 text-muted">The batch manager and instructors run this batch&rsquo;s sessions, attendance and recordings, and see its learners. They cannot edit the course.</p>
      <dl className="mt-3 grid gap-1 text-sm">
        <dt className="font-semibold text-navy-950">Manager</dt>
        <dd className="text-navy-800">{managerName ?? 'Not set'}</dd>
      </dl>
      {canManage ? (
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            run(() => setBatchManagerAction(courseId, batchId, managerEmail), managerEmail.trim() ? 'Batch manager set.' : 'Batch manager removed.', () => setManagerEmail(''))
          }}
        >
          <label className="min-w-0 flex-1 text-sm">
            <span className="sr-only">Manager&rsquo;s email address</span>
            <input type="email" value={managerEmail} onChange={(event) => setManagerEmail(event.target.value)} placeholder="Manager’s email (empty to remove)" className={batchFieldClass} />
          </label>
          <button type="submit" disabled={pending} className={`${secondaryButton} sm:mt-1.5`}>Set manager</button>
        </form>
      ) : null}
      <h3 className="mt-4 text-sm font-bold text-navy-950">Instructors</h3>
      {instructors.length ? (
        <ul className="mt-2 divide-y divide-mist-100">
          {instructors.map((instructor) => (
            <li key={instructor.profileId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-semibold text-navy-950">{instructor.name}</span>
              {canManage ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeBatchInstructorAction(courseId, batchId, instructor.profileId), 'Instructor removed.')}
                  className={secondaryButton}
                >
                  <UserMinus aria-hidden="true" className="size-4" /> Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-muted">No instructors yet.</p>}
      {canManage ? (
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            run(() => addBatchInstructorAction(courseId, batchId, instructorEmail), 'Instructor added.', () => setInstructorEmail(''))
          }}
        >
          <label className="min-w-0 flex-1 text-sm">
            <span className="sr-only">Instructor&rsquo;s email address</span>
            <input type="email" value={instructorEmail} onChange={(event) => setInstructorEmail(event.target.value)} placeholder="Instructor’s email" className={batchFieldClass} />
          </label>
          <button type="submit" disabled={pending || !instructorEmail.trim()} className={`${secondaryButton} sm:mt-1.5`}>
            <UserPlus aria-hidden="true" className="size-4" /> Add instructor
          </button>
        </form>
      ) : null}
      <Feedback id="batch-staff-message" message={message} />
    </section>
  )
}
