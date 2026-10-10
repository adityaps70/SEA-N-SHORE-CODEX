'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { CalendarPlus, CheckCheck, Link2, Loader2, Pencil, Repeat, Trash2, Upload, X } from 'lucide-react'
import { uploadLearningMediaFile } from '../../components/upload-learning-media'
import { learningMediaAccept, learningMediaLimitLabel } from '../../media-policy'
import {
  attachRecordingLinkAction,
  cancelSessionAction,
  createSessionAction,
  createSessionSeriesAction,
  markAttendanceAction,
  removeRecordingAction,
  saveUploadedRecordingAction,
  startRecordingUploadAction,
  updateSessionAction,
} from '../session-actions'
import type { SessionAttendee } from '../session-repository'
import type { AttendanceMark, BatchSession } from '../session-rules'
import { formatZonedRange, timeZoneOptions, utcToZonedInputs } from '../session-time'

const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
const labelClass = 'block text-sm font-semibold text-navy-950'
const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-900 hover:border-teal-400 disabled:opacity-60'
const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']] as const

type Message = { tone: 'success' | 'error'; text: string } | null
type Ids = { courseId: string; batchId: string }

function Feedback({ message }: { message: Message }) {
  if (!message) return null
  return <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-800'}`}>{message.text}</p>
}

function useZones() {
  return useMemo(() => timeZoneOptions(), [])
}

function minutes(value: string) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : NaN
}

/** One-off session: create or edit. */
function SessionForm({ ids, defaultZone, session, onDone }: { ids: Ids; defaultZone: string; session?: BatchSession; onDone?: () => void }) {
  const router = useRouter()
  const zones = useZones()
  const start = session ? utcToZonedInputs(session.startsAt, defaultZone) : { date: '', time: '19:00' }
  const [title, setTitle] = useState(session?.title ?? '')
  const [date, setDate] = useState(start.date)
  const [time, setTime] = useState(start.time)
  const [timeZone, setTimeZone] = useState(defaultZone)
  const [duration, setDuration] = useState(String(session?.durationMinutes ?? 60))
  const [meetingUrl, setMeetingUrl] = useState(session?.meetingUrl ?? '')
  const [description, setDescription] = useState(session?.description ?? '')
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const input = { title, description: description.trim() || null, date, time, timeZone, durationMinutes: minutes(duration), meetingUrl: meetingUrl.trim() || null }
    startTransition(async () => {
      const result = session
        ? await updateSessionAction(ids.courseId, ids.batchId, session.id, input)
        : await createSessionAction(ids.courseId, ids.batchId, input)
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      setMessage({ tone: 'success', text: session ? 'Session saved.' : 'Session added.' })
      if (!session) { setTitle(''); setDate(''); setDescription('') }
      router.refresh()
      onDone?.()
    })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <label className={`${labelClass} sm:col-span-2`}>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="For example: Week 1 · SIRE 2.0 overview" className={fieldClass} /></label>
      <label className={labelClass}>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} /></label>
      <label className={labelClass}>Start time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={fieldClass} /></label>
      <label className={labelClass}>Time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className={fieldClass}>{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
      <label className={labelClass}>Length (minutes)<input inputMode="numeric" value={duration} onChange={(event) => setDuration(event.target.value)} className={fieldClass} /></label>
      <label className={`${labelClass} sm:col-span-2`}>Meeting link (Zoom, Google Meet, Teams…)<input type="url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://" className={fieldClass} /></label>
      <label className={`${labelClass} sm:col-span-2`}>Description (optional)<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} className={fieldClass} /></label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CalendarPlus aria-hidden="true" className="size-4" />}
          {session ? 'Save session' : 'Add session'}
        </button>
        {onDone ? <button type="button" onClick={onDone} className={secondaryButton}>Close</button> : null}
      </div>
      <div className="sm:col-span-2"><Feedback message={message} /></div>
    </form>
  )
}

/** Weekly series, e.g. Mon/Wed 19:00 IST for 6 weeks. */
function SeriesForm({ ids, defaultZone }: { ids: Ids; defaultZone: string }) {
  const router = useRouter()
  const zones = useZones()
  const [title, setTitle] = useState('')
  const [weekdays, setWeekdays] = useState<number[]>([1, 3])
  const [time, setTime] = useState('19:00')
  const [timeZone, setTimeZone] = useState(defaultZone)
  const [firstDate, setFirstDate] = useState('')
  const [weeks, setWeeks] = useState('6')
  const [duration, setDuration] = useState('60')
  const [meetingUrl, setMeetingUrl] = useState('')
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()

  function toggle(day: number) {
    setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await createSessionSeriesAction(ids.courseId, ids.batchId, {
        title, weekdays, time, timeZone, firstDate, weekCount: minutes(weeks), durationMinutes: minutes(duration), meetingUrl: meetingUrl.trim() || null,
      })
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      setMessage({ tone: 'success', text: `${result.count} ${result.count === 1 ? 'session' : 'sessions'} added.` })
      setTitle('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <label className={`${labelClass} sm:col-span-2`}>Title (each session is numbered)<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} placeholder="For example: Evening class" className={fieldClass} /></label>
      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>Days</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {WEEKDAYS.map(([day, label]) => (
            <label key={day} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${weekdays.includes(day) ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-200 bg-white text-navy-900'}`}>
              <input type="checkbox" checked={weekdays.includes(day)} onChange={() => toggle(day)} className="sr-only" />{label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={labelClass}>First date<input type="date" value={firstDate} onChange={(event) => setFirstDate(event.target.value)} className={fieldClass} /></label>
      <label className={labelClass}>Start time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={fieldClass} /></label>
      <label className={labelClass}>Time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className={fieldClass}>{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
      <label className={labelClass}>For how many weeks<input inputMode="numeric" value={weeks} onChange={(event) => setWeeks(event.target.value)} className={fieldClass} /></label>
      <label className={labelClass}>Length (minutes)<input inputMode="numeric" value={duration} onChange={(event) => setDuration(event.target.value)} className={fieldClass} /></label>
      <label className={labelClass}>Meeting link (same for every session)<input type="url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://" className={fieldClass} /></label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Repeat aria-hidden="true" className="size-4" />} Add recurring sessions
        </button>
        <Feedback message={message} />
      </div>
    </form>
  )
}

/** Adding sessions: one-off or weekly. */
export function SessionCreatePanel({ ids, defaultZone }: { ids: Ids; defaultZone: string }) {
  const [mode, setMode] = useState<'one' | 'series'>('series')
  return (
    <section aria-labelledby="add-sessions-heading" className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 id="add-sessions-heading" className="text-base font-bold text-navy-950">Add sessions</h2>
      <div role="radiogroup" aria-label="Session type" className="mt-3 flex gap-2">
        {([['series', 'Recurring'], ['one', 'One-off']] as const).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)} className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-bold ${mode === value ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-200 bg-white text-navy-900 hover:border-teal-400'}`}>{label}</button>
        ))}
      </div>
      <div className="mt-4">{mode === 'series' ? <SeriesForm ids={ids} defaultZone={defaultZone} /> : <SessionForm ids={ids} defaultZone={defaultZone} />}</div>
      <p className="mt-3 text-xs text-muted">Paste any https meeting link. Sea N Shore does not create Zoom or Meet links for you.</p>
    </section>
  )
}

/** Attendance for one session: everyone in the batch, with join time and a mark. */
function AttendancePanel({ ids, session, attendees, zone }: { ids: Ids; session: BatchSession; attendees: readonly SessionAttendee[]; zone: string }) {
  const router = useRouter()
  const [marks, setMarks] = useState<Record<string, AttendanceMark | ''>>(() => Object.fromEntries(attendees.map((person) => [person.learnerId, person.mark ?? ''])))
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()
  const clock = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))

  function save(joinedPresent: boolean) {
    setMessage(null)
    const changed = attendees
      .filter((person) => marks[person.learnerId] && marks[person.learnerId] !== person.mark)
      .map((person) => ({ learnerId: person.learnerId, mark: marks[person.learnerId] as AttendanceMark }))
    startTransition(async () => {
      const result = await markAttendanceAction(ids.courseId, ids.batchId, session.id, joinedPresent ? { joinedPresent: true } : { marks: changed })
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      setMessage({ tone: 'success', text: `Attendance saved for ${result.changed} ${result.changed === 1 ? 'learner' : 'learners'}.` })
      router.refresh()
    })
  }

  if (!attendees.length) return <p className="text-sm text-muted">No learners in this batch yet.</p>
  return (
    <div>
      <ul className="divide-y divide-mist-100">
        {attendees.map((person) => (
          <li key={person.learnerId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-navy-950">{person.name}</span>
              <span className="block text-xs text-muted">{person.firstJoinedAt ? `Joined at ${clock(person.firstJoinedAt)} (${zone})${person.joinCount > 1 ? ` · ${person.joinCount} times` : ''}` : 'Did not use Join'}</span>
            </span>
            <select
              aria-label={`Attendance for ${person.name}`}
              value={marks[person.learnerId] ?? ''}
              onChange={(event) => setMarks((current) => ({ ...current, [person.learnerId]: event.target.value as AttendanceMark | '' }))}
              className="min-h-10 rounded-xl border border-mist-200 bg-white px-3 text-sm"
            >
              <option value="">Not marked</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="excused">Excused</option>
            </select>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => save(false)} className={primaryButton}>Save attendance</button>
        <button type="button" disabled={pending} onClick={() => save(true)} className={secondaryButton}><CheckCheck aria-hidden="true" className="size-4" /> Mark everyone who joined as present</button>
      </div>
      <Feedback message={message} />
    </div>
  )
}

/** Recording: paste a link or upload a video (private to the batch and its staff). */
function RecordingPanel({ ids, session }: { ids: Ids; session: BatchSession }) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()

  function saveLink() {
    setMessage(null)
    startTransition(async () => {
      const result = await attachRecordingLinkAction(ids.courseId, ids.batchId, session.id, url)
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      setUrl('')
      setMessage({ tone: 'success', text: 'Recording added. Learners in this batch can watch it now.' })
      router.refresh()
    })
  }

  function upload(file: File | undefined) {
    if (!file) return
    setMessage(null)
    startTransition(async () => {
      const started = await startRecordingUploadAction(ids.courseId, ids.batchId, session.id, { mimeType: file.type, size: file.size })
      if (!started.ok) return setMessage({ tone: 'error', text: started.error })
      try {
        setProgress(0)
        await uploadLearningMediaFile({ uploadUrl: started.uploadUrl, file, onProgress: setProgress, contentType: started.mimeType })
      } catch {
        setProgress(null)
        return setMessage({ tone: 'error', text: 'The upload stopped. Check your connection and try again.' })
      }
      const saved = await saveUploadedRecordingAction(ids.courseId, ids.batchId, session.id, { storagePath: started.storagePath, mimeType: started.mimeType, size: file.size })
      setProgress(null)
      if (!saved.ok) return setMessage({ tone: 'error', text: saved.error })
      setMessage({ tone: 'success', text: 'Recording uploaded. Learners in this batch can watch it now.' })
      router.refresh()
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await removeRecordingAction(ids.courseId, ids.batchId, session.id)
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      router.refresh()
    })
  }

  return (
    <div>
      {session.recording ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href={`/api/learn/sessions/${session.id}/recording`} target="_blank" rel="noopener noreferrer" className={secondaryButton}>Open the recording</a>
          <button type="button" disabled={pending} onClick={remove} className={secondaryButton}><Trash2 aria-hidden="true" className="size-4" /> Remove</button>
        </div>
      ) : null}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1 text-sm"><span className="sr-only">Recording link</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Recording link (https://)" className={fieldClass} /></label>
        <button type="button" disabled={pending || !url.trim()} onClick={saveLink} className={`${secondaryButton} sm:mt-1.5`}><Link2 aria-hidden="true" className="size-4" /> Add link</button>
      </div>
      <label className={`${secondaryButton} mt-2 cursor-pointer`}>
        <Upload aria-hidden="true" className="size-4" /> {progress === null ? 'Upload a video' : `Uploading… ${progress}%`}
        <input type="file" accept={learningMediaAccept('session_recording')} className="sr-only" disabled={pending} onChange={(event) => upload(event.target.files?.[0])} />
      </label>
      <p className="mt-1 text-xs text-muted">{learningMediaLimitLabel('session_recording')}</p>
      <Feedback message={message} />
    </div>
  )
}

export type StudioSession = BatchSession & { joinedCount: number; presentCount: number; attendees?: SessionAttendee[] }

/** The batch's sessions for staff: edit, cancel, attendance and recording per session. */
export function SessionStudioList({ ids, sessions, zone, now }: { ids: Ids; sessions: readonly StudioSession[]; zone: string; now: string }) {
  const router = useRouter()
  const [open, setOpen] = useState<{ id: string; panel: 'edit' | 'attendance' | 'recording' } | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const [pending, startTransition] = useTransition()
  const nowTime = Date.parse(now)

  function cancel(session: StudioSession, restOfSeries: boolean) {
    setMessage(null)
    startTransition(async () => {
      const result = await cancelSessionAction(ids.courseId, ids.batchId, session.id, restOfSeries)
      if (!result.ok) return setMessage({ tone: 'error', text: result.error })
      setMessage({ tone: 'success', text: `${result.cancelled} ${result.cancelled === 1 ? 'session' : 'sessions'} cancelled.` })
      router.refresh()
    })
  }

  if (!sessions.length) return <p className="rounded-2xl border border-mist-100 bg-white p-5 text-sm text-muted">No sessions yet. Add recurring or one-off sessions above.</p>
  return (
    <section aria-labelledby="session-list-heading">
      <h2 id="session-list-heading" className="text-lg font-bold text-navy-950">Sessions</h2>
      <Feedback message={message} />
      <ul className="mt-3 grid gap-3">
        {sessions.map((session) => {
          const started = Date.parse(session.startsAt) <= nowTime
          const cancelled = session.status === 'cancelled'
          const panel = open?.id === session.id ? open.panel : null
          return (
            <li key={session.id} className={`rounded-[1.2rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] ${cancelled ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-bold text-navy-950">{session.title}{cancelled ? ' · Cancelled' : ''}</p>
                  <p className="text-sm text-navy-800">{formatZonedRange(session.startsAt, session.durationMinutes, zone, { withYear: true })}</p>
                  <p className="text-xs text-muted">
                    {session.meetingUrl ? 'Meeting link added' : 'No meeting link yet'}
                    {started && !cancelled ? ` · ${session.joinedCount} joined · ${session.presentCount} marked present` : ''}
                    {session.recording ? ' · Recording added' : ''}
                  </p>
                </div>
                {!cancelled ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setOpen(panel === 'edit' ? null : { id: session.id, panel: 'edit' })} className={secondaryButton}><Pencil aria-hidden="true" className="size-4" /> Edit</button>
                    {started ? <button type="button" onClick={() => setOpen(panel === 'attendance' ? null : { id: session.id, panel: 'attendance' })} className={secondaryButton}>Attendance</button> : null}
                    {started ? <button type="button" onClick={() => setOpen(panel === 'recording' ? null : { id: session.id, panel: 'recording' })} className={secondaryButton}>Recording</button> : null}
                    {!started ? <button type="button" disabled={pending} onClick={() => cancel(session, false)} className={secondaryButton}><X aria-hidden="true" className="size-4" /> Cancel</button> : null}
                    {!started && session.seriesId ? <button type="button" disabled={pending} onClick={() => cancel(session, true)} className={secondaryButton}>Cancel this and later</button> : null}
                  </div>
                ) : null}
              </div>
              {panel === 'edit' ? <div className="mt-4 border-t border-mist-100 pt-4"><SessionForm ids={ids} defaultZone={zone} session={session} onDone={() => setOpen(null)} /></div> : null}
              {panel === 'attendance' ? <div className="mt-4 border-t border-mist-100 pt-4"><AttendancePanel ids={ids} session={session} attendees={session.attendees ?? []} zone={zone} /></div> : null}
              {panel === 'recording' ? <div className="mt-4 border-t border-mist-100 pt-4"><RecordingPanel ids={ids} session={session} /></div> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
