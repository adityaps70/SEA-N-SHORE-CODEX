import Link from 'next/link'
import { CalendarPlus, PlayCircle, Video } from 'lucide-react'
import type { LearnerBatchSessions, UpcomingLearnerSession } from '../session-repository'
import { attendanceSummary, joinState, learnerSessionStatus, sessionEndsAt } from '../session-rules'
import { LocalSessionTime } from './local-session-time'

const JOIN_NOTICES: Record<string, string> = {
  not_yet: 'Join opens 15 minutes before the session starts.',
  ended: 'That session has ended. Its recording appears here once the trainer adds it.',
  cancelled: 'That session was cancelled.',
  no_link: 'The trainer has not added the meeting link yet. Check back closer to the start.',
}

/**
 * Round D (D2): the learner's Sessions tab in the player: upcoming and past sessions of their batch (in their own
 * time zone), Join, Add to calendar, their own attendance and the recordings.
 */
export function LearnerSessionsPanel({ data, joinNotice, now = new Date() }: { data: LearnerBatchSessions; joinNotice?: string | null; now?: Date }) {
  const upcoming = data.sessions.filter((session) => session.status === 'scheduled' && sessionEndsAt(session).getTime() >= now.getTime())
  const past = data.sessions.filter((session) => !upcoming.includes(session))
  const recordings = data.sessions.filter((session) => session.recording)
  const summary = attendanceSummary(data.sessions.map((session) => ({
    startsAt: session.startsAt,
    status: session.status,
    mark: session.mark,
    joined: session.joined && Date.parse(session.startsAt) <= now.getTime(),
  })))
  const zone = data.batch.timeZone
  const notice = joinNotice ? JOIN_NOTICES[joinNotice] ?? null : null

  return (
    <section aria-label="Live sessions" className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:shadow-none sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Live sessions</h2>
          <p className="mt-1 text-sm text-slate-600">{data.batch.title} · times are shown in your device&rsquo;s time zone</p>
        </div>
        {upcoming.length ? (
          <a href={`/api/learn/batches/${data.batch.id}/calendar`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-teal-400">
            <CalendarPlus aria-hidden="true" className="size-4" /> Add all to calendar
          </a>
        ) : null}
      </div>
      {notice ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{notice}</p> : null}
      {data.minAttendancePercent !== null ? (
        <p className="rounded-xl border border-teal-100 bg-teal-50/70 px-3 py-2 text-sm text-teal-950">
          Your certificate needs at least {data.minAttendancePercent}% attendance at live sessions. You are at {summary.percent}% ({summary.attended} of {summary.total}).
        </p>
      ) : null}

      <div>
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">Upcoming</h3>
        {upcoming.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {upcoming.map((session) => {
              const state = joinState(session, now)
              return (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-950">{session.title}</p>
                    <p className="text-sm text-slate-600"><LocalSessionTime startsAt={session.startsAt} durationMinutes={session.durationMinutes} fallbackZone={zone} /></p>
                    <p className="text-xs text-slate-500">{learnerSessionStatus(session, session.mark, session.joined, now)}{state === 'no_link' ? ' · meeting link coming soon' : ''}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state === 'open' ? (
                      <a href={`/api/learn/sessions/${session.id}/join`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800">
                        <Video aria-hidden="true" className="size-4" /> Join
                      </a>
                    ) : (
                      <span className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-500">Join opens 15 min before</span>
                    )}
                    <a href={`/api/learn/sessions/${session.id}/calendar`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 hover:border-teal-400">
                      <CalendarPlus aria-hidden="true" className="size-4" /> Add to calendar
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-600">No upcoming sessions.</p>}
      </div>

      {past.length ? (
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">Past</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {past.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-slate-950">{session.title}</p>
                  <p className="text-sm text-slate-600"><LocalSessionTime startsAt={session.startsAt} durationMinutes={session.durationMinutes} fallbackZone={zone} withYear /></p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{learnerSessionStatus(session, session.mark, session.joined, now)}</span>
                  {session.recording ? (
                    <a href={`/api/learn/sessions/${session.id}/recording`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 hover:border-teal-400">
                      <PlayCircle aria-hidden="true" className="size-4" /> Recording
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recordings.length ? (
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">Recordings</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {recordings.map((session) => (
              <li key={session.id}>
                <a href={`/api/learn/sessions/${session.id}/recording`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-slate-300 p-3 text-sm hover:border-teal-400">
                  <PlayCircle aria-hidden="true" className="size-5 shrink-0 text-teal-700" />
                  <span className="min-w-0">
                    <span className="block break-words font-semibold text-slate-950">{session.title}</span>
                    <span className="block text-xs text-slate-500"><LocalSessionTime startsAt={session.startsAt} fallbackZone={zone} withYear /></span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/** Round D (D2): My Learning's next live sessions across the learner's batches. */
export function UpcomingSessionsCard({ sessions, now = new Date() }: { sessions: readonly UpcomingLearnerSession[]; now?: Date }) {
  if (!sessions.length) return null
  return (
    <section aria-labelledby="upcoming-sessions-heading" className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 id="upcoming-sessions-heading" className="text-base font-bold text-navy-950">Upcoming sessions</h2>
      <ul className="mt-3 divide-y divide-mist-100">
        {sessions.map((session) => {
          const state = joinState(session, now)
          return (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-navy-950">{session.title}</p>
                <p className="text-xs text-muted">{session.courseTitle} · {session.batchTitle}</p>
                <p className="text-sm text-navy-800"><LocalSessionTime startsAt={session.startsAt} durationMinutes={session.durationMinutes} fallbackZone="Asia/Kolkata" /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                {state === 'open' ? (
                  <a href={`/api/learn/sessions/${session.id}/join`} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800">
                    <Video aria-hidden="true" className="size-4" /> Join
                  </a>
                ) : null}
                <a href={`/api/learn/sessions/${session.id}/calendar`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-900 hover:border-teal-400">
                  <CalendarPlus aria-hidden="true" className="size-4" /> Add to calendar
                </a>
                <Link href={`/learn/courses/${session.courseSlug}/learn?tab=sessions`} className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-900 hover:border-teal-400">
                  All sessions
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
