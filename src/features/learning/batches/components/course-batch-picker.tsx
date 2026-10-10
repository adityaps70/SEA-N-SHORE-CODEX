import Link from 'next/link'
import { CalendarDays, CheckCircle2 } from 'lucide-react'
import { batchClosedLabel, batchClosedReason, batchStartLabel, batchStatusLabel, seatsLeft, type CourseBatch } from '../batch-rules'

/**
 * Round D (D1): the batches a learner can join, on the course page. Choosing one is a link (`?batch=`), so it works
 * without JavaScript and the enrol or buy button below carries it. Full or closed batches are shown but not linked.
 */
export function CourseBatchPicker({ coursePath, batches, selectedId }: { coursePath: string; batches: readonly CourseBatch[]; selectedId: string | null }) {
  if (!batches.length) {
    return (
      <div className="mt-6 rounded-[1.3rem] border border-white/10 bg-navy-950/45 p-4 text-sm text-white/75">
        No batch is open for enrolment right now. Check back soon for the next start date.
      </div>
    )
  }
  return (
    <fieldset className="mt-6">
      <legend className="flex items-center gap-2 text-sm font-bold text-white">
        <CalendarDays aria-hidden="true" className="size-4 text-teal-200" /> Choose your batch
      </legend>
      <ul className="mt-3 grid gap-2">
        {batches.map((batch) => {
          const reason = batchClosedReason(batch)
          const left = seatsLeft(batch)
          const selected = batch.id === selectedId && !reason
          const body = (
            <>
              <span className="min-w-0">
                <span className="block break-words font-bold">{batch.title}</span>
                <span className="block text-xs opacity-80">{batchStartLabel(batch)} · {batchStatusLabel(batch.status)}</span>
                <span className="block text-xs opacity-80">
                  {reason ? batchClosedLabel(reason) : left === null ? 'Seats available' : `${left} ${left === 1 ? 'seat' : 'seats'} left`}
                </span>
              </span>
              {selected ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-teal-700" /> : null}
            </>
          )
          return (
            <li key={batch.id}>
              {reason ? (
                <span aria-disabled="true" className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/55">{body}</span>
              ) : (
                <Link
                  href={`${coursePath}?batch=${batch.id}#course-access`}
                  scroll={false}
                  aria-current={selected ? 'true' : undefined}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${selected ? 'border-teal-300 bg-white text-navy-950' : 'border-white/15 bg-white/10 text-white hover:border-teal-200'}`}
                >
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
