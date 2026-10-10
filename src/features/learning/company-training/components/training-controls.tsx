'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition, type ReactNode } from 'react'
import { refundSeatsAction } from '../seat-actions'
import {
  acceptCompanyInvitationAction,
  assignSeatsAction,
  cancelCrewInvitationAction,
  declineCompanyInvitationAction,
  inviteCrewAction,
  reassignSeatAction,
  removeCrewMemberAction,
  stopSharingAction,
  updateCrewTagsAction,
  type CrewActionResult,
} from '../crew-actions'

/**
 * D3 company training controls. Every control shows the server's plain-words answer next to it and refreshes the
 * page after a change. Confirmations are asked for anything that cannot be undone from the page.
 */

const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50 disabled:cursor-not-allowed disabled:opacity-60'
const quietDanger = 'inline-flex min-h-10 items-center justify-center rounded-xl px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60'

function useServerAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<CrewActionResult | null>(null)
  function run(work: () => Promise<CrewActionResult>, after?: (result: CrewActionResult) => void) {
    startTransition(async () => {
      const outcome = await work().catch(() => ({ ok: false as const, error: 'Something went wrong. Please try again.' }))
      setResult(outcome)
      after?.(outcome)
      if (outcome.ok) router.refresh()
    })
  }
  return { pending, result, run }
}

function Message({ result }: { result: CrewActionResult | null }) {
  if (!result) return null
  return result.ok
    ? <p role="status" className="text-sm font-medium text-emerald-800">{result.message}</p>
    : <p role="alert" className="text-sm font-medium text-red-700">{result.error}</p>
}

export function InviteCrewForm({ companyId, disabled }: { companyId: string; disabled?: boolean }) {
  const id = useId()
  const { pending, result, run } = useServerAction()
  const [emails, setEmails] = useState('')
  const [vessel, setVessel] = useState('')
  const [rank, setRank] = useState('')
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        run(() => inviteCrewAction(companyId, { emails, vessel, rank }), (outcome) => {
          if (outcome.ok) setEmails('')
        })
      }}
    >
      <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-emails`}>
        Email addresses
        <textarea
          id={`${id}-emails`}
          className={`${fieldClass} min-h-24 py-2.5`}
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          placeholder={'crew.member@example.com\nanother.member@example.com'}
          maxLength={20000}
          required
        />
        <span className="mt-1 block text-xs font-normal text-muted">Up to 50 at a time, separated by new lines, commas or spaces.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-vessel`}>
          Vessel <span className="font-normal text-muted">(optional)</span>
          <input id={`${id}-vessel`} className={fieldClass} value={vessel} maxLength={80} onChange={(event) => setVessel(event.target.value)} placeholder="MT Ocean Star" />
        </label>
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-rank`}>
          Rank <span className="font-normal text-muted">(optional)</span>
          <input id={`${id}-rank`} className={fieldClass} value={rank} maxLength={80} onChange={(event) => setRank(event.target.value)} placeholder="Second Officer" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryButton} disabled={pending || disabled}>{pending ? 'Sending…' : 'Send invitations'}</button>
        <Message result={result} />
      </div>
    </form>
  )
}

export function CancelInvitationButton({ companyId, invitationId }: { companyId: string; invitationId: string }) {
  const { pending, result, run } = useServerAction()
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={quietDanger} disabled={pending} onClick={() => run(() => cancelCrewInvitationAction(companyId, invitationId))}>
        {pending ? 'Cancelling…' : 'Cancel'}
      </button>
      {result && !result.ok ? <Message result={result} /> : null}
    </span>
  )
}

export function CrewMemberControls({ companyId, profileId, name, vessel, rank }: { companyId: string; profileId: string; name: string; vessel: string | null; rank: string | null }) {
  const id = useId()
  const { pending, result, run } = useServerAction()
  const [editing, setEditing] = useState(false)
  const [nextVessel, setNextVessel] = useState(vessel ?? '')
  const [nextRank, setNextRank] = useState(rank ?? '')
  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <button type="button" className={secondaryButton} onClick={() => setEditing(true)}>Edit vessel and rank</button>
        <button
          type="button"
          className={quietDanger}
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Remove ${name} from your crew? Seats they hold stay in use, and you will no longer see their progress.`)) run(() => removeCrewMemberAction(companyId, profileId))
          }}
        >
          Remove
        </button>
        {result && !result.ok ? <Message result={result} /> : null}
      </span>
    )
  }
  return (
    <form
      className="grid w-full gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        run(() => updateCrewTagsAction(companyId, profileId, { vessel: nextVessel, rank: nextRank }), (outcome) => {
          if (outcome.ok) setEditing(false)
        })
      }}
    >
      <label className="block text-xs font-semibold text-navy-950" htmlFor={`${id}-vessel`}>
        Vessel
        <input id={`${id}-vessel`} className={fieldClass} value={nextVessel} maxLength={80} onChange={(event) => setNextVessel(event.target.value)} />
      </label>
      <label className="block text-xs font-semibold text-navy-950" htmlFor={`${id}-rank`}>
        Rank
        <input id={`${id}-rank`} className={fieldClass} value={nextRank} maxLength={80} onChange={(event) => setNextRank(event.target.value)} />
      </label>
      <span className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>Cancel</button>
      </span>
      <div className="sm:col-span-3"><Message result={result} /></div>
    </form>
  )
}

export type AssignCourseOption = {
  courseId: string
  title: string
  available: number
  batches: Array<{ id: string; label: string }> | null
  /** Crew members who can get a seat of this course (active, not enrolled yet). */
  eligible: Array<{ profileId: string; name: string; detail: string | null }>
}

export function AssignSeatsForm({ companyId, courses, disabled }: { companyId: string; courses: AssignCourseOption[]; disabled?: boolean }) {
  const id = useId()
  const { pending, result, run } = useServerAction()
  const [courseId, setCourseId] = useState(courses[0]?.courseId ?? '')
  const [chosen, setChosen] = useState<string[]>([])
  const course = courses.find((option) => option.courseId === courseId) ?? null
  const [batchId, setBatchId] = useState<string>('')
  if (!courses.length) return <p className="text-sm leading-6 text-muted">Buy seats first. Courses with unassigned seats appear here.</p>
  const over = course ? chosen.length > course.available : false
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        run(() => assignSeatsAction(companyId, { courseId, profileIds: chosen, batchId: batchId || null }), (outcome) => {
          if (outcome.ok) setChosen([])
        })
      }}
    >
      <div className={`grid gap-3 ${course?.batches ? 'sm:grid-cols-2' : ''}`}>
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-course`}>
          Course
          <select id={`${id}-course`} className={fieldClass} value={courseId} onChange={(event) => { setCourseId(event.target.value); setChosen([]); setBatchId('') }}>
            {courses.map((option) => <option key={option.courseId} value={option.courseId}>{option.title} · {option.available} {option.available === 1 ? 'seat' : 'seats'} left</option>)}
          </select>
        </label>
        {course?.batches ? (
          <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-batch`}>
            Batch
            <select id={`${id}-batch`} className={fieldClass} value={batchId} onChange={(event) => setBatchId(event.target.value)} required>
              <option value="">Choose a batch</option>
              {course.batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <fieldset className="rounded-xl border border-mist-200 p-3">
        <legend className="px-1 text-sm font-bold text-navy-950">Crew members</legend>
        {course?.eligible.length ? (
          <ul className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
            {course.eligible.map((person) => (
              <li key={person.profileId}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-mist-50">
                  <input
                    type="checkbox"
                    className="size-4 accent-ocean-700"
                    checked={chosen.includes(person.profileId)}
                    onChange={(event) => setChosen((current) => event.target.checked ? [...current, person.profileId] : current.filter((value) => value !== person.profileId))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy-950">{person.name}</span>
                    {person.detail ? <span className="block truncate text-xs text-muted">{person.detail}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Everyone in your crew already has this course, or nobody has joined yet. Invite crew members first.</p>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryButton} disabled={pending || disabled || !chosen.length || over}>
          {pending ? 'Assigning…' : chosen.length ? `Assign ${chosen.length} ${chosen.length === 1 ? 'seat' : 'seats'}` : 'Assign seats'}
        </button>
        {over ? <p role="alert" className="text-sm font-medium text-red-700">Only {course!.available} {course!.available === 1 ? 'seat is' : 'seats are'} left for this course.</p> : null}
        <Message result={result} />
      </div>
    </form>
  )
}

export function ReassignSeatControl({ companyId, seatId, learnerName, options }: { companyId: string; seatId: string; learnerName: string; options: Array<{ profileId: string; name: string }> }) {
  const id = useId()
  const { pending, result, run } = useServerAction()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  if (!options.length) return null
  if (!open) return <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>Move seat</button>
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!to) return
        if (window.confirm(`Move this seat from ${learnerName}? Their access from this seat ends.`)) run(() => reassignSeatAction(companyId, { seatId, toProfileId: to }))
      }}
    >
      <label className="block text-xs font-semibold text-navy-950" htmlFor={`${id}-to`}>
        Move to
        <select id={`${id}-to`} className={fieldClass} value={to} onChange={(event) => setTo(event.target.value)} required>
          <option value="">Choose a crew member</option>
          {options.map((option) => <option key={option.profileId} value={option.profileId}>{option.name}</option>)}
        </select>
      </label>
      <button type="submit" className={primaryButton} disabled={pending || !to}>{pending ? 'Moving…' : 'Move'}</button>
      <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>Cancel</button>
      <div className="w-full"><Message result={result} /></div>
    </form>
  )
}

export function SeatRefundControl({ companyId, orderId, available }: { companyId: string; orderId: string; available: number }) {
  const id = useId()
  const { pending, result, run } = useServerAction()
  const [open, setOpen] = useState(false)
  const [seats, setSeats] = useState(String(available))
  if (!open) return <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>Refund unassigned seats</button>
  const count = Number.parseInt(seats, 10)
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (window.confirm(`Refund ${count} unassigned ${count === 1 ? 'seat' : 'seats'}? A pack can be refunded once, and those seats are gone.`)) run(() => refundSeatsAction(companyId, orderId, count))
      }}
    >
      <label className="block text-xs font-semibold text-navy-950" htmlFor={`${id}-seats`}>
        Seats to refund
        <input id={`${id}-seats`} className={`${fieldClass} w-28`} type="number" inputMode="numeric" min={1} max={available} value={seats} onChange={(event) => setSeats(event.target.value)} />
      </label>
      <button type="submit" className={primaryButton} disabled={pending || !Number.isInteger(count) || count < 1 || count > available}>{pending ? 'Refunding…' : 'Refund'}</button>
      <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>Cancel</button>
      <div className="w-full"><Message result={result} /></div>
    </form>
  )
}

export function StopSharingButton({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { pending, result, run } = useServerAction()
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={secondaryButton}
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Stop sharing your progress and certificates with ${companyName}? Your courses stay yours. To share again, ${companyName} has to invite you again.`)) run(() => stopSharingAction(companyId))
        }}
      >
        {pending ? 'Stopping…' : 'Stop sharing'}
      </button>
      <Message result={result} />
    </span>
  )
}

export function InvitationResponse({ invitationId, children }: { invitationId: string; children?: ReactNode }) {
  const router = useRouter()
  const { pending, result, run } = useServerAction()
  if (result?.ok) {
    return (
      <div className="grid gap-3">
        <Message result={result} />
        <button type="button" className={primaryButton} onClick={() => router.push('/learn/my-learning')}>Go to My Learning</button>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      {children}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primaryButton} disabled={pending} onClick={() => run(() => acceptCompanyInvitationAction(invitationId))}>
          {pending ? 'Saving…' : 'Accept and share'}
        </button>
        <button type="button" className={secondaryButton} disabled={pending} onClick={() => run(() => declineCompanyInvitationAction(invitationId))}>Decline</button>
      </div>
      <Message result={result} />
    </div>
  )
}
